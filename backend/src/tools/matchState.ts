import { tool } from "@openai/agents/realtime";
import { z } from "zod";

const INSIGHT_APP_URL = "http://localhost:6074";

export const matchStateTool = tool({
  name: "get_match_state",
  description:
    "Get the current Dota 2 match state from the GSI insight-app. Returns hero stats, items, abilities, buildings, score, game phase and more. Call this when the user asks about the current game, their hero, items, score, or any live match information.",
  parameters: z.object({}),
  execute: async () => {
    try {
      const res = await fetch(`${INSIGHT_APP_URL}/state`);
      if (!res.ok) {
        return "Не удалось получить состояние матча. Убедитесь что insight-app запущен.";
      }
      const state: unknown = await res.json();
      if (state === null) {
        return "Сейчас нет активного матча.";
      }
      return JSON.stringify(state);
    } catch {
      return "Insight-app недоступен. Убедитесь что он запущен на порту 6074.";
    }
  },
});
