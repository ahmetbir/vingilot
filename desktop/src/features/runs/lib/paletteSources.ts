// The palette's four sources — **projects**, **worktrees**, **panes**,
// **actions** — each a pure function from a query to the candidates it
// matched, all four going through `paletteModel.ts`'s one matcher so that one
// ranking can order the union
// (vingilot/docs/plans/2026-08-08-palette-and-documents.md, Task 1).
//
// **A source builds nouns and verbs, it does not order them.** Every source
// ends the same way, `matchAll`, and hands back `PaletteMatch`es whose scores
// are comparable with every other source's because they came from the same
// function. Anything a source did to its own ordering would be invisible to
// `rankMatches` and would show up as a palette that guesses.
//
// **Every action here already exists.** New worktree, new terminal tab, add
// project, remove project, prune, the two column toggles and the two solos are
// the buttons and chords the workspace already has; this file gives them a
// name and a query to be found by. Nothing here is a new capability, and the
// commands are data — `usePalette.ts` runs them.
//
// **Availability is a sentence, not a disappearance.** Prune with nothing
// prunable, "remove project" with no project open, a pane whose own
// `availability` refuses — each is still a row, still findable, carrying the
// reason. That mirrors `paneModel.ts`'s rule for the pane picker, and it is
// the same argument: a command that vanishes looks like a command that never
// existed.
//
// **The panes arrive as data.** This module never imports `paneRegistry.tsx`:
// that file is a component table, and a `node --test` run of the tests beside
// this one cannot load JSX. The host reads the registry and passes down what
// it found, which also keeps the availability rules the pane host uses and the
// ones the palette shows the *same* rules rather than a second copy.

import type { PaneAvailability } from "./paneModel.ts";
import {
  type Candidate,
  matchCandidate,
  type PaletteMatch,
} from "./paletteModel.ts";
import { type Repo, type Worktree, worktreeSummary } from "./projects.ts";
import { scratchBlocked } from "./scratchTerminal.ts";

/** One entry of the pane registry, reduced to what the palette needs. Built by
 * the host from `paneRegistry.tsx`, availability already asked with the same
 * `PaneContext` the work surface uses. */
export interface PaletteChoice {
  id: string;
  title: string;
  icon: string;
  availability: PaneAvailability;
}

/** Everything the sources are allowed to know. Facts about where the owner is,
 * never callbacks — a source that could act would be a source that could not
 * be tested. */
export interface PaletteContext {
  repos: readonly Repo[];
  /** The open project's worktrees, in the worktree column's own order, so the
   * palette's second row for a project is the column's second row. */
  worktrees: readonly Worktree[];
  selectedRepoId: string | null;
  selectedWorktreeId: string | null;
  /** Where the selected worktree is on disk, or `null` when that is not
   * derivable — the fact a row that opens a shell has to be blocked on, since
   * a worktree can be selected before its checkout has been located. */
  worktreeCwd: string | null;
  /** True while the home-directory lookup every cwd derives from has not
   * answered. The distinction between "no checkout" and "not yet", which a
   * blocked row's sentence has to keep. */
  worktreeCwdPending: boolean;
  /** What the right slot may be given, with each pane's own availability. */
  paneChoices: readonly PaletteChoice[];
  /** How many of the open project's worktrees git reports as prunable. */
  prunable: number;
  /** True while the worktree column is on screen at all — false on the
   * project-less landing view, where there is no column to toggle. */
  hasWorktreeColumn: boolean;
  sidebarCollapsed: boolean;
  worktreesCollapsed: boolean;
  /** Which side has the work surface to itself, or `null` for the split. */
  solo: "left" | "right" | null;
}

export type PaletteSource = (
  ctx: PaletteContext,
  query: string,
) => PaletteMatch[];

/** The one place a source turns candidates into matches. */
function matchAll(
  candidates: readonly Candidate[],
  query: string,
): PaletteMatch[] {
  return candidates.flatMap((candidate) => {
    const match = matchCandidate(candidate, query);
    return match === null ? [] : [match];
  });
}

const NO_PROJECT =
  "no project is open, so there is none for this to act on. Open one first.";

export const projectSource: PaletteSource = (ctx, query) => {
  const candidates: Candidate[] = ctx.repos.map((repo) => ({
    blocked: null,
    command: { repoId: repo.id, type: "open-project" },
    detail: repo.id === ctx.selectedRepoId ? `${repo.path} · open` : repo.path,
    icon: "▣",
    id: `project:${repo.id}`,
    kind: "project",
    label: repo.name,
  }));
  candidates.push({
    blocked: null,
    command: { type: "open-landing" },
    detail: "the project-less landing view — runs, lanes, the composer",
    icon: "▣",
    id: "project:landing",
    kind: "project",
    label: "Deck",
  });
  return matchAll(candidates, query);
};

/** The line under a worktree row. git's own numbers are the worktree column's
 * job and are not repeated here — what the palette needs is enough to tell two
 * similarly-named branches apart, which is the role and the run that owns it. */
function worktreeDetail(wt: Worktree): string {
  const parts = [wt.role === "primary" ? "the project's checkout" : wt.role];
  if (wt.owner_run_status !== null) parts.push(wt.owner_run_status);
  return parts.join(" · ");
}

export const worktreeSource: PaletteSource = (ctx, query) => {
  const candidates: Candidate[] = ctx.worktrees.map((wt) => ({
    blocked: null,
    command: { bindingId: wt.binding_id, type: "open-worktree" },
    detail:
      wt.binding_id === ctx.selectedWorktreeId
        ? `${worktreeDetail(wt)} · open`
        : worktreeDetail(wt),
    icon: "⌥",
    id: `worktree:${wt.binding_id}`,
    kind: "worktree",
    label: worktreeSummary(wt).label,
  }));
  return matchAll(candidates, query);
};

/** Why a pane cannot be put on the right now, or `null`. The pane's own rule
 * answers for itself; the host only adds the case the pane cannot see, which
 * is that there is no worktree under it at all. `pending` is runnable on
 * purpose — the same reading `PanePicker` gives it, and for the same reason:
 * a backing that has not answered yet has not refused. */
function paneBlocked(
  choice: PaletteChoice,
  selectedWorktreeId: string | null,
): string | null {
  if (selectedWorktreeId === null) {
    return "no worktree is open, so there is nothing to put a pane beside.";
  }
  return choice.availability.status === "unavailable"
    ? choice.availability.reason
    : null;
}

export const paneSource: PaletteSource = (ctx, query) => {
  const candidates: Candidate[] = ctx.paneChoices.map((choice) => ({
    blocked: paneBlocked(choice, ctx.selectedWorktreeId),
    command: { pane: choice.id, type: "choose-pane" },
    detail: `show the ${choice.title} pane beside the terminal`,
    icon: choice.icon,
    id: `pane:${choice.id}`,
    kind: "pane",
    label: `${choice.title} pane`,
  }));
  return matchAll(candidates, query);
};

/** The project's name in an action label, so "Remove …" says what it will
 * forget before the owner presses Enter on it. */
function openProject(ctx: PaletteContext): Repo | null {
  return ctx.repos.find((repo) => repo.id === ctx.selectedRepoId) ?? null;
}

export const actionSource: PaletteSource = (ctx, query) => {
  const project = openProject(ctx);
  const candidates: Candidate[] = [
    {
      blocked: project === null ? NO_PROJECT : null,
      command: { type: "new-worktree" },
      detail: "branch off this project into its own checkout",
      icon: "+",
      id: "action:new-worktree",
      kind: "action",
      label: "New worktree…",
    },
    {
      blocked: project === null ? NO_PROJECT : null,
      // What the plan says, and what is in it, are not this source's to know:
      // the document is read when the dialog opens, which is the moment the
      // branch name has to be derived from. A row carrying a name read at
      // palette-open would offer a branch from a plan the owner had since
      // edited.
      command: { type: "plan-to-worktree" },
      detail: "a branch from this project's plan, with the plan copied into it",
      icon: "◇",
      id: "action:plan-to-worktree",
      kind: "action",
      label: "Turn this plan into a worktree…",
    },
    {
      blocked:
        ctx.selectedWorktreeId === null
          ? "no worktree is open, so there is nowhere to open a shell."
          : null,
      command: { type: "new-terminal-tab" },
      detail: "another shell in this worktree · ⌘T",
      icon: "❯",
      id: "action:new-terminal-tab",
      kind: "action",
      label: "New terminal tab",
    },
    {
      // The same rule the chord uses, asked once (`scratchTerminal.ts`) — two
      // readings of "can this open" is one too many, and this is the one the
      // owner reads.
      blocked: scratchBlocked(
        ctx.selectedWorktreeId,
        ctx.worktreeCwd,
        ctx.worktreeCwdPending,
      ),
      command: { type: "open-scratch-terminal" },
      // The detail says the boundary, not just the chord: this row sits
      // directly under "New terminal tab", and the only thing separating them
      // is what happens afterwards.
      detail:
        "a shell that ends when you close it or leave this worktree — keeps nothing: no tab, no tmux session · ⌥⌘T",
      icon: "⌁",
      id: "action:scratch-terminal",
      kind: "action",
      label: "Scratch terminal",
    },
    {
      blocked: null,
      command: { type: "add-project" },
      detail: "point the workspace at a repository on this machine",
      icon: "+",
      id: "action:add-project",
      kind: "action",
      label: "Add project…",
    },
    {
      blocked: project === null ? NO_PROJECT : null,
      command: { type: "remove-project" },
      detail:
        project === null
          ? "forgets a path — never touches the folder"
          : `forgets ${project.path} — never touches the folder`,
      icon: "×",
      id: "action:remove-project",
      kind: "action",
      label: project === null ? "Remove project…" : `Remove ${project.name}…`,
    },
    {
      blocked:
        project === null
          ? NO_PROJECT
          : ctx.prunable === 0
            ? "nothing to prune — git can still find every worktree's directory in this project."
            : null,
      command: { type: "prune-worktrees" },
      detail:
        ctx.prunable === 0
          ? "clears `.git/worktrees/` records for checkouts that are gone"
          : `clears ${ctx.prunable} record${ctx.prunable === 1 ? "" : "s"} in \`.git/worktrees/\` — no directory is removed`,
      icon: "⌫",
      id: "action:prune-worktrees",
      kind: "action",
      label: "Prune missing worktrees…",
    },
    {
      blocked: null,
      command: { type: "toggle-sidebar" },
      detail: "⌘B",
      icon: "▤",
      id: "action:toggle-sidebar",
      kind: "action",
      label: ctx.sidebarCollapsed ? "Show the sidebar" : "Hide the sidebar",
    },
    {
      blocked: ctx.hasWorktreeColumn
        ? null
        : "there is no worktree column on the landing view.",
      command: { type: "toggle-worktrees" },
      detail: "⇧⌘B",
      icon: "▥",
      id: "action:toggle-worktrees",
      kind: "action",
      label: ctx.worktreesCollapsed
        ? "Show the worktrees"
        : "Hide the worktrees",
    },
    {
      blocked:
        ctx.selectedWorktreeId === null
          ? "no worktree is open, so there is no work surface to give away."
          : null,
      command: { side: "left", type: "toggle-solo" },
      detail: "⌥⌘B",
      icon: "⤢",
      id: "action:solo-left",
      kind: "action",
      label:
        ctx.solo === "left"
          ? "Share the surface with the right pane again"
          : "Give the terminal the whole surface",
    },
    {
      blocked:
        ctx.selectedWorktreeId === null
          ? "no worktree is open, so there is no work surface to give away."
          : null,
      command: { side: "right", type: "toggle-solo" },
      detail: "⇧⌥⌘B",
      icon: "⤢",
      id: "action:solo-right",
      kind: "action",
      label:
        ctx.solo === "right"
          ? "Share the surface with the terminal again"
          : "Give the right pane the whole surface",
    },
  ];
  return matchAll(candidates, query);
};

/** The sources, in the order an empty query lists them: where you can go
 * first, then what you can do. */
export const PALETTE_SOURCES: readonly PaletteSource[] = [
  projectSource,
  worktreeSource,
  paneSource,
  actionSource,
];

/** Every source's matches for one query, unordered — `assembleView` is what
 * puts them in an order, and it is the only thing that does. */
export function paletteMatches(
  ctx: PaletteContext,
  query: string,
  sources: readonly PaletteSource[] = PALETTE_SOURCES,
): PaletteMatch[] {
  return sources.flatMap((source) => source(ctx, query));
}
