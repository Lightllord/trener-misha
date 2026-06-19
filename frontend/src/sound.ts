// Short UI cue tones for mic open/close. Reuses a single AudioContext, created
// lazily on the first cue (always triggered by a user gesture, so autoplay
// policy is satisfied).
let ctx: AudioContext | null = null;

export function playCue(kind: "on" | "off"): void {
  if (ctx === null) ctx = new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();

  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = "sine";
  osc.frequency.value = kind === "on" ? 880 : 440;

  // Quick blip with a soft attack/decay so it doesn't click.
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.15, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);

  osc.connect(gain).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.13);
}
