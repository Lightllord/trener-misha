import { RealtimeSession } from "@openai/agents/realtime";
import { agent } from "../agent.js";
import { SESSION_OPTIONS } from "./consts/session.js";

export function createRealtimeSession(): RealtimeSession {
  return new RealtimeSession(agent, SESSION_OPTIONS);
}
