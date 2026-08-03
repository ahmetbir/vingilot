// Scoped to the Runs screen (not global chrome, design 7c): a persistent,
// non-dismissible banner while the control plane is unreachable. Clears
// itself the instant reachable flips back true — there is no manual
// dismiss, because the state it reports isn't something the user can wave
// away. V1 queues nothing: new Runs and transitions are disabled elsewhere
// (DeckPane, RunDetail) while this is up, and the banner says so in words
// rather than pretending a write queue exists.
//
// Restyled from vingilot/workbench/src/system/Unreachable.tsx (ADR-001's
// 2026-08-03 reversal) — the sibling app is donor code once this lands.

import { unreachableView } from "@/features/runs/lib/reachability";

interface UnreachableBannerProps {
  reachable: boolean;
  since: Date | null;
  now: Date;
  intervalMs: number;
  onRetryNow: () => void;
}

export function UnreachableBanner({
  intervalMs,
  now,
  onRetryNow,
  reachable,
  since,
}: UnreachableBannerProps) {
  const view = unreachableView(reachable, since, now, intervalMs);
  if (view === null) return null;

  return (
    <div
      aria-live="assertive"
      className="mx-2 mb-2 mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
      data-testid="unreachable-banner"
      role="alert"
    >
      <span aria-hidden="true">⚠</span>
      <span className="min-w-0 flex-1">
        control plane unreachable — read-only since{" "}
        {view.since.toLocaleTimeString()} · new runs and transitions disabled ·
        retrying, next in {view.nextRetrySecs}s
      </span>
      <button
        className="shrink-0 rounded-full border border-destructive/50 px-2 py-0.5 text-2xs font-medium hover:bg-destructive/10"
        onClick={onRetryNow}
        type="button"
      >
        Retry now
      </button>
    </div>
  );
}
