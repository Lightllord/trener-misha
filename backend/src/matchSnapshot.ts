function str(val: unknown, fallback = ""): string {
  return typeof val === "string" ? val : fallback
}

function num(val: unknown, fallback = 0): number {
  return typeof val === "number" ? val : fallback
}

function bool(val: unknown, fallback = false): boolean {
  return typeof val === "boolean" ? val : fallback
}

function obj(val: unknown): Record<string, unknown> {
  return typeof val === "object" && val !== null && !Array.isArray(val)
    ? (val as Record<string, unknown>)
    : {}
}

function arr(val: unknown): unknown[] {
  return Array.isArray(val) ? val : []
}

function formatItem(raw: unknown): string {
  const item = obj(raw)
  const name = str(item["name"])
  if (!name || name === "empty") return ""
  const cd = num(item["cooldown"])
  const charges = item["charges"]
  const extras: string[] = []
  if (cd > 0) extras.push(`cd=${cd}`)
  if (typeof charges === "number" && charges > 0) extras.push(`x${charges}`)
  return extras.length > 0 ? `${name}(${extras.join(",")})` : name
}

function formatItemList(items: unknown[]): string {
  return items.map(formatItem).filter(Boolean).join(" ") || "—"
}

function formatOtherHeroes(heroes: unknown[]): string[] {
  if (heroes.length === 0) return []
  const lines: string[] = ["<other-heroes>"]
  for (const raw of heroes) {
    const h = obj(raw)
    const name = str(h["name"])
    if (!name) continue
    const inventory = obj(h["inventory"])
    const items = arr(inventory["main"])
      .map(slot => str(obj(slot)["name"]))
      .filter(n => n && n !== "empty")
      .join(" ") || "—"
    lines.push(
      `<h name="${name}" team="${str(h["team"])}" slot="${num(h["slot"])}" lvl="${num(h["level"])}" items="${items}"/>`,
    )
  }
  lines.push("</other-heroes>")
  return lines
}

export function formatMatchSnapshot(state: Record<string, unknown> | null): string {
  if (!state) return ""

  const score = obj(state["score"])
  const draft = obj(state["draft"])
  const radiantPicks = arr(draft["radiant"]).map(v => str(v)).filter(Boolean)
  const direPicks = arr(draft["dire"]).map(v => str(v)).filter(Boolean)
  const draftLine = radiantPicks.length > 0 || direPicks.length > 0
    ? [`<draft radiant="${radiantPicks.join(",")}" dire="${direPicks.join(",")}"/>`]
    : []
  const player = obj(state["player"])
  const hero = obj(state["hero"])
  const abilities = arr(hero["abilities"])
  const inventory = obj(hero["inventory"])
  const allyBuildings = arr(state["allyBuildings"])
  const enemyBuildings = arr(state["enemyBuildings"])
  const otherHeroes = arr(state["otherHeroes"])

  const talents = arr(hero["talents"]).map(v => bool(v) ? "1" : "0").join("")

  const abilityLines = abilities.map(raw => {
    const ab = obj(raw)
    const name = str(ab["name"])
    if (!name) return ""
    const passive = bool(ab["passive"])
    const cdPart = passive
      ? ""
      : ` cd="${num(ab["cooldown"])}/${num(ab["maxCooldown"])}"`
    return (
      `<a name="${name}" lvl="${num(ab["level"])}"` +
      ` cast="${bool(ab["canCast"]) ? "1" : "0"}"` +
      ` ult="${bool(ab["isUltimate"]) ? "1" : "0"}"` +
      ` passive="${passive ? "1" : "0"}"${cdPart}/>`
    )
  }).filter(Boolean)

  const allyLines = allyBuildings.map(raw => {
    const bld = obj(raw)
    const dead = bool(bld["destroyed"])
    const hpPart = bld["health"] !== undefined
      ? ` hp="${num(bld["health"])}/${num(bld["maxHealth"])}"`
      : ""
    return `<b type="${str(bld["type"])}" lane="${str(bld["lane"])}" dead="${dead ? "1" : "0"}"${hpPart}/>`
  })

  const enemyLines = enemyBuildings.map(raw => {
    const bld = obj(raw)
    return `<b type="${str(bld["type"])}" lane="${str(bld["lane"])}" dead="${bool(bld["destroyed"]) ? "1" : "0"}"/>`
  })

  const tp = obj(inventory["teleport"])
  const tpStr = str(tp["name"]) ? `<tp cd="${num(tp["cooldown"])}"/>` : "<tp none/>"

  const neutralItem = obj(obj(inventory["neutral"])["item"])
  const neutralName = str(neutralItem["name"])
  const neutralStr = neutralName ? `<neutral name="${neutralName}"/>` : "<neutral none/>"

  return [
    "<match-snapshot>",
    `<map clock="${num(state["clockTime"])}" day="${bool(state["isDaytime"]) ? "1" : "0"}" r="${num(score["radiant"])}" d="${num(score["dire"])}"/>`,
    ...draftLine,
    `<player team="${str(player["team"])}" k="${num(player["kills"])}" d="${num(player["deaths"])}" a="${num(player["assists"])}" lh="${num(player["lastHits"])}" dn="${num(player["denies"])}" ks="${num(player["killStreak"])}" gold="${num(player["gold"])}" gpm="${num(player["gpm"])}" xpm="${num(player["xpm"])}"/>`,
    `<hero alive="${bool(hero["alive"]) ? "1" : "0"}" respawn="${num(hero["respawnSeconds"])}" max-hp="${num(hero["maxHealth"])}" max-mana="${num(hero["maxMana"])}" bb="${num(hero["buybackCost"])}/${num(hero["buybackCooldown"])}cd" scepter="${bool(hero["aghanimsScepter"]) ? "1" : "0"}" shard="${bool(hero["aghanimsShard"]) ? "1" : "0"}" attr="${num(hero["attributesLevel"])}" talents="${talents}"/>`,
    "<abilities>",
    ...abilityLines,
    "</abilities>",
    "<items>",
    `<main>${formatItemList(arr(inventory["main"]))}</main>`,
    `<stash>${formatItemList(arr(inventory["stash"]))}</stash>`,
    tpStr,
    neutralStr,
    "</items>",
    "<ally-buildings>",
    ...allyLines,
    "</ally-buildings>",
    "<enemy-buildings>",
    ...enemyLines,
    "</enemy-buildings>",
    ...formatOtherHeroes(otherHeroes),
    "</match-snapshot>",
  ].join("\n")
}
