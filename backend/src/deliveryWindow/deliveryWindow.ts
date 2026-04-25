import type { RealtimeSession } from "@openai/agents/realtime";

export type DeliveryWindowListener = (isOpen: boolean) => void;

// Tracks the "we can safely speak" window over a RealtimeSession's transport.
// Combines two flags:
//   - isResponseActive: model is generating a response
//   - isUserSpeaking:   server-side VAD has user audio
// Both auto-update from transport events. Setters are also public so callers
// (e.g. injectMessage) can preemptively close the window before the SDK
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
    const onTransportEvent = (raw: unknown) => {
      if (typeof raw !== "object" || raw === null) return;
      const type = (raw as { type?: unknown }).type;
      if (type === "input_audio_buffer.speech_started") {
        this.setUserSpeaking(true);
      } else if (type === "input_audio_buffer.speech_stopped") {
        this.setUserSpeaking(false);
      }
    };

    transport.on("turn_started", onTurnStarted);
    transport.on("turn_done", onTurnDone);
    transport.on("audio_interrupted", onAudioInterrupted);
    transport.on("transport_event", onTransportEvent);

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
        () => offFn("transport_event", onTransportEvent as never),
      );
    }
  }

  isOpen(): boolean {
    return !this.isResponseActiveFlag && !this.isUserSpeakingFlag;
  }

  isResponseActive(): boolean {
    return this.isResponseActiveFlag;
  }

  setResponseActive(value: boolean): void {
    if (this.isResponseActiveFlag === value) return;
    const wasOpen = this.isOpen();
    this.isResponseActiveFlag = value;
    this.notifyIfChanged(wasOpen);
  }

  setUserSpeaking(value: boolean): void {
    if (this.isUserSpeakingFlag === value) return;
    const wasOpen = this.isOpen();
    this.isUserSpeakingFlag = value;
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
