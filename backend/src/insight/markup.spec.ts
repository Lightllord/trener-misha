import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { summarizeForPicker } from "./helpers.js";
import {
  buildPickerUserMessage,
  formatInsightForInjection,
  formatInsightsAsPickerXMLike,
} from "./markup.js";
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
    interrupts: false,
    createdAt: Date.now(),
    ...overrides,
  };
}

describe("insight/markup — formatInsightsAsPickerXMLike", () => {
  it("produces an empty container when no insights", () => {
    assert.equal(
      formatInsightsAsPickerXMLike([]),
      "<unused-insights></unused-insights>",
    );
  });

  it("wraps each entry with nested metadata tags (no attributes)", () => {
    const summary = summarizeForPicker(
      [makeInsight({ description: "hello", createdAt: 0 })],
      3_000,
    );
    const out = formatInsightsAsPickerXMLike(summary);
    assert.match(out, /^<unused-insights>/);
    assert.match(out, /<\/unused-insights>$/);
    assert.match(out, /<insight-0>/);
    assert.match(out, /<name>draft_analysis<\/name>/);
    assert.match(out, /<number>null<\/number>/);
    assert.match(out, /<importance>medium<\/importance>/);
    assert.match(out, /<age-seconds>3<\/age-seconds>/);
    assert.match(out, /<description>hello<\/description>/);
    assert.match(out, /<\/insight-0>/);
    assert.doesNotMatch(out, /<insight-0 [^>]/);
  });

  it("escapes tag-special characters in description and name", () => {
    const summary = summarizeForPicker(
      [makeInsight({ description: "a < b & c > d", createdAt: 0 })],
      0,
    );
    const out = formatInsightsAsPickerXMLike(summary);
    assert.match(out, /a &lt; b &amp; c &gt; d/);
  });
});

describe("insight/markup — buildPickerUserMessage", () => {
  it("joins blocks with a blank line separator", () => {
    const msg = buildPickerUserMessage(
      "<unused-insights></unused-insights>",
      "<message-history></message-history>",
    );
    assert.equal(
      msg,
      "<unused-insights></unused-insights>\n\n<message-history></message-history>",
    );
  });
});

describe("insight/markup — formatInsightForInjection", () => {
  it("emits sequence-tagged nested metadata, payload, and note (no attributes)", () => {
    const insight = makeInsight({
      name: "draft_analysis",
      importance: "high",
      description: "draft info",
      payload: "hello",
    });
    const out = formatInsightForInjection(insight, 3);
    assert.match(out, /^<insight-3>/);
    assert.match(out, /<name>draft_analysis<\/name>/);
    assert.match(out, /<importance>high<\/importance>/);
    assert.match(out, /<description>draft info<\/description>/);
    assert.match(out, /<payload>\nhello\n<\/payload>/);
    assert.match(out, /<note>/);
    assert.match(out, /<\/insight-3>$/);
    assert.doesNotMatch(out, /<insight-3 [^>]/);
  });

  it("uses the passed sequence number in both opening and closing tags", () => {
    const out = formatInsightForInjection(makeInsight({}), 7);
    assert.match(out, /^<insight-7>/);
    assert.match(out, /<\/insight-7>$/);
  });
});
