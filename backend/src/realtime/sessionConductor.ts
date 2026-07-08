import type { RealtimeSession } from "@openai/agents/realtime";
import { DeliveryWindow } from "../deliveryWindow/deliveryWindow.js";
import { LOG_PREVIEW_MAX } from "../observability/consts/log.js";
import { log } from "../observability/log.js";
import { truncate } from "../observability/truncate.js";
import { TRUNCATION_CONFIG } from "./consts/session.js";

// Owns the DeliveryWindow and the low-level actions over the session transport.
// Encapsulates the ordering invariant: cancel a live response before flipping
// the band, and flip the band synchronously before response.create so a
// parallel poll/event tick can't double-inject.
export class SessionConductor {
  readonly window: DeliveryWindow;

  constructor(private readonly session: RealtimeSession) {
    this.window = new DeliveryWindow(session);
    this.configureTruncation();
  }

  // Raw session.update: the SDK's typed SessionOptions doesn't expose
  // `truncation` yet, and this only patches that one key — model, tools,
  // and audio config sent at connect are left untouched.
  private configureTruncation(): void {
    this.session.transport.sendEvent({
      type: "session.update",
      session: { truncation: TRUNCATION_CONFIG },
    });
  }

  injectMessage(text: string, triggerResponse: boolean): void {
    if (triggerResponse && this.window.isResponseActive()) {
      log("inject", "preempting active response (response.cancel)");
      this.session.transport.sendEvent({ type: "response.cancel" });
    }
    if (triggerResponse) this.window.setResponseActive(true);
    log(
      "inject",
      `→ history (${triggerResponse ? "respond now" : "context only"}): ${truncate(text, LOG_PREVIEW_MAX)}`,
    );
    this.session.transport.sendEvent({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "system",
        content: [{ type: "input_text", text }],
      },
    });
    if (triggerResponse) {
      this.session.transport.sendEvent({ type: "response.create" });
    }
  }

  // Force the turn to end when the mic was cut mid-speech (no trailing silence
  // for VAD to detect). Mirrors injectMessage's band-flip-before-create order.
  forceCommitAndRespond(): void {
    this.session.transport.sendEvent({ type: "input_audio_buffer.commit" });
    this.window.setResponseActive(true);
    this.session.transport.sendEvent({ type: "response.create" });
  }

  dispose(): void {
    this.window.dispose();
  }
}
