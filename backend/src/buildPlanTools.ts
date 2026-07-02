/**
 * Tool-calling surface for the plan_item_build background subagent
 * (buildPlan.ts): the private OpenAI tool list, its dispatcher, and the
 * pure helpers that format tag data and parse the submitted build.
 */

import OpenAI from "openai";
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
import type { BuildItem, BuildPhase } from "./types/build.js";

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

export const tools: OpenAI.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "get_item_tags",
      description:
        "Mechanic tags for an item's active/passive abilities (primary source). Use to check what counter-mechanic an item provides.",
      parameters: {
        type: "object",
        properties: { item_name: { type: "string", description: "Item name (English or internal)" } },
        required: ["item_name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_candidate_items",
      description:
        "List of relevant items worth recommending (internal names). Use to pick which items to inspect with get_item_tags.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "find_items_by_tags",
      description:
        "Найти предметы-кандидаты, у которых есть хотя бы один из перечисленных тегов. Используй, когда уже определил, какие теги нужно добрать герою — быстрее, чем перебирать list_candidate_items и проверять каждый через get_item_tags.",
      parameters: {
        type: "object",
        properties: {
          tags: {
            type: "array",
            items: { type: "string" },
            description: "Теги для поиска, например Strong dispel, Status resistance",
          },
        },
        required: ["tags"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_item_details",
      description:
        "Detailed item info (cost, ability descriptions, stat bonuses). Use to account for price and timing when ordering the build.",
      parameters: {
        type: "object",
        properties: { item_name: { type: "string", description: "Item display name" } },
        required: ["item_name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_hero_abilities",
      description:
        "Detailed hero ability numbers (cooldowns, damage, talents). Use only when tags are not enough.",
      parameters: {
        type: "object",
        properties: { hero_name: { type: "string", description: "Hero name in English" } },
        required: ["hero_name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_aghanim_info",
      description:
        "Что именно дают Aghanim's Scepter и Aghanim's Shard этому герою (odota/dotaconstants) — используй, чтобы понять, какие теги временно приписать этим двум предметам для текущего героя: в общей базе тегов их эффект не описан, потому что он целиком зависит от героя.",
      parameters: {
        type: "object",
        properties: { hero_name: { type: "string", description: "Hero name in English" } },
        required: ["hero_name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_player_builds",
      description:
        "What items are usually bought on a hero (STRATZ stats), by game phase. Use to cross-check your picks against the standard build.",
      parameters: {
        type: "object",
        properties: { hero_name: { type: "string", description: "Hero name in English" } },
        required: ["hero_name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_item_purchase_rate",
      description:
        "Для каждого перечисленного предмета на этом герое (STRATZ): доля матчей, где его купили (purchaseRate), винрейт и средняя минута покупки (avgPurchaseTimeMin, null если данных по времени нет). Используй, чтобы отсеять предметы, которые покупают крайне редко (rare: true), и чтобы выставить РЕАЛЬНЫЙ порядок/фазу предметов между собой — сравнивай avgPurchaseTimeMin между кандидатами, а не полагайся на общее ощущение о том, что раньше.",
      parameters: {
        type: "object",
        properties: {
          hero_name: { type: "string", description: "Hero name in English" },
          item_names: {
            type: "array",
            items: { type: "string" },
            description: "Названия предметов-кандидатов для проверки частоты покупки",
          },
        },
        required: ["hero_name", "item_names"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "submit_build",
      description:
        "Сохрани финальный билд. Вызови РОВНО ОДИН раз в конце анализа: items строго в порядке покупки.",
      parameters: {
        type: "object",
        properties: {
          items: {
            type: "array",
            description: "Предметы строго в порядке покупки",
            items: {
              type: "object",
              properties: {
                item: { type: "string", description: "Название предмета на английском" },
                phase: {
                  type: "string",
                  enum: [...BUILD_PHASES],
                  description: "Фаза: starting/early/core/situational/late",
                },
                reason: { type: "string", description: "Короткая причина: механика или тайминг" },
              },
              required: ["item", "phase", "reason"],
            },
          },
          notes: { type: "string", description: "Необязательная общая заметка по билду" },
        },
        required: ["items"],
      },
    },
  },
];

export function parseBuildItems(raw: unknown): BuildItem[] {
  if (!Array.isArray(raw)) return [];
  const phases = BUILD_PHASES as readonly string[];
  const out: BuildItem[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.item !== "string") continue;
    out.push({
      item: e.item,
      phase: phases.includes(String(e.phase)) ? (e.phase as BuildPhase) : "core",
      reason: typeof e.reason === "string" ? e.reason : "",
    });
  }
  return out;
}

export async function handleToolCall(
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  if (name === "list_candidate_items") {
    return (await getCandidateItems()).join(", ");
  }

  if (name === "get_item_tags") {
    const item = String(args.item_name ?? "");
    const found = await getItemTags(item);
    return found ? formatTags(found.key, found.entity) : `No tags for "${item}".`;
  }

  if (name === "find_items_by_tags") {
    const rawTags = Array.isArray(args.tags) ? args.tags : [];
    const tags = rawTags.filter((v): v is string => typeof v === "string");
    const matches = await findItemsByTags(tags);
    if (!matches.length) return `Нет предметов-кандидатов с тегами: ${tags.join(", ")}.`;
    return matches.map((m) => formatTags(m.item, m.entity)).join("\n\n");
  }

  if (name === "get_item_details") {
    const item = String(args.item_name ?? "");
    const detail = await getItemDetail(item);
    return detail ? JSON.stringify(detail) : `No details for "${item}".`;
  }

  if (name === "get_hero_abilities") {
    const hero = String(args.hero_name ?? "");
    const detail = await getHeroAbilityDetail(hero);
    return detail ? JSON.stringify(detail) : `No ability details for "${hero}".`;
  }

  if (name === "get_aghanim_info") {
    const hero = String(args.hero_name ?? "");
    const info = await getAghanimInfo(hero);
    return info ? JSON.stringify(info) : `No Aghanim's info for "${hero}".`;
  }

  if (name === "get_player_builds") {
    return fetchBuildsSummary(String(args.hero_name ?? ""));
  }

  if (name === "get_item_purchase_rate") {
    const hero = String(args.hero_name ?? "");
    const rawItems = Array.isArray(args.item_names) ? args.item_names : [];
    const items = rawItems.filter((v): v is string => typeof v === "string");
    const rates = await fetchItemPurchaseRates(hero, items);
    return JSON.stringify(rates);
  }

  return "Unknown tool.";
}
