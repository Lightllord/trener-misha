import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { RealtimeSession } from "@openai/agents/realtime";
import { DeliveryWindow } from "./deliveryWindow.js";

type Listener = (...args: unknown[]) => void;

class FakeTransport {
  private listeners = new Map<string, Listener[]>();

  on(event: string, cb: Listener): void {
    const arr = this.listeners.get(event) ?? [];
    arr.push(cb);
    this.listeners.set(event, arr);
  }

  off(event: string, cb: Listener): void {
    const arr = this.listeners.get(event);
    if (!arr) return;
    const i = arr.indexOf(cb);
    if (i !== -1) arr.splice(i, 1);
  }

  emit(event: string, payload?: unknown): void {
    const arr = this.listeners.get(event) ?? [];
    for (const cb of [...arr]) cb(payload);
  }

  listenerCount(event: string): number {
    return this.listeners.get(event)?.length ?? 0;
  }
}

function makeWindow(): {
  window: DeliveryWindow;
  transport: FakeTransport;
} {
  const transport = new FakeTransport();
  const session = { transport } as unknown as RealtimeSession;
  return { window: new DeliveryWindow(session), transport };
}

describe("DeliveryWindow", () => {
  let window: DeliveryWindow;
  let transport: FakeTransport;

  beforeEach(() => {
    ({ window, transport } = makeWindow());
  });

  it("starts open", () => {
    assert.equal(window.isOpen(), true);
    assert.equal(window.isResponseActive(), false);
  });

  it("turn_started closes; turn_done reopens", () => {
    transport.emit("turn_started");
    assert.equal(window.isOpen(), false);
    assert.equal(window.isResponseActive(), true);
    transport.emit("turn_done");
    assert.equal(window.isOpen(), true);
    assert.equal(window.isResponseActive(), false);
  });

  it("speech_started closes; speech_stopped reopens", () => {
    transport.emit("transport_event", {
      type: "input_audio_buffer.speech_started",
    });
    assert.equal(window.isOpen(), false);
    transport.emit("transport_event", {
      type: "input_audio_buffer.speech_stopped",
    });
    assert.equal(window.isOpen(), true);
  });

  it("audio_interrupted closes (user speaking) and clears responseActive", () => {
    transport.emit("turn_started");
    transport.emit("audio_interrupted");
    assert.equal(window.isResponseActive(), false);
    assert.equal(window.isOpen(), false); // user is now speaking
  });

  it("ignores unrelated transport_event types", () => {
    transport.emit("transport_event", { type: "session.updated" });
    transport.emit("transport_event", null);
    transport.emit("transport_event", "garbage");
    assert.equal(window.isOpen(), true);
  });

  it("public setters mirror the auto handlers", () => {
    window.setResponseActive(true);
    assert.equal(window.isOpen(), false);
    window.setResponseActive(false);
    assert.equal(window.isOpen(), true);

    window.setUserSpeaking(true);
    assert.equal(window.isOpen(), false);
    window.setUserSpeaking(false);
    assert.equal(window.isOpen(), true);
  });

  it("subscribers fire only on open/close transitions", () => {
    const events: boolean[] = [];
    window.subscribe((isOpen) => events.push(isOpen));

    // Setting same value: no fire.
    window.setResponseActive(false);
    assert.deepEqual(events, []);

    transport.emit("turn_started");
    assert.deepEqual(events, [false]);

    // Adding userSpeaking while already closed: still closed, no fire.
    window.setUserSpeaking(true);
    assert.deepEqual(events, [false]);

    // Removing responseActive but userSpeaking still true: still closed.
    transport.emit("turn_done");
    assert.deepEqual(events, [false]);

    window.setUserSpeaking(false);
    assert.deepEqual(events, [false, true]);
  });

  it("subscribe returns an unsubscribe function", () => {
    const events: boolean[] = [];
    const unsubscribe = window.subscribe((isOpen) => events.push(isOpen));

    transport.emit("turn_started");
    unsubscribe();
    transport.emit("turn_done");

    assert.deepEqual(events, [false]);
  });

  it("dispose detaches transport listeners and clears subscribers", () => {
    const events: boolean[] = [];
    window.subscribe((isOpen) => events.push(isOpen));

    assert.ok(transport.listenerCount("turn_started") > 0);

    window.dispose();

    assert.equal(transport.listenerCount("turn_started"), 0);
    assert.equal(transport.listenerCount("turn_done"), 0);
    assert.equal(transport.listenerCount("audio_interrupted"), 0);
    assert.equal(transport.listenerCount("transport_event"), 0);

    transport.emit("turn_started");
    // Window was open at dispose time → subscriber got one final false; no
    // events afterwards.
    assert.deepEqual(events, [false]);
  });

  it("dispose force-closes the window and broadcasts isOpen=false", () => {
    const events: boolean[] = [];
    window.subscribe((isOpen) => events.push(isOpen));
    assert.equal(window.isOpen(), true);

    window.dispose();

    assert.deepEqual(events, [false]);
    assert.equal(window.isOpen(), false);
  });

  it("dispose on an already-closed window still broadcasts the final close", () => {
    transport.emit("turn_started");
    const events: boolean[] = [];
    window.subscribe((isOpen) => events.push(isOpen));

    window.dispose();

    assert.deepEqual(events, [false]);
    assert.equal(window.isOpen(), false);
  });

  it("subscriber that throws does not break notification chain", () => {
    const seen: boolean[] = [];
    window.subscribe(() => {
      throw new Error("boom");
    });
    window.subscribe((isOpen) => seen.push(isOpen));

    transport.emit("turn_started");
    assert.deepEqual(seen, [false]);
  });
});
