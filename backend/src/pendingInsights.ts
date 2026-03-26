let pending: string | null = null;

export function setPending(insight: string): void {
  pending = insight;
}

export function takePending(): string | null {
  const value = pending;
  pending = null;
  return value;
}

export function clearPending(): void {
  pending = null;
}
