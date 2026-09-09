import { DEFAULT_MANIFEST, deploymentReady, validateManifest } from "./manifest.js";
import { connectWallet, matchingNetwork, mintCalldata, sendTransaction } from "./evm.js";
import { readPoolSnapshot, readPositions, readWalletBalances } from "./reads.js";

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
  if (configError) {
    setNotice(`Invalid deployment manifest: ${configError}`, "error");
    return;
  }
  if (!deploymentReady(manifest)) {
    setNotice("Awaiting a verified deployment manifest. Pool, balance and position values are unavailable—not zero.");
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
$("connect-wallet").addEventListener("click", connect);
$("refresh-reads").addEventListener("click", refreshReads);
$("faucet-token").addEventListener("change", updateFaucet);
$("faucet-form").addEventListener("submit", requestFaucet);

window.ethereum?.on?.("accountsChanged", ([account]) => {
  state.account = account ?? null;
  updateNetworkState();
  updateFaucet();
  refreshReads();
});
window.ethereum?.on?.("chainChanged", (chainId) => {
  state.chainId = Number.parseInt(chainId, 16);
  updateNetworkState();
  updateFaucet();
  refreshReads();
});
