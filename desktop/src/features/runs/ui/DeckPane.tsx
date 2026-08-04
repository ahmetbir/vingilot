// The Deck (design 2e): composer bar creates + provisions a real run, a
// PINNED region above the lanes shows what the owner pinned (placed in this
// device's local order, unplaced cards flagged as arrivals from elsewhere),
// three lanes below mirror the rail's grouping as clickable cards. This is
// the Runs screen's default right pane (nothing selected).
//
// Phase 3 (vingilot/docs/plans/2026-08-04-deck-phase-3.md) adds the PINNED
// region: the pin *set* is Workspace state written through the coordinator's
// CAS `apply_mutations` protocol (deckSync.ts) and therefore shared across
// devices; the pin *arrangement* is device-local (deckLayout.ts,
// localStorage) and never syncs. A pin from another device arrives appended
// and visibly unplaced until this device places it. A concurrent pin from a
// second device produces a real CAS conflict, surfaced via DeckConflict —
// never a silent overwrite.
//
// Restyled from vingilot/workbench/src/deck/Deck.tsx (ADR-001's 2026-08-03
// reversal) — the sibling app is donor code once this lands.

import * as React from "react";

import {
  createRun,
  getWorkspace,
  provisionRun,
} from "@/features/runs/lib/coordinatorClient";
import type { Pin } from "@/features/runs/lib/deckPins";
import { readPins, withPin, withoutPin } from "@/features/runs/lib/deckPins";
import {
  applyLayout,
  moveInLayout,
  readLayout,
  writeLayout,
} from "@/features/runs/lib/deckLayout";
import { syncPins } from "@/features/runs/lib/deckSync";
import { buildProvisionSpec } from "@/features/runs/lib/provisionSpec";
import { railGroups } from "@/features/runs/lib/runModel";
import type { RunMode, RunSummary } from "@/features/runs/lib/runModel";
import { usePolling } from "@/features/runs/lib/usePolling";
import { DeckConflict } from "@/features/runs/ui/DeckConflict";
import { PinnedCard } from "@/features/runs/ui/PinnedCard";
import { ModeChip, StatusDot } from "@/features/runs/ui/RunList";
import { Button } from "@/shared/ui/button";

const WALL_LIMIT_OPTIONS = [
  { label: "30m", secs: 1800 },
  { label: "2h", secs: 7200 },
  { label: "none", secs: null },
] as const;

type WallLimitLabel = (typeof WALL_LIMIT_OPTIONS)[number]["label"];

/** The pin set as it stood the moment a write was attempted, plus the
 * action that produced it — kept so "Re-apply mine on top" can rebase that
 * same intent onto whatever revision won, per ADR-002. */
interface ConflictState {
  action: (current: Pin[]) => Pin[];
  mine: Pin[];
  theirs: Pin[];
  revision: number;
}

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

  // The pin set — Workspace state, polled independently of `runs` since it
  // lives under a different key of the same snapshot.
  const fetchWorkspace = React.useCallback(
    () => getWorkspace(workspaceId),
    [workspaceId],
  );
  const {
    data: snapshot,
    lastOk: pinsLastOk,
    reachable: pinsReachable,
  } = usePolling(fetchWorkspace, 2000);
  const pins = React.useMemo(
    () => readPins(snapshot ? snapshot.state : null),
    [snapshot],
  );
  const pinnedIds = React.useMemo(() => new Set(pins.map((p) => p.id)), [pins]);

  // The layout — device-local, never sent over the network. Read once at
  // mount (workspaceId is fixed for the app's lifetime); every mutation
  // writes through to localStorage immediately.
  const [order, setOrder] = React.useState<string[]>(() =>
    readLayout(workspaceId),
  );
  const { placed, unplaced } = applyLayout(pins, order);

  const [pendingIds, setPendingIds] = React.useState<Set<string>>(new Set());
  const [conflict, setConflict] = React.useState<ConflictState | null>(null);
  const [reapplying, setReapplying] = React.useState(false);

  async function applyPinChange(id: string, action: (current: Pin[]) => Pin[]) {
    setPendingIds((prev) => new Set(prev).add(id));
    const result = await syncPins(workspaceId, action);
    setPendingIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    if (result.kind === "conflict") {
      setConflict({
        action,
        mine: action(pins),
        revision: result.revision,
        theirs: result.theirs,
      });
    } else if (result.kind === "ok") {
      setConflict(null);
    }
    // "unreachable"/"api": toggles already disable while unreachable; a
    // rare mid-flight API error settles on the next poll rather than
    // getting its own transient banner here.
  }

  function togglePin(id: string) {
    const isPinned = pinnedIds.has(id);
    void applyPinChange(id, (current) =>
      isPinned
        ? withoutPin(current, id)
        : withPin(current, {
            id,
            kind: "run",
            pinnedAt: new Date().toISOString(),
          }),
    );
  }

  function unpinCard(id: string) {
    void applyPinChange(id, (current) => withoutPin(current, id));
  }

  function keepTheirs() {
    setConflict(null);
  }

  function reapplyMine() {
    if (conflict === null) return;
    const { action } = conflict;
    setReapplying(true);
    void syncPins(workspaceId, action).then((result) => {
      setReapplying(false);
      if (result.kind === "conflict") {
        setConflict({
          action,
          mine: action(pins),
          revision: result.revision,
          theirs: result.theirs,
        });
      } else {
        setConflict(null);
      }
    });
  }

  function moveCard(id: string, dir: -1 | 1) {
    setOrder((prev) => {
      const base = prev.includes(id) ? prev : [...prev, id];
      const next = moveInLayout(base, id, dir);
      writeLayout(workspaceId, next);
      return next;
    });
  }

  function placeCard(id: string) {
    setOrder((prev) => {
      if (prev.includes(id)) return prev;
      const next = [...prev, id];
      writeLayout(workspaceId, next);
      return next;
    });
  }

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

      {pins.length > 0 ? (
        <section data-testid="deck-pinned">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-1.5 text-3xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              PINNED
              <span className="text-muted-foreground/60">{pins.length}</span>
            </h2>
            <span className="text-3xs text-muted-foreground/70">
              {pinsReachable
                ? "synced"
                : pinsLastOk !== null
                  ? `as of ${pinsLastOk.toLocaleTimeString()}`
                  : "unreachable"}
            </span>
          </div>
          {!pinsReachable ? (
            <p className="mt-1 text-xs text-muted-foreground" role="status">
              control plane unreachable — pin toggles disabled
            </p>
          ) : null}
          {conflict !== null ? (
            <div className="mt-2">
              <DeckConflict
                mine={conflict.mine}
                onKeepTheirs={keepTheirs}
                onReapply={reapplyMine}
                reapplying={reapplying}
                revision={conflict.revision}
                runs={runs}
                theirs={conflict.theirs}
              />
            </div>
          ) : null}
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {placed.map((pin) => (
              <PinnedCard
                disabled={!pinsReachable}
                key={pin.id}
                onMoveLeft={(id) => moveCard(id, -1)}
                onMoveRight={(id) => moveCard(id, 1)}
                onOpenRun={onOpenRun}
                onPlace={placeCard}
                onUnpin={unpinCard}
                pending={pendingIds.has(pin.id)}
                pin={pin}
                run={runs.find((r) => r.id === pin.id)}
                unplaced={false}
              />
            ))}
            {unplaced.map((pin) => (
              <PinnedCard
                disabled={!pinsReachable}
                key={pin.id}
                onMoveLeft={(id) => moveCard(id, -1)}
                onMoveRight={(id) => moveCard(id, 1)}
                onOpenRun={onOpenRun}
                onPlace={placeCard}
                onUnpin={unpinCard}
                pending={pendingIds.has(pin.id)}
                pin={pin}
                run={runs.find((r) => r.id === pin.id)}
                unplaced={true}
              />
            ))}
          </div>
        </section>
      ) : null}

      {runs.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          no runs yet — start one above
        </p>
      ) : (
        <>
          <DeckLane
            onOpenRun={onOpenRun}
            onTogglePin={togglePin}
            pendingIds={pendingIds}
            pinnedIds={pinnedIds}
            pinsReachable={pinsReachable}
            runs={groups.needsYou}
            title="NEEDS YOU"
          />
          <DeckLane
            onOpenRun={onOpenRun}
            onTogglePin={togglePin}
            pendingIds={pendingIds}
            pinnedIds={pinnedIds}
            pinsReachable={pinsReachable}
            runs={groups.live}
            title="LIVE"
          />
          <DeckLane
            onOpenRun={onOpenRun}
            onTogglePin={togglePin}
            pendingIds={pendingIds}
            pinnedIds={pinnedIds}
            pinsReachable={pinsReachable}
            runs={groups.recent}
            title="RECENT"
          />
        </>
      )}
    </div>
  );
}

function DeckLane({
  onOpenRun,
  onTogglePin,
  pendingIds,
  pinnedIds,
  pinsReachable,
  runs,
  title,
}: {
  onOpenRun: (id: string) => void;
  onTogglePin: (id: string) => void;
  pendingIds: Set<string>;
  pinnedIds: Set<string>;
  pinsReachable: boolean;
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
        {runs.map((run) => {
          const isPinned = pinnedIds.has(run.id);
          return (
            <div
              className="relative rounded-2xl border border-border/70 bg-card/80 p-3 text-left transition-colors hover:bg-muted/50"
              key={run.id}
            >
              <button
                aria-label={run.objective}
                className="absolute inset-0"
                onClick={() => onOpenRun(run.id)}
                type="button"
              />
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <StatusDot status={run.status} />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {run.objective}
                  </span>
                </div>
                <button
                  className={`relative z-10 shrink-0 rounded-full border px-2 py-0.5 text-2xs disabled:opacity-50 ${
                    isPinned
                      ? "border-primary/50 bg-primary/10 text-primary"
                      : "border-border text-muted-foreground"
                  }`}
                  data-testid={`pin-${run.id}`}
                  disabled={!pinsReachable || pendingIds.has(run.id)}
                  onClick={(event) => {
                    event.stopPropagation();
                    onTogglePin(run.id);
                  }}
                  type="button"
                >
                  {isPinned ? "pinned" : "pin"}
                </button>
              </div>
              <div className="mt-2 flex items-center gap-2 text-2xs text-muted-foreground">
                <ModeChip mode={run.mode} />
                <span>{run.status}</span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
