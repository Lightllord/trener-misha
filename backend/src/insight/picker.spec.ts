import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { addInsight, clearInsights } from "./store.js";
import { INSIGHT_CONFIGS } from "./consts/insights.js";
import { InsightPicker } from "./picker.js";
import type { ConversationEntry } from "../conversation/types/log.js";
import type {
  Insight,
  InsightConfig,
  InsightName,
} from "./types/insight.js";

const T_A = "test_a" as InsightName;
const T_B = "test_b" as InsightName;
const T_C = "test_c" as InsightName;
const configsWritable = INSIGHT_CONFIGS as Record<string, InsightConfig>;

function tempConfig(
  name: string,
  config: InsightConfig,
): { restore: () => void } {
  const prev = configsWritable[name];
  configsWritable[name] = config;
  return {
    restore: () => {
      if (prev === undefined) {
        delete configsWritable[name];
      } else {
        configsWritable[name] = prev;
      }
    },
  };
}

function flushMicrotasks(): Promise<void> {
  return new Promise((r) => setImmediate(r));
}

/**
 * Test-only subclass: overrides `callModel` so specs never reach the real
 * OpenAI client. Lives only in this spec file — the production class has no
 * test-only API.
 */
class TestPicker extends InsightPicker {
  public callCount = 0;
  public lastUserMessage = "";
  public nextResponse:
    | string
    | (() => string | Promise<string>)
    | { reject: unknown } = "";

  protected override async callModel(user: string): Promise<string> {
    this.callCount += 1;
    this.lastUserMessage = user;
    const next = this.nextResponse;
    if (typeof next === "object" && next !== null && "reject" in next) {
      throw next.reject;
    }
    if (typeof next === "function") {
      return next();
    }
    return next;
  }
}

function addWithConfig(
  name: InsightName,
  payload: string,
  config: InsightConfig,
): Insight {
  const scope = tempConfig(name, config);
  const inserted = addInsight(name, payload);
  scope.restore();
  assert.ok(inserted);
  return inserted;
}

function makePicker(options: {
  signal?: AbortSignal;
  dialogue?: readonly ConversationEntry[];
  response?: TestPicker["nextResponse"];
} = {}): TestPicker {
  const signal = options.signal ?? new AbortController().signal;
  const getDialogue = () => options.dialogue ?? [];
  const picker = new TestPicker(signal, getDialogue);
  if (options.response !== undefined) {
    picker.nextResponse = options.response;
  }
  return picker;
}

describe("InsightPicker — getSomethingToDeliverNow", () => {
  beforeEach(() => {
    clearInsights();
  });

  it("returns null when there are no unused insights, without calling the model", () => {
    const picker = makePicker();
    assert.equal(picker.getSomethingToDeliverNow(), null);
    assert.equal(picker.callCount, 0);
  });

  it("returns the only unused insight and marks it used, without calling the model", () => {
    const insight = addInsight("draft_analysis", "p");
    assert.ok(insight);

    const picker = makePicker();
    assert.equal(picker.getSomethingToDeliverNow(), insight);
    assert.equal(insight.used, true);
    assert.equal(picker.callCount, 0);
  });

  it("critical shortcut: returns the critical, marks used, and kicks thinking over non-criticals", async () => {
    const high = addWithConfig(T_A, "h", {
      unique: true,
      description: "h",
      importance: "high",
    });
    const med = addWithConfig(T_B, "m", {
      unique: true,
      description: "m",
      importance: "medium",
    });
    const crit = addWithConfig(T_C, "c", {
      unique: true,
      description: "c",
      importance: "critical",
    });

    const picker = makePicker();
    assert.equal(picker.getSomethingToDeliverNow(), crit);
    assert.equal(crit.used, true);

    await flushMicrotasks();
    assert.equal(picker.callCount, 1);
    assert.match(picker.lastUserMessage, /<name>test_a<\/name>/);
    assert.match(picker.lastUserMessage, /<name>test_b<\/name>/);
    assert.doesNotMatch(picker.lastUserMessage, /<name>test_c<\/name>/);
    assert.equal(high.used, false);
    assert.equal(med.used, false);
  });

  it("schedules thinking once for ≥ 2 non-critical unused", async () => {
    addWithConfig(T_A, "a", {
      unique: true,
      description: "a",
      importance: "high",
    });
    addWithConfig(T_B, "b", {
      unique: true,
      description: "b",
      importance: "medium",
    });

    const picker = makePicker();
    assert.equal(picker.getSomethingToDeliverNow(), null);
    assert.equal(picker.callCount, 1);

    // Second call while still in-flight does not schedule another thinking.
    assert.equal(picker.getSomethingToDeliverNow(), null);
    assert.equal(picker.callCount, 1);
  });

  it("consumes a stashed thinking result on the next call and marks it used", async () => {
    const a = addWithConfig(T_A, "a", {
      unique: true,
      description: "a",
      importance: "high",
    });
    const b = addWithConfig(T_B, "b", {
      unique: true,
      description: "b",
      importance: "medium",
    });

    // Filter order is [a, b]; index 1 is b.
    const picker = makePicker({ response: '{"index":1}' });
    assert.equal(picker.getSomethingToDeliverNow(), null);
    await flushMicrotasks();

    assert.equal(picker.getSomethingToDeliverNow(), b);
    assert.equal(b.used, true);
    assert.equal(a.used, false);
  });

  it("stashed thinking result is discarded when the insight was marked used externally", async () => {
    const a = addWithConfig(T_A, "a", {
      unique: true,
      description: "a",
      importance: "high",
    });
    const b = addWithConfig(T_B, "b", {
      unique: true,
      description: "b",
      importance: "medium",
    });

    const picker = makePicker({ response: '{"index":1}' });
    picker.getSomethingToDeliverNow();
    await flushMicrotasks();

    b.used = true;

    // With only `a` still unused, the single-branch fires.
    assert.equal(picker.getSomethingToDeliverNow(), a);
    assert.equal(a.used, true);
  });

  it("discards a thinking result when the signal was aborted mid-flight", async () => {
    const a = addWithConfig(T_A, "a", {
      unique: true,
      description: "a",
      importance: "high",
    });
    const b = addWithConfig(T_B, "b", {
      unique: true,
      description: "b",
      importance: "medium",
    });

    const controller = new AbortController();
    const picker = makePicker({
      signal: controller.signal,
      response: '{"index":1}',
    });

    picker.getSomethingToDeliverNow();
    controller.abort();
    await flushMicrotasks();

    assert.equal(picker.getSomethingToDeliverNow(), null);
    assert.equal(a.used, false);
    assert.equal(b.used, false);
  });

  it("falls back to importance ranking when the model returns junk", async () => {
    const low = addWithConfig(T_A, "l", {
      unique: true,
      description: "l",
      importance: "low",
    });
    const high = addWithConfig(T_B, "h", {
      unique: true,
      description: "h",
      importance: "high",
    });

    const picker = makePicker({ response: "not json" });
    picker.getSomethingToDeliverNow();
    await flushMicrotasks();

    assert.equal(picker.getSomethingToDeliverNow(), high);
    assert.equal(high.used, true);
    assert.equal(low.used, false);
  });

  it("falls back to importance ranking when the model throws", async () => {
    const low = addWithConfig(T_A, "l", {
      unique: true,
      description: "l",
      importance: "low",
    });
    const high = addWithConfig(T_B, "h", {
      unique: true,
      description: "h",
      importance: "high",
    });

    const picker = makePicker({ response: { reject: new Error("boom") } });
    picker.getSomethingToDeliverNow();
    await flushMicrotasks();

    assert.equal(picker.getSomethingToDeliverNow(), high);
    assert.equal(high.used, true);
    assert.equal(low.used, false);
  });

  it("skips thinking when there is only one non-critical candidate", async () => {
    addWithConfig(T_A, "a", {
      unique: true,
      description: "a",
      importance: "high",
    });
    addWithConfig(T_B, "b", {
      unique: true,
      description: "b",
      importance: "critical",
    });

    const picker = makePicker();
    picker.getSomethingToDeliverNow();
    await flushMicrotasks();
    assert.equal(picker.callCount, 0);
  });

  it("passes the dialogue markup into the model user message", async () => {
    addWithConfig(T_A, "a", {
      unique: true,
      description: "a",
      importance: "high",
    });
    addWithConfig(T_B, "b", {
      unique: true,
      description: "b",
      importance: "medium",
    });

    const dialogue: ConversationEntry[] = [
      { role: "user", text: "что по драфту?", at: 0 },
      { role: "assistant", text: "минутку", at: 1 },
    ];
    const picker = makePicker({ dialogue });

    picker.getSomethingToDeliverNow();
    await flushMicrotasks();

    assert.match(picker.lastUserMessage, /<unused-insights>/);
    assert.match(picker.lastUserMessage, /<message-history>/);
    assert.match(picker.lastUserMessage, /что по драфту/);
    assert.match(picker.lastUserMessage, /Coach/);
  });
});

describe("InsightPicker — formatForInjection / reset", () => {
  beforeEach(() => {
    clearInsights();
  });

  it("formatForInjection increments the per-instance counter", () => {
    const insight = addInsight("draft_analysis", "p");
    assert.ok(insight);
    const picker = makePicker();

    const first = picker.formatForInjection(insight);
    const second = picker.formatForInjection(insight);

    assert.match(first, /<insight-1>/);
    assert.match(second, /<insight-2>/);
  });

  it("reset() clears the injection counter and thinking state", async () => {
    addWithConfig(T_A, "a", {
      unique: true,
      description: "a",
      importance: "high",
    });
    addWithConfig(T_B, "b", {
      unique: true,
      description: "b",
      importance: "medium",
    });

    const picker = makePicker();
    picker.getSomethingToDeliverNow();
    await flushMicrotasks();
    assert.equal(picker.callCount, 1);

    picker.reset();

    const insight = addInsight("draft_analysis", "p");
    assert.ok(insight);
    assert.match(picker.formatForInjection(insight), /<insight-1>/);

    // In-flight flag was cleared → a fresh thinking schedules again.
    picker.getSomethingToDeliverNow();
    assert.equal(picker.callCount, 2);
  });
});
