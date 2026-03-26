import { tool } from "@openai/agents/realtime";
import { z } from "zod";
import { findHero } from "../heroes.js";

export const heroInfoTool = tool({
  name: "get_hero_info",
  description:
    "Get detailed information about a Dota 2 hero including their strengths, weaknesses, and core mechanics. Call when the user asks for information about any Dota 2 hero.",
  parameters: z.object({
    hero_name: z
      .string()
      .describe("The name of the hero to search for (search in English)"),
  }),
  execute: async ({ hero_name }) => {
    try {
      const hero = await findHero(hero_name);
      if (!hero) {
        return `Не нашли героя с названием "${hero_name}". Попробуйте другое название.`;
      }

      const formattedInfo = `${hero.displayName} (${hero.shortName}):

${hero.notes}`;

      return formattedInfo;
    } catch (error) {
      console.error("[get_hero_info] Error:", error);
      return "Произошла ошибка при поиске героя. Попробуйте позже.";
    }
  },
});
