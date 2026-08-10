// Scoped to the landing view (not global chrome, design 7c): a persistent,
// non-dismissible line about the control plane. Clears itself the instant one
// answers — there is no manual dismiss, because the state it reports isn't
// something the user can wave away. V1 queues nothing: new Runs and
// transitions are disabled elsewhere (DeckPane, RunDetail) while this is up,
// and the banner says so in words rather than pretending a write queue exists.
//
// **Two states, and telling them apart is the point of this file**
// (vingilot/docs/plans/2026-08-10-coordinator-optional.md, Task 2). The old
// version had one sentence — "control plane unreachable — read-only since
// 2:08:55 PM … retrying, next in 2s" — and on a machine that never had a
// coordinator every clause of it was wrong. Which sentence applies, and what
// each one says, is `lib/reachability.ts`; this component only draws it.
//
// The tone is not decoration. An outage is an `alert`, announced assertively,
// in the destructive colour: something that was working stopped. The absent
// state is a `note`, announced politely, in muted chrome: nothing failed, and
// a machine that never had a control plane has nothing to interrupt anyone
// about. A red box that never goes away is how the owner learned to read this
// banner as a fault to wait out.
//
// Restyled from vingilot/workbench/src/system/Unreachable.tsx (ADR-001's
// 2026-08-03 reversal) — the sibling app is donor code once this lands.

import {
  type ControlPlaneKind,
  controlPlaneBanner,
} from "@/features/runs/lib/reachability";

interface ControlPlaneBannerProps {
  kind: ControlPlaneKind;
  /** When reachability flipped false — the outage sentence's clock. Unused by
   * the absent sentence, which has no failure to date. */
  since: Date | null;
  now: Date;
  /** The cadence the polls are actually running at, so the countdown counts
   * down to a tick that is really coming (`controlPlanePollMs`). */
  intervalMs: number;
  onRetryNow: () => void;
}

export function ControlPlaneBanner({
  intervalMs,
  kind,
  now,
  onRetryNow,
  since,
}: ControlPlaneBannerProps) {
  const banner = controlPlaneBanner(kind, since, now, intervalMs);
  if (banner === null) return null;
  const alert = banner.tone === "alert";

  return (
    <div
      aria-live={alert ? "assertive" : "polite"}
      className={`mx-2 mb-2 mt-2 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
        alert
          ? "border-destructive/40 bg-destructive/10 text-destructive"
          : "border-border/60 bg-muted/40 text-muted-foreground"
      }`}
      data-state={kind}
      data-testid="control-plane-banner"
      role={alert ? "alert" : "status"}
    >
      <span aria-hidden="true">{alert ? "⚠" : "○"}</span>
      <span className="min-w-0 flex-1">{banner.text}</span>
      <button
        className={`shrink-0 rounded-full border px-2 py-0.5 text-2xs font-medium ${
          alert
            ? "border-destructive/50 hover:bg-destructive/10"
            : "border-border/60 hover:bg-muted"
        }`}
        onClick={onRetryNow}
        type="button"
      >
        {banner.action}
      </button>
    </div>
  );
}
