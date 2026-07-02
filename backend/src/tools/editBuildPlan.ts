import { tool } from "@openai/agents/realtime";
import { z } from "zod";
import { BUILD_PHASES } from "../consts/build.js";
import {
  addBuildItem,
  removeBuildItem,
  replaceBuildItem,
  moveBuildItem,
} from "../gameData.js";
import { formatBuildPlan } from "../buildMarkup.js";
import type { BuildPhase, EditAnchor, EditResult } from "../types/build.js";

export const editBuildPlanTool = tool({
  name: "edit_build_plan",
  description:
    "Изменить сохранённый билд по просьбе игрока: добавить, убрать, заменить или переставить предмет. Возвращает обновлённый билд — коротко озвучь игроку, что изменил. Для крупной переделки билда под новый план игры лучше заново вызвать plan_item_build.",
  parameters: z.object({
    action: z
      .enum(["add", "remove", "replace", "move"])
      .describe(
        "add — добавить предмет; remove — убрать; replace — заменить один предмет другим; move — переставить в порядке покупки",
      ),
    item: z
      .string()
      .describe(
        "Для add — новый предмет; для remove/move — предмет, который уже в билде; для replace — НОВЫЙ предмет",
      ),
    replaces: z
      .string()
      .nullable()
      .describe("Только для replace: какой предмет в билде заменяем (иначе null)"),
    phase: z
      .enum(BUILD_PHASES)
      .nullable()
      .describe("Фаза для add/replace: starting/early/core/situational/late (иначе null)"),
    reason: z
      .string()
      .nullable()
      .describe("Короткая причина для add/replace (иначе null)"),
    after: z
      .string()
      .nullable()
      .describe("Для add/move: поставить сразу ПОСЛЕ этого предмета (иначе null)"),
    before: z
      .string()
      .nullable()
      .describe("Для add/move: поставить сразу ПЕРЕД этим предметом (иначе null)"),
  }),
  execute: async ({ action, item, replaces, phase, reason, after, before }) => {
    const anchor: EditAnchor = {
      after: after ?? undefined,
      before: before ?? undefined,
    };
    const newItem = {
      item,
      phase: (phase ?? "core") as BuildPhase,
      reason: reason ?? "",
    };

    let result: EditResult;
    switch (action) {
      case "add":
        result = addBuildItem(newItem, anchor);
        break;
      case "remove":
        result = removeBuildItem(item);
        break;
      case "replace":
        if (!replaces) return "Для замены укажи replaces — какой предмет в билде заменяем.";
        result = replaceBuildItem(replaces, newItem);
        break;
      case "move":
        result = moveBuildItem(item, anchor);
        break;
      default:
        return "Неизвестное действие.";
    }

    if (!result.ok) return result.error;
    return `Готово. Обновлённый билд:\n${formatBuildPlan(result.plan)}`;
  },
});
