/**
 * Background "full-game item build" subagent. Triggered by the plan_item_build
 * realtime tool once the player's position (1-5) is known. Reads enemy/ally/own
 * mechanic tags, works out which enemy threats the team already covers, picks
 * items for what's left, cross-checks them against STRATZ purchase rates, then
 * composes an ordered purchase plan. Delivers the result as a build_plan insight.
 */

import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { addInsight } from "./insight/store.js";
import { getDraft, getState, setBuildPlan } from "./gameData.js";
import { getMechanics } from "./itemKnowledge.js";
import { fetchBuildsSummary } from "./stratzBuilds.js";
import { formatBuildPlan } from "./buildMarkup.js";
import { tools, handleToolCall, parseBuildItems, fetchHeroTagsBlock } from "./buildPlanTools.js";
import type { BuildPlan } from "./types/build.js";
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

// Hard cap on the tool-calling loop so a subagent that keeps exploring
// (get_item_tags/get_item_details for every candidate, etc.) can't run
// indefinitely and leave the player waiting with no delivered insight.
const MAX_CHAT_TURNS = 16;

const ROLE_BY_POSITION: Record<number, string> = {
  1: "позиция 1 — кэрри (hard carry): фарм-зависимые кор-предметы, поздняя игра, тайминги фарма",
  2: "позиция 2 — мидер: темповые предметы, ранние тайминги силы, мобильность",
  3: "позиция 3 — офлейн: танковость, инициация, ауры, ситуативные контр-предметы",
  4: "позиция 4 — саппорт-роумер: дешёвая утилити, мобильность, ганг-предметы, спасение",
  5: "позиция 5 — хард-саппорт: расходники, вижн, ауры, дешёвое спасение и контроль",
};

async function buildSystemPrompt(): Promise<string> {
  const mechanics = await getMechanics();
  const glossary = Object.entries(mechanics)
    .map(([tag, meaning]) => `- ${tag}: ${meaning}`)
    .join("\n");

  return `Ты — аналитик-тренер по Dota 2, который продумывает ПОЛНЫЙ билд предметов на всю игру с порядком покупки.

В сообщении пользователя уже даны ТЕГИ вражеских героев, ТЕГИ героев-союзников, ТЕГИ героя игрока и типичный STRATZ-билд героя — они получены заранее и это твой ПЕРВООЧЕРЁДНОЙ источник, разбери их перед тем как выбирать предметы. Не пропускай и не выдумывай угрозы — отталкивайся от того, что реально написано в тегах врага.

Методология (придерживайся порядка):
1. Определи приоритеты роли по позиции игрока (даётся в запросе): кор-предметы и фарм у кэрри/мида, утилити/ауры/вижн у саппортов, танковость/инициация у офлейна. Это задаёт, какие слоты и тайминги важны.
2. Прочитай ТЕГИ ВРАГА, ТЕГИ СОЮЗНИКОВ и ТЕГИ ИГРОКА из сообщения пользователя, сверяясь по смыслу с глоссарием тегов ниже (значение каждого тега смотри там).
3. Выдели ОСНОВНЫЕ угрожающие теги врага, которые обязательно нужно законтрить (например Silence, крупный burst-урон, Evasion, массовый контроль) — это твой исходный список угроз. Если по какому-то герою тегов не хватает — углубись через get_hero_abilities.
4. Разбор покрытия (gap-анализ): для каждого выделенного угрожающего тега проверь, не закрыт ли он УЖЕ способностями твоей команды — тегами союзников (например Strong dispel у союзника уже снимает Silence) или тегами твоего героя. Если способность команды надёжно и часто закрывает угрозу — вычеркни этот тег: предметами дублировать её не нужно.
5. Из того, что осталось не закрыто на шаге 4, выведи КОНКРЕТНЫЕ теги, которые нужно добрать именно твоему герою предметами (например если не закрыт Silence — нужен тег Strong dispel или Status resistance; если не закрыт burst-урон — Damage block или Barrier).
6. Aghanim's Scepter и Aghanim's Shard — универсальные предметы, но у них НЕТ предзаданных тегов в базе: их эффект целиком зависит от героя. Вызови get_aghanim_info(своего героя) — это даст точное описание, что именно каждый из них даёт этому герою (по данным odota/dotaconstants, а не по общим файлам способностей). По этому описанию ВРЕМЕННО (только для этого ответа) присвой Aghanim's Scepter и Aghanim's Shard подходящие теги из глоссария. Учти эти временные теги на следующем шаге наравне с обычными предметами — если один из них закрывает нужный тег из шага 5, это кандидат в билд.
7. Найди предметы под теги из шага 5 через find_items_by_tags (передай список нужных тегов) — это быстрее и точнее, чем перебирать все кандидаты через list_candidate_items и проверять каждый через get_item_tags вручную. Добавь к результату Aghanim's Scepter/Shard, если их временные теги с шага 6 закрывают что-то из списка. При необходимости уточни конкретный предмет через get_item_tags, а цену и тайминги — через get_item_details (цена определяет, на какой фазе предмет реалистичен для этой роли).
8. Сопоставь получившийся список со СТАНДАРТНЫМ БИЛДОМ (STRATZ) из сообщения пользователя: подтверди ядро билда. Затем для ситуативных/небанальных предметов-кандидатов вызови get_item_purchase_rate (герой + список этих предметов): если предмет покупают крайне редко на этом герое (низкий purchase rate, флаг rare) — убери его или замени на более частый аналог, если только теги не дают очень веской причины оставить именно его.
9. Составь финальный билд в ПОРЯДКЕ покупки по фазам: старт → ранняя игра → кор (мид-гейм) → ситуативные/поздние. Для каждого предмета — одна короткая причина (механика, тайминг или частота покупки), явно привязанная к нужному тегу/синергии/STRATZ. Сохрани результат вызовом submit_build: items строго в порядке покупки, у каждого item, phase и reason.

Глоссарий тегов:
${glossary}`;
}

export function planItemBuild(position: number): void {
  log("build-plan", `request: position ${position}`);
  analyzeInBackground(position).catch((err) => {
    logError("build-plan", "background analysis failed:", err);
    addInsight(
      "build_plan",
      `[Сборка билда не удалась] Извинись перед игроком, что не получилось продумать билд, и предложи попросить ещё раз.`,
    );
  });
}

async function analyzeInBackground(position: number): Promise<void> {
  const draft = getDraft() as DraftResponse | null;
  const state = getState() as StateResponse | null;

  const role = ROLE_BY_POSITION[position] ?? `позиция ${position}`;
  const draftContext = draft
    ? `Radiant: ${draft.radiant.join(", ")}\nDire: ${draft.dire.join(", ")}`
    : "Драфт пока не определён — строй билд от героя игрока и общих принципов роли.";
  const playerContext = state
    ? `Игрок на стороне ${state.player.team}, герой: ${state.hero.name}.`
    : "Герой игрока неизвестен — уточни в ответе, что нужен герой для точного билда.";

  const enemyHeroes =
    draft && state?.player?.team
      ? state.player.team === "radiant"
        ? draft.dire
        : draft.radiant
      : [];
  const allyHeroes =
    draft && state?.player?.team
      ? (state.player.team === "radiant" ? draft.radiant : draft.dire).filter(
          (h) => h !== state?.hero?.name,
        )
      : [];
  const ownHero = state?.hero?.name ? [state.hero.name] : [];

  const [enemyTagsBlock, allyTagsBlock, ownTagsBlock, stratzBlock] = await Promise.all([
    fetchHeroTagsBlock(enemyHeroes),
    fetchHeroTagsBlock(allyHeroes),
    fetchHeroTagsBlock(ownHero),
    state?.hero?.name ? fetchBuildsSummary(state.hero.name) : Promise.resolve("Герой игрока неизвестен."),
  ]);
  log(
    "build-plan",
    `pre-fetched tags (enemy ${enemyHeroes.length}, ally ${allyHeroes.length}, own ${ownHero.length}) and STRATZ build`,
  );

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: await buildSystemPrompt() },
    {
      role: "user",
      content: `Роль игрока: ${role}.

${playerContext}
${draftContext}

ТЕГИ ВРАГА:
${enemyTagsBlock}

ТЕГИ СОЮЗНИКОВ:
${allyTagsBlock}

ТЕГИ ИГРОКА:
${ownTagsBlock}

СТАНДАРТНЫЙ БИЛД (STRATZ):
${stratzBlock}

Продумай полный билд предметов на игру под этого героя, эту роль и этот драфт: сначала разбери, какие угрозы врага уже закрыты тегами союзников и твоего героя (gap-анализ), затем подбирай предметы под то, что осталось не закрыто, и сверяйся со стандартным билдом и частотой покупки предметов. В конце ОБЯЗАТЕЛЬНО вызови submit_build с финальным билдом в порядке покупки (у каждого предмета phase и короткая reason).`,
    },
  ];

  const openai = new OpenAI({ timeout: 60_000 });

  for (let turn = 1; turn <= MAX_CHAT_TURNS; turn++) {
    if (turn === MAX_CHAT_TURNS) {
      messages.push({
        role: "user",
        content:
          "Это последний доступный шаг анализа. Прекрати уточнять детали и ОБЯЗАТЕЛЬНО вызови submit_build прямо сейчас с лучшим билдом, который у тебя уже есть.",
      });
    }

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
        const args = JSON.parse(call.function.arguments) as Record<string, unknown>;
        log(
          "build-plan",
          `tool call: ${call.function.name}(${truncate(call.function.arguments, LOG_PREVIEW_MAX)})`,
        );

        if (call.function.name === "submit_build") {
          const items = parseBuildItems(args.items);
          if (!items.length) {
            messages.push({
              role: "tool",
              tool_call_id: call.id,
              content: "Пустой билд — добавь хотя бы один предмет и вызови submit_build снова.",
            });
            continue;
          }
          const plan: BuildPlan = {
            hero: state?.hero?.name ?? null,
            position,
            items,
            notes: typeof args.notes === "string" ? args.notes : null,
            updatedAt: new Date().toISOString(),
          };
          setBuildPlan(plan);
          log("build-plan", `build stored — ${items.length} items`);
          addInsight(
            "build_plan",
            `[Билд на игру готов]\n${formatBuildPlan(plan)}\n\nОзвучь билд игроку по порядку покупки, кратко и по делу. Не вываливай всё сразу простынёй — назови порядок предметов с короткой причиной, детали по каждому давай, если игрок переспросит. Билд сохранён — игрок может попросить изменить его (add/remove/replace/move).`,
          );
          return;
        }

        const result = await handleToolCall(call.function.name, args);
        messages.push({ role: "tool", tool_call_id: call.id, content: result });
      }
      continue;
    }

    if (msg.content) {
      log("build-plan", "build ready (text fallback — not stored) — queued for delivery");
      addInsight(
        "build_plan",
        `[Билд на игру готов]\n${msg.content}\n\nОзвучь билд игроку по порядку покупки, кратко и по делу. Не вываливай всё сразу простынёй — назови порядок предметов с короткой причиной, детали по каждому давай, если игрок переспросит.`,
      );
      return;
    }
    break;
  }

  log("build-plan", "no result after max turns — apologizing");
  addInsight(
    "build_plan",
    `[Сборка билда не удалась] Извинись перед игроком, что не получилось продумать билд, и предложи попросить ещё раз.`,
  );
}
