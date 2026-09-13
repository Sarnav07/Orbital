import { DEFAULT_MANIFEST, deploymentReady, validateManifest } from "./manifest.js";
import { connectWallet, matchingNetwork, mintCalldata, sendTransaction } from "./evm.js";
import { readPoolSnapshot, readPositions, readWalletBalances } from "./reads.js";
import { approveExact, deadlineFrom, liquidityAvailability, parseAmount, readAllowance, swapAvailability } from "./workflows.js";
import { formatWad, pairSlice, replayFrames, tickSummary, triangleProjection } from "./geometry.js";
import { ASSET_SYMBOLS, SEGMENTED_WAD_V1 } from "./replay-fixture.js";

const manifest = DEFAULT_MANIFEST;
const configError = validateManifest(manifest);
const state = { account: null, chainId: null };
const replayFramesForFixture = replayFrames(SEGMENTED_WAD_V1);
let replayFrameIndex = 0;

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
  $("slice-input").innerHTML = ASSET_SYMBOLS.map((symbol, index) => `<option value="${index}">${symbol}</option>`).join("");
  $("slice-output").innerHTML = ASSET_SYMBOLS.map((symbol, index) => `<option value="${index}"${index === 1 ? " selected" : ""}>${symbol}</option>`).join("");
  if (configError) {
    setNotice(`Invalid deployment manifest: ${configError}`, "error");
    return;
  }
  if (!deploymentReady(manifest)) {
    setNotice("Awaiting a verified deployment manifest. Pool, balance and position values are unavailable—not zero.");
  }
}

function frame() {
  return replayFramesForFixture[replayFrameIndex];
}

function renderTriangle(currentFrame) {
  const projection = triangleProjection(currentFrame.reserves);
  const labels = projection.points.map((point) => `<text class="triangle-label" x="${point.x}" y="${point.y + (point.y < 50 ? -4 : 7)}" text-anchor="middle">${point.label}</text>`).join("");
  $("triangle-plot").innerHTML = `
    <polygon class="triangle-frame" points="50,8 8,88 92,88" />
    <line class="triangle-guide" x1="50" y1="61.33" x2="50" y2="8" />
    <line class="triangle-guide" x1="50" y1="61.33" x2="8" y2="88" />
    <line class="triangle-guide" x1="50" y1="61.33" x2="92" y2="88" />
    <circle class="triangle-balanced" cx="50" cy="61.33" r="2.1" />
    <circle class="triangle-point" cx="${projection.point.x.toFixed(3)}" cy="${projection.point.y.toFixed(3)}" r="3.2" />
    ${labels}`;
  $("triangle-legend").innerHTML = projection.shares.map((share, index) => `<span><strong>${projection.points[index].label}</strong> ${(share * 100).toFixed(1)}%</span>`).join("");
}

function renderSlice(currentFrame) {
  let inputIndex = Number($("slice-input").value);
  let outputIndex = Number($("slice-output").value);
  if (inputIndex === outputIndex) {
    outputIndex = (inputIndex + 1) % ASSET_SYMBOLS.length;
    $("slice-output").value = String(outputIndex);
  }
  const slice = pairSlice(currentFrame.reserves, inputIndex, outputIndex);
  const maximum = slice.input.raw > slice.output.raw ? slice.input.raw : slice.output.raw;
  const inputWidth = Number(slice.input.raw * 76n / maximum);
  const outputWidth = Number(slice.output.raw * 76n / maximum);
  $("slice-plot").innerHTML = `
    <text class="slice-label" x="0" y="13">${slice.input.symbol}</text><rect class="slice-track" x="20" y="7" width="76" height="11" rx="1" /><rect class="slice-bar-input" x="20" y="7" width="${inputWidth}" height="11" rx="1" /><text class="slice-value" x="100" y="14">${slice.input.display}</text>
    <text class="slice-label" x="0" y="38">${slice.output.symbol}</text><rect class="slice-track" x="20" y="32" width="76" height="11" rx="1" /><rect class="slice-bar-output" x="20" y="32" width="${outputWidth}" height="11" rx="1" /><text class="slice-value" x="100" y="39">${slice.output.display}</text>`;
  $("slice-state").textContent = `${slice.unchanged.join(" and ")} remain in the same shared reserve book; this panel does not isolate a pair pool.`;
}

function renderRangeSummary() {
  $("range-summary").innerHTML = tickSummary().map((range) => `
    <div class="range-row"><span>Range ${range.rangeId}</span>
      <span class="range-metric">Virtual floor<strong>${range.virtualDisplay}</strong></span>
      <span class="range-metric">Real at peg<strong>${range.realAtPegDisplay}</strong></span>
    </div>`).join("");
}

function renderReplay(currentFrame) {
  const action = currentFrame.action;
  $("replay-step").textContent = `Frame ${replayFrameIndex} / ${replayFramesForFixture.length - 1}`;
  $("replay-slider").value = String(replayFrameIndex);
  $("replay-back").disabled = replayFrameIndex === 0;
  $("replay-forward").disabled = replayFrameIndex === replayFramesForFixture.length - 1;
  $("replay-description").textContent = action
    ? `${ASSET_SYMBOLS[action.input]} +${formatWad(action.amountIn)}; ${ASSET_SYMBOLS[action.output]} −${formatWad(action.amountOut)}. Interior bitmap is 0b${currentFrame.interiorBitmap.toString(2).padStart(2, "0")}.`
    : `Initial fixture state. Both ranges are interior: bitmap 0b${currentFrame.interiorBitmap.toString(2).padStart(2, "0")}.`;
  $("replay-reserves").innerHTML = currentFrame.reserves.map((reserve, index) => `
    <div class="replay-reserve"><span>${ASSET_SYMBOLS[index]}</span><strong>${formatWad(reserve)}</strong></div>`).join("");
}

function renderVisuals() {
  const currentFrame = frame();
  renderTriangle(currentFrame);
  renderSlice(currentFrame);
  renderRangeSummary();
  renderReplay(currentFrame);
}

function setReplayFrame(index) {
  replayFrameIndex = Math.max(0, Math.min(replayFramesForFixture.length - 1, Number(index)));
  renderVisuals();
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
renderVisuals();
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
$("slice-input").addEventListener("change", renderVisuals);
$("slice-output").addEventListener("change", renderVisuals);
$("replay-slider").addEventListener("input", (event) => setReplayFrame(event.target.value));
$("replay-back").addEventListener("click", () => setReplayFrame(replayFrameIndex - 1));
$("replay-reset").addEventListener("click", () => setReplayFrame(0));
$("replay-forward").addEventListener("click", () => setReplayFrame(replayFrameIndex + 1));

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
