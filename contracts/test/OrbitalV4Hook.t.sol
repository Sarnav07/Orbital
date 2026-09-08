// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "v4-core/types/BeforeSwapDelta.sol";
import {SwapParams} from "v4-core/types/PoolOperation.sol";

import {OrbitalV4Hook} from "../src/OrbitalV4Hook.sol";
import {SegmentedTorus4} from "../src/math/SegmentedTorus4.sol";
import {RangeLiquidity4} from "../src/math/RangeLiquidity4.sol";
import {HookAddressMiner} from "../src/deploy/HookAddressMiner.sol";
import {Torus4} from "../src/math/Torus4.sol";

/// @notice Minimal manager-side accounting fixture for the v4 custom-delta leg.
/// @dev It does not emulate PoolManager internals. It calls the hook as the
///      authorized manager and settles the official before-swap delta into a
///      transparent per-currency test ledger.
contract V4SettlementFixture {
    using BeforeSwapDeltaLibrary for BeforeSwapDelta;

    mapping(address => uint256) public receivedByPool;
    mapping(address => uint256) public paidByPool;

    error InvalidHookResponse();
    error InvalidDelta();

    function executeExactIn(OrbitalV4Hook hook, PoolKey memory key, SwapParams memory params)
        external
        returns (uint256 amountIn, uint256 amountOut)
    {
        (bytes4 selector, BeforeSwapDelta delta,) = hook.beforeSwap(address(this), key, params, bytes(""));
        if (selector != IHooks.beforeSwap.selector || params.amountSpecified >= 0) revert InvalidHookResponse();

        amountIn = uint256(-params.amountSpecified);
        int128 specified = delta.getSpecifiedDelta();
        int128 unspecified = delta.getUnspecifiedDelta();
        // The hook rejects amounts above int128.max before returning this delta.
        // forge-lint: disable-next-line(unsafe-typecast)
        int128 expectedSpecified = int128(int256(amountIn));
        if (specified != expectedSpecified || unspecified >= 0) revert InvalidDelta();
        // `unspecified` is negative int128, so negating through int256 is safe.
        // forge-lint: disable-next-line(unsafe-typecast)
        amountOut = uint256(-int256(unspecified));

        Currency input = params.zeroForOne ? key.currency0 : key.currency1;
        Currency output = params.zeroForOne ? key.currency1 : key.currency0;
        receivedByPool[Currency.unwrap(input)] += amountIn;
        paidByPool[Currency.unwrap(output)] += amountOut;
    }
}

contract OrbitalV4HookTest {
    uint256 private constant WAD = 1e18;
    uint24 private constant FEE = 500;
    int24 private constant TICK_SPACING = 60;

    Currency private constant USDC = Currency.wrap(address(0x1001));
    Currency private constant USDT = Currency.wrap(address(0x1002));
    Currency private constant DAI = Currency.wrap(address(0x1003));
    Currency private constant FRAX = Currency.wrap(address(0x1004));

    V4SettlementFixture private fixture = new V4SettlementFixture();
    OrbitalV4Hook private hook = _deployHook();

    function testTwoCanonicalPairsMutateOneSharedReserveBook() public {
        uint256[4] memory initial = hook.reserves();

        (uint256 firstIn, uint256 firstOut) = fixture.executeExactIn(hook, _key(USDC, USDT), _exactIn(true, 10 * WAD));
        uint256[4] memory afterFirst = hook.reserves();
        (uint256 secondIn, uint256 secondOut) = fixture.executeExactIn(hook, _key(DAI, FRAX), _exactIn(true, 15 * WAD));
        uint256[4] memory afterSecond = hook.reserves();

        assert(firstIn == 10 * WAD && firstOut > 0);
        assert(secondIn == 15 * WAD && secondOut > 0);
        assert(afterFirst[0] == initial[0] + firstIn);
        assert(afterFirst[1] == initial[1] - firstOut);
        assert(afterFirst[2] == initial[2] && afterFirst[3] == initial[3]);
        assert(afterSecond[0] == afterFirst[0] && afterSecond[1] == afterFirst[1]);
        assert(afterSecond[2] == afterFirst[2] + secondIn);
        assert(afterSecond[3] == afterFirst[3] - secondOut);
        assert(fixture.receivedByPool(Currency.unwrap(USDC)) == firstIn);
        assert(fixture.paidByPool(Currency.unwrap(USDT)) == firstOut);
        assert(fixture.receivedByPool(Currency.unwrap(DAI)) == secondIn);
        assert(fixture.paidByPool(Currency.unwrap(FRAX)) == secondOut);
        assert(Torus4.isInvariant(hook.state(), afterSecond));
    }

    function testCanonicalPairAcceptsBothDirections() public {
        (uint256 amountIn, uint256 amountOut) =
            fixture.executeExactIn(hook, _key(USDC, USDT), _exactIn(false, 10 * WAD));
        uint256[4] memory reserves = hook.reserves();

        assert(amountIn == 10 * WAD && amountOut > 0);
        assert(reserves[1] == 110 * WAD);
        assert(reserves[0] < 100 * WAD);
        assert(fixture.receivedByPool(Currency.unwrap(USDT)) == amountIn);
        assert(fixture.paidByPool(Currency.unwrap(USDC)) == amountOut);
    }

    function testDeclaresOnlyTheRequiredBeforeSwapPermissions() public view {
        // This pattern is validated against a mined address in the deployment chunk.
        // C08 exposes it without pretending this test deployment has that address.
        assert(hook.hookPermissions().beforeSwap);
        assert(hook.hookPermissions().beforeSwapReturnDelta);
        assert(!hook.hookPermissions().afterSwap);
        assert(!hook.hookPermissions().afterSwapReturnDelta);
    }

    function testAttributionReflectsTheSharedBookAfterABoundaryCrossing() public {
        fixture.executeExactIn(hook, _key(USDC, USDT), _exactIn(true, 100 * WAD));
        RangeLiquidity4.Attribution[] memory ranges = hook.rangeAttributions();

        assert(ranges.length == 2);
        assert(!ranges[0].isInterior && ranges[1].isInterior);
        for (uint256 asset; asset < 4; ++asset) {
            assert(ranges[0].coordinates[asset] >= ranges[0].virtualOffset);
            assert(ranges[1].coordinates[asset] >= ranges[1].virtualOffset);
        }
    }

    function testStatefulAllPairsAndCrossingSequenceMatchesEngine() public {
        Torus4.State memory modelState = Torus4.State({rInterior: 200 * WAD, kBoundary: 0, sBoundary: 0});
        SegmentedTorus4.Tick[] memory modelTicks = _ticks();
        uint256[4] memory modelReserves = [uint256(100 * WAD), 100 * WAD, 100 * WAD, 100 * WAD];
        uint8[14] memory inputs = [uint8(0), 1, 0, 1, 0, 2, 0, 3, 1, 2, 1, 3, 2, 3];
        uint8[14] memory outputs = [uint8(1), 0, 1, 0, 2, 0, 3, 0, 2, 1, 3, 1, 3, 2];
        uint256[14] memory amounts =
            [uint256(100 * WAD), 10 * WAD, WAD, WAD, WAD, WAD, WAD, WAD, WAD, WAD, WAD, WAD, WAD, WAD];

        for (uint256 action; action < inputs.length; ++action) {
            SegmentedTorus4.Result memory expected = SegmentedTorus4.swapExactIn(
                modelState, modelTicks, modelReserves, inputs[action], outputs[action], amounts[action]
            );
            (uint256 amountIn, uint256 actualOut) = _executeIndexed(inputs[action], outputs[action], amounts[action]);
            uint256[4] memory actualReserves = hook.reserves();
            assert(amountIn == amounts[action]);
            assert(actualOut == expected.amountOut);
            assert(hook.state().rInterior == expected.state.rInterior);
            assert(hook.state().kBoundary == expected.state.kBoundary);
            assert(hook.state().sBoundary == expected.state.sBoundary);
            for (uint256 asset; asset < 4; ++asset) {
                assert(actualReserves[asset] == expected.reserves[asset]);
            }
            modelState = expected.state;
            modelReserves = expected.reserves;
            _applyBitmap(modelTicks, expected.interiorBitmap);
        }
    }

    function testGasBudgetForOrdinaryAndCrossingRoutes() public {
        uint256 ordinaryStart = gasleft();
        fixture.executeExactIn(hook, _key(USDC, USDT), _exactIn(true, 10 * WAD));
        uint256 ordinaryUsed = ordinaryStart - gasleft();
        assert(ordinaryUsed <= 1_500_000);

        // A fresh hook keeps this route on the known first-boundary path.
        V4SettlementFixture crossingFixture = new V4SettlementFixture();
        OrbitalV4Hook crossingHook = _deployHookFor(crossingFixture);
        uint256 crossingStart = gasleft();
        crossingFixture.executeExactIn(crossingHook, _keyFor(crossingHook, USDC, USDT), _exactIn(true, 100 * WAD));
        uint256 crossingUsed = crossingStart - gasleft();
        assert(crossingUsed <= 3_500_000);
    }

    function testRejectsNonCanonicalOrUnknownPair() public {
        PoolKey memory reversed = _key(USDC, USDT);
        reversed.currency0 = USDT;
        reversed.currency1 = USDC;
        _expect(
            abi.encodeCall(fixture.executeExactIn, (hook, reversed, _exactIn(true, WAD))),
            OrbitalV4Hook.UnsupportedPool.selector
        );

        PoolKey memory unknown = _key(USDC, USDT);
        unknown.currency1 = Currency.wrap(address(0x2000));
        _expect(
            abi.encodeCall(fixture.executeExactIn, (hook, unknown, _exactIn(true, WAD))),
            OrbitalV4Hook.UnsupportedCurrency.selector
        );
    }

    function testRejectsPairMetadataThatDoesNotBelongToThisHook() public {
        PoolKey memory wrongFee = _key(USDC, USDT);
        wrongFee.fee = FEE + 1;
        _expect(
            abi.encodeCall(fixture.executeExactIn, (hook, wrongFee, _exactIn(true, WAD))),
            OrbitalV4Hook.UnsupportedPool.selector
        );

        PoolKey memory wrongHook = _key(USDC, USDT);
        wrongHook.hooks = IHooks(address(0xBEEF));
        _expect(
            abi.encodeCall(fixture.executeExactIn, (hook, wrongHook, _exactIn(true, WAD))),
            OrbitalV4Hook.UnsupportedPool.selector
        );
    }

    function testRejectsExactOutputAndDirectCalls() public {
        // WAD is a small positive constant that is exactly representable as int256.
        // forge-lint: disable-next-line(unsafe-typecast)
        SwapParams memory exactOut = SwapParams({zeroForOne: true, amountSpecified: int256(WAD), sqrtPriceLimitX96: 0});
        _expect(
            abi.encodeCall(fixture.executeExactIn, (hook, _key(USDC, USDT), exactOut)),
            OrbitalV4Hook.ExactOutputUnsupported.selector
        );

        (bool success, bytes memory result) = address(hook)
            .call(abi.encodeCall(hook.beforeSwap, (address(this), _key(USDC, USDT), _exactIn(true, WAD), bytes(""))));
        assert(!success && result.length >= 4);
        // forge-lint: disable-next-line(unsafe-typecast)
        assert(bytes4(result) == OrbitalV4Hook.OnlyPoolManager.selector);
    }

    function _deployHook() private returns (OrbitalV4Hook deployed) {
        return _deployHookFor(fixture);
    }

    function _deployHookFor(V4SettlementFixture managerFixture) private returns (OrbitalV4Hook deployed) {
        Currency[4] memory currencies = [USDC, USDT, DAI, FRAX];
        uint256[4] memory reserves = [uint256(100 * WAD), 100 * WAD, 100 * WAD, 100 * WAD];
        SegmentedTorus4.Tick[] memory ticks = new SegmentedTorus4.Tick[](2);
        ticks[0] = SegmentedTorus4.Tick({radius: 100 * WAD, k: 110 * WAD, isInterior: true});
        ticks[1] = SegmentedTorus4.Tick({radius: 100 * WAD, k: 130 * WAD, isInterior: true});
        bytes memory initCode = abi.encodePacked(
            type(OrbitalV4Hook).creationCode,
            abi.encode(IPoolManager(address(managerFixture)), currencies, reserves, ticks, FEE, TICK_SPACING)
        );
        bytes32 salt = HookAddressMiner.find(address(this), keccak256(initCode), 136, 100_000);
        deployed = new OrbitalV4Hook{salt: salt}(
            IPoolManager(address(managerFixture)), currencies, reserves, ticks, FEE, TICK_SPACING
        );
    }

    function _key(Currency currency0, Currency currency1) private view returns (PoolKey memory) {
        return _keyFor(hook, currency0, currency1);
    }

    function _keyFor(OrbitalV4Hook target, Currency currency0, Currency currency1)
        private
        pure
        returns (PoolKey memory)
    {
        return PoolKey({
            currency0: currency0,
            currency1: currency1,
            fee: FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(target))
        });
    }

    function _executeIndexed(uint8 input, uint8 output, uint256 amountIn) private returns (uint256, uint256) {
        Currency[4] memory currencies = [USDC, USDT, DAI, FRAX];
        bool zeroForOne = input < output;
        Currency currency0 = zeroForOne ? currencies[input] : currencies[output];
        Currency currency1 = zeroForOne ? currencies[output] : currencies[input];
        return fixture.executeExactIn(hook, _key(currency0, currency1), _exactIn(zeroForOne, amountIn));
    }

    function _ticks() private pure returns (SegmentedTorus4.Tick[] memory ticks) {
        ticks = new SegmentedTorus4.Tick[](2);
        ticks[0] = SegmentedTorus4.Tick({radius: 100 * WAD, k: 110 * WAD, isInterior: true});
        ticks[1] = SegmentedTorus4.Tick({radius: 100 * WAD, k: 130 * WAD, isInterior: true});
    }

    function _applyBitmap(SegmentedTorus4.Tick[] memory ticks, uint256 bitmap) private pure {
        for (uint256 i; i < ticks.length; ++i) {
            ticks[i].isInterior = bitmap & (uint256(1) << i) != 0;
        }
    }

    function _exactIn(bool zeroForOne, uint256 amountIn) private pure returns (SwapParams memory) {
        // Test inputs are WAD-scale values, all strictly below int256.max.
        // forge-lint: disable-next-line(unsafe-typecast)
        return SwapParams({zeroForOne: zeroForOne, amountSpecified: -int256(amountIn), sqrtPriceLimitX96: 0});
    }

    function _expect(bytes memory callData, bytes4 selector) private {
        (bool success, bytes memory result) = address(fixture).call(callData);
        assert(!success && result.length >= 4);
        // forge-lint: disable-next-line(unsafe-typecast)
        assert(bytes4(result) == selector);
    }
}
