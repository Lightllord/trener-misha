import { tool } from "@openai/agents/realtime";
import { z } from "zod";
import { setPlayerPosition } from "../gameData.js";

export const setPlayerPositionTool = tool({
  name: "set_player_position",
  description:
    "Записать позицию игрока в этой игре (1-5) в gameState. Вызывай сразу после того, как игрок назвал свою позицию — например, в ответ на инсайт ask_player_position или когда игрок сам сообщил позицию.",
  parameters: z.object({
    position: z
      .number()
      .int()
      .min(1)
      .max(5)
      .describe("Позиция игрока: 1 кэрри, 2 мид, 3 офлейн, 4 саппорт, 5 хард-саппорт"),
  }),
  execute: async ({ position }) => {
    setPlayerPosition(position);
    return `Записано: позиция игрока — ${position}.`;
  },
});
