//! Port of `contracts/src/math/Sphere4.sol`: WAD geometry for the four-token basket.

use ethnum::{I256, U256};

use crate::fixed;
use crate::{MathError, Result};

pub const SQRT_THREE_WAD: U256 = U256::new(1_732_050_807_568_877_293);
/// sqrt_wad squares an input after a WAD conversion; this keeps it below 2^256.
pub const MAX_RADIUS: U256 = U256::new(100_000_000_000_000_000_000_000_000_000);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TickGeometry {
    pub boundary_radius: U256,
    pub minimum_reserve: U256,
    pub maximum_reserve: U256,
    pub real_reserve_at_peg: U256,
    pub capital_efficiency_wad: U256,
    pub is_degenerate: bool,
}

pub fn equal_price_reserve(radius: U256) -> Result<U256> {
    validate_radius(radius)?;
    Ok(radius / 2)
}

pub fn k_bounds(radius: U256) -> Result<(U256, U256)> {
    validate_radius(radius)?;
    Ok((radius, radius + radius / 2))
}

pub fn tick(radius: U256, k: U256) -> Result<TickGeometry> {
    let (minimum_k, maximum_k) = k_bounds(radius)?;
    if k < minimum_k || k > maximum_k {
        return Err(MathError::InvalidBoundary);
    }
    let q = radius / 2;
    if k == minimum_k {
        return Ok(TickGeometry {
            boundary_radius: U256::ZERO,
            minimum_reserve: q,
            maximum_reserve: q,
            real_reserve_at_peg: U256::ZERO,
            capital_efficiency_wad: U256::ZERO,
            is_degenerate: true,
        });
    }

    let delta = k - minimum_k;
    // s² = (k-r)(3r-k), expressed in WAD².
    let s_squared = fixed::mul_wad_down(delta, fixed::sub(fixed::mul(U256::new(2), radius)?, delta)?)?;
    let boundary_radius = fixed::sqrt_wad(s_squared)?;
    let mean = k / 2;
    let spread = fixed::mul_wad_down(boundary_radius, SQRT_THREE_WAD)? / 2;
    let denominator = fixed::add(mean, spread)?;
    // m-d is evaluated as (k_max-k)²/(m+d) to preserve tiny virtual reserves.
    let distance_to_maximum = maximum_k - k;
    let mut minimum_reserve =
        fixed::div_wad_down(fixed::mul_wad_down(distance_to_maximum, distance_to_maximum)?, denominator)?;
    let mut maximum_reserve = if denominator > radius { radius } else { denominator };
    if k == maximum_k {
        minimum_reserve = U256::ZERO;
        maximum_reserve = radius;
    }
    if minimum_reserve > q || maximum_reserve < minimum_reserve {
        return Err(MathError::InvalidBoundary);
    }
    let real_reserve_at_peg = q - minimum_reserve;
    if real_reserve_at_peg == 0 {
        return Err(MathError::InvalidBoundary);
    }
    Ok(TickGeometry {
        boundary_radius,
        minimum_reserve,
        maximum_reserve,
        real_reserve_at_peg,
        capital_efficiency_wad: fixed::div_wad_down(q, real_reserve_at_peg)?,
        is_degenerate: false,
    })
}

pub fn sphere_residual(reserves: &[U256; 4], radius: U256) -> Result<I256> {
    validate_radius(radius)?;
    let mut sum = U256::ZERO;
    for &reserve in reserves {
        if reserve > radius {
            return Err(MathError::InvalidReserve);
        }
        sum = fixed::add(sum, fixed::mul_wad_down(radius - reserve, radius - reserve)?)?;
    }
    let radius_squared = fixed::mul_wad_down(radius, radius)?;
    let difference = if sum >= radius_squared { sum - radius_squared } else { radius_squared - sum };
    if difference > I256::MAX.as_u256() {
        return Err(MathError::InvalidRadius);
    }
    let signed = difference.as_i256();
    Ok(if sum >= radius_squared { signed } else { -signed })
}

/// Infinitesimal output-token / input-token rate, before fees.
pub fn spot_rate(reserves: &[U256; 4], radius: U256, input: u8, output: u8) -> Result<U256> {
    validate_radius(radius)?;
    if input >= 4 || output >= 4 {
        return Err(MathError::InvalidAssetIndex);
    }
    if input == output {
        return Err(MathError::SameAsset);
    }
    let (i, o) = (usize::from(input), usize::from(output));
    if reserves[i] > radius || reserves[o] > radius {
        return Err(MathError::InvalidReserve);
    }
    if sphere_residual(reserves, radius)? != I256::ZERO {
        return Err(MathError::InvalidReserve);
    }
    let denominator = radius - reserves[o];
    if denominator == 0 {
        return Err(MathError::SingularRate);
    }
    fixed::div_wad_down(radius - reserves[i], denominator)
}

fn validate_radius(radius: U256) -> Result<()> {
    if radius == 0 || radius > MAX_RADIUS || radius % 2 != 0 {
        return Err(MathError::InvalidRadius);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fixed::WAD;

    #[test]
    fn degenerate_tick_at_minimum_k() {
        let r = WAD * 100;
        let g = tick(r, r).unwrap();
        assert!(g.is_degenerate);
        assert_eq!(g.minimum_reserve, r / 2);
    }

    #[test]
    fn rejects_k_outside_bounds() {
        let r = WAD * 100;
        assert_eq!(tick(r, r - 1), Err(MathError::InvalidBoundary));
        assert_eq!(tick(r, r + r / 2 + 1), Err(MathError::InvalidBoundary));
    }

    #[test]
    fn narrower_ranges_are_more_capital_efficient() {
        let r = WAD * 10_000_000;
        let tight = tick(r, r + r / 1000).unwrap();
        let wide = tick(r, r + r / 20).unwrap();
        assert!(tight.capital_efficiency_wad > wide.capital_efficiency_wad);
        // 13.08x at k/r = 1.001 (the README rounds it to 13.1x) and 2.04x at k/r = 1.05.
        assert_eq!(tight.capital_efficiency_wad / (WAD / 100), 1308);
        assert_eq!(wide.capital_efficiency_wad / (WAD / 10), 20);
    }

    #[test]
    fn equal_price_point_is_on_sphere() {
        let r = WAD * 100;
        let q = equal_price_reserve(r).unwrap();
        assert_eq!(sphere_residual(&[q; 4], r).unwrap(), I256::ZERO);
        assert_eq!(spot_rate(&[q; 4], r, 0, 1).unwrap(), WAD);
    }
}
