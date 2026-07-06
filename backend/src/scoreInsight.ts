import { addInsight, isExpired } from "./insight/store.js";
import type { Insight } from "./insight/types/insight.js";

// Chance that a single kill/death/assist fires an instant score_change_instant
// callout instead of going into the team-fight buffer below.
const SCORE_INSTANT_CHANCE = 0.45;
// After a successful instant callout, the coin isn't flipped again for this
// long — every score event in that window goes straight to the buffer.
const SCORE_INSTANT_COOLDOWN_MS = 15_000;
// Starting size of the team-fight buffer window, and also the cap on how far
// it can be extended below.
const SCORE_BUFFER_WINDOW_MS = 15_000;
// Extra time added to the buffer's deadline per additional event inside it,
// capped so the remaining time never exceeds SCORE_BUFFER_WINDOW_MS.
const SCORE_BUFFER_EXTENSION_MS = 2_000;

export type ScoreKind = "kill" | "death" | "assist";

interface ScoreEvent {
  type: ScoreKind;
  level?: number; // only meaningful for "death"
  respawnSeconds?: number; // only meaningful for "death"
  instantFired: boolean;
}

interface LiveScore {
  kills: number;
  deaths: number;
  assists: number;
}

// Always the player's current kills/deaths/assists as of the last processed
// state push — render closures below read this live so a score insight's KDA
// text stays accurate even if it sits unused in the store for a while.
let liveScore: LiveScore = { kills: 0, deaths: 0, assists: 0 };
let lastInstantFiredMs = 0;

let scoreBuffer: ScoreEvent[] = [];
let scoreBufferTimer: ReturnType<typeof setTimeout> | null = null;
let scoreBufferDeadline: number | null = null;

interface PendingScoreInsight {
  insight: Insight;
  render: () => string;
}
// Score insights still awaiting delivery, paired with a closure that
// re-renders their payload from the live score above. Pruned of
// used/expired entries on every touch, so it never grows past however many
// score insights are currently pending.
const pendingScoreInsights: PendingScoreInsight[] = [];

function pruneScoreInsights(): void {
  for (let i = pendingScoreInsights.length - 1; i >= 0; i--) {
    const entry = pendingScoreInsights[i];
    if (entry && (entry.insight.used || isExpired(entry.insight))) {
      pendingScoreInsights.splice(i, 1);
    }
  }
}

function registerScoreInsight(insight: Insight | null, render: () => string): void {
  pruneScoreInsights();
  if (insight) pendingScoreInsights.push({ insight, render });
}

function refreshPendingScoreInsights(): void {
  pruneScoreInsights();
  for (const entry of pendingScoreInsights) entry.insight.payload = entry.render();
}

export function updateLiveScore(score: LiveScore): void {
  liveScore = score;
  refreshPendingScoreInsights();
}

function scoreKda(): string {
  return `${liveScore.kills}/${liveScore.deaths}/${liveScore.assists}`;
}

function renderKillText(): string {
  return `Убийство! Счёт ${scoreKda()}.`;
}

function renderAssistText(): string {
  return `Ассист! Счёт ${scoreKda()}.`;
}

function renderDeathText(level: number | undefined, respawnSeconds: number | undefined): string {
  return `Игрок только что погиб. KDA: ${scoreKda()}, уровень ${level ?? 0}, респаун через ${respawnSeconds ?? 0}с.` +
    ` Дай короткий тактический совет — что скорее всего привело к смерти` +
    ` и как избежать этого в следующей жизни. 1-2 предложения, без воды.`;
}

function renderFightText(
  kills: number,
  deaths: number,
  assists: number,
  respawnSeconds: number | undefined,
): string {
  const respawnNote = deaths > 0 ? ` Респаун через ${respawnSeconds ?? 0}с.` : "";
  return `Была стычка: убийств ${kills}, смертей ${deaths}, ассистов ${assists}. Счёт сейчас ${scoreKda()}.${respawnNote}` +
    ` Дай короткий итог по драке${deaths > 0 ? " и совет на будущее" : ""}.`;
}

function fireInstantScoreInsight(kind: ScoreKind, level?: number, respawnSeconds?: number): void {
  const render =
    kind === "kill" ? renderKillText :
    kind === "assist" ? renderAssistText :
    () => renderDeathText(level, respawnSeconds);
  registerScoreInsight(addInsight("score_change_instant", render()), render);
}

export function handleScoreEvent(kind: ScoreKind, level?: number, respawnSeconds?: number): void {
  const now = Date.now();
  const onCooldown = now - lastInstantFiredMs < SCORE_INSTANT_COOLDOWN_MS;
  // A batch is already accumulating (e.g. this tick's kill lost its own coin
  // flip and got buffered) — join it instead of rolling a separate instant,
  // otherwise the buffered event ends up orphaned or merged into an unrelated
  // later batch once its deadline keeps getting extended.
  const batchInProgress = scoreBuffer.length > 0;

  let instantFired = false;
  if (!onCooldown && !batchInProgress && Math.random() < SCORE_INSTANT_CHANCE) {
    lastInstantFiredMs = now;
    fireInstantScoreInsight(kind, level, respawnSeconds);
    instantFired = true;
  }

  // Buffer every event, even one already announced instantly — that way a
  // kill that fired instant still counts toward a later fight report instead
  // of vanishing from the tally once more events roll in.
  bufferScoreEvent({ type: kind, level, respawnSeconds, instantFired });
}

function bufferScoreEvent(event: ScoreEvent): void {
  scoreBuffer.push(event);

  const now = Date.now();
  scoreBufferDeadline = scoreBufferDeadline === null
    ? now + SCORE_BUFFER_WINDOW_MS
    : Math.min(scoreBufferDeadline + SCORE_BUFFER_EXTENSION_MS, now + SCORE_BUFFER_WINDOW_MS);

  if (scoreBufferTimer) clearTimeout(scoreBufferTimer);
  scoreBufferTimer = setTimeout(flushScoreBuffer, scoreBufferDeadline - now);
}

function flushScoreBuffer(): void {
  scoreBufferTimer = null;
  scoreBufferDeadline = null;
  if (scoreBuffer.length === 0) return;

  const batch = scoreBuffer;
  scoreBuffer = [];

  const kills = batch.filter((e) => e.type === "kill").length;
  const deaths = batch.filter((e) => e.type === "death").length;
  const assists = batch.filter((e) => e.type === "assist").length;
  const last = batch[batch.length - 1];
  if (!last) return;

  // A lone event that already got its instant callout doesn't need a delayed
  // repeat, and a lone kill/assist that missed its coin flip already had its
  // shot — either way it collapses without a follow-up report.
  if (batch.length === 1 && (last.instantFired || last.type === "kill" || last.type === "assist")) return;

  if (batch.length === 1) {
    const render = () => renderDeathText(last.level, last.respawnSeconds);
    registerScoreInsight(addInsight("score_change", render()), render);
    return;
  }

  const render = () => renderFightText(kills, deaths, assists, last.respawnSeconds);
  registerScoreInsight(addInsight("score_change", render()), render);
}

export function clearScoreInsightState(): void {
  if (scoreBufferTimer) {
    clearTimeout(scoreBufferTimer);
    scoreBufferTimer = null;
  }
  scoreBuffer = [];
  scoreBufferDeadline = null;
  pendingScoreInsights.length = 0;
  liveScore = { kills: 0, deaths: 0, assists: 0 };
  lastInstantFiredMs = 0;
}
