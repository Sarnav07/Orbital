// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {FixedPointMath} from "../math/FixedPointMath.sol";

/// @notice Per-range, per-share fee checkpoints with explicit allocation and rounding dust.
/// @dev Controller calls model the hook's future segment settlement path; this contract moves no ERC-20 tokens.
contract RangeFeeBook4 {
    using FixedPointMath for uint256;
    uint256 internal constant WAD = 1e18;

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
                uint256 growthDelta = allocated.divWadDown(supply);
                uint256 credited = growthDelta.mulWadDown(supply);
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

    function collect(uint256 rangeId) external returns (uint256[4] memory amounts) {
        _checkpoint(rangeId, msg.sender);
        amounts = _claimable[rangeId][msg.sender];
        delete _claimable[rangeId][msg.sender];
        _setDebt(rangeId, msg.sender);
    }

    function growth(uint256 rangeId) external view returns (uint256[4] memory) {
        return _growth[rangeId];
    }

    function dust(uint256 rangeId) external view returns (uint256[4] memory) {
        return _dust[rangeId];
    }

    function _checkpoint(uint256 rangeId, address owner) private {
        for (uint256 asset; asset < 4; ++asset) {
            uint256 accrued = sharesOf[rangeId][owner].mulWadDown(_growth[rangeId][asset]);
            _claimable[rangeId][owner][asset] += accrued - _debt[rangeId][owner][asset];
        }
    }

    function _setDebt(uint256 rangeId, address owner) private {
        for (uint256 asset; asset < 4; ++asset) {
            _debt[rangeId][owner][asset] = sharesOf[rangeId][owner].mulWadDown(_growth[rangeId][asset]);
        }
    }
}
