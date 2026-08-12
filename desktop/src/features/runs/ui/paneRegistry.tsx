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
// **A row has to be able to say everything a pane knows about itself**, or the
// sixth pane is an edit to the host rather than an edit to this table. Two of
// the columns are here because the first four panes could not say it: a pane
// declares what it is a *reading* of (`identity`, which is what the host
// remounts on) and what it needs to *ask the world* before it can say whether
// it can work here (`probe`, because `availability` is synchronous and "is
// there a docker daemon?" is not). Both were the host's answers before, given
// on every pane's behalf and right for some of them.
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

import { probeAgent } from "@/features/runs/lib/agentClient";
import { explainAvailability } from "@/features/runs/lib/agentTurn";
import type { Worktree } from "@/features/runs/lib/projects";
import {
  AGENT_HARNESS_PROBE,
  agentAvailability,
  diffAvailability,
  evidenceAvailability,
  filesAvailability,
  historyAvailability,
  notesAvailability,
  type PaneAct,
  type PaneAvailability,
  type PaneContext,
  type PaneFacts,
  type PaneId,
  PANE_IDS,
  type PaneProbe,
  planAvailability,
  runsAvailability,
  searchAvailability,
  terminalAvailability,
} from "@/features/runs/lib/paneModel";
import type { ControlPlaneKind } from "@/features/runs/lib/reachability";
import type { RunSummary } from "@/features/runs/lib/runModel";
import { teamAvailability } from "@/features/runs/lib/teamThread";
import type { ProjectDocuments } from "@/features/runs/lib/useDocument";
import { AgentPanel } from "@/features/runs/ui/AgentPanel";
import { EvidencePane } from "@/features/runs/ui/EvidencePane";
import { FilesPane } from "@/features/runs/ui/FilesPane";
import { HistoryPane } from "@/features/runs/ui/HistoryPane";
import { NotesPane } from "@/features/runs/ui/NotesPane";
import { PlanPane } from "@/features/runs/ui/PlanPane";
import { RunsPane } from "@/features/runs/ui/RunsPane";
import { SearchPane } from "@/features/runs/ui/SearchPane";
import { TeamThreadPane } from "@/features/runs/ui/TeamThreadPane";
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
  /** The open project's own directory, or `null` when there is none to name.
   * Beside `cwd` rather than instead of it: a pane about the project (Notes)
   * and a pane about the worktree (Diff) are both panes, and a host that
   * handed out only one of the two would decide for them which they are. */
  projectPath: string | null;
  /** The open project's documents, already opened by the host
   * (`useProjectDocuments`). A pane that edits one is a *view* of it, not its
   * owner: the workspace acts on the plan too — it is what a worktree is
   * briefed from — and a pane-owned document is one no dialog can read
   * without going round through storage, a debounce behind what is on
   * screen. */
  documents: ProjectDocuments;
  runs: RunSummary[];
  /** What the control plane is doing, as a state rather than a boolean:
   * a pane that only knew `!reachable` could only say "unreachable", which
   * on a machine that never had a coordinator is the lie Task 2 removed. */
  controlPlane: ControlPlaneKind;
  /** How often a pane may poll the coordinator, decided by the host from what
   * `controlPlane` is (`lib/reachability.ts`, `controlPlanePollMs`). It rides
   * beside `controlPlane` because the two are one answer: a pane told "no
   * control plane on this machine" and left on its own 2s timer would keep the
   * hammer the settled cadence exists to stop, and the state it reads would
   * run ahead of the banner the owner is looking at. */
  pollMs: number;
  workspaceId: string;
  /** Put another pane in this slot. The one thing a pane can ask of the host,
   * and it is here because a pane that wanted it had no way to say so: a
   * source-control pane's "show this file in Diff" ends in this call. What it
   * cannot yet do is hand the next pane an argument — no pane needs that, and
   * inventing the channel before one does would fix its shape blind. */
  onChoosePane: (pane: PaneId) => void;
  /** The second thing a pane can ask of the host, and the one the note above
   * said would come: an act the workspace owns (`PaneAct`). The Plan pane's
   * "turn this into a worktree" is a dialog over the whole surface and a
   * branch in the owner's repository, and the palette is a second door onto
   * the same dialog — so the pane asks, and `RunsScreen` decides. */
  onPaneAct: (act: PaneAct) => void;
}

export type PaneComponent = (props: PaneProps) => React.ReactElement | null;

export interface PaneEntry {
  id: PaneId;
  title: string;
  /** A glyph, not a component — this island draws its chrome in text
   * (`WorkspaceNav`'s rail, `TerminalTabStrip`'s ×) and a pane row is data
   * the picker prints, not a component tree. */
  icon: string;
  /** `null` for a pane the work surface renders in place; see the note above.
   * The terminal is the only one, and the only one that can be: it is the pane
   * that is fixed to the left. */
  component: PaneComponent | null;
  availability: (ctx: PaneContext) => PaneAvailability;
  /** **What this pane is a reading of.** The host remounts the pane when this
   * string changes and leaves it alone when it does not, so the pane — not the
   * host — decides what a worktree switch costs it. Diff and Evidence are
   * readings of one worktree and are re-taken when it changes; Runs is a
   * reading of the workspace and survives, which is what a half-typed
   * objective in it needs. The host used to answer this for everyone with the
   * worktree's binding id, which is only right for some panes and silently
   * wrong for the rest. */
  identity: (facts: PaneFacts) => string;
  /** The question this pane needs the world to answer before `availability`
   * can decide (`PaneProbe`). Omitted by a pane whose answer is in the facts. */
  probe?: PaneProbe;
  /** The chord that puts this pane on screen, when one does, written the way
   * `cheatsheet.ts`'s `chordOf` writes it.
   *
   * **A column rather than a second table**, because the alternative is a list
   * of pane-to-chord pairs somewhere else that goes stale the day a chord
   * moves. It is read by the palette so a row can print the key beside the
   * name — the row is the door for someone who does not know the chord, and it
   * is also where he learns it. Omitted by the panes that have none, which is
   * every one of them except this: they are chosen through ⌘K or the picker
   * and a chord each would be seven more claims on the keyboard for no reason
   * anybody asked for. */
  chord?: string;
}

/** A pane whose content is one worktree's: switching worktree means taking the
 * reading again. */
function ofWorktree(facts: PaneFacts): string {
  return facts.worktreeId ?? "none";
}

/** A pane that is not about the worktree under it at all. It stays mounted
 * across a switch, and re-syncs from its props if it has anything to re-sync. */
function ofWorkspace(): string {
  return "workspace";
}

/** A pane whose content is one project's. It survives every worktree switch
 * inside that project — a note being typed must not be interrupted by ⌘2 —
 * and is re-taken when the project changes, because it is then a different
 * document. */
function ofProject(facts: PaneFacts): string {
  return facts.projectPath ?? "none";
}

function DiffPane({ cwd, onPaneAct, worktree }: PaneProps) {
  if (worktree === null) return null;
  return (
    <WorktreeDiffPanel
      cwd={cwd}
      // The `show this file in Diff` this file's header predicted, arriving in
      // the other direction: from a patch to the whole file. It goes through
      // `onPaneAct` rather than through `onChoosePane` because it carries an
      // argument, which is exactly what the note above `onPaneAct` said the
      // second act would need. A pane with no directory has no file to name,
      // so it offers nothing.
      onShowFile={
        cwd === null
          ? undefined
          : (path, line) =>
              onPaneAct({ line, path, type: "show-file", worktree: cwd })
      }
      worktree={worktree}
    />
  );
}

function AgentPane({ cwd }: PaneProps) {
  return <AgentPanel cwd={cwd} />;
}

function NotesPaneEntry({ documents, projectPath }: PaneProps) {
  return <NotesPane doc={documents.notes} projectPath={projectPath} />;
}

function PlanPaneEntry({ documents, onPaneAct, projectPath }: PaneProps) {
  return (
    <PlanPane
      doc={documents.plan}
      onTurnIntoWorktree={() => onPaneAct({ type: "plan-to-worktree" })}
      projectPath={projectPath}
    />
  );
}

/** Is there a harness on this machine to hand a worktree to? A question about
 * the machine, so it carries no `keyOf` and is asked once per app run — the
 * answer changes when the owner edits his shell profile, which is not
 * something to watch for.
 *
 * A probe that cannot be put answers `null`, never `{ present: false }`: this
 * build running outside Tauri has not been told there is no agent. */
const agentHarnessProbe: PaneProbe = {
  ask: async () => {
    const answered = await probeAgent();
    if (answered === null) return null;
    const explained = explainAvailability(answered);
    return { detail: explained.message, present: explained.ready };
  },
  id: AGENT_HARNESS_PROBE,
};

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
    identity: ofWorktree,
    probe: agentHarnessProbe,
    title: "Agent",
  },
  diff: {
    availability: diffAvailability,
    component: DiffPane,
    icon: "±",
    id: "diff",
    identity: ofWorktree,
    title: "Diff",
  },
  evidence: {
    availability: evidenceAvailability,
    component: EvidencePane,
    icon: "☰",
    id: "evidence",
    identity: ofWorktree,
    title: "Evidence",
  },
  files: {
    availability: filesAvailability,
    component: FilesPane,
    icon: "⌸",
    id: "files",
    // A reading of one worktree, and the plainest case of it in this table:
    // every path in the tree is relative to *this* checkout, and carrying a
    // tree or an open file across a switch would show him another worktree's
    // `src/main.rs` under this one's name.
    identity: ofWorktree,
    // No probe. Its one question — is there a checkout — is in the facts, and
    // an answer asked once per key would go stale the moment git ran.
    title: "Files",
  },
  history: {
    availability: historyAvailability,
    component: HistoryPane,
    icon: "⟲",
    id: "history",
    // A reading of one worktree, and one of the strictest cases in this table:
    // a linked worktree has its own HEAD, so its history is its branch's rather
    // than the repository's, and carrying a commit list or a status across a
    // switch would show him another branch's commits under this one's name.
    identity: ofWorktree,
    // No probe. Its one question — is there a checkout — is in the facts, and
    // an answer asked once per key would go stale the moment git ran.
    title: "History",
  },
  notes: {
    availability: notesAvailability,
    component: NotesPaneEntry,
    icon: "✎",
    id: "notes",
    identity: ofProject,
    title: "Notes",
  },
  plan: {
    availability: planAvailability,
    component: PlanPaneEntry,
    icon: "◇",
    id: "plan",
    // A project's, like Notes — and for the sharper reason: the worktree this
    // plan is about does not exist yet, so a plan re-taken on every worktree
    // switch would be a plan that vanished the moment it was acted on.
    identity: ofProject,
    title: "Plan",
  },
  runs: {
    availability: runsAvailability,
    // The workspace's runs are the same list from every worktree, so this pane
    // is not a reading of the one underneath it and must not be re-taken when
    // it changes — a half-typed objective in the Deck is the owner's work.
    component: RunsPane,
    icon: "◎",
    id: "runs",
    identity: ofWorkspace,
    title: "Runs",
  },
  search: {
    availability: searchAvailability,
    // ⇧⌘F, and it is the only pane in this table with a chord of its own —
    // because it is the only one the owner left the app for
    // (vingilot/docs/plans/2026-08-11-what-sent-him-to-vscode.md, Task 2). The
    // claimant check is in `lib/searchKeys.ts`.
    chord: "⇧⌘F",
    component: SearchPane,
    icon: "⌕",
    id: "search",
    // A reading of one worktree, like Files and for the same reason: every path
    // in an answer is relative to *this* checkout, and carrying results across
    // a switch would offer him another worktree's file under this one's name.
    // **This is the only thing that guarantees it** — `workspace-search.spec.ts`
    // presses on it by giving two worktrees the Search pane and switching
    // between them, and turning this into `ofWorkspace` turns that spec red.
    identity: ofWorktree,
    // No probe. Its one question — is there a checkout — is in the facts, and
    // an answer asked once per key would go stale the moment git ran.
    title: "Search",
  },
  team: {
    availability: teamAvailability,
    component: TeamThreadPane,
    icon: "◫",
    id: "team",
    // A reading of one worktree, and the strictest case of it in this table:
    // the pane holds a composer and a chosen team per worktree, and carrying
    // either across a switch would put a half-typed message about one checkout
    // above a thread about another.
    identity: ofWorktree,
    // No probe, deliberately. Its four questions — community, teams, relay,
    // runtime — are all live, and a probe is asked once per key; a pane gated
    // on a snapshot would still say "no teams" ten minutes after one was made.
    // It answers them itself, in `lib/teamThread.ts`'s words.
    title: "Team",
  },
  terminal: {
    availability: terminalAvailability,
    component: null,
    icon: "❯",
    id: "terminal",
    // Never read: the terminal is rendered in place and its instances are
    // keyed by session id, which is the identity that matters for a pane
    // holding a live external process.
    identity: ofWorkspace,
    title: "Terminal",
  },
};

export function paneEntry(id: PaneId): PaneEntry {
  return ENTRIES[id];
}

export function paneEntries(ids: PaneId[]): PaneEntry[] {
  return ids.map(paneEntry);
}

/** Every question the registry needs answered, for the host to run. It does
 * not know what any of them asks — that is the point. */
export function paneProbes(): PaneProbe[] {
  return PANE_IDS.flatMap((id) => {
    const probe = ENTRIES[id].probe;
    return probe === undefined ? [] : [probe];
  });
}
