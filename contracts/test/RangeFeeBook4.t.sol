// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {RangeFeeBook4} from "../src/liquidity/RangeFeeBook4.sol";

contract FeeActor {
    function collect(RangeFeeBook4 book, uint256 id) external returns (uint256[4] memory) {
        return book.collect(id);
    }
}

contract RangeFeeBook4Test {
    uint256 private constant WAD = 1e18;
    RangeFeeBook4 private book = new RangeFeeBook4(address(this));
    FeeActor private alice = new FeeActor();
    FeeActor private bob = new FeeActor();

    function testAllocatesSegmentFeesByWeightAndClaimsByShares() public {
        book.mint(1, address(alice), 60 * WAD);
        book.mint(1, address(bob), 40 * WAD);
        book.mint(2, address(alice), 100 * WAD);
        uint256[] memory ids = new uint256[](2);
        ids[0] = 1;
        ids[1] = 2;
        uint256[] memory weights = new uint256[](2);
        weights[0] = 1;
        weights[1] = 3;
        uint256[4] memory fees = [uint256(400 * WAD), 0, 0, 0];
        book.accrue(ids, weights, fees);
        uint256[4] memory aliceOne = alice.collect(book, 1);
        uint256[4] memory bobOne = bob.collect(book, 1);
        uint256[4] memory aliceTwo = alice.collect(book, 2);
        assert(aliceOne[0] == 60 * WAD);
        assert(bobOne[0] == 40 * WAD);
        assert(aliceTwo[0] == 300 * WAD);
    }

    function testNewSharesCannotClaimPastFeesAndDustIsTracked() public {
        book.mint(3, address(alice), 3 * WAD);
        uint256[] memory ids = new uint256[](1);
        ids[0] = 3;
        uint256[] memory weights = new uint256[](1);
        weights[0] = 1;
        uint256[4] memory fees = [uint256(1), 0, 0, 0];
        book.accrue(ids, weights, fees);
        book.mint(3, address(bob), 3 * WAD);
        uint256[4] memory bobFees = bob.collect(book, 3);
        uint256[4] memory dust = book.dust(3);
        assert(bobFees[0] == 0);
        assert(dust[0] == 1);
    }
}
