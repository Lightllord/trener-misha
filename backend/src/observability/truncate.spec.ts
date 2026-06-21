import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { truncate } from "./truncate.js";

describe("observability/truncate", () => {
  it("returns short text unchanged", () => {
    assert.equal(truncate("hello", 200), "hello");
  });

  it("collapses internal whitespace to single spaces", () => {
    assert.equal(truncate("a\n  b\t c", 200), "a b c");
  });

  it("trims surrounding whitespace", () => {
    assert.equal(truncate("  padded  ", 200), "padded");
  });

  it("clips to max and reports how many chars were dropped", () => {
    assert.equal(truncate("abcdefghij", 4), "abcd… (+6 chars)");
  });

  it("keeps text exactly at the limit", () => {
    assert.equal(truncate("abcd", 4), "abcd");
  });
});
