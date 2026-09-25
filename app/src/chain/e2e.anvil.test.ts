import { createPublicClient, createWalletClient, http, parseUnits, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { describe, expect, it } from "vitest";
import { hookAbi, tokenAbi } from "./abi";
import { addLiquidityRequest, approveRequest, collectFeesRequest, mintRequest, removeLiquidityRequest, swapRequest } from "./actions";
import type { Deployment } from "./config";
import { explainRevert } from "./errors";
import { minAmountOut, quoteHookSwap } from "./quote";
import { readAccount, readBook, readRecentSwaps } from "./reads";

// Real-contract end-to-end run against a local anvil deployment of DeployOrbitalDemo.
// Driven by `make app-e2e`; skipped in the regular unit suite.
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const rpc = env.ORBITAL_E2E_RPC;

// Anvil's well-known development keys: #0 deployed and seeded the book, #1 is a fresh trader.
const DEPLOYER_KEY: Hex = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const TRADER_KEY: Hex = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

describe.skipIf(!rpc)("app transaction builders against a real anvil deployment", () => {
  const deployment = rpc ? JSON.parse(env.ORBITAL_E2E_DEPLOYMENT_JSON!) as Deployment : ({} as Deployment);
  const client = createPublicClient({ chain: foundry, transport: http(rpc) });
  const trader = privateKeyToAccount(TRADER_KEY);
  const deployer = privateKeyToAccount(DEPLOYER_KEY);
  const walletFor = (account: typeof trader) => createWalletClient({ account, chain: foundry, transport: http(rpc) });
  const index = (symbol: string) => deployment.symbols.indexOf(symbol);
  const balance = (asset: number, owner: Address) =>
    client.readContract({ address: deployment.currencies[asset], abi: tokenAbi, functionName: "balanceOf", args: [owner] });

  // Simulate exactly as the app does, then send and require success.
  async function send(account: typeof trader, request: { address: Address; abi: readonly unknown[]; functionName: string; args: readonly unknown[] }) {
    const { request: simulated } = await client.simulateContract({ ...request, account } as never);
    const hash = await walletFor(account).writeContract(simulated as never);
    const receipt = await client.waitForTransactionReceipt({ hash });
    expect(receipt.status).toBe("success");
    return receipt;
  }

  it("mints, approves and swaps for exactly the app's quoted output", async () => {
    const usdc = index("USDC");
    const dai = index("DAI");
    for (let asset = 0; asset < 4; asset += 1) {
      await send(trader, mintRequest(deployment, asset, trader.address, parseUnits("10000", deployment.decimals[asset])));
    }
    await send(trader, approveRequest(deployment, usdc, deployment.router));

    const book = await readBook(client, deployment);
    const quote = quoteHookSwap(book, usdc, dai, parseUnits("1000", deployment.decimals[usdc]));
    const before = [await balance(usdc, trader.address), await balance(dai, trader.address)];
    await send(trader, swapRequest(deployment, { input: usdc, output: dai, amountIn: quote.amountIn, minAmountOut: minAmountOut(quote.amountOut, 50), deadline: 10n ** 12n }));
    const after = [await balance(usdc, trader.address), await balance(dai, trader.address)];

    expect(before[0] - after[0]).toBe(quote.amountIn);
    expect(after[1] - before[1]).toBe(quote.amountOut);
    const next = await readBook(client, deployment);
    expect(next.reserves).toEqual(quote.reserves);
    expect(next.solvent).toBe(true);
  }, 60_000);

  it("explains a slippage revert before the wallet is asked to sign", async () => {
    const usdt = index("USDT");
    const frax = index("FRAX");
    await send(trader, approveRequest(deployment, usdt, deployment.router));
    const book = await readBook(client, deployment);
    const quote = quoteHookSwap(book, usdt, frax, parseUnits("50", deployment.decimals[usdt]));
    const request = swapRequest(deployment, { input: usdt, output: frax, amountIn: quote.amountIn, minAmountOut: quote.amountOut + 1n, deadline: 10n ** 12n });
    const error = await client.simulateContract({ ...request, account: trader } as never).then(() => null, (caught: unknown) => caught);
    expect(error).not.toBeNull();
    expect(explainRevert(error)).toMatch(/slippage/i);
  }, 60_000);

  it("adds and removes range liquidity for exactly the on-chain previews", async () => {
    for (let asset = 0; asset < 4; asset += 1) await send(trader, approveRequest(deployment, asset, deployment.hook));
    const book = await readBook(client, deployment);
    const rangeId = 1;
    const shares = book.totalShares[rangeId] / 1_000n;
    const preview = await client.readContract({ address: deployment.hook, abi: hookAbi, functionName: "previewAddLiquidity", args: [BigInt(rangeId), shares] });
    const before = await Promise.all([0, 1, 2, 3].map((asset) => balance(asset, trader.address)));
    await send(trader, addLiquidityRequest(deployment, rangeId, shares, preview, 10n ** 12n));
    const afterAdd = await Promise.all([0, 1, 2, 3].map((asset) => balance(asset, trader.address)));
    expect(before.map((value, asset) => value - afterAdd[asset])).toEqual([...preview]);

    const state = await readAccount(client, deployment, trader.address, book.ticks.length);
    expect(state.shares[rangeId]).toBe(shares);
    const removal = await client.readContract({ address: deployment.hook, abi: hookAbi, functionName: "previewRemoveLiquidity", args: [BigInt(rangeId), shares] });
    await send(trader, removeLiquidityRequest(deployment, rangeId, shares, removal, 10n ** 12n));
    const afterRemove = await Promise.all([0, 1, 2, 3].map((asset) => balance(asset, trader.address)));
    expect(afterRemove.map((value, asset) => value - afterAdd[asset])).toEqual([...removal]);
    expect((await readBook(client, deployment)).solvent).toBe(true);
  }, 60_000);

  it("collects the seeding LP's fees for exactly the simulated amount and lists the swaps", async () => {
    const state = await readAccount(client, deployment, deployer.address, 3);
    const rangeId = state.pendingFees.findIndex((fees) => fees.some((amount) => amount > 0n));
    expect(rangeId).toBeGreaterThanOrEqual(0);
    const pending = state.pendingFees[rangeId];
    const before = await Promise.all([0, 1, 2, 3].map((asset) => balance(asset, deployer.address)));
    await send(deployer, collectFeesRequest(deployment, rangeId, deployer.address));
    const after = await Promise.all([0, 1, 2, 3].map((asset) => balance(asset, deployer.address)));
    expect(after.map((value, asset) => value - before[asset])).toEqual(pending);

    const recent = await readRecentSwaps(client, deployment);
    expect(recent.ok).toBe(true);
    expect(recent.swaps.length).toBeGreaterThanOrEqual(1);
  }, 60_000);
});
