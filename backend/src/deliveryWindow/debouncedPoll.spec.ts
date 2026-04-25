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

    mock.timers.tick(299);
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

    mock.timers.tick(300);
    assert.equal(calls, 1);
    mock.timers.tick(3_000);
    assert.equal(calls, 2);
    mock.timers.tick(3_000);
    assert.equal(calls, 3);
  });

  it("cancels both timers when window closes", () => {
    const window = makeWindow();
    let calls = 0;
    new DebouncedPoll(window, () => {
      calls += 1;
    });

    mock.timers.tick(300);
    assert.equal(calls, 1);

    window.setResponseActive(true);

    mock.timers.tick(10_000);
    assert.equal(calls, 1);
  });

  it("re-arms the debounce after the window reopens", () => {
    const window = makeWindow();
    window.setResponseActive(true);

    let calls = 0;
    new DebouncedPoll(window, () => {
      calls += 1;
    });

    mock.timers.tick(1_000);
    assert.equal(calls, 0);

    window.setResponseActive(false);

    mock.timers.tick(299);
    assert.equal(calls, 0);
    mock.timers.tick(1);
    assert.equal(calls, 1);
  });

  it("absorbs the speech_stopped → turn_started race via debounce", () => {
    const window = makeWindow();
    window.setUserSpeaking(true);

    let calls = 0;
    new DebouncedPoll(window, () => {
      calls += 1;
    });

    window.setUserSpeaking(false);
    mock.timers.tick(50);
    window.setResponseActive(true);

    mock.timers.tick(10_000);
    assert.equal(calls, 0);
  });

  it("window.dispose() cancels the poll's timers", () => {
    const window = makeWindow();
    let calls = 0;
    new DebouncedPoll(window, () => {
      calls += 1;
    });

    mock.timers.tick(300);
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

    mock.timers.tick(300);
    assert.equal(calls, 1);
    mock.timers.tick(3_000);
    assert.equal(calls, 2);
  });
});
