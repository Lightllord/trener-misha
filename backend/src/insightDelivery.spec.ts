import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { addInsight, clearInsights } from "./insights.js";
import { createInsightDelivery } from "./insightDelivery.js";
import { INSIGHT_CONFIGS } from "./consts/insights.js";
import type {
  Insight,
  InsightConfig,
  InsightName,
} from "./types/insight.js";

const T_A = "test_a" as InsightName;
const T_B = "test_b" as InsightName;
const configsWritable = INSIGHT_CONFIGS as Record<string, InsightConfig>;

function tempConfig(
  name: string,
  config: InsightConfig,
): { restore: () => void } {
  const prev = configsWritable[name];
  configsWritable[name] = config;
  return {
    restore: () =>
      prev === undefined
        ? delete configsWritable[name]
        : (configsWritable[name] = prev),
  };
}

function flushMicrotasks(): Promise<void> {
  return new Promise((r) => setImmediate(r));
}

interface Harness {
  injected: string[];
  isResponseActive: boolean;
  signal: AbortSignal;
  abort: () => void;
  pickCalls: number;
  lastPickArgs: {
    unused: readonly Insight[];
    recentDialogue: string;
  } | null;
  setPickResult: (insight: Insight | null | Error) => void;
  errors: Array<{ msg: string; err: unknown }>;
}

function makeHarness(): {
  delivery: ReturnType<typeof createInsightDelivery>;
  h: Harness;
} {
  const controller = new AbortController();
  const h: Harness = {
    injected: [],
    isResponseActive: false,
    signal: controller.signal,
    abort: () => controller.abort(),
    pickCalls: 0,
    lastPickArgs: null,
    setPickResult: () => {
      throw new Error("setPickResult called before pick()");
    },
    errors: [],
  };

  const delivery = createInsightDelivery({
    inject: (text) => {
      h.injected.push(text);
      h.isResponseActive = true; // simulate real injectMessage behavior
    },
    isResponseActive: () => h.isResponseActive,
    getRecentDialogue: () => "dialogue-stub",
    signal: h.signal,
    pick: async (unused, opts) => {
      h.pickCalls += 1;
      h.lastPickArgs = { unused, recentDialogue: opts.recentDialogue };
      return new Promise<Insight | null>((resolve, reject) => {
        h.setPickResult = (result) => {
          if (result instanceof Error) reject(result);
          else resolve(result);
        };
      });
    },
    log: () => {},
    logError: (msg, err) => {
      h.errors.push({ msg, err });
    },
  });

  return { delivery, h };
}

describe("insightDelivery", () => {
  beforeEach(() => {
    clearInsights();
  });

  it("returns false and does not inject when responseActive is true", () => {
    addInsight("draft_analysis", "p");
    const { delivery, h } = makeHarness();
    h.isResponseActive = true;
    assert.equal(delivery.tryDeliver(), false);
    assert.equal(h.injected.length, 0);
    assert.equal(h.pickCalls, 0);
  });

  it("returns false when there are no unused insights", () => {
    const { delivery, h } = makeHarness();
    assert.equal(delivery.tryDeliver(), false);
    assert.equal(h.injected.length, 0);
    assert.equal(h.pickCalls, 0);
  });

  it("injects directly when exactly one insight is unused", () => {
    const added = addInsight("draft_analysis", "single");
    assert.ok(added);
    const { delivery, h } = makeHarness();

    assert.equal(delivery.tryDeliver(), true);
    assert.deepEqual(h.injected, ["single"]);
    assert.equal(added.used, true);
    assert.equal(h.pickCalls, 0);
  });

  it("shortcuts past the picker when a critical insight is present", () => {
    const a = tempConfig(T_A, {
      unique: true,
      description: "a",
      importance: "high",
    });
    const b = tempConfig(T_B, {
      unique: true,
      description: "b",
      importance: "critical",
    });
    try {
      const high = addInsight(T_A, "a-payload");
      const crit = addInsight(T_B, "b-payload");
      assert.ok(high && crit);

      const { delivery, h } = makeHarness();
      assert.equal(delivery.tryDeliver(), true);
      assert.deepEqual(h.injected, ["b-payload"]);
      assert.equal(crit.used, true);
      assert.equal(high.used, false);
      assert.equal(h.pickCalls, 0);
    } finally {
      a.restore();
      b.restore();
    }
  });

  it("kicks off the picker for multi non-critical insights and injects on resolve", async () => {
    const a = tempConfig(T_A, {
      unique: true,
      description: "a",
      importance: "high",
    });
    const b = tempConfig(T_B, {
      unique: true,
      description: "b",
      importance: "medium",
    });
    try {
      const ia = addInsight(T_A, "a-payload");
      const ib = addInsight(T_B, "b-payload");
      assert.ok(ia && ib);

      const { delivery, h } = makeHarness();
      assert.equal(delivery.tryDeliver(), false);
      assert.equal(h.pickCalls, 1);
      assert.equal(h.lastPickArgs?.recentDialogue, "dialogue-stub");
      assert.equal(h.lastPickArgs?.unused.length, 2);
      assert.equal(h.injected.length, 0);

      h.setPickResult(ib);
      await flushMicrotasks();

      assert.deepEqual(h.injected, ["b-payload"]);
      assert.equal(ib.used, true);
      assert.equal(ia.used, false);
    } finally {
      a.restore();
      b.restore();
    }
  });

  it("stashes in pending when picker resolves while responseActive is true", async () => {
    const a = tempConfig(T_A, {
      unique: true,
      description: "a",
      importance: "high",
    });
    const b = tempConfig(T_B, {
      unique: true,
      description: "b",
      importance: "medium",
    });
    try {
      const ia = addInsight(T_A, "a-payload");
      const ib = addInsight(T_B, "b-payload");
      assert.ok(ia && ib);

      const { delivery, h } = makeHarness();
      delivery.tryDeliver(); // kicks off picker
      h.isResponseActive = true; // turn started mid-flight
      h.setPickResult(ia);
      await flushMicrotasks();

      // Picker resolved, but responseActive was true → stashed, nothing injected
      assert.equal(h.injected.length, 0);
      assert.equal(ia.used, false);

      // Turn finished → next tryDeliver consumes the pending slot
      h.isResponseActive = false;
      assert.equal(delivery.tryDeliver(), true);
      assert.deepEqual(h.injected, ["a-payload"]);
      assert.equal(ia.used, true);
    } finally {
      a.restore();
      b.restore();
    }
  });

  it("skips injection when the signal is aborted before picker resolves", async () => {
    const a = tempConfig(T_A, {
      unique: true,
      description: "a",
      importance: "high",
    });
    const b = tempConfig(T_B, {
      unique: true,
      description: "b",
      importance: "medium",
    });
    try {
      const ia = addInsight(T_A, "a-payload");
      const ib = addInsight(T_B, "b-payload");
      assert.ok(ia && ib);

      const { delivery, h } = makeHarness();
      delivery.tryDeliver();
      h.abort();
      h.setPickResult(ia);
      await flushMicrotasks();

      assert.equal(h.injected.length, 0);
      assert.equal(ia.used, false);
    } finally {
      a.restore();
      b.restore();
    }
  });

  it("logs and swallows picker errors without injecting", async () => {
    const a = tempConfig(T_A, {
      unique: true,
      description: "a",
      importance: "high",
    });
    const b = tempConfig(T_B, {
      unique: true,
      description: "b",
      importance: "medium",
    });
    try {
      addInsight(T_A, "a-payload");
      addInsight(T_B, "b-payload");

      const { delivery, h } = makeHarness();
      delivery.tryDeliver();
      h.setPickResult(new Error("boom"));
      await flushMicrotasks();

      assert.equal(h.injected.length, 0);
      assert.equal(h.errors.length, 1);
      assert.match(h.errors[0]?.msg ?? "", /picker failed/);
    } finally {
      a.restore();
      b.restore();
    }
  });

  it("one picker at a time — subsequent tryDeliver calls return false while inFlight", async () => {
    const a = tempConfig(T_A, {
      unique: true,
      description: "a",
      importance: "high",
    });
    const b = tempConfig(T_B, {
      unique: true,
      description: "b",
      importance: "medium",
    });
    try {
      const ia = addInsight(T_A, "a-payload");
      addInsight(T_B, "b-payload");
      assert.ok(ia);

      const { delivery, h } = makeHarness();
      delivery.tryDeliver();
      assert.equal(h.pickCalls, 1);
      delivery.tryDeliver();
      delivery.tryDeliver();
      assert.equal(h.pickCalls, 1);

      h.setPickResult(ia);
      await flushMicrotasks();
      assert.equal(h.pickCalls, 1);
    } finally {
      a.restore();
      b.restore();
    }
  });

  it("reset() clears the pending slot", async () => {
    const a = tempConfig(T_A, {
      unique: true,
      description: "a",
      importance: "high",
    });
    const b = tempConfig(T_B, {
      unique: true,
      description: "b",
      importance: "medium",
    });
    try {
      const ia = addInsight(T_A, "a-payload");
      addInsight(T_B, "b-payload");
      assert.ok(ia);

      const { delivery, h } = makeHarness();
      delivery.tryDeliver();
      h.isResponseActive = true;
      h.setPickResult(ia);
      await flushMicrotasks();

      // ia is now stashed in pending (responseActive was true during resolve).
      h.isResponseActive = false;
      delivery.reset();

      // After reset, the pending fast-path is empty. With two unused insights
      // still in the store, tryDeliver should re-enter the picker path rather
      // than immediately inject the stashed pick.
      const before = h.pickCalls;
      assert.equal(delivery.tryDeliver(), false);
      assert.equal(h.pickCalls, before + 1);
      assert.equal(h.injected.length, 0);
      assert.equal(ia.used, false);
    } finally {
      a.restore();
      b.restore();
    }
  });
});
