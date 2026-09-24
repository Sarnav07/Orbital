// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {BeforeSwapDelta, toBeforeSwapDelta} from "v4-core/types/BeforeSwapDelta.sol";
import {ModifyLiquidityParams, SwapParams} from "v4-core/types/PoolOperation.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";

import {FixedPointMath} from "./math/FixedPointMath.sol";
import {Sphere4} from "./math/Sphere4.sol";
import {Torus4} from "./math/Torus4.sol";
import {SegmentedTorus4} from "./math/SegmentedTorus4.sol";
import {RangeLiquidity4} from "./math/RangeLiquidity4.sol";
import {TokenUnits} from "./math/TokenUnits.sol";
import {RangeFeeBook4} from "./liquidity/RangeFeeBook4.sol";

/// @notice v4 adapter and custodian for a single four-stablecoin Orbital reserve book.
/// @dev Six canonical pair pools share one reserve vector. `beforeSwap` prices an
///      exact-input trade with SegmentedTorus4, takes the input as PoolManager
///      ERC-6909 claims and burns output claims so the manager pays the swapper.
///      Range liquidity enters and leaves through this contract, never through
///      native v4 positions.
contract OrbitalV4Hook is IHooks, IUnlockCallback {
    using FixedPointMath for uint256;

    /// @notice Shares per range permanently assigned to address(0) at seeding so a
    ///         range can never be emptied into a zero-radius, unpriceable tick.
    uint256 public constant MIN_LOCKED_SHARES = 1e9;
    uint256 internal constant FEE_DENOMINATOR = 1_000_000;
    uint256 internal constant MAX_TICKS = 16;

    IPoolManager public immutable poolManager;
    RangeFeeBook4 public immutable feeBook;
    address public immutable owner;
    uint24 public immutable poolFee;
    int24 public immutable poolTickSpacing;

    Currency[4] private _currencies;
    uint8[4] private _decimals;
    uint256[4] private _reserves;
    uint256[4] private _feeLiability;
    uint256 private _virtualSum;
    Torus4.State private _state;
    SegmentedTorus4.Tick[] private _ticks;
    bool public seeded;

    error OnlyPoolManager();
    error OnlyOwner();
    error InvalidManager();
    error InvalidCurrencySet();
    error InvalidInitialState();
    error InvalidFee();
    error UnsupportedPool();
    error UnsupportedCurrency();
    error ExactOutputUnsupported();
    error AmountTooLarge();
    error ZeroAmount();
    error UnsupportedCallback();
    error NotSeeded();
    error AlreadySeeded();
    error SlippageExceeded();
    error Expired();
    error InvalidHookData();
    error InvalidRange();
    error InsufficientShares();
    error InsufficientInventory();
    error InvariantViolation();
    error TransferFailed();

    event OrbitalSwap(
        Currency indexed input,
        Currency indexed output,
        uint256 amountIn,
        uint256 amountOut,
        uint256 fee,
        uint256 crossings
    );
    event Seeded(address indexed recipient, uint256[4] amounts);
    event LiquidityAdded(uint256 indexed rangeId, address indexed provider, uint256 shares, uint256[4] amounts);
    event LiquidityRemoved(uint256 indexed rangeId, address indexed provider, uint256 shares, uint256[4] amounts);
    event FeesCollected(uint256 indexed rangeId, address indexed provider, address recipient, uint256[4] amounts);

    struct Settlement {
        address payer;
        address recipient;
        uint256[4] amountsIn;
        uint256[4] amountsOut;
    }

    struct RangeChange {
        uint256 radius;
        uint256 k;
        uint256[4] reserves;
        uint256 virtualSum;
        uint256[4] amounts;
    }

    modifier onlyPoolManager() {
        if (msg.sender != address(poolManager)) revert OnlyPoolManager();
        _;
    }

    constructor(
        IPoolManager poolManager_,
        Currency[4] memory currencies_,
        uint8[4] memory decimals_,
        uint256[4] memory reserves_,
        SegmentedTorus4.Tick[] memory ticks_,
        uint24 poolFee_,
        int24 poolTickSpacing_,
        address owner_
    ) {
        if (address(poolManager_) == address(0)) revert InvalidManager();
        if (owner_ == address(0)) revert OnlyOwner();
        if (poolFee_ >= FEE_DENOMINATOR) revert InvalidFee();
        _validateCurrencies(currencies_);
        for (uint256 i; i < 4; ++i) {
            TokenUnits.scale(decimals_[i]);
        }

        poolManager = poolManager_;
        poolFee = poolFee_;
        poolTickSpacing = poolTickSpacing_;
        owner = owner_;
        Hooks.validateHookPermissions(IHooks(address(this)), hookPermissions());
        feeBook = new RangeFeeBook4(address(this));

        _currencies = currencies_;
        _decimals = decimals_;
        _reserves = reserves_;
        _state = _aggregate(ticks_);
        if (!Torus4.isInvariant(_state, reserves_)) revert InvalidInitialState();
        for (uint256 i; i < ticks_.length; ++i) {
            _ticks.push(ticks_[i]);
        }
        _virtualSum = _virtualOffsets(ticks_);
        _requireInventory(reserves_, _virtualSum);
    }

    /// @notice The flag pattern this hook's deployed address must encode.
    /// @dev The constructor enforces it with `Hooks.validateHookPermissions`, so a
    ///      deployment at an unmined address reverts.
    function hookPermissions() public pure returns (Hooks.Permissions memory permissions) {
        permissions.beforeInitialize = true;
        permissions.beforeAddLiquidity = true;
        permissions.beforeSwap = true;
        permissions.beforeSwapReturnDelta = true;
    }

    // ------------------------------------------------------------------
    // v4 callbacks
    // ------------------------------------------------------------------

    /// @notice Only the six canonical pair keys for this basket may be initialized.
    function beforeInitialize(address, PoolKey calldata key, uint160)
        external
        view
        override
        onlyPoolManager
        returns (bytes4)
    {
        _route(key, true);
        return IHooks.beforeInitialize.selector;
    }

    /// @notice Native concentrated liquidity is rejected; use `addLiquidity`.
    function beforeAddLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        external
        view
        override
        onlyPoolManager
        returns (bytes4)
    {
        revert UnsupportedCallback();
    }

    /// @notice Settles a canonical exact-input route against the shared reserve book.
    /// @dev `hookData` is empty or `abi.encode(uint256 minAmountOut, uint256 deadline)`.
    ///      The input fee is retained in custody and credited to interior ranges.
    function beforeSwap(address, PoolKey calldata key, SwapParams calldata params, bytes calldata hookData)
        external
        override
        onlyPoolManager
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        if (!seeded) revert NotSeeded();
        if (params.amountSpecified >= 0 || params.amountSpecified == type(int256).min) {
            revert ExactOutputUnsupported();
        }
        uint256 minAmountOut = _decodeSwapGuards(hookData);

        (uint8 inputIndex, uint8 outputIndex) = _route(key, params.zeroForOne);
        uint256 amountIn = uint256(-params.amountSpecified);
        if (amountIn > uint256(uint128(type(int128).max))) revert AmountTooLarge();
        uint256 fee = (amountIn * poolFee + FEE_DENOMINATOR - 1) / FEE_DENOMINATOR;
        if (amountIn <= fee) revert ZeroAmount();

        SegmentedTorus4.Tick[] memory ticks = _ticksInMemory();
        uint256 interiorBefore = _interiorMask(ticks);
        SegmentedTorus4.Result memory result = SegmentedTorus4.swapExactIn(
            _state, ticks, _reserves, inputIndex, outputIndex, TokenUnits.toWad(amountIn - fee, _decimals[inputIndex])
        );
        uint256 amountOut = TokenUnits.fromWadDown(result.amountOut, _decimals[outputIndex]);
        if (amountOut < minAmountOut) revert SlippageExceeded();
        _requireInventory(result.reserves, _virtualSum);

        _state = result.state;
        _reserves = result.reserves;
        _storeTickStatus(result.interiorBitmap);
        if (fee > 0) _accrueFee(inputIndex, fee, interiorBefore);

        Currency input = _currencies[inputIndex];
        Currency output = _currencies[outputIndex];
        poolManager.mint(address(this), input.toId(), amountIn);
        if (amountOut > 0) poolManager.burn(address(this), output.toId(), amountOut);

        emit OrbitalSwap(input, output, amountIn, amountOut, fee, result.crossings);
        // forge-lint: disable-next-line(unsafe-typecast)
        int128 specified = int128(int256(amountIn));
        // amountOut <= amountIn-scale reserves, far below int128.max.
        // forge-lint: disable-next-line(unsafe-typecast)
        int128 unspecified = -int128(int256(amountOut));
        return (IHooks.beforeSwap.selector, toBeforeSwapDelta(specified, unspecified), 0);
    }

    /// @notice Moves ERC-20 value in and out of this hook's PoolManager claims.
    function unlockCallback(bytes calldata data) external override onlyPoolManager returns (bytes memory) {
        Settlement memory settlement = abi.decode(data, (Settlement));
        for (uint256 i; i < 4; ++i) {
            Currency currency = _currencies[i];
            uint256 amountIn = settlement.amountsIn[i];
            if (amountIn > 0) {
                poolManager.sync(currency);
                _transferFrom(Currency.unwrap(currency), settlement.payer, address(poolManager), amountIn);
                poolManager.settle();
                poolManager.mint(address(this), currency.toId(), amountIn);
            }
            uint256 amountOut = settlement.amountsOut[i];
            if (amountOut > 0) {
                poolManager.burn(address(this), currency.toId(), amountOut);
                poolManager.take(currency, settlement.recipient, amountOut);
            }
        }
        return "";
    }

    // ------------------------------------------------------------------
    // Liquidity
    // ------------------------------------------------------------------

    /// @notice One-time funding of the configured ranges' real inventory by the owner.
    /// @dev Pulls `seedAmounts()` from the caller. Every range mints one share per
    ///      WAD of radius; `MIN_LOCKED_SHARES` of each is locked to address(0).
    function seed(address recipient) external returns (uint256[4] memory amounts) {
        if (msg.sender != owner) revert OnlyOwner();
        if (seeded) revert AlreadySeeded();
        seeded = true;
        amounts = seedAmounts();
        for (uint256 i; i < _ticks.length; ++i) {
            uint256 shares = _ticks[i].radius;
            if (shares <= MIN_LOCKED_SHARES) revert InvalidInitialState();
            feeBook.mint(i, address(0), MIN_LOCKED_SHARES);
            feeBook.mint(i, recipient, shares - MIN_LOCKED_SHARES);
        }
        uint256[4] memory none;
        _settle(Settlement({payer: msg.sender, recipient: address(0), amountsIn: amounts, amountsOut: none}));
        emit Seeded(recipient, amounts);
    }

    /// @notice Mints `shares` of one range by depositing that range's current basket.
    function addLiquidity(uint256 rangeId, uint256 shares, uint256[4] calldata maxAmountsIn, uint256 deadline)
        external
        returns (uint256[4] memory amounts)
    {
        _checkDeadline(deadline);
        RangeChange memory change = _previewRangeChange(rangeId, shares, true);
        amounts = change.amounts;
        for (uint256 i; i < 4; ++i) {
            if (amounts[i] > maxAmountsIn[i]) revert SlippageExceeded();
        }
        _applyRangeChange(rangeId, change);
        feeBook.mint(rangeId, msg.sender, shares);
        uint256[4] memory none;
        _settle(Settlement({payer: msg.sender, recipient: address(0), amountsIn: amounts, amountsOut: none}));
        emit LiquidityAdded(rangeId, msg.sender, shares, amounts);
    }

    /// @notice Burns `shares` of one range and withdraws that range's real inventory.
    function removeLiquidity(uint256 rangeId, uint256 shares, uint256[4] calldata minAmountsOut, uint256 deadline)
        external
        returns (uint256[4] memory amounts)
    {
        _checkDeadline(deadline);
        if (shares > feeBook.sharesOf(rangeId, msg.sender)) revert InsufficientShares();
        RangeChange memory change = _previewRangeChange(rangeId, shares, false);
        amounts = change.amounts;
        for (uint256 i; i < 4; ++i) {
            if (amounts[i] < minAmountsOut[i]) revert SlippageExceeded();
        }
        _applyRangeChange(rangeId, change);
        feeBook.burn(rangeId, msg.sender, shares);
        uint256[4] memory none;
        _settle(Settlement({payer: address(0), recipient: msg.sender, amountsIn: none, amountsOut: amounts}));
        emit LiquidityRemoved(rangeId, msg.sender, shares, amounts);
    }

    /// @notice Pays the caller's accrued swap fees for one range to `recipient`.
    function collectFees(uint256 rangeId, address recipient) external returns (uint256[4] memory amounts) {
        amounts = feeBook.collect(rangeId, msg.sender);
        bool any;
        for (uint256 i; i < 4; ++i) {
            _feeLiability[i] -= amounts[i];
            any = any || amounts[i] > 0;
        }
        if (any) {
            uint256[4] memory none;
            _settle(Settlement({payer: address(0), recipient: recipient, amountsIn: none, amountsOut: amounts}));
        }
        emit FeesCollected(rangeId, msg.sender, recipient, amounts);
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    /// @notice Raw token amounts the owner must supply to `seed`.
    function seedAmounts() public view returns (uint256[4] memory amounts) {
        for (uint256 i; i < 4; ++i) {
            amounts[i] = _requiredRaw(i, _reserves[i], _virtualSum);
        }
    }

    function previewAddLiquidity(uint256 rangeId, uint256 shares) external view returns (uint256[4] memory) {
        return _previewRangeChange(rangeId, shares, true).amounts;
    }

    function previewRemoveLiquidity(uint256 rangeId, uint256 shares) external view returns (uint256[4] memory) {
        return _previewRangeChange(rangeId, shares, false).amounts;
    }

    /// @notice Held PoolManager claims versus the raw amount the book must be able to pay.
    /// @dev `required` is redeemable range inventory rounded up plus unpaid fees.
    ///      Any surplus is non-redeemable rounding dust retained by the pool.
    function solvency() external view returns (uint256[4] memory custody, uint256[4] memory required) {
        for (uint256 i; i < 4; ++i) {
            custody[i] = poolManager.balanceOf(address(this), _currencies[i].toId());
            required[i] = _requiredRaw(i, _reserves[i], _virtualSum) + _feeLiability[i];
        }
    }

    function reserves() external view returns (uint256[4] memory) {
        return _reserves;
    }

    function state() external view returns (Torus4.State memory) {
        return _state;
    }

    function currencyAt(uint8 index) external view returns (Currency) {
        if (index >= 4) revert UnsupportedCurrency();
        return _currencies[index];
    }

    function decimalsAt(uint8 index) external view returns (uint8) {
        if (index >= 4) revert UnsupportedCurrency();
        return _decimals[index];
    }

    function tickCount() external view returns (uint256) {
        return _ticks.length;
    }

    function tickAt(uint256 index) external view returns (SegmentedTorus4.Tick memory) {
        return _ticks[index];
    }

    function tickIsInterior(uint256 index) external view returns (bool) {
        return _ticks[index].isInterior;
    }

    function sharesOf(uint256 rangeId, address provider) external view returns (uint256) {
        return feeBook.sharesOf(rangeId, provider);
    }

    function totalShares(uint256 rangeId) external view returns (uint256) {
        return feeBook.totalShares(rangeId);
    }

    function feeLiability() external view returns (uint256[4] memory) {
        return _feeLiability;
    }

    /// @notice Current per-range coordinates, virtual offsets and redeemable inventory (WAD).
    function rangeAttributions() external view returns (RangeLiquidity4.Attribution[] memory) {
        return RangeLiquidity4.attribute(_state, _ticksInMemory(), _reserves);
    }

    // ------------------------------------------------------------------
    // Unsupported callbacks (their permission bits are not set)
    // ------------------------------------------------------------------

    function afterInitialize(address, PoolKey calldata, uint160, int24)
        external
        view
        override
        onlyPoolManager
        returns (bytes4)
    {
        revert UnsupportedCallback();
    }

    function afterAddLiquidity(
        address,
        PoolKey calldata,
        ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external view override onlyPoolManager returns (bytes4, BalanceDelta) {
        revert UnsupportedCallback();
    }

    function beforeRemoveLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        external
        view
        override
        onlyPoolManager
        returns (bytes4)
    {
        revert UnsupportedCallback();
    }

    function afterRemoveLiquidity(
        address,
        PoolKey calldata,
        ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external view override onlyPoolManager returns (bytes4, BalanceDelta) {
        revert UnsupportedCallback();
    }

    function afterSwap(address, PoolKey calldata, SwapParams calldata, BalanceDelta, bytes calldata)
        external
        view
        override
        onlyPoolManager
        returns (bytes4, int128)
    {
        revert UnsupportedCallback();
    }

    function beforeDonate(address, PoolKey calldata, uint256, uint256, bytes calldata)
        external
        view
        override
        onlyPoolManager
        returns (bytes4)
    {
        revert UnsupportedCallback();
    }

    function afterDonate(address, PoolKey calldata, uint256, uint256, bytes calldata)
        external
        view
        override
        onlyPoolManager
        returns (bytes4)
    {
        revert UnsupportedCallback();
    }

    // ------------------------------------------------------------------
    // Internal
    // ------------------------------------------------------------------

    /// @dev Scales one range's radius and k by the share ratio, keeping k/r fixed,
    ///      and moves its coordinate by the same ratio. Rounding favours the pool:
    ///      additions round the radius and coordinate up, removals round them down.
    function _previewRangeChange(uint256 rangeId, uint256 shares, bool adding)
        private
        view
        returns (RangeChange memory change)
    {
        if (!seeded) revert NotSeeded();
        if (rangeId >= _ticks.length) revert InvalidRange();
        if (shares == 0) revert ZeroAmount();
        uint256 supply = feeBook.totalShares(rangeId);
        if (!adding && shares >= supply) revert InsufficientShares();

        SegmentedTorus4.Tick[] memory ticks = _ticksInMemory();
        // Copy scalars: `ticks[rangeId]` is mutated below and memory structs alias.
        uint256 radius = ticks[rangeId].radius;
        uint256 k = ticks[rangeId].k;
        uint256[4] memory coordinates = RangeLiquidity4.attribute(_state, ticks, _reserves)[rangeId].coordinates;

        uint256 radiusDelta;
        if (adding) {
            radiusDelta = _mulDivUp(radius, shares, supply);
            radiusDelta += radiusDelta % 2;
            change.radius = radius + radiusDelta;
        } else {
            radiusDelta = FixedPointMath.mulDivDown(radius, shares, supply);
            radiusDelta -= radiusDelta % 2;
            if (radiusDelta >= radius) revert InvalidRange();
            change.radius = radius - radiusDelta;
        }
        change.k = FixedPointMath.mulDivDown(k, change.radius, radius);
        ticks[rangeId].radius = change.radius;
        ticks[rangeId].k = change.k;

        for (uint256 i; i < 4; ++i) {
            change.reserves[i] = adding
                ? _reserves[i] + _mulDivUp(coordinates[i], radiusDelta, radius)
                : _reserves[i] - FixedPointMath.mulDivDown(coordinates[i], radiusDelta, radius);
        }
        if (!Torus4.isInvariant(_aggregate(ticks), change.reserves)) revert InvariantViolation();
        change.virtualSum = _virtualOffsets(ticks);
        _requireInventory(change.reserves, change.virtualSum);

        for (uint256 i; i < 4; ++i) {
            uint256 before = _requiredRaw(i, _reserves[i], _virtualSum);
            uint256 next = _requiredRaw(i, change.reserves[i], change.virtualSum);
            if (adding) change.amounts[i] = next > before ? next - before : 0;
            else change.amounts[i] = before > next ? before - next : 0;
        }
    }

    function _applyRangeChange(uint256 rangeId, RangeChange memory change) private {
        _ticks[rangeId].radius = change.radius;
        _ticks[rangeId].k = change.k;
        _reserves = change.reserves;
        _virtualSum = change.virtualSum;
        _state = _aggregate(_ticksInMemory());
    }

    /// @dev Splits a raw input-token fee across ranges that were interior when the
    ///      swap started, weighted by radius. Boundary ranges are not credited.
    function _accrueFee(uint8 asset, uint256 fee, uint256 interiorMask) private {
        uint256 count;
        for (uint256 i; i < _ticks.length; ++i) {
            if (interiorMask & (uint256(1) << i) != 0) ++count;
        }
        uint256[] memory ids = new uint256[](count);
        uint256[] memory weights = new uint256[](count);
        uint256 cursor;
        for (uint256 i; i < _ticks.length; ++i) {
            if (interiorMask & (uint256(1) << i) == 0) continue;
            ids[cursor] = i;
            weights[cursor] = _ticks[i].radius;
            ++cursor;
        }
        uint256[4] memory fees;
        fees[asset] = fee;
        _feeLiability[asset] += fee;
        feeBook.accrue(ids, weights, fees);
    }

    function _settle(Settlement memory settlement) private {
        poolManager.unlock(abi.encode(settlement));
    }

    function _decodeSwapGuards(bytes calldata hookData) private view returns (uint256 minAmountOut) {
        if (hookData.length == 0) return 0;
        if (hookData.length != 64) revert InvalidHookData();
        uint256 deadline;
        (minAmountOut, deadline) = abi.decode(hookData, (uint256, uint256));
        _checkDeadline(deadline);
    }

    function _checkDeadline(uint256 deadline) private view {
        // Deadlines are user-chosen coarse bounds; validator skew is acceptable here.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp > deadline) revert Expired();
    }

    function _requiredRaw(uint256 index, uint256 reserve, uint256 virtualSum) private view returns (uint256) {
        return TokenUnits.fromWadUp(reserve - virtualSum, _decimals[index]);
    }

    function _requireInventory(uint256[4] memory reserves_, uint256 virtualSum) private pure {
        for (uint256 i; i < 4; ++i) {
            if (reserves_[i] < virtualSum) revert InsufficientInventory();
        }
    }

    function _virtualOffsets(SegmentedTorus4.Tick[] memory ticks) private pure returns (uint256 total) {
        for (uint256 i; i < ticks.length; ++i) {
            total += Sphere4.tick(ticks[i].radius, ticks[i].k).minimumReserve;
        }
    }

    function _route(PoolKey calldata key, bool zeroForOne) private view returns (uint8 inputIndex, uint8 outputIndex) {
        address currency0 = Currency.unwrap(key.currency0);
        address currency1 = Currency.unwrap(key.currency1);
        if (
            currency0 >= currency1 || address(key.hooks) != address(this) || key.fee != poolFee
                || key.tickSpacing != poolTickSpacing
        ) revert UnsupportedPool();

        uint8 index0 = _currencyIndex(currency0);
        uint8 index1 = _currencyIndex(currency1);
        return zeroForOne ? (index0, index1) : (index1, index0);
    }

    function _currencyIndex(address currency) private view returns (uint8) {
        for (uint8 i; i < 4; ++i) {
            if (Currency.unwrap(_currencies[i]) == currency) return i;
        }
        revert UnsupportedCurrency();
    }

    function _validateCurrencies(Currency[4] memory currencies_) private pure {
        for (uint256 i; i < 4; ++i) {
            if (Currency.unwrap(currencies_[i]) == address(0)) revert InvalidCurrencySet();
            if (i > 0 && Currency.unwrap(currencies_[i - 1]) >= Currency.unwrap(currencies_[i])) {
                revert InvalidCurrencySet();
            }
        }
    }

    function _aggregate(SegmentedTorus4.Tick[] memory ticks_) private pure returns (Torus4.State memory aggregate) {
        if (ticks_.length == 0 || ticks_.length > MAX_TICKS) revert InvalidInitialState();
        for (uint256 i; i < ticks_.length; ++i) {
            Sphere4.TickGeometry memory geometry = Sphere4.tick(ticks_[i].radius, ticks_[i].k);
            if (geometry.isDegenerate) revert InvalidInitialState();
            if (ticks_[i].isInterior) {
                aggregate.rInterior += ticks_[i].radius;
            } else {
                aggregate.kBoundary += ticks_[i].k;
                aggregate.sBoundary += geometry.boundaryRadius;
            }
        }
    }

    function _ticksInMemory() private view returns (SegmentedTorus4.Tick[] memory ticks) {
        ticks = new SegmentedTorus4.Tick[](_ticks.length);
        for (uint256 i; i < _ticks.length; ++i) {
            ticks[i] = _ticks[i];
        }
    }

    function _interiorMask(SegmentedTorus4.Tick[] memory ticks) private pure returns (uint256 mask) {
        for (uint256 i; i < ticks.length; ++i) {
            if (ticks[i].isInterior) mask |= uint256(1) << i;
        }
    }

    function _storeTickStatus(uint256 interiorBitmap) private {
        for (uint256 i; i < _ticks.length; ++i) {
            _ticks[i].isInterior = interiorBitmap & (uint256(1) << i) != 0;
        }
    }

    function _transferFrom(address token, address from, address to, uint256 amount) private {
        // Accept both bool-returning and non-returning ERC-20 implementations.
        (bool success, bytes memory result) = token.call(abi.encodeWithSelector(0x23b872dd, from, to, amount));
        if (!success || (result.length != 0 && !abi.decode(result, (bool))) || token.code.length == 0) {
            revert TransferFailed();
        }
    }

    function _mulDivUp(uint256 x, uint256 y, uint256 denominator) private pure returns (uint256 result) {
        result = FixedPointMath.mulDivDown(x, y, denominator);
        if (mulmod(x, y, denominator) != 0) ++result;
    }
}
