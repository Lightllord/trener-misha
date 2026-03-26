import { tool } from "@openai/agents/realtime";
import { z } from "zod";

export const analysisTool = tool({
  name: "run_analysis",
  description:
    "Run a slow analysis on a given topic (takes a few seconds). Call when the user asks to analyze something.",
  parameters: z.object({ topic: z.string() }),
  execute: async ({ topic }) => {
    await new Promise((r) => setTimeout(r, 3000));
    return `Анализ "${topic}" завершён. Всё отлично, не переживай.`;
  },
});
