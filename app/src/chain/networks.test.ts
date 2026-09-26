import { describe, expect, it } from "vitest";
import { DEFAULT_NETWORK, NETWORKS, explorerAddressOn, explorerTxOn, networkByChainId, networkByKey } from "./networks";

describe("Orbital networks", () => {
  it("lists the four testnet pools with unique keys and their chain ids", () => {
    expect(NETWORKS.map((network) => network.key)).toEqual(["unichain-sepolia", "sepolia", "arbitrum-sepolia", "arc-testnet"]);
    expect(NETWORKS.map((network) => network.chain.id)).toEqual([1301, 11155111, 421614, 5042002]);
    expect(new Set(NETWORKS.map((network) => network.key)).size).toBe(4);
    expect(DEFAULT_NETWORK.key).toBe("unichain-sepolia");
  });

  it("records a complete deployment for every network", () => {
    for (const network of NETWORKS) {
      const { deployment } = network;
      expect(deployment.chainId).toBe(network.chain.id);
      for (const address of [deployment.hook, deployment.router, deployment.poolManager, ...deployment.currencies]) expect(address).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(deployment.currencies).toHaveLength(4);
      expect([...deployment.symbols].sort()).toEqual(["DAI", "FRAX", "USDC", "USDT"]);
      expect(deployment.decimals).toHaveLength(4);
      expect(deployment.deployBlock).toBeGreaterThan(0);
      expect(network.rpcUrl).toMatch(/^https:\/\//);
    }
  });

  it("uses Uniswap's canonical PoolManagers, and the verified v4 PoolManager on Arc", () => {
    expect(networkByKey("unichain-sepolia").deployment.poolManager).toBe("0x00B036B58a818B1BC34d502D3fE730Db729e62AC");
    expect(networkByKey("sepolia").deployment.poolManager).toBe("0xE03A1074c86CFeDd5C142C4F04F1a1536e203543");
    expect(networkByKey("arbitrum-sepolia").deployment.poolManager).toBe("0xFB3e0C6F74eB1a21CC1Da29aeC80D2Dfe6C9a317");
    expect(networkByKey("arc-testnet").deployment.poolManager.toLowerCase()).toBe("0x8366a39cc670b4001a1121b8f6a443a643e40951");
  });

  it("builds explorer links per network and resolves networks by chain id", () => {
    const arbitrum = networkByKey("arbitrum-sepolia");
    expect(explorerAddressOn(arbitrum, "0xabc")).toBe("https://sepolia.arbiscan.io/address/0xabc");
    expect(explorerTxOn(networkByKey("sepolia"), "0xdef")).toBe("https://sepolia.etherscan.io/tx/0xdef");
    expect(explorerAddressOn(networkByKey("unichain-sepolia"), "0x1")).toBe("https://unichain-sepolia.blockscout.com/address/0x1");
    expect(networkByChainId(5042002)?.key).toBe("arc-testnet");
    expect(networkByChainId(1)).toBeUndefined();
  });
});
