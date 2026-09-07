// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {FixedPointMath} from "./FixedPointMath.sol";

/// @notice Fixed-partition four-asset aggregate Orbital invariant and quote solver.
/// @dev Tick crossing is intentionally outside this library. A caller must split
///      a trade before a range changes between interior and boundary states.
library Torus4 {
    using FixedPointMath for uint256;

    uint256 internal constant WAD = 1e18;
    uint256 internal constant SQRT_N_WAD = 2e18;
    uint256 internal constant MAX_COMPONENT = 1e29;
    uint256 internal constant ROOT_SAMPLES = 48;
    uint256 internal constant ROOT_ITERATIONS = 96;
    // Solver acceptance rule, in WAD relative residual units (1e-9).
    uint256 internal constant MAX_RELATIVE_DRIFT_WAD = 1e9;

    error InvalidState();
    error AllBoundaryUnsupported();
    error InvalidReserve();
    error InvalidAssetIndex();
    error SameAsset();
    error ZeroAmountIn();
    error InsufficientOutputReserve();
    error NoPhysicalRoot();
    error InvariantDrift();

    struct State {
        // Sum of radii of all interior ranges.
        uint256 rInterior;
        // Sum of plane projections k for boundary ranges.
        uint256 kBoundary;
        // Sum of boundary-sphere radii s for boundary ranges.
        uint256 sBoundary;
    }

    /// @notice Signed torus LHS minus rInterior², in WAD-squared token units.
    function residual(State memory state, uint256[4] memory reserves) internal pure returns (int256) {
        _validateState(state);
        (uint256 sum, uint256 sumSquares) = _reserveSums(reserves);
        uint256 alphaTotal = sum / 2;
        if (alphaTotal < state.kBoundary) revert InvalidState();
        uint256 alphaInterior = alphaTotal - state.kBoundary;
        // ||w||² = Σxᵢ² - (Σxᵢ)²/n. Saturate the one-unit negative that a
        // floored quotient can produce for an otherwise balanced reserve vector.
        uint256 projectionSquares = FixedPointMath.mulDivDown(sum, sum, 4 * WAD);
        uint256 centeredSquares = sumSquares > projectionSquares ? sumSquares - projectionSquares : 0;
        uint256 wNorm = centeredSquares.sqrtWad();
        uint256 radialTarget = state.rInterior * 2;
        uint256 first = alphaInterior >= radialTarget ? alphaInterior - radialTarget : radialTarget - alphaInterior;
        uint256 second = wNorm >= state.sBoundary ? wNorm - state.sBoundary : state.sBoundary - wNorm;
        uint256 lhs = first.mulWadDown(first) + second.mulWadDown(second);
        uint256 rhs = state.rInterior.mulWadDown(state.rInterior);
        return _signedDifference(lhs, rhs);
    }

    /// @notice Returns whether a state is within the solver's bounded drift rule.
    function isInvariant(State memory state, uint256[4] memory reserves) internal pure returns (bool) {
        int256 value = residual(state, reserves);
        uint256 absoluteResidual = _abs(value);
        uint256 rhs = state.rInterior.mulWadDown(state.rInterior);
        if (rhs == 0) return absoluteResidual == 0;
        return absoluteResidual.divWadDown(rhs) <= MAX_RELATIVE_DRIFT_WAD;
    }

    /// @notice Exact-input quote while the interior/boundary partition is fixed.
    /// @dev Finds the first positive output root by scanning then bisecting a
    ///      bounded interval. It never mutates reserves and rejects a quote whose
    ///      post-trade residual exceeds MAX_RELATIVE_DRIFT_WAD.
    function quoteExactIn(State memory state, uint256[4] memory reserves, uint8 input, uint8 output, uint256 amountIn)
        internal
        pure
        returns (uint256 amountOut)
    {
        _validateState(state);
        if (state.rInterior == 0) revert AllBoundaryUnsupported();
        if (input >= 4 || output >= 4) revert InvalidAssetIndex();
        if (input == output) revert SameAsset();
        if (amountIn == 0) revert ZeroAmountIn();
        if (reserves[output] < 2) revert InsufficientOutputReserve();
        if (!isInvariant(state, reserves)) revert InvalidState();
        if (reserves[input] > MAX_COMPONENT - amountIn) revert InvalidReserve();

        uint256 maximumOutput = reserves[output] - 1;
        int256 previousResidual = _postTradeResidual(state, reserves, input, output, amountIn, 0);
        uint256 previousOutput;

        for (uint256 sample = 1; sample <= ROOT_SAMPLES; ++sample) {
            uint256 candidateOutput = FixedPointMath.mulDivDown(maximumOutput, sample, ROOT_SAMPLES);
            int256 candidateResidual = _postTradeResidual(state, reserves, input, output, amountIn, candidateOutput);
            if (_crossesOrTouches(previousResidual, candidateResidual)) {
                amountOut = _bisect(
                    state, reserves, input, output, amountIn, previousOutput, candidateOutput, previousResidual
                );
                uint256[4] memory finalReserves = _apply(reserves, input, output, amountIn, amountOut);
                if (!isInvariant(state, finalReserves)) revert InvariantDrift();
                return amountOut;
            }
            previousOutput = candidateOutput;
            previousResidual = candidateResidual;
        }
        revert NoPhysicalRoot();
    }

    function _bisect(
        State memory state,
        uint256[4] memory reserves,
        uint8 input,
        uint8 output,
        uint256 amountIn,
        uint256 low,
        uint256 high,
        int256 lowResidual
    ) private pure returns (uint256) {
        int256 highResidual = _postTradeResidual(state, reserves, input, output, amountIn, high);
        for (uint256 i; i < ROOT_ITERATIONS && low < high; ++i) {
            uint256 middle = low + (high - low) / 2;
            int256 middleResidual = _postTradeResidual(state, reserves, input, output, amountIn, middle);
            if (middleResidual == 0) return middle;
            if (_crossesOrTouches(lowResidual, middleResidual)) {
                high = middle;
                highResidual = middleResidual;
            } else {
                low = middle;
                lowResidual = middleResidual;
            }
        }
        // Integer WAD output can put the continuous root between two values.
        // Choose the closer endpoint, never one merely because it was last seen.
        return _abs(lowResidual) <= _abs(highResidual) ? low : high;
    }

    function _postTradeResidual(
        State memory state,
        uint256[4] memory reserves,
        uint8 input,
        uint8 output,
        uint256 amountIn,
        uint256 amountOut
    ) private pure returns (int256) {
        return residual(state, _apply(reserves, input, output, amountIn, amountOut));
    }

    function _apply(uint256[4] memory reserves, uint8 input, uint8 output, uint256 amountIn, uint256 amountOut)
        private
        pure
        returns (uint256[4] memory next)
    {
        if (amountOut >= reserves[output]) revert InsufficientOutputReserve();
        if (reserves[input] > MAX_COMPONENT - amountIn) revert InvalidReserve();
        // Memory-array assignment aliases rather than copies. The quote solver
        // evaluates many candidates, so copy each coordinate explicitly.
        for (uint256 i; i < 4; ++i) {
            next[i] = reserves[i];
        }
        next[input] += amountIn;
        next[output] -= amountOut;
    }

    function _reserveSums(uint256[4] memory reserves) private pure returns (uint256 sum, uint256 sumSquares) {
        for (uint256 i; i < 4; ++i) {
            if (reserves[i] > MAX_COMPONENT) revert InvalidReserve();
            sum += reserves[i];
            sumSquares += reserves[i].mulWadDown(reserves[i]);
        }
    }

    function _validateState(State memory state) private pure {
        if (state.rInterior > MAX_COMPONENT || state.kBoundary > MAX_COMPONENT || state.sBoundary > MAX_COMPONENT) {
            revert InvalidState();
        }
        // A quote has a stronger rInterior != 0 check so residual can still
        // inspect an all-boundary state when later crossing code needs it.
    }

    function _crossesOrTouches(int256 first, int256 second) private pure returns (bool) {
        return first == 0 || second == 0 || (first < 0 && second > 0) || (first > 0 && second < 0);
    }

    function _signedDifference(uint256 left, uint256 right) private pure returns (int256) {
        uint256 difference = left >= right ? left - right : right - left;
        if (difference > uint256(type(int256).max)) revert InvalidState();
        // forge-lint: disable-next-line(unsafe-typecast)
        int256 signedDifference = int256(difference);
        return left >= right ? signedDifference : -signedDifference;
    }

    function _abs(int256 value) private pure returns (uint256) {
        if (value >= 0) {
            // The branch proves the signed value fits in uint256 unchanged.
            // forge-lint: disable-next-line(unsafe-typecast)
            return uint256(value);
        }
        unchecked {
            return uint256(-(value + 1)) + 1;
        }
    }
}
