import type { RunSummary } from "../model/run.ts";
import { budgetView } from "./budget.ts";

interface BudgetBarProps {
  run: RunSummary;
  now: Date;
}

/** Budget honesty, rendered (ADR-002 amendments): wall clock is the
 * ENFORCEABLE budget — a solid meter, because the reconciler pauses the run
 * at the cap. Tokens are OBSERVED only — a dashed `≈`-prefixed readout with
 * an observed-lag caption, and it is not a meter at all (renders nothing)
 * when `tokens_observed_at` is null: a capability with no data renders
 * nothing, not zero. */
export function BudgetBar({ run, now }: BudgetBarProps) {
  const view = budgetView(run, now);
  if (view.wall === null && view.tokens === null) return null;

  return (
    <div className="vg-budget">
      {view.wall !== null && (
        <div className="vg-budget__row" aria-label="wall clock budget — enforced">
          <span className="vg-budget__kind">wall</span>
          <span className="vg-budget__track">
            <span
              className="vg-budget__fill vg-budget__fill--wall"
              style={{ width: `${Math.round(view.wall.pct * 100)}%` }}
            />
          </span>
          <span className="vg-budget__label">{view.wall.label}</span>
        </div>
      )}
      {view.tokens !== null && (
        <div className="vg-budget__row" aria-label="token budget — observed only, not enforced">
          <span className="vg-budget__kind">tokens</span>
          <span className="chip chip--stated vg-budget__tokens">{view.tokens.label}</span>
        </div>
      )}
    </div>
  );
}
