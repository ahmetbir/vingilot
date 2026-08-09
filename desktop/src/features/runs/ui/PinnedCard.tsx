// A single card in Deck's PINNED region — either a placed card (this
// device's local order), an unplaced card (a pin that arrived from another
// device with no local placement yet — the design's arriving-card
// affordance), or a tombstone (the pinned subject no longer exists). See
// vingilot/docs/plans/2026-08-04-deck-phase-3.md, "UI" section.
//
// Card content is objective, status chip, mode chip, and — when the run has
// produced work — the artifact commit sha and its +N/-M diff stat, fetched
// lazily per card from the run's own evidence. A run with no commit/diff
// evidence yet renders without that row entirely (a capability with no data
// renders nothing, not a zero).

import * as React from "react";

import { listEvidence } from "@/features/runs/lib/coordinatorClient";
import type { Pin } from "@/features/runs/lib/deckPins";
import { diffView } from "@/features/runs/lib/runModel";
import type { RunSummary } from "@/features/runs/lib/runModel";
import { ModeChip, StatusDot } from "@/features/runs/ui/RunList";
import { Button } from "@/shared/ui/button";
import { isRenderableKind } from "@/features/runs/lib/deckPins";

interface Artifact {
  commitSha: string | null;
  added: number;
  removed: number;
}

/** Fetches the run's evidence once and derives the latest commit sha and
 * diff +/- counts from it. Never polls — a pinned card's artifact summary
 * is a snapshot, not a live meter. `null` while unknown or when the run has
 * produced no commit/diff evidence yet. */
function useRunArtifact(runId: string | undefined): Artifact | null {
  const [artifact, setArtifact] = React.useState<Artifact | null>(null);

  React.useEffect(() => {
    setArtifact(null);
    if (runId === undefined) return;
    let cancelled = false;
    void listEvidence(runId).then((result) => {
      if (cancelled || !result.ok) return;
      const commitRows = result.value.filter((row) => row.kind === "commit");
      const diffRows = result.value.filter((row) => row.kind === "diff");
      if (commitRows.length === 0 && diffRows.length === 0) return;
      const latestCommit =
        commitRows.length > 0
          ? commitRows.reduce((a, b) => (b.seq > a.seq ? b : a))
          : null;
      const latestDiff =
        diffRows.length > 0
          ? diffRows.reduce((a, b) => (b.seq > a.seq ? b : a))
          : null;
      const { lines } = latestDiff
        ? diffView(latestDiff.content)
        : { lines: [] };
      setArtifact({
        added: lines.filter((line) => line.kind === "add").length,
        commitSha: latestCommit ? latestCommit.content : null,
        removed: lines.filter((line) => line.kind === "del").length,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [runId]);

  return artifact;
}

export interface PinnedCardProps {
  pin: Pin;
  /** `undefined` means the pinned subject is gone — renders a tombstone. */
  run: RunSummary | undefined;
  /** True when this pin has no local placement yet (arrived from another
   * device) — dashed border, arrival caption, and a Place action. */
  unplaced: boolean;
  /** True while the control plane is unreachable — every action disables
   * with the reason shown once at the PINNED region header, not repeated
   * per card. */
  disabled: boolean;
  /** True while this specific pin's write is in flight. */
  pending: boolean;
  onOpenRun: (id: string) => void;
  onUnpin: (id: string) => void;
  onMoveLeft: (id: string) => void;
  onMoveRight: (id: string) => void;
  onPlace: (id: string) => void;
}

export function PinnedCard({
  disabled,
  onMoveLeft,
  onMoveRight,
  onOpenRun,
  onPlace,
  onUnpin,
  pending,
  pin,
  run,
  unplaced,
}: PinnedCardProps) {
  const artifact = useRunArtifact(run?.id);

  // A pin whose kind this client cannot render is NOT a tombstone: the pin is
  // valid and another client shows it. Saying "no longer available" next to an
  // unpin button would invite the owner to destroy good state on false
  // information — so it says what is actually true and offers no unpin.
  if (!isRenderableKind(pin.kind)) {
    return (
      <div
        className="flex flex-col gap-1 rounded-2xl border border-dashed border-border bg-card/50 p-3"
        data-testid={`pinned-card-${pin.id}`}
      >
        <p className="text-sm text-muted-foreground">
          pinned {pin.kind} — this version can't show it
        </p>
        <p className="text-2xs text-muted-foreground/70">
          kept as-is so another client keeps rendering it
        </p>
      </div>
    );
  }

  if (run === undefined) {
    return (
      <div
        className="flex flex-col gap-2 rounded-2xl border border-dashed border-destructive/40 bg-card/50 p-3"
        data-testid={`pinned-card-${pin.id}`}
      >
        <p className="text-sm text-muted-foreground">no longer available</p>
        <Button
          className="self-start"
          data-testid={`pin-${pin.id}`}
          disabled={disabled || pending}
          onClick={() => onUnpin(pin.id)}
          size="xs"
          variant="outline"
        >
          unpin
        </Button>
      </div>
    );
  }

  function handleTitleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (unplaced) return;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      onMoveLeft(pin.id);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      onMoveRight(pin.id);
    }
  }

  return (
    <div
      className={`flex flex-col gap-2 rounded-2xl border p-3 ${
        unplaced
          ? "border-dashed border-border/70 bg-card/50"
          : "border-border/70 bg-card/80"
      }`}
      data-testid={`pinned-card-${pin.id}`}
    >
      <div className="flex items-start justify-between gap-2">
        <button
          className="min-w-0 flex-1 truncate text-left text-sm font-medium hover:underline"
          onClick={() => onOpenRun(run.id)}
          onKeyDown={handleTitleKeyDown}
          type="button"
        >
          {run.objective}
        </button>
        <Button
          data-testid={`pin-${run.id}`}
          disabled={disabled || pending}
          onClick={() => onUnpin(run.id)}
          size="icon-xs"
          variant="ghost"
        >
          <span aria-hidden="true">✕</span>
          <span className="sr-only">unpin</span>
        </Button>
      </div>

      <div className="flex items-center gap-2 text-2xs text-muted-foreground">
        <StatusDot status={run.status} />
        <span>{run.status}</span>
        <ModeChip mode={run.mode} />
      </div>

      {artifact !== null ? (
        <div className="flex items-center gap-2 text-2xs text-muted-foreground">
          {artifact.commitSha !== null ? (
            <span className="font-mono">{artifact.commitSha.slice(0, 7)}</span>
          ) : null}
          {artifact.added > 0 || artifact.removed > 0 ? (
            <span>
              <span className="text-emerald-600 dark:text-emerald-400">
                +{artifact.added}
              </span>{" "}
              <span className="text-destructive">-{artifact.removed}</span>
            </span>
          ) : null}
        </div>
      ) : null}

      {unplaced ? (
        <>
          <p className="text-2xs text-muted-foreground/70">
            pinned on another device — place it where you like
          </p>
          <Button
            className="self-start"
            data-testid={`place-${pin.id}`}
            disabled={disabled}
            onClick={() => onPlace(pin.id)}
            size="xs"
            variant="outline"
          >
            Place
          </Button>
        </>
      ) : (
        <div className="flex items-center gap-1">
          <Button
            data-testid={`move-left-${pin.id}`}
            disabled={disabled}
            onClick={() => onMoveLeft(pin.id)}
            size="icon-xs"
            variant="ghost"
          >
            <span aria-hidden="true">‹</span>
            <span className="sr-only">move left</span>
          </Button>
          <Button
            data-testid={`move-right-${pin.id}`}
            disabled={disabled}
            onClick={() => onMoveRight(pin.id)}
            size="icon-xs"
            variant="ghost"
          >
            <span aria-hidden="true">›</span>
            <span className="sr-only">move right</span>
          </Button>
        </div>
      )}
    </div>
  );
}
