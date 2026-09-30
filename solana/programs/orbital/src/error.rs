use anchor_lang::prelude::*;
use orbital_math::MathError;

#[error_code]
pub enum OrbitalError {
    #[msg("Mints must be four distinct accounts in increasing address order")]
    InvalidMintSet,
    #[msg("Fee must be below 1,000,000 ppm")]
    InvalidFee,
    #[msg("Need between one and sixteen ranges")]
    InvalidRangeSet,
    #[msg("Initial reserves are not on the invariant or lack inventory")]
    InvalidInitialState,
    #[msg("Asset index must be 0..3 and input must differ from output")]
    InvalidAsset,
    #[msg("Range index is out of bounds")]
    InvalidRange,
    #[msg("Pool is not seeded yet")]
    NotSeeded,
    #[msg("Pool is already seeded")]
    AlreadySeeded,
    #[msg("Amount must leave something after the fee")]
    ZeroAmount,
    #[msg("Output is below the minimum, or input above the maximum")]
    SlippageExceeded,
    #[msg("Deadline has passed")]
    Expired,
    #[msg("Not enough shares")]
    InsufficientShares,
    #[msg("Reserves would fall below the virtual offsets")]
    InsufficientInventory,
    #[msg("The range change breaks the invariant")]
    InvariantViolation,
    #[msg("A stored value does not fit its field")]
    ValueTooLarge,
    #[msg("Wrong position or vault account")]
    WrongAccount,
    #[msg("Orbital maths rejected the operation")]
    Math,
}

/// Maps an orbital-math error to a program error, logging which one it was.
pub fn math(error: MathError) -> anchor_lang::error::Error {
    msg!("orbital-math: {:?}", error);
    error!(OrbitalError::Math)
}
