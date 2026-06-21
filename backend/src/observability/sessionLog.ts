import type { RealtimeSession } from "@openai/agents/realtime";
import { log } from "./log.js";
import { truncate } from "./truncate.js";
import { LOG_PREVIEW_MAX } from "./consts/log.js";

function rec(x: unknown): Record<string, unknown> | null {
  return typeof x === "object" && x !== null ? (x as Record<string, unknown>) : null;
}

function str(x: unknown): string | undefined {
  return typeof x === "string" ? x : undefined;
}

function num(x: unknown): number | undefined {
  return typeof x === "number" ? x : undefined;
}

// Narrate the full turn lifecycle so a stall is visible by which step is
// missing. The healthy chain is:
//   speech started → speech stopped → audio committed → response started →
//   response done [completed].
// If the user speaks but no `committed`/`response started` follows, the model
// never picked up the turn; if `response done` reports a non-completed status,
// the model stopped for a concrete reason. Pure logging — attaches alongside
// the relay's own transport listeners without touching state.
export function attachSessionDiagnostics(session: RealtimeSession): void {
  const transport = session.transport;

  transport.on("input_audio_buffer.speech_started", () => log("turn", "user started speaking"));
  transport.on("input_audio_buffer.speech_stopped", () => log("turn", "user stopped speaking"));
  transport.on("input_audio_buffer.committed", () =>
    log("turn", "user audio committed → response expected"),
  );
  transport.on("audio_interrupted", () => log("turn", "user interrupted the model"));

  transport.on("response.created", () => log("turn", "model response started"));

  transport.on("response.done", (e: unknown) => {
    const response = rec(rec(e)?.response);
    const status = str(response?.status) ?? "unknown";
    if (status === "completed") {
      log("turn", "model response done [completed]");
      return;
    }
    // Non-completed (incomplete/failed/cancelled) is exactly the stall signal —
    // surface the server's reason.
    const details = rec(response?.status_details);
    const reason = str(details?.reason) ?? str(rec(details?.error)?.message) ?? "";
    log("turn", `model response done [${status}]${reason ? ` — ${truncate(reason, LOG_PREVIEW_MAX)}` : ""}`);
  });

  transport.on("conversation.item.input_audio_transcription.failed", (e: unknown) => {
    const message = str(rec(rec(e)?.error)?.message) ?? "unknown";
    log("turn", `user transcription failed: ${truncate(message, LOG_PREVIEW_MAX)}`);
  });

  transport.on("rate_limits.updated", (e: unknown) => {
    const limits = rec(e)?.rate_limits;
    if (!Array.isArray(limits)) return;
    const parts = limits
      .map((l) => rec(l))
      .filter((l): l is Record<string, unknown> => l !== null)
      .map((l) => `${str(l.name) ?? "?"} ${num(l.remaining) ?? "?"}/${num(l.limit) ?? "?"}`);
    if (parts.length > 0) log("session", `rate limits: ${parts.join(", ")}`);
  });
}
