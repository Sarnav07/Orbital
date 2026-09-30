//! Port of `contracts/src/liquidity/RangeFeeBook4.sol` as plain state transitions.
//!
//! Per-range LP share ledger with per-share fee checkpoints and explicit rounding dust.
//! Growth is Q128 per share so six-decimal raw fees stay claimable against WAD-scale
//! share supplies. Storage (who owns which range and position) is the caller's job; on
//! Solana these structs live in the pool and position accounts.

use ethnum::U256;

use crate::fixed;
use crate::{MathError, Result};

pub const Q128: U256 = U256::from_words(1, 0);

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct RangeFees {
    pub total_shares: U256,
    pub growth: [U256; 4],
    pub dust: [U256; 4],
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct PositionFees {
    pub shares: U256,
    pub debt: [U256; 4],
    pub claimable: [U256; 4],
}

pub fn mint(range: &mut RangeFees, position: &mut PositionFees, shares: U256) -> Result<()> {
    checkpoint(range, position)?;
    range.total_shares = fixed::add(range.total_shares, shares)?;
    position.shares = fixed::add(position.shares, shares)?;
    set_debt(range, position)
}

pub fn burn(range: &mut RangeFees, position: &mut PositionFees, shares: U256) -> Result<()> {
    if shares > position.shares {
        return Err(MathError::InsufficientShares);
    }
    checkpoint(range, position)?;
    position.shares -= shares;
    range.total_shares = fixed::sub(range.total_shares, shares)?;
    set_debt(range, position)
}

/// Allocates a settled fee amount over the ranges that took part in one swap segment.
/// `ranges[i]` is credited in proportion to `weights[i]`; the allocation remainder is
/// deterministic dust on `ranges[0]`.
pub fn accrue(ranges: &mut [&mut RangeFees], weights: &[U256], fees: &[U256; 4]) -> Result<()> {
    if ranges.is_empty() || ranges.len() != weights.len() {
        return Err(MathError::InvalidWeights);
    }
    let total_weight = weights.iter().try_fold(U256::ZERO, |acc, &w| fixed::add(acc, w))?;
    if total_weight == 0 {
        return Err(MathError::InvalidWeights);
    }
    for (range, &weight) in ranges.iter_mut().zip(weights) {
        let supply = range.total_shares;
        if supply == 0 {
            return Err(MathError::InvalidWeights);
        }
        for asset in 0..4 {
            let allocated = fixed::mul_div_down(fees[asset], weight, total_weight)?;
            let growth_delta = fixed::mul_div_down(allocated, Q128, supply)?;
            let credited = fixed::mul_div_down(growth_delta, supply, Q128)?;
            range.growth[asset] = fixed::add(range.growth[asset], growth_delta)?;
            range.dust[asset] = fixed::add(range.dust[asset], allocated - credited)?;
        }
    }
    for asset in 0..4 {
        let mut allocated_total = U256::ZERO;
        for &weight in weights {
            allocated_total = fixed::add(allocated_total, fixed::mul_div_down(fees[asset], weight, total_weight)?)?;
        }
        ranges[0].dust[asset] = fixed::add(ranges[0].dust[asset], fees[asset] - allocated_total)?;
    }
    Ok(())
}

/// Clears and returns an owner's checkpointed claim for one range.
pub fn collect(range: &RangeFees, position: &mut PositionFees) -> Result<[U256; 4]> {
    checkpoint(range, position)?;
    let amounts = position.claimable;
    position.claimable = [U256::ZERO; 4];
    set_debt(range, position)?;
    Ok(amounts)
}

fn checkpoint(range: &RangeFees, position: &mut PositionFees) -> Result<()> {
    for asset in 0..4 {
        let accrued = fixed::mul_div_down(position.shares, range.growth[asset], Q128)?;
        let owed = fixed::sub(accrued, position.debt[asset])?;
        position.claimable[asset] = fixed::add(position.claimable[asset], owed)?;
    }
    Ok(())
}

fn set_debt(range: &RangeFees, position: &mut PositionFees) -> Result<()> {
    for asset in 0..4 {
        position.debt[asset] = fixed::mul_div_down(position.shares, range.growth[asset], Q128)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fees_split_by_shares_and_collect_once() {
        let mut range = RangeFees::default();
        let mut alice = PositionFees::default();
        let mut bob = PositionFees::default();
        // Power-of-two supply keeps Q128 growth exact, so the split is easy to check.
        mint(&mut range, &mut alice, U256::new(3_072)).unwrap();
        mint(&mut range, &mut bob, U256::new(1_024)).unwrap();

        accrue(&mut [&mut range], &[U256::ONE], &[U256::new(400), U256::ZERO, U256::ZERO, U256::new(7)]).unwrap();

        let a = collect(&range, &mut alice).unwrap();
        let b = collect(&range, &mut bob).unwrap();
        assert_eq!(a[0], U256::new(300));
        assert_eq!(b[0], U256::new(100));
        // 7 split 3:1 floors to 5 and 1; the lost unit stays in the pool.
        assert_eq!((a[3], b[3]), (U256::new(5), U256::new(1)));
        assert_eq!(collect(&range, &mut alice).unwrap(), [U256::ZERO; 4]);
    }

    #[test]
    fn late_minter_earns_nothing_from_earlier_fees() {
        let mut range = RangeFees::default();
        let mut early = PositionFees::default();
        let mut late = PositionFees::default();
        mint(&mut range, &mut early, U256::new(1_000)).unwrap();
        accrue(&mut [&mut range], &[U256::ONE], &[U256::new(500), U256::ZERO, U256::ZERO, U256::ZERO]).unwrap();
        mint(&mut range, &mut late, U256::new(1_000)).unwrap();
        assert_eq!(collect(&range, &mut late).unwrap()[0], U256::ZERO);
        assert_eq!(collect(&range, &mut early).unwrap()[0], U256::new(500));
    }

    #[test]
    fn burn_more_than_owned_fails() {
        let mut range = RangeFees::default();
        let mut p = PositionFees::default();
        mint(&mut range, &mut p, U256::new(10)).unwrap();
        assert_eq!(burn(&mut range, &mut p, U256::new(11)), Err(MathError::InsufficientShares));
    }
}
