//! On-chain swap settlement for Solana: checks a swap instead of solving it.
//!
//! Solving the invariant on-chain, as the Solidity hook does, takes ~140 residual
//! evaluations and does not fit in Solana's 1.4M compute-unit limit. Instead the client
//! plans the swap off-chain (`segmented::plan_swap`) and the program checks each segment
//! the way a constant-product AMM checks `x*y >= k`:
//!
//! - the post-segment reserves are on the solvent side of the current partition's
//!   invariant (residual <= 0) and within the Solidity solver's drift tolerance of it;
//! - they are on the physical arc of the torus's cross-section circle
//!   (w_norm >= s_boundary and alpha_interior <= 2 * r_interior);
//! - the segment does not pass any range plane of the current partition; if it lands
//!   exactly on one (Solidity's crossing target sum), that range flips.
//!
//! On the physical arc, the gap between the reserve path and the invariant surface is a
//! convex function of the output taken, so the solvent outputs of a segment are exactly
//! [0, first root]. Any accepted segment therefore pays at most what the invariant allows.

use ethnum::U256;

use crate::fixed;
use crate::segmented::{self, MAX_CROSSINGS, Segment, SwapResult, Tick};
use crate::torus::{self, State};
use crate::{MathError, Result};

/// At most one segment per crossing, plus the final one.
pub const MAX_SEGMENTS: usize = MAX_CROSSINGS as usize + 1;

/// Applies `segments` of an exact-input swap of `amount_in`, checking each one. Mutates
/// `ticks` in place like `segmented::swap_exact_in`.
pub fn settle_swap(
    state: &State,
    ticks: &mut [Tick],
    reserves: &[U256; 4],
    input: u8,
    output: u8,
    amount_in: U256,
    segments: &[Segment],
) -> Result<SwapResult> {
    if input >= 4 || output >= 4 || input == output {
        return Err(MathError::InvalidAssetIndex);
    }
    if amount_in == 0 {
        return Err(MathError::ZeroAmountIn);
    }
    if segments.is_empty() || segments.len() > MAX_SEGMENTS {
        return Err(MathError::TooManyCrossings);
    }
    if segmented::aggregate(ticks)? != *state || !torus::is_invariant(state, reserves)? {
        return Err(MathError::AggregateMismatch);
    }

    let mut state = *state;
    let mut reserves = *reserves;
    let mut taken = U256::ZERO;
    let mut total_out = U256::ZERO;
    let mut crossings = 0u32;

    for segment in segments {
        if segment.amount_in == 0 {
            return Err(MathError::CrossingNoProgress);
        }
        taken = fixed::add(taken, segment.amount_in)?;
        if taken > amount_in {
            return Err(MathError::InvalidSegment);
        }
        let rising = segment.amount_in > segment.amount_out;
        let falling = segment.amount_in < segment.amount_out;

        // A range already at (or by rounding past) its plane in the direction of travel
        // flips before trading, as in the Solidity engine.
        if rising || falling {
            if state.r_interior == 0 {
                return Err(MathError::AllBoundaryUnsupported);
            }
            let alpha = segmented::alpha_normalized(&state, &reserves)?;
            let toward = if rising { alpha + 1 } else { alpha.checked_sub(U256::ONE).unwrap_or(alpha) };
            let settled = segmented::flip_settled(ticks, alpha, toward)?;
            if settled != 0 {
                crossings += settled;
                state = segmented::aggregate(ticks)?;
                if !torus::is_invariant(&state, &reserves)? {
                    return Err(MathError::AggregateMismatch);
                }
            }
        }
        if state.r_interior == 0 {
            return Err(MathError::AllBoundaryUnsupported);
        }

        let post = segmented::apply(&reserves, input, output, segment.amount_in, segment.amount_out)?;
        check_solvent(&state, &post)?;

        // No plane may be passed; landing exactly on a plane's crossing target flips it.
        let mut landed: Option<U256> = None;
        if rising || falling {
            let alpha_post = segmented::alpha_normalized(&state, &post)?;
            let sum = post.iter().try_fold(U256::ZERO, |acc, &x| fixed::add(acc, x))?;
            for tick in ticks.iter() {
                // Rising trades move toward interior ranges' planes, falling ones toward boundary ranges'.
                if tick.is_interior != rising {
                    continue;
                }
                let lambda = segmented::plane(tick)?;
                // Solidity lands either by solving to the plane's target sum, or when a full
                // quote's normalized alpha equals the plane exactly.
                if lambda == alpha_post || sum == crossing_target(&state, lambda)? {
                    if landed.is_some_and(|l| l != lambda) {
                        return Err(MathError::AggregateMismatch);
                    }
                    landed = Some(lambda);
                } else if if rising { lambda < alpha_post } else { lambda > alpha_post } {
                    return Err(MathError::InvalidSegment);
                }
            }
        }
        reserves = post;
        total_out = fixed::add(total_out, segment.amount_out)?;
        if let Some(lambda) = landed {
            for tick in ticks.iter_mut() {
                if tick.is_interior == rising && segmented::plane(tick)? == lambda {
                    tick.is_interior = !rising;
                    crossings += 1;
                }
            }
            state = segmented::aggregate(ticks)?;
            if !torus::is_invariant(&state, &reserves)? {
                return Err(MathError::AggregateMismatch);
            }
        }
    }
    if taken != amount_in {
        return Err(MathError::InvalidSegment);
    }
    Ok(SwapResult {
        state,
        reserves,
        amount_out: total_out,
        crossings,
        interior_bitmap: segmented::interior_bitmap(ticks),
    })
}

/// The reserve sum at which a trade reaches plane `lambda` (Solidity's `targetSum`).
fn crossing_target(state: &State, lambda: U256) -> Result<U256> {
    let alpha_interior = fixed::mul_wad_down(state.r_interior, lambda)?;
    fixed::mul(U256::new(2), fixed::add(alpha_interior, state.k_boundary)?)
}

fn check_solvent(state: &State, post: &[U256; 4]) -> Result<()> {
    let parts = torus::residual_parts(state, post)?;
    if parts.residual.is_positive() {
        return Err(MathError::InvariantDrift);
    }
    if !torus::invariant_from_residual(state, parts.residual)? {
        return Err(MathError::InvariantDrift);
    }
    if parts.w_norm < state.s_boundary || parts.alpha_interior > fixed::mul(state.r_interior, U256::new(2))? {
        return Err(MathError::InvalidState);
    }
    Ok(())
}
