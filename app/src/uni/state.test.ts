import { describe, expect, it } from "vitest";
import { MAX_CATCH_UP_BLOCKS, catchUpFrom } from "./state";

describe("live swap feed catch-up", () => {
  it("scans only the new blocks after a normal poll", () => {
    expect(catchUpFrom(100n, 110n)).toBe(101n);
  });

  it("skips ahead after a long gap instead of issuing thousands of log requests", () => {
    const latest = 63_000_000n;
    expect(catchUpFrom(11_000_000n, latest)).toBe(latest - MAX_CATCH_UP_BLOCKS + 1n);
    expect(latest - catchUpFrom(11_000_000n, latest) + 1n).toBe(MAX_CATCH_UP_BLOCKS);
  });

  it("never scans below block 0 on a young chain", () => {
    expect(catchUpFrom(0n, 5n)).toBe(1n);
  });
});
