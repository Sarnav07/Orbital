/** The C14 fixture is copied here for browser loading and checked for parity in tests. */
export const SEGMENTED_WAD_V1 = Object.freeze({
  version: 1,
  assetCount: 4,
  initialReserves: [
    "100000000000000000000",
    "100000000000000000000",
    "100000000000000000000",
    "100000000000000000000"
  ],
  initialInteriorBitmap: "3",
  actions: [{
    input: 0,
    output: 1,
    amountIn: "100000000000000000000",
    amountOut: "40123552802932248591",
    interiorBitmap: "2"
  }]
});

export const ASSET_SYMBOLS = Object.freeze(["USDC", "USDT", "DAI", "FRAX"]);
