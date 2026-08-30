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

import type { CrewReachRow } from "./crewReach.ts";
import type { PaletteMode, PaletteSourceId } from "./paletteDoors.ts";
import { MODE_SOURCES, sourceIdsForMode } from "./paletteDoors.ts";
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
 * `PaneContext` the work surface uses.
 *
 * The registry's own glyph is deliberately not carried: in the palette the
 * icon says *kind*, one shape repeated down the column, and a per-pane glyph
 * there would make the four pane rows look like four unrelated things. The
 * glyph is still the pane picker's, where each row is a different pane and
 * nothing else. */
export interface PaletteChoice {
  id: string;
  title: string;
  availability: PaneAvailability;
  /** The chord that puts this pane on screen, or absent for a pane with none —
   * `paneRegistry.tsx`'s `chord`, carried down by the host the same way
   * `availability` is.
   *
   * It is here rather than written into a candidate below because the palette
   * row is the door for somebody who does not know the chord, and a row that
   * did not print it would be a door that never teaches the shortcut. Only the
   * Search pane has one today. */
  chord?: string;
}

/** What the backend said about the `vingilot` shell command: where this app
 * keeps it, where a link outside would go, and whether that link is there.
 * `vingilot_shim`'s `ShimStatus`, narrowed to what one row needs.
 *
 * Declared here rather than imported from `editorClient.ts` for the reason
 * `PaletteChoice` is declared here: that module reaches for the Tauri bridge,
 * and the `node --test` run beside this file cannot load it. */
export interface ShimLinkage {
  linked: boolean;
  linkPath: string;
  shimPath: string;
}

/** One channel, as the palette needs it — **upstream's own list, narrowed**
 * (`shared/api/types.ts`'s `Channel`, read through `useChannelsQuery`, which is
 * the store the switcher and the sidebar read too).
 *
 * Declared here rather than imported for the reason `PaletteChoice` is: the
 * `node --test` run beside this file loads no upstream module. Narrowing is
 * also the boundary — this source reads four fields of a record it does not
 * own, so an upstream shape change lands as a compile error at the host rather
 * than as a palette quietly full of `undefined`. */
export interface PaletteChannel {
  id: string;
  name: string;
  /** A direct message rather than a channel. Kept because it changes what the
   * row is *called*: `#general` is a place, "alice" is a person, and printing
   * a hash in front of a person is upstream's own distinction to keep. */
  dm: boolean;
  /** The channel's topic, or `null`. Matched at a discount like any detail. */
  topic: string | null;
}

/** One file the palette can open. `worktree` is the checkout's own directory,
 * for `filesTarget.ts`'s reason: two checkouts of one project both have
 * `src/main.rs`. */
export interface PaletteFile {
  worktree: string;
  /** Worktree-relative, as the backend takes it. */
  path: string;
  /** Where to land, or `null` for the top of the file. Recents carry the line
   * he left off at; a row from the tree carries none. */
  line: number | null;
}

/** Everything the sources are allowed to know. Facts about where the owner is,
 * never callbacks — a source that could act would be a source that could not
 * be tested. */
export interface PaletteContext {
  /** The community's channels, or absent on a host that has none to offer.
   *
   * **Optional, and read as an empty listing rather than as "no answer".** The
   * two are different everywhere else in this island, and here they are not:
   * a host with no channel list has no channel rows to draw either way, and
   * the palette's own empty state ("nothing here matches") is the sentence
   * that says so. Making it required would put an array in every unit fixture
   * that has nothing to do with channels. */
  channels?: readonly PaletteChannel[];
  /** The crew this workspace has, already turned into rows by `crewReach.ts` —
   * one per minted member, carrying the errand, the pre-addressed draft and
   * (for a member with nowhere to be reached) the sentence saying so.
   *
   * Absent on a host with no crew, and an absent crew is **no rows**. That is
   * not this file's usual rule and it is deliberate: "availability is a
   * sentence, not a disappearance" is about a command this app *has* which
   * cannot run right now, and an agent that was never minted is not one — it
   * is the same absence a project that was never added has, and that draws no
   * row either. What still earns a sentence is a minted member whose door is
   * shut (Lookout with no thread open), and `crewReach.ts` puts it on the row. */
  crew?: readonly CrewReachRow[];
  /** The files he has opened, most recent first — the MRU trail's file
   * entries (`placeMru.ts`), which is a list of what he *did* rather than a
   * listing of what exists. ⌘K's file rows, and only ⌘K's. */
  recentFiles?: readonly PaletteFile[];
  /** The selected worktree's listing, as far as it has been read — ⌘P's
   * source. Lazy on purpose: the Files pane reads top-level plus the
   * directories he has opened, and this is that same listing rather than a
   * second walk of the disk. */
  worktreeFiles?: readonly PaletteFile[];
  repos: readonly Repo[];
  /** The open project's worktrees, in the nav disclosure's own order, so the
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
  sidebarCollapsed: boolean;
  /** Which side has the work surface to itself, or `null` for the split. */
  solo: "left" | "right" | null;
  /** The worktree-relative path the Files viewer currently has open, or `null`.
   *
   * **The file, not the pane.** The escape-hatch row acts on a file:line, and
   * "the Files pane is on screen" is not the same fact — the pane can be up
   * with nothing in it, which is its own designed empty state. The workspace
   * already tracks this for the place switcher (`RunsScreen`'s `openedFile`),
   * so this is a second reader of one answer rather than a second answer. */
  openFile: string | null;
  /** What the disk says about the `vingilot` command, or `null` while the
   * backend has not answered — which is every render before the first
   * `shim_status` returns, and every render on a machine where that read
   * failed. `null` is read as "not known to be installed", so the row offers
   * to install rather than claiming a state it has not checked. */
  shim: ShimLinkage | null;
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
    chord: null,
    command: { repoId: repo.id, type: "open-project" },
    detail: repo.id === ctx.selectedRepoId ? `${repo.path} · open` : repo.path,
    id: `project:${repo.id}`,
    kind: "project",
    label: repo.name,
  }));
  candidates.push({
    blocked: null,
    chord: null,
    command: { type: "open-landing" },
    detail: "the project-less landing view — runs, lanes, the composer",
    id: "project:landing",
    kind: "project",
    label: "Deck",
  });
  return matchAll(candidates, query);
};

/** The line under a worktree row. git's own numbers are the nav disclosure's
 * job and are not repeated here — what the palette needs is enough to tell two
 * similarly-named branches apart, which is the role and the run that owns it. */
function worktreeDetail(wt: Worktree): string {
  const parts = [wt.role === "primary" ? "the project's checkout" : wt.role];
  if (wt.owner_run_status !== null) parts.push(wt.owner_run_status);
  return parts.join(" · ");
}

/** ⌘1…⌘9 select the Nth worktree (`terminalKeys.ts`'s `switch-worktree`,
 * indexed into the array `WorkSurface` is handed). This source is given that
 * same array, so the row's place in it *is* the digit — which is why the chord
 * is derived here rather than written down anywhere. Past nine there is no
 * chord, because there is no ⌘10. */
function worktreeChord(index: number): string | null {
  return index < 9 ? `⌘${index + 1}` : null;
}

export const worktreeSource: PaletteSource = (ctx, query) => {
  const candidates: Candidate[] = ctx.worktrees.map((wt, index) => ({
    blocked: null,
    chord: worktreeChord(index),
    command: { bindingId: wt.binding_id, type: "open-worktree" },
    detail:
      wt.binding_id === ctx.selectedWorktreeId
        ? `${worktreeDetail(wt)} · open`
        : worktreeDetail(wt),
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
    chord: choice.chord ?? null,
    command: { pane: choice.id, type: "choose-pane" },
    detail: `show the ${choice.title} pane beside the terminal`,
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

/** **The app-wide rows** — offered by every host, workspace or not (P1.1,
 * owner veto 2). One row today: "Appearance", the palette's door to Settings →
 * Appearance, which is the surface that replaced the top bar's vetoed tray.
 * Never blocked — Settings exists on every screen. */
export const appSource: PaletteSource = (_ctx, query) => {
  const candidates: Candidate[] = [
    {
      blocked: null,
      chord: null,
      command: { type: "open-appearance" },
      detail: "sidebar wash, accent and theme — opens Settings → Appearance",
      id: "app:appearance",
      kind: "action",
      label: "Appearance",
    },
    {
      // The message-search dialog's door (P1.1 veto 1): the sidebar box that
      // used to open it is gone, and this row is what replaced the click.
      blocked: null,
      chord: null,
      command: { type: "open-message-search" },
      detail: "full-text search across channels and direct messages",
      id: "app:search",
      kind: "action",
      label: "Search messages",
    },
  ];
  return matchAll(candidates, query);
};

export const actionSource: PaletteSource = (ctx, query) => {
  const project = openProject(ctx);
  const candidates: Candidate[] = [
    {
      blocked: project === null ? NO_PROJECT : null,
      chord: null,
      command: { type: "new-worktree" },
      detail: "branch off this project into its own checkout",
      id: "action:new-worktree",
      kind: "action",
      label: "New worktree…",
    },
    {
      blocked: project === null ? NO_PROJECT : null,
      chord: null,
      // What the plan says, and what is in it, are not this source's to know:
      // the document is read when the dialog opens, which is the moment the
      // branch name has to be derived from. A row carrying a name read at
      // palette-open would offer a branch from a plan the owner had since
      // edited.
      command: { type: "plan-to-worktree" },
      detail: "a branch from this project's plan, with the plan copied into it",
      id: "action:plan-to-worktree",
      kind: "action",
      label: "Turn this plan into a worktree…",
    },
    {
      blocked:
        ctx.selectedWorktreeId === null
          ? "no worktree is open, so there is nowhere to open a shell."
          : null,
      chord: "⌘T",
      command: { type: "new-terminal-tab" },
      detail: "another shell in this worktree",
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
      chord: "⌥⌘T",
      command: { type: "open-scratch-terminal" },
      // The detail says the boundary: this row sits directly under "New
      // terminal tab", and the only thing separating them is what happens
      // afterwards.
      detail:
        "a shell that ends when you close it or leave this worktree — keeps nothing: no tab, no tmux session",
      id: "action:scratch-terminal",
      kind: "action",
      label: "Scratch terminal",
    },
    {
      // Never blocked, and that is the feature rather than an oversight: there is
      // one buffer for everything (`scratchMarkdown.ts`), so unlike every row
      // above it this one needs no project, no worktree and no checkout on this
      // machine. A condition that cannot occur is a sentence nobody can ever
      // read, so there is none.
      blocked: null,
      chord: "⇧⌘M",
      command: { type: "open-scratch-markdown" },
      // Directly under "Scratch terminal", and the detail is the mirror of that
      // row's: the two sit together because they are one gesture with a letter
      // swapped, and what separates them is what happens to what you put in them.
      detail:
        "one throwaway markdown buffer, the same wherever you are — kept in ~/.vingilot/scratch.md on this machine, and never sent anywhere",
      id: "action:scratch-markdown",
      kind: "action",
      label: "Scratch markdown",
    },
    {
      // Never blocked, and that is the point: this is the row for someone who
      // does not know the chord, so a state in which it refused would be a
      // state in which the workspace's keys are unfindable.
      blocked: null,
      chord: "⌘/",
      command: { type: "open-cheatsheet" },
      detail: "every chord this workspace binds, on one surface",
      id: "action:cheatsheet",
      kind: "action",
      label: "Keyboard shortcuts",
    },
    {
      // The escape hatch's chord-less door
      // (vingilot/docs/plans/2026-08-12-an-ide-of-a-kind.md, Task 1). Blocked
      // on the *file*, not on the worktree: this row acts on what the viewer
      // has open, and with nothing open there is no file:line to carry — which
      // is the whole difference between this and `open -a`.
      blocked:
        ctx.openFile === null
          ? "no file is open in the viewer, so there is none to open elsewhere. Pick one in the Files pane, or use the button on a search hit or a changed file."
          : null,
      chord: null,
      command: { type: "open-in-editor" },
      detail:
        ctx.openFile === null
          ? "Cursor, VS Code or Zed, at the line you are on"
          : `${ctx.openFile} in Cursor, VS Code or Zed — at the line you are on`,
      id: "action:open-in-editor",
      kind: "action",
      label: "Open the current file in an editor",
    },
    {
      // Never done for him: the app's own terminals already have `vingilot` on
      // their PATH, and this row is the *outside* half — a symlink into
      // /usr/local/bin, which is a write outside this app's directories and
      // therefore his to authorise (ADR-003).
      //
      // **The label is a reading of the disk, not of what the last install
      // returned** (`vingilot_shim`'s `shim_status`). A row that still said
      // "Install…" over a link that is already there would be offering work
      // that has been done, and once it is done the honest state is a blocked
      // row carrying the link — the same shape "nothing to prune" has, three
      // rows below.
      //
      // **Both ends of the link are in the sentence**, because a blocked row
      // shows its reason *instead of* its detail (`CommandPalette.tsx`) — so
      // this line is the only place "installed" can be made checkable, and a
      // path carried across the bridge and never printed would be a fact
      // nobody can read.
      blocked:
        ctx.shim?.linked === true
          ? `${ctx.shim.linkPath} already points at ${ctx.shim.shimPath} — there is nothing left to install.`
          : null,
      chord: null,
      command: { type: "install-shim" },
      // Unconditional: the detail says what the row *is*, and the row is the
      // same act whether or not it has been done.
      detail:
        "symlinks `vingilot` into /usr/local/bin so `vingilot <file>:<line>` works in any terminal — this app's own terminals already have it",
      id: "action:install-shim",
      kind: "action",
      label:
        ctx.shim?.linked === true
          ? "vingilot command installed"
          : "Install vingilot command…",
    },
    {
      blocked: null,
      chord: null,
      command: { type: "add-project" },
      detail: "point the workspace at a repository on this machine",
      id: "action:add-project",
      kind: "action",
      label: "Add project…",
    },
    {
      blocked: project === null ? NO_PROJECT : null,
      chord: null,
      command: { type: "remove-project" },
      detail:
        project === null
          ? "forgets a path — never touches the folder"
          : `forgets ${project.path} — never touches the folder`,
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
      chord: null,
      command: { type: "prune-worktrees" },
      detail:
        ctx.prunable === 0
          ? "clears `.git/worktrees/` records for checkouts that are gone"
          : `clears ${ctx.prunable} record${ctx.prunable === 1 ? "" : "s"} in \`.git/worktrees/\` — no directory is removed`,
      id: "action:prune-worktrees",
      kind: "action",
      label: "Prune missing worktrees…",
    },
    // The four layout toggles carried nothing but their chord as a detail,
    // which left the second line saying what the key column now says and the
    // row saying nothing about *what* it moves. Each names the thing it acts
    // on instead, which is also what makes it findable by that name — kept
    // short, because the matcher will find a subsequence in any long enough
    // sentence and a wordy second line buys those matches for every query.
    {
      blocked: null,
      chord: "⌘B",
      command: { type: "toggle-sidebar" },
      detail: "the app's own sidebar, left of the workspace",
      id: "action:toggle-sidebar",
      kind: "action",
      label: ctx.sidebarCollapsed ? "Show the sidebar" : "Hide the sidebar",
    },
    {
      blocked:
        ctx.selectedWorktreeId === null
          ? "no worktree is open, so there is no work surface to give away."
          : null,
      chord: "⌥⌘B",
      command: { side: "left", type: "toggle-solo" },
      detail: "the split between the terminal and the right pane",
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
      chord: "⇧⌥⌘B",
      command: { side: "right", type: "toggle-solo" },
      detail: "the same split, from the right pane's side",
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

/** **One row per crew member this workspace has** — "Ask Mate…", "Have Lookout
 * review this worktree", "Ask Navigator for a plan"
 * (vingilot/docs/plans/2026-08-12-the-crew.md, Task 3).
 *
 * The rows arrive built (`crewReach.ts`), the way `paneChoices` does and for
 * the same reason: what a crew member is *called* is the Captain's rename, what
 * it is *asked* is an errand table, and where a draft can land is a channel
 * pointer — none of which this file should hold a second opinion about. What is
 * left here is what every source does, which is to turn them into candidates
 * and match them.
 *
 * `kind: "action"` rather than a kind of their own: the palette draws one icon
 * per kind, and these rows are verbs — "have Lookout review this" belongs
 * beside "New worktree…" in the eye's grouping, not in a sixth column of
 * iconography nobody asked for. */
export const crewSource: PaletteSource = (ctx, query) => {
  const candidates: Candidate[] = (ctx.crew ?? []).map((row) => ({
    blocked: row.blocked,
    chord: null,
    command: { personaId: row.personaId, type: "reach-crew" },
    detail: row.detail,
    // The persona id, not the pubkey: a recent is recorded against this
    // (`paletteStore.ts`), and a crew member deleted and minted again is the
    // same errand under a new key, which would silently drop its place in the
    // recents.
    id: `crew:${row.personaId}`,
    kind: "action",
    label: row.label,
  }));
  return matchAll(candidates, query);
};

/** **Upstream's channel list, read as a source and not forked.**
 *
 * The rows are built from `useChannelsQuery`'s records — the same store
 * `AppShell` hands its sidebar, its switcher and `TopbarSearch` — and selecting
 * one lands through `useAppNavigation`'s `goChannel`, which is where upstream's
 * own switcher would have gone. Nothing about their dialog is copied here: what
 * this file takes is a list of channels, which is data, and ADR-001's rule is
 * about behaviour.
 *
 * A DM keeps its person's name and a channel gains its hash, because that is
 * how both are written everywhere else in this app and a palette that renamed
 * them would be a second vocabulary for one set of places. */
export const channelSource: PaletteSource = (ctx, query) => {
  const candidates: Candidate[] = (ctx.channels ?? []).map((channel) => ({
    blocked: null,
    chord: null,
    command: { channelId: channel.id, type: "open-channel" },
    detail:
      channel.topic !== null && channel.topic !== ""
        ? channel.topic
        : channel.dm
          ? "a direct message"
          : "a channel in this community",
    id: `channel:${channel.id}`,
    kind: "channel",
    label: channel.dm ? channel.name : `#${channel.name}`,
  }));
  return matchAll(candidates, query);
};

/** What separates a checkout from a path inside it, in a file row's id.
 *
 * NUL, written as an escape rather than typed: it is the one byte a path cannot
 * contain and no worktree directory carries, so no filename can fake a boundary
 * and spell two files into one id. `placeMru.ts`'s own separator, for its
 * reason — and an id is what a recent is recorded as. */
const FILE_SEP = "\u0000";

/** The last segment of a worktree-relative path — what a file is *called*, and
 * therefore what is matched first. */
function fileName(path: string): string {
  const at = path.lastIndexOf("/");
  return at === -1 ? path : path.slice(at + 1);
}

/** A file row. The name is the label and the whole path is the detail, which is
 * the arrangement `matchCandidate`'s label-then-detail rule was built for:
 * `main.rs` typed against forty `main.rs`es matches every label equally and
 * then the path is what tells them apart, and typing part of the path finds it
 * at the detail discount. */
function fileCandidate(file: PaletteFile): Candidate {
  return {
    blocked: null,
    chord: null,
    command: {
      line: file.line,
      path: file.path,
      type: "open-file",
      worktree: file.worktree,
    },
    detail: file.path,
    // Scoped by worktree, because the recents list is keyed on this id and two
    // checkouts of one project both have `src/main.rs`. NUL is the one byte a
    // path cannot contain — `placeMru.ts`'s own separator, for its reason.
    id: `file:${file.worktree}${FILE_SEP}${file.path}`,
    kind: "file",
    label: fileName(file.path),
  };
}

/** ⌘K's file rows: the ones he has actually opened. */
export const recentFileSource: PaletteSource = (ctx, query) =>
  matchAll((ctx.recentFiles ?? []).map(fileCandidate), query);

/** ⌘P's rows: the selected worktree's listing. */
export const worktreeFileSource: PaletteSource = (ctx, query) =>
  matchAll((ctx.worktreeFiles ?? []).map(fileCandidate), query);

/** Every source by the name `paletteDoors.ts` knows it as. The two modules meet
 * here and nowhere else: doors decide *which*, this file decides *what*. */
export const SOURCES_BY_ID: Record<PaletteSourceId, PaletteSource> = {
  actions: actionSource,
  app: appSource,
  channels: channelSource,
  crew: crewSource,
  panes: paneSource,
  projects: projectSource,
  "recent-files": recentFileSource,
  worktrees: worktreeSource,
  "worktree-files": worktreeFileSource,
};

/** The sources, in the order an empty query lists them: where you can go
 * first, then what you can do. **The `go` door's own list**, which is what ⌘K
 * has always shown — kept under its old name so that every caller and every
 * test written against it still means the same thing. */
export const PALETTE_SOURCES: readonly PaletteSource[] = MODE_SOURCES.go.map(
  (id) => SOURCES_BY_ID[id],
);

/** Every source's matches for one query, unordered — `assembleView` is what
 * puts them in an order, and it is the only thing that does. */
export function paletteMatches(
  ctx: PaletteContext,
  query: string,
  sources: readonly PaletteSource[] = PALETTE_SOURCES,
): PaletteMatch[] {
  return sources.flatMap((source) => source(ctx, query));
}

/** The sources one mode asks, narrowed to what this host actually has.
 *
 * **`offers` is the host saying what it can answer for**, and it is why the
 * shell's palette on a chat route lists channels and projects but no panes: a
 * screen with no work surface has no pane to put anything in, and a row that
 * ran nothing would be worse than no row. It is also what makes a door *fall
 * through* rather than open on an empty box — see `usePalette.ts`'s
 * `doorOffers`.
 *
 * `undefined` is "everything this build has", which is the workspace. */
export function sourcesForMode(
  mode: PaletteMode,
  offers?: readonly PaletteSourceId[],
): readonly PaletteSource[] {
  return sourceIdsForMode(mode, offers).map((id) => SOURCES_BY_ID[id]);
}

/** The same narrowing, by name — **`paletteDoors.ts`'s now**, and re-exported
 * here because it was this module's and its callers named it here. It moved for
 * one reason: the hint row has to ask the same question ("does this door have
 * anything on this host?") and it cannot import this file, which builds every
 * source function to answer it. */
export { sourceIdsForMode };
