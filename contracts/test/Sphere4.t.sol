// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {FixedPointMath} from "../src/math/FixedPointMath.sol";
import {Sphere4} from "../src/math/Sphere4.sol";

contract Sphere4Harness {
    function tick(uint256 radius, uint256 k) external pure returns (Sphere4.TickGeometry memory) {
        return Sphere4.tick(radius, k);
    }

    function residual(uint256[4] memory reserves, uint256 radius) external pure returns (int256) {
        return Sphere4.sphereResidual(reserves, radius);
    }

    function rate(uint256[4] memory reserves, uint256 radius, uint8 input, uint8 output)
        external
        pure
        returns (uint256)
    {
        return Sphere4.spotRate(reserves, radius, input, output);
    }
}

contract Sphere4Test {
    uint256 private constant WAD = 1e18;
    Sphere4Harness private harness = new Sphere4Harness();

    function testHandDerivedTick() public pure {
        Sphere4.TickGeometry memory geometry = Sphere4.tick(14 * WAD, 15 * WAD);
        assertApproxEqAbs(geometry.minimumReserve, 3 * WAD, 2);
        assertApproxEqAbs(geometry.maximumReserve, 12 * WAD, 2);
        assertApproxEqAbs(geometry.realReserveAtPeg, 4 * WAD, 2);
        assertApproxEqAbs(geometry.capitalEfficiencyWad, 1_750_000_000_000_000_000, 2);
        assert(!geometry.isDegenerate);
    }

    function testEndpoints() public pure {
        Sphere4.TickGeometry memory narrow = Sphere4.tick(14 * WAD, 14 * WAD);
        assert(narrow.isDegenerate);
        assert(narrow.minimumReserve == 7 * WAD);
        assert(narrow.realReserveAtPeg == 0);
        Sphere4.TickGeometry memory wide = Sphere4.tick(14 * WAD, 21 * WAD);
        assert(wide.minimumReserve == 0);
        assert(wide.maximumReserve == 14 * WAD);
        assert(wide.capitalEfficiencyWad == WAD);
    }

    function testSphereAndPriceWitnesses() public pure {
        uint256[4] memory low = [uint256(3 * WAD), 9 * WAD, 9 * WAD, 9 * WAD];
        uint256[4] memory high = [uint256(12 * WAD), 6 * WAD, 6 * WAD, 6 * WAD];
        assert(Sphere4.sphereResidual(low, 14 * WAD) == 0);
        assert(Sphere4.sphereResidual(high, 14 * WAD) == 0);
        assertApproxEqAbs(Sphere4.spotRate(low, 14 * WAD, 0, 1), 2_200_000_000_000_000_000, 1);
        assertApproxEqAbs(Sphere4.spotRate(low, 14 * WAD, 1, 0), 454_545_454_545_454_545, 1);
    }

    function testFixedPointSquareRootsRoundDown() public pure {
        assert(FixedPointMath.sqrtWad(0) == 0);
        assert(FixedPointMath.sqrtWad(WAD) == WAD);
        assert(FixedPointMath.sqrtWad(9 * WAD) == 3 * WAD);
        assert(FixedPointMath.sqrtWad(3 * WAD) == 1_732_050_807_568_877_293);
    }

    function testFuzzSquareRootBounds(uint128 seed) public pure {
        uint256 value = uint256(seed) % 1e30;
        uint256 root = FixedPointMath.sqrtWad(value);
        assert(root * root <= value * WAD);
        assert((root + 1) * (root + 1) > value * WAD);
    }

    function testScaleInvariance() public pure {
        Sphere4.TickGeometry memory small = Sphere4.tick(14 * WAD, 15 * WAD);
        Sphere4.TickGeometry memory large = Sphere4.tick(14_000_000 * WAD, 15_000_000 * WAD);
        assertApproxEqAbs(large.minimumReserve / 1_000_000, small.minimumReserve, 2);
        assertApproxEqAbs(large.maximumReserve / 1_000_000, small.maximumReserve, 2);
        assert(large.capitalEfficiencyWad == small.capitalEfficiencyWad);
    }

    function testFuzzBounds(uint128 rawRadius, uint128 rawPosition) public pure {
        uint256 radius = (uint256(rawRadius) % 1e10 + 2) * WAD;
        uint256 k = radius + FixedPointMath.mulDivDown(radius / 2, rawPosition, type(uint128).max);
        Sphere4.TickGeometry memory geometry = Sphere4.tick(radius, k);
        assert(geometry.minimumReserve <= radius / 2);
        assert(geometry.minimumReserve <= geometry.maximumReserve);
        assert(geometry.maximumReserve <= radius);
        if (!geometry.isDegenerate) {
            assert(geometry.realReserveAtPeg > 0);
            assert(geometry.capitalEfficiencyWad >= WAD);
        }
    }

    function testFuzzRateReciprocity(uint64 seed) public pure {
        // 3t, 4t, 5t is an exact Pythagorean witness embedded in four dimensions.
        uint256 scale = uint256(seed) % 1e10 + 1;
        uint256 radius = 5 * scale * WAD;
        uint256[4] memory reserves = [2 * scale * WAD, scale * WAD, radius, radius];
        uint256 forward = Sphere4.spotRate(reserves, radius, 0, 1);
        uint256 reverse = Sphere4.spotRate(reserves, radius, 1, 0);
        assertApproxEqAbs(FixedPointMath.mulWadDown(forward, reverse), WAD, 3);
    }

    function testRejectsInvalidInputs() public {
        _expect(abi.encodeCall(harness.tick, (0, 0)), Sphere4.InvalidRadius.selector);
        _expect(abi.encodeCall(harness.tick, (3 * WAD + 1, 3 * WAD + 1)), Sphere4.InvalidRadius.selector);
        _expect(abi.encodeCall(harness.tick, (14 * WAD, 13 * WAD)), Sphere4.InvalidBoundary.selector);
        uint256[4] memory bad = [uint256(15 * WAD), 0, 0, 0];
        _expect(abi.encodeCall(harness.residual, (bad, 14 * WAD)), Sphere4.InvalidReserve.selector);
        uint256[4] memory empty = [uint256(14 * WAD), 14 * WAD, 14 * WAD, 0];
        _expect(abi.encodeCall(harness.rate, (empty, 14 * WAD, 0, 1)), Sphere4.SingularRate.selector);
        uint256[4] memory offSphere = [uint256(1 * WAD), 1 * WAD, 1 * WAD, 1 * WAD];
        _expect(abi.encodeCall(harness.rate, (offSphere, 14 * WAD, 0, 1)), Sphere4.InvalidReserve.selector);
    }

    function _expect(bytes memory callData, bytes4 selector) private {
        (bool success, bytes memory result) = address(harness).call(callData);
        assert(!success && result.length >= 4);
        // forge-lint: disable-next-line(unsafe-typecast)
        assert(bytes4(result) == selector);
    }

    function assertApproxEqAbs(uint256 actual, uint256 expected, uint256 tolerance) private pure {
        assert(actual >= expected ? actual - expected <= tolerance : expected - actual <= tolerance);
    }
}
