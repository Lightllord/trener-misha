import { RealtimeAgent, tool } from "@openai/agents/realtime";
import { z } from "zod";
import { findHero } from "./heroes.js";

const INSIGHT_APP_URL = "http://localhost:6074";

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

const heroInfoTool = tool({
  name: "get_hero_info",
  description: "Get detailed information about a Dota 2 hero including their strengths, weaknesses, and core mechanics. Call when the user asks for information about any Dota 2 hero.",
  parameters: z.object({
    hero_name: z.string().describe("The name of the hero to search for (search in English)"),
  }),
  execute: async ({ hero_name }) => {
    try {
      const hero = await findHero(hero_name);
      if (!hero) {
        return `Не нашли героя с названием "${hero_name}". Попробуйте другое название.`;
      }

      // Format the notes for better readability in voice output
      const formattedInfo = `${hero.displayName} (${hero.shortName}):

${hero.notes}`;

      return formattedInfo;
    } catch (error) {
      console.error("[get_hero_info] Error:", error);
      return "Произошла ошибка при поиске героя. Попробуйте позже.";
    }
  },
});

const draftTool = tool({
  name: "get_draft",
  description:
    "Get the current draft composition (both teams' hero picks) detected via screen capture. Returns radiant and dire hero lists with confidence scores. Call this when the user asks about the draft, team compositions, hero matchups, or wants pre-game analysis.",
  parameters: z.object({}),
  execute: async () => {
    try {
      const res = await fetch(`${INSIGHT_APP_URL}/draft`);
      if (!res.ok) {
        return "Не удалось получить данные драфта. Убедитесь что insight-app запущен.";
      }
      const draft: unknown = await res.json();
      if (draft === null) {
        return "Драфт ещё не определён. Нажми хоткей (`) на экране с табличкой результатов чтобы захватить составы.";
      }
      return JSON.stringify(draft);
    } catch {
      return "Insight-app недоступен. Убедитесь что он запущен на порту 6074.";
    }
  },
});

const matchStateTool = tool({
  name: "get_match_state",
  description: "Get the current Dota 2 match state from the GSI insight-app. Returns hero stats, items, abilities, buildings, score, game phase and more. Call this when the user asks about the current game, their hero, items, score, or any live match information.",
  parameters: z.object({}),
  execute: async () => {
    try {
      const res = await fetch(`${INSIGHT_APP_URL}/state`);
      if (!res.ok) {
        return "Не удалось получить состояние матча. Убедитесь что insight-app запущен.";
      }
      const state: unknown = await res.json();
      if (state === null) {
        return "Сейчас нет активного матча.";
      }
      return JSON.stringify(state);
    } catch {
      return "Insight-app недоступен. Убедитесь что он запущен на порту 6074.";
    }
  },
});

export const agent = new RealtimeAgent({
  name: "Тренер Миша",
  instructions: `You are a Russian-speaking voice assistant called Тренер Миша, a Dota 2 coach.
Keep replies brief and conversational.

You have access to live game data:
- get_match_state: current game state (phase, hero, items, score, buildings)
- get_draft: team compositions detected from screen capture (radiant & dire hero picks)
- get_hero_info: detailed hero strengths, weaknesses, and mechanics

When the user asks about the draft, matchup, team compositions, or wants pre-game advice — call get_draft first to see both teams' picks.
When the user asks about the current game situation — call get_match_state.
Combine draft + hero info to give matchup analysis and actionable coaching advice.`,
  tools: [jokeTool, analysisTool, heroInfoTool, matchStateTool, draftTool],
});
