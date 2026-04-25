import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  clearConversation,
  getAllConversation,
  getRecentConversation,
  logTranscript,
} from "./log.js";
import { MAX_LOG_ENTRIES } from "./consts/log.js";

describe("conversation/log", () => {
  beforeEach(() => {
    clearConversation();
  });

  it("logTranscript stores entries with role/text/at", () => {
    logTranscript("user", "hi", 1_000);
    logTranscript("assistant", "hello", 2_000);
    const all = getAllConversation();
    assert.equal(all.length, 2);
    assert.deepEqual(all[0], { role: "user", text: "hi", at: 1_000 });
    assert.deepEqual(all[1], { role: "assistant", text: "hello", at: 2_000 });
  });

  it("logTranscript skips empty / whitespace-only text", () => {
    logTranscript("user", "", 1_000);
    logTranscript("user", "   ", 2_000);
    logTranscript("user", "\n\t", 3_000);
    assert.equal(getAllConversation().length, 0);
  });

  it("logTranscript trims surrounding whitespace", () => {
    logTranscript("user", "  padded  ", 1_000);
    assert.equal(getAllConversation()[0]?.text, "padded");
  });

  it("getRecentConversation returns only entries within the window", () => {
    logTranscript("user", "ancient", 0);
    logTranscript("user", "recent", 90_000);
    logTranscript("assistant", "just-now", 100_000);

    const window = getRecentConversation(60_000, 120_000);
    assert.deepEqual(
      window.map((e) => e.text),
      ["recent", "just-now"],
    );
  });

  it("log is capped at MAX_LOG_ENTRIES", () => {
    for (let i = 0; i < MAX_LOG_ENTRIES + 50; i++) {
      logTranscript("user", `msg-${i}`, i);
    }
    const all = getAllConversation();
    assert.equal(all.length, MAX_LOG_ENTRIES);
    assert.equal(all[0]?.text, `msg-50`);
    assert.equal(all[MAX_LOG_ENTRIES - 1]?.text, `msg-${MAX_LOG_ENTRIES + 49}`);
  });

  it("clearConversation empties the log", () => {
    logTranscript("user", "x", 1);
    clearConversation();
    assert.equal(getAllConversation().length, 0);
  });
});
