import { tool } from "@openai/agents/realtime";
import { z } from "zod";
import { requestNeutralItems } from "../neutralItems.js";

export const neutralItemsTool = tool({
  name: "request_neutral_items",
  description:
    "Запусти фоновый сбор данных о нейтральных предметах и чарах (enchantments) по тирам для героя — свежие пик-рейт/винрейт с dota2protracker.com среди топ-игроков. Точнее по тирам и чарам, чем get_builds (STRATZ). Результат придёт позже отдельным insight — не жди его, просто скажи игроку, что смотришь нейтралки.",
  parameters: z.object({
    hero_name: z.string().describe("Имя героя (искать на английском)"),
  }),
  execute: async ({ hero_name }) => {
    requestNeutralItems(hero_name);
    return "Скажи игроку ОЧЕНЬ коротко, в 2-3 слова, что смотришь нейтралки. Не описывай что будешь делать и не давай совет сейчас.";
  },
});
