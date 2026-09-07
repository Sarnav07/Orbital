import json
import pathlib
import unittest
from decimal import Decimal as D

from reference.orbital import SegmentationError, SegmentedPool


class SegmentedPoolTests(unittest.TestCase):
    def close(self, actual, expected, tolerance=D("1e-35")):
        self.assertLessEqual(abs(actual - expected), tolerance * max(D(1), abs(expected)))

    def pool(self):
        return SegmentedPool(4, [("100", "1.10"), ("100", "1.30")])

    def test_initial_state_is_consolidated_sphere(self):
        pool = self.pool()
        self.assertEqual(pool.snapshot()["interior"], (True, True))
        self.close(pool.global_residual(), D(0))
        self.assertEqual(pool.alpha_int_normalized(), D(1))
        self.assertEqual(pool.reserves, [D(100)] * 4)

    def test_within_segment_trade_matches_sphere_witness(self):
        pool = self.pool()
        output, trace = pool.swap_exact_in(0, 1, "80")
        self.assertEqual(len(trace), 1)
        self.assertIsNone(trace[0].crossed_boundary)
        self.close(output, D(40))
        self.close(pool.global_residual(), D(0))
        self.assertEqual(pool.snapshot()["interior"], (True, True))
        self.assertLess(pool.alpha_int_normalized(), D("1.10"))

    def test_trade_segments_at_first_boundary_and_updates_torus_state(self):
        pool = self.pool()
        output, trace = pool.swap_exact_in(0, 1, "100")
        self.assertEqual(len(trace), 2)
        self.assertEqual(trace[0].crossed_boundary, D("1.10"))
        self.close(trace[0].amount_in, D(80))
        self.close(trace[0].amount_out, D(40))
        self.close(output, D("40.123552802932248591415218327110577980693843614254264451439007408989617163658546"))
        self.assertEqual(pool.snapshot()["interior"], (False, True))
        self.assertEqual(trace[0].interior_ranges, 1)
        self.assertEqual(trace[0].boundary_ranges, 1)
        self.close(pool.global_residual(), D(0))
        self.assertGreater(pool.alpha_int_normalized(), D("1.10"))
        self.assertLess(pool.alpha_int_normalized(), D("1.30"))

    def test_reverse_trade_recovers_boundary_before_continuing(self):
        pool = self.pool()
        pool.swap_exact_in(0, 1, "100")
        output, trace = pool.swap_exact_in(1, 0, "10")
        self.assertEqual(len(trace), 2)
        self.assertEqual(trace[0].crossed_boundary, D("1.10"))
        self.assertEqual(pool.snapshot()["interior"], (True, True))
        self.assertGreater(output, D(10))
        self.close(pool.global_residual(), D(0))
        self.assertLess(pool.alpha_int_normalized(), D("1.10"))

    def test_tied_ranges_cross_together(self):
        pool = SegmentedPool(4, [("50", "1.10"), ("100", "1.10"), ("100", "1.30")])
        _, trace = pool.swap_exact_in(0, 1, "120")
        self.assertEqual(trace[0].crossed_boundary, D("1.10"))
        self.assertEqual(pool.snapshot()["interior"], (False, False, True))
        self.close(pool.global_residual(), D(0))

    def test_all_boundary_continuation_is_explicitly_rejected(self):
        pool = SegmentedPool(4, [("100", "1.10")])
        with self.assertRaises(SegmentationError):
            pool.swap_exact_in(0, 1, "100")

    def test_fixture(self):
        fixture_path = pathlib.Path(__file__).parents[1] / "fixtures" / "segmented-v1.json"
        fixture = json.loads(fixture_path.read_text())
        pool = SegmentedPool(fixture["n"], fixture["ranges"], fixture["precision"])
        output, trace = pool.swap_exact_in(**fixture["trade"])
        expected = fixture["expected"]
        self.assertEqual(len(trace), expected["segments"])
        self.assertEqual(trace[0].crossed_boundary, D(expected["first_crossing"]))
        self.close(trace[0].amount_in, D(expected["first_input"]))
        self.close(trace[0].amount_out, D(expected["first_output"]))
        self.close(output, D(expected["total_output"]))
        self.assertEqual(list(pool.snapshot()["interior"]), expected["interior"])

    def test_rejects_invalid_ranges_and_trades(self):
        for ranges in ([], [("100", "1")], [("100", "1.6")], [(0, "1.1")]):
            with self.assertRaises(SegmentationError):
                SegmentedPool(4, ranges)
        pool = self.pool()
        for args in ((0, 0, 1), (-1, 0, 1), (0, 1, 0), (0, 1, -1)):
            with self.assertRaises(SegmentationError):
                pool.swap_exact_in(*args)


if __name__ == "__main__":
    unittest.main()
