// The rail of WorkSurface's Runs tab: NEEDS YOU / LIVE / RECENT groups
// (design 7c), plus the "+ New run" row that opens the Deck beside it. It was
// the Projects screen's own left rail until that column became the project
// list. `ModeChip` and `StatusDot`
// are exported here (not a separate file) because DeckPane and RunDetail
// both need the identical glyphs — same reason the donor kept `ModeChip`
// inside `shell/RunRail.tsx` rather than a standalone module.
//
// Phase 3 (vingilot/docs/plans/2026-08-04-deck-phase-3.md) adds a pin toggle
// per row. RunList polls the workspace's pin set independently of DeckPane —
// two decoupled readers of the same CAS state rather than state lifted
// through RunsScreen, so neither view depends on the other's presence. What
// is NOT decided here is how often to ask and what to say when the answer
// stops coming: both arrive as props, because those are facts about the
// machine rather than about this list, and two components answering them
// apart is how the workspace ended up hammering a port it had already told
// the owner was not there. A
// 409 from a row's toggle is shown inline on that row, never silently
// retried into an overwrite; DeckPane's PINNED region carries the full
// conflict UX (`DeckConflict`) for pins toggled there.

import * as React from "react";

import { getWorkspace } from "@/features/runs/lib/coordinatorClient";
import { readPins, withPin, withoutPin } from "@/features/runs/lib/deckPins";
import { syncPins } from "@/features/runs/lib/deckSync";
import {
  railGroups,
  statusClass,
  wallClock,
} from "@/features/runs/lib/runModel";
import type {
  RunMode,
  RunStatus,
  RunSummary,
  SemanticClass,
} from "@/features/runs/lib/runModel";
import {
  type ControlPlaneKind,
  pinsUnavailableNote,
} from "@/features/runs/lib/reachability";
import { usePolling } from "@/features/runs/lib/usePolling";

interface RunListProps {
  runs: RunSummary[];
  activeRunId: string | null;
  onSelectRun: (id: string) => void;
  onSelectDeck: () => void;
  /** Why the row toggles are inert, in the host's words rather than a reading
   * this list takes for itself — see the note in the body. */
  controlPlane: ControlPlaneKind;
  /** The cadence the pin poll below runs at, decided by the host from
   * `controlPlane` (`lib/reachability.ts`). A list on its own 2s timer would
   * keep hammering a port nothing is listening on after the workspace had
   * settled to 30s. */
  pollMs: number;
  /** Workspace whose `deck.pins` this list reads/writes for its row toggles. */
  workspaceId: string;
}

const GROUP_LABELS = {
  needsYou: "NEEDS YOU",
  live: "LIVE",
  recent: "RECENT",
} as const;

const GROUP_KEYS = ["needsYou", "live", "recent"] as const;

const SEMANTIC_DOT_CLASS: Record<SemanticClass, string> = {
  live: "bg-emerald-500 motion-safe:animate-pulse",
  ok: "bg-emerald-500",
  attn: "bg-amber-500",
  stop: "bg-destructive",
  muted: "bg-muted-foreground/40",
};

export function StatusDot({ status }: { status: RunStatus }) {
  return (
    <span
      aria-hidden="true"
      className={`h-2 w-2 shrink-0 rounded-full ${SEMANTIC_DOT_CLASS[statusClass(status)]}`}
    />
  );
}

/** Mode chip form rule (ADR-002/003): delegated runs hold real worktree
 * grants — enforced, a solid-border chip. Interactive runs claim a
 * worktree without enforcement — stated, a dashed-border chip. Chat has no
 * grants at all, so it renders no chip — the absent-capability case. */
export function ModeChip({ mode }: { mode: RunMode }) {
  if (mode === "delegated") {
    return (
      <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-2xs uppercase tracking-wide text-muted-foreground">
        acp
      </span>
    );
  }
  if (mode === "interactive") {
    return (
      <span className="shrink-0 rounded-full border border-dashed border-border px-2 py-0.5 text-2xs uppercase tracking-wide text-muted-foreground">
        int
      </span>
    );
  }
  return null;
}

function rowMeta(run: RunSummary): string {
  const wc = wallClock(run, new Date());
  if (wc !== null) {
    return wc.limitSecs !== null
      ? `${wc.spentSecs}s / ${wc.limitSecs}s`
      : `${wc.spentSecs}s`;
  }
  return run.status;
}

export function RunList({
  activeRunId,
  controlPlane,
  onSelectDeck,
  onSelectRun,
  pollMs,
  runs,
  workspaceId,
}: RunListProps) {
  const groups = railGroups(runs);

  const fetchWorkspace = React.useCallback(
    () => getWorkspace(workspaceId),
    [workspaceId],
  );
  const { data: snapshot, reachable: pinsReachable } = usePolling(
    fetchWorkspace,
    pollMs,
  );
  // Why the toggles are inert, in the words that fit this machine: a
  // coordinator that stopped answering and one that was never here are not
  // the same sentence (`lib/reachability.ts`, Task 2). The state comes from
  // the host rather than from this poll — this poll knows whether its own last
  // tick landed, which is what disables the toggles below, but a *sentence*
  // derived here would tick on its own offset and could contradict the banner
  // for as long as a settled cadence.
  const pinsNote = pinsUnavailableNote(controlPlane);
  const pinnedIds = React.useMemo(
    () => new Set(readPins(snapshot ? snapshot.state : null).map((p) => p.id)),
    [snapshot],
  );
  const [pendingIds, setPendingIds] = React.useState<Set<string>>(new Set());
  const [rowError, setRowError] = React.useState<{
    id: string;
    message: string;
  } | null>(null);

  async function togglePin(id: string) {
    const isPinned = pinnedIds.has(id);
    setPendingIds((prev) => new Set(prev).add(id));
    setRowError((prev) => (prev?.id === id ? null : prev));
    const result = await syncPins(workspaceId, (current) =>
      isPinned
        ? withoutPin(current, id)
        : withPin(current, {
            id,
            kind: "run",
            pinnedAt: new Date().toISOString(),
          }),
    );
    setPendingIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    if (result.kind === "conflict") {
      setRowError({
        id,
        message: `pin didn't apply — rev ${result.revision} changed first`,
      });
    } else if (result.kind === "unreachable") {
      setRowError({ id, message: pinsNote ?? "control plane not answering" });
    } else if (result.kind === "api") {
      setRowError({ id, message: result.detail });
    }
  }

  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2 py-3"
      data-testid="run-list"
    >
      <button
        className={`rounded-lg px-2 py-1.5 text-left text-sm font-medium transition-colors ${
          activeRunId === null
            ? "bg-muted text-foreground"
            : "text-muted-foreground hover:bg-muted/60"
        }`}
        data-testid="run-list-new-run"
        onClick={onSelectDeck}
        type="button"
      >
        + New run
      </button>

      {/* Row pin toggles disable the instant the control plane stops
       * answering (`disabled={!pinsReachable || ...}` below) — before any
       * write is ever attempted, so `rowError` (set inside `togglePin`'s
       * result handling) can't be the reason text for that state. This is
       * the reason: it renders from `pinsReachable` directly, not from a
       * failed attempt. */}
      {pinsNote === null ? null : (
        <p
          className="px-2 py-1 text-sm text-muted-foreground"
          data-testid="run-list-pins-unavailable"
          role="status"
        >
          {pinsNote}
        </p>
      )}

      {runs.length === 0 ? (
        <p className="px-2 py-6 text-center text-sm text-muted-foreground">
          no runs — start one from the Deck
        </p>
      ) : (
        GROUP_KEYS.map((key) => {
          const items = groups[key];
          if (items.length === 0) return null;
          return (
            <section className="mt-2" key={key}>
              <h2 className="flex items-center gap-1.5 px-2 text-3xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {GROUP_LABELS[key]}
                <span className="text-muted-foreground/60">{items.length}</span>
              </h2>
              <ul className="mt-1 flex flex-col gap-0.5">
                {items.map((run) => {
                  const isPinned = pinnedIds.has(run.id);
                  return (
                    <li key={run.id}>
                      <div
                        className={`flex w-full items-center gap-1 rounded-lg pl-2 pr-1 py-1.5 transition-colors ${
                          run.id === activeRunId
                            ? "bg-muted text-foreground"
                            : "text-muted-foreground hover:bg-muted/60"
                        }`}
                      >
                        <button
                          className="flex min-w-0 flex-1 items-center gap-2 text-left"
                          data-testid={`run-row-${run.id}`}
                          onClick={() => onSelectRun(run.id)}
                          type="button"
                        >
                          <StatusDot status={run.status} />
                          <span className="min-w-0 flex-1 truncate text-sm">
                            {run.objective}
                          </span>
                          <ModeChip mode={run.mode} />
                        </button>
                        <button
                          className={`shrink-0 rounded-full border px-1.5 py-0.5 text-2xs disabled:opacity-50 ${
                            isPinned
                              ? "border-primary/50 bg-primary/10 text-primary"
                              : "border-border text-muted-foreground"
                          }`}
                          data-testid={`pin-${run.id}`}
                          disabled={!pinsReachable || pendingIds.has(run.id)}
                          onClick={() => void togglePin(run.id)}
                          type="button"
                        >
                          {isPinned ? "pinned" : "pin"}
                        </button>
                      </div>
                      <p className="pl-6 pr-2 text-2xs text-muted-foreground/70">
                        {rowMeta(run)}
                      </p>
                      {rowError !== null && rowError.id === run.id ? (
                        <p
                          className="pl-6 pr-2 text-2xs text-destructive"
                          role="alert"
                        >
                          {rowError.message}
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })
      )}
    </div>
  );
}
