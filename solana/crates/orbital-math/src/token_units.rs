//! Port of `contracts/src/math/TokenUnits.sol`: raw token amounts <-> 18-decimal WAD.
//!
//! Decimal normalisation is not a price oracle: a depegged token is not worth $1.

use ethnum::U256;

use crate::{MathError, Result};

pub fn scale(decimals: u8) -> Result<U256> {
    if decimals > 18 {
        return Err(MathError::UnsupportedDecimals);
    }
    Ok(U256::new(10u128.pow(u32::from(18 - decimals))))
}

/// Exact conversion. Rejects values that cannot be represented in WAD.
pub fn to_wad(raw: U256, decimals: u8) -> Result<U256> {
    let factor = scale(decimals)?;
    if raw > U256::MAX / factor {
        return Err(MathError::AmountOverflow);
    }
    Ok(raw * factor)
}

/// Rounds token payouts down; the caller accounts for retained dust.
pub fn from_wad_down(wad: U256, decimals: u8) -> Result<U256> {
    Ok(wad / scale(decimals)?)
}

/// Rounds required token inputs up.
pub fn from_wad_up(wad: U256, decimals: u8) -> Result<U256> {
    let factor = scale(decimals)?;
    Ok(wad / factor + if wad % factor == 0 { U256::ZERO } else { U256::ONE })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn six_decimals_round_trip_and_rounding() {
        let one_usdc = U256::new(1_000_000);
        let wad = to_wad(one_usdc, 6).unwrap();
        assert_eq!(wad, U256::new(1_000_000_000_000_000_000));
        assert_eq!(from_wad_down(wad + 1, 6).unwrap(), one_usdc);
        assert_eq!(from_wad_up(wad + 1, 6).unwrap(), one_usdc + 1);
        assert_eq!(from_wad_up(wad, 6).unwrap(), one_usdc);
    }

    #[test]
    fn rejects_more_than_18_decimals() {
        assert_eq!(scale(19), Err(MathError::UnsupportedDecimals));
    }

    #[test]
    fn rejects_overflow() {
        assert_eq!(to_wad(U256::MAX, 6), Err(MathError::AmountOverflow));
    }
}
