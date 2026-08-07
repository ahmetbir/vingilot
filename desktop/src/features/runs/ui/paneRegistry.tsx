// The pane registry: the table the work surface reads to know what it can put
// beside the terminal (vingilot/docs/plans/2026-08-07-panes-and-polish.md,
// Task 4).
//
// **This is the extension point, and it is internal.** A Plan pane, a Notes
// pane, an agent-team pane, a stack-status pane are each one row here plus one
// component — that is the whole of "the plugin system" the owner asked about,
// named honestly. It is not exported outside this feature and none of its
// shapes are a contract: a public API frozen now would be frozen around
// whatever these five panes happened to need, and the sixth is the one that
// would have taught us the shape. It becomes an API when a pane nobody here
// wrote needs one.
//
// **What a pane is allowed to be.** Everything except the terminal is a plain
// component of `PaneProps` — construct it, hand it the worktree under it, and
// it renders. The terminal is not, and its row says so: its instances are
// owned by `RunsScreen`, one per live pty session, and they outlive every view
// of them. Constructing one into a slot would mean a new xterm and a fresh
// attach, which replays a session's scrollback into a terminal that was never
// laid out — the exact way scrollback has been destroyed on this project
// before. So the terminal's row carries no component and the work surface
// renders it in place. That is the abstraction reporting a real constraint,
// not an exception carved out to make a table look uniform: any future pane
// holding a live external process will need the same treatment, and this is
// where it will be visible.

import type * as React from "react";

import type { Worktree } from "@/features/runs/lib/projects";
import {
  agentAvailability,
  diffAvailability,
  evidenceAvailability,
  type PaneAvailability,
  type PaneContext,
  type PaneId,
  runsAvailability,
  terminalAvailability,
} from "@/features/runs/lib/paneModel";
import type { RunSummary } from "@/features/runs/lib/runModel";
import { AgentPanel } from "@/features/runs/ui/AgentPanel";
import { EvidencePane } from "@/features/runs/ui/EvidencePane";
import { RunsPane } from "@/features/runs/ui/RunsPane";
import { WorktreeDiffPanel } from "@/features/runs/ui/WorktreeDiffPanel";

/** Everything a pane may be told about where it is. Uniform on purpose: a
 * pane that needed its own prop shape would be a pane the host had to know
 * about, and then the table would not be a table. */
export interface PaneProps {
  /** The worktree's own directory, or `null` when this app cannot name one. */
  cwd: string | null;
  /** The selected worktree. `null` only in the frames between a selection
   * changing and the worktree list catching up. */
  worktree: Worktree | null;
  ownerRunId: string | null;
  runs: RunSummary[];
  reachable: boolean;
  workspaceId: string;
}

export type PaneComponent = (props: PaneProps) => React.ReactElement | null;

export interface PaneEntry {
  id: PaneId;
  title: string;
  /** A glyph, not a component — this island draws its chrome in text
   * (`WorktreeColumn`'s rail, `TerminalTabStrip`'s ×) and a pane row is data
   * the picker prints, not a component tree. */
  icon: string;
  /** `null` for a pane the work surface renders in place; see the note above.
   * The terminal is the only one, and the only one that can be: it is the pane
   * that is fixed to the left. */
  component: PaneComponent | null;
  availability: (ctx: PaneContext) => PaneAvailability;
}

function DiffPane({ cwd, worktree }: PaneProps) {
  if (worktree === null) return null;
  return <WorktreeDiffPanel cwd={cwd} worktree={worktree} />;
}

function AgentPane({ cwd }: PaneProps) {
  return <AgentPanel cwd={cwd} />;
}

/** Keyed by id rather than listed, so the lookup below is total by
 * construction: `Record<PaneId, …>` cannot compile with a pane missing, and a
 * registry that could answer "no such pane" would need a caller that could
 * render one. Display order is `PANE_IDS`' — the model owns that, because the
 * picker and the shortcuts have to agree on it. */
const ENTRIES: Record<PaneId, PaneEntry> = {
  agent: {
    availability: agentAvailability,
    component: AgentPane,
    icon: "◆",
    id: "agent",
    title: "Agent",
  },
  diff: {
    availability: diffAvailability,
    component: DiffPane,
    icon: "±",
    id: "diff",
    title: "Diff",
  },
  evidence: {
    availability: evidenceAvailability,
    component: EvidencePane,
    icon: "☰",
    id: "evidence",
    title: "Evidence",
  },
  runs: {
    availability: runsAvailability,
    component: RunsPane,
    icon: "◎",
    id: "runs",
    title: "Runs",
  },
  terminal: {
    availability: terminalAvailability,
    component: null,
    icon: "❯",
    id: "terminal",
    title: "Terminal",
  },
};

export function paneEntry(id: PaneId): PaneEntry {
  return ENTRIES[id];
}

export function paneEntries(ids: PaneId[]): PaneEntry[] {
  return ids.map(paneEntry);
}
