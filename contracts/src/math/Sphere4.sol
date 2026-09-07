// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {FixedPointMath} from "./FixedPointMath.sol";

/// @notice WAD geometry for the four-token Orbital demo basket.
/// @dev This is geometry only: no swap settlement, ticks, LP shares or fees.
library Sphere4 {
    using FixedPointMath for uint256;

    uint256 internal constant WAD = 1e18;
    uint256 internal constant SQRT_N_WAD = 2e18;
    uint256 internal constant SQRT_THREE_WAD = 1_732_050_807_568_877_293;
    // sqrtWad squares an input after a WAD conversion; this keeps it below uint256.
    uint256 internal constant MAX_RADIUS = 1e29;

    error InvalidRadius();
    error InvalidBoundary();
    error InvalidReserve();
    error InvalidAssetIndex();
    error SameAsset();
    error SingularRate();

    struct TickGeometry {
        uint256 boundaryRadius;
        uint256 minimumReserve;
        uint256 maximumReserve;
        uint256 realReserveAtPeg;
        uint256 capitalEfficiencyWad;
        bool isDegenerate;
    }

    function equalPriceReserve(uint256 radius) internal pure returns (uint256) {
        _validateRadius(radius);
        return radius / 2;
    }

    function kBounds(uint256 radius) internal pure returns (uint256 minimum, uint256 maximum) {
        _validateRadius(radius);
        minimum = radius;
        maximum = radius + radius / 2;
    }

    function tick(uint256 radius, uint256 k) internal pure returns (TickGeometry memory result) {
        (uint256 minimumK, uint256 maximumK) = kBounds(radius);
        if (k < minimumK || k > maximumK) revert InvalidBoundary();
        uint256 q = radius / 2;
        if (k == minimumK) {
            return TickGeometry(0, q, q, 0, 0, true);
        }

        uint256 delta = k - minimumK;
        // s² = (k-r)(3r-k), expressed in WAD².
        uint256 sSquared = delta.mulWadDown(2 * radius - delta);
        uint256 boundaryRadius = sSquared.sqrtWad();
        uint256 mean = k / 2;
        uint256 spread = boundaryRadius.mulWadDown(SQRT_THREE_WAD) / 2;
        uint256 denominator = mean + spread;
        // m-d is evaluated as (k_max-k)²/(m+d) to preserve tiny virtual reserves.
        uint256 distanceToMaximum = maximumK - k;
        uint256 minimumReserve = distanceToMaximum.mulWadDown(distanceToMaximum).divWadDown(denominator);
        uint256 maximumReserve = denominator > radius ? radius : denominator;
        if (k == maximumK) {
            minimumReserve = 0;
            maximumReserve = radius;
        }
        if (minimumReserve > q || maximumReserve < minimumReserve) revert InvalidBoundary();
        uint256 realReserveAtPeg = q - minimumReserve;
        if (realReserveAtPeg == 0) revert InvalidBoundary();
        return TickGeometry({
            boundaryRadius: boundaryRadius,
            minimumReserve: minimumReserve,
            maximumReserve: maximumReserve,
            realReserveAtPeg: realReserveAtPeg,
            capitalEfficiencyWad: q.divWadDown(realReserveAtPeg),
            isDegenerate: false
        });
    }

    function sphereResidual(uint256[4] memory reserves, uint256 radius) internal pure returns (int256) {
        _validateRadius(radius);
        uint256 sum;
        for (uint256 i; i < 4; ++i) {
            if (reserves[i] > radius) revert InvalidReserve();
            sum += (radius - reserves[i]).mulWadDown(radius - reserves[i]);
        }
        uint256 radiusSquared = radius.mulWadDown(radius);
        uint256 difference = sum >= radiusSquared ? sum - radiusSquared : radiusSquared - sum;
        // MAX_RADIUS ensures this is far below int256.max; retain the check so
        // future changes to that arithmetic domain cannot silently truncate.
        if (difference > uint256(type(int256).max)) revert InvalidRadius();
        // forge-lint: disable-next-line(unsafe-typecast)
        int256 signedDifference = int256(difference);
        return sum >= radiusSquared ? signedDifference : -signedDifference;
    }

    /// @notice Infinitesimal output-token / input-token rate, before fees.
    function spotRate(uint256[4] memory reserves, uint256 radius, uint8 input, uint8 output)
        internal
        pure
        returns (uint256)
    {
        _validateRadius(radius);
        if (input >= 4 || output >= 4) revert InvalidAssetIndex();
        if (input == output) revert SameAsset();
        if (reserves[input] > radius || reserves[output] > radius) revert InvalidReserve();
        if (sphereResidual(reserves, radius) != 0) revert InvalidReserve();
        uint256 denominator = radius - reserves[output];
        if (denominator == 0) revert SingularRate();
        return (radius - reserves[input]).divWadDown(denominator);
    }

    function _validateRadius(uint256 radius) private pure {
        if (radius == 0 || radius > MAX_RADIUS || radius % 2 != 0) revert InvalidRadius();
    }
}
