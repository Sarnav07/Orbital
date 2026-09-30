//! Compute-unit benchmark for the Orbital maths on Solana.
//!
//! Runs one orbital-math operation per instruction on the demo tick set (three 10M-WAD
//! ranges at k/r 1.001, 1.004, 1.05) and fails unless the result equals the expected
//! value passed in, so the measured compute is for a correct, un-optimised-away call.
//!
//! Instruction data (little-endian):
//!   [0]        op: 0 = torus quote, 1 = segmented swap, 2 = attribute
//!   [1]        input asset
//!   [2]        output asset
//!   [3]        interior bitmap of the three ticks
//!   [4..132]   reserves, 4 x U256
//!   [132..164] amount in, U256
//!   [164..196] expected amount out, U256 (ignored by op 2)
//!   [196..]    op 7 only: planned segments, each amount in + amount out (2 x U256)

use orbital_math::U256;
use orbital_math::range_liquidity::attribute;
use orbital_math::segmented::{Segment, Tick, aggregate, swap_exact_in};
use orbital_math::settle::settle_swap;
use orbital_math::torus::quote_exact_in;
use pinocchio::error::ProgramError;
use pinocchio::{AccountView, Address, ProgramResult};

#[cfg(target_os = "solana")]
pinocchio::entrypoint!(process_instruction);

const RADIUS: U256 = U256::new(10_000_000_000_000_000_000_000_000);

fn demo_ticks(bitmap: u8) -> [Tick; 3] {
    let k = |per_mille: u128| RADIUS * per_mille / 1000;
    [
        Tick { radius: RADIUS, k: k(1001), is_interior: bitmap & 1 != 0 },
        Tick { radius: RADIUS, k: k(1004), is_interior: bitmap & 2 != 0 },
        Tick { radius: RADIUS, k: k(1050), is_interior: bitmap & 4 != 0 },
    ]
}

fn word(data: &[u8], offset: usize) -> Result<U256, ProgramError> {
    let bytes: [u8; 32] = data.get(offset..offset + 32).ok_or(ProgramError::InvalidInstructionData)?.try_into().unwrap();
    Ok(U256::from_le_bytes(bytes))
}

fn math_error(_: orbital_math::MathError) -> ProgramError {
    ProgramError::Custom(1)
}

#[inline(never)]
pub fn process_instruction(_program_id: &Address, _accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    if data.len() < 196 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let (op, input, output, bitmap) = (data[0], data[1], data[2], data[3]);
    let reserves = [word(data, 4)?, word(data, 36)?, word(data, 68)?, word(data, 100)?];
    let amount_in = word(data, 132)?;
    let expected_out = word(data, 164)?;
    let mut ticks = demo_ticks(bitmap);
    let state = aggregate(&ticks).map_err(math_error)?;

    let out = match op {
        0 => quote_exact_in(&state, &reserves, input, output, amount_in).map_err(math_error)?,
        1 => swap_exact_in(&state, &mut ticks, &reserves, input, output, amount_in).map_err(math_error)?.amount_out,
        2 => {
            let ranges = attribute(&state, &ticks, &reserves).map_err(math_error)?;
            return if ranges.len() == 3 { Ok(()) } else { Err(ProgramError::Custom(3)) };
        }
        3 => {
            let value = orbital_math::torus::residual(&state, &reserves).map_err(math_error)?;
            return if value.unsigned_abs() >= expected_out { Ok(()) } else { Err(ProgramError::Custom(4)) };
        }
        4 => orbital_math::fixed::sqrt_wad(amount_in).map_err(math_error)?,
        5 => orbital_math::fixed::mul_wad_down(amount_in, amount_in).map_err(math_error)?,
        7 => {
            let mut segments = [Segment { amount_in: U256::ZERO, amount_out: U256::ZERO }; 9];
            let count = (data.len() - 196) / 64;
            if count == 0 || count > segments.len() {
                return Err(ProgramError::InvalidInstructionData);
            }
            for (i, segment) in segments.iter_mut().take(count).enumerate() {
                let at = 196 + 64 * i;
                *segment = Segment { amount_in: word(data, at)?, amount_out: word(data, at + 32)? };
            }
            settle_swap(&state, &mut ticks, &reserves, input, output, amount_in, &segments[..count])
                .map_err(math_error)?
                .amount_out
        }
        _ => return Err(ProgramError::InvalidInstructionData),
    };
    if out != expected_out {
        return Err(ProgramError::Custom(2));
    }
    Ok(())
}
