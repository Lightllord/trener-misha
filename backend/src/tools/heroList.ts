import { tool } from "@openai/agents/realtime";
import { z } from "zod";
import { getAllHeroes } from "../heroes.js";

export const heroListTool = tool({
  name: "list_heroes",
  description:
    "List all available Dota 2 heroes. Returns hero names in the format accepted by get_hero_info. Call when the user asks what heroes are available or wants to browse the hero list.",
  parameters: z.object({}),
  execute: async () => {
    try {
      const heroes = await getAllHeroes();
      const list = heroes.map((h) => `${h.displayName} (${h.shortName})`);
      return list.join("\n");
    } catch (error) {
      console.error("[list_heroes] Error:", error);
      return "Не удалось загрузить список героев.";
    }
  },
});
