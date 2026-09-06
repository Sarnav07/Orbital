"""Sphere/plane projection model derived from Paradigm's Orbital paper.

Amounts are decimal token quantities, not Solidity WAD integers. No swap,
crossing, LP accounting or fee logic is implemented here.
"""

from dataclasses import dataclass
from decimal import Context, Decimal, InvalidOperation, localcontext
from fractions import Fraction
from functools import wraps


class GeometryError(ValueError):
    """Input is outside the supported mathematical domain."""


def _decimal(value):
    if isinstance(value, bool) or not isinstance(value, (Decimal, int, str)):
        raise GeometryError("use a Decimal, integer or decimal string, not a float")
    try:
        result = Decimal(value)
    except InvalidOperation as error:
        raise GeometryError("invalid decimal") from error
    if not result.is_finite():
        raise GeometryError("value must be finite")
    return result


def _isolated(method):
    @wraps(method)
    def run(self, *args, **kwargs):
        # A fresh Context also isolates rounding/traps from the caller's context.
        with localcontext(Context(prec=self.precision)):
            return method(self, *args, **kwargs)
    return run


@dataclass(frozen=True)
class TickGeometry:
    k: Decimal
    normalized_boundary: Fraction
    boundary_radius: Decimal
    minimum_reserve: Decimal
    maximum_reserve: Decimal
    real_reserve_at_peg: Decimal
    capital_efficiency: Decimal | None


@dataclass(frozen=True)
class Geometry:
    n: int
    radius: Decimal
    precision: int = 80

    def __post_init__(self):
        if type(self.n) is not int or self.n < 2:
            raise GeometryError("asset count must be an integer >= 2")
        if type(self.precision) is not int or self.precision < 32:
            raise GeometryError("precision must be an integer >= 32 digits")
        radius = _decimal(self.radius)
        if radius <= 0:
            raise GeometryError("radius must be positive")
        object.__setattr__(self, "radius", radius)

    @_isolated
    def equal_price_reserve(self):
        """Return q, the mathematical reserve of each asset at equal prices."""
        return self.radius * (1 - 1 / Decimal(self.n).sqrt())

    @_isolated
    def k_bounds(self):
        """Inclusive analytical bounds; the lower endpoint is degenerate."""
        root_n = Decimal(self.n).sqrt()
        return (self.radius * (root_n - 1), self.radius * (self.n - 1) / root_n)

    @_isolated
    def tick(self, k):
        """Return reserve bounds and peg concentration for a sphere cap.

        k is the diagonal projection, NOT the sum of reserves. Endpoints are
        interpreted at this model's precision. Supply k_bounds() values for
        exact endpoints. Increase precision if a very narrow cap is unresolved.
        """
        k = _decimal(k)
        low, high = self.k_bounds()
        if not low <= k <= high:
            raise GeometryError("k is outside the sphere's tick bounds")
        q = self.equal_price_reserve()
        identity = Fraction(k) / Fraction(self.radius)
        if k == low:
            return TickGeometry(k, identity, Decimal(0), q, q, Decimal(0), None)
        root_n = Decimal(self.n).sqrt()
        # Factorization avoids subtracting nearly equal squared quantities
        # near the zero-width cap: s^2 = (k-k_min)*(2r-(k-k_min)).
        delta = k - low
        boundary_radius = (delta * (2 * self.radius - delta)).sqrt()
        mean = k / root_n
        spread = (Decimal(self.n - 1) / self.n).sqrt() * boundary_radius
        # Rationalize m-d near k_max, where direct subtraction loses the tiny
        # virtual offset. Algebraically m^2-d^2 = (k_max-k)^2.
        minimum = (high - k) ** 2 / (mean + spread)
        maximum = min(self.radius, mean + spread)
        if k == high:
            minimum, maximum = Decimal(0), self.radius
        real = q - minimum
        if minimum < 0 or real <= 0 or maximum < minimum:
            raise ArithmeticError("tick geometry unresolved; increase precision")
        return TickGeometry(k, identity, boundary_radius, minimum, maximum, real, q / real)

    @_isolated
    def k_from_single_depeg(self, price):
        """Boundary for one relative price in [0,1], others equal to one.

        This is not a price-floor promise for arbitrary multi-asset states.
        """
        price = _decimal(price)
        if not 0 <= price <= 1:
            raise GeometryError("single-depeg price must lie in [0,1]")
        if price == 1:
            return self.k_bounds()[0]
        root_n = Decimal(self.n).sqrt()
        result = self.radius * (
            root_n - (price + self.n - 1) / (self.n * (price * price + self.n - 1)).sqrt()
        )
        if self.n == 2 and price == 0:
            return self.k_bounds()[1]
        if result <= self.k_bounds()[0]:
            raise ArithmeticError("depeg boundary unresolved; increase precision")
        return result

    def _reserves(self, reserves):
        values = tuple(_decimal(x) for x in reserves)
        if len(values) != self.n:
            raise GeometryError("reserve vector length must match asset count")
        if any(x < 0 or x > self.radius for x in values):
            raise GeometryError("reserves must lie on the nonnegative-price branch [0,r]")
        return values

    @_isolated
    def sphere_residual(self, reserves):
        """Signed squared-unit residual; zero for an exact sphere state."""
        values = self._reserves(reserves)
        return sum((self.radius - x) ** 2 for x in values) - self.radius ** 2

    @_isolated
    def polar(self, reserves):
        """Return alpha and orthogonal vector w, also for off-sphere diagnostics."""
        values = self._reserves(reserves)
        mean = sum(values) / self.n
        return sum(values) / Decimal(self.n).sqrt(), tuple(x - mean for x in values)

    @_isolated
    def spot_rate(self, reserves, input_index, output_index):
        """Infinitesimal output/input rate, no fees, on a valid sphere state.

        Sphere validation allows r^2 * 10^(-(precision-10)) absolute residual
        for Decimal rounding. This is NOT a contract settlement tolerance.
        """
        if any(type(i) is not int or not 0 <= i < self.n for i in (input_index, output_index)):
            raise GeometryError("asset index out of bounds")
        if input_index == output_index:
            raise GeometryError("input and output assets must differ")
        values = self._reserves(reserves)
        tolerance = self.radius ** 2 * Decimal(10) ** (10 - self.precision)
        if abs(self.sphere_residual(values)) > tolerance:
            raise GeometryError("reserve state is not on the sphere")
        denominator = self.radius - values[output_index]
        if denominator == 0:
            raise GeometryError("singular output price")
        return (self.radius - values[input_index]) / denominator
