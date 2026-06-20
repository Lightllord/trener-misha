import type { RealtimeSession } from "@openai/agents/realtime";
import { log } from "../observability/log.js";
import type { DeliveryBand, DeliveryState } from "./types/state.js";

export type DeliveryWindowListener = (isOpen: boolean) => void;

// Tracks when the backend may act on the audio channel, over a
// RealtimeSession's transport. The window is open whenever the user is NOT
// speaking (isOpen()). Within the open window there are two bands
// (deliveryBand()):
//   - "full"      — model is also silent → deliver any insight into the pause.
//   - "interrupt" — model is mid-response → only critical insights, delivered
//                   by cancelling and restarting the current output.
// Two flags drive this, both auto-updated from transport events:
//   - isUserSpeaking:   server-side VAD has user audio → closes the window.
//   - isResponseActive: model is generating a response → selects the band.
// Setters are public so callers (e.g. injectMessage, or the mic-gate close
// handler when VAD can't see a mid-speech cut) can preempt the SDK before it
// catches up.
export class DeliveryWindow {
  private isResponseActiveFlag = false;
  private isUserSpeakingFlag = false;
  private listeners: DeliveryWindowListener[] = [];
  private detachers: Array<() => void> = [];

  constructor(session: RealtimeSession) {
    const transport = session.transport;

    const onTurnStarted = () => this.setResponseActive(true);
    const onTurnDone = () => this.setResponseActive(false);
    const onAudioInterrupted = () => {
      this.setUserSpeaking(true);
      this.setResponseActive(false);
    };
    // Server-side VAD speech classifier — the source of truth for whether the
    // user holds the floor. These are typed transport events, emitted under
    // their own name (not under a "transport_event" alias).
    const onSpeechStarted = () => this.setUserSpeaking(true);
    const onSpeechStopped = () => this.setUserSpeaking(false);

    transport.on("turn_started", onTurnStarted);
    transport.on("turn_done", onTurnDone);
    transport.on("audio_interrupted", onAudioInterrupted);
    transport.on("input_audio_buffer.speech_started", onSpeechStarted);
    transport.on("input_audio_buffer.speech_stopped", onSpeechStopped);

    const off = (transport as { off?: unknown }).off;
    if (typeof off === "function") {
      const offFn = off.bind(transport) as (
        event: string,
        cb: (...a: unknown[]) => void,
      ) => void;
      this.detachers.push(
        () => offFn("turn_started", onTurnStarted as never),
        () => offFn("turn_done", onTurnDone as never),
        () => offFn("audio_interrupted", onAudioInterrupted as never),
        () => offFn("input_audio_buffer.speech_started", onSpeechStarted as never),
        () => offFn("input_audio_buffer.speech_stopped", onSpeechStopped as never),
      );
    }
  }

  isOpen(): boolean {
    return !this.isUserSpeakingFlag;
  }

  // Concrete combined state — one call for the delivery site to switch on,
  // layered over isOpen() + deliveryBand().
  state(): DeliveryState {
    if (!this.isOpen()) return "closed";
    return this.deliveryBand();
  }

  // The band within an open window (the poll is disarmed when closed).
  deliveryBand(): DeliveryBand {
    return this.isResponseActiveFlag ? "interrupt" : "full";
  }

  isResponseActive(): boolean {
    return this.isResponseActiveFlag;
  }

  setResponseActive(value: boolean): void {
    if (this.isResponseActiveFlag === value) return;
    const prev = this.state();
    const wasOpen = this.isOpen();
    this.isResponseActiveFlag = value;
    this.logTransition(prev);
    this.notifyIfChanged(wasOpen);
  }

  setUserSpeaking(value: boolean): void {
    if (this.isUserSpeakingFlag === value) return;
    const prev = this.state();
    const wasOpen = this.isOpen();
    this.isUserSpeakingFlag = value;
    this.logTransition(prev);
    this.notifyIfChanged(wasOpen);
  }

  subscribe(listener: DeliveryWindowListener): () => void {
    this.listeners.push(listener);
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i !== -1) this.listeners.splice(i, 1);
    };
  }

  // Mark closed permanently, broadcast one final isOpen=false to subscribers
  // (so anything they own — timers, queues — can tear down via the normal
  // close path), then drop subscribers.
  dispose(): void {
    for (const detach of this.detachers) {
      try {
        detach();
      } catch {
        // best-effort cleanup
      }
    }
    this.detachers = [];

    this.isUserSpeakingFlag = true;
    this.isResponseActiveFlag = false;

    for (const listener of [...this.listeners]) {
      try {
        listener(false);
      } catch (err) {
        console.error("[deliveryWindow] subscriber failed:", err);
      }
    }
    this.listeners = [];
  }

  private logTransition(prev: DeliveryState): void {
    const next = this.state();
    if (next !== prev) log("inject", `delivery window: ${prev} → ${next}`);
  }

  private notifyIfChanged(wasOpen: boolean): void {
    const open = this.isOpen();
    if (open === wasOpen) return;
    for (const listener of [...this.listeners]) {
      try {
        listener(open);
      } catch (err) {
        console.error("[deliveryWindow] subscriber failed:", err);
      }
    }
  }
}
