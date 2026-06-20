// Control frames the backend sends to the browser (everything that isn't raw
// binary audio).
export type ControlMessage =
  | { type: "connected" }
  | { type: "transcript"; role: string; text: string }
  | { type: "tool_call"; name: string }
  | { type: "tool_result"; name: string; result: string }
  | { type: "interrupt" }
  | { type: "error"; message: string };

// Control frames the browser sends to the backend (audio is raw binary, handled
// separately).
export type ClientInboundMessage = { type: "mic_close" };
