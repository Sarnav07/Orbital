"""Independent Decimal reference for Orbital's aggregate invariant and segments.

This deliberately uses bracketing rather than the future Solidity solver. It is
slow, deterministic, and intended to make an incorrect fixed-point branch or
crossing order observable in tests and fixtures.
"""

from dataclasses import dataclass
from decimal import Context, Decimal, localcontext

from .geometry import Geometry, GeometryError, _decimal


class SegmentationError(GeometryError):
    """A segmented trade has no supported physical solution."""


@dataclass
class Range:
    radius: Decimal
    normalized_boundary: Decimal
    is_interior: bool = True


@dataclass(frozen=True)
class Segment:
    amount_in: Decimal
    amount_out: Decimal
    crossed_boundary: Decimal | None
    interior_ranges: int
    boundary_ranges: int


class SegmentedPool:
    """Aggregate Orbital ticks and execute exact-input reference trades.

    Each range is a sphere cap `(radius, k/r)`. Interior ranges consolidate to
    one sphere; boundary ranges consolidate in the orthogonal subspace. The
    global residual is the torus invariant from the Orbital paper. Tick status
    changes are segmented at the first crossed normalized boundary.

    This model excludes fees, token-decimal conversion, LP accounting and the
    all-boundary continuation case. It is not production trade execution.
    """

    def __init__(self, n, ranges, precision=80):
        if type(n) is not int or n < 2:
            raise SegmentationError("asset count must be an integer >= 2")
        if type(precision) is not int or precision < 40:
            raise SegmentationError("precision must be an integer >= 40 digits")
        if not ranges:
            raise SegmentationError("at least one range is required")
        self.n = n
        self.precision = precision
        self.ranges = []
        with self._context():
            for radius, normalized_boundary in ranges:
                radius = _decimal(radius)
                normalized_boundary = _decimal(normalized_boundary)
                if radius <= 0:
                    raise SegmentationError("range radius must be positive")
                geometry = Geometry(n, radius, precision)
                low, high = geometry.k_bounds()
                k = radius * normalized_boundary
                if k <= low:
                    raise SegmentationError("degenerate minimal ranges cannot provide liquidity")
                if k > high:
                    raise SegmentationError("normalized boundary is outside tick bounds")
                geometry.tick(k)
                self.ranges.append(Range(radius, normalized_boundary))
            total_radius = self.total_radius
            peg = total_radius * (1 - 1 / Decimal(n).sqrt())
            self.reserves = [peg] * n
            self._assert_invariant()

    @property
    def _iterations(self):
        # 160 bisections leave a 200-token bracket below 1e-45. This is a
        # reference solver tolerance, deliberately separate from the 80-digit
        # Decimal context and any future integer settlement tolerance.
        return max(128, self.precision * 2)

    def _context(self):
        return localcontext(Context(prec=self.precision))

    @property
    def total_radius(self):
        return sum(item.radius for item in self.ranges)

    def snapshot(self):
        """A serializable state snapshot used by fixture tests and the simulator."""
        with self._context():
            return {
                "reserves": tuple(self.reserves),
                "interior": tuple(item.is_interior for item in self.ranges),
                "global_residual": self.global_residual(),
            }

    def aggregates(self):
        with self._context():
            interior = [item for item in self.ranges if item.is_interior]
            boundary = [item for item in self.ranges if not item.is_interior]
            r_int = sum(item.radius for item in interior)
            k_bound = sum(item.radius * item.normalized_boundary for item in boundary)
            s_bound = sum(
                Geometry(self.n, item.radius, self.precision)
                .tick(item.radius * item.normalized_boundary)
                .boundary_radius
                for item in boundary
            )
            return r_int, k_bound, s_bound

    def global_residual(self, reserves=None):
        """Return `torus_lhs - r_int²` in squared token units."""
        with self._context():
            values = self._validate_reserves(self.reserves if reserves is None else reserves)
            r_int, k_bound, s_bound = self.aggregates()
            root_n = Decimal(self.n).sqrt()
            alpha_total = sum(values) / root_n
            alpha_int = alpha_total - k_bound
            mean = sum(values) / self.n
            w_norm = sum((value - mean) ** 2 for value in values).sqrt()
            return (alpha_int - r_int * root_n) ** 2 + (w_norm - s_bound) ** 2 - r_int ** 2

    def alpha_int_normalized(self, reserves=None):
        with self._context():
            r_int, k_bound, _ = self.aggregates()
            if r_int == 0:
                raise SegmentationError("all ranges are at boundaries; continuation is not implemented")
            values = self._validate_reserves(self.reserves if reserves is None else reserves)
            return (sum(values) / Decimal(self.n).sqrt() - k_bound) / r_int

    def swap_exact_in(self, input_index, output_index, amount_in, max_segments=16):
        """Execute a no-fee reference swap and return output plus a segment trace."""
        with self._context():
            self._validate_indices(input_index, output_index)
            amount_in = _decimal(amount_in)
            if amount_in <= 0:
                raise SegmentationError("amount in must be positive")
            if type(max_segments) is not int or max_segments < 1:
                raise SegmentationError("max_segments must be a positive integer")
            remaining = amount_in
            amount_out = Decimal(0)
            trace = []
            for _ in range(max_segments):
                if remaining == 0:
                    break
                r_int, _, _ = self.aggregates()
                if r_int == 0:
                    raise SegmentationError("all-boundary continuation is not implemented")
                alpha_before = self.alpha_int_normalized()
                candidate_out = self._solve_output_fixed_status(input_index, output_index, remaining)
                candidate = self._apply(self.reserves, input_index, output_index, remaining, candidate_out)
                alpha_after = self.alpha_int_normalized(candidate)
                target = self._next_crossing(alpha_before, alpha_after)
                if target is None:
                    self.reserves = candidate
                    amount_out += candidate_out
                    trace.append(self._segment(remaining, candidate_out, None))
                    remaining = Decimal(0)
                    break

                partial_in, partial_out = self._solve_to_boundary(
                    input_index, output_index, remaining, target, alpha_after > alpha_before
                )
                if partial_in <= 0 or partial_in > remaining or partial_out < 0:
                    raise SegmentationError("crossing made no progress")
                self.reserves = self._apply(self.reserves, input_index, output_index, partial_in, partial_out)
                self._cross(target, alpha_after > alpha_before)
                self._assert_invariant()
                amount_out += partial_out
                remaining -= partial_in
                trace.append(self._segment(partial_in, partial_out, target))
            else:
                raise SegmentationError("segment limit exceeded")
            self._assert_invariant()
            return amount_out, tuple(trace)

    def _segment(self, amount_in, amount_out, crossed_boundary):
        return Segment(
            amount_in=amount_in,
            amount_out=amount_out,
            crossed_boundary=crossed_boundary,
            interior_ranges=sum(item.is_interior for item in self.ranges),
            boundary_ranges=sum(not item.is_interior for item in self.ranges),
        )

    def _next_crossing(self, old, new):
        if new > old:
            candidates = [
                item.normalized_boundary
                for item in self.ranges
                if item.is_interior and old < item.normalized_boundary <= new
            ]
            return min(candidates) if candidates else None
        if new < old:
            candidates = [
                item.normalized_boundary
                for item in self.ranges
                if not item.is_interior and new <= item.normalized_boundary < old
            ]
            return max(candidates) if candidates else None
        return None

    def _cross(self, boundary, rising):
        matching = [item for item in self.ranges if item.normalized_boundary == boundary]
        if not matching:
            raise SegmentationError("crossing range disappeared")
        for item in matching:
            if rising and not item.is_interior:
                raise SegmentationError("attempted to trap an existing boundary range")
            if not rising and item.is_interior:
                raise SegmentationError("attempted to recover an interior range")
            item.is_interior = not rising

    def _solve_to_boundary(self, input_index, output_index, limit, target, rising):
        # At a crossing alpha_total is fixed. Because alpha_total is
        # sum(reserves)/sqrt(n), D = input-output is also fixed. This avoids
        # repeatedly solving a full swap inside a second bisection.
        r_int, k_bound, _ = self.aggregates()
        target_sum = (r_int * target + k_bound) * Decimal(self.n).sqrt()
        delta = target_sum - sum(self.reserves)
        lower = max(Decimal(0), delta)
        upper = min(limit, self.reserves[output_index] + delta)
        if lower < 0 or upper <= lower:
            raise SegmentationError("crossing has no positive input/output interval")

        def residual_for_input(amount):
            return self.global_residual(
                self._apply(self.reserves, input_index, output_index, amount, amount - delta)
            )

        amount_in = self._first_root(lower, upper, residual_for_input)
        amount_out = amount_in - delta
        if amount_out < 0:
            raise SegmentationError("crossing produced negative output")
        return amount_in, amount_out

    def _solve_output_fixed_status(self, input_index, output_index, amount_in):
        """Find the first positive physical root with statuses held constant."""
        amount_in = _decimal(amount_in)
        if amount_in == 0:
            return Decimal(0)
        current_output = self.reserves[output_index]
        if current_output <= 0:
            raise SegmentationError("empty output reserve")
        samples = 48
        previous_output = Decimal(0)
        previous_value = self.global_residual(self._apply(self.reserves, input_index, output_index, amount_in, 0))
        for index in range(1, samples + 1):
            output = current_output * index / samples
            value = self.global_residual(self._apply(self.reserves, input_index, output_index, amount_in, output))
            if value == 0 or (previous_value < 0 < value) or (value < 0 < previous_value):
                lo, hi = previous_output, output
                for _ in range(self._iterations):
                    middle = (lo + hi) / 2
                    middle_value = self.global_residual(
                        self._apply(self.reserves, input_index, output_index, amount_in, middle)
                    )
                    if middle_value == 0:
                        return middle
                    if (previous_value < 0 < middle_value) or (middle_value < 0 < previous_value):
                        hi = middle
                    else:
                        lo = middle
                        previous_value = middle_value
                return (lo + hi) / 2
            previous_output, previous_value = output, value
        raise SegmentationError("no physical output root under fixed tick statuses")

    def _first_root(self, lower, upper, function):
        """Bracket the first root in an interval and refine it deterministically."""
        samples = 48
        previous = lower
        previous_value = function(previous)
        for index in range(1, samples + 1):
            current = lower + (upper - lower) * index / samples
            value = function(current)
            if value == 0 or (previous_value < 0 < value) or (value < 0 < previous_value):
                lo, hi = previous, current
                for _ in range(self._iterations):
                    middle = (lo + hi) / 2
                    middle_value = function(middle)
                    if middle_value == 0:
                        return middle
                    if (previous_value < 0 < middle_value) or (middle_value < 0 < previous_value):
                        hi = middle
                    else:
                        lo = middle
                        previous_value = middle_value
                return (lo + hi) / 2
            previous, previous_value = current, value
        raise SegmentationError("no physical crossing root")

    def _assert_invariant(self):
        residual = self.global_residual()
        scale = max(Decimal(1), self.total_radius ** 2)
        # Bounded root-search accuracy, not the Decimal representation limit.
        tolerance = scale * Decimal("1e-36")
        if abs(residual) > tolerance:
            raise SegmentationError("global invariant residual exceeds reference tolerance")

    def _validate_reserves(self, reserves):
        values = tuple(_decimal(value) for value in reserves)
        if len(values) != self.n or any(value < 0 for value in values):
            raise SegmentationError("reserve vector has invalid dimensions or a negative value")
        return values

    def _validate_indices(self, input_index, output_index):
        if any(type(index) is not int or not 0 <= index < self.n for index in (input_index, output_index)):
            raise SegmentationError("asset index out of bounds")
        if input_index == output_index:
            raise SegmentationError("input and output assets must differ")

    def _apply(self, reserves, input_index, output_index, amount_in, amount_out):
        values = list(self._validate_reserves(reserves))
        if amount_out > values[output_index]:
            raise SegmentationError("output exceeds total reserve")
        values[input_index] += amount_in
        values[output_index] -= amount_out
        return values
