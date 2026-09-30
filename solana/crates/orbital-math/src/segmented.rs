//! Port of `contracts/src/math/SegmentedTorus4.sol`: a bounded tick-crossing wrapper
//! around the fixed-partition quote.
//!
//! Pure engine only: callers remain responsible for real inventory, fees, settlement,
//! range ownership and token transfers.

use ethnum::{I256, U256};

use crate::fixed::{self};
use crate::sphere;
use crate::torus::{self, State, crosses_or_touches};
use crate::{MathError, Result};

pub const MAX_TICKS: usize = 16;
pub const MAX_CROSSINGS: u32 = 8;
pub const CROSSING_SAMPLES: u32 = 48;
pub const CROSSING_ITERATIONS: u32 = 96;
pub const MAX_COMPONENT: U256 = torus::MAX_COMPONENT;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Tick {
    pub radius: U256,
    pub k: U256,
    pub is_interior: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SwapResult {
    pub state: State,
    pub reserves: [U256; 4],
    pub amount_out: U256,
    pub crossings: u32,
    pub interior_bitmap: u32,
}

/// One straight piece of a swap: the input taken and output paid while the range
/// partition is fixed. A swap that crosses planes is several segments.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Segment {
    pub amount_in: U256,
    pub amount_out: U256,
}

/// How a swap finds its roots: exactly as Solidity, or rounded to the pool's side.
trait Solver {
    fn quote(&mut self, state: &State, reserves: &[U256; 4], input: u8, output: u8, amount_in: U256)
    -> Result<U256>;

    #[allow(clippy::too_many_arguments)]
    fn boundary_root(
        &mut self,
        state: &State,
        reserves: &[U256; 4],
        input: u8,
        output: u8,
        lower: U256,
        upper: U256,
        delta: I256,
    ) -> Result<U256>;
}

/// Searches exactly like the Solidity engine.
struct Search;

impl Solver for Search {
    fn quote(&mut self, state: &State, reserves: &[U256; 4], input: u8, output: u8, amount_in: U256) -> Result<U256> {
        torus::quote_exact_in(state, reserves, input, output, amount_in)
    }

    fn boundary_root(
        &mut self,
        state: &State,
        reserves: &[U256; 4],
        input: u8,
        output: u8,
        lower: U256,
        upper: U256,
        delta: I256,
    ) -> Result<U256> {
        first_root(state, reserves, input, output, lower, upper, delta)?
            .map(|(root, _)| root)
            .ok_or(MathError::CrossingNoRoot)
    }
}

/// Searches like the Solidity engine, then moves each root at most a few wei to the
/// solvent side of the invariant (residual <= 0), which `settle::settle_swap` requires.
/// Solidity's bisection picks the closer endpoint, which is on the pool-unfavourable side
/// about half the time.
struct PoolSide;

impl Solver for PoolSide {
    fn quote(&mut self, state: &State, reserves: &[U256; 4], input: u8, output: u8, amount_in: U256) -> Result<U256> {
        let mut amount_out = torus::quote_exact_in(state, reserves, input, output, amount_in)?;
        for _ in 0..POOL_SIDE_STEPS {
            let post = apply(reserves, input, output, amount_in, amount_out)?;
            if !torus::residual(state, &post)?.is_positive() {
                return Ok(amount_out);
            }
            if amount_out == 0 {
                break;
            }
            amount_out -= 1;
        }
        Err(MathError::InvariantDrift)
    }

    fn boundary_root(
        &mut self,
        state: &State,
        reserves: &[U256; 4],
        input: u8,
        output: u8,
        lower: U256,
        upper: U256,
        delta: I256,
    ) -> Result<U256> {
        let (root, _) =
            first_root(state, reserves, input, output, lower, upper, delta)?.ok_or(MathError::CrossingNoRoot)?;
        // On the plane, input - output is fixed; step along it to the nearest solvent point.
        let mut best: Option<(U256, U256)> = None;
        let span = U256::new(POOL_SIDE_STEPS as u128);
        let from = if root > lower + span { root - span } else { lower };
        let to = if root + span < upper { root + span } else { upper };
        let mut candidate = from;
        while candidate <= to {
            if let Ok(value) = boundary_residual(state, reserves, input, output, candidate, delta) {
                let distance = if candidate > root { candidate - root } else { root - candidate };
                if !value.is_positive() && best.is_none_or(|(_, d)| distance < d) {
                    best = Some((candidate, distance));
                }
            }
            candidate += 1;
        }
        best.map(|(value, _)| value).ok_or(MathError::CrossingNoRoot)
    }
}

const POOL_SIDE_STEPS: u32 = 4;

/// Off-chain planner for Solana: the Solidity engine's swap, rounded to the pool's side,
/// as the segments `settle::settle_swap` checks on-chain. Output can be a few wei below
/// `swap_exact_in` (at most POOL_SIDE_STEPS per segment).
pub fn plan_swap(
    state: &State,
    ticks: &mut [Tick],
    reserves: &[U256; 4],
    input: u8,
    output: u8,
    amount_in: U256,
) -> Result<(SwapResult, Vec<Segment>)> {
    let mut segments = Vec::new();
    let result = swap_recording(&mut PoolSide, Some(&mut segments), state, ticks, reserves, input, output, amount_in)?;
    Ok((result, segments))
}

/// Executes an exact-input no-fee swap across at most eight tick changes. Mutates
/// `ticks` in place; the result's bitmap exposes the final statuses.
pub fn swap_exact_in(
    state: &State,
    ticks: &mut [Tick],
    reserves: &[U256; 4],
    input: u8,
    output: u8,
    amount_in: U256,
) -> Result<SwapResult> {
    swap_with(&mut Search, state, ticks, reserves, input, output, amount_in)
}

#[allow(clippy::too_many_arguments)]
fn swap_with(
    solver: &mut impl Solver,
    state: &State,
    ticks: &mut [Tick],
    reserves: &[U256; 4],
    input: u8,
    output: u8,
    amount_in: U256,
) -> Result<SwapResult> {
    swap_recording(solver, None, state, ticks, reserves, input, output, amount_in)
}

#[allow(clippy::too_many_arguments)]
fn swap_recording(
    solver: &mut impl Solver,
    mut segments: Option<&mut Vec<Segment>>,
    state: &State,
    ticks: &mut [Tick],
    reserves: &[U256; 4],
    input: u8,
    output: u8,
    amount_in: U256,
) -> Result<SwapResult> {
    validate_aggregate(state, ticks)?;
    if !torus::is_invariant(state, reserves)? {
        return Err(MathError::AggregateMismatch);
    }
    let mut state = *state;
    let mut reserves = *reserves;
    let mut remaining = amount_in;
    let mut total_out = U256::ZERO;
    let mut crossing_events: u32 = 0;

    for iteration in 0..MAX_CROSSINGS {
        if remaining == 0 {
            break;
        }
        if state.r_interior == 0 {
            return Err(MathError::AllBoundaryUnsupported);
        }
        let alpha_before = alpha_normalized(&state, &reserves)?;
        let candidate_out = solver.quote(&state, &reserves, input, output, remaining)?;
        let candidate = apply(&reserves, input, output, remaining, candidate_out)?;
        let alpha_after = alpha_normalized(&state, &candidate)?;

        // A previous trade can end exactly on a range's plane, and re-normalizing alpha under
        // the new partition can leave it a unit on either side. A range already at (or by
        // rounding past) its plane in the direction of travel flips first, with no trade.
        let settled = flip_settled(ticks, alpha_before, alpha_after)?;
        if settled != 0 {
            crossing_events += settled;
            state = aggregate(ticks)?;
            if !torus::is_invariant(&state, &reserves)? {
                return Err(MathError::AggregateMismatch);
            }
            continue;
        }

        let (crosses, lambda) = next_crossing(ticks, alpha_before, alpha_after)?;

        if !crosses {
            if let Some(segments) = segments.as_deref_mut() {
                segments.push(Segment { amount_in: remaining, amount_out: candidate_out });
            }
            reserves = candidate;
            total_out = fixed::add(total_out, candidate_out)?;
            remaining = U256::ZERO;
            break;
        }

        let (partial_in, partial_out) = if alpha_after == lambda {
            // The full quote already lands on the discrete boundary.
            (remaining, candidate_out)
        } else {
            quote_to_boundary(solver, &state, &reserves, input, output, remaining, lambda)?
        };
        if partial_in == 0 || partial_in > remaining {
            return Err(MathError::CrossingNoProgress);
        }
        if let Some(segments) = segments.as_deref_mut() {
            segments.push(Segment { amount_in: partial_in, amount_out: partial_out });
        }
        reserves = apply(&reserves, input, output, partial_in, partial_out)?;
        total_out = fixed::add(total_out, partial_out)?;
        remaining -= partial_in;
        crossing_events += flip_at_boundary(ticks, lambda, alpha_after > alpha_before)?;
        state = aggregate(ticks)?;
        if !torus::is_invariant(&state, &reserves)? {
            return Err(MathError::AggregateMismatch);
        }

        if iteration == MAX_CROSSINGS - 1 && remaining > 0 {
            return Err(MathError::TooManyCrossings);
        }
    }
    if remaining > 0 {
        return Err(MathError::TooManyCrossings);
    }
    Ok(SwapResult {
        state,
        reserves,
        amount_out: total_out,
        crossings: crossing_events,
        interior_bitmap: interior_bitmap(ticks),
    })
}

/// Rebuilds the aggregate torus state from a tick set.
pub fn aggregate(ticks: &[Tick]) -> Result<State> {
    if ticks.is_empty() || ticks.len() > MAX_TICKS {
        return Err(MathError::InvalidTickSet);
    }
    let mut state = State::default();
    for tick in ticks {
        let geometry = sphere::tick(tick.radius, tick.k)?;
        if geometry.is_degenerate {
            return Err(MathError::InvalidTickSet);
        }
        if tick.is_interior {
            state.r_interior = fixed::add(state.r_interior, tick.radius)?;
        } else {
            state.k_boundary = fixed::add(state.k_boundary, tick.k)?;
            state.s_boundary = fixed::add(state.s_boundary, geometry.boundary_radius)?;
        }
    }
    Ok(state)
}

pub fn interior_bitmap(ticks: &[Tick]) -> u32 {
    ticks.iter().enumerate().fold(0, |bitmap, (i, tick)| if tick.is_interior { bitmap | 1 << i } else { bitmap })
}

fn validate_aggregate(state: &State, ticks: &[Tick]) -> Result<()> {
    if aggregate(ticks)? != *state {
        return Err(MathError::AggregateMismatch);
    }
    Ok(())
}

pub(crate) fn alpha_normalized(state: &State, reserves: &[U256; 4]) -> Result<U256> {
    if state.r_interior == 0 {
        return Err(MathError::AllBoundaryUnsupported);
    }
    let sum = reserves.iter().try_fold(U256::ZERO, |acc, &r| fixed::add(acc, r))?;
    let alpha_total = sum / 2;
    if alpha_total < state.k_boundary {
        return Err(MathError::AggregateMismatch);
    }
    fixed::div_wad_down(alpha_total - state.k_boundary, state.r_interior)
}

pub(crate) fn plane(tick: &Tick) -> Result<U256> {
    fixed::div_wad_down(tick.k, tick.radius)
}

fn next_crossing(ticks: &[Tick], old_alpha: U256, new_alpha: U256) -> Result<(bool, U256)> {
    if new_alpha > old_alpha {
        let mut found = false;
        let mut best = U256::MAX;
        for tick in ticks.iter().filter(|t| t.is_interior) {
            let candidate = plane(tick)?;
            if candidate > old_alpha && candidate <= new_alpha && candidate < best {
                best = candidate;
                found = true;
            }
        }
        return Ok((found, best));
    }
    if new_alpha < old_alpha {
        let mut found = false;
        let mut best = U256::ZERO;
        for tick in ticks.iter().filter(|t| !t.is_interior) {
            let candidate = plane(tick)?;
            if candidate < old_alpha && candidate >= new_alpha && candidate > best {
                best = candidate;
                found = true;
            }
        }
        return Ok((found, best));
    }
    Ok((false, U256::ZERO))
}

/// Rising: interior ranges whose plane is at or below the current alpha become boundary.
/// Falling: boundary ranges whose plane is at or above it become interior.
pub(crate) fn flip_settled(ticks: &mut [Tick], old_alpha: U256, new_alpha: U256) -> Result<u32> {
    if new_alpha == old_alpha {
        return Ok(0);
    }
    let rising = new_alpha > old_alpha;
    let mut flips = 0;
    for tick in ticks.iter_mut() {
        if tick.is_interior != rising {
            continue;
        }
        let lambda = plane(tick)?;
        if if rising { lambda <= old_alpha } else { lambda >= old_alpha } {
            tick.is_interior = !rising;
            flips += 1;
        }
    }
    Ok(flips)
}

/// At alpha_int / r_int = lambda, sum(reserves) is fixed, so input - output is fixed and
/// one scalar physical root remains.
fn quote_to_boundary(
    solver: &mut impl Solver,
    state: &State,
    reserves: &[U256; 4],
    input: u8,
    output: u8,
    remaining: U256,
    lambda: U256,
) -> Result<(U256, U256)> {
    let target_alpha_interior = fixed::mul_wad_down(state.r_interior, lambda)?;
    let target_sum = fixed::mul(U256::new(2), fixed::add(target_alpha_interior, state.k_boundary)?)?;
    let current_sum = reserves.iter().try_fold(U256::ZERO, |acc, &r| fixed::add(acc, r))?;
    let int_max = I256::MAX.as_u256();
    if target_sum > int_max || current_sum > int_max {
        return Err(MathError::CrossingNoRoot);
    }
    let delta = fixed::isub(target_sum.as_i256(), current_sum.as_i256())?;
    let lower = if delta.is_positive() { delta } else { I256::ZERO };
    // output = input - delta must remain strictly below the output reserve.
    let output_room = fixed::sub(reserves[usize::from(output)], U256::ONE)?;
    if output_room > int_max || remaining > int_max {
        return Err(MathError::CrossingNoRoot);
    }
    let upper_by_reserve = fixed::iadd(output_room.as_i256(), delta)?;
    let remaining_signed = remaining.as_i256();
    let upper = if remaining_signed < upper_by_reserve { remaining_signed } else { upper_by_reserve };
    if lower.is_negative() || upper <= lower {
        return Err(MathError::CrossingNoRoot);
    }

    let root = solver.boundary_root(state, reserves, input, output, as_uint(lower)?, as_uint(upper)?, delta)?;
    let signed_out = fixed::isub(as_int(root)?, delta)?;
    if signed_out.is_negative() {
        return Err(MathError::CrossingOutputInvalid);
    }
    Ok((root, signed_out.as_u256()))
}

fn first_root(
    state: &State,
    reserves: &[U256; 4],
    input: u8,
    output: u8,
    lower: U256,
    upper: U256,
    delta: I256,
) -> Result<Option<(U256, u8)>> {
    let mut previous = lower;
    let mut previous_residual = boundary_residual(state, reserves, input, output, previous, delta)?;
    for sample in 1..=CROSSING_SAMPLES {
        let candidate = crossing_sample(lower, upper, sample)?;
        let candidate_residual = boundary_residual(state, reserves, input, output, candidate, delta)?;
        if crosses_or_touches(previous_residual, candidate_residual) {
            let root = bisect(state, reserves, input, output, previous, candidate, delta, previous_residual)?;
            return Ok(Some((root, sample as u8)));
        }
        previous = candidate;
        previous_residual = candidate_residual;
    }
    Ok(None)
}

fn crossing_sample(lower: U256, upper: U256, sample: u32) -> Result<U256> {
    let offset =
        fixed::mul_div_down(upper - lower, U256::new(u128::from(sample)), U256::new(u128::from(CROSSING_SAMPLES)))?;
    fixed::add(lower, offset)
}

#[allow(clippy::too_many_arguments)]
fn bisect(
    state: &State,
    reserves: &[U256; 4],
    input: u8,
    output: u8,
    mut low: U256,
    mut high: U256,
    delta: I256,
    mut low_residual: I256,
) -> Result<U256> {
    let mut high_residual = boundary_residual(state, reserves, input, output, high, delta)?;
    let mut i = 0;
    while i < CROSSING_ITERATIONS && low < high {
        let middle = low + (high - low) / 2;
        let middle_residual = boundary_residual(state, reserves, input, output, middle, delta)?;
        if middle_residual == I256::ZERO {
            return Ok(middle);
        }
        if crosses_or_touches(low_residual, middle_residual) {
            high = middle;
            high_residual = middle_residual;
        } else {
            low = middle;
            low_residual = middle_residual;
        }
        i += 1;
    }
    Ok(if low_residual.unsigned_abs() <= high_residual.unsigned_abs() { low } else { high })
}

fn boundary_residual(
    state: &State,
    reserves: &[U256; 4],
    input: u8,
    output: u8,
    amount_in: U256,
    delta: I256,
) -> Result<I256> {
    let signed_out = fixed::isub(as_int(amount_in)?, delta)?;
    if signed_out.is_negative() {
        return Err(MathError::CrossingOutputInvalid);
    }
    torus::residual(state, &apply(reserves, input, output, amount_in, signed_out.as_u256())?)
}

fn flip_at_boundary(ticks: &mut [Tick], lambda: U256, rising: bool) -> Result<u32> {
    let mut flips = 0;
    for tick in ticks.iter_mut() {
        if plane(tick)? != lambda {
            continue;
        }
        if rising && !tick.is_interior {
            return Err(MathError::AggregateMismatch);
        }
        if !rising && tick.is_interior {
            return Err(MathError::AggregateMismatch);
        }
        tick.is_interior = !rising;
        flips += 1;
    }
    if flips == 0 {
        return Err(MathError::InvalidTickSet);
    }
    Ok(flips)
}

pub(crate) fn apply(reserves: &[U256; 4], input: u8, output: u8, amount_in: U256, amount_out: U256) -> Result<[U256; 4]> {
    if input >= 4 || output >= 4 || input == output {
        return Err(MathError::CrossingOutputInvalid);
    }
    let (i, o) = (usize::from(input), usize::from(output));
    if amount_out >= reserves[o] || reserves[i] > fixed::sub(MAX_COMPONENT, amount_in)? {
        return Err(MathError::CrossingOutputInvalid);
    }
    let mut next = *reserves;
    next[i] += amount_in;
    next[o] -= amount_out;
    Ok(next)
}

fn as_uint(value: I256) -> Result<U256> {
    if value.is_negative() {
        return Err(MathError::CrossingNoRoot);
    }
    Ok(value.as_u256())
}

fn as_int(value: U256) -> Result<I256> {
    if value > I256::MAX.as_u256() {
        return Err(MathError::CrossingNoRoot);
    }
    Ok(value.as_i256())
}
