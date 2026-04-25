import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatConversationAsXMLike } from "./markup.js";

describe("conversation/markup — formatConversationAsXMLike", () => {
  it("wraps entries with <message-history> and <message>", () => {
    const out = formatConversationAsXMLike([
      { role: "user", text: "hi", at: 0 },
      { role: "assistant", text: "привет", at: 1 },
    ]);
    assert.match(out, /^<message-history>/);
    assert.match(out, /<\/message-history>$/);
    assert.match(out, /<message><from>Player<\/from><text>hi<\/text><\/message>/);
    assert.match(out, /<message><from>Coach<\/from><text>привет<\/text><\/message>/);
  });

  it("returns an empty container on empty input", () => {
    assert.equal(
      formatConversationAsXMLike([]),
      "<message-history></message-history>",
    );
  });

  it("escapes tag-special characters in text", () => {
    const out = formatConversationAsXMLike([
      { role: "user", text: "a < b & c > d", at: 0 },
    ]);
    assert.match(out, /a &lt; b &amp; c &gt; d/);
  });
});
