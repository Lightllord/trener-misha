// Control frames the backend sends to the browser (everything that isn't raw
// binary audio); everything else (transcripts, tool use, errors) is
// backend-log-only. Audio itself is raw binary, not a control frame.
//   - "interrupt"      — the model's current output is void (VAD barge-in, or we
//                        preempted it for a critical insight). Flush playback
//                        unconditionally: a hard signal the backend is sure of.
//   - "speech_started" — raw fact that the user began a turn. The backend may not
//                        know if anything is still playing, so it forwards this
//                        as-is and lets the browser decide: flush only if the bot
//                        is still draining a buffer (the model is now listening).
//                        Covers audio already sent before the response completed.
export type ControlMessage =
  | { type: "interrupt" }
  | { type: "speech_started" };

// Control frames the browser sends to the backend (audio is raw binary, handled
// separately).
export type ClientInboundMessage = { type: "mic_close" };
