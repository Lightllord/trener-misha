/**
 * Background "what should I buy?" subagent. Triggered by the request_item_advice
 * realtime tool. Reasons over ability/item tags (hero-notes, item-notes,
 * mecanics_list), deepens with enriched item/ability data when needed, and
 * cross-checks against the player's typical STRATZ build. Delivers the result
 * as an item_advice insight for the voice agent to speak.
 */

import { Agent, run, tool } from "@openai/agents";
import { z } from "zod";
import { addInsight } from "./insight/store.js";
import { getDraft, getState } from "./gameData.js";
import {
  getMechanics,
  getHeroTags,
  getItemTags,
  getCandidateItems,
  getItemDetail,
  getHeroAbilityDetail,
} from "./itemKnowledge.js";
import { fetchBuildsSummary } from "./stratzBuilds.js";
import type { TaggedEntity } from "./types/knowledge.js";
import { log, logError } from "./observability/log.js";
import { truncate } from "./observability/truncate.js";
import { LOG_PREVIEW_MAX } from "./observability/consts/log.js";

interface DraftResponse {
  radiant: string[];
  dire: string[];
}

interface StateResponse {
  player: { team: string };
  hero: { name: string };
}

function formatTags(name: string, entity: TaggedEntity): string {
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

const tools = [
  tool({
    name: "get_hero_tags",
    description:
      "Mechanic tags for a hero's abilities (primary source). Use to understand what a hero does — disables, damage types, dispels, etc.",
    parameters: z.object({
      hero_name: z.string().describe("Hero name in English"),
    }),
    execute: async ({ hero_name }) => {
      const found = await getHeroTags(hero_name);
      return found ? formatTags(found.key, found.entity) : `No tags for "${hero_name}".`;
    },
  }),
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
    name: "get_item_details",
    description:
      "Detailed item info (cost, ability descriptions, stat bonuses). Use only when tags are not enough to decide.",
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
    name: "get_player_builds",
    description:
      "What items are usually bought on a hero (STRATZ stats). Use at the end to compare your picks against the standard build.",
    parameters: z.object({
      hero_name: z.string().describe("Hero name in English"),
    }),
    execute: async ({ hero_name }) => fetchBuildsSummary(hero_name),
  }),
];

async function buildSystemPrompt(): Promise<string> {
  const mechanics = await getMechanics();
  const glossary = Object.entries(mechanics)
    .map(([tag, meaning]) => `- ${tag}: ${meaning}`)
    .join("\n");

  return `Ты — аналитик-тренер по Dota 2, который советует, какой предмет купить.

Методология (придерживайся порядка):
1. Разбери ситуацию через ТЕГИ: get_hero_tags для угрожающих героев врага и героя игрока, get_item_tags для предметов-кандидатов. Значение каждого тега смотри в глоссарии ниже.
2. Сопоставь теги: какой контр-механики не хватает игроку против врага (например против Silence нужен Status resistance / Strong dispel; против burst — Damage block / Barrier; против Evasion — True strike).
3. Если тегов недостаточно для решения — углубись: get_item_details (стоимость, описание) и get_hero_abilities (числа, кулдауны).
4. В конце вызови get_player_builds для героя игрока и сопоставь свои рекомендации с тем, что обычно на него покупают: подтверди совпадения или объясни, почему в этой ситуации стоит отклониться от стандарта.

Глоссарий тегов:
${glossary}`;
}

export function requestItemAdvice(question: string): void {
  log("item-advice", `started — ${truncate(question, LOG_PREVIEW_MAX)}`);
  analyzeInBackground(question).catch((err) => {
    logError("item-advice", "background analysis failed:", err);
    addInsight(
      "item_advice",
      `<item-advice-fallback>
<say>Тяжёлый случай, не уверен на сто процентов, но думаю...</say>
<instruction-for-agent>Не удалось найти точные данные по предметам. Не извиняйся и не упоминай ошибку. Начни примерно с фразы из <say>, затем ответь на вопрос игрока и предложи предмет, опираясь на историю сообщений и/или другую доступную информацию (герой игрока, драфт, общие механики). Дай лучший возможный совет — естественно и кратко.</instruction-for-agent>
</item-advice-fallback>`,
    );
  });
}

async function analyzeInBackground(question: string): Promise<void> {
  const draft = getDraft() as DraftResponse | null;
  const state = getState() as StateResponse | null;

  const draftContext = draft
    ? `Radiant: ${draft.radiant.join(", ")}\nDire: ${draft.dire.join(", ")}`
    : "Драфт пока не определён.";
  const playerContext = state
    ? `Игрок на стороне ${state.player.team}, герой: ${state.hero.name}.`
    : "Герой игрока неизвестен — уточни в ответе, если это важно.";

  const agent = new Agent({
    name: "item-advisor",
    instructions: await buildSystemPrompt(),
    model: "gpt-5.5",
    modelSettings: { reasoning: { effort: "medium" } },
    tools,
  });

  const result = await run(
    agent,
    `Вопрос игрока: "${question}"

${playerContext}
${draftContext}

Подбери 1-3 предмета под ситуацию и кратко (3-5 предложений) объясни ПОЧЕМУ через механики. В конце сверься со стандартным билдом героя игрока.`,
  );

  const advice = result.finalOutput;
  if (advice) {
    addInsight(
      "item_advice",
      `[Совет по предметам готов]\nВопрос игрока: "${question}"\n${advice}\n\nОзвучь этот совет игроку естественно и кратко.`,
    );
  }
}
