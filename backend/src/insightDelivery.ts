import {
  getAllInsights,
  getUnused,
  markUsed,
} from "./insights.js";
import { latestCritical, pickInsight } from "./insightPicker.js";
import type { Insight } from "./types/insight.js";

export interface DeliveryDeps {
  /** Inject a system message and trigger a response. */
  inject: (text: string) => void;
  /** Return true while an OpenAI response is actively streaming. */
  isResponseActive: () => boolean;
  /** Return the recent voice dialogue formatted for the picker. */
  getRecentDialogue: () => string;
  /** Aborted on connection close to cancel any in-flight picker call. */
  signal: AbortSignal;
  /** Overridable for tests. Default wires through to `pickInsight`. */
  pick?: (
    unused: readonly Insight[],
    opts: { signal: AbortSignal; recentDialogue: string },
  ) => Promise<Insight | null>;
  /** Logger override for tests. Defaults to console. */
  log?: (msg: string) => void;
  /** Error logger override for tests. Defaults to console.error. */
  logError?: (msg: string, err: unknown) => void;
}

export interface InsightDelivery {
  /** Try to deliver an insight now. Returns true iff one was injected synchronously. */
  tryDeliver: () => boolean;
  /** Drop the pending slot. Call on WS disconnect (in addition to aborting the signal). */
  reset: () => void;
}

function isLive(insight: Insight): boolean {
  return getAllInsights().includes(insight);
}

export function createInsightDelivery(deps: DeliveryDeps): InsightDelivery {
  const pick = deps.pick ?? ((unused, opts) => pickInsight(unused, opts));
  const log = deps.log ?? ((msg) => console.log(msg));
  const logError =
    deps.logError ?? ((msg, err) => console.error(msg, err));

  let pending: Insight | null = null;
  let inFlight = false;

  function commit(insight: Insight): void {
    const suffix = insight.number !== null ? ` #${insight.number}` : "";
    log(`[deliver] insight: ${insight.name}${suffix}`);
    deps.inject(insight.payload);
    markUsed(insight); // only after a successful inject
  }

  function tryDeliver(): boolean {
    if (deps.isResponseActive()) return false;

    // Fast path — picker resolved while responseActive was true last turn.
    if (pending && !pending.used && isLive(pending)) {
      const p = pending;
      pending = null;
      commit(p);
      return true;
    }
    pending = null;

    const unused = getUnused();
    if (unused.length === 0) return false;

    if (unused.length === 1) {
      const only = unused[0];
      if (only) commit(only);
      return true;
    }

    // Critical insights bypass the picker model entirely.
    const crit = latestCritical(unused);
    if (crit) {
      commit(crit);
      return true;
    }

    // Async picker path — fire-and-forget; result lands on pending or inject.
    if (inFlight) return false;
    inFlight = true;
    pick(unused, {
      signal: deps.signal,
      recentDialogue: deps.getRecentDialogue(),
    })
      .then((chosen) => {
        if (deps.signal.aborted) return;
        if (!chosen || chosen.used || !isLive(chosen)) return;
        if (deps.isResponseActive()) {
          pending = chosen;
          return;
        }
        commit(chosen);
      })
      .catch((err) => logError("[insightDelivery] picker failed:", err))
      .finally(() => {
        inFlight = false;
      });
    return false;
  }

  function reset(): void {
    pending = null;
    inFlight = false;
  }

  return { tryDeliver, reset };
}
