// Pure logic for the unreachable lane (design 7c): once the control plane
// flips unreachable, the lane needs a "since <t>" and a ticking "next retry
// in Ns" countdown. Both are pure functions of (now, since, intervalMs) so
// they're testable without real timers — App.tsx supplies the wall-clock
// `now` (already re-rendering every poll tick) and the moment reachability
// first flipped false.

export interface UnreachableView {
  since: Date;
  nextRetrySecs: number;
}

/** usePolling retries at a fixed cadence (`intervalMs`) regardless of
 * reachability — the countdown here is just "time until the next tick",
 * computed from how far `now` is past `since` modulo that cadence. Returns
 * null when reachable (nothing to render) or when `since` is unknown. */
export function unreachableView(
  reachable: boolean,
  since: Date | null,
  now: Date,
  intervalMs: number,
): UnreachableView | null {
  if (reachable || since === null) return null;
  if (intervalMs <= 0) return { since, nextRetrySecs: 0 };

  const elapsedMs = Math.max(0, now.getTime() - since.getTime());
  const remainderMs = intervalMs - (elapsedMs % intervalMs);
  const nextRetrySecs = Math.ceil(remainderMs / 1000);
  return { since, nextRetrySecs };
}
