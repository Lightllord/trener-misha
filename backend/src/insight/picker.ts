import OpenAI from "openai";
import { formatConversationAsXMLike } from "../conversation/markup.js";
import {
  PICKER_MODEL,
  PICKER_REASONING_EFFORT,
  PICKER_SYSTEM_PROMPT,
  PICKER_TIMEOUT_MS,
} from "./consts/picker.js";
import {
  importanceFallback,
  latestCritical,
  resolvePick,
  summarizeForPicker,
} from "./helpers.js";
import {
  buildPickerUserMessage,
  formatInsightForInjection,
  formatInsightsAsPickerXMLike,
} from "./markup.js";
import { getUnused, markUsed } from "./store.js";
import { log, logError } from "../observability/log.js";
import type { ConversationEntry } from "../conversation/types/log.js";
import type { Insight } from "./types/insight.js";

function label(insight: Insight): string {
  return insight.number !== null ? `${insight.name} #${insight.number}` : insight.name;
}

export class InsightPicker {
  private thinkingResult: Insight | null = null;
  private thinkingInFlight = false;
  private injectionCounter = 0;
  private openai: OpenAI | null = null;

  constructor(
    private readonly signal: AbortSignal,
    private readonly getRecentDialogue: () => readonly ConversationEntry[],
  ) {}

  // Returned insight is already marked used — caller is expected to inject.
  // criticalOnly = interrupt band: the model is mid-response, so only a
  // critical insight may barge in; nothing else delivers and no background
  // thinking is scheduled.
  getSomethingToDeliverNow(criticalOnly = false): Insight | null {
    const unused = getUnused();

    const critical = latestCritical(unused);
    if (critical !== null) {
      if (!criticalOnly) this.scheduleThinking(unused);
      markUsed(critical);
      return critical;
    }

    if (criticalOnly) return null;

    const stashed = this.takeThinkingResult();
    if (stashed !== null) {
      this.scheduleThinking(unused);
      markUsed(stashed);
      return stashed;
    }

    if (unused.length === 1) {
      const only = unused[0];
      if (only !== undefined) {
        markUsed(only);
        return only;
      }
    }

    if (unused.length > 1) {
      this.scheduleThinking(unused);
    }
    return null;
  }

  formatForInjection(insight: Insight): string {
    this.injectionCounter += 1;
    return formatInsightForInjection(insight, this.injectionCounter);
  }

  reset(): void {
    this.thinkingResult = null;
    this.thinkingInFlight = false;
    this.injectionCounter = 0;
  }

  // protected so specs subclass and override — no test-only ctor param.
  protected async callModel(
    user: string,
    signal: AbortSignal,
  ): Promise<string> {
    if (this.openai === null) {
      this.openai = new OpenAI();
    }
    const res = await this.openai.chat.completions.create(
      {
        model: PICKER_MODEL,
        reasoning_effort: PICKER_REASONING_EFFORT,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: PICKER_SYSTEM_PROMPT },
          { role: "user", content: user },
        ],
      },
      { signal },
    );
    return res.choices[0]?.message?.content ?? "";
  }

  private takeThinkingResult(): Insight | null {
    const candidate = this.thinkingResult;
    this.thinkingResult = null;
    if (candidate === null) {
      return null;
    }
    if (candidate.used) {
      return null;
    }
    if (!getUnused().includes(candidate)) {
      return null;
    }
    return candidate;
  }

  private scheduleThinking(unused: readonly Insight[]): void {
    if (this.thinkingInFlight) {
      return;
    }
    if (this.thinkingResult !== null) {
      return;
    }

    const candidates = unused.filter((i) => i.importance !== "critical");
    if (candidates.length <= 1) {
      return;
    }

    this.thinkingInFlight = true;
    log("picker", `started thinking — deliberating over ${candidates.length} insights`);

    this.think(candidates)
      .then((chosen) => {
        if (this.signal.aborted) {
          return;
        }
        if (chosen === null) {
          log("picker", "thinking done — nothing to stash");
          return;
        }
        if (chosen.used) {
          return;
        }
        if (!getUnused().includes(chosen)) {
          return;
        }
        this.thinkingResult = chosen;
        log("picker", `thinking done — stashed ${label(chosen)}`);
      })
      .catch((err: unknown) => {
        logError("picker", "thinking failed:", err);
      })
      .finally(() => {
        this.thinkingInFlight = false;
      });
  }

  private async think(
    candidates: readonly Insight[],
  ): Promise<Insight | null> {
    const summary = summarizeForPicker(candidates, Date.now());
    const insightsBlock = formatInsightsAsPickerXMLike(summary);
    const historyBlock = formatConversationAsXMLike(this.getRecentDialogue());
    const userMsg = buildPickerUserMessage(insightsBlock, historyBlock);

    try {
      const timeout = AbortSignal.timeout(PICKER_TIMEOUT_MS);
      const signal = AbortSignal.any([timeout, this.signal]);
      const raw = await this.callModel(userMsg, signal);
      const pick = resolvePick(raw, candidates);
      return pick ?? importanceFallback(candidates);
    } catch (err) {
      logError("picker", "model call failed:", err);
      return importanceFallback(candidates);
    }
  }
}
