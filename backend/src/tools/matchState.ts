import { tool } from "@openai/agents/realtime";
import { z } from "zod";
import { getState } from "../gameData.js";

export const matchStateTool = tool({
  name: "get_match_state",
  description:
    "Get the current Dota 2 match state from the GSI insight-app. Returns hero stats, items, abilities, buildings, score, game phase, the draft (both teams' hero picks detected via screen capture), the player's position (1-5, field playerPosition — null until set via set_player_position) and more. Call this when the user asks about the current game, their hero, items, score, the draft, team compositions, or any live match information.",
  parameters: z.object({}),
  execute: async () => {
    const state = getState();
    if (!state) {
      return "Сейчас нет активного матча.";
    }
    return JSON.stringify(state);
  },
});
