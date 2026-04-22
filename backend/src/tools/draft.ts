import { tool } from "@openai/agents/realtime";
import { z } from "zod";
import { getDraft } from "../gameData.js";

export const draftTool = tool({
  name: "get_draft",
  description:
    "Get the current draft composition (both teams' hero picks) detected via screen capture. Returns radiant and dire hero lists with confidence scores. Call this when the user asks about the draft, team compositions, hero matchups, or wants pre-game analysis.",
  parameters: z.object({}),
  execute: async () => {
    const draft = getDraft();
    if (!draft) {
      return "Драфт ещё не определён. Данные появятся когда insight-app обнаружит составы.";
    }
    return JSON.stringify(draft);
  },
});
