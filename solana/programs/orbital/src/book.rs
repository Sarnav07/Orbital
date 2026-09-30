//! Pool logic ported from `contracts/src/OrbitalV4Hook.sol`, minus the v4 plumbing.
//! Token transfers happen in the instruction handlers; this module only updates the pool.

use anchor_lang::prelude::*;
use orbital_math::fee_book::{self, PositionFees, RangeFees};
use orbital_math::range_liquidity::attribute;
use orbital_math::segmented::{Segment, Tick};
use orbital_math::settle::settle_swap;
use orbital_math::torus::{self, State};
use orbital_math::{U256, fixed, sphere, token_units};

use crate::error::{OrbitalError, math};
use crate::state::{Pool, put_u128, u128_of};

pub const FEE_DENOMINATOR: u32 = 1_000_000;
/// Shares locked forever in every range at seed, as `MIN_LOCKED_SHARES` in Solidity.
pub const MIN_LOCKED_SHARES: U256 = U256::new(1_000_000_000);

pub fn virtual_offsets(ticks: &[Tick]) -> Result<U256> {
    let mut total = U256::ZERO;
    for tick in ticks {
        let minimum = sphere::tick(tick.radius, tick.k).map_err(math)?.minimum_reserve;
        total = total.checked_add(minimum).ok_or(error!(OrbitalError::ValueTooLarge))?;
    }
    Ok(total)
}

pub fn require_inventory(reserves: &[U256; 4], virtual_sum: U256) -> Result<()> {
    require!(reserves.iter().all(|&r| r >= virtual_sum), OrbitalError::InsufficientInventory);
    Ok(())
}

/// Raw tokens the pool must hold for coordinate `reserve` (rounded up).
pub fn required_raw(reserve: U256, virtual_sum: U256, decimals: u8) -> Result<U256> {
    token_units::from_wad_up(reserve - virtual_sum, decimals).map_err(math)
}

pub fn seed_amounts(pool: &Pool) -> Result<[U256; 4]> {
    let reserves = pool.reserves();
    let virtual_sum = u128_of(&pool.virtual_sum);
    let mut amounts = [U256::ZERO; 4];
    for i in 0..4 {
        amounts[i] = required_raw(reserves[i], virtual_sum, pool.decimals[i])?;
    }
    Ok(amounts)
}

pub struct SwapOutcome {
    pub amount_out: u64,
    pub fee: u64,
    pub crossings: u32,
}

/// Settles a planned exact-input swap against the book: takes the fee on input, checks
/// the segments, pays out rounded down, and credits the fee to ranges that were interior
/// when the swap started.
pub fn swap(pool: &mut Pool, input: u8, output: u8, amount_in: u64, segments: &[Segment]) -> Result<SwapOutcome> {
    require!(pool.seeded == 1, OrbitalError::NotSeeded);
    require!(input < 4 && output < 4 && input != output, OrbitalError::InvalidAsset);
    let (i, o) = (usize::from(input), usize::from(output));
    let amount = U256::new(u128::from(amount_in));
    let fee_ppm = U256::new(u128::from(pool.fee_ppm()));
    let denominator = U256::new(u128::from(FEE_DENOMINATOR));
    let fee = (amount * fee_ppm + denominator - 1) / denominator;
    require!(amount > fee, OrbitalError::ZeroAmount);

    let mut ticks = pool.ticks();
    let interior_before = u16::from_le_bytes(pool.interior_bitmap);
    let state = pool.state()?;
    let wad_in = token_units::to_wad(amount - fee, pool.decimals[i]).map_err(math)?;
    let result = settle_swap(&state, &mut ticks, &pool.reserves(), input, output, wad_in, segments).map_err(math)?;
    let amount_out = token_units::from_wad_down(result.amount_out, pool.decimals[o]).map_err(math)?;
    require_inventory(&result.reserves, u128_of(&pool.virtual_sum))?;

    pool.set_reserves(&result.reserves)?;
    pool.set_ticks(&ticks)?;
    if fee > 0u128 {
        accrue_fee(pool, i, fee, interior_before)?;
    }
    Ok(SwapOutcome { amount_out: crate::state::to_u64(amount_out)?, fee: crate::state::to_u64(fee)?, crossings: result.crossings })
}

/// Splits a raw input-token fee across ranges that were interior when the swap started,
/// weighted by radius. With no interior range the fee stays in custody as unowed dust.
fn accrue_fee(pool: &mut Pool, asset: usize, fee: U256, interior_mask: u16) -> Result<()> {
    let count = usize::from(pool.range_count);
    let ids: Vec<usize> = (0..count).filter(|i| interior_mask & (1 << i) != 0).collect();
    if ids.is_empty() {
        return Ok(());
    }
    let weights: Vec<U256> = ids.iter().map(|&i| u128_of(&pool.radius[i])).collect();
    let mut ranges: Vec<RangeFees> = ids.iter().map(|&i| pool.range_fees(i)).collect();
    let mut fees = [U256::ZERO; 4];
    fees[asset] = fee;
    let mut refs: Vec<&mut RangeFees> = ranges.iter_mut().collect();
    fee_book::accrue(&mut refs, &weights, &fees).map_err(math)?;
    for (&id, range) in ids.iter().zip(&ranges) {
        pool.set_range_fees(id, range)?;
    }
    let owed = pool.fee_liability(asset) + fee;
    pool.set_fee_liability(asset, owed)
}

pub struct RangeChange {
    pub radius: U256,
    pub k: U256,
    pub reserves: [U256; 4],
    pub virtual_sum: U256,
    pub amounts: [U256; 4],
}

/// Scales one range's radius and k by the share ratio (k/r fixed) and moves its
/// coordinate by the same ratio. Rounding favours the pool: additions round the radius
/// and coordinate up, removals round them down.
pub fn preview_range_change(pool: &Pool, range: usize, shares: U256, adding: bool) -> Result<RangeChange> {
    require!(pool.seeded == 1, OrbitalError::NotSeeded);
    require!(range < usize::from(pool.range_count), OrbitalError::InvalidRange);
    require!(shares > 0u128, OrbitalError::ZeroAmount);
    let supply = u128_of(&pool.total_shares[range]);
    require!(adding || shares < supply, OrbitalError::InsufficientShares);

    let mut ticks = pool.ticks();
    let state = pool.state()?;
    let reserves = pool.reserves();
    let radius = ticks[range].radius;
    let k = ticks[range].k;
    let coordinates = attribute(&state, &ticks, &reserves).map_err(math)?[range].coordinates;

    let (radius_delta, new_radius) = if adding {
        let mut delta = mul_div_up(radius, shares, supply)?;
        delta += delta % 2;
        (delta, radius + delta)
    } else {
        let mut delta = fixed::mul_div_down(radius, shares, supply).map_err(math)?;
        delta -= delta % 2;
        require!(delta < radius, OrbitalError::InvalidRange);
        (delta, radius - delta)
    };
    let new_k = fixed::mul_div_down(k, new_radius, radius).map_err(math)?;
    ticks[range].radius = new_radius;
    ticks[range].k = new_k;

    let mut next = [U256::ZERO; 4];
    for i in 0..4 {
        next[i] = if adding {
            reserves[i] + mul_div_up(coordinates[i], radius_delta, radius)?
        } else {
            reserves[i] - fixed::mul_div_down(coordinates[i], radius_delta, radius).map_err(math)?
        };
    }
    let next_state: State = orbital_math::segmented::aggregate(&ticks).map_err(math)?;
    require!(torus::is_invariant(&next_state, &next).map_err(math)?, OrbitalError::InvariantViolation);
    let virtual_sum = virtual_offsets(&ticks)?;
    require_inventory(&next, virtual_sum)?;

    let old_virtual = u128_of(&pool.virtual_sum);
    let mut amounts = [U256::ZERO; 4];
    for i in 0..4 {
        let before = required_raw(reserves[i], old_virtual, pool.decimals[i])?;
        let after = required_raw(next[i], virtual_sum, pool.decimals[i])?;
        amounts[i] = if adding {
            if after > before { after - before } else { U256::ZERO }
        } else if before > after {
            before - after
        } else {
            U256::ZERO
        };
    }
    Ok(RangeChange { radius: new_radius, k: new_k, reserves: next, virtual_sum, amounts })
}

pub fn apply_range_change(pool: &mut Pool, range: usize, change: &RangeChange) -> Result<()> {
    pool.radius[range] = put_u128(change.radius)?;
    pool.k[range] = put_u128(change.k)?;
    pool.set_reserves(&change.reserves)?;
    pool.virtual_sum = put_u128(change.virtual_sum)?;
    Ok(())
}

pub fn mint_shares(pool: &mut Pool, range: usize, position: &mut PositionFees, shares: U256) -> Result<()> {
    let mut fees = pool.range_fees(range);
    fee_book::mint(&mut fees, position, shares).map_err(math)?;
    pool.set_range_fees(range, &fees)
}

pub fn burn_shares(pool: &mut Pool, range: usize, position: &mut PositionFees, shares: U256) -> Result<()> {
    let mut fees = pool.range_fees(range);
    fee_book::burn(&mut fees, position, shares).map_err(|_| error!(OrbitalError::InsufficientShares))?;
    pool.set_range_fees(range, &fees)
}

pub fn collect(pool: &mut Pool, range: usize, position: &mut PositionFees) -> Result<[U256; 4]> {
    let fees = pool.range_fees(range);
    let amounts = fee_book::collect(&fees, position).map_err(math)?;
    for (asset, amount) in amounts.iter().enumerate() {
        let owed = pool.fee_liability(asset);
        require!(owed >= *amount, OrbitalError::InsufficientInventory);
        pool.set_fee_liability(asset, owed - *amount)?;
    }
    Ok(amounts)
}

fn mul_div_up(x: U256, y: U256, denominator: U256) -> Result<U256> {
    let down = fixed::mul_div_down(x, y, denominator).map_err(math)?;
    // x * y fits in 256 bits in this domain (values below 2^100); check rather than assume.
    let product = x.checked_mul(y).ok_or(error!(OrbitalError::ValueTooLarge))?;
    Ok(if product % denominator != 0u128 { down + 1 } else { down })
}
