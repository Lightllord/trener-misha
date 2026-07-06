// Control frames the backend sends to the browser (everything that isn't raw
// binary audio). The browser only needs to know when to flush buffered playback
// after a barge-in; everything else (transcripts, tool use, errors) is
// backend-log-only. Audio itself is raw binary, not a control frame.
export type ControlMessage = { type: "interrupt" };

// Control frames the browser sends to the backend (audio is raw binary, handled
// separately).
export type ClientInboundMessage = { type: "mic_close" };
