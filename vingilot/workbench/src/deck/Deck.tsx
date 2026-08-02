import { useState } from "react";
import { createRun, provisionRun } from "../api/coordinator.ts";
import { railGroups, statusClass } from "../model/run.ts";
import type { RunMode, RunSummary } from "../model/run.ts";
import { ModeChip } from "../shell/RunRail.tsx";
import { buildProvisionSpec } from "./provisionSpec.ts";

const WALL_LIMIT_OPTIONS = [
  { label: "30m", secs: 1800 },
  { label: "2h", secs: 7200 },
  { label: "none", secs: null },
] as const;

type WallLimitLabel = (typeof WALL_LIMIT_OPTIONS)[number]["label"];

interface DeckProps {
  workspaceId: string;
  runs: RunSummary[];
  onOpenRun: (runId: string) => void;
}

/** The Deck (design 2e): composer bar creates + provisions a real run, three
 * lanes below mirror the rail's grouping as clickable cards. */
export function Deck({ workspaceId, runs, onOpenRun }: DeckProps) {
  const [objective, setObjective] = useState("");
  const [mode, setMode] = useState<RunMode>("delegated");
  const [wallLimitLabel, setWallLimitLabel] = useState<WallLimitLabel>("30m");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const groups = railGroups(runs);

  async function startRun() {
    const trimmed = objective.trim();
    if (trimmed === "" || submitting) return;
    setSubmitting(true);
    setError(null);

    const wallLimitSecs = WALL_LIMIT_OPTIONS.find((o) => o.label === wallLimitLabel)?.secs ?? null;
    const created = await createRun({
      workspace_id: workspaceId,
      objective: trimmed,
      mode,
      wall_limit_secs: wallLimitSecs,
    });
    if (!created.ok) {
      setSubmitting(false);
      setError(created.kind === "unreachable" ? "control plane unreachable" : created.detail);
      return;
    }

    const runId = created.value.run_id;
    const provisioned = await provisionRun(runId, buildProvisionSpec(runId));
    setSubmitting(false);
    if (!provisioned.ok) {
      // The run exists (draft) but provisioning failed — surface the detail
      // rather than silently opening a run with no worktree grant.
      setError(provisioned.kind === "unreachable" ? "control plane unreachable" : provisioned.detail);
      return;
    }

    setObjective("");
    onOpenRun(runId);
  }

  return (
    <div className="vg-deck">
      <form
        className="vg-deck__composer"
        onSubmit={(e) => {
          e.preventDefault();
          startRun();
        }}
      >
        <input
          className="vg-input vg-deck__objective"
          type="text"
          placeholder="objective"
          value={objective}
          onChange={(e) => setObjective(e.target.value)}
          disabled={submitting}
          aria-label="objective"
        />
        <select
          className="vg-select"
          value={mode}
          onChange={(e) => setMode(e.target.value as RunMode)}
          disabled={submitting}
          aria-label="run mode"
        >
          <option value="delegated">delegated</option>
          <option value="interactive">interactive</option>
        </select>
        <select
          className="vg-select"
          value={wallLimitLabel}
          onChange={(e) => setWallLimitLabel(e.target.value as WallLimitLabel)}
          disabled={submitting}
          aria-label="wall-clock limit"
        >
          {WALL_LIMIT_OPTIONS.map((o) => (
            <option key={o.label} value={o.label}>
              {o.label}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="vg-button vg-button--primary"
          disabled={submitting || objective.trim() === ""}
        >
          {submitting ? "Starting…" : "Start Run"}
        </button>
      </form>
      {error !== null && (
        <p className="vg-deck__error" role="alert">
          {error}
        </p>
      )}

      {runs.length === 0 ? (
        <p className="vg-deck__empty">no runs yet — start one above</p>
      ) : (
        <>
          <DeckLane title="NEEDS YOU" runs={groups.needsYou} onOpenRun={onOpenRun} />
          <DeckLane title="LIVE" runs={groups.live} onOpenRun={onOpenRun} />
          <DeckLane title="RECENT" runs={groups.recent} onOpenRun={onOpenRun} />
        </>
      )}
    </div>
  );
}

function DeckLane({
  title,
  runs,
  onOpenRun,
}: {
  title: string;
  runs: RunSummary[];
  onOpenRun: (id: string) => void;
}) {
  if (runs.length === 0) return null;
  return (
    <section className="vg-deck__lane">
      <h2 className="vg-deck__lane-title">
        {title} <span className="vg-rail__count">{runs.length}</span>
      </h2>
      <div className="vg-deck__cards">
        {runs.map((r) => (
          <button type="button" key={r.id} className="vg-deck__card" onClick={() => onOpenRun(r.id)}>
            <div className="vg-deck__card-top">
              <span className={`vg-status-dot vg-status-dot--${statusClass(r.status)}`} aria-hidden="true" />
              <span className="vg-deck__card-objective">{r.objective}</span>
            </div>
            <div className="vg-deck__card-meta">
              <ModeChip mode={r.mode} />
              <span className="vg-rail__meta">{r.status}</span>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}
