import { describe, it, mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { RealtimeSession } from "@openai/agents/realtime";
import { DeliveryWindow } from "./deliveryWindow.js";
import { DebouncedPoll } from "./debouncedPoll.js";

class FakeTransport {
  on(_event: string, _cb: (...a: unknown[]) => void): void {}
  off(_event: string, _cb: (...a: unknown[]) => void): void {}
}

function makeWindow(): DeliveryWindow {
  const transport = new FakeTransport();
  return new DeliveryWindow({ transport } as unknown as RealtimeSession);
}

describe("DebouncedPoll", () => {
  beforeEach(() => {
    mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  });

  afterEach(() => {
    mock.timers.reset();
  });

  it("fires after the debounce when the window is initially open", () => {
    const window = makeWindow();
    let calls = 0;
    new DebouncedPoll(window, () => {
      calls += 1;
    });

    mock.timers.tick(149);
    assert.equal(calls, 0);
    mock.timers.tick(1);
    assert.equal(calls, 1);
  });

  it("polls every pollMs while window stays open", () => {
    const window = makeWindow();
    let calls = 0;
    new DebouncedPoll(window, () => {
      calls += 1;
    });

    mock.timers.tick(150);
    assert.equal(calls, 1);
    mock.timers.tick(200);
    assert.equal(calls, 2);
    mock.timers.tick(200);
    assert.equal(calls, 3);
  });

  it("keeps polling while the model speaks — only user speech disarms it", () => {
    const window = makeWindow();
    let calls = 0;
    new DebouncedPoll(window, () => {
      calls += 1;
    });

    mock.timers.tick(150);
    assert.equal(calls, 1);

    // Model starts talking — the window stays open, the poll keeps firing.
    window.setResponseActive(true);
    mock.timers.tick(200);
    assert.equal(calls, 2);
  });

  it("cancels both timers when the user starts speaking", () => {
    const window = makeWindow();
    let calls = 0;
    new DebouncedPoll(window, () => {
      calls += 1;
    });

    mock.timers.tick(150);
    assert.equal(calls, 1);

    window.setUserSpeaking(true);

    mock.timers.tick(10_000);
    assert.equal(calls, 1);
  });

  it("re-arms the debounce after the user stops speaking", () => {
    const window = makeWindow();
    window.setUserSpeaking(true);

    let calls = 0;
    new DebouncedPoll(window, () => {
      calls += 1;
    });

    mock.timers.tick(1_000);
    assert.equal(calls, 0);

    window.setUserSpeaking(false);

    mock.timers.tick(149);
    assert.equal(calls, 0);
    mock.timers.tick(1);
    assert.equal(calls, 1);
  });

  it("a quick re-speak within the debounce cancels the pending fire", () => {
    const window = makeWindow();
    window.setUserSpeaking(true);

    let calls = 0;
    new DebouncedPoll(window, () => {
      calls += 1;
    });

    window.setUserSpeaking(false); // arms the debounce
    mock.timers.tick(50);
    window.setUserSpeaking(true); // user speaks again before it elapses

    mock.timers.tick(10_000);
    assert.equal(calls, 0);
  });

  it("window.dispose() cancels the poll's timers", () => {
    const window = makeWindow();
    let calls = 0;
    new DebouncedPoll(window, () => {
      calls += 1;
    });

    mock.timers.tick(150);
    assert.equal(calls, 1);

    window.dispose();

    mock.timers.tick(100_000);
    assert.equal(calls, 1);
  });

  it("custom options are respected", () => {
    const window = makeWindow();
    let calls = 0;
    new DebouncedPoll(
      window,
      () => {
        calls += 1;
      },
      { debounceMs: 100, pollMs: 500 },
    );

    mock.timers.tick(100);
    assert.equal(calls, 1);
    mock.timers.tick(500);
    assert.equal(calls, 2);
  });

  it("callback throwing does not break the poll loop", () => {
    const window = makeWindow();
    let calls = 0;
    new DebouncedPoll(window, () => {
      calls += 1;
      if (calls === 1) throw new Error("boom");
    });

    mock.timers.tick(150);
    assert.equal(calls, 1);
    mock.timers.tick(200);
    assert.equal(calls, 2);
  });
});
