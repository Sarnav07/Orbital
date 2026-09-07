// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {RangeLiquidity4} from "../src/math/RangeLiquidity4.sol";
import {SegmentedTorus4} from "../src/math/SegmentedTorus4.sol";
import {Torus4} from "../src/math/Torus4.sol";
import {RangeShareBook4} from "../src/liquidity/RangeShareBook4.sol";

contract RangeLiquidity4Harness {
    function attribute(Torus4.State memory state, SegmentedTorus4.Tick[] memory ticks, uint256[4] memory reserves)
        external
        pure
        returns (RangeLiquidity4.Attribution[] memory)
    {
        return RangeLiquidity4.attribute(state, ticks, reserves);
    }

    function bootstrap(uint256[4] memory inventory, uint256 shares)
        external
        pure
        returns (RangeLiquidity4.ShareState memory)
    {
        return RangeLiquidity4.bootstrap(inventory, shares);
    }

    function add(RangeLiquidity4.ShareState memory position, uint256[4] memory amounts)
        external
        pure
        returns (RangeLiquidity4.ShareState memory, uint256)
    {
        return RangeLiquidity4.addProportional(position, amounts);
    }

    function remove(RangeLiquidity4.ShareState memory position, uint256 shares)
        external
        pure
        returns (RangeLiquidity4.ShareState memory, uint256[4] memory)
    {
        return RangeLiquidity4.removeProportional(position, shares);
    }
}

contract RangeLiquidity4Test {
    uint256 private constant WAD = 1e18;
    RangeLiquidity4Harness private harness = new RangeLiquidity4Harness();

    function testInteriorAttributionSeparatesVirtualAndRealInventory() public pure {
        (Torus4.State memory state, SegmentedTorus4.Tick[] memory ticks, uint256[4] memory reserves) = _interiorState();
        RangeLiquidity4.Attribution[] memory ranges = RangeLiquidity4.attribute(state, ticks, reserves);

        assert(ranges.length == 2);
        for (uint256 asset; asset < 4; ++asset) {
            assert(ranges[0].coordinates[asset] == 50 * WAD);
            assert(ranges[1].coordinates[asset] == 50 * WAD);
            assert(ranges[0].virtualOffset > 0 && ranges[1].virtualOffset > 0);
            assert(ranges[0].realInventory[asset] + ranges[0].virtualOffset == ranges[0].coordinates[asset]);
            assert(ranges[1].realInventory[asset] + ranges[1].virtualOffset == ranges[1].coordinates[asset]);
            assert(ranges[0].coordinates[asset] + ranges[1].coordinates[asset] == reserves[asset]);
        }
    }

    function testBoundaryRangeKeepsAnIndependentRedeemableInventory() public pure {
        (Torus4.State memory state, SegmentedTorus4.Tick[] memory ticks, uint256[4] memory reserves) = _interiorState();
        SegmentedTorus4.Result memory swapped = SegmentedTorus4.swapExactIn(state, ticks, reserves, 0, 1, 100 * WAD);
        ticks = _ticks();
        ticks[0].isInterior = false;
        RangeLiquidity4.Attribution[] memory ranges = RangeLiquidity4.attribute(swapped.state, ticks, swapped.reserves);

        assert(!ranges[0].isInterior && ranges[1].isInterior);
        for (uint256 asset; asset < 4; ++asset) {
            assert(ranges[0].coordinates[asset] >= ranges[0].virtualOffset);
            assert(ranges[1].coordinates[asset] >= ranges[1].virtualOffset);
            // Independent floors can leave or overshoot the aggregate coordinate by
            // a few WAD-wei. C10 records this explicitly as non-redeemable dust.
            _assertApproxEqAbs(ranges[0].coordinates[asset] + ranges[1].coordinates[asset], swapped.reserves[asset], 8);
        }
    }

    function testBootstrapOffPegAdditionAndPartialWithdrawalStayRangeSpecific() public pure {
        (Torus4.State memory state, SegmentedTorus4.Tick[] memory ticks, uint256[4] memory reserves) = _interiorState();
        SegmentedTorus4.Result memory swapped = SegmentedTorus4.swapExactIn(state, ticks, reserves, 0, 1, 60 * WAD);
        RangeLiquidity4.Attribution[] memory ranges = RangeLiquidity4.attribute(swapped.state, ticks, swapped.reserves);

        RangeLiquidity4.ShareState memory first = RangeLiquidity4.bootstrap(ranges[0].realInventory, 100 * WAD);
        RangeLiquidity4.ShareState memory second = RangeLiquidity4.bootstrap(ranges[1].realInventory, 100 * WAD);
        uint256[4] memory deposit;
        for (uint256 asset; asset < 4; ++asset) {
            deposit[asset] = first.realInventory[asset] / 2;
        }
        (RangeLiquidity4.ShareState memory expanded, uint256 minted) = RangeLiquidity4.addProportional(first, deposit);
        (RangeLiquidity4.ShareState memory remaining, uint256[4] memory withdrawn) =
            RangeLiquidity4.removeProportional(expanded, 25 * WAD);

        assert(minted == 50 * WAD);
        assert(expanded.totalShares == 150 * WAD);
        assert(remaining.totalShares == 125 * WAD);
        assert(second.totalShares == 100 * WAD);
        for (uint256 asset; asset < 4; ++asset) {
            assert(withdrawn[asset] == expanded.realInventory[asset] / 6);
            assert(remaining.realInventory[asset] + withdrawn[asset] == expanded.realInventory[asset]);
            assert(second.realInventory[asset] == ranges[1].realInventory[asset]);
        }
    }

    function testFullWithdrawalReturnsEveryLastUnit() public pure {
        uint256[4] memory inventory = [uint256(7 * WAD + 1), 9 * WAD + 2, 11 * WAD + 3, 13 * WAD + 4];
        RangeLiquidity4.ShareState memory position = RangeLiquidity4.bootstrap(inventory, 3 * WAD);
        (RangeLiquidity4.ShareState memory empty, uint256[4] memory withdrawn) =
            RangeLiquidity4.removeProportional(position, position.totalShares);

        assert(empty.totalShares == 0);
        for (uint256 asset; asset < 4; ++asset) {
            assert(withdrawn[asset] == inventory[asset]);
            assert(empty.realInventory[asset] == 0);
        }
    }

    function testRejectsNonProportionalDeposit() public {
        uint256[4] memory inventory = [uint256(10 * WAD), 20 * WAD, 30 * WAD, 40 * WAD];
        RangeLiquidity4.ShareState memory position = RangeLiquidity4.bootstrap(inventory, 10 * WAD);
        uint256[4] memory badDeposit = [uint256(WAD), 2 * WAD, 3 * WAD, 5 * WAD];
        _expect(abi.encodeCall(harness.add, (position, badDeposit)), RangeLiquidity4.NonProportionalDeposit.selector);
    }

    function testMultipleLpsAndRangesCannotWithdrawEachOthersInventory() public {
        RangeShareBook4 book = new RangeShareBook4(address(this));
        uint256[4] memory firstInventory = [uint256(10 * WAD), 20 * WAD, 30 * WAD, 40 * WAD];
        uint256[4] memory secondInventory = [uint256(50 * WAD), 60 * WAD, 70 * WAD, 80 * WAD];
        book.bootstrap(1, address(this), firstInventory, 100 * WAD);
        book.bootstrap(2, address(0xBEEF), secondInventory, 100 * WAD);

        uint256[4] memory deposit = [uint256(5 * WAD), 10 * WAD, 15 * WAD, 20 * WAD];
        assert(book.addProportional(1, deposit) == 50 * WAD);
        uint256[4] memory withdrawn = book.removeProportional(1, 25 * WAD);
        RangeLiquidity4.ShareState memory second = book.position(2);

        assert(book.sharesOf(1, address(this)) == 125 * WAD);
        assert(book.sharesOf(2, address(0xBEEF)) == 100 * WAD);
        assert(withdrawn[0] == 2_500_000_000_000_000_000);
        for (uint256 asset; asset < 4; ++asset) {
            assert(second.realInventory[asset] == secondInventory[asset]);
        }
    }

    function _interiorState()
        private
        pure
        returns (Torus4.State memory state, SegmentedTorus4.Tick[] memory ticks, uint256[4] memory reserves)
    {
        state = Torus4.State({rInterior: 200 * WAD, kBoundary: 0, sBoundary: 0});
        ticks = _ticks();
        reserves = [uint256(100 * WAD), 100 * WAD, 100 * WAD, 100 * WAD];
    }

    function _ticks() private pure returns (SegmentedTorus4.Tick[] memory ticks) {
        ticks = new SegmentedTorus4.Tick[](2);
        ticks[0] = SegmentedTorus4.Tick({radius: 100 * WAD, k: 110 * WAD, isInterior: true});
        ticks[1] = SegmentedTorus4.Tick({radius: 100 * WAD, k: 130 * WAD, isInterior: true});
    }

    function _expect(bytes memory callData, bytes4 selector) private {
        (bool success, bytes memory result) = address(harness).call(callData);
        assert(!success && result.length >= 4);
        // forge-lint: disable-next-line(unsafe-typecast)
        assert(bytes4(result) == selector);
    }

    function _assertApproxEqAbs(uint256 actual, uint256 expected, uint256 tolerance) private pure {
        assert(actual >= expected ? actual - expected <= tolerance : expected - actual <= tolerance);
    }
}
