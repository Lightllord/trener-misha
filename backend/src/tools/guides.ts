import { tool } from "@openai/agents/realtime";
import { z } from "zod";
import { getAllGuides, findGuide } from "../guides.js";

export const guidesTool = tool({
  name: "guides",
  description:
    "Готовые советы по игре для неопытных игроков, задающих прямые вопросы по механикам Dota 2 (иногда уместно достать совет и просто по релевантной ситуации).",
  parameters: z.object({
    command: z.enum(["list", "get"]).describe(
      "list — весь список советов (id, название, контекстное описание), по описанию выбираешь подходящий под вопрос. " +
        "get — конкретный совет по id из list или приблизительному тексту: возвращает текст озвучки, которому надо следовать в среднем один в один (адаптировать под разговор можно, но не более), и опциональный комментарий для агента — его не озвучивают, а следуют ему как алгоритму.",
    ),
    query: z
      .string()
      .nullable()
      .describe("для get: id совета или текст запроса; для list передай null"),
  }),
  execute: async ({ command, query }) => {
    try {
      if (command === "list") {
        const guides = await getAllGuides();
        return guides
          .map((g) => `${g.id} | ${g.name} — ${g.description}`)
          .join("\n");
      }

      if (!query) {
        return "Для команды get нужен query — id совета или текст. Сначала вызови команду list.";
      }

      const guide = await findGuide(query);
      if (!guide) {
        return `По запросу "${query}" совет не найден. Вызови команду list, чтобы увидеть доступные советы и их id.`;
      }

      let result = `Текст озвучки:\n${guide.voiceText}`;
      if (guide.agentComment) {
        result += `\n\nКомментарий для агента (не озвучивать, использовать как алгоритм):\n${guide.agentComment}`;
      }
      return result;
    } catch (error) {
      console.error("[guides] Error:", error);
      return `Ошибка при работе с гайдами: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
});
