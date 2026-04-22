import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { addInsight } from "./insights.js";
import { findHero } from "./heroes.js";
import { getDraft, getState } from "./gameData.js";
import {
  queryStratz,
  findStratzHero,
  getHeroesMap,
  getItemsMap,
} from "./stratzApi.js";

let analyzed = false;

interface DraftResponse {
  radiant: string[];
  dire: string[];
  confidence: number[];
  detectedAt: string;
}

interface StateResponse {
  player: { team: string };
  hero: { name: string };
}

const tools: OpenAI.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "get_hero_info",
      description:
        "Get detailed information about a Dota 2 hero: strengths, weaknesses, and core mechanics.",
      parameters: {
        type: "object",
        properties: {
          hero_name: {
            type: "string",
            description: "Hero name in English",
          },
        },
        required: ["hero_name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_matchups",
      description:
        "Get hero win rates vs all other heroes from STRATZ. Shows best and worst matchups with win rates and game counts.",
      parameters: {
        type: "object",
        properties: {
          hero_name: {
            type: "string",
            description: "Hero name in English",
          },
        },
        required: ["hero_name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_builds",
      description:
        "Get popular item builds for a hero from STRATZ — starting items, boots, core items by game phase (early/mid/late).",
      parameters: {
        type: "object",
        properties: {
          hero_name: {
            type: "string",
            description: "Hero name in English",
          },
        },
        required: ["hero_name"],
      },
    },
  },
];

async function handleToolCall(
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  const heroName = args.hero_name as string;

  if (name === "get_hero_info") {
    const hero = await findHero(heroName);
    if (!hero) return `Hero "${heroName}" not found.`;
    return `${hero.displayName} (${hero.shortName}):\n${hero.notes}`;
  }

  if (name === "get_matchups") {
    return fetchMatchups(heroName);
  }

  if (name === "get_builds") {
    return fetchBuilds(heroName);
  }

  return "Unknown tool.";
}

async function fetchMatchups(heroName: string): Promise<string> {
  const hero = await findStratzHero(heroName);
  if (!hero) return `Hero "${heroName}" not found in STRATZ.`;

  const query = `
    query GetHeroVsHeroMatchup($heroId: Short!) {
      heroStats {
        heroVsHeroMatchup(heroId: $heroId) {
          advantage {
            vs { heroId1 heroId2 winCount matchCount }
          }
        }
      }
    }
  `;

  const data = await queryStratz<{
    data: {
      heroStats: {
        heroVsHeroMatchup: {
          advantage: Array<{
            vs: Array<{
              heroId2: number;
              winCount: number;
              matchCount: number;
            }>;
          }>;
        };
      };
    };
    errors?: Array<{ message: string }>;
  }>(query, { heroId: hero.id });

  if (data.errors) return `STRATZ error: ${data.errors[0]?.message}`;

  const vs = data.data?.heroStats?.heroVsHeroMatchup?.advantage?.[0]?.vs;
  if (!vs?.length) return `No matchup data for ${hero.displayName}.`;

  const heroesMap = await getHeroesMap();
  const matchups = vs
    .filter((v) => v.matchCount >= 100)
    .map((v) => ({
      name: heroesMap.get(v.heroId2)?.displayName ?? `Hero ${v.heroId2}`,
      winRate: v.matchCount > 0 ? (v.winCount / v.matchCount) * 100 : 50,
      matchCount: v.matchCount,
    }));

  matchups.sort((a, b) => b.winRate - a.winRate);

  const best = matchups.slice(0, 5);
  const worst = matchups.slice(-5).reverse();

  let result = `Matchups for ${hero.displayName}:\n\nBEST:\n`;
  for (const m of best) result += `  vs ${m.name}: ${m.winRate.toFixed(1)}% (${m.matchCount} games)\n`;
  result += "\nWORST:\n";
  for (const m of worst) result += `  vs ${m.name}: ${m.winRate.toFixed(1)}% (${m.matchCount} games)\n`;

  return result;
}

async function fetchBuilds(heroName: string): Promise<string> {
  const hero = await findStratzHero(heroName);
  if (!hero) return `Hero "${heroName}" not found in STRATZ.`;

  const query = `
    query GetHeroBuilds($heroId: Short!) {
      heroStats {
        itemFullPurchase(heroId: $heroId, matchLimit: 50) {
          itemId time matchCount winCount
        }
        itemStartingPurchase(heroId: $heroId) {
          itemId matchCount winCount
        }
        itemBootPurchase(heroId: $heroId) {
          itemId matchCount winCount
        }
      }
    }
  `;

  const data = await queryStratz<{
    data: {
      heroStats: {
        itemFullPurchase?: Array<{ itemId: number; time: number; matchCount: number; winCount: number }>;
        itemStartingPurchase?: Array<{ itemId: number; matchCount: number; winCount: number }>;
        itemBootPurchase?: Array<{ itemId: number; matchCount: number; winCount: number }>;
      };
    };
    errors?: Array<{ message: string }>;
  }>(query, { heroId: hero.id });

  if (data.errors) return `STRATZ error: ${data.errors[0]?.message}`;

  const stats = data.data?.heroStats;
  if (!stats) return `No build data for ${hero.displayName}.`;

  const itemsMap = await getItemsMap();
  const iname = (id: number) => itemsMap.get(id)?.displayName ?? `Item ${id}`;

  const agg = (items: Array<{ itemId: number; matchCount: number; winCount: number }>) => {
    const map = new Map<number, { mc: number; wc: number }>();
    for (const i of items) {
      if (!i.matchCount) continue;
      const e = map.get(i.itemId);
      if (e) { e.mc += i.matchCount; e.wc += i.winCount; }
      else map.set(i.itemId, { mc: i.matchCount, wc: i.winCount });
    }
    return Array.from(map.entries())
      .map(([id, d]) => ({ id, mc: d.mc, wr: (d.wc / d.mc) * 100 }))
      .sort((a, b) => b.mc - a.mc);
  };

  let result = `Builds for ${hero.displayName}:\n`;

  if (stats.itemStartingPurchase?.length) {
    result += "\nSTARTING: " + agg(stats.itemStartingPurchase).slice(0, 5).map((i) => `${iname(i.id)} (${i.wr.toFixed(0)}%)`).join(", ");
  }
  if (stats.itemBootPurchase?.length) {
    result += "\nBOOTS: " + agg(stats.itemBootPurchase).slice(0, 3).map((i) => `${iname(i.id)} (${i.wr.toFixed(0)}%)`).join(", ");
  }
  if (stats.itemFullPurchase?.length) {
    const valid = stats.itemFullPurchase.filter((i) => i.matchCount > 0);
    const early = agg(valid.filter((i) => i.time > 0 && i.time < 15)).slice(0, 5);
    const mid = agg(valid.filter((i) => i.time >= 15 && i.time < 30)).slice(0, 5);
    const late = agg(valid.filter((i) => i.time >= 30)).slice(0, 5);

    if (early.length) result += "\nEARLY (0-15m): " + early.map((i) => `${iname(i.id)} (${i.wr.toFixed(0)}%)`).join(", ");
    if (mid.length) result += "\nMID (15-30m): " + mid.map((i) => `${iname(i.id)} (${i.wr.toFixed(0)}%)`).join(", ");
    if (late.length) result += "\nLATE (30m+): " + late.map((i) => `${iname(i.id)} (${i.wr.toFixed(0)}%)`).join(", ");
  }

  return result;
}

/**
 * Lazy check: called on every turn_done.
 * If draft is complete (10 heroes) and not yet analyzed — kicks off background analysis.
 */
export function checkAndAnalyzeDraft(): void {
  if (analyzed) return;

  const draft = getDraft();
  if (!draft?.radiant?.length || !draft?.dire?.length) return;
  if (draft.radiant.length + draft.dire.length < 10) return;

  const state = getState() as StateResponse | null;

  analyzed = true;
  console.log("[draftAnalysis] Draft complete, starting background analysis");

  analyzeInBackground(draft, state).catch((err) => {
    console.error("[draftAnalysis] Background analysis failed:", err);
  });
}

async function analyzeInBackground(
  draft: DraftResponse,
  state: StateResponse | null,
): Promise<void> {
  const playerContext = state
    ? `Игрок на стороне ${state.player.team}, герой: ${state.hero.name}.`
    : "";

  const messages: ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: `Ты — аналитик-тренер по Dota 2. Тебе доступны инструменты:
- get_hero_info — детальная информация о герое (сильные/слабые стороны, механики)
- get_matchups — винрейт героя против всех оппонентов из STRATZ (реальная статистика)
- get_builds — популярные сборки предметов героя по фазам игры из STRATZ

Используй get_hero_info для понимания механик героев, get_matchups для анализа конкретных матчапов в драфте, и get_builds для рекомендации предметов герою игрока.`,
    },
    {
      role: "user",
      content: `Драфт завершён.
Radiant: ${draft.radiant.join(", ")}
Dire: ${draft.dire.join(", ")}
${playerContext}

Изучи ключевых героев драфта через get_hero_info, проверь матчапы героя игрока через get_matchups, и посмотри рекомендуемый билд через get_builds. Дай краткий анализ (5-7 предложений): ключевые матчапы в драфте, на что обращать внимание, и что покупать.`,
    },
  ];

  const openai = new OpenAI();

  // Tool-use loop: let the model call get_hero_info as needed
  for (;;) {
    const res = await openai.chat.completions.create({
      model: "gpt-5.4-mini",
      messages,
      tools,
    });

    const choice = res.choices[0];
    if (!choice) break;

    const msg = choice.message;
    messages.push(msg);

    if (msg.tool_calls?.length) {
      for (const call of msg.tool_calls) {
        if (call.type !== "function") continue;
        const args = JSON.parse(call.function.arguments) as Record<
          string,
          unknown
        >;
        console.log(`[draftAnalysis] tool call: ${call.function.name}(${call.function.arguments})`);
        const result = await handleToolCall(call.function.name, args);
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: result,
        });
      }
      continue;
    }

    // No more tool calls — final answer
    if (msg.content) {
      console.log("[draftAnalysis] Analysis ready, queued for delivery");
      addInsight(
        "draft_analysis",
        `[Фоновый анализ драфта завершён]\n${msg.content}\n\nПредложи игроку: "У меня готов анализ драфта, рассказать?" Не рассказывай содержание сразу — дождись подтверждения.`,
      );
    }
    break;
  }
}

export function resetDraftAnalysis(): void {
  analyzed = false;
}
