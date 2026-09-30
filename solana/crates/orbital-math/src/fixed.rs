//! Port of `contracts/src/math/FixedPointMath.sol`: bounded WAD arithmetic.
//!
//! Every function returns the exact value its Solidity counterpart returns, and
//! fails where the Solidity reverts. Checked `+ - *` stand in for Solidity 0.8's
//! overflow panics.

use ethnum::{I256, U256};

use crate::{MathError, Result};

pub const WAD: U256 = U256::new(1_000_000_000_000_000_000);

#[inline]
pub(crate) fn add(a: U256, b: U256) -> Result<U256> {
    a.checked_add(b).ok_or(MathError::ArithmeticOverflow)
}

#[inline]
pub(crate) fn sub(a: U256, b: U256) -> Result<U256> {
    a.checked_sub(b).ok_or(MathError::ArithmeticOverflow)
}

#[inline]
pub(crate) fn mul(a: U256, b: U256) -> Result<U256> {
    a.checked_mul(b).ok_or(MathError::ArithmeticOverflow)
}

#[inline]
pub(crate) fn iadd(a: I256, b: I256) -> Result<I256> {
    a.checked_add(b).ok_or(MathError::ArithmeticOverflow)
}

#[inline]
pub(crate) fn isub(a: I256, b: I256) -> Result<I256> {
    a.checked_sub(b).ok_or(MathError::ArithmeticOverflow)
}

pub fn mul_wad_down(x: U256, y: U256) -> Result<U256> {
    mul_div_down(x, y, WAD)
}

pub fn div_wad_down(x: U256, y: U256) -> Result<U256> {
    mul_div_down(x, WAD, y)
}

/// floor(x * y / denominator) with a 512-bit intermediate.
pub fn mul_div_down(x: U256, y: U256, denominator: U256) -> Result<U256> {
    if denominator == 0 {
        return Err(MathError::DivisionByZero);
    }
    let (low, high) = full_mul(x, y);
    if high == 0 {
        return Ok(low / denominator);
    }
    if denominator <= high {
        return Err(MathError::MulDivOverflow);
    }
    Ok(div_512_by_256(high, low, denominator))
}

/// Integer square root, rounded down: the unique floor(sqrt(x)), so it returns exactly
/// what Solidity's `FixedPointMath.sqrt` returns. Seeded from a float estimate so it
/// needs about three 256-bit divisions instead of eight, which matters on Solana.
pub fn sqrt(x: U256) -> U256 {
    if x == 0 {
        return U256::ZERO;
    }
    let seed = x.as_f64().sqrt();
    let mut z = if seed >= 1.0 { U256::new(seed as u128) } else { U256::ONE };
    // One Newton step from any positive z lands at or above floor(sqrt(x)) (AM-GM).
    z = (z + x / z) >> 1u32;
    // From above, Newton decreases monotonically to floor(sqrt(x)) and then stops.
    loop {
        let next = (z + x / z) >> 1u32;
        if next >= z {
            return z;
        }
        z = next;
    }
}

/// Solidity's original seed-and-seven-steps square root, kept to prove `sqrt` matches it.
#[cfg(test)]
pub(crate) fn sqrt_solidity(x: U256) -> U256 {
    if x == 0 {
        return U256::ZERO;
    }
    let mut z = U256::ONE;
    let mut t = x;
    for (shift, bump) in [(128u32, 64u32), (64, 32), (32, 16), (16, 8), (8, 4), (4, 2)] {
        if t >> shift > 0u128 {
            t >>= shift;
            z <<= bump;
        }
    }
    if t >> 2u32 > 0u128 {
        z <<= 1u32;
    }
    for _ in 0..7 {
        z = z.wrapping_add(x / z) >> 1u32;
    }
    let other = x / z;
    if z < other { z } else { other }
}

/// floor(sqrt(x * WAD)).
pub fn sqrt_wad(x: U256) -> Result<U256> {
    if x > U256::MAX / WAD {
        return Err(MathError::MulDivOverflow);
    }
    Ok(sqrt(x * WAD))
}

/// Full 256x256 product as (low, high) 256-bit words.
fn full_mul(x: U256, y: U256) -> (U256, U256) {
    let (x_hi, x_lo) = x.into_words();
    let (y_hi, y_lo) = y.into_words();
    let ll = U256::new(x_lo) * U256::new(y_lo);
    let lh = U256::new(x_lo) * U256::new(y_hi);
    let hl = U256::new(x_hi) * U256::new(y_lo);
    let hh = U256::new(x_hi) * U256::new(y_hi);

    let (mid, mid_carry) = lh.overflowing_add(hl);
    let (mid_hi, mid_lo) = mid.into_words();
    let (low, low_carry) = ll.overflowing_add(U256::from_words(mid_lo, 0));
    let mut high = hh + U256::new(mid_hi);
    if low_carry {
        high += U256::ONE;
    }
    if mid_carry {
        high += U256::from_words(1, 0);
    }
    (low, high)
}

/// Quotient of (high * 2^256 + low) / denominator. Requires high < denominator,
/// so the quotient fits in 256 bits.
fn div_512_by_256(high: U256, low: U256, denominator: U256) -> U256 {
    let mut remainder = high;
    let mut quotient = U256::ZERO;
    for bit in (0..256u32).rev() {
        let carry = remainder >> 255u32 == 1;
        remainder = (remainder << 1u32) | ((low >> bit) & U256::ONE);
        if carry || remainder >= denominator {
            remainder = remainder.wrapping_sub(denominator);
            quotient |= U256::ONE << bit;
        }
    }
    quotient
}

#[cfg(test)]
mod tests {
    use super::*;

    fn u(v: &str) -> U256 {
        U256::from_str_radix(v, 10).unwrap()
    }

    #[test]
    fn mul_div_matches_small_products() {
        assert_eq!(mul_div_down(u("7"), u("9"), u("4")).unwrap(), u("15"));
        assert_eq!(mul_wad_down(WAD * 3, WAD / 2).unwrap(), WAD * 3 / 2);
        assert_eq!(div_wad_down(WAD, WAD * 4).unwrap(), WAD / 4);
    }

    #[test]
    fn mul_div_uses_512_bit_intermediate() {
        // (2^255) * 6 / 3 = 2^256: overflows the result.
        let big = U256::ONE << 255u32;
        assert_eq!(mul_div_down(big, u("6"), u("3")), Err(MathError::MulDivOverflow));
        // (2^255) * 6 / 4 = 3 * 2^254: the product needs 512 bits, the result fits.
        assert_eq!(mul_div_down(big, u("6"), u("4")).unwrap(), (U256::ONE << 254u32) * 3);
        // MAX * MAX / MAX = MAX.
        assert_eq!(mul_div_down(U256::MAX, U256::MAX, U256::MAX).unwrap(), U256::MAX);
        // floor((MAX * (MAX - 1)) / MAX) = MAX - 1.
        assert_eq!(mul_div_down(U256::MAX, U256::MAX - 1, U256::MAX).unwrap(), U256::MAX - 1);
    }

    #[test]
    fn division_by_zero_fails() {
        assert_eq!(mul_div_down(U256::ONE, U256::ONE, U256::ZERO), Err(MathError::DivisionByZero));
    }

    #[test]
    fn sqrt_is_floor() {
        for v in [0u128, 1, 2, 3, 4, 15, 16, 17, 99, 100, 101, 1 << 64, (1 << 64) + 1, u128::MAX] {
            let r = sqrt(U256::new(v));
            assert!(r * r <= U256::new(v));
            assert!((r + 1) * (r + 1) > U256::new(v));
        }
        let r = sqrt(U256::MAX);
        assert_eq!(r, U256::new(u128::MAX));
    }

    #[test]
    fn sqrt_matches_solidity_algorithm() {
        let mut values = vec![U256::MAX, U256::MAX - 1, U256::ONE << 255u32];
        for bits in 0..256u32 {
            let p = U256::ONE << bits;
            values.extend([p, p - 1, p + 1]);
        }
        for r in [3u128, 1_000_000_007, u64::MAX as u128, u128::MAX] {
            let sq = U256::new(r) * U256::new(r);
            values.extend([sq - 1, sq, sq + 1]);
        }
        // xorshift over the full 256-bit range and over the WAD² ranges Orbital uses.
        let mut seed = 0x9e37_79b9_7f4a_7c15u64;
        let mut next = || {
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            seed
        };
        for _ in 0..20_000 {
            let words = [next(), next(), next(), next()];
            let x = U256::from_words(
                (u128::from(words[0]) << 64) | u128::from(words[1]),
                (u128::from(words[2]) << 64) | u128::from(words[3]),
            );
            values.push(x >> (next() % 256) as u32);
        }
        for x in values {
            assert_eq!(sqrt(x), sqrt_solidity(x), "x = {x}");
        }
    }

    #[test]
    fn sqrt_wad_rejects_overflow() {
        assert_eq!(sqrt_wad(U256::MAX), Err(MathError::MulDivOverflow));
        assert_eq!(sqrt_wad(WAD * 4).unwrap(), WAD * 2);
    }
}
