import { tool } from "@openai/agents/realtime";
import { z } from "zod";
import { getState } from "../gameData.js";

export const matchStateTool = tool({
  name: "get_match_state",
  description:
    "Get the current Dota 2 match state from the GSI insight-app. Returns hero stats, items, abilities, buildings, score, game phase and more. Call this when the user asks about the current game, their hero, items, score, or any live match information.",
  parameters: z.object({}),
  execute: async () => {
    const state = getState();
    if (!state) {
      return "Сейчас нет активного матча.";
    }
    return JSON.stringify(state);
  },
});
