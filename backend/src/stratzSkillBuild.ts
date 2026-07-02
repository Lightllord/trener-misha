/**
 * Compact STRATZ skill-build summary for a hero — ability level-up priority
 * and per-talent win rates. Shared by background analysis subagents.
 */

import {
  queryStratz,
  findStratzHero,
  getAbilitiesMap,
} from "./stratzApi.js";

interface TalentSlot {
  abilityId: number;
  slot: number;
}

interface TalentStat {
  abilityId: number;
  matchCount: number;
  winCount: number;
}

interface AbilityLevelStat {
  abilityId: number;
  level: number;
  matchCount: number;
  winCount: number;
}

interface SkillBuildResponse {
  data: {
    constants: {
      hero: { talents: TalentSlot[] } | null;
    };
    heroStats: {
      talent?: TalentStat[];
      abilityMinLevel?: AbilityLevelStat[];
    };
  };
  errors?: Array<{ message: string }>;
}

const TALENT_LEVELS = [10, 15, 20, 25];

function winRate(matchCount: number, winCount: number): number {
  return matchCount > 0 ? (winCount / matchCount) * 100 : 0;
}

/** Fraction of the top ability's sample size below which an ability is
 * treated as cross-hero noise (STRATZ occasionally attributes a stray
 * ability-learn event from another hero, at matchCount 1-3, to this
 * heroId — real hero abilities always dominate by orders of magnitude). */
const NOISE_FLOOR_RATIO = 0.01;

function aggregateAbilityPriority(
  stats: AbilityLevelStat[],
  excludedAbilityIds: Set<number>,
): Array<{ id: number; avgLevel: number; matchCount: number; winRate: number }> {
  const map = new Map<number, { levelSum: number; mc: number; wc: number }>();
  for (const s of stats) {
    if (!s.matchCount || excludedAbilityIds.has(s.abilityId)) continue;
    const e = map.get(s.abilityId);
    if (e) {
      e.levelSum += s.level * s.matchCount;
      e.mc += s.matchCount;
      e.wc += s.winCount;
    } else {
      map.set(s.abilityId, { levelSum: s.level * s.matchCount, mc: s.matchCount, wc: s.winCount });
    }
  }
  const aggregated = Array.from(map.entries()).map(([id, d]) => ({
    id,
    avgLevel: d.levelSum / d.mc,
    matchCount: d.mc,
    winRate: winRate(d.mc, d.wc),
  }));
  const noiseFloor = Math.max(...aggregated.map((a) => a.matchCount), 0) * NOISE_FLOOR_RATIO;
  return aggregated
    .filter((a) => a.matchCount >= noiseFloor)
    .sort((a, b) => a.avgLevel - b.avgLevel);
}

export async function fetchSkillBuildSummary(heroName: string): Promise<string> {
  const hero = await findStratzHero(heroName);
  if (!hero) return `Hero "${heroName}" not found in STRATZ.`;

  const query = `
    query GetHeroSkillBuild($heroId: Short!) {
      constants {
        hero(id: $heroId) {
          talents { abilityId slot }
        }
      }
      heroStats {
        talent(heroId: $heroId) { abilityId matchCount winCount }
        abilityMinLevel(heroId: $heroId) { abilityId level matchCount winCount }
      }
    }
  `;

  const data = await queryStratz<SkillBuildResponse>(query, { heroId: hero.id });
  if (data.errors) return `STRATZ error: ${data.errors[0]?.message}`;

  const talentSlots = data.data?.constants?.hero?.talents ?? [];
  const talentStats = data.data?.heroStats?.talent ?? [];
  const abilityLevelStats = data.data?.heroStats?.abilityMinLevel ?? [];
  if (!talentSlots.length && !abilityLevelStats.length) {
    return `No skill build data for ${hero.displayName}.`;
  }

  const abilitiesMap = await getAbilitiesMap();
  const aname = (id: number) => abilitiesMap.get(id)?.displayName ?? `Ability ${id}`;
  const statsByAbility = new Map(talentStats.map((t) => [t.abilityId, t]));

  let result = `Typical skill build for ${hero.displayName} (STRATZ):\n`;

  const excludedAbilityIds = new Set(talentSlots.map((t) => t.abilityId));
  for (const s of abilityLevelStats) {
    const known = abilitiesMap.get(s.abilityId);
    if (!known || known.isTalent) excludedAbilityIds.add(s.abilityId);
  }
  const priority = aggregateAbilityPriority(abilityLevelStats, excludedAbilityIds);
  if (priority.length) {
    result +=
      "\nABILITY PRIORITY (earliest first point → latest, winrate in games where this ability was picked): " +
      priority.map((p) => `${aname(p.id)} (avg lvl ${p.avgLevel.toFixed(1)}, ${p.winRate.toFixed(0)}% wr)`).join(", ");
  }

  if (talentSlots.length) {
    result += "\nTALENTS (winrate of games where this talent was picked):";
    for (let tier = 0; tier < TALENT_LEVELS.length; tier++) {
      const left = talentSlots.find((t) => t.slot === tier * 2);
      const right = talentSlots.find((t) => t.slot === tier * 2 + 1);
      if (!left || !right) continue;
      const leftStat = statsByAbility.get(left.abilityId);
      const rightStat = statsByAbility.get(right.abilityId);
      const fmt = (id: number, s: TalentStat | undefined) =>
        s ? `${aname(id)} (${winRate(s.matchCount, s.winCount).toFixed(0)}% wr)` : aname(id);
      result += `\n  Level ${TALENT_LEVELS[tier]}: ${fmt(left.abilityId, leftStat)} vs ${fmt(right.abilityId, rightStat)}`;
    }
  }

  return result;
}
