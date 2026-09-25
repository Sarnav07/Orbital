import { parseAbi } from "viem";

const hookErrors = [
  "error AggregateMismatch()", "error AllBoundaryUnsupported()", "error AlreadySeeded()", "error AmountOverflow()",
  "error AmountTooLarge()", "error AttributionUnavailable()", "error CrossingNoProgress()", "error CrossingNoRoot()",
  "error CrossingOutputInvalid()", "error DivisionByZero()", "error ExactOutputUnsupported()", "error Expired()",
  "error InsufficientInventory()", "error InsufficientOutputReserve()", "error InsufficientShares()", "error InvalidAssetIndex()",
  "error InvalidBoundary()", "error InvalidCurrencySet()", "error InvalidFee()", "error InvalidHookData()",
  "error InvalidInitialState()", "error InvalidManager()", "error InvalidRadius()", "error InvalidRange()",
  "error InvalidRangeSet()", "error InvalidReserve()", "error InvalidState()", "error InvalidTickSet()",
  "error InvariantDrift()", "error InvariantViolation()", "error MulDivOverflow()", "error NegativeRealInventory()",
  "error NoPhysicalRoot()", "error NotSeeded()", "error OnlyOwner()", "error OnlyPoolManager()", "error SameAsset()",
  "error SlippageExceeded()", "error TooManyCrossings()", "error TransferFailed()", "error UnsupportedCallback()",
  "error UnsupportedCurrency()", "error UnsupportedDecimals(uint8 decimals)", "error UnsupportedPool()", "error ZeroAmount()",
  "error ZeroAmountIn()",
] as const;

export const hookAbi = parseAbi([
  "function reserves() view returns (uint256[4])",
  "function state() view returns ((uint256 rInterior, uint256 kBoundary, uint256 sBoundary))",
  "function tickCount() view returns (uint256)",
  "function tickAt(uint256 index) view returns ((uint256 radius, uint256 k, bool isInterior))",
  "function solvency() view returns (uint256[4] custody, uint256[4] required)",
  "function feeLiability() view returns (uint256[4])",
  "function sharesOf(uint256 rangeId, address provider) view returns (uint256)",
  "function totalShares(uint256 rangeId) view returns (uint256)",
  "function previewAddLiquidity(uint256 rangeId, uint256 shares) view returns (uint256[4])",
  "function previewRemoveLiquidity(uint256 rangeId, uint256 shares) view returns (uint256[4])",
  "function addLiquidity(uint256 rangeId, uint256 shares, uint256[4] maxAmountsIn, uint256 deadline) returns (uint256[4] amounts)",
  "function removeLiquidity(uint256 rangeId, uint256 shares, uint256[4] minAmountsOut, uint256 deadline) returns (uint256[4] amounts)",
  "function collectFees(uint256 rangeId, address recipient) returns (uint256[4] amounts)",
  "function seeded() view returns (bool)",
  "event OrbitalSwap(address indexed input, address indexed output, uint256 amountIn, uint256 amountOut, uint256 fee, uint256 crossings)",
  ...hookErrors,
]);

/** v4-core's PoolSwapTest router plus the PoolManager errors a hook revert surfaces through. */
export const routerAbi = parseAbi([
  "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }",
  "struct SwapParams { bool zeroForOne; int256 amountSpecified; uint160 sqrtPriceLimitX96; }",
  "struct TestSettings { bool takeClaims; bool settleUsingBurn; }",
  "function swap(PoolKey key, SwapParams params, TestSettings testSettings, bytes hookData) payable returns (int256 delta)",
  "error WrappedError(address target, bytes4 selector, bytes reason, bytes details)",
  "error HookCallFailed()",
  "error NoSwapOccurred()",
  "error CurrencyNotSettled()",
  ...hookErrors,
]);

export const tokenAbi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function mint(address to, uint256 value)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]);
