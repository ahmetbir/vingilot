// The selected worktree's tabbed work surface: Terminal (default, per the
// layout contract — iTerm: the terminal is the work surface, not a
// drawer), Diff (this worktree's real changes, `WorktreeDiffPanel`), Evidence
// (the owner run's transcript, its committed diffs included), Runs. Owns the ⌘1…9 / ⌘` / Esc key map and the
// terminal-tab keys ⌘T / ⇧⌘W / ⌥⌘←→ (`lib/terminalKeys.ts`).
//
// It renders a `<Terminal>` per open session (hidden, not torn down, when it
// is not the one showing) but it does not own that list, and must not: this
// component unmounts whenever the owner leaves a project for the landing
// view, so anything it owned would be lost on the way. `RunsScreen` — which
// stays mounted — owns which sessions are open and when one is really
// closed. What survives an unmount here is the pty session itself, whose
// screen `pty_open` replays on reattach.
//
// The Runs tab is the pre-existing RunList + DeckPane/RunDetail pair,
// unchanged — "Run rows do not disappear — they become a tab, not the
// front door" (vingilot/docs/plans/2026-08-06-projects-and-terminal.md).

import * as React from "react";

import { listEvidence } from "@/features/runs/lib/coordinatorClient";
import type { ApiResult } from "@/features/runs/lib/coordinatorClient";
import type { Worktree } from "@/features/runs/lib/projects";
import { evidenceView } from "@/features/runs/lib/runModel";
import type {
  EvidenceKind,
  EvidenceRow,
  RunSummary,
} from "@/features/runs/lib/runModel";
import { resolveKey } from "@/features/runs/lib/terminalKeys";
import type { TerminalSession } from "@/features/runs/lib/terminalSessions";
import type {
  TabCommand,
  WorktreeTabs,
} from "@/features/runs/lib/terminalTabs";
import { usePolling } from "@/features/runs/lib/usePolling";
import { DeckPane } from "@/features/runs/ui/DeckPane";
import { RunDetail } from "@/features/runs/ui/RunDetail";
import { RunList } from "@/features/runs/ui/RunList";
import { Terminal } from "@/features/runs/ui/Terminal";
import { TerminalTabStrip } from "@/features/runs/ui/TerminalTabStrip";
import { WorktreeDiffPanel } from "@/features/runs/ui/WorktreeDiffPanel";
import { hasPrimaryShortcutModifier } from "@/shared/lib/platform";

type Tab = "terminal" | "diff" | "evidence" | "runs";

interface WorkSurfaceProps {
  workspaceId: string;
  /** Ordered — index N backs the ⌘(N+1) shortcut for N < 9; the same order
   * `WorktreeColumn` renders. */
  worktrees: Worktree[];
  selectedWorktreeId: string | null;
  onSelectWorktree: (bindingId: string) => void;
  /** Every open PTY session, in visit order, with its resolved cwd — owned
   * by `RunsScreen`. Includes sessions from other projects; only the
   * selected one is ever visible, and keeping the rest mounted is what
   * makes a project switch cheap. */
  terminals: TerminalSession[];
  /** The selected worktree's terminal tabs, or `null` before it has any.
   * Owned by `RunsScreen` for the same reason `terminals` is. */
  tabs: WorktreeTabs | null;
  onTabCommand: (command: TabCommand) => void;
  runs: RunSummary[];
  reachable: boolean;
  /** The selected worktree's own directory, resolved by `RunsScreen` (it owns
   * the repo/worktree-root pair the derivation needs). `null` when it cannot
   * be derived — the Diff panel then says so rather than reading somewhere. */
  worktreeCwd: string | null;
}

const TABS: Array<{ key: Tab; label: string }> = [
  { key: "terminal", label: "Terminal" },
  { key: "diff", label: "Diff" },
  { key: "evidence", label: "Evidence" },
  { key: "runs", label: "Runs" },
];

export function WorkSurface({
  onSelectWorktree,
  onTabCommand,
  reachable,
  runs,
  selectedWorktreeId,
  tabs,
  terminals,
  worktreeCwd,
  worktrees,
  workspaceId,
}: WorkSurfaceProps) {
  const [activeTab, setActiveTab] = React.useState<Tab>("terminal");
  const [focusToken, setFocusToken] = React.useState(0);

  React.useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const action = resolveKey({
        altKey: event.altKey,
        key: event.key,
        primaryModifier: hasPrimaryShortcutModifier(event),
        repeat: event.repeat,
        shiftKey: event.shiftKey,
      });
      if (action === null) return;

      if (action.type === "switch-worktree") {
        const target = worktrees[action.index];
        if (target === undefined) return;
        event.preventDefault();
        onSelectWorktree(target.binding_id);
        return;
      }
      if (action.type === "focus-terminal") {
        event.preventDefault();
        setActiveTab("terminal");
        setFocusToken((t) => t + 1);
        return;
      }
      // ⌘T brings the terminal forward as well as adding to it — asking for a
      // new shell from the Diff tab can only mean "and show it to me", and a
      // tab that opened somewhere the owner cannot see would be a shell they
      // have to go looking for.
      if (action.type === "new-terminal-tab") {
        event.preventDefault();
        setActiveTab("terminal");
        setFocusToken((t) => t + 1);
        onTabCommand({ type: "new" });
        return;
      }
      if (action.type === "leave-terminal") {
        // Move focus off whatever currently has it (the terminal's own hidden
        // input, most commonly) — this key map only owns focus, not tab
        // navigation.
        (document.activeElement as HTMLElement | null)?.blur();
        return;
      }
      // The rest act on the strip that is showing, so they are only ours
      // while it is. Anywhere else the key falls through untouched rather
      // than closing or reordering something off screen.
      if (activeTab !== "terminal" || tabs === null) return;
      if (action.type === "close-terminal-tab") {
        event.preventDefault();
        onTabCommand({ n: tabs.active, type: "close" });
        return;
      }
      if (action.type === "step-terminal-tab") {
        event.preventDefault();
        onTabCommand({ dir: action.dir, type: "step" });
        setFocusToken((t) => t + 1);
        return;
      }
      if (action.type === "move-terminal-tab") {
        event.preventDefault();
        onTabCommand({ dir: action.dir, type: "move" });
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [worktrees, onSelectWorktree, onTabCommand, activeTab, tabs]);

  const selectedWorktree =
    worktrees.find((wt) => wt.binding_id === selectedWorktreeId) ?? null;

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
      data-testid="work-surface"
    >
      <div
        className="flex shrink-0 items-center gap-1 border-b border-border/60 px-3 py-1.5"
        role="tablist"
      >
        {TABS.map((tab) => (
          <button
            aria-selected={activeTab === tab.key}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              activeTab === tab.key
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:bg-muted/60"
            }`}
            data-testid={`work-surface-tab-${tab.key}`}
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            role="tab"
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {activeTab === "terminal" && tabs !== null ? (
          <TerminalTabStrip
            onClose={(n) => onTabCommand({ n, type: "close" })}
            onNew={() => onTabCommand({ type: "new" })}
            onSelect={(n) => onTabCommand({ n, type: "select" })}
            tabs={tabs}
          />
        ) : null}

        {terminals.map((terminal) => (
          <Terminal
            active={
              activeTab === "terminal" &&
              selectedWorktreeId === terminal.bindingId &&
              tabs?.active === terminal.n
            }
            cwd={terminal.cwd}
            focusToken={focusToken}
            key={terminal.sessionId}
            sessionId={terminal.sessionId}
          />
        ))}

        {activeTab === "diff" && selectedWorktree !== null ? (
          <WorktreeDiffPanel
            cwd={worktreeCwd}
            key={selectedWorktree.binding_id}
            worktree={selectedWorktree}
          />
        ) : null}
        {activeTab === "evidence" ? (
          <EvidenceTab ownerRunId={selectedWorktree?.owner_run_id ?? null} />
        ) : null}
        {activeTab === "runs" ? (
          <RunsTab
            initialRunId={selectedWorktree?.owner_run_id ?? null}
            reachable={reachable}
            runs={runs}
            workspaceId={workspaceId}
          />
        ) : null}
      </div>
    </div>
  );
}

async function fetchOwnerEvidence(
  ownerRunId: string | null,
): Promise<ApiResult<EvidenceRow[]>> {
  if (ownerRunId === null) return { ok: true, value: [] };
  return listEvidence(ownerRunId);
}

const EVIDENCE_KIND_CLASS: Record<EvidenceKind, string> = {
  command: "text-foreground",
  commit: "text-emerald-600 dark:text-emerald-400",
  diff: "text-muted-foreground",
  error: "text-destructive",
  note: "text-muted-foreground",
  output: "text-foreground",
};

function EvidenceTab({ ownerRunId }: { ownerRunId: string | null }) {
  const fetchEvidence = React.useCallback(
    () => fetchOwnerEvidence(ownerRunId),
    [ownerRunId],
  );
  const { data: evidenceRows } = usePolling(fetchEvidence, 2000);
  const { rows, truncatedCount } = evidenceView(evidenceRows ?? []);

  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-4 py-3"
      data-testid="work-surface-evidence-tab"
    >
      {ownerRunId === null ? (
        <p className="text-sm text-muted-foreground">
          this worktree has no owner run yet
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">no evidence yet</p>
      ) : (
        <div className="flex flex-col gap-1 rounded-lg border border-border/60 bg-muted/30 p-3 font-mono text-xs">
          {truncatedCount > 0 ? (
            <p className="text-3xs text-muted-foreground/70">
              {truncatedCount} earlier row{truncatedCount === 1 ? "" : "s"} not
              shown
            </p>
          ) : null}
          {rows.map((ev) => (
            <div
              className={`whitespace-pre-wrap break-words ${EVIDENCE_KIND_CLASS[ev.kind]}`}
              key={ev.seq}
            >
              {ev.kind === "command" ? "$ " : ""}
              {ev.kind === "commit" ? "⎘ " : ""}
              {ev.content}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RunsTab({
  initialRunId,
  reachable,
  runs,
  workspaceId,
}: {
  initialRunId: string | null;
  reachable: boolean;
  runs: RunSummary[];
  workspaceId: string;
}) {
  const [selectedRunId, setSelectedRunId] = React.useState(initialRunId);

  // The worktree underneath this tab can change (a different worktree
  // selected while "Runs" stays the active tab) — re-sync to that
  // worktree's own owner run rather than showing a stale one.
  React.useEffect(() => {
    setSelectedRunId(initialRunId);
  }, [initialRunId]);

  const openRun = React.useCallback((id: string) => setSelectedRunId(id), []);
  const openDeck = React.useCallback(() => setSelectedRunId(null), []);

  return (
    <div
      className="flex min-h-0 flex-1 overflow-hidden"
      data-testid="work-surface-runs-tab"
    >
      <aside
        aria-label="runs"
        className="flex w-64 shrink-0 flex-col overflow-hidden border-r border-border/60"
      >
        <RunList
          activeRunId={selectedRunId}
          onSelectDeck={openDeck}
          onSelectRun={openRun}
          runs={runs}
          staleAsOf={null}
          workspaceId={workspaceId}
        />
      </aside>
      <main
        aria-label="workspace"
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        {selectedRunId === null ? (
          <DeckPane
            onOpenRun={openRun}
            reachable={reachable}
            runs={runs}
            workspaceId={workspaceId}
          />
        ) : (
          <RunDetail key={selectedRunId} runId={selectedRunId} />
        )}
      </main>
    </div>
  );
}
