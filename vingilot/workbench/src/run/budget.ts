// Pure Run-view logic: legal next transitions and the budget-honesty
// render-model. No React, no coordinator-client imports — this is the thing
// RunView.tsx and BudgetBar.tsx both consume.

import { wallClock } from "../model/run.ts";
import type { RunStatus, RunSummary } from "../model/run.ts";

/** The exact legal-edge set from the coordinator's `domain.rs`
 * `RunStatus::can_transition_to` (ADR-002 §Run transitions), copied here as
 * data. Any drift between the two tables is a bug — this is the single
 * source the run view's action row derives from, so an illegal action is
 * ABSENT from the UI, never disabled. */
const LEGAL_EDGES: ReadonlyArray<readonly [RunStatus, RunStatus]> = [
  ["draft", "provisioning"],
  ["draft", "cancelled"],
  ["provisioning", "ready"],
  ["provisioning", "failed"],
  ["provisioning", "cancelled"],
  ["ready", "running"],
  ["ready", "cancelled"],
  ["running", "verifying"],
  ["running", "paused"],
  ["running", "blocked"],
  ["running", "failed"],
  ["running", "cancelled"],
  ["verifying", "completed"],
  ["verifying", "running"],
  ["verifying", "blocked"],
  ["verifying", "failed"],
  ["verifying", "cancelled"],
  ["paused", "running"],
  ["paused", "failed"],
  ["paused", "cancelled"],
  ["blocked", "running"],
  ["blocked", "failed"],
  ["blocked", "cancelled"],
];

/** Legal next statuses from `from`. Terminal statuses (completed/failed/
 * cancelled) return an empty array — they have no outgoing edges. */
export function legalNext(from: RunStatus): RunStatus[] {
  return LEGAL_EDGES.filter(([f]) => f === from).map(([, to]) => to);
}

export interface WallBudgetView {
  /** 0..1, clamped at the cap. When there is no cap (`wall_limit_secs` is
   * null) this is always 0 — there is nothing to fill against, only an
   * elapsed-time label. */
  pct: number;
  label: string;
}

export interface TokensBudgetView {
  label: string;
}

export interface BudgetView {
  wall: WallBudgetView | null;
  tokens: TokensBudgetView | null;
}

/** The render-model `BudgetBar` consumes.
 *
 * Wall clock is the ENFORCEABLE budget (ADR-002): it renders once the run
 * has actually started (`wallClock()` already encodes "never started" as
 * null) and is a solid meter — the reconciler pauses the run at the cap.
 *
 * Tokens are OBSERVED, never enforced: the meter renders only once at least
 * one observation has landed. `tokens_observed_at === null` is "no data",
 * not "zero" — a capability with no data renders nothing, not zero, so it
 * is `null` here rather than a meter pinned at 0. */
export function budgetView(run: RunSummary, now: Date): BudgetView {
  const wc = wallClock(run, now);
  const wall: WallBudgetView | null =
    wc === null
      ? null
      : {
          pct: wc.limitSecs === null ? 0 : Math.min(1, wc.spentSecs / wc.limitSecs),
          label: wc.limitSecs === null ? `${wc.spentSecs}s` : `${wc.spentSecs}s / ${wc.limitSecs}s`,
        };

  const tokens: TokensBudgetView | null =
    run.tokens_observed_at === null
      ? null
      : { label: `≈ ${run.tokens_observed} (observed · ${lagLabel(run.tokens_observed_at, now)} ago)` };

  return { wall, tokens };
}

function lagLabel(observedAt: string, now: Date): string {
  const lagSecs = Math.max(0, Math.floor((now.getTime() - new Date(observedAt).getTime()) / 1000));
  return `${lagSecs}s`;
}
