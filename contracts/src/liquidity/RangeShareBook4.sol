// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {RangeLiquidity4} from "../math/RangeLiquidity4.sol";

/// @notice Minimal stateful ownership book for range-specific Orbital LP shares.
/// @dev This component tracks claims only. Custody transfers and hook callback
///      authorization are deliberately separate from the accounting primitive.
contract RangeShareBook4 {
    address public immutable controller;

    mapping(uint256 rangeId => RangeLiquidity4.ShareState position) private _positions;
    mapping(uint256 rangeId => mapping(address owner => uint256 shares)) public sharesOf;
    mapping(uint256 rangeId => bool initialized) public initialized;

    error OnlyController();
    error AlreadyInitialized();
    error InsufficientOwnerShares();

    event Bootstrapped(uint256 indexed rangeId, address indexed owner, uint256 shares);
    event SharesMinted(uint256 indexed rangeId, address indexed owner, uint256 shares);
    event SharesBurned(uint256 indexed rangeId, address indexed owner, uint256 shares);

    modifier onlyController() {
        if (msg.sender != controller) revert OnlyController();
        _;
    }

    constructor(address controller_) {
        if (controller_ == address(0)) revert OnlyController();
        controller = controller_;
    }

    function bootstrap(uint256 rangeId, address owner, uint256[4] memory inventory, uint256 shares)
        external
        onlyController
    {
        if (initialized[rangeId]) revert AlreadyInitialized();
        _positions[rangeId] = RangeLiquidity4.bootstrap(inventory, shares);
        sharesOf[rangeId][owner] = shares;
        initialized[rangeId] = true;
        emit Bootstrapped(rangeId, owner, shares);
    }

    /// @dev Controller-only: the controller must have received `amounts` before recording them.
    function addProportional(uint256 rangeId, address owner, uint256[4] memory amounts)
        external
        onlyController
        returns (uint256 mintedShares)
    {
        (RangeLiquidity4.ShareState memory next, uint256 minted) =
            RangeLiquidity4.addProportional(_positions[rangeId], amounts);
        _positions[rangeId] = next;
        sharesOf[rangeId][owner] += minted;
        emit SharesMinted(rangeId, owner, minted);
        return minted;
    }

    /// @dev Controller-only: the controller pays the returned amounts to `owner`.
    function removeProportional(uint256 rangeId, address owner, uint256 shares)
        external
        onlyController
        returns (uint256[4] memory amountsOut)
    {
        if (shares > sharesOf[rangeId][owner]) revert InsufficientOwnerShares();
        (RangeLiquidity4.ShareState memory next, uint256[4] memory withdrawn) =
            RangeLiquidity4.removeProportional(_positions[rangeId], shares);
        _positions[rangeId] = next;
        sharesOf[rangeId][owner] -= shares;
        emit SharesBurned(rangeId, owner, shares);
        return withdrawn;
    }

    function position(uint256 rangeId) external view returns (RangeLiquidity4.ShareState memory) {
        return _positions[rangeId];
    }
}
