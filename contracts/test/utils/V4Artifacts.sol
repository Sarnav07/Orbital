// SPDX-License-Identifier: MIT
pragma solidity =0.8.26;

// v4-core pins PoolManager to solc 0.8.26 while Orbital compiles with 0.8.30.
// Importing it here gives tests and scripts a separately compiled artifact to
// deploy with `deployCode("PoolManager.sol:PoolManager", ...)`.
import {PoolManager} from "v4-core/PoolManager.sol";
