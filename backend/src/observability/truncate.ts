// Collapse a (possibly multi-line) body to a single line and clip it to `max`
// characters for logging. Bodies injected into history or returned by tools can
// be large; logs only need a recognizable preview, not the full payload.
export function truncate(text: string, max: number): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (oneLine.length <= max) return oneLine;
  return `${oneLine.slice(0, max)}… (+${oneLine.length - max} chars)`;
}
