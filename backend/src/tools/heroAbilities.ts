import { tool } from "@openai/agents/realtime";
import { z } from "zod";
import { getHeroAbilityDetail } from "../itemKnowledge.js";
import { formatHeroAbilityDetail } from "../heroAbilityMarkup.js";

export const heroAbilitiesTool = tool({
  name: "get_hero_abilities",
  description:
    "Detailed ability numbers for a Dota 2 hero: cooldowns, mana cost, damage, talents. Call when the user asks about a hero's specific abilities or numbers, not just a general overview (use get_hero_info for that).",
  parameters: z.object({
    hero_name: z
      .string()
      .describe("The name of the hero to search for (search in English)"),
  }),
  execute: async ({ hero_name }) => {
    const detail = await getHeroAbilityDetail(hero_name);
    if (!detail) {
      return `Способности героя "${hero_name}" не найдены. Возможно, имя указано неточно — вызови list_heroes, чтобы получить точные названия.`;
    }
    return formatHeroAbilityDetail(detail);
  },
});
