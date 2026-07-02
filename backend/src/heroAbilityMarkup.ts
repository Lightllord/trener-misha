/** Renders a HeroAbilityDetail into the text the voice agent reads aloud. */

import type { HeroAbility, HeroAbilityDetail } from "./types/knowledge.js";

function formatAbility(ability: HeroAbility): string {
  const traits = Object.entries(ability.traits)
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ");
  const hotkey = ability.hotkey ? ` [${ability.hotkey}]` : "";
  return `${ability.name}${hotkey} (${ability.type}) — ${ability.description}${traits ? `\n    ${traits}` : ""}`;
}

export function formatHeroAbilityDetail(detail: HeroAbilityDetail): string {
  const lines = [`${detail.heroName}:`];

  if (detail.innateAbility) {
    lines.push(`  Врождённая: ${formatAbility(detail.innateAbility)}`);
  }
  for (const ability of detail.abilities) {
    lines.push(`  ${formatAbility(ability)}`);
  }
  if (detail.talents.length > 0) {
    lines.push("  Таланты:");
    for (const t of detail.talents) {
      lines.push(`    Уровень ${t.level}: ${t.left} | ${t.right}`);
    }
  }
  if (detail.roles.length > 0) {
    lines.push(`  Роли: ${detail.roles.join(", ")}`);
  }

  return lines.join("\n");
}
