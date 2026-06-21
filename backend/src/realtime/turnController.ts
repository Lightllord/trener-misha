import type { RealtimeSession } from "@openai/agents/realtime";
import { log } from "../observability/log.js";
import type { SessionConductor } from "./sessionConductor.js";

// Hybrid turn detection. Server VAD handles the normal case (speak → pause → it
// commits and responds). But cutting the mic mid-speech sends no trailing
// silence, so VAD never fires and the turn (and delivery window) would stick. On
// gate close we force the turn to end — but only if VAD saw real speech it never
// committed, so a bare key tap can't commit silence and trigger a reply.
export class TurnController {
  private userSpeechPending = false;
  private readonly detachers: Array<() => void> = [];

  constructor(
    session: RealtimeSession,
    private readonly conductor: SessionConductor,
  ) {
    const transport = session.transport;
    const onSpeechStarted = () => {
      this.userSpeechPending = true;
    };
    const onCommitted = () => {
      this.userSpeechPending = false;
    };
    transport.on("input_audio_buffer.speech_started", onSpeechStarted);
    transport.on("input_audio_buffer.committed", onCommitted);

    const off = (transport as { off?: unknown }).off;
    if (typeof off === "function") {
      const offFn = off.bind(transport) as (
        event: string,
        cb: (...a: unknown[]) => void,
      ) => void;
      this.detachers.push(
        () => offFn("input_audio_buffer.speech_started", onSpeechStarted as never),
        () => offFn("input_audio_buffer.committed", onCommitted as never),
      );
    }
  }

  // Called when the browser signals the mic gate closed.
  endUserTurn(): void {
    // VAD won't emit speech_stopped for a mid-speech cut, so reopen the window
    // ourselves; harmless no-op when VAD already stopped the speech.
    this.conductor.window.setUserSpeaking(false);
    // No uncommitted speech — VAD already committed, or the gate was tapped
    // without speaking. Forcing now would be empty or duplicate VAD's commit.
    if (!this.userSpeechPending) return;
    this.userSpeechPending = false;
    log("turn", "mic closed mid-speech — forcing commit + response.create");
    this.conductor.forceCommitAndRespond();
  }

  dispose(): void {
    for (const detach of this.detachers) {
      try {
        detach();
      } catch {
        // best-effort cleanup
      }
    }
    this.detachers.length = 0;
  }
}
