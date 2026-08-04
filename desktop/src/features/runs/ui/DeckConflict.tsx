// The Deck pin conflict banner: what a CAS 409 looks like to a human. Per
// ADR-002 (and vingilot/docs/plans/2026-08-04-deck-phase-3.md's "UI"
// section), a lost race is never silently retried into an overwrite — it is
// shown, with what actually changed (via `pinsDiff`) and two honest choices:
// accept the winner's set, or rebase the local intent onto the revision
// that just won and try again.

import { pinsDiff } from "@/features/runs/lib/deckPins";
import type { Pin } from "@/features/runs/lib/deckPins";
import type { RunSummary } from "@/features/runs/lib/runModel";
import { Button } from "@/shared/ui/button";

export interface DeckConflictProps {
  /** The pin set this device attempted to write. */
  mine: Pin[];
  /** The pin set that actually won, read fresh after the 409. */
  theirs: Pin[];
  /** The revision `theirs` is at — the revision a re-apply rebases onto. */
  revision: number;
  /** For rendering a pin id as the run's objective when known. */
  runs: RunSummary[];
  reapplying: boolean;
  onKeepTheirs: () => void;
  onReapply: () => void;
}

function pinLabel(pin: Pin, runs: RunSummary[]): string {
  const run = runs.find((r) => r.id === pin.id);
  return run ? run.objective : pin.id;
}

export function DeckConflict({
  mine,
  onKeepTheirs,
  onReapply,
  reapplying,
  revision,
  runs,
  theirs,
}: DeckConflictProps) {
  const { added, removed } = pinsDiff(mine, theirs);

  return (
    <div
      className="flex flex-col gap-2 rounded-2xl border border-amber-500/50 bg-amber-500/10 p-3 text-sm"
      data-testid="deck-conflict"
      role="alert"
    >
      <p className="font-medium">
        your pin didn't apply — rev {revision} changed the pinned set first
      </p>
      {added.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          added there: {added.map((pin) => pinLabel(pin, runs)).join(", ")}
        </p>
      ) : null}
      {removed.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          removed there: {removed.map((pin) => pinLabel(pin, runs)).join(", ")}
        </p>
      ) : null}
      <div className="flex items-center gap-2">
        <Button onClick={onKeepTheirs} size="sm" variant="outline">
          Keep theirs
        </Button>
        <Button disabled={reapplying} onClick={onReapply} size="sm">
          {reapplying ? "Re-applying…" : "Re-apply mine on top"}
        </Button>
      </div>
    </div>
  );
}
