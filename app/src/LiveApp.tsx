import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPublicClient, createWalletClient, custom, formatUnits, http, parseUnits, type Address, type Hash } from "viem";
import { hookAbi } from "./chain/abi";
import {
  addLiquidityRequest,
  approveRequest,
  collectFeesRequest,
  mintRequest,
  removeLiquidityRequest,
  swapRequest,
} from "./chain/actions";
import { CHAIN, DEPLOYMENT, RPC_URL, explorerAddress, explorerTx } from "./chain/config";
import { explainRevert } from "./chain/errors";
import { minAmountOut, quoteHookSwap, type HookQuote } from "./chain/quote";
import {
  readAccount,
  readBook,
  readRecentSwaps,
  readSwapsBetween,
  type AccountState,
  type LiveBook,
  type RecentSwap,
} from "./chain/reads";
import { currentChainId, ensureChain, requestAccounts, watchWallets, type DiscoveredWallet, type Eip1193Provider } from "./chain/wallet";

export type ContractRequest = { address: Address; abi: readonly unknown[]; functionName: string; args: readonly unknown[] };

/** Everything the live app does against the chain, injectable for tests. */
export type LiveServices = {
  readBook(): Promise<LiveBook>;
  readAccount(account: Address, rangeCount: number): Promise<AccountState>;
  readRecentSwaps(): Promise<{ ok: boolean; swaps: RecentSwap[]; latest: bigint }>;
  readSwapsBetween(fromBlock: bigint, toBlock: bigint): Promise<RecentSwap[]>;
  blockNumber(): Promise<bigint>;
  previewLiquidity(kind: "add" | "remove", rangeId: number, shares: bigint): Promise<bigint[]>;
  /** Simulates from the account first (surfacing reverts before signing), then asks the wallet to send. */
  send(provider: Eip1193Provider, account: Address, request: ContractRequest): Promise<Hash>;
  waitForReceipt(hash: Hash): Promise<"success" | "reverted">;
};

export function createLiveServices(): LiveServices {
  const client = createPublicClient({ chain: CHAIN, transport: http(RPC_URL), batch: { multicall: true } });
  return {
    readBook: () => readBook(client, DEPLOYMENT),
    readAccount: (account, rangeCount) => readAccount(client, DEPLOYMENT, account, rangeCount),
    readRecentSwaps: () => readRecentSwaps(client, DEPLOYMENT),
    readSwapsBetween: (fromBlock, toBlock) => readSwapsBetween(client, DEPLOYMENT, fromBlock, toBlock),
    blockNumber: () => client.getBlockNumber(),
    previewLiquidity: async (kind, rangeId, shares) => [...await client.readContract({
      address: DEPLOYMENT.hook,
      abi: hookAbi,
      functionName: kind === "add" ? "previewAddLiquidity" : "previewRemoveLiquidity",
      args: [BigInt(rangeId), shares],
    })],
    send: async (provider, account, request) => {
      const { request: simulated } = await client.simulateContract({ ...request, account } as never);
      const wallet = createWalletClient({ account, chain: CHAIN, transport: custom(provider) });
      return wallet.writeContract(simulated as never);
    },
    waitForReceipt: async (hash) => (await client.waitForTransactionReceipt({ hash })).status,
  };
}

const symbols = DEPLOYMENT.symbols;
const decimals = DEPLOYMENT.decimals;
const REFRESH_MS = 8_000;
const FAUCET_UNITS = 10_000n;
const TX_DEADLINE_SECONDS = 1_200n;

const shortHex = (value: string) => `${value.slice(0, 6)}…${value.slice(-4)}`;
const fmt = (value: bigint, tokenDecimals: number, maxFraction = 4) =>
  Number(formatUnits(value, tokenDecimals)).toLocaleString("en-US", { maximumFractionDigits: maxFraction });
const wadFmt = (value: bigint) => fmt(value, 18, 2);
const deadline = () => BigInt(Math.floor(Date.now() / 1000)) + TX_DEADLINE_SECONDS;
const scaleUp = (value: bigint, bps: number) => (value * BigInt(10_000 + bps) + 9_999n) / 10_000n;
const scaleDown = (value: bigint, bps: number) => value * BigInt(10_000 - bps) / 10_000n;
const ratio = (k: bigint, radius: bigint) => (Number(k * 10_000n / radius) / 10_000).toFixed(3);

type TxState = { label: string; status: "signing" | "pending" | "success" | "failed"; hash?: Hash; message?: string };

export function LiveApp({ services, walletHost }: { services?: LiveServices; walletHost?: EventTarget }) {
  const api = useMemo(() => services ?? createLiveServices(), [services]);
  const [book, setBook] = useState<LiveBook | null>(null);
  const [bookError, setBookError] = useState<string | null>(null);
  const [blockNumber, setBlockNumber] = useState<bigint | null>(null);
  const [swaps, setSwaps] = useState<RecentSwap[]>([]);
  const [swapsOk, setSwapsOk] = useState(true);
  const scannedTo = useRef<bigint | null>(null);

  const [wallets, setWallets] = useState<DiscoveredWallet[]>([]);
  const [wallet, setWallet] = useState<DiscoveredWallet | null>(null);
  const [account, setAccount] = useState<Address | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [accountState, setAccountState] = useState<AccountState | null>(null);
  const [tx, setTx] = useState<TxState | null>(null);
  const onChain = chainId === CHAIN.id;
  const busy = tx?.status === "signing" || tx?.status === "pending";

  const refresh = useCallback(async () => {
    try {
      const next = await api.readBook();
      setBook(next);
      setBookError(null);
      if (account) setAccountState(await api.readAccount(account, next.ticks.length));
    } catch (error) {
      setBookError(explainRevert(error));
    }
    try {
      const latest = await api.blockNumber();
      setBlockNumber(latest);
      if (scannedTo.current !== null && latest > scannedTo.current) {
        const fresh = await api.readSwapsBetween(scannedTo.current + 1n, latest);
        scannedTo.current = latest;
        if (fresh.length) setSwaps((current) => [...fresh.reverse(), ...current].slice(0, 20));
      }
    } catch {
      // The next poll retries.
    }
  }, [api, account]);

  useEffect(() => {
    let cancelled = false;
    api.readRecentSwaps().then((recent) => {
      if (cancelled) return;
      setSwapsOk(recent.ok);
      setSwaps(recent.swaps);
      scannedTo.current = recent.ok ? recent.latest : null;
    }).catch(() => !cancelled && setSwapsOk(false));
    return () => { cancelled = true; };
  }, [api]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  useEffect(() => watchWallets(setWallets, (walletHost ?? window) as EventTarget & { ethereum?: Eip1193Provider }), [walletHost]);

  useEffect(() => {
    if (!wallet) return;
    const onAccounts = (accounts: unknown) => setAccount(((accounts as Address[])[0]) ?? null);
    const onChainChanged = (id: unknown) => setChainId(Number(id));
    wallet.provider.on?.("accountsChanged", onAccounts);
    wallet.provider.on?.("chainChanged", onChainChanged);
    return () => {
      wallet.provider.removeListener?.("accountsChanged", onAccounts);
      wallet.provider.removeListener?.("chainChanged", onChainChanged);
    };
  }, [wallet]);

  const connect = async (candidate: DiscoveredWallet) => {
    try {
      const [first] = await requestAccounts(candidate.provider);
      setWallet(candidate);
      setAccount(first ?? null);
      setChainId(await currentChainId(candidate.provider));
    } catch (error) {
      setTx({ label: "Connect wallet", status: "failed", message: explainRevert(error) });
    }
  };

  const switchNetwork = async () => {
    if (!wallet) return;
    try {
      await ensureChain(wallet.provider);
      setChainId(await currentChainId(wallet.provider));
    } catch (error) {
      setTx({ label: "Switch network", status: "failed", message: explainRevert(error) });
    }
  };

  const run = async (label: string, request: ContractRequest) => {
    if (!wallet || !account) return false;
    setTx({ label, status: "signing" });
    try {
      if (!onChain) {
        await ensureChain(wallet.provider);
        setChainId(CHAIN.id);
      }
      const hash = await api.send(wallet.provider, account, request);
      setTx({ label, status: "pending", hash });
      const status = await api.waitForReceipt(hash);
      setTx(status === "success" ? { label, status: "success", hash } : { label, status: "failed", hash, message: "The transaction reverted on-chain." });
      await refresh();
      return status === "success";
    } catch (error) {
      setTx({ label, status: "failed", message: explainRevert(error) });
      return false;
    }
  };

  const mint = async (assets: number[]) => {
    if (!account) return;
    for (const [step, asset] of assets.entries()) {
      const units = FAUCET_UNITS * 10n ** BigInt(decimals[asset]);
      const label = `Mint ${FAUCET_UNITS.toLocaleString()} ${symbols[asset]}${assets.length > 1 ? ` (${step + 1}/${assets.length})` : ""}`;
      if (!await run(label, mintRequest(DEPLOYMENT, asset, account, units))) return;
    }
  };

  return <div className="testnet-app">
    <header className="testnet-header">
      <div>
        <p className="section-index">LIVE · UNICHAIN SEPOLIA · CHAIN {CHAIN.id}</p>
        <h3>Trade the deployed reserve book.</h3>
        <p>Real transactions against the <a href={explorerAddress(DEPLOYMENT.hook)} target="_blank" rel="noreferrer">Orbital hook</a> and the Uniswap v4 PoolManager. Mock tokens only: mint as many as you need. Gas is Unichain Sepolia ETH.</p>
      </div>
      <WalletBar wallets={wallets} account={account} onChain={onChain} connected={Boolean(wallet)} connect={connect} switchNetwork={switchNetwork} blockNumber={blockNumber} />
    </header>
    {tx && <TxBanner tx={tx} dismiss={() => setTx(null)} />}
    {bookError && !book && <p className="quote-error" role="status">Could not read the live book: {bookError}</p>}
    <div className="testnet-grid">
      <SwapPanel book={book} account={account} accountState={accountState} connected={Boolean(wallet)} onChain={onChain} busy={busy} run={run} mint={mint} switchNetwork={switchNetwork} />
      <BookPanel book={book} />
      <LiquidityPanel book={book} account={account} accountState={accountState} busy={busy} run={run} preview={api.previewLiquidity} />
      <ActivityPanel swaps={swaps} ok={swapsOk} account={account} accountState={accountState} busy={busy} mint={mint} />
    </div>
  </div>;
}

function WalletBar({ wallets, account, onChain, connected, connect, switchNetwork, blockNumber }: {
  wallets: DiscoveredWallet[];
  account: Address | null;
  onChain: boolean;
  connected: boolean;
  connect: (wallet: DiscoveredWallet) => void;
  switchNetwork: () => void;
  blockNumber: bigint | null;
}) {
  return <div className="wallet-bar">
    <span className="network-status"><i className={blockNumber ? "online" : ""} />{blockNumber ? `BLOCK ${blockNumber.toLocaleString()}` : "CONNECTING TO RPC"}</span>
    {connected && account ? <>
      <span className="wallet-address">{shortHex(account)}</span>
      {!onChain && <button className="button button-light" type="button" onClick={switchNetwork}>Switch to Unichain Sepolia</button>}
    </> : wallets.length ? wallets.map((candidate) => <button className="button button-light" type="button" key={candidate.info.uuid} onClick={() => connect(candidate)}>
      {candidate.info.icon && <img src={candidate.info.icon} alt="" width={16} height={16} />}Connect {candidate.info.name}
    </button>) : <span className="wallet-missing">No wallet detected. Install MetaMask, Rabby or another browser wallet to trade; the live book below still updates.</span>}
  </div>;
}

function TxBanner({ tx, dismiss }: { tx: TxState; dismiss: () => void }) {
  const text = {
    signing: "Confirm in your wallet…",
    pending: "Submitted. Waiting for confirmation…",
    success: "Confirmed.",
    failed: tx.message ?? "Failed.",
  }[tx.status];
  return <div className={`tx-banner ${tx.status}`} role="status">
    <b>{tx.label}</b><span>{text}</span>
    {tx.hash && <a href={explorerTx(tx.hash)} target="_blank" rel="noreferrer">View on Blockscout ↗</a>}
    {(tx.status === "success" || tx.status === "failed") && <button type="button" onClick={dismiss} aria-label="Dismiss">×</button>}
  </div>;
}

function SwapPanel({ book, account, accountState, connected, onChain, busy, run, mint, switchNetwork }: {
  book: LiveBook | null;
  account: Address | null;
  accountState: AccountState | null;
  connected: boolean;
  onChain: boolean;
  busy: boolean;
  run: (label: string, request: ContractRequest) => Promise<boolean>;
  mint: (assets: number[]) => Promise<void>;
  switchNetwork: () => void;
}) {
  const [input, setInput] = useState(Math.max(0, symbols.indexOf("USDC")));
  const [output, setOutput] = useState(Math.max(0, symbols.indexOf("DAI")));
  const [amountText, setAmountText] = useState("");
  const [slippageBps, setSlippageBps] = useState(50);

  const amount = useMemo(() => {
    if (!amountText.trim()) return null;
    try {
      const value = parseUnits(amountText.trim(), decimals[input]);
      return value > 0n ? value : null;
    } catch {
      return null;
    }
  }, [amountText, input]);
  const quoted = useMemo<{ quote?: HookQuote; error?: string }>(() => {
    if (!book || !amount) return {};
    try {
      return { quote: quoteHookSwap(book, input, output, amount) };
    } catch (error) {
      return { error: explainRevert(error) };
    }
  }, [book, amount, input, output]);
  const quote = quoted.quote;
  const minOut = quote ? minAmountOut(quote.amountOut, slippageBps) : 0n;

  const choose = (side: "input" | "output", index: number) => {
    if (side === "input") {
      setInput(index);
      if (index === output) setOutput(input);
    } else {
      setOutput(index);
      if (index === input) setInput(output);
    }
  };

  const balance = accountState?.balances[input] ?? 0n;
  const allowance = accountState?.routerAllowances[input] ?? 0n;
  let action: { label: string; disabled?: boolean; onClick?: () => void };
  if (!connected || !account) action = { label: "Connect a wallet to swap", disabled: true };
  else if (!onChain) action = { label: "Switch to Unichain Sepolia", onClick: switchNetwork };
  else if (!quote) action = { label: quoted.error ? "No quote for this amount" : "Enter an amount", disabled: true };
  else if (balance < quote.amountIn) action = { label: "Mint test tokens first", onClick: () => void mint([input]) };
  else if (allowance < quote.amountIn) action = { label: `Approve ${symbols[input]}`, onClick: () => void run(`Approve ${symbols[input]} for swaps`, approveRequest(DEPLOYMENT, input, DEPLOYMENT.router)) };
  else action = {
    label: "Swap",
    onClick: () => void run(`Swap ${fmt(quote.amountIn, decimals[input])} ${symbols[input]} → ${symbols[output]}`, swapRequest(DEPLOYMENT, {
      input, output, amountIn: quote.amountIn, minAmountOut: minOut, deadline: deadline(),
    })).then((ok) => ok && setAmountText("")),
  };

  return <article className="sim-panel testnet-swap">
    <div className="sim-rule"><span>01 / SWAP</span><b>EXACT INPUT · POOLSWAPTEST ROUTER</b></div>
    <div className="asset-picker"><span>PAY</span><div>{symbols.map((symbol, index) => <button type="button" key={symbol} className={input === index ? "asset-choice active" : "asset-choice"} aria-pressed={input === index} onClick={() => choose("input", index)}>{symbol}</button>)}</div></div>
    <div className="amount-field"><span>AMOUNT {accountState ? `· BALANCE ${fmt(balance, decimals[input])}` : ""}</span><label><input aria-label="Testnet swap amount" inputMode="decimal" placeholder="0.00" value={amountText} onChange={(event) => setAmountText(event.target.value)} /><b>{symbols[input]}</b></label>{accountState && <button type="button" onClick={() => setAmountText(formatUnits(balance, decimals[input]))} disabled={balance === 0n}>MAX</button>}</div>
    <div className="asset-picker"><span>RECEIVE</span><div>{symbols.map((symbol, index) => <button type="button" key={symbol} className={output === index ? "asset-choice active" : "asset-choice"} aria-pressed={output === index} onClick={() => choose("output", index)}>{symbol}</button>)}</div></div>
    <div className="quote-output">
      <span>QUOTED OUTPUT · EXACT MIRROR OF THE HOOK</span>
      <strong>{quote ? fmt(quote.amountOut, decimals[output]) : "0"} <small>{symbols[output]}</small></strong>
      <small>{quote ? `Fee ${fmt(quote.fee, decimals[input])} ${symbols[input]} (0.05%) · min received ${fmt(minOut, decimals[output])} · ${quote.crossings} range crossing${quote.crossings === 1 ? "" : "s"}` : "Enter an amount to quote against the live book."}</small>
    </div>
    <div className="slippage"><span>SLIPPAGE</span>{[10, 50, 100].map((bps) => <button type="button" key={bps} className={slippageBps === bps ? "asset-choice active" : "asset-choice"} onClick={() => setSlippageBps(bps)}>{bps / 100}%</button>)}</div>
    {quoted.error && <p className="quote-error" role="status">{quoted.error}</p>}
    <div className="sim-actions"><button className="button button-light" type="button" disabled={busy || action.disabled} onClick={action.onClick}>{action.label}</button></div>
  </article>;
}

function BookPanel({ book }: { book: LiveBook | null }) {
  if (!book) return <article className="sim-panel testnet-book"><div className="sim-rule"><span>02 / LIVE BOOK</span><b>READING…</b></div><p>Reading reserves from Unichain Sepolia…</p></article>;
  return <article className="sim-panel testnet-book">
    <div className="sim-rule"><span>02 / LIVE BOOK</span><b className={book.solvent ? "" : "warning"}>{book.solvent ? "SOLVENT · CUSTODY ≥ REQUIRED" : "CHECK · CUSTODY BELOW REQUIRED"}</b></div>
    <div className="book-table" role="table" aria-label="Live reserve book">
      <div role="row" className="book-head"><span>ASSET</span><span>HELD BY HOOK</span><span>BOOK COORDINATE</span></div>
      {symbols.map((symbol, index) => <div role="row" key={symbol}>
        <span>{symbol} <small>{decimals[index]}d</small></span>
        <span>{fmt(book.custody[index], decimals[index], 2)}</span>
        <span>{wadFmt(book.reserves[index])}</span>
      </div>)}
    </div>
    <div className="sim-ticks">
      <div><span>RANGE</span><span>K / R</span><span>STATE</span></div>
      {book.ticks.map((tick, index) => <div className="range-row" key={index}><span>RANGE {index + 1}</span><span>{ratio(tick.k, tick.radius)}</span><b>{tick.isInterior ? "INTERIOR" : "BOUNDARY"}</b></div>)}
    </div>
    <p>“Held” is the hook's PoolManager claim balance. The book coordinate includes each range's virtual offset, which is never redeemable. Unpaid fees: {symbols.map((symbol, index) => `${fmt(book.feeLiability[index], decimals[index])} ${symbol}`).join(" · ")}.</p>
  </article>;
}

function LiquidityPanel({ book, account, accountState, busy, run, preview }: {
  book: LiveBook | null;
  account: Address | null;
  accountState: AccountState | null;
  busy: boolean;
  run: (label: string, request: ContractRequest) => Promise<boolean>;
  preview: LiveServices["previewLiquidity"];
}) {
  const [rangeId, setRangeId] = useState(1);
  const [addBps, setAddBps] = useState(10);
  const [removeBps, setRemoveBps] = useState(10_000);
  const [addPreview, setAddPreview] = useState<bigint[] | null>(null);
  const [removePreview, setRemovePreview] = useState<bigint[] | null>(null);
  const totalShares = book?.totalShares[rangeId] ?? 0n;
  const yourShares = accountState?.shares[rangeId] ?? 0n;
  const addShares = totalShares * BigInt(addBps) / 10_000n;
  const removeShares = yourShares * BigInt(removeBps) / 10_000n;

  useEffect(() => {
    if (!book || addShares === 0n) return setAddPreview(null);
    let live = true;
    preview("add", rangeId, addShares).then((amounts) => live && setAddPreview(amounts)).catch(() => live && setAddPreview(null));
    return () => { live = false; };
  }, [book, rangeId, addShares, preview]);
  useEffect(() => {
    if (!book || removeShares === 0n) return setRemovePreview(null);
    let live = true;
    preview("remove", rangeId, removeShares).then((amounts) => live && setRemovePreview(amounts)).catch(() => live && setRemovePreview(null));
    return () => { live = false; };
  }, [book, rangeId, removeShares, preview]);

  if (!book) return <article className="sim-panel testnet-liquidity"><div className="sim-rule"><span>03 / RANGE LIQUIDITY</span><b>READING…</b></div></article>;
  const tick = book.ticks[rangeId];
  const pending = accountState?.pendingFees[rangeId] ?? [0n, 0n, 0n, 0n];
  const maxIn = addPreview ? addPreview.map((amount) => scaleUp(amount, 50)) : null;
  const needsApproval = maxIn && accountState ? maxIn.findIndex((amount, index) => accountState.hookAllowances[index] < amount) : -1;
  const short = maxIn && accountState ? maxIn.some((amount, index) => accountState.balances[index] < amount) : false;
  const amounts = (values: bigint[] | null) => values ? symbols.map((symbol, index) => `${fmt(values[index], decimals[index], 2)} ${symbol}`).join(" · ") : "—";

  return <article className="sim-panel testnet-liquidity">
    <div className="sim-rule"><span>03 / RANGE LIQUIDITY</span><b>SHARES OF ONE RANGE · FEES PER RANGE</b></div>
    <div className="asset-picker"><span>RANGE</span><div className="range-picker">{book.ticks.map((candidate, index) => <button type="button" key={index} className={rangeId === index ? "asset-choice active" : "asset-choice"} aria-pressed={rangeId === index} onClick={() => setRangeId(index)}>{index + 1} · {ratio(candidate.k, candidate.radius)}</button>)}</div></div>
    <dl className="range-facts">
      <dt>State</dt><dd>{tick.isInterior ? "Interior (earning fees)" : "Boundary (trapped)"}</dd>
      <dt>Your shares</dt><dd>{account ? `${wadFmt(yourShares)} of ${wadFmt(totalShares)}` : "Connect a wallet"}</dd>
      <dt>Your unpaid fees</dt><dd>{account ? amounts(pending) : "—"}</dd>
    </dl>
    <div className="liq-row">
      <span>ADD</span>
      <div>{[1, 10, 100].map((bps) => <button type="button" key={bps} className={addBps === bps ? "asset-choice active" : "asset-choice"} onClick={() => setAddBps(bps)}>{bps / 100}%</button>)}</div>
      <small>of the range's supply · deposit {amounts(addPreview)}</small>
      {account && maxIn && (needsApproval >= 0
        ? <button className="button" type="button" disabled={busy} onClick={() => void run(`Approve ${symbols[needsApproval]} for liquidity`, approveRequest(DEPLOYMENT, needsApproval, DEPLOYMENT.hook))}>Approve {symbols[needsApproval]}</button>
        : <button className="button button-light" type="button" disabled={busy || short} onClick={() => void run(`Add liquidity to range ${rangeId + 1}`, addLiquidityRequest(DEPLOYMENT, rangeId, addShares, maxIn as unknown as readonly [bigint, bigint, bigint, bigint], deadline()))}>{short ? "Mint test tokens first" : "Add liquidity"}</button>)}
    </div>
    <div className="liq-row">
      <span>REMOVE</span>
      <div>{[2_500, 5_000, 10_000].map((bps) => <button type="button" key={bps} className={removeBps === bps ? "asset-choice active" : "asset-choice"} onClick={() => setRemoveBps(bps)}>{bps / 100}%</button>)}</div>
      <small>of your shares · receive {amounts(removePreview)}</small>
      {account && <button className="button" type="button" disabled={busy || removeShares === 0n || !removePreview} onClick={() => removePreview && void run(`Remove liquidity from range ${rangeId + 1}`, removeLiquidityRequest(DEPLOYMENT, rangeId, removeShares, removePreview.map((amount) => scaleDown(amount, 50)) as unknown as readonly [bigint, bigint, bigint, bigint], deadline()))}>Remove liquidity</button>}
    </div>
    {account && <div className="sim-actions"><button className="button" type="button" disabled={busy || pending.every((amount) => amount === 0n)} onClick={() => void run(`Collect range ${rangeId + 1} fees`, collectFeesRequest(DEPLOYMENT, rangeId, account))}>Collect fees</button></div>}
  </article>;
}

function ActivityPanel({ swaps, ok, account, accountState, busy, mint }: {
  swaps: RecentSwap[];
  ok: boolean;
  account: Address | null;
  accountState: AccountState | null;
  busy: boolean;
  mint: (assets: number[]) => Promise<void>;
}) {
  return <article className="sim-panel testnet-activity">
    <div className="sim-rule"><span>04 / FAUCET & ACTIVITY</span><b>MOCK TOKENS · PUBLIC MINT</b></div>
    <div className="faucet">
      <p>Each mock token has a public <code>mint</code>. Mint {FAUCET_UNITS.toLocaleString()} of each (four wallet confirmations), then trade or provide liquidity.</p>
      {account && accountState && <p className="balances">{symbols.map((symbol, index) => `${fmt(accountState.balances[index], decimals[index], 2)} ${symbol}`).join(" · ")}</p>}
      <button className="button button-light" type="button" disabled={!account || busy} onClick={() => void mint([0, 1, 2, 3])}>Mint {FAUCET_UNITS.toLocaleString()} of each</button>
    </div>
    <div className="recent-swaps">
      <p>RECENT ORBITAL SWAPS</p>
      {!ok && <span>The swap history is unavailable from this RPC right now.</span>}
      {ok && swaps.length === 0 && <span>No swaps found yet.</span>}
      {swaps.map((swap) => <a key={`${swap.hash}-${swap.input}-${swap.amountIn}`} href={explorerTx(swap.hash)} target="_blank" rel="noreferrer">
        {symbols[swap.input]} → {symbols[swap.output]} · {fmt(swap.amountIn, decimals[swap.input], 2)} in · {fmt(swap.amountOut, decimals[swap.output], 2)} out{swap.crossings > 0n ? ` · ${swap.crossings} crossing${swap.crossings === 1n ? "" : "s"}` : ""} ↗
      </a>)}
    </div>
  </article>;
}
