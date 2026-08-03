// The Deck (design 2e): composer bar creates + provisions a real run, three
// lanes below mirror the rail's grouping as clickable cards. This is the
// Runs screen's default right pane (nothing selected).
//
// Restyled from vingilot/workbench/src/deck/Deck.tsx (ADR-001's 2026-08-03
// reversal) — the sibling app is donor code once this lands.

import * as React from "react";

import { createRun, provisionRun } from "@/features/runs/lib/coordinatorClient";
import { buildProvisionSpec } from "@/features/runs/lib/provisionSpec";
import { railGroups } from "@/features/runs/lib/runModel";
import type { RunMode, RunSummary } from "@/features/runs/lib/runModel";
import { ModeChip, StatusDot } from "@/features/runs/ui/RunList";
import { Button } from "@/shared/ui/button";

const WALL_LIMIT_OPTIONS = [
  { label: "30m", secs: 1800 },
  { label: "2h", secs: 7200 },
  { label: "none", secs: null },
] as const;

type WallLimitLabel = (typeof WALL_LIMIT_OPTIONS)[number]["label"];

interface DeckPaneProps {
  workspaceId: string;
  runs: RunSummary[];
  onOpenRun: (runId: string) => void;
  /** false while the control plane is unreachable — the composer is
   * disabled rather than queuing a write it cannot honestly promise to
   * deliver (design 7c: disabled is honest, a fake queue is not). */
  reachable: boolean;
}

export function DeckPane({
  onOpenRun,
  reachable,
  runs,
  workspaceId,
}: DeckPaneProps) {
  const [objective, setObjective] = React.useState("");
  const [mode, setMode] = React.useState<RunMode>("delegated");
  const [wallLimitLabel, setWallLimitLabel] =
    React.useState<WallLimitLabel>("30m");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const groups = railGroups(runs);
  const composerDisabled = submitting || !reachable;

  async function startRun() {
    const trimmed = objective.trim();
    if (trimmed === "" || composerDisabled) return;
    setSubmitting(true);
    setError(null);

    const wallLimitSecs =
      WALL_LIMIT_OPTIONS.find((o) => o.label === wallLimitLabel)?.secs ?? null;
    const created = await createRun({
      mode,
      objective: trimmed,
      wall_limit_secs: wallLimitSecs,
      workspace_id: workspaceId,
    });
    if (!created.ok) {
      setSubmitting(false);
      setError(
        created.kind === "unreachable"
          ? "control plane unreachable"
          : created.detail,
      );
      return;
    }

    const runId = created.value.run_id;
    const provisioned = await provisionRun(runId, buildProvisionSpec(runId));
    setSubmitting(false);
    if (!provisioned.ok) {
      // The run exists (draft) but provisioning failed — surface the detail
      // rather than silently opening a run with no worktree grant.
      setError(
        provisioned.kind === "unreachable"
          ? "control plane unreachable"
          : provisioned.detail,
      );
      return;
    }

    setObjective("");
    onOpenRun(runId);
  }

  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5"
      data-testid="deck-pane"
    >
      <form
        className="flex flex-wrap items-center gap-2 rounded-2xl border border-border/70 bg-card/80 p-3"
        onSubmit={(event) => {
          event.preventDefault();
          void startRun();
        }}
      >
        <input
          aria-label="objective"
          className="h-9 min-w-0 flex-1 rounded-lg border border-input/40 bg-background px-3 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
          disabled={composerDisabled}
          onChange={(event) => setObjective(event.target.value)}
          placeholder="objective"
          type="text"
          value={objective}
        />
        <select
          aria-label="run mode"
          className="h-9 rounded-lg border border-input/40 bg-background px-2 text-sm disabled:opacity-50"
          disabled={composerDisabled}
          onChange={(event) => setMode(event.target.value as RunMode)}
          value={mode}
        >
          <option value="delegated">delegated</option>
          <option value="interactive">interactive</option>
        </select>
        <select
          aria-label="wall-clock limit"
          className="h-9 rounded-lg border border-input/40 bg-background px-2 text-sm disabled:opacity-50"
          disabled={composerDisabled}
          onChange={(event) =>
            setWallLimitLabel(event.target.value as WallLimitLabel)
          }
          value={wallLimitLabel}
        >
          {WALL_LIMIT_OPTIONS.map((option) => (
            <option key={option.label} value={option.label}>
              {option.label}
            </option>
          ))}
        </select>
        <Button
          disabled={composerDisabled || objective.trim() === ""}
          size="sm"
          type="submit"
        >
          {submitting ? "Starting…" : "Start Run"}
        </Button>
      </form>
      {!reachable ? (
        <p className="text-xs text-muted-foreground" role="status">
          control plane unreachable — Start Run disabled
        </p>
      ) : null}
      {error !== null ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      {runs.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          no runs yet — start one above
        </p>
      ) : (
        <>
          <DeckLane
            onOpenRun={onOpenRun}
            runs={groups.needsYou}
            title="NEEDS YOU"
          />
          <DeckLane onOpenRun={onOpenRun} runs={groups.live} title="LIVE" />
          <DeckLane onOpenRun={onOpenRun} runs={groups.recent} title="RECENT" />
        </>
      )}
    </div>
  );
}

function DeckLane({
  onOpenRun,
  runs,
  title,
}: {
  onOpenRun: (id: string) => void;
  runs: RunSummary[];
  title: string;
}) {
  if (runs.length === 0) return null;
  return (
    <section>
      <h2 className="flex items-center gap-1.5 text-3xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {title}
        <span className="text-muted-foreground/60">{runs.length}</span>
      </h2>
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {runs.map((run) => (
          <button
            className="rounded-2xl border border-border/70 bg-card/80 p-3 text-left transition-colors hover:bg-muted/50"
            key={run.id}
            onClick={() => onOpenRun(run.id)}
            type="button"
          >
            <div className="flex items-center gap-2">
              <StatusDot status={run.status} />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {run.objective}
              </span>
            </div>
            <div className="mt-2 flex items-center gap-2 text-2xs text-muted-foreground">
              <ModeChip mode={run.mode} />
              <span>{run.status}</span>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}
