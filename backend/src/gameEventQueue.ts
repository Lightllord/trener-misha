import { diffStates, type GameEvent } from "./stateDiff.js";
import { getState } from "./gameData.js";

const THROTTLE_MS = 30_000;
const FALLBACK_MS = 120_000;

let eventBuffer: GameEvent[] = [];
let lastDeliveryTime = 0;
let fallbackTimer: ReturnType<typeof setInterval> | null = null;

export function processStateUpdate(
  prev: Record<string, unknown>,
  curr: Record<string, unknown>,
): void {
  const events = diffStates(prev, curr);
  if (events.length > 0) {
    eventBuffer.push(...events);
    for (const e of events) {
      console.log(`[events] ${e.type} (p${e.priority}): ${e.summary}`);
    }
  }
}

/**
 * Returns formatted event string if ready to deliver, null otherwise.
 * Also returns whether a response should be triggered.
 */
export function takeEvents(): { text: string; triggerResponse: boolean } | null {
  const now = Date.now();
  const timeSinceLastDelivery = now - lastDeliveryTime;

  if (eventBuffer.length === 0) return null;

  const hasCritical = eventBuffer.some((e) => e.priority === 1);

  // Throttle: wait 30s unless there's a critical event
  if (timeSinceLastDelivery < THROTTLE_MS && !hasCritical) return null;

  const summaries = eventBuffer.map((e) => `• ${e.summary}`).join("\n");
  const text = `[Игровые события]\n${summaries}\n\nПрокомментируй кратко (1-2 предложения), дай совет если есть.`;

  eventBuffer = [];
  lastDeliveryTime = now;

  return { text, triggerResponse: true };
}

/**
 * Generate a fallback status summary from current state.
 * Returns null if no active game or too soon.
 */
export function takeFallbackStatus(): { text: string; triggerResponse: boolean } | null {
  const now = Date.now();
  if (now - lastDeliveryTime < FALLBACK_MS) return null;

  const state = getState() as Record<string, unknown> | null;
  if (!state) return null;

  const clockTime = state.clockTime as number | undefined;
  const score = state.score as { radiant?: number; dire?: number } | undefined;
  const player = state.player as { kills?: number; deaths?: number; assists?: number; gpm?: number; team?: string } | undefined;
  const hero = state.hero as { level?: number; name?: string } | undefined;
  const inventory = state.inventory as { main?: Array<{ name?: string }> } | undefined;

  if (!clockTime || !player) return null;

  const minutes = Math.floor(clockTime / 60);
  const seconds = clockTime % 60;
  const time = `${minutes}:${String(seconds).padStart(2, "0")}`;
  const kda = `${player.kills ?? 0}/${player.deaths ?? 0}/${player.assists ?? 0}`;
  const items = (inventory?.main ?? [])
    .map((i) => i.name)
    .filter((n) => n && n !== "empty")
    .map((n) => (n as string).replace(/^item_/, "").replaceAll("_", " "))
    .join(", ");

  const parts = [
    `Время: ${time}`,
    `счёт ${score?.radiant ?? 0}-${score?.dire ?? 0}`,
    `Ты: ${kda}`,
    `GPM ${player.gpm ?? 0}`,
    `уровень ${hero?.level ?? 0}`,
  ];
  if (items) parts.push(`Предметы: ${items}`);

  const text = `[Состояние матча]\n${parts.join(", ")}.`;

  lastDeliveryTime = now;

  return { text, triggerResponse: false };
}

export function startFallbackTimer(deliverFn: () => void): void {
  stopFallbackTimer();
  fallbackTimer = setInterval(deliverFn, FALLBACK_MS);
}

export function stopFallbackTimer(): void {
  if (fallbackTimer) {
    clearInterval(fallbackTimer);
    fallbackTimer = null;
  }
}

export function clearEventQueue(): void {
  eventBuffer = [];
  lastDeliveryTime = 0;
  stopFallbackTimer();
}
