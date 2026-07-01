import { tool } from "@openai/agents/realtime";
import { z } from "zod";
import { correctDraftSlot } from "../gameData.js";

export const correctDraftTool = tool({
  name: "correct_draft",
  description:
    "Исправить неверно распознанного героя в конкретном слоте драфта. Используй heroes с командой list, чтобы уточнить точное короткое имя героя перед вызовом. Исправленный слот не будет перезаписан screen capture.",
  parameters: z.object({
    team: z.enum(["radiant", "dire"]).describe("Команда"),
    slot: z.number().int().min(1).max(5).describe("Номер позиции 1–5"),
    hero: z.string().describe("Точное короткое имя героя, например phantom_assassin"),
  }),
  execute: async ({ team, slot, hero }) => {
    correctDraftSlot(team, slot - 1, hero);
    return `Исправлено: ${team} слот ${slot} → ${hero}`;
  },
});
