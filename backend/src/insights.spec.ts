import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  addInsight,
  clearInsights,
  getAllInsights,
  getByName,
  getByNameAndNumber,
  getLatest,
  getLatestUnused,
  getLatestUnusedByName,
  getUnused,
  markUsed,
} from "./insights.js";
import { INSIGHT_CONFIGS } from "./consts/insights.js";
import type { InsightConfig, InsightName } from "./types/insight.js";

const NON_UNIQUE = "test_non_unique" as InsightName;
const SECOND_NON_UNIQUE = "test_non_unique_b" as InsightName;

const configsWritable = INSIGHT_CONFIGS as Record<string, InsightConfig>;

function withFixtureConfigs(
  entries: ReadonlyArray<[string, InsightConfig]>,
  run: () => void,
): void {
  const prior = new Map<string, InsightConfig | undefined>(
    entries.map(([name]) => [name, configsWritable[name]]),
  );
  for (const [name, config] of entries) configsWritable[name] = config;
  try {
    run();
  } finally {
    for (const [name, prev] of prior) {
      if (prev === undefined) delete configsWritable[name];
      else configsWritable[name] = prev;
    }
  }
}

describe("insights", () => {
  beforeEach(() => {
    clearInsights();
  });

  it("addInsight rejects duplicate of a unique name", () => {
    const first = addInsight("draft_analysis", "first");
    assert.ok(first);
    const second = addInsight("draft_analysis", "second");
    assert.equal(second, null);
    assert.equal(getAllInsights().length, 1);
    assert.equal(getAllInsights()[0]?.payload, "first");
  });

  it("addInsight throws on unknown name", () => {
    assert.throws(() => addInsight("nope" as InsightName, "x"), /Unknown insight/);
  });

  it("a unique insight has unique=true and number=null", () => {
    const insight = addInsight("draft_analysis", "payload");
    assert.ok(insight);
    assert.equal(insight.unique, true);
    assert.equal(insight.number, null);
    assert.equal(insight.used, false);
    assert.equal(insight.name, "draft_analysis");
    assert.equal(insight.payload, "payload");
    assert.equal(typeof insight.createdAt, "number");
  });

  it("per-name counter increments and is independent across names", () => {
    withFixtureConfigs(
      [
        [NON_UNIQUE, { unique: false }],
        [SECOND_NON_UNIQUE, { unique: false }],
      ],
      () => {
        const a1 = addInsight(NON_UNIQUE, "a1");
        const a2 = addInsight(NON_UNIQUE, "a2");
        const b1 = addInsight(SECOND_NON_UNIQUE, "b1");
        const a3 = addInsight(NON_UNIQUE, "a3");

        assert.equal(a1?.number, 1);
        assert.equal(a2?.number, 2);
        assert.equal(a3?.number, 3);
        assert.equal(b1?.number, 1);
        assert.equal(a1?.unique, false);
      },
    );
  });

  it("clearInsights resets per-name counters", () => {
    withFixtureConfigs([[NON_UNIQUE, { unique: false }]], () => {
      addInsight(NON_UNIQUE, "first");
      addInsight(NON_UNIQUE, "second");
      clearInsights();
      const fresh = addInsight(NON_UNIQUE, "after-reset");
      assert.equal(fresh?.number, 1);
    });
  });

  it("getLatest returns most recently added, including used; null when empty", () => {
    assert.equal(getLatest(), null);

    withFixtureConfigs([[NON_UNIQUE, { unique: false }]], () => {
      const first = addInsight(NON_UNIQUE, "1");
      const second = addInsight(NON_UNIQUE, "2");
      assert.equal(getLatest(), second);
      assert.ok(first);
      markUsed(first);
      assert.equal(getLatest(), second);

      assert.ok(second);
      markUsed(second);
      assert.equal(getLatest(), second);
    });
  });

  it("getLatestUnused skips used entries; null when all used", () => {
    assert.equal(getLatestUnused(), null);

    withFixtureConfigs([[NON_UNIQUE, { unique: false }]], () => {
      const a = addInsight(NON_UNIQUE, "a");
      const b = addInsight(NON_UNIQUE, "b");
      const c = addInsight(NON_UNIQUE, "c");
      assert.ok(a && b && c);

      assert.equal(getLatestUnused(), c);
      markUsed(c);
      assert.equal(getLatestUnused(), b);
      markUsed(b);
      markUsed(a);
      assert.equal(getLatestUnused(), null);
    });
  });

  it("getAllInsights / getUnused return entries in insertion order", () => {
    withFixtureConfigs([[NON_UNIQUE, { unique: false }]], () => {
      const a = addInsight(NON_UNIQUE, "a");
      const b = addInsight(NON_UNIQUE, "b");
      const c = addInsight(NON_UNIQUE, "c");
      assert.ok(a && b && c);

      assert.deepEqual(
        getAllInsights().map((i) => i.payload),
        ["a", "b", "c"],
      );

      markUsed(b);
      assert.deepEqual(
        getUnused().map((i) => i.payload),
        ["a", "c"],
      );
      assert.equal(getAllInsights().length, 3);
    });
  });

  it("getLatestUnusedByName picks freshest unused matching the name", () => {
    assert.equal(getLatestUnusedByName("draft_analysis"), null);

    withFixtureConfigs([[NON_UNIQUE, { unique: false }]], () => {
      addInsight(NON_UNIQUE, "n1");
      const draft = addInsight("draft_analysis", "d");
      const n2 = addInsight(NON_UNIQUE, "n2");
      const n3 = addInsight(NON_UNIQUE, "n3");
      assert.ok(draft && n2 && n3);

      // Freshest unused for the name, ignoring entries with other names
      assert.equal(getLatestUnusedByName(NON_UNIQUE), n3);
      assert.equal(getLatestUnusedByName("draft_analysis"), draft);

      markUsed(n3);
      assert.equal(getLatestUnusedByName(NON_UNIQUE), n2);

      markUsed(draft);
      assert.equal(getLatestUnusedByName("draft_analysis"), null);
    });
  });

  it("getByName filters; getByNameAndNumber handles null (unique) and ints", () => {
    withFixtureConfigs([[NON_UNIQUE, { unique: false }]], () => {
      const draft = addInsight("draft_analysis", "d");
      addInsight(NON_UNIQUE, "n1");
      addInsight(NON_UNIQUE, "n2");

      assert.equal(getByName("draft_analysis").length, 1);
      assert.equal(getByName(NON_UNIQUE).length, 2);

      assert.equal(getByNameAndNumber("draft_analysis", null), draft);
      assert.equal(getByNameAndNumber("draft_analysis", 1), null);
      assert.equal(getByNameAndNumber(NON_UNIQUE, 2)?.payload, "n2");
      assert.equal(getByNameAndNumber(NON_UNIQUE, 99), null);
    });
  });

  it("markUsed flips used and removes from getUnused", () => {
    const insight = addInsight("draft_analysis", "x");
    assert.ok(insight);
    assert.equal(insight.used, false);
    assert.equal(getUnused().length, 1);

    markUsed(insight);
    assert.equal(insight.used, true);
    assert.equal(getUnused().length, 0);
    assert.equal(getAllInsights().length, 1);
  });

  it("clearInsights empties everything", () => {
    addInsight("draft_analysis", "x");
    assert.equal(getAllInsights().length, 1);
    clearInsights();
    assert.equal(getAllInsights().length, 0);
    assert.equal(getLatest(), null);
    assert.equal(getLatestUnused(), null);
  });
});
