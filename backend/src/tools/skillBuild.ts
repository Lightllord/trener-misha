import { tool } from "@openai/agents/realtime";
import { z } from "zod";
import { findStratzHero } from "../stratzApi.js";
import { fetchSkillBuildSummary } from "../stratzSkillBuild.js";

export const skillBuildTool = tool({
  name: "get_skill_build",
  description:
    "Get typical ability level-up priority and per-talent win rates for a hero from STRATZ API. Use when the user asks what order to skill abilities, or which talent to pick.",
  parameters: z.object({
    hero_name: z
      .string()
      .describe("Hero name or ID to look up the skill build for (English)"),
  }),
  execute: async ({ hero_name }) => {
    const hero = await findStratzHero(hero_name);
    if (!hero) {
      return `Не нашли героя "${hero_name}". Попробуйте другое название.`;
    }
    return fetchSkillBuildSummary(hero_name);
  },
});
