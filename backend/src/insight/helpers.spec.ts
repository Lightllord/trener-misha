import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  importanceFallback,
  latestCritical,
  resolvePick,
  summarizeForPicker,
} from "./helpers.js";
import type { Insight } from "./types/insight.js";

function makeInsight(overrides: Partial<Insight> = {}): Insight {
  return {
    name: "draft_analysis",
    used: false,
    unique: true,
    number: null,
    payload: "payload",
    description: "desc",
    importance: "medium",
    ttlMs: 999_999_999,
    createdAt: Date.now(),
    ...overrides,
  };
}

describe("insight/helpers — summarizeForPicker", () => {
  it("emits index/name/number/description/importance/ageSeconds", () => {
    const now = 10_000_000;
    const ins = makeInsight({ createdAt: now - 3_000 });
    const [out] = summarizeForPicker([ins], now);
    assert.deepEqual(out, {
      index: 0,
      name: "draft_analysis",
      number: null,
      description: "desc",
      importance: "medium",
      ageSeconds: 3,
    });
  });

  it("preserves array order as index", () => {
    const now = 1_000;
    const a = makeInsight({ payload: "a", createdAt: now });
    const b = makeInsight({ payload: "b", createdAt: now });
    const out = summarizeForPicker([a, b], now);
    assert.equal(out[0]?.index, 0);
    assert.equal(out[1]?.index, 1);
  });

  it("clamps negative age to 0", () => {
    const now = 1_000;
    const ins = makeInsight({ createdAt: now + 5_000 });
    const [out] = summarizeForPicker([ins], now);
    assert.equal(out?.ageSeconds, 0);
  });
});

describe("insight/helpers — importanceFallback", () => {
  it("ranks critical > high > medium > low", () => {
    const low = makeInsight({ importance: "low" });
    const med = makeInsight({ importance: "medium" });
    const high = makeInsight({ importance: "high" });
    const crit = makeInsight({ importance: "critical" });
    assert.equal(importanceFallback([low, med, high, crit]), crit);
    assert.equal(importanceFallback([low, med, high]), high);
    assert.equal(importanceFallback([low, med]), med);
    assert.equal(importanceFallback([low]), low);
  });

  it("prefers freshest on importance ties", () => {
    const older = makeInsight({ payload: "old", createdAt: 1 });
    const newer = makeInsight({ payload: "new", createdAt: 100 });
    assert.equal(importanceFallback([older, newer]), newer);
    assert.equal(importanceFallback([newer, older]), newer);
  });

  it("returns null on empty input", () => {
    assert.equal(importanceFallback([]), null);
  });
});

describe("insight/helpers — latestCritical", () => {
  it("returns the freshest critical and ignores non-critical", () => {
    const older = makeInsight({ importance: "critical", createdAt: 100 });
    const newerHigh = makeInsight({ importance: "high", createdAt: 200 });
    const newerCrit = makeInsight({ importance: "critical", createdAt: 150 });
    assert.equal(latestCritical([older, newerHigh, newerCrit]), newerCrit);
  });

  it("returns null when no critical is present", () => {
    const a = makeInsight({ importance: "high" });
    const b = makeInsight({ importance: "medium" });
    assert.equal(latestCritical([a, b]), null);
    assert.equal(latestCritical([]), null);
  });
});

describe("insight/helpers — resolvePick", () => {
  it("accepts an index shape", () => {
    const a = makeInsight({ payload: "a" });
    const b = makeInsight({ payload: "b" });
    assert.equal(resolvePick('{"index":1}', [a, b]), b);
    assert.equal(resolvePick('{"index":5}', [a, b]), null);
  });

  it("accepts a name+number shape as fallback", () => {
    const a = makeInsight({ name: "draft_analysis", number: null });
    assert.equal(resolvePick('{"name":"draft_analysis"}', [a]), a);
    assert.equal(
      resolvePick('{"name":"draft_analysis","number":null}', [a]),
      a,
    );
    assert.equal(resolvePick('{"name":"nope"}', [a]), null);
  });

  it("returns null on malformed JSON or empty fields", () => {
    assert.equal(resolvePick("not json", []), null);
    assert.equal(resolvePick("null", []), null);
    assert.equal(resolvePick("{}", []), null);
  });
});
