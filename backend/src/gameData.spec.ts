import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { setState, getState, setOtherHeroes, clearGameData } from "./gameData.js";

function draftPush(radiant: string[], dire: string[]): Record<string, unknown> {
  return {
    matchId: "1",
    draft: { radiant, dire, confidence: radiant.map(() => 1).concat(dire.map(() => 1)), detectedAt: "now" },
  };
}

describe("gameData — setOtherHeroes draft filter", () => {
  beforeEach(() => {
    clearGameData();
  });

  it("keeps a hero that is in the draft", () => {
    setState(draftPush(["spectre"], ["invoker"]));
    setOtherHeroes([{ name: "invoker" }], 42);
    const state = getState();
    assert.deepEqual(state?.otherHeroes, [{ name: "invoker" }]);
    assert.equal(state?.lastEnemyInspectAt, 42);
  });

  it("drops a hero that is not in the draft (misdetection)", () => {
    setState(draftPush(["spectre"], ["invoker"]));
    setOtherHeroes([{ name: "invoker" }, { name: "juggernaut" }], 42);
    assert.deepEqual(getState()?.otherHeroes, [{ name: "invoker" }]);
  });

  it("passes everything through when the draft hasn't been detected yet", () => {
    setState({ matchId: "1" });
    setOtherHeroes([{ name: "juggernaut" }], 10);
    assert.deepEqual(getState()?.otherHeroes, [{ name: "juggernaut" }]);
  });

  it("re-applies the overlay on the next full state push, even though that push carries no otherHeroes", () => {
    setState(draftPush(["spectre"], ["invoker"]));
    setOtherHeroes([{ name: "invoker" }], 42);
    setState(draftPush(["spectre"], ["invoker"])); // simulates insight-app's next GSI-triggered push
    assert.deepEqual(getState()?.otherHeroes, [{ name: "invoker" }]);
    assert.equal(getState()?.lastEnemyInspectAt, 42);
  });
});
