import { RealtimeSession } from "@openai/agents/realtime";

type SessionOptions = NonNullable<ConstructorParameters<typeof RealtimeSession>[1]>;

// Declarative OpenAI Realtime session config. Server VAD (semantic) drives the
// normal turn-taking; near-field noise reduction trims room/game noise.
export const SESSION_OPTIONS: SessionOptions = {
  transport: "websocket",
  model: "gpt-realtime-2",
  config: {
    audio: {
      input: {
        turnDetection: {
          type: "semantic_vad",
          eagerness: "medium",
        },
        noiseReduction: { type: "near_field" },
      },
      output: {
        speed: 1.15,
      },
    },
  },
};

// Matches survive 30-60+ minute matches, so the conversation is left to grow
// unbounded by default (OpenAI only auto-truncates once the model's full
// context window is hit). Cap it far below that so old insights/turns —
// which lose relevance quickly in live coaching — get dropped long before
// per-turn cost balloons. Not expressible via SDK's typed SessionOptions
// (@openai/agents-realtime doesn't know this field yet), so it's sent as a
// raw session.update in SessionConductor instead.
export const TRUNCATION_CONFIG = {
  type: "retention_ratio",
  retention_ratio: 0.7,
  token_limits: { post_instructions: 8000 },
} as const;
