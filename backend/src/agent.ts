import { RealtimeAgent, tool } from "@openai/agents/realtime";
import { z } from "zod";

const jokeTool = tool({
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

const analysisTool = tool({
  name: "run_analysis",
  description:
    "Run a slow analysis on a given topic (takes a few seconds). Call when the user asks to analyze something.",
  parameters: z.object({ topic: z.string() }),
  execute: async ({ topic }) => {
    await new Promise((r) => setTimeout(r, 3000));
    return `Анализ "${topic}" завершён. Всё отлично, не переживай.`;
  },
});

export const agent = new RealtimeAgent({
  name: "Тренер Миша",
  instructions: `You are a Russian-speaking voice assistant called Тренер Миша.
Keep replies brief and conversational. Use tools when the user asks for a joke or analysis.`,
  tools: [jokeTool, analysisTool],
});
