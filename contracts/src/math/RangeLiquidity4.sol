// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {FixedPointMath} from "./FixedPointMath.sol";
import {Sphere4} from "./Sphere4.sol";
import {Torus4} from "./Torus4.sol";
import {SegmentedTorus4} from "./SegmentedTorus4.sol";

/// @notice Per-range inventory attribution and proportional-share accounting for four-asset Orbital states.
/// @dev Virtual offsets are never included in `realInventory` or LP withdrawals.
library RangeLiquidity4 {
    using FixedPointMath for uint256;

    uint256 internal constant MAX_TICKS = 16;

    error InvalidRangeSet();
    error AggregateMismatch();
    error AttributionUnavailable();
    error NegativeRealInventory();
    error InvalidBootstrap();
    error NonProportionalDeposit();
    error ZeroShares();
    error InsufficientShares();

    struct Attribution {
        uint256 virtualOffset;
        uint256[4] coordinates;
        uint256[4] realInventory;
        bool isInterior;
    }

    struct ShareState {
        uint256 totalShares;
        uint256[4] realInventory;
    }

    /// @notice Reconstructs every range's current coordinate and redeemable inventory.
    /// @dev The aggregate invariant fixes a common centered direction. Interior ranges
    ///      receive it in radius proportion; boundary ranges receive it in boundary-radius
    ///      proportion. Integer division rounds down, so callers must account for at most
    ///      bounded unassigned coordinate dust separately from LP claims.
    function attribute(Torus4.State memory state, SegmentedTorus4.Tick[] memory ticks, uint256[4] memory reserves)
        internal
        pure
        returns (Attribution[] memory ranges)
    {
        _validateAggregate(state, ticks, reserves);
        ranges = new Attribution[](ticks.length);

        uint256 sum;
        for (uint256 i; i < 4; ++i) {
            sum += reserves[i];
        }
        uint256 mean = sum / 4;
        uint256 alphaInterior = sum / 2 - state.kBoundary;
        uint256 wNorm = _wNorm(reserves, mean);
        if (wNorm < state.sBoundary) revert AttributionUnavailable();
        uint256 interiorWNorm = wNorm - state.sBoundary;

        for (uint256 i; i < ticks.length; ++i) {
            Sphere4.TickGeometry memory geometry = Sphere4.tick(ticks[i].radius, ticks[i].k);
            if (geometry.isDegenerate) revert InvalidRangeSet();
            ranges[i].virtualOffset = geometry.minimumReserve;
            ranges[i].isInterior = ticks[i].isInterior;

            uint256 alphaPart;
            uint256 directionNumerator;
            uint256 directionDenominator;
            if (ticks[i].isInterior) {
                if (state.rInterior == 0) revert AttributionUnavailable();
                alphaPart = FixedPointMath.mulDivDown(alphaInterior, ticks[i].radius, state.rInterior);
                directionNumerator = FixedPointMath.mulDivDown(interiorWNorm, ticks[i].radius, state.rInterior);
                directionDenominator = wNorm;
            } else {
                alphaPart = ticks[i].k;
                directionNumerator = geometry.boundaryRadius;
                directionDenominator = wNorm;
            }

            for (uint256 asset; asset < 4; ++asset) {
                uint256 coordinate = alphaPart / 2;
                if (wNorm != 0 && directionNumerator != 0) {
                    uint256 deviation = reserves[asset] >= mean ? reserves[asset] - mean : mean - reserves[asset];
                    uint256 directional = FixedPointMath.mulDivDown(deviation, directionNumerator, directionDenominator);
                    coordinate = reserves[asset] >= mean ? coordinate + directional : coordinate - directional;
                }
                if (coordinate < geometry.minimumReserve) revert NegativeRealInventory();
                ranges[i].coordinates[asset] = coordinate;
                ranges[i].realInventory[asset] = coordinate - geometry.minimumReserve;
            }
        }
    }

    /// @notice Creates the first claim over a range's already-attributed real inventory.
    /// @dev Shares are denominated in WAD and chosen by the caller at bootstrap; their
    ///      value is defined solely by the range's inventory, never the global book.
    function bootstrap(uint256[4] memory realInventory, uint256 shares)
        internal
        pure
        returns (ShareState memory position)
    {
        if (shares == 0) revert ZeroShares();
        for (uint256 i; i < 4; ++i) {
            if (realInventory[i] == 0) revert InvalidBootstrap();
            position.realInventory[i] = realInventory[i];
        }
        position.totalShares = shares;
    }

    /// @notice Mints shares only for an exact proportional addition to this range.
    function addProportional(ShareState memory position, uint256[4] memory amounts)
        internal
        pure
        returns (ShareState memory next, uint256 mintedShares)
    {
        if (position.totalShares == 0) revert ZeroShares();
        if (position.realInventory[0] == 0) revert InvalidBootstrap();
        mintedShares = FixedPointMath.mulDivDown(amounts[0], position.totalShares, position.realInventory[0]);
        if (mintedShares == 0) revert ZeroShares();
        for (uint256 i; i < 4; ++i) {
            if (amounts[i] != FixedPointMath.mulDivDown(position.realInventory[i], mintedShares, position.totalShares))
            {
                revert NonProportionalDeposit();
            }
            next.realInventory[i] = position.realInventory[i] + amounts[i];
        }
        next.totalShares = position.totalShares + mintedShares;
    }

    /// @notice Burns a range-specific share claim and returns only that range's real inventory.
    function removeProportional(ShareState memory position, uint256 shares)
        internal
        pure
        returns (ShareState memory next, uint256[4] memory amountsOut)
    {
        if (shares == 0) revert ZeroShares();
        if (shares > position.totalShares) revert InsufficientShares();
        for (uint256 i; i < 4; ++i) {
            amountsOut[i] = shares == position.totalShares
                ? position.realInventory[i]
                : FixedPointMath.mulDivDown(position.realInventory[i], shares, position.totalShares);
            next.realInventory[i] = position.realInventory[i] - amountsOut[i];
        }
        next.totalShares = position.totalShares - shares;
    }

    function _validateAggregate(
        Torus4.State memory state,
        SegmentedTorus4.Tick[] memory ticks,
        uint256[4] memory reserves
    ) private pure {
        if (ticks.length == 0 || ticks.length > MAX_TICKS || !Torus4.isInvariant(state, reserves)) {
            revert AggregateMismatch();
        }
        Torus4.State memory aggregate;
        for (uint256 i; i < ticks.length; ++i) {
            Sphere4.TickGeometry memory geometry = Sphere4.tick(ticks[i].radius, ticks[i].k);
            if (geometry.isDegenerate) revert InvalidRangeSet();
            if (ticks[i].isInterior) {
                aggregate.rInterior += ticks[i].radius;
            } else {
                aggregate.kBoundary += ticks[i].k;
                aggregate.sBoundary += geometry.boundaryRadius;
            }
        }
        if (
            aggregate.rInterior != state.rInterior || aggregate.kBoundary != state.kBoundary
                || aggregate.sBoundary != state.sBoundary
        ) revert AggregateMismatch();
    }

    function _wNorm(uint256[4] memory reserves, uint256 mean) private pure returns (uint256 norm) {
        uint256 sumSquares;
        for (uint256 i; i < 4; ++i) {
            uint256 deviation = reserves[i] >= mean ? reserves[i] - mean : mean - reserves[i];
            sumSquares += deviation.mulWadDown(deviation);
        }
        return sumSquares.sqrtWad();
    }
}
