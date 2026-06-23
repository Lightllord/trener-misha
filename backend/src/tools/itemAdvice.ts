import { tool } from "@openai/agents/realtime";
import { z } from "zod";
import { requestItemAdvice } from "../itemAdvice.js";

export const itemAdviceTool = tool({
  name: "request_item_advice",
  description:
    "Запусти фоновый разбор: какой предмет купить в текущей ситуации (например «что купить» или «что взять против Слардара»). Анализ идёт по механикам героев и предметов и сверяется со статистикой билдов. Вызывай, когда игрок спрашивает что покупать / что взять против кого-то. Результат придёт позже отдельным insight — не жди его, просто скажи игроку, что думаешь над этим.",
  parameters: z.object({
    question: z
      .string()
      .describe("Вопрос игрока про предметы, дословно или близко к тексту"),
  }),
  execute: async ({ question }) => {
    requestItemAdvice(question);
    // Voice agent must answer with a 2-3 word filler only — the real advice
    // arrives later as an item_advice insight.
    return "Скажи игроку ОЧЕНЬ коротко, в 2-3 слова, что думаешь над этим. Не описывай что будешь делать и не давай совет сейчас.";
  },
});
