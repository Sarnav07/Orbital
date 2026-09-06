import itertools
import random
import unittest
from decimal import Decimal as D, ROUND_DOWN, localcontext
from fractions import Fraction

from reference.orbital import Geometry, GeometryError


class GeometryTests(unittest.TestCase):
    def setUp(self):
        self.context = localcontext()
        self.context.__enter__().prec = 100
        self.addCleanup(self.context.__exit__, None, None, None)

    def close(self, actual, expected, tolerance=D("1e-65")):
        self.assertLessEqual(abs(actual - expected), tolerance * max(D(1), abs(expected)))

    def test_equal_price_states_for_two_three_four_assets(self):
        for n in (2, 3, 4):
            with self.subTest(n=n):
                model = Geometry(n, 14)
                q = model.equal_price_reserve()
                self.close(sum((D(14) - q) ** 2 for _ in range(n)), D(196))
                self.close(model.sphere_residual([q] * n), D(0))
                self.assertEqual(model.spot_rate([q] * n, 0, 1), 1)
                self.close(q, D(14) * (1 - 1 / D(n).sqrt()))

    def test_hand_derived_two_asset_tick(self):
        # Circle centered at (5,5), radius 5: (1,2) and (2,1)
        # give 4^2 + 3^2 = 25 and sum = 3.
        model = Geometry(2, 5)
        tick = model.tick(D(3) / D(2).sqrt())
        self.close(tick.minimum_reserve, D(1))
        self.close(tick.maximum_reserve, D(2))
        self.close(tick.boundary_radius, 1 / D(2).sqrt())
        self.assertEqual(model.sphere_residual([1, 2]), 0)

    def test_hand_derived_three_asset_tick(self):
        # Radius 3; (2,1,1) has gaps (1,2,2), squared norm 9.
        # The other extremum is (2/3,5/3,5/3), also on sum = 4.
        model = Geometry(3, 3)
        tick = model.tick(D(4) / D(3).sqrt())
        self.close(tick.minimum_reserve, D(2) / 3)
        self.close(tick.maximum_reserve, D(2))
        self.assertEqual(model.sphere_residual([2, 1, 1]), 0)

    def test_hand_derived_four_asset_tick(self):
        # Radius 14; (3,9,9,9) gives 11^2+3*5^2 = 196.
        # Opposite extremum (12,6,6,6) gives 2^2+3*8^2 = 196.
        model = Geometry(4, 14)
        tick = model.tick(15)
        self.assertEqual(tick.minimum_reserve, 3)
        self.assertEqual(tick.maximum_reserve, 12)
        self.assertEqual(tick.real_reserve_at_peg, 4)
        self.assertEqual(tick.capital_efficiency, D("1.75"))
        self.assertEqual(tick.normalized_boundary, Fraction(15, 14))
        self.assertEqual(model.sphere_residual([3, 9, 9, 9]), 0)
        self.assertEqual(model.sphere_residual([12, 6, 6, 6]), 0)

    def test_minimal_tick_is_analytical_only(self):
        for n in (2, 3, 4):
            model = Geometry(n, 7)
            tick = model.tick(model.k_bounds()[0])
            self.assertEqual(tick.boundary_radius, 0)
            self.assertEqual(tick.minimum_reserve, model.equal_price_reserve())
            self.assertEqual(tick.maximum_reserve, tick.minimum_reserve)
            self.assertEqual(tick.real_reserve_at_peg, 0)
            self.assertIsNone(tick.capital_efficiency)

    def test_maximal_tick_has_no_virtual_offset(self):
        for n in (2, 3, 4):
            model = Geometry(n, 7)
            tick = model.tick(model.k_bounds()[1])
            self.assertEqual(tick.minimum_reserve, 0)
            self.assertEqual(tick.maximum_reserve, 7)
            self.assertEqual(tick.capital_efficiency, 1)

    def test_projection_and_pythagoras(self):
        model = Geometry(4, 14)
        alpha, w = model.polar([3, 9, 9, 9])
        self.assertEqual(alpha, 15)
        self.assertEqual(sum(w), 0)
        self.assertEqual((alpha - 28) ** 2 + sum(x * x for x in w), 196)

    def test_price_direction_and_reciprocity(self):
        model = Geometry(2, 5)
        self.close(model.spot_rate([2, 1], 0, 1), D(3) / 4)
        self.close(model.spot_rate([2, 1], 1, 0), D(4) / 3)
        # Reconstruct an output coordinate directly from the circle equation.
        dx = D("1e-25")
        new_y = 5 - (25 - (3 - dx) ** 2).sqrt()
        finite_difference = (1 - new_y) / dx
        self.close(finite_difference, model.spot_rate([2, 1], 0, 1), D("1e-24"))

    def test_permutation_symmetry(self):
        model = Geometry(4, 14)
        for values in set(itertools.permutations((3, 9, 9, 9))):
            self.assertEqual(model.sphere_residual(values), 0)
            self.assertEqual(model.polar(values)[0], 15)
            low = values.index(3)
            other = next(i for i in range(4) if i != low)
            self.assertEqual(model.spot_rate(values, low, other), D(11) / 5)

    def test_scale_invariance_and_exact_range_identity(self):
        base = Geometry(4, 14).tick(15)
        for factor in (D("0.001"), D(17), D("1e30")):
            scaled = Geometry(4, 14 * factor).tick(15 * factor)
            self.assertEqual(scaled.normalized_boundary, base.normalized_boundary)
            self.close(scaled.minimum_reserve, base.minimum_reserve * factor)
            self.close(scaled.maximum_reserve, base.maximum_reserve * factor)
            self.close(scaled.boundary_radius, base.boundary_radius * factor)
            self.close(scaled.real_reserve_at_peg, base.real_reserve_at_peg * factor)
            self.close(scaled.capital_efficiency, base.capital_efficiency)

    def test_range_identity_does_not_fuzzily_merge_nearby_ticks(self):
        model = Geometry(4, 14)
        self.assertNotEqual(model.tick(15).normalized_boundary,
                            model.tick("15.0000000000000001").normalized_boundary)

    def test_quadratic_cross_check_and_coordinate_witnesses(self):
        # Independent algebraic expression from the paper, evaluated at higher
        # precision; also verify minimum witnesses satisfy BOTH constraints.
        for n in (2, 3, 4):
            r = D(11)
            model = Geometry(n, r)
            low, high = model.k_bounds()
            for fraction in (D("0.01"), D("0.2"), D("0.8"), D("0.99")):
                k = low + fraction * (high - low)
                tick = model.tick(k)
                root_n = D(n).sqrt()
                disc = (k * k * n - n * ((n - 1) * r - k * root_n) ** 2).sqrt()
                expected_min = (k * root_n - disc) / n
                expected_max = min(r, (k * root_n + disc) / n)
                self.close(tick.minimum_reserve, expected_min)
                self.close(tick.maximum_reserve, expected_max)
                other = (k * root_n - tick.minimum_reserve) / (n - 1)
                state = [tick.minimum_reserve] + [other] * (n - 1)
                self.close(sum(state) / root_n, k)
                self.close(sum((r - x) ** 2 for x in state), r * r)
                self.assertTrue(all(0 <= x <= r for x in state))

    def test_concentration_decreases_as_tick_widens(self):
        for n in (2, 3, 4):
            model = Geometry(n, 1)
            low, high = model.k_bounds()
            ticks = [model.tick(low + D(i) / 10 * (high - low)) for i in range(1, 10)]
            for a, b in zip(ticks, ticks[1:]):
                self.assertGreater(a.capital_efficiency, b.capital_efficiency)
                self.assertGreater(a.minimum_reserve, b.minimum_reserve)
                self.assertLess(a.real_reserve_at_peg, b.real_reserve_at_peg)

    def test_single_depeg_boundary_matches_price_vector(self):
        for n in (2, 3, 4):
            model = Geometry(n, 7)
            for price in (D(0), D("0.5"), D("0.99"), D(1)):
                norm = (price * price + n - 1).sqrt()
                reserves = [7 - 7 * price / norm] + [7 - 7 / norm] * (n - 1)
                k = model.k_from_single_depeg(price)
                self.close(sum(reserves) / D(n).sqrt(), k)
                self.close(model.spot_rate(reserves, 0, 1), price)
                model.tick(k)

    def test_precision_convergence(self):
        values = []
        for precision in (40, 80, 120):
            model = Geometry(3, "1000000", precision)
            values.append(model.tick(model.k_from_single_depeg("0.99")).capital_efficiency)
        self.assertLess(abs(values[1] - values[2]), abs(values[0] - values[2]))
        self.close(values[0], values[2], D("1e-30"))
        self.close(values[1], values[2], D("1e-70"))

    def test_near_endpoints_remain_finite_and_in_domain(self):
        model = Geometry(4, 14)
        low, high = model.k_bounds()
        for k in (low + D("1e-60"), high - D("1e-60")):
            tick = model.tick(k)
            self.assertTrue(tick.capital_efficiency.is_finite())
            self.assertGreater(tick.real_reserve_at_peg, 0)
            self.assertGreaterEqual(tick.minimum_reserve, 0)
            self.assertLessEqual(tick.maximum_reserve, 14)
        self.assertGreater(model.tick(low + D("1e-60")).capital_efficiency, D("1e29"))
        self.assertGreater(model.tick(high - D("1e-60")).minimum_reserve, 0)

    def test_unresolvable_single_depeg_rejects_instead_of_collapsing(self):
        model = Geometry(4, 14, precision=32)
        with self.assertRaises(ArithmeticError):
            model.k_from_single_depeg("0.999999999999999999999999999999")

    def test_seeded_geometry_sweep(self):
        rng = random.Random(20260907)
        for _ in range(200):
            n = rng.choice((2, 3, 4))
            radius = D(rng.randint(1, 100000)) / 100
            model = Geometry(n, radius)
            low, high = model.k_bounds()
            k = low + D(rng.randint(1, 9999)) / 10000 * (high - low)
            tick = model.tick(k)
            other = (k * D(n).sqrt() - tick.minimum_reserve) / (n - 1)
            residual = ((radius - tick.minimum_reserve) ** 2
                        + (n - 1) * (radius - other) ** 2 - radius ** 2)
            self.close(residual / radius ** 2, D(0))
            self.assertGreater(tick.capital_efficiency, 1)
            self.assertTrue(0 < tick.minimum_reserve < model.equal_price_reserve())
            self.assertTrue(tick.minimum_reserve <= tick.maximum_reserve <= radius)

    def test_caller_context_does_not_change_results(self):
        model = Geometry(4, 14)
        expected = model.tick(15)
        with localcontext() as caller:
            caller.prec = 6
            caller.rounding = ROUND_DOWN
            self.assertEqual(model.tick(15), expected)
            self.assertEqual(caller.prec, 6)
            self.assertEqual(caller.rounding, ROUND_DOWN)

    def test_invalid_model_inputs(self):
        for n in (0, 1, -3, True, 3.0):
            with self.assertRaises(GeometryError):
                Geometry(n, 1)
        for radius in (0, -1, "NaN", "sNaN", "Infinity", "bad", 1.0, True):
            with self.assertRaises(GeometryError):
                Geometry(4, radius)
        for precision in (0, 31, True, 80.0):
            with self.assertRaises(GeometryError):
                Geometry(4, 1, precision)

    def test_invalid_tick_and_depeg_inputs(self):
        model = Geometry(4, 14)
        for k in (0, -1, "13.999999", "21.000001", "NaN", "Infinity", 15.0):
            with self.assertRaises(GeometryError):
                model.tick(k)
        for price in (-1, "1.01", "NaN", 0.5):
            with self.assertRaises(GeometryError):
                model.k_from_single_depeg(price)

    def test_invalid_states_and_price_indices(self):
        model = Geometry(2, 5)
        for values in ([1], [1, 2, 3], [-1, 2], [6, 1], ["NaN", 1]):
            with self.assertRaises(GeometryError):
                model.sphere_residual(values)
        with self.assertRaises(GeometryError):
            model.spot_rate([1, 1], 0, 1)
        for indices in ((0, 0), (-1, 0), (0, 2), (True, 0), (0.0, 1)):
            with self.assertRaises(GeometryError):
                model.spot_rate([2, 1], *indices)

    def test_zero_and_singular_price(self):
        model = Geometry(2, 5)
        self.assertEqual(model.spot_rate([0, 5], 1, 0), 0)
        with self.assertRaises(GeometryError):
            model.spot_rate([0, 5], 0, 1)


if __name__ == "__main__":
    unittest.main()
