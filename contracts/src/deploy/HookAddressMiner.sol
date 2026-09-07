// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Deterministically finds CREATE2 salts whose hook address has exactly the requested v4 flag bits.
library HookAddressMiner {
    uint160 internal constant ALL_HOOK_MASK = (1 << 14) - 1;
    error SaltNotFound();

    function find(address deployer, bytes32 initCodeHash, uint160 requiredFlags, uint256 maxAttempts)
        internal
        pure
        returns (bytes32 salt)
    {
        for (uint256 nonce; nonce < maxAttempts; ++nonce) {
            salt = bytes32(nonce);
            if ((uint160(compute(deployer, salt, initCodeHash)) & ALL_HOOK_MASK) == requiredFlags) return salt;
        }
        revert SaltNotFound();
    }

    function compute(address deployer, bytes32 salt, bytes32 initCodeHash) internal pure returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), deployer, salt, initCodeHash)))));
    }
}
