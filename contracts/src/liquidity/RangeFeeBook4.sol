// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {FixedPointMath} from "../math/FixedPointMath.sol";

/// @notice Per-range LP share ledger with per-share fee checkpoints and explicit rounding dust.
/// @dev The controller (the Orbital hook) mints/burns shares and pays collected fees from
///      its own custody; this contract moves no ERC-20 tokens. Growth is Q128 per share so
///      six-decimal raw fees stay claimable against WAD-scale share supplies.
contract RangeFeeBook4 {
    uint256 internal constant Q128 = 1 << 128;

    address public immutable controller;
    mapping(uint256 => uint256) public totalShares;
    mapping(uint256 => mapping(address => uint256)) public sharesOf;
    mapping(uint256 => uint256[4]) private _growth;
    mapping(uint256 => uint256[4]) private _dust;
    mapping(uint256 => mapping(address => uint256[4])) private _debt;
    mapping(uint256 => mapping(address => uint256[4])) private _claimable;

    error OnlyController();
    error InvalidWeights();
    error InsufficientShares();

    modifier onlyController() {
        if (msg.sender != controller) revert OnlyController();
        _;
    }

    constructor(address controller_) {
        if (controller_ == address(0)) revert OnlyController();
        controller = controller_;
    }

    function mint(uint256 rangeId, address owner, uint256 shares) external onlyController {
        _checkpoint(rangeId, owner);
        totalShares[rangeId] += shares;
        sharesOf[rangeId][owner] += shares;
        _setDebt(rangeId, owner);
    }

    function burn(uint256 rangeId, address owner, uint256 shares) external onlyController {
        if (shares > sharesOf[rangeId][owner]) revert InsufficientShares();
        _checkpoint(rangeId, owner);
        sharesOf[rangeId][owner] -= shares;
        totalShares[rangeId] -= shares;
        _setDebt(rangeId, owner);
    }

    /// @notice Allocates a settled fee amount over the ranges that participated in one swap segment.
    function accrue(uint256[] calldata rangeIds, uint256[] calldata weights, uint256[4] calldata fees)
        external
        onlyController
    {
        if (rangeIds.length == 0 || rangeIds.length != weights.length) revert InvalidWeights();
        uint256 totalWeight;
        for (uint256 i; i < weights.length; ++i) {
            totalWeight += weights[i];
        }
        if (totalWeight == 0) revert InvalidWeights();
        for (uint256 i; i < rangeIds.length; ++i) {
            uint256 supply = totalShares[rangeIds[i]];
            if (supply == 0) revert InvalidWeights();
            for (uint256 asset; asset < 4; ++asset) {
                uint256 allocated = FixedPointMath.mulDivDown(fees[asset], weights[i], totalWeight);
                uint256 growthDelta = FixedPointMath.mulDivDown(allocated, Q128, supply);
                uint256 credited = FixedPointMath.mulDivDown(growthDelta, supply, Q128);
                _growth[rangeIds[i]][asset] += growthDelta;
                _dust[rangeIds[i]][asset] += allocated - credited;
            }
        }
        // Any allocation remainder belongs to no participant and is deterministic dust.
        for (uint256 asset; asset < 4; ++asset) {
            uint256 allocatedTotal;
            for (uint256 i; i < rangeIds.length; ++i) {
                allocatedTotal += FixedPointMath.mulDivDown(fees[asset], weights[i], totalWeight);
            }
            _dust[rangeIds[0]][asset] += fees[asset] - allocatedTotal;
        }
    }

    /// @notice Clears and returns an owner's checkpointed claim for one range.
    /// @dev Controller-only: the controller pays the returned amounts from custody.
    function collect(uint256 rangeId, address owner) external onlyController returns (uint256[4] memory amounts) {
        _checkpoint(rangeId, owner);
        amounts = _claimable[rangeId][owner];
        delete _claimable[rangeId][owner];
        _setDebt(rangeId, owner);
    }

    function growth(uint256 rangeId) external view returns (uint256[4] memory) {
        return _growth[rangeId];
    }

    function dust(uint256 rangeId) external view returns (uint256[4] memory) {
        return _dust[rangeId];
    }

    function _checkpoint(uint256 rangeId, address owner) private {
        for (uint256 asset; asset < 4; ++asset) {
            uint256 accrued = FixedPointMath.mulDivDown(sharesOf[rangeId][owner], _growth[rangeId][asset], Q128);
            _claimable[rangeId][owner][asset] += accrued - _debt[rangeId][owner][asset];
        }
    }

    function _setDebt(uint256 rangeId, address owner) private {
        for (uint256 asset; asset < 4; ++asset) {
            _debt[rangeId][owner][asset] =
                FixedPointMath.mulDivDown(sharesOf[rangeId][owner], _growth[rangeId][asset], Q128);
        }
    }
}
