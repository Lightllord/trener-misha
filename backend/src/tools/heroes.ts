import { tool } from "@openai/agents/realtime";
import { z } from "zod";
import { getAllHeroes, findHero } from "../heroes.js";

export const heroesTool = tool({
  name: "heroes",
  description: "Справочник по героям Dota 2.",
  parameters: z.object({
    command: z.enum(["list", "info"]).describe(
      "list — полный список всех героев в формате, пригодном для команды info (используй, чтобы уточнить точное имя героя). " +
        "info — детальная информация по одному герою: сильные и слабые стороны, ключевые механики.",
    ),
    hero_name: z
      .string()
      .nullable()
      .describe("для info: имя героя (искать на английском); для list передай null"),
  }),
  execute: async ({ command, hero_name }) => {
    try {
      if (command === "list") {
        const heroes = await getAllHeroes();
        return heroes.map((h) => `${h.displayName} (${h.shortName})`).join("\n");
      }

      if (!hero_name) {
        return "Для команды info нужно hero_name. Вызови команду list, чтобы получить точные имена.";
      }

      const hero = await findHero(hero_name);
      if (!hero) {
        return `Героя "${hero_name}" нет в базе. Возможно, имя указано неточно — вызови команду list, чтобы получить точные названия.`;
      }

      return `${hero.displayName} (${hero.shortName}):\n\n${hero.notes}`;
    } catch (error) {
      console.error("[heroes] Error:", error);
      return `Ошибка при работе со справочником героев: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
});
