// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {BeforeSwapDelta, toBeforeSwapDelta} from "v4-core/types/BeforeSwapDelta.sol";
import {ModifyLiquidityParams, SwapParams} from "v4-core/types/PoolOperation.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";

import {Sphere4} from "./math/Sphere4.sol";
import {Torus4} from "./math/Torus4.sol";
import {SegmentedTorus4} from "./math/SegmentedTorus4.sol";
import {RangeLiquidity4} from "./math/RangeLiquidity4.sol";

/// @notice v4 adapter for a single four-stablecoin Orbital reserve book.
/// @dev The hook consumes exact-input swaps only. `beforeSwap` replaces the
///      concentrated-liquidity leg with a custom delta and advances the shared
///      Orbital state. Hook-address mining and production settlement are
///      intentionally separate deployment concerns.
contract OrbitalV4Hook is IHooks {
    IPoolManager public immutable poolManager;
    uint24 public immutable poolFee;
    int24 public immutable poolTickSpacing;

    Currency[4] private _currencies;
    uint256[4] private _reserves;
    Torus4.State private _state;
    SegmentedTorus4.Tick[] private _ticks;

    error OnlyPoolManager();
    error InvalidManager();
    error InvalidCurrencySet();
    error InvalidInitialState();
    error UnsupportedPool();
    error UnsupportedCurrency();
    error ExactOutputUnsupported();
    error AmountTooLarge();
    error UnsupportedCallback();

    event OrbitalSwap(
        Currency indexed input, Currency indexed output, uint256 amountIn, uint256 amountOut, uint256 crossings
    );

    modifier onlyPoolManager() {
        if (msg.sender != address(poolManager)) revert OnlyPoolManager();
        _;
    }

    constructor(
        IPoolManager poolManager_,
        Currency[4] memory currencies_,
        uint256[4] memory reserves_,
        SegmentedTorus4.Tick[] memory ticks_,
        uint24 poolFee_,
        int24 poolTickSpacing_
    ) {
        if (address(poolManager_) == address(0)) revert InvalidManager();
        _validateCurrencies(currencies_);

        poolManager = poolManager_;
        poolFee = poolFee_;
        poolTickSpacing = poolTickSpacing_;
        Hooks.validateHookPermissions(IHooks(address(this)), hookPermissions());
        _currencies = currencies_;
        _reserves = reserves_;
        _state = _aggregate(ticks_);
        if (!Torus4.isInvariant(_state, reserves_)) revert InvalidInitialState();

        for (uint256 i; i < ticks_.length; ++i) {
            _ticks.push(ticks_[i]);
        }
    }

    /// @notice Declares the flag pattern required when this hook is deployed.
    /// @dev C11 mines an address matching these permissions and validates it in
    ///      the deployment path; no constructor address check is performed here.
    function hookPermissions() public pure returns (Hooks.Permissions memory permissions) {
        permissions.beforeSwap = true;
        permissions.beforeSwapReturnDelta = true;
    }

    /// @notice Advances the common reserve book for a canonical exact-input pair route.
    /// @dev Positive specified and negative unspecified deltas fully bypass the
    ///      v4 concentrated-liquidity swap and describe this custom curve trade.
    function beforeSwap(address, PoolKey calldata key, SwapParams calldata params, bytes calldata)
        external
        override
        onlyPoolManager
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        if (params.amountSpecified >= 0 || params.amountSpecified == type(int256).min) {
            revert ExactOutputUnsupported();
        }

        (uint8 inputIndex, uint8 outputIndex) = _route(key, params.zeroForOne);
        uint256 amountIn = uint256(-params.amountSpecified);
        if (amountIn > uint256(uint128(type(int128).max))) revert AmountTooLarge();

        SegmentedTorus4.Tick[] memory ticks = _ticksInMemory();
        SegmentedTorus4.Result memory result =
            SegmentedTorus4.swapExactIn(_state, ticks, _reserves, inputIndex, outputIndex, amountIn);
        if (result.amountOut > uint256(uint128(type(int128).max))) revert AmountTooLarge();

        _state = result.state;
        _reserves = result.reserves;
        _storeTickStatus(result.interiorBitmap);

        // forge-lint: disable-next-line(unsafe-typecast)
        int128 specified = int128(int256(amountIn));
        // forge-lint: disable-next-line(unsafe-typecast)
        int128 unspecified = -int128(int256(result.amountOut));
        emit OrbitalSwap(
            _currencies[inputIndex], _currencies[outputIndex], amountIn, result.amountOut, result.crossings
        );
        return (IHooks.beforeSwap.selector, toBeforeSwapDelta(specified, unspecified), 0);
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

    function tickCount() external view returns (uint256) {
        return _ticks.length;
    }

    function tickIsInterior(uint256 index) external view returns (bool) {
        return _ticks[index].isInterior;
    }

    /// @notice Current per-range coordinates, virtual offsets and redeemable inventory.
    /// @dev Attribution is derived from the same stored reserve book used for swaps.
    ///      LP share custody and token settlement are layered on in later milestones.
    function rangeAttributions() external view returns (RangeLiquidity4.Attribution[] memory) {
        return RangeLiquidity4.attribute(_state, _ticksInMemory(), _reserves);
    }

    function beforeInitialize(address, PoolKey calldata, uint160)
        external
        view
        override
        onlyPoolManager
        returns (bytes4)
    {
        revert UnsupportedCallback();
    }

    function afterInitialize(address, PoolKey calldata, uint160, int24)
        external
        view
        override
        onlyPoolManager
        returns (bytes4)
    {
        revert UnsupportedCallback();
    }

    function beforeAddLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
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
        if (ticks_.length == 0 || ticks_.length > 16) revert InvalidInitialState();
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

    function _storeTickStatus(uint256 interiorBitmap) private {
        for (uint256 i; i < _ticks.length; ++i) {
            _ticks[i].isInterior = interiorBitmap & (uint256(1) << i) != 0;
        }
    }
}
