import { tool } from "@openai/agents/realtime";
import { z } from "zod";
import { planItemBuild } from "../buildPlan.js";

export const buildPlanTool = tool({
  name: "plan_item_build",
  description:
    "Запусти фоновый разбор полного билда предметов на игру под позицию игрока (1-5). Анализ идёт по механикам вражеских героев и своего героя, учитывает стоимость предметов и сверяется со статистикой билдов, и возвращает порядок покупки. Вызывай ТОЛЬКО когда уже знаешь позицию игрока (1 кэрри, 2 мид, 3 офлейн, 4 саппорт, 5 хард-саппорт) — если не знаешь, сначала спроси. Результат придёт позже отдельным insight — не жди его, просто скажи игроку, что думаешь над билдом.",
  parameters: z.object({
    position: z
      .number()
      .int()
      .min(1)
      .max(5)
      .describe("Позиция игрока: 1 кэрри, 2 мид, 3 офлейн, 4 саппорт, 5 хард-саппорт"),
  }),
  execute: async ({ position }) => {
    planItemBuild(position);
    // Voice agent must answer with a 2-3 word filler only — the real build
    // arrives later as a build_plan insight.
    return "Скажи игроку ОЧЕНЬ коротко, в 2-3 слова, что продумываешь билд. Не описывай что будешь делать и не давай совет сейчас.";
  },
});
