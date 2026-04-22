import { tool } from "@openai/agents/realtime";
import { z } from "zod";
import {
  queryStratz,
  findStratzHero,
  getHeroesMap,
} from "../stratzApi.js";

interface VsEntry {
  heroId1: number;
  heroId2: number;
  winCount: number;
  matchCount: number;
}

interface MatchupResponse {
  data: {
    heroStats: {
      heroVsHeroMatchup: {
        advantage: Array<{ vs: VsEntry[] }>;
        disadvantage: Array<{ vs: VsEntry[] }>;
      };
    };
  };
  errors?: Array<{ message: string }>;
}

export const matchupsTool = tool({
  name: "get_matchups",
  description:
    "Get hero matchup win rates from STRATZ API — shows which heroes the given hero is strong or weak against. Use when user asks about counters, matchups, or who to pick/ban.",
  parameters: z.object({
    hero_name: z
      .string()
      .describe("Hero name or ID to look up matchups for (English)"),
  }),
  execute: async ({ hero_name }) => {
    try {
      const hero = await findStratzHero(hero_name);
      if (!hero) {
        return `Не нашли героя "${hero_name}". Попробуйте другое название.`;
      }

      const query = `
        query GetHeroVsHeroMatchup($heroId: Short!) {
          heroStats {
            heroVsHeroMatchup(heroId: $heroId) {
              advantage {
                vs {
                  heroId1
                  heroId2
                  winCount
                  matchCount
                }
              }
              disadvantage {
                vs {
                  heroId1
                  heroId2
                  winCount
                  matchCount
                }
              }
            }
          }
        }
      `;

      const data = await queryStratz<MatchupResponse>(query, {
        heroId: hero.id,
      });

      if (data.errors) {
        return `Ошибка STRATZ API: ${data.errors[0]?.message ?? "unknown"}`;
      }

      const advantageVs =
        data.data?.heroStats?.heroVsHeroMatchup?.advantage?.[0]?.vs;
      if (!advantageVs || advantageVs.length === 0) {
        return `Нет данных о матчапах для ${hero.displayName}.`;
      }

      const heroesMap = await getHeroesMap();

      const matchups = advantageVs
        .filter((v) => v.matchCount >= 100)
        .map((v) => ({
          heroId: v.heroId2,
          name:
            heroesMap.get(v.heroId2)?.displayName ?? `Hero ${v.heroId2}`,
          winRate:
            v.matchCount > 0 ? (v.winCount / v.matchCount) * 100 : 50,
          matchCount: v.matchCount,
        }));

      matchups.sort((a, b) => b.winRate - a.winRate);

      const best = matchups.slice(0, 5);
      const worst = matchups.slice(-5).reverse();

      let result = `Matchups for ${hero.displayName} (STRATZ data, 100+ games filter):\n\n`;

      result += "BEST matchups (highest win rate):\n";
      for (const m of best) {
        result += `  vs ${m.name}: ${m.winRate.toFixed(1)}% (${m.matchCount} games)\n`;
      }

      result += "\nWORST matchups (lowest win rate):\n";
      for (const m of worst) {
        result += `  vs ${m.name}: ${m.winRate.toFixed(1)}% (${m.matchCount} games)\n`;
      }

      const totalGames = matchups.reduce(
        (sum, m) => sum + m.matchCount,
        0,
      );
      const avgWr =
        matchups.reduce(
          (sum, m) => sum + m.winRate * m.matchCount,
          0,
        ) / totalGames;
      result += `\nOverall average win rate: ${avgWr.toFixed(1)}% across ${matchups.length} heroes`;

      return result;
    } catch (error) {
      console.error("[get_matchups] Error:", error);
      return `Ошибка при запросе матчапов: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
});
