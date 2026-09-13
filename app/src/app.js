import { DEFAULT_MANIFEST, deploymentReady, validateManifest } from "./manifest.js";
import { connectWallet, matchingNetwork, mintCalldata, sendTransaction } from "./evm.js";
import { readPoolSnapshot, readPositions, readWalletBalances } from "./reads.js";
import { approveExact, deadlineFrom, liquidityAvailability, parseAmount, readAllowance, swapAvailability } from "./workflows.js";

const manifest = DEFAULT_MANIFEST;
const configError = validateManifest(manifest);
const state = { account: null, chainId: null };

const $ = (id) => document.getElementById(id);
const escapeHtml = (value) => String(value).replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]);
const shortAddress = (address) => `${address.slice(0, 6)}…${address.slice(-4)}`;

function setState(id, message, kind = "idle") {
  const element = $(id);
  element.textContent = message;
  element.dataset.kind = kind;
}

function setNotice(message, kind = "warning") {
  const notice = $("deployment-notice");
  notice.textContent = message;
  notice.className = message ? `notice show${kind === "error" ? " error" : ""}` : "notice";
}

function renderAssetRows(targetId, rows, detail) {
  $(targetId).innerHTML = rows.map((row) => `
    <div class="asset-row">
      <span>${escapeHtml(row.symbol)}${detail ? `<small>${escapeHtml(detail(row))}</small>` : ""}</span>
      <strong>${escapeHtml(row.display)}</strong>
    </div>`).join("");
}

function renderPool(snapshot) {
  $("reserve-grid").innerHTML = snapshot.reserves.map((reserve) => `
    <div class="reserve"><span>${escapeHtml(reserve.symbol)}</span><strong>${escapeHtml(reserve.display)}</strong></div>`).join("");
  $("tick-state").textContent = `Segments: ${snapshot.interiors.map((interior, index) => `${index}:${interior ? "interior" : "boundary"}`).join(" · ")}`;
}

function renderPositions(positions) {
  if (positions.length === 0) {
    $("position-table").innerHTML = "";
    return;
  }
  $("position-table").innerHTML = positions.map((position) => `
    <div class="asset-row">
      <span>Range ${position.rangeId}<small>${position.inventory.map((entry) => `${entry.symbol} ${entry.display}`).join(" · ")}</small></span>
      <strong>${position.shares.toString()} shares</strong>
    </div>`).join("");
}

function renderManifestState() {
  $("network-name").textContent = `${manifest.network.name} (${manifest.network.chainId})`;
  $("deployment-status").textContent = manifest.deployment.status.replaceAll("-", " ");
  $("faucet-token").innerHTML = manifest.assets.map((asset) => `<option value="${asset.symbol}">${asset.symbol}</option>`).join("");
  $("swap-input").innerHTML = manifest.assets.map((asset) => `<option value="${asset.symbol}">${asset.symbol}</option>`).join("");
  $("swap-output-token").innerHTML = manifest.assets.map((asset, index) => `<option value="${asset.symbol}"${index === 1 ? " selected" : ""}>${asset.symbol}</option>`).join("");
  $("liquidity-range").innerHTML = manifest.ranges.map((range) => `<option value="${range}">Range ${range}</option>`).join("");
  $("liquidity-inputs").innerHTML = manifest.assets.map((asset) => `
    <label class="liquidity-input">${asset.symbol}<input id="liquidity-${asset.symbol}" inputmode="decimal" autocomplete="off" placeholder="0.0" /></label>`).join("");
  if (configError) {
    setNotice(`Invalid deployment manifest: ${configError}`, "error");
    return;
  }
  if (!deploymentReady(manifest)) {
    setNotice("Awaiting a verified deployment manifest. Pool, balance and position values are unavailable—not zero.");
  }
}

function setWorkflowBadge(id, label, ready = false) {
  const badge = $(id);
  badge.textContent = label;
  badge.classList.toggle("ready", ready);
}

function selectedAsset(id) {
  return manifest.assets.find((asset) => asset.symbol === $(id).value);
}

function swapDraft() {
  const input = selectedAsset("swap-input");
  const output = selectedAsset("swap-output-token");
  if (!input || !output || input.symbol === output.symbol) throw new Error("Choose two different stablecoins.");
  const amountRaw = parseAmount($("swap-amount").value, input.decimals);
  const deadline = deadlineFrom(Math.floor(Date.now() / 1_000), Number($("swap-deadline").value));
  return { input, output, amountRaw, deadline };
}

function setWorkflowDisabled(disabled) {
  for (const id of ["swap-input", "swap-output-token", "swap-amount", "swap-slippage", "swap-deadline", "flip-route", "liquidity-range", "liquidity-shares", "add-liquidity", "remove-liquidity", "collect-fees"]) {
    $(id).disabled = disabled;
  }
  for (const asset of manifest.assets) $("liquidity-" + asset.symbol).disabled = disabled;
}

async function refreshWorkflowState() {
  if (configError) {
    setWorkflowDisabled(true);
    $("swap-approve").disabled = true;
    $("swap-submit").disabled = true;
    setWorkflowBadge("swap-badge", "Invalid manifest");
    setWorkflowBadge("liquidity-badge", "Invalid manifest");
    setState("swap-state", `Workflow unavailable: ${configError}`, "error");
    setState("liquidity-state", `Workflow unavailable: ${configError}`, "error");
    return;
  }
  const connected = Boolean(state.account && matchingNetwork(state.chainId, manifest));
  setWorkflowDisabled(!connected);
  $("swap-approve").disabled = true;
  $("swap-submit").disabled = true;
  $("add-liquidity").disabled = true;
  $("remove-liquidity").disabled = true;
  $("collect-fees").disabled = true;
  $("swap-output").textContent = "Quote unavailable";
  $("swap-minimum").textContent = "—";

  if (!state.account) {
    setWorkflowBadge("swap-badge", "Offline");
    setWorkflowBadge("liquidity-badge", "Offline");
    setState("swap-state", "Connect a wallet to prepare a route.");
    setState("liquidity-state", "Connect a wallet to inspect range actions.");
    return;
  }
  if (!matchingNetwork(state.chainId, manifest)) {
    setWorkflowBadge("swap-badge", "Wrong network");
    setWorkflowBadge("liquidity-badge", "Wrong network");
    setState("swap-state", `Switch to ${manifest.network.name} before preparing a swap.`);
    setState("liquidity-state", `Switch to ${manifest.network.name} before managing a range.`);
    return;
  }

  const swapIssue = swapAvailability(manifest);
  const liquidityIssue = liquidityAvailability(manifest);
  setWorkflowBadge("swap-badge", swapIssue ? "Awaiting router" : "Quote required", !swapIssue);
  setWorkflowBadge("liquidity-badge", liquidityIssue ? "Awaiting manager" : "Settlement required", !liquidityIssue);
  setState("swap-state", swapIssue ?? "A solver quote and verified router payload are required before a swap can be submitted.");
  setState("liquidity-state", liquidityIssue ?? "A verified position-manager payload is required before range actions can be submitted.");
  if (swapIssue) return;

  try {
    const draft = swapDraft();
    const allowance = await readAllowance(window.ethereum, draft.input.address, state.account, manifest.deployment.swapRouterAddress);
    if (allowance < draft.amountRaw) {
      $("swap-approve").disabled = false;
      setState("swap-state", `Approve ${draft.input.symbol} before this route can be submitted.`);
    } else {
      setState("swap-state", "Input allowance confirmed. A solver quote and router payload are still required.", "ready");
    }
  } catch (error) {
    if ($("swap-amount").value) setState("swap-state", `Route needs attention: ${error instanceof Error ? error.message : "invalid input"}`, "error");
  }
}

function flipRoute() {
  const input = $("swap-input");
  const output = $("swap-output-token");
  [input.value, output.value] = [output.value, input.value];
  refreshWorkflowState();
}

async function approveSwapInput() {
  try {
    const draft = swapDraft();
    $("swap-approve").disabled = true;
    setState("swap-state", `Requesting ${draft.input.symbol} approval in your wallet…`);
    const { hash } = await approveExact(window.ethereum, {
      tokenAddress: draft.input.address,
      owner: state.account,
      spender: manifest.deployment.swapRouterAddress,
      amountRaw: draft.amountRaw
    });
    setState("swap-state", `Approval confirmed: ${hash}. A verified quote is still required.`, "ready");
  } catch (error) {
    setState("swap-state", `Approval failed: ${error instanceof Error ? error.message : "wallet error"}`, "error");
  } finally {
    refreshWorkflowState();
  }
}

function updateNetworkState() {
  const label = $("network-state");
  if (!state.account) {
    label.textContent = "Wallet not connected";
    return;
  }
  if (!matchingNetwork(state.chainId, manifest)) {
    label.textContent = `Switch to ${manifest.network.name}`;
    return;
  }
  label.textContent = `${shortAddress(state.account)} · ${manifest.network.name}`;
}

function readUnavailable(message) {
  setState("pool-state", message);
  setState("balance-state", message);
  setState("position-state", message);
  $("reserve-grid").innerHTML = "";
  $("tick-state").textContent = "";
  $("balance-table").innerHTML = "";
  $("position-table").innerHTML = "";
}

async function refreshReads() {
  if (!state.account) return readUnavailable("Connect a wallet to read this data.");
  if (!matchingNetwork(state.chainId, manifest)) return readUnavailable(`Switch your wallet to ${manifest.network.name} to read this data.`);
  if (!deploymentReady(manifest)) return readUnavailable("Awaiting a verified deployment manifest. This is not a zero balance.");

  setState("pool-state", "Reading shared reserve book…");
  setState("balance-state", "Reading wallet balances…");
  setState("position-state", manifest.deployment.rangeShareBookAddress ? "Reading range claims…" : "No range-share book is configured.");
  try {
    const [pool, balances, positions] = await Promise.all([
      readPoolSnapshot(window.ethereum, manifest),
      readWalletBalances(window.ethereum, manifest, state.account),
      readPositions(window.ethereum, manifest, state.account)
    ]);
    renderPool(pool);
    renderAssetRows("balance-table", balances, (entry) => `${entry.raw.toString()} raw units`);
    renderPositions(positions);
    setState("pool-state", "Live pool read complete.", "ready");
    setState("balance-state", "Live wallet read complete.", "ready");
    setState("position-state", manifest.deployment.rangeShareBookAddress ? "Live range-claim read complete." : "No range-share book is configured.", manifest.deployment.rangeShareBookAddress ? "ready" : "idle");
  } catch (error) {
    const message = `Read failed: ${error instanceof Error ? error.message : "unknown RPC error"}`;
    setState("pool-state", message, "error");
    setState("balance-state", message, "error");
    setState("position-state", message, "error");
  }
}

function faucetAsset() {
  return manifest.assets.find((asset) => asset.symbol === $("faucet-token").value);
}

function updateFaucet() {
  const asset = faucetAsset();
  const enabled = Boolean(state.account && matchingNetwork(state.chainId, manifest) && asset?.faucet);
  $("faucet-token").disabled = !state.account || !matchingNetwork(state.chainId, manifest);
  $("faucet-submit").disabled = !enabled;
  if (!state.account) return setState("faucet-state", "Connect a wallet before requesting test tokens.");
  if (!matchingNetwork(state.chainId, manifest)) return setState("faucet-state", `Switch to ${manifest.network.name} before using the faucet.`);
  if (!asset?.faucet) return setState("faucet-state", "No faucet is configured for this deployment. No transaction can be sent.");
  setState("faucet-state", `Request ${asset.faucet.amountRaw} raw ${asset.symbol} units. Your wallet will ask for confirmation.`);
}

async function requestFaucet(event) {
  event.preventDefault();
  const asset = faucetAsset();
  if (!asset?.faucet || !state.account) return;
  try {
    setState("faucet-state", "Submitting faucet transaction…");
    const hash = await sendTransaction(window.ethereum, {
      from: state.account,
      to: asset.faucet.address,
      data: mintCalldata(state.account, asset.faucet.amountRaw)
    });
    setState("faucet-state", `Faucet transaction submitted: ${hash}`, "ready");
  } catch (error) {
    setState("faucet-state", `Faucet request failed: ${error instanceof Error ? error.message : "wallet error"}`, "error");
  }
}

async function connect() {
  $("connect-wallet").disabled = true;
  try {
    Object.assign(state, await connectWallet(window.ethereum));
    updateNetworkState();
    updateFaucet();
    await refreshWorkflowState();
    await refreshReads();
  } catch (error) {
    setNotice(error instanceof Error ? error.message : "Could not connect wallet.", "error");
  } finally {
    $("connect-wallet").disabled = false;
  }
}

renderManifestState();
updateNetworkState();
updateFaucet();
refreshWorkflowState();
$("connect-wallet").addEventListener("click", connect);
$("refresh-reads").addEventListener("click", refreshReads);
$("faucet-token").addEventListener("change", updateFaucet);
$("faucet-form").addEventListener("submit", requestFaucet);
$("swap-form").addEventListener("submit", (event) => {
  event.preventDefault();
  setState("swap-state", "Swap submission is unavailable until the solver and verified router payload are deployed.", "error");
});
$("swap-approve").addEventListener("click", approveSwapInput);
$("flip-route").addEventListener("click", flipRoute);
for (const id of ["swap-input", "swap-output-token", "swap-amount", "swap-slippage", "swap-deadline"]) {
  $(id).addEventListener("input", refreshWorkflowState);
  $(id).addEventListener("change", refreshWorkflowState);
}

window.ethereum?.on?.("accountsChanged", ([account]) => {
  state.account = account ?? null;
  updateNetworkState();
  updateFaucet();
  refreshWorkflowState();
  refreshReads();
});
window.ethereum?.on?.("chainChanged", (chainId) => {
  state.chainId = Number.parseInt(chainId, 16);
  updateNetworkState();
  updateFaucet();
  refreshWorkflowState();
  refreshReads();
});
