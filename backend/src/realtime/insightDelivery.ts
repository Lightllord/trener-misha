import type { ConversationEntry } from "../conversation/types/log.js";
import { DebouncedPoll } from "../deliveryWindow/debouncedPoll.js";
import { InsightPicker } from "../insight/picker.js";
import { log } from "../observability/log.js";
import type { SessionConductor } from "./sessionConductor.js";

// The insight delivery lane: a single DebouncedPoll over the conductor's window
// that, per tick, asks the picker for something to say and injects it. The poll
// has no stop — it dies when the window is disposed (via conductor.dispose).
export class InsightDelivery {
  private readonly picker: InsightPicker;

  constructor(
    private readonly conductor: SessionConductor,
    signal: AbortSignal,
    getDialogue: () => readonly ConversationEntry[],
  ) {
    this.picker = new InsightPicker(signal, getDialogue);
  }

  start(): void {
    new DebouncedPoll(this.conductor.window, () => this.tryDeliver());
  }

  private tryDeliver(): void {
    const state = this.conductor.window.state();
    if (state === "closed") return;
    const insight = this.picker.getSomethingToDeliverNow(state === "interrupt");
    if (insight === null) return;
    const tail = insight.number !== null ? ` #${insight.number}` : "";
    log(
      "inject",
      `deliver insight ${insight.name}${tail} [${insight.importance}] (band: ${state})`,
    );
    this.conductor.injectMessage(this.picker.formatForInjection(insight), true);
  }
}
