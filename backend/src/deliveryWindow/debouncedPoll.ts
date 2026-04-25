import type { DeliveryWindow } from "./deliveryWindow.js";

export interface DebouncedPollOptions {
  debounceMs?: number;
  pollMs?: number;
}

// Subscribes to a DeliveryWindow. While the window is open: waits debounceMs
// (anti-flap), fires once, then polls every pollMs. Any close cancels both
// timers via the subscription callback. Lifecycle is owned by the window —
// `window.dispose()` notifies subscribers with isOpen=false, which lands here
// and cancels the timers. No public stop method.
export class DebouncedPoll {
  private readonly debounceMs: number;
  private readonly pollMs: number;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly window: DeliveryWindow,
    private readonly onFire: () => void,
    options: DebouncedPollOptions = {},
  ) {
    this.debounceMs = options.debounceMs ?? 300;
    this.pollMs = options.pollMs ?? 3_000;

    window.subscribe((isOpen) => {
      if (isOpen) this.arm();
      else this.cancel();
    });

    if (window.isOpen()) this.arm();
  }

  private arm(): void {
    if (!this.window.isOpen()) return;
    if (this.debounceTimer !== null || this.pollTimer !== null) return;
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      if (!this.window.isOpen()) return;
      this.fire();
      this.pollTimer = setInterval(() => {
        if (!this.window.isOpen()) {
          this.cancel();
          return;
        }
        this.fire();
      }, this.pollMs);
    }, this.debounceMs);
  }

  private cancel(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private fire(): void {
    try {
      this.onFire();
    } catch (err) {
      console.error("[debouncedPoll] callback failed:", err);
    }
  }
}
