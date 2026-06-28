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
