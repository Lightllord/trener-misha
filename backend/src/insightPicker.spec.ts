import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildPickerUserMessage,
  importanceFallback,
  latestCritical,
  pickInsight,
  resolvePick,
  summarizeForPicker,
  type ModelChooser,
} from "./insightPicker.js";
import type { Insight } from "./types/insight.js";

function makeInsight(overrides: Partial<Insight>): Insight {
  return {
    name: "draft_analysis",
    used: false,
    unique: true,
    number: null,
    payload: "payload",
    description: "desc",
    importance: "medium",
    createdAt: Date.now(),
    ...overrides,
  };
}

describe("insightPicker — pure helpers", () => {
  it("summarizeForPicker emits name/number/description/importance/ageSeconds", () => {
    const now = 10_000_000;
    const ins = makeInsight({ createdAt: now - 3_000 });
    const [out] = summarizeForPicker([ins], now);
    assert.deepEqual(out, {
      name: "draft_analysis",
      number: null,
      description: "desc",
      importance: "medium",
      ageSeconds: 3,
    });
  });

  it("summarizeForPicker clamps negative age to 0", () => {
    const now = 1_000;
    const ins = makeInsight({ createdAt: now + 5_000 });
    const [out] = summarizeForPicker([ins], now);
    assert.equal(out?.ageSeconds, 0);
  });

  it("importanceFallback ranks critical > high > medium > low", () => {
    const low = makeInsight({ payload: "l", importance: "low" });
    const med = makeInsight({ payload: "m", importance: "medium" });
    const high = makeInsight({ payload: "h", importance: "high" });
    const crit = makeInsight({ payload: "c", importance: "critical" });
    assert.equal(importanceFallback([low, med, high, crit]), crit);
    assert.equal(importanceFallback([low, med, high]), high);
    assert.equal(importanceFallback([low, med]), med);
    assert.equal(importanceFallback([low]), low);
  });

  it("importanceFallback prefers freshest on importance ties", () => {
    const older = makeInsight({ payload: "old", createdAt: 1 });
    const newer = makeInsight({ payload: "new", createdAt: 100 });
    assert.equal(importanceFallback([older, newer]), newer);
    assert.equal(importanceFallback([newer, older]), newer);
  });

  it("importanceFallback returns null on empty input", () => {
    assert.equal(importanceFallback([]), null);
  });

  it("latestCritical returns null when no critical is present", () => {
    const a = makeInsight({ importance: "high" });
    const b = makeInsight({ importance: "medium" });
    assert.equal(latestCritical([a, b]), null);
    assert.equal(latestCritical([]), null);
  });

  it("latestCritical returns the newest critical and ignores non-critical", () => {
    const older = makeInsight({
      payload: "older",
      importance: "critical",
      createdAt: 100,
    });
    const newerNonCrit = makeInsight({
      payload: "newer-high",
      importance: "high",
      createdAt: 200,
    });
    const newerCrit = makeInsight({
      payload: "newer-crit",
      importance: "critical",
      createdAt: 150,
    });
    assert.equal(latestCritical([older, newerNonCrit, newerCrit]), newerCrit);
  });

  it("buildPickerUserMessage includes both insights and dialogue", () => {
    const summary = summarizeForPicker([makeInsight({ createdAt: 0 })], 0);
    const msg = buildPickerUserMessage(summary, "Player: hi\nCoach: привет");
    assert.match(msg, /UNUSED_INSIGHTS:/);
    assert.match(msg, /RECENT_DIALOGUE:/);
    assert.match(msg, /Player: hi/);
  });

  it("buildPickerUserMessage renders placeholder on empty dialogue", () => {
    const summary = summarizeForPicker([makeInsight({ createdAt: 0 })], 0);
    const msg = buildPickerUserMessage(summary, "");
    assert.match(msg, /\(no recent dialogue\)/);
  });

  it("resolvePick finds an insight by name + number", () => {
    const a = makeInsight({ number: null });
    const unused = [a];
    const chosen = resolvePick('{"name":"draft_analysis","number":null}', unused);
    assert.equal(chosen, a);
  });

  it("resolvePick returns null when the name does not match any unused", () => {
    const a = makeInsight({ number: null });
    const chosen = resolvePick('{"name":"nope","number":null}', [a]);
    assert.equal(chosen, null);
  });

  it("resolvePick returns null for malformed JSON", () => {
    assert.equal(resolvePick("not json", []), null);
    assert.equal(resolvePick("", []), null);
    assert.equal(resolvePick("null", []), null);
  });

  it("resolvePick treats missing number as null", () => {
    const a = makeInsight({ number: null });
    const chosen = resolvePick('{"name":"draft_analysis"}', [a]);
    assert.equal(chosen, a);
  });
});

describe("insightPicker — pickInsight", () => {
  it("returns null for empty input without calling the model", async () => {
    let called = false;
    const chooser: ModelChooser = async () => {
      called = true;
      return "";
    };
    const out = await pickInsight([], { chooser });
    assert.equal(out, null);
    assert.equal(called, false);
  });

  it("shortcuts single-insight input without calling the model", async () => {
    let called = false;
    const chooser: ModelChooser = async () => {
      called = true;
      return "";
    };
    const only = makeInsight({});
    const out = await pickInsight([only], { chooser });
    assert.equal(out, only);
    assert.equal(called, false);
  });

  it("calls the chooser once for multi-insight input and resolves its pick", async () => {
    const a = makeInsight({ payload: "a", importance: "high" });
    const b = makeInsight({
      name: "draft_analysis",
      payload: "b",
      importance: "low",
      number: null,
    });

    let calls = 0;
    const chooser: ModelChooser = async () => {
      calls += 1;
      return '{"name":"draft_analysis","number":null}';
    };

    // Both insights share name=draft_analysis with number=null in this
    // construction; resolvePick returns the first match in `unused`. That's
    // sufficient to prove the chooser was consulted and its output wired in.
    const out = await pickInsight([a, b], { chooser });
    assert.equal(calls, 1);
    assert.equal(out, a);
  });

  it("falls back to importance ranking when the chooser returns junk", async () => {
    const low = makeInsight({ payload: "l", importance: "low" });
    const high = makeInsight({ payload: "h", importance: "high" });
    const chooser: ModelChooser = async () => "not json at all";
    const out = await pickInsight([low, high], { chooser });
    assert.equal(out, high);
  });

  it("falls back when the chooser throws", async () => {
    const low = makeInsight({ payload: "l", importance: "low" });
    const crit = makeInsight({ payload: "c", importance: "critical" });
    const chooser: ModelChooser = async () => {
      throw new Error("boom");
    };
    const out = await pickInsight([low, crit], { chooser });
    assert.equal(out, crit);
  });

  it("passes a non-aborted signal to the chooser for normal runs", async () => {
    const a = makeInsight({ payload: "a" });
    const b = makeInsight({ payload: "b", importance: "low" });
    let received: AbortSignal | undefined;
    const chooser: ModelChooser = async ({ signal }) => {
      received = signal;
      return '{"name":"draft_analysis","number":null}';
    };
    await pickInsight([a, b], { chooser });
    assert.ok(received);
    assert.equal(received?.aborted, false);
  });

  it("shortcuts past the model when any critical insight is present", async () => {
    let called = false;
    const chooser: ModelChooser = async () => {
      called = true;
      return "";
    };
    const high = makeInsight({ payload: "h", importance: "high", createdAt: 100 });
    const crit = makeInsight({ payload: "c", importance: "critical", createdAt: 50 });
    const out = await pickInsight([high, crit], { chooser });
    assert.equal(out, crit);
    assert.equal(called, false);
  });

  it("forwards recentDialogue into the chooser user message", async () => {
    const a = makeInsight({ payload: "a", importance: "high" });
    const b = makeInsight({ payload: "b", importance: "low" });
    let userSeen = "";
    const chooser: ModelChooser = async ({ user }) => {
      userSeen = user;
      return '{"name":"draft_analysis","number":null}';
    };
    await pickInsight([a, b], {
      chooser,
      recentDialogue: "Player: что по драфту?\nCoach: минутку",
    });
    assert.match(userSeen, /RECENT_DIALOGUE:/);
    assert.match(userSeen, /что по драфту\?/);
  });
});
