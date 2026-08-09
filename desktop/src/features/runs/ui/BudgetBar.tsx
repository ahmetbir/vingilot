// Budget honesty, rendered (ADR-002 amendments): wall clock is the
// ENFORCEABLE budget — a solid meter, because the reconciler pauses the run
// at the cap. Tokens are OBSERVED only — a dashed, `≈`-prefixed chip with an
// observed-lag caption, never a meter. Renders nothing when neither has
// data — a capability with no data renders nothing, not zero.
//
// Restyled from vingilot/workbench/src/run/BudgetBar.tsx (ADR-001's
// 2026-08-03 reversal) — the sibling app is donor code once this lands.

import { budgetView } from "@/features/runs/lib/budget";
import type { RunSummary } from "@/features/runs/lib/runModel";

interface BudgetBarProps {
  run: RunSummary;
  now: Date;
}

export function BudgetBar({ now, run }: BudgetBarProps) {
  const view = budgetView(run, now);
  if (view.wall === null && view.tokens === null) return null;

  return (
    <div className="flex flex-col gap-2" data-testid="budget-bar">
      {view.wall !== null ? (
        <div
          className="flex items-center gap-2"
          title="wall clock budget — enforced"
        >
          <span className="w-12 shrink-0 text-3xs uppercase tracking-[0.14em] text-muted-foreground">
            wall
          </span>
          <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
            <span
              className="block h-full rounded-full bg-primary"
              style={{ width: `${Math.round(view.wall.pct * 100)}%` }}
            />
          </span>
          <span className="shrink-0 text-2xs text-muted-foreground">
            {view.wall.label}
          </span>
        </div>
      ) : null}
      {view.tokens !== null ? (
        <div
          className="flex items-center gap-2"
          title="token budget — observed only, not enforced"
        >
          <span className="w-12 shrink-0 text-3xs uppercase tracking-[0.14em] text-muted-foreground">
            tokens
          </span>
          <span className="rounded-full border border-dashed border-border px-2 py-0.5 text-2xs text-muted-foreground">
            {view.tokens.label}
          </span>
        </div>
      ) : null}
    </div>
  );
}
