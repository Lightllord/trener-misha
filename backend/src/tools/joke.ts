import { tool } from "@openai/agents/realtime";
import { z } from "zod";

export const jokeTool = tool({
  name: "get_joke",
  description: "Returns a random joke. Call when the user asks for a joke.",
  parameters: z.object({}),
  execute: async () => {
    const jokes = [
      "Почему программист носит очки? Потому что не может C#.",
      "— Алё, это прачечная? — Нет, это Node.js сервер.",
      "В чём разница между Junior и Senior? Junior гуглит ошибку, Senior гуглит решение.",
      "Программист поставил себе на кухню два стула: один для if, другой для else.",
      "— У тебя баг в проде! — Это не баг, это фича для самых внимательных.",
      "Заходит NULL в бар. Бар падает.",
    ];
    return jokes[Math.floor(Math.random() * jokes.length)];
  },
});
