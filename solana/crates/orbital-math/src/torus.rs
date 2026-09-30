//! Port of `contracts/src/math/Torus4.sol`: the fixed-partition aggregate invariant
//! and its bounded exact-input quote solver.
//!
//! Tick crossing is outside this module: a caller must split a trade before a range
//! changes between interior and boundary states (see `segmented`).

use ethnum::{I256, U256};

use crate::fixed::{self, WAD};
use crate::{MathError, Result};

pub const MAX_COMPONENT: U256 = U256::new(100_000_000_000_000_000_000_000_000_000);
pub const ROOT_SAMPLES: u32 = 48;
pub const ROOT_ITERATIONS: u32 = 96;
/// Solver acceptance rule, in WAD relative residual units (1e-9).
pub const MAX_RELATIVE_DRIFT_WAD: U256 = U256::new(1_000_000_000);

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct State {
    /// Sum of radii of all interior ranges.
    pub r_interior: U256,
    /// Sum of plane projections k for boundary ranges.
    pub k_boundary: U256,
    /// Sum of boundary-sphere radii s for boundary ranges.
    pub s_boundary: U256,
}

/// Signed torus LHS minus r_interior², in WAD-squared token units.
pub fn residual(state: &State, reserves: &[U256; 4]) -> Result<I256> {
    residual_parts(state, reserves).map(|parts| parts.residual)
}

/// The residual with the two coordinates it is built from, which also locate the point
/// on the torus's cross-section circle.
#[derive(Clone, Copy, Debug)]
pub struct ResidualParts {
    pub residual: I256,
    /// Σx/2 minus the boundary ranges' k.
    pub alpha_interior: U256,
    /// Norm of the reserve vector's component orthogonal to the equal-price direction.
    pub w_norm: U256,
}

pub fn residual_parts(state: &State, reserves: &[U256; 4]) -> Result<ResidualParts> {
    validate_state(state)?;
    let (sum, sum_squares) = reserve_sums(reserves)?;
    let alpha_total = sum / 2;
    if alpha_total < state.k_boundary {
        return Err(MathError::InvalidState);
    }
    let alpha_interior = alpha_total - state.k_boundary;
    // ||w||² = Σxᵢ² - (Σxᵢ)²/n. Saturate the one-unit negative a floored quotient can produce.
    let projection_squares = fixed::mul_div_down(sum, sum, WAD * 4)?;
    let centered_squares =
        if sum_squares > projection_squares { sum_squares - projection_squares } else { U256::ZERO };
    let w_norm = fixed::sqrt_wad(centered_squares)?;
    let radial_target = fixed::mul(state.r_interior, U256::new(2))?;
    let first = abs_diff(alpha_interior, radial_target);
    let second = abs_diff(w_norm, state.s_boundary);
    let lhs = fixed::add(fixed::mul_wad_down(first, first)?, fixed::mul_wad_down(second, second)?)?;
    let rhs = fixed::mul_wad_down(state.r_interior, state.r_interior)?;
    Ok(ResidualParts { residual: signed_difference(lhs, rhs)?, alpha_interior, w_norm })
}

/// Whether a state is within the solver's bounded drift rule.
pub fn is_invariant(state: &State, reserves: &[U256; 4]) -> Result<bool> {
    invariant_from_residual(state, residual(state, reserves)?)
}

/// Exact-input quote while the interior/boundary partition is fixed. Finds the first
/// positive output root by scanning then bisecting a bounded interval, and rejects a
/// quote whose post-trade residual exceeds MAX_RELATIVE_DRIFT_WAD.
pub fn quote_exact_in(state: &State, reserves: &[U256; 4], input: u8, output: u8, amount_in: U256) -> Result<U256> {
    let (i, o) = check_quote(state, reserves, input, output, amount_in)?;
    let maximum_output = reserves[o] - 1;
    let mut previous_residual = post_trade_residual(state, reserves, i, o, amount_in, U256::ZERO)?;
    let mut previous_output = U256::ZERO;

    for sample in 1..=ROOT_SAMPLES {
        let candidate_output = sample_point(maximum_output, sample)?;
        let candidate_residual = post_trade_residual(state, reserves, i, o, amount_in, candidate_output)?;
        if crosses_or_touches(previous_residual, candidate_residual) {
            let amount_out =
                bisect(state, reserves, i, o, amount_in, previous_output, candidate_output, previous_residual)?;
            let final_reserves = apply(reserves, i, o, amount_in, amount_out)?;
            if !is_invariant(state, &final_reserves)? {
                return Err(MathError::InvariantDrift);
            }
            return Ok(amount_out);
        }
        previous_output = candidate_output;
        previous_residual = candidate_residual;
    }
    Err(MathError::NoPhysicalRoot)
}

fn check_quote(state: &State, reserves: &[U256; 4], input: u8, output: u8, amount_in: U256) -> Result<(usize, usize)> {
    validate_state(state)?;
    if state.r_interior == 0 {
        return Err(MathError::AllBoundaryUnsupported);
    }
    if input >= 4 || output >= 4 {
        return Err(MathError::InvalidAssetIndex);
    }
    if input == output {
        return Err(MathError::SameAsset);
    }
    if amount_in == 0 {
        return Err(MathError::ZeroAmountIn);
    }
    let (i, o) = (usize::from(input), usize::from(output));
    if reserves[o] < 2u128 {
        return Err(MathError::InsufficientOutputReserve);
    }
    if !is_invariant(state, reserves)? {
        return Err(MathError::InvalidState);
    }
    if reserves[i] > fixed::sub(MAX_COMPONENT, amount_in)? {
        return Err(MathError::InvalidReserve);
    }
    Ok((i, o))
}

fn sample_point(maximum_output: U256, sample: u32) -> Result<U256> {
    fixed::mul_div_down(maximum_output, U256::new(u128::from(sample)), U256::new(u128::from(ROOT_SAMPLES)))
}

/// `is_invariant` for a residual already computed.
pub(crate) fn invariant_from_residual(state: &State, value: I256) -> Result<bool> {
    let absolute = value.unsigned_abs();
    let rhs = fixed::mul_wad_down(state.r_interior, state.r_interior)?;
    if rhs == 0 {
        return Ok(absolute == 0);
    }
    Ok(fixed::div_wad_down(absolute, rhs)? <= MAX_RELATIVE_DRIFT_WAD)
}

#[allow(clippy::too_many_arguments)]
fn bisect(
    state: &State,
    reserves: &[U256; 4],
    input: usize,
    output: usize,
    amount_in: U256,
    mut low: U256,
    mut high: U256,
    mut low_residual: I256,
) -> Result<U256> {
    let mut high_residual = post_trade_residual(state, reserves, input, output, amount_in, high)?;
    let mut i = 0;
    while i < ROOT_ITERATIONS && low < high {
        let middle = low + (high - low) / 2;
        let middle_residual = post_trade_residual(state, reserves, input, output, amount_in, middle)?;
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
    // Integer WAD output can put the continuous root between two values: choose the closer endpoint.
    Ok(if low_residual.unsigned_abs() <= high_residual.unsigned_abs() { low } else { high })
}

fn post_trade_residual(
    state: &State,
    reserves: &[U256; 4],
    input: usize,
    output: usize,
    amount_in: U256,
    amount_out: U256,
) -> Result<I256> {
    residual(state, &apply(reserves, input, output, amount_in, amount_out)?)
}

fn apply(reserves: &[U256; 4], input: usize, output: usize, amount_in: U256, amount_out: U256) -> Result<[U256; 4]> {
    if amount_out >= reserves[output] {
        return Err(MathError::InsufficientOutputReserve);
    }
    if reserves[input] > fixed::sub(MAX_COMPONENT, amount_in)? {
        return Err(MathError::InvalidReserve);
    }
    let mut next = *reserves;
    next[input] += amount_in;
    next[output] -= amount_out;
    Ok(next)
}

fn reserve_sums(reserves: &[U256; 4]) -> Result<(U256, U256)> {
    let mut sum = U256::ZERO;
    let mut sum_squares = U256::ZERO;
    for &reserve in reserves {
        if reserve > MAX_COMPONENT {
            return Err(MathError::InvalidReserve);
        }
        sum = fixed::add(sum, reserve)?;
        sum_squares = fixed::add(sum_squares, fixed::mul_wad_down(reserve, reserve)?)?;
    }
    Ok((sum, sum_squares))
}

fn validate_state(state: &State) -> Result<()> {
    if state.r_interior > MAX_COMPONENT || state.k_boundary > MAX_COMPONENT || state.s_boundary > MAX_COMPONENT {
        return Err(MathError::InvalidState);
    }
    Ok(())
}

pub(crate) fn crosses_or_touches(first: I256, second: I256) -> bool {
    first == I256::ZERO
        || second == I256::ZERO
        || (first.is_negative() && second.is_positive())
        || (first.is_positive() && second.is_negative())
}

fn abs_diff(a: U256, b: U256) -> U256 {
    if a >= b { a - b } else { b - a }
}

fn signed_difference(left: U256, right: U256) -> Result<I256> {
    let difference = abs_diff(left, right);
    if difference > I256::MAX.as_u256() {
        return Err(MathError::InvalidState);
    }
    let signed = difference.as_i256();
    Ok(if left >= right { signed } else { -signed })
}
