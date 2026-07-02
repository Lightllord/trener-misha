/** Renders a stored BuildPlan into the text the voice agent reads aloud. */

import type { BuildPhase, BuildPlan } from "./types/build.js";

const PHASE_LABEL: Record<BuildPhase, string> = {
  starting: "старт",
  early: "ранняя",
  core: "кор",
  situational: "ситуатив",
  late: "поздняя",
};

export function formatBuildPlan(plan: BuildPlan): string {
  const head = `Билд (позиция ${plan.position}${plan.hero ? `, ${plan.hero}` : ""}):`;
  const lines = plan.items.map(
    (it, i) => `${i + 1}. ${it.item} [${PHASE_LABEL[it.phase]}] — ${it.reason}`,
  );
  const tail = plan.notes ? `\nЗаметки: ${plan.notes}` : "";
  return [head, ...lines].join("\n") + tail;
}
