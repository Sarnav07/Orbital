import { replayFrames, torusInspection } from "./geometry.js";

const INITIAL_RESERVES = [
  "100000000000000000000",
  "100000000000000000000",
  "100000000000000000000",
  "100000000000000000000"
];

const USDT_PRESSURE = Object.freeze({
  input: 1,
  output: 0,
  amountIn: "100000000000000000000",
  amountOut: "40123552802932248591",
  interiorBitmap: "2"
});

const USDT_RECOVERY = Object.freeze({
  input: 0,
  output: 1,
  amountIn: "10000000000000000000",
  amountOut: "55388274986160229318",
  interiorBitmap: "3"
});

function trace(actions) {
  return { version: 1, assetCount: 4, initialReserves: INITIAL_RESERVES, initialInteriorBitmap: "3", actions };
}

export const SCENARIOS = Object.freeze([
  {
    id: "peg",
    title: "Reference peg",
    externalMarker: "1.000",
    markerNote: "Illustrative external reference only; no transaction is modeled.",
    trace: trace([])
  },
  {
    id: "usdt-pressure",
    title: "USDT depeg-style pressure",
    externalMarker: "0.970",
    markerNote: "Illustrative external reference marker. The model changes only through the USDT→USDC trade below.",
    trace: trace([USDT_PRESSURE])
  },
  {
    id: "usdt-recovery",
    title: "USDT recovery flow",
    externalMarker: "1.000",
    markerNote: "The marker returns to 1.000, but reserves are not reset. An opposing USDC→USDT trade recovers the first boundary only.",
    trace: trace([USDT_PRESSURE, USDT_RECOVERY])
  }
]);

export function scenarioById(id) {
  const scenario = SCENARIOS.find((candidate) => candidate.id === id);
  if (!scenario) throw new RangeError("Unknown scenario.");
  return scenario;
}

export function scenarioFrames(scenario) {
  return replayFrames(scenario.trace).map((frame, index) => ({ ...frame, inspection: torusInspection(frame.reserves, frame.interiorBitmap), index }));
}

export function compareObservedFrame(expected, observed) {
  if (!observed) return { status: "unavailable", message: "No confirmed hook snapshot is available." };
  const reserveMatch = expected.reserves.every((reserve, index) => BigInt(observed.reserves[index]) === reserve);
  const bitmap = observed.interiors.reduce((value, interior, index) => value | (interior ? 1n << BigInt(index) : 0n), 0n);
  const bitmapMatch = bitmap === expected.interiorBitmap;
  if (reserveMatch && bitmapMatch) return { status: "match", message: "Current hook snapshot exactly matches this modeled frame." };
  return { status: "mismatch", message: "Current hook snapshot differs from this modeled frame; no attribution is inferred." };
}
