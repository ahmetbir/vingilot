// The Runs screen's left rail: NEEDS YOU / LIVE / RECENT groups (design 7c),
// plus the "+ New run" row that opens the Deck. `ModeChip` and `StatusDot`
// are exported here (not a separate file) because DeckPane and RunDetail
// both need the identical glyphs — same reason the donor kept `ModeChip`
// inside `shell/RunRail.tsx` rather than a standalone module.
//
// Restyled from vingilot/workbench/src/shell/RunRail.tsx (ADR-001's
// 2026-08-03 reversal) — the sibling app is donor code once this lands.

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

interface RunListProps {
  runs: RunSummary[];
  activeRunId: string | null;
  onSelectRun: (id: string) => void;
  onSelectDeck: () => void;
  /** When set, the control plane is unreachable and `runs` is the last-good
   * poll rather than live data — every row gets stamped "as of <t>" so that
   * distinction is never silent (design 7c). */
  staleAsOf: Date | null;
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
  onSelectDeck,
  onSelectRun,
  runs,
  staleAsOf,
}: RunListProps) {
  const groups = railGroups(runs);

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

      {runs.length === 0 ? (
        <p className="px-2 py-6 text-center text-xs text-muted-foreground">
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
                {items.map((run) => (
                  <li key={run.id}>
                    <button
                      className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors ${
                        run.id === activeRunId
                          ? "bg-muted text-foreground"
                          : "text-muted-foreground hover:bg-muted/60"
                      }`}
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
                    <p className="pl-6 pr-2 text-3xs text-muted-foreground/70">
                      {rowMeta(run)}
                      {staleAsOf !== null
                        ? ` · as of ${staleAsOf.toLocaleTimeString()}`
                        : ""}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}
    </div>
  );
}
