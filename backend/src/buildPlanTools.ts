/**
 * Tool-calling surface for the plan_item_build background subagent
 * (buildPlan.ts): the @openai/agents tool list (tool()+zod, own execute)
 * and the pure helpers that format tag data ahead of the run.
 */

import { tool } from "@openai/agents";
import { z } from "zod";
import {
  getHeroTags,
  getItemTags,
  getCandidateItems,
  findItemsByTags,
  getItemDetail,
  getHeroAbilityDetail,
  getAghanimInfo,
} from "./itemKnowledge.js";
import { fetchBuildsSummary, fetchItemPurchaseRates } from "./stratzBuilds.js";
import { BUILD_PHASES } from "./consts/build.js";
import type { TaggedEntity } from "./types/knowledge.js";
import type { BuildPlan } from "./types/build.js";

export function formatTags(name: string, entity: TaggedEntity): string {
  const lines = [`${name.toUpperCase()}:`];
  for (const ability of entity.abilities) {
    for (const s of ability.scenarios) {
      const side = s.sideEffects
        .map((e) => `${e.target}: ${e.tags.join(", ")}`)
        .join("; ");
      const sideText = side ? ` (side→ ${side})` : "";
      lines.push(`  ${ability.name} [${s.target}]: ${s.tags.join(", ")}${sideText}`);
    }
  }
  return lines.join("\n");
}

/** Pre-fetch tags for a list of heroes so enemy/ally/own mechanics are always
 * read before the LLM starts picking items, instead of relying on it to
 * proactively call get_hero_tags. */
export async function fetchHeroTagsBlock(heroes: string[]): Promise<string> {
  const known = heroes.filter((h) => h && h !== "unknown");
  if (!known.length) return "Герои неизвестны.";

  const parts = await Promise.all(
    known.map(async (hero) => {
      const found = await getHeroTags(hero);
      return found ? formatTags(found.key, found.entity) : `${hero.toUpperCase()}: тегов в базе нет.`;
    }),
  );
  return parts.join("\n\n");
}

export interface BuildPlanTools {
  tools: ReturnType<typeof tool>[];
  submitted: { plan: BuildPlan | null };
}

/** Builds the tool list for one plan_item_build run. submit_build closes over
 * position/heroName (only known once the game state is read) and records the
 * proposed plan on `submitted` for the caller to pick up after the run. */
export function createBuildPlanTools(position: number, heroName: string | null): BuildPlanTools {
  const submitted: { plan: BuildPlan | null } = { plan: null };

  const tools = [
    tool({
      name: "get_item_tags",
      description:
        "Mechanic tags for an item's active/passive abilities (primary source). Use to check what counter-mechanic an item provides.",
      parameters: z.object({
        item_name: z.string().describe("Item name (English or internal)"),
      }),
      execute: async ({ item_name }) => {
        const found = await getItemTags(item_name);
        return found ? formatTags(found.key, found.entity) : `No tags for "${item_name}".`;
      },
    }),
    tool({
      name: "list_candidate_items",
      description:
        "List of relevant items worth recommending (internal names). Use to pick which items to inspect with get_item_tags.",
      parameters: z.object({}),
      execute: async () => (await getCandidateItems()).join(", "),
    }),
    tool({
      name: "find_items_by_tags",
      description:
        "Найти предметы-кандидаты, у которых есть хотя бы один из перечисленных тегов. Используй, когда уже определил, какие теги нужно добрать герою — быстрее, чем перебирать list_candidate_items и проверять каждый через get_item_tags.",
      parameters: z.object({
        tags: z.array(z.string()).describe("Теги для поиска, например Strong dispel, Status resistance"),
      }),
      execute: async ({ tags }) => {
        const matches = await findItemsByTags(tags);
        if (!matches.length) return `Нет предметов-кандидатов с тегами: ${tags.join(", ")}.`;
        return matches.map((m) => formatTags(m.item, m.entity)).join("\n\n");
      },
    }),
    tool({
      name: "get_item_details",
      description:
        "Detailed item info (cost, ability descriptions, stat bonuses, and notes/hint on stacking restrictions). Use to account for price and timing when ordering the build, and to check whether an item's bonus does not stack with another item already in the build (e.g. boots, Yasha-based items).",
      parameters: z.object({
        item_name: z.string().describe("Item display name"),
      }),
      execute: async ({ item_name }) => {
        const detail = await getItemDetail(item_name);
        return detail ? JSON.stringify(detail) : `No details for "${item_name}".`;
      },
    }),
    tool({
      name: "get_hero_abilities",
      description:
        "Detailed hero ability numbers (cooldowns, damage, talents). Use only when tags are not enough.",
      parameters: z.object({
        hero_name: z.string().describe("Hero name in English"),
      }),
      execute: async ({ hero_name }) => {
        const detail = await getHeroAbilityDetail(hero_name);
        return detail ? JSON.stringify(detail) : `No ability details for "${hero_name}".`;
      },
    }),
    tool({
      name: "get_aghanim_info",
      description:
        "Что именно дают Aghanim's Scepter и Aghanim's Shard этому герою (odota/dotaconstants) — используй, чтобы понять, какие теги временно приписать этим двум предметам для текущего героя: в общей базе тегов их эффект не описан, потому что он целиком зависит от героя.",
      parameters: z.object({
        hero_name: z.string().describe("Hero name in English"),
      }),
      execute: async ({ hero_name }) => {
        const info = await getAghanimInfo(hero_name);
        return info ? JSON.stringify(info) : `No Aghanim's info for "${hero_name}".`;
      },
    }),
    tool({
      name: "get_player_builds",
      description:
        "What items are usually bought on a hero (STRATZ stats), by game phase. Use to cross-check your picks against the standard build.",
      parameters: z.object({
        hero_name: z.string().describe("Hero name in English"),
      }),
      execute: async ({ hero_name }) => fetchBuildsSummary(hero_name),
    }),
    tool({
      name: "get_item_purchase_rate",
      description:
        "Для каждого перечисленного предмета на этом герое (STRATZ): доля матчей, где его купили (purchaseRate), винрейт и средняя минута покупки (avgPurchaseTimeMin, null если данных по времени нет). Используй, чтобы отсеять предметы, которые покупают крайне редко (rare: true), и чтобы выставить РЕАЛЬНЫЙ порядок/фазу предметов между собой — сравнивай avgPurchaseTimeMin между кандидатами, а не полагайся на общее ощущение о том, что раньше.",
      parameters: z.object({
        hero_name: z.string().describe("Hero name in English"),
        item_names: z
          .array(z.string())
          .describe("Названия предметов-кандидатов для проверки частоты покупки"),
      }),
      execute: async ({ hero_name, item_names }) =>
        JSON.stringify(await fetchItemPurchaseRates(hero_name, item_names)),
    }),
    tool({
      name: "submit_build",
      description:
        "Сохрани финальный билд. Вызови РОВНО ОДИН раз в конце анализа: items строго в порядке покупки.",
      parameters: z.object({
        items: z
          .array(
            z.object({
              item: z.string().describe("Название предмета на английском"),
              phase: z.enum(BUILD_PHASES).describe("Фаза: starting/early/core/situational/late"),
              reason: z.string().describe("Короткая причина: механика или тайминг"),
            }),
          )
          .min(1)
          .describe("Предметы строго в порядке покупки"),
        notes: z.string().nullable().describe("Необязательная общая заметка по билду"),
      }),
      execute: async ({ items, notes }) => {
        submitted.plan = {
          hero: heroName,
          position,
          items,
          notes,
          updatedAt: new Date().toISOString(),
        };
        return "Билд сохранён.";
      },
    }),
  ];

  return { tools, submitted };
}
