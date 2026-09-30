//! Orbital's four-asset stablecoin AMM maths, ported from the Solidity engine in
//! `contracts/src`. Results match the Solidity libraries exactly, including rounding
//! direction, and are checked against the shared vectors in `packages/fixtures`.
//!
//! All amounts are 18-decimal WAD `U256` values. Errors mirror the Solidity reverts;
//! `ArithmeticOverflow` stands in for Solidity 0.8's checked-arithmetic panic.

pub mod fee_book;
pub mod fixed;
pub mod range_liquidity;
pub mod segmented;
pub mod settle;
pub mod sphere;
pub mod token_units;
pub mod torus;

pub use ethnum::{I256, U256};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MathError {
    ArithmeticOverflow,
    // FixedPointMath
    DivisionByZero,
    MulDivOverflow,
    // TokenUnits
    UnsupportedDecimals,
    AmountOverflow,
    // Sphere4
    InvalidRadius,
    InvalidBoundary,
    InvalidReserve,
    InvalidAssetIndex,
    SameAsset,
    SingularRate,
    // Torus4
    InvalidState,
    AllBoundaryUnsupported,
    ZeroAmountIn,
    InsufficientOutputReserve,
    NoPhysicalRoot,
    InvariantDrift,
    // SegmentedTorus4
    InvalidTickSet,
    AggregateMismatch,
    TooManyCrossings,
    CrossingNoRoot,
    CrossingNoProgress,
    CrossingOutputInvalid,
    // RangeLiquidity4
    InvalidRangeSet,
    AttributionUnavailable,
    NegativeRealInventory,
    InvalidBootstrap,
    NonProportionalDeposit,
    ZeroShares,
    InsufficientShares,
    // RangeFeeBook4
    InvalidWeights,
    // Solana settlement: a planned segment that does not fit the swap.
    InvalidSegment,
}

pub type Result<T> = core::result::Result<T, MathError>;
