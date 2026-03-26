import { tool } from "@openai/agents/realtime";
import { z } from "zod";

const INSIGHT_APP_URL = "http://localhost:6074";

export const draftTool = tool({
  name: "get_draft",
  description:
    "Get the current draft composition (both teams' hero picks) detected via screen capture. Returns radiant and dire hero lists with confidence scores. Call this when the user asks about the draft, team compositions, hero matchups, or wants pre-game analysis.",
  parameters: z.object({}),
  execute: async () => {
    try {
      const res = await fetch(`${INSIGHT_APP_URL}/draft`);
      if (!res.ok) {
        return "Не удалось получить данные драфта. Убедитесь что insight-app запущен.";
      }
      const draft: unknown = await res.json();
      if (draft === null) {
        return "Драфт ещё не определён. Нажми хоткей (`) на экране с табличкой результатов чтобы захватить составы.";
      }
      return JSON.stringify(draft);
    } catch {
      return "Insight-app недоступен. Убедитесь что он запущен на порту 6074.";
    }
  },
});
