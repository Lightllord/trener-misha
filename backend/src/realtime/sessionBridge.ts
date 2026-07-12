import type { RealtimeSession } from "@openai/agents/realtime";
import { logTranscript } from "../conversation/log.js";
import { LOG_PREVIEW_MAX } from "../observability/consts/log.js";
import { log, logError } from "../observability/log.js";
import { attachSessionDiagnostics } from "../observability/sessionLog.js";
import { truncate } from "../observability/truncate.js";
import type { ClientChannel } from "./clientChannel.js";

// Forwards RealtimeSession events outward: audio + tool/transcript/error to the
// browser channel, transcripts to the conversation log, and the full turn
// lifecycle to observability. Pure forwarding, no state.
export class SessionEventBridge {
  constructor(
    private readonly session: RealtimeSession,
    private readonly channel: ClientChannel,
  ) {}

  start(): void {
    const { session, channel } = this;

    attachSessionDiagnostics(session);

    session.on("audio", (event) => {
      channel.sendAudio(event.data as ArrayBuffer);
    });

    // Server-side VAD cut the model off mid-generation (user barged in). A hard
    // signal: tell the browser to flush buffered playback unconditionally.
    session.transport.on("audio_interrupted", () => {
      log("turn", "audio interrupted — flushing frontend playback");
      channel.send({ type: "interrupt" });
    });

    // The user started a turn. Forwarded raw: the model may have already
    // finished generating (so no audio_interrupted fires), yet the browser can
    // still be draining seconds of buffered audio — realtime generates faster
    // than it plays. The browser flushes that tail iff it's still playing.
    session.transport.on("input_audio_buffer.speech_started", () => {
      channel.send({ type: "speech_started" });
    });

    // Main-agent tool use — backend-log-only, one short line per tool. Sub-agent
    // tool calls run in their own chat-completion loops and never reach here.
    session.on("agent_tool_start", (_ctx, _agent, toolDef, details) => {
      const toolCall = details.toolCall;
      const args = "arguments" in toolCall ? toolCall.arguments : undefined;
      const argsPreview =
        typeof args === "string" && args ? truncate(args, LOG_PREVIEW_MAX) : "";
      log("tool", `→ ${toolDef.name}(${argsPreview})`);
    });

    session.on("agent_tool_end", (_ctx, _agent, toolDef) => {
      log("tool", `← ${toolDef.name} done`);
    });

    session.on("history_added", (item: Record<string, unknown>) => {
      const type = item.type as string | undefined;
      const role = item.role as string | undefined;
      const status = item.status as string | undefined;
      const content = item.content as Array<Record<string, unknown>> | undefined;

      if (type === "message" && content && (role === "user" || role === "assistant")) {
        const text = content
          .map((c) => (c.transcript as string) || (c.text as string) || "")
          .filter(Boolean)
          .join(" ");
        if (text && (role === "user" || status === "completed")) {
          logTranscript(role, text);
        }
      }
    });

    session.on("error", (err) => {
      logError("session", "error:", err);
    });
  }
}
