import { tool } from "@openai/agents/realtime";
import { z } from "zod";
import { getBuildPlan } from "../gameData.js";
import { formatBuildPlan } from "../buildMarkup.js";

export const getBuildPlanTool = tool({
  name: "get_build_plan",
  description:
    "Показать текущий сохранённый билд на игру (порядок покупки предметов). Вызывай, когда игрок спрашивает «какой у нас билд / что собираем», и обязательно перед тем, как менять билд через edit_build_plan.",
  parameters: z.object({}),
  execute: async () => {
    const plan = getBuildPlan();
    if (!plan) {
      return "Билд ещё не составлен. Чтобы составить — уточни позицию игрока и вызови plan_item_build.";
    }
    return formatBuildPlan(plan);
  },
});
