import { tool } from "@openai/agents/realtime";
import { z } from "zod";
import { getAghanimInfo } from "../itemKnowledge.js";

export const aghanimInfoTool = tool({
  name: "get_aghanim_info",
  description:
    "Что именно дают Aghanim's Scepter и Aghanim's Shard конкретному герою — эффект целиком зависит от героя и не описан ни в общей базе предметов, ни в общем обзоре героя. Вызывай, когда пользователь спрашивает про аганим/шард на герое.",
  parameters: z.object({
    hero_name: z
      .string()
      .describe("The name of the hero to search for (search in English)"),
  }),
  execute: async ({ hero_name }) => {
    const info = await getAghanimInfo(hero_name);
    if (!info) {
      return `Данные об Aghanim's для героя "${hero_name}" не найдены. Возможно, имя указано неточно — вызови list_heroes, чтобы получить точные названия.`;
    }

    const lines = [`${info.heroName}:`];
    lines.push(
      info.hasScepter
        ? `  Aghanim's Scepter${info.scepterNewSkill ? ` (новая способность: ${info.scepterSkillName})` : ` (${info.scepterSkillName})`}: ${info.scepterDesc}`
        : "  Aghanim's Scepter: эффекта на этого героя нет.",
    );
    lines.push(
      info.hasShard
        ? `  Aghanim's Shard${info.shardNewSkill ? ` (новая способность: ${info.shardSkillName})` : ` (${info.shardSkillName})`}: ${info.shardDesc}`
        : "  Aghanim's Shard: эффекта на этого героя нет.",
    );
    return lines.join("\n");
  },
});
