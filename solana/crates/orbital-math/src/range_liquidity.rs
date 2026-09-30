//! Port of `contracts/src/math/RangeLiquidity4.sol`: per-range inventory attribution
//! and proportional-share accounting. Virtual offsets are never included in
//! `real_inventory` or LP withdrawals.

use ethnum::U256;

use crate::fixed;
use crate::segmented::{MAX_TICKS, Tick};
use crate::sphere;
use crate::torus::{self, State};
use crate::{MathError, Result};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Attribution {
    pub virtual_offset: U256,
    pub coordinates: [U256; 4],
    pub real_inventory: [U256; 4],
    pub is_interior: bool,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ShareState {
    pub total_shares: U256,
    pub real_inventory: [U256; 4],
}

/// Reconstructs every range's current coordinate and redeemable inventory, one entry per
/// tick. Interior ranges get the common centered direction in radius proportion; boundary
/// ranges in boundary-radius proportion. Integer division rounds down, leaving bounded
/// unassigned dust that callers account for separately from LP claims.
pub fn attribute(state: &State, ticks: &[Tick], reserves: &[U256; 4]) -> Result<Vec<Attribution>> {
    validate_aggregate(state, ticks, reserves)?;
    let mut ranges = vec![Attribution::default(); ticks.len()];

    let sum = reserves.iter().try_fold(U256::ZERO, |acc, &r| fixed::add(acc, r))?;
    let mean = sum / 4;
    let alpha_interior = fixed::sub(sum / 2, state.k_boundary)?;
    let w_norm = w_norm(reserves, mean)?;
    if w_norm < state.s_boundary {
        return Err(MathError::AttributionUnavailable);
    }
    let interior_w_norm = w_norm - state.s_boundary;

    for (range, tick) in ranges.iter_mut().zip(ticks) {
        let geometry = sphere::tick(tick.radius, tick.k)?;
        if geometry.is_degenerate {
            return Err(MathError::InvalidRangeSet);
        }
        range.virtual_offset = geometry.minimum_reserve;
        range.is_interior = tick.is_interior;

        let (alpha_part, direction_numerator) = if tick.is_interior {
            if state.r_interior == 0 {
                return Err(MathError::AttributionUnavailable);
            }
            (
                fixed::mul_div_down(alpha_interior, tick.radius, state.r_interior)?,
                fixed::mul_div_down(interior_w_norm, tick.radius, state.r_interior)?,
            )
        } else {
            (tick.k, geometry.boundary_radius)
        };
        let direction_denominator = w_norm;

        for asset in 0..4 {
            let mut coordinate = alpha_part / 2;
            if w_norm != 0 && direction_numerator != 0 {
                let above = reserves[asset] >= mean;
                let deviation = if above { reserves[asset] - mean } else { mean - reserves[asset] };
                let directional = fixed::mul_div_down(deviation, direction_numerator, direction_denominator)?;
                coordinate = if above {
                    fixed::add(coordinate, directional)?
                } else {
                    fixed::sub(coordinate, directional)?
                };
            }
            if coordinate < geometry.minimum_reserve {
                return Err(MathError::NegativeRealInventory);
            }
            range.coordinates[asset] = coordinate;
            range.real_inventory[asset] = coordinate - geometry.minimum_reserve;
        }
    }
    Ok(ranges)
}

/// Creates the first claim over a range's already-attributed real inventory.
pub fn bootstrap(real_inventory: &[U256; 4], shares: U256) -> Result<ShareState> {
    if shares == 0 {
        return Err(MathError::ZeroShares);
    }
    if real_inventory.iter().any(|&amount| amount == 0) {
        return Err(MathError::InvalidBootstrap);
    }
    Ok(ShareState { total_shares: shares, real_inventory: *real_inventory })
}

/// Mints shares only for an exact proportional addition to this range.
pub fn add_proportional(position: &ShareState, amounts: &[U256; 4]) -> Result<(ShareState, U256)> {
    if position.total_shares == 0 {
        return Err(MathError::ZeroShares);
    }
    if position.real_inventory[0] == 0 {
        return Err(MathError::InvalidBootstrap);
    }
    let minted = fixed::mul_div_down(amounts[0], position.total_shares, position.real_inventory[0])?;
    if minted == 0 {
        return Err(MathError::ZeroShares);
    }
    let mut next = ShareState::default();
    for i in 0..4 {
        if amounts[i] != fixed::mul_div_down(position.real_inventory[i], minted, position.total_shares)? {
            return Err(MathError::NonProportionalDeposit);
        }
        next.real_inventory[i] = fixed::add(position.real_inventory[i], amounts[i])?;
    }
    next.total_shares = fixed::add(position.total_shares, minted)?;
    Ok((next, minted))
}

/// Burns a range-specific share claim and returns only that range's real inventory.
pub fn remove_proportional(position: &ShareState, shares: U256) -> Result<(ShareState, [U256; 4])> {
    if shares == 0 {
        return Err(MathError::ZeroShares);
    }
    if shares > position.total_shares {
        return Err(MathError::InsufficientShares);
    }
    let mut next = ShareState::default();
    let mut amounts_out = [U256::ZERO; 4];
    for i in 0..4 {
        amounts_out[i] = if shares == position.total_shares {
            position.real_inventory[i]
        } else {
            fixed::mul_div_down(position.real_inventory[i], shares, position.total_shares)?
        };
        next.real_inventory[i] = position.real_inventory[i] - amounts_out[i];
    }
    next.total_shares = position.total_shares - shares;
    Ok((next, amounts_out))
}

fn validate_aggregate(state: &State, ticks: &[Tick], reserves: &[U256; 4]) -> Result<()> {
    if ticks.is_empty() || ticks.len() > MAX_TICKS || !torus::is_invariant(state, reserves)? {
        return Err(MathError::AggregateMismatch);
    }
    let mut aggregate = State::default();
    for tick in ticks {
        let geometry = sphere::tick(tick.radius, tick.k)?;
        if geometry.is_degenerate {
            return Err(MathError::InvalidRangeSet);
        }
        if tick.is_interior {
            aggregate.r_interior = fixed::add(aggregate.r_interior, tick.radius)?;
        } else {
            aggregate.k_boundary = fixed::add(aggregate.k_boundary, tick.k)?;
            aggregate.s_boundary = fixed::add(aggregate.s_boundary, geometry.boundary_radius)?;
        }
    }
    if aggregate != *state {
        return Err(MathError::AggregateMismatch);
    }
    Ok(())
}

fn w_norm(reserves: &[U256; 4], mean: U256) -> Result<U256> {
    let mut sum_squares = U256::ZERO;
    for &reserve in reserves {
        let deviation = if reserve >= mean { reserve - mean } else { mean - reserve };
        sum_squares = fixed::add(sum_squares, fixed::mul_wad_down(deviation, deviation)?)?;
    }
    fixed::sqrt_wad(sum_squares)
}
