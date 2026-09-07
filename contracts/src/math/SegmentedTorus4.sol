// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {FixedPointMath} from "./FixedPointMath.sol";
import {Sphere4} from "./Sphere4.sol";
import {Torus4} from "./Torus4.sol";

/// @notice Bounded tick-crossing wrapper around Torus4's fixed-partition quote.
/// @dev Pure engine only: callers remain responsible for real inventory, fees,
///      settlement, range ownership and token transfers.
library SegmentedTorus4 {
    using FixedPointMath for uint256;

    uint256 internal constant WAD = 1e18;
    uint256 internal constant MAX_TICKS = 16;
    uint256 internal constant MAX_CROSSINGS = 8;
    uint256 internal constant CROSSING_SAMPLES = 48;
    uint256 internal constant CROSSING_ITERATIONS = 96;
    uint256 internal constant MAX_COMPONENT = 1e29;

    error InvalidTickSet();
    error AggregateMismatch();
    error TooManyCrossings();
    error AllBoundaryUnsupported();
    error CrossingNoRoot();
    error CrossingNoProgress();
    error CrossingOutputInvalid();

    struct Tick {
        uint256 radius;
        uint256 k;
        bool isInterior;
    }

    struct Result {
        Torus4.State state;
        uint256[4] reserves;
        uint256 amountOut;
        uint256 crossings;
        uint256 interiorBitmap;
    }

    /// @notice Execute an exact-input no-fee swap across at most eight tick changes.
    /// @dev Mutates `ticks` in memory only. The returned bitmap exposes final
    ///      statuses to a caller that cannot retain memory-array mutations.
    function swapExactIn(
        Torus4.State memory state,
        Tick[] memory ticks,
        uint256[4] memory reserves,
        uint8 input,
        uint8 output,
        uint256 amountIn
    ) internal pure returns (Result memory result) {
        _validateAggregate(state, ticks);
        if (!Torus4.isInvariant(state, reserves)) revert AggregateMismatch();
        uint256 remaining = amountIn;
        uint256 totalOut;
        uint256 crossingEvents;

        for (uint256 iteration; iteration < MAX_CROSSINGS; ++iteration) {
            if (remaining == 0) break;
            if (state.rInterior == 0) revert AllBoundaryUnsupported();
            uint256 alphaBefore = _alphaNormalized(state, reserves);
            uint256 candidateOut = Torus4.quoteExactIn(state, reserves, input, output, remaining);
            uint256[4] memory candidate = _apply(reserves, input, output, remaining, candidateOut);
            uint256 alphaAfter = _alphaNormalized(state, candidate);
            (bool crosses, uint256 lambda) = _nextCrossing(ticks, alphaBefore, alphaAfter);

            if (!crosses) {
                reserves = candidate;
                totalOut += candidateOut;
                remaining = 0;
                break;
            }

            uint256 partialIn;
            uint256 partialOut;
            if (alphaAfter == lambda) {
                // The full quote already lands on the discrete boundary. Avoid
                // re-solving it and leaving a one-wei continuation artifact.
                partialIn = remaining;
                partialOut = candidateOut;
            } else {
                (partialIn, partialOut) = _quoteToBoundary(state, reserves, input, output, remaining, lambda);
            }
            if (partialIn == 0 || partialIn > remaining) revert CrossingNoProgress();
            reserves = _apply(reserves, input, output, partialIn, partialOut);
            totalOut += partialOut;
            remaining -= partialIn;
            crossingEvents += _flipAtBoundary(ticks, lambda, alphaAfter > alphaBefore);
            state = _aggregate(ticks);
            if (!Torus4.isInvariant(state, reserves)) revert AggregateMismatch();

            if (iteration == MAX_CROSSINGS - 1 && remaining > 0) revert TooManyCrossings();
        }
        if (remaining > 0) revert TooManyCrossings();
        result = Result({
            state: state,
            reserves: reserves,
            amountOut: totalOut,
            crossings: crossingEvents,
            interiorBitmap: _interiorBitmap(ticks)
        });
    }

    function _validateAggregate(Torus4.State memory state, Tick[] memory ticks) private pure {
        Torus4.State memory rebuilt = _aggregate(ticks);
        if (
            rebuilt.rInterior != state.rInterior || rebuilt.kBoundary != state.kBoundary
                || rebuilt.sBoundary != state.sBoundary
        ) revert AggregateMismatch();
    }

    function _aggregate(Tick[] memory ticks) private pure returns (Torus4.State memory state) {
        if (ticks.length == 0 || ticks.length > MAX_TICKS) revert InvalidTickSet();
        for (uint256 i; i < ticks.length; ++i) {
            Tick memory tick = ticks[i];
            Sphere4.TickGeometry memory geometry = Sphere4.tick(tick.radius, tick.k);
            if (geometry.isDegenerate) revert InvalidTickSet();
            if (tick.isInterior) {
                state.rInterior += tick.radius;
            } else {
                state.kBoundary += tick.k;
                state.sBoundary += geometry.boundaryRadius;
            }
        }
    }

    function _alphaNormalized(Torus4.State memory state, uint256[4] memory reserves) private pure returns (uint256) {
        if (state.rInterior == 0) revert AllBoundaryUnsupported();
        uint256 sum;
        for (uint256 i; i < 4; ++i) {
            sum += reserves[i];
        }
        uint256 alphaTotal = sum / 2;
        if (alphaTotal < state.kBoundary) revert AggregateMismatch();
        return (alphaTotal - state.kBoundary).divWadDown(state.rInterior);
    }

    function _nextCrossing(Tick[] memory ticks, uint256 oldAlpha, uint256 newAlpha)
        private
        pure
        returns (bool found, uint256 lambda)
    {
        if (newAlpha > oldAlpha) {
            uint256 best = type(uint256).max;
            for (uint256 i; i < ticks.length; ++i) {
                Tick memory tick = ticks[i];
                if (!tick.isInterior) continue;
                uint256 candidate = tick.k.divWadDown(tick.radius);
                if (candidate > oldAlpha && candidate <= newAlpha && candidate < best) {
                    best = candidate;
                    found = true;
                }
            }
            return (found, best);
        }
        if (newAlpha < oldAlpha) {
            uint256 best;
            for (uint256 i; i < ticks.length; ++i) {
                Tick memory tick = ticks[i];
                if (tick.isInterior) continue;
                uint256 candidate = tick.k.divWadDown(tick.radius);
                if (candidate < oldAlpha && candidate >= newAlpha && candidate > best) {
                    best = candidate;
                    found = true;
                }
            }
            return (found, best);
        }
    }

    /// @dev At alpha_int/r_int=lambda, sum(reserves) is fixed. Therefore
    ///      input-output is fixed and only one scalar physical root remains.
    function _quoteToBoundary(
        Torus4.State memory state,
        uint256[4] memory reserves,
        uint8 input,
        uint8 output,
        uint256 remaining,
        uint256 lambda
    ) private pure returns (uint256 amountIn, uint256 amountOut) {
        uint256 targetAlphaInterior = state.rInterior.mulWadDown(lambda);
        uint256 targetSum = 2 * (targetAlphaInterior + state.kBoundary);
        uint256 currentSum;
        for (uint256 i; i < 4; ++i) {
            currentSum += reserves[i];
        }
        if (targetSum > uint256(type(int256).max) || currentSum > uint256(type(int256).max)) revert CrossingNoRoot();
        // forge-lint: disable-next-line(unsafe-typecast)
        int256 delta = int256(targetSum) - int256(currentSum);
        int256 lower = delta > 0 ? delta : int256(0);
        // output = input - delta must remain strictly below the output reserve.
        if (reserves[output] - 1 > uint256(type(int256).max) || remaining > uint256(type(int256).max)) {
            revert CrossingNoRoot();
        }
        // forge-lint: disable-next-line(unsafe-typecast)
        int256 upperByReserve = int256(reserves[output] - 1) + delta;
        // forge-lint: disable-next-line(unsafe-typecast)
        int256 upper = int256(remaining) < upperByReserve ? int256(remaining) : upperByReserve;
        if (lower < 0 || upper <= lower) revert CrossingNoRoot();

        (bool found, uint256 root) = _firstRoot(state, reserves, input, output, _asUint(lower), _asUint(upper), delta);
        if (!found) revert CrossingNoRoot();
        amountIn = root;
        int256 signedOut = _asInt(root) - delta;
        if (signedOut < 0) revert CrossingOutputInvalid();
        // forge-lint: disable-next-line(unsafe-typecast)
        amountOut = uint256(signedOut);
    }

    function _firstRoot(
        Torus4.State memory state,
        uint256[4] memory reserves,
        uint8 input,
        uint8 output,
        uint256 lower,
        uint256 upper,
        int256 delta
    ) private pure returns (bool found, uint256 root) {
        uint256 previous = lower;
        int256 previousResidual = _boundaryResidual(state, reserves, input, output, previous, delta);
        for (uint256 sample = 1; sample <= CROSSING_SAMPLES; ++sample) {
            uint256 candidate = lower + FixedPointMath.mulDivDown(upper - lower, sample, CROSSING_SAMPLES);
            int256 candidateResidual = _boundaryResidual(state, reserves, input, output, candidate, delta);
            if (_crossesOrTouches(previousResidual, candidateResidual)) {
                return (true, _bisect(state, reserves, input, output, previous, candidate, delta, previousResidual));
            }
            previous = candidate;
            previousResidual = candidateResidual;
        }
    }

    function _bisect(
        Torus4.State memory state,
        uint256[4] memory reserves,
        uint8 input,
        uint8 output,
        uint256 low,
        uint256 high,
        int256 delta,
        int256 lowResidual
    ) private pure returns (uint256) {
        int256 highResidual = _boundaryResidual(state, reserves, input, output, high, delta);
        for (uint256 i; i < CROSSING_ITERATIONS && low < high; ++i) {
            uint256 middle = low + (high - low) / 2;
            int256 middleResidual = _boundaryResidual(state, reserves, input, output, middle, delta);
            if (middleResidual == 0) return middle;
            if (_crossesOrTouches(lowResidual, middleResidual)) {
                high = middle;
                highResidual = middleResidual;
            } else {
                low = middle;
                lowResidual = middleResidual;
            }
        }
        return _abs(lowResidual) <= _abs(highResidual) ? low : high;
    }

    function _boundaryResidual(
        Torus4.State memory state,
        uint256[4] memory reserves,
        uint8 input,
        uint8 output,
        uint256 amountIn,
        int256 delta
    ) private pure returns (int256) {
        int256 signedOut = _asInt(amountIn) - delta;
        if (signedOut < 0) revert CrossingOutputInvalid();
        // forge-lint: disable-next-line(unsafe-typecast)
        return Torus4.residual(state, _apply(reserves, input, output, amountIn, uint256(signedOut)));
    }

    function _flipAtBoundary(Tick[] memory ticks, uint256 lambda, bool rising) private pure returns (uint256 flips) {
        for (uint256 i; i < ticks.length; ++i) {
            uint256 candidate = ticks[i].k.divWadDown(ticks[i].radius);
            if (candidate != lambda) continue;
            if (rising && !ticks[i].isInterior) revert AggregateMismatch();
            if (!rising && ticks[i].isInterior) revert AggregateMismatch();
            ticks[i].isInterior = !rising;
            ++flips;
        }
        if (flips == 0) revert InvalidTickSet();
    }

    function _apply(uint256[4] memory reserves, uint8 input, uint8 output, uint256 amountIn, uint256 amountOut)
        private
        pure
        returns (uint256[4] memory next)
    {
        if (input >= 4 || output >= 4 || input == output) revert CrossingOutputInvalid();
        if (amountOut >= reserves[output] || reserves[input] > MAX_COMPONENT - amountIn) {
            revert CrossingOutputInvalid();
        }
        for (uint256 i; i < 4; ++i) {
            next[i] = reserves[i];
        }
        next[input] += amountIn;
        next[output] -= amountOut;
    }

    function _interiorBitmap(Tick[] memory ticks) private pure returns (uint256 bitmap) {
        for (uint256 i; i < ticks.length; ++i) {
            if (ticks[i].isInterior) bitmap |= uint256(1) << i;
        }
    }

    function _crossesOrTouches(int256 first, int256 second) private pure returns (bool) {
        return first == 0 || second == 0 || (first < 0 && second > 0) || (first > 0 && second < 0);
    }

    function _abs(int256 value) private pure returns (uint256) {
        if (value >= 0) {
            // forge-lint: disable-next-line(unsafe-typecast)
            return uint256(value);
        }
        unchecked {
            return uint256(-(value + 1)) + 1;
        }
    }

    function _asUint(int256 value) private pure returns (uint256) {
        if (value < 0) revert CrossingNoRoot();
        // The branch proves the signed value is representable as uint256.
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint256(value);
    }

    function _asInt(uint256 value) private pure returns (int256) {
        if (value > uint256(type(int256).max)) revert CrossingNoRoot();
        // The explicit bound proves this conversion cannot truncate.
        // forge-lint: disable-next-line(unsafe-typecast)
        return int256(value);
    }
}
