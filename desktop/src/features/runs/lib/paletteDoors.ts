// **One palette engine, three doors** — which chord opens it, what each door
// is looking at, and the two prefixes that switch between them mid-query
// (vingilot/docs/plans/2026-08-12-an-ide-of-a-kind.md, Task 2; ADR-005's last
// paragraph).
//
// The owner's complaint, verbatim: *"cmd k buzz kısmında farklı deck kısmında
// farklı çalışıyor."* ⌘K meant upstream's message search on a chat route and
// this island's palette on /workspace, and a chord that means two things is a
// chord he has to look at the screen to use. So there is one palette now, and
// what changes between chords is **which sources it is pointed at** — never
// which surface appears.
//
// **A door is an opening query, not a mode with its own rules.** ⌘K opens on
// `go`, ⌘P on `files`, ⇧⌘P on `commands`, and from that instant the same field,
// the same ranking, the same keyboard loop and the same rows are in front of
// him. That is the whole reason this is a table of source names rather than
// three components: three surfaces is what the fork had, and it is what he
// filed the bug about.
//
// **`go` is the front door and the others are narrowings.** ⌘K's list is everything
// the host can offer — projects, worktrees, channels, recent files, panes and
// actions — because it is the front door and the muscle memory behind it is
// "take me somewhere". ⌘P and ⇧⌘P exist for the two cases where the union is
// the wrong list: a thousand files would drown six actions, and a command is
// looked for by verb rather than by name. Narrowing is therefore something the
// owner asks for, and `go` never hides anything.
//
// **The prefixes are VS Code's own**, `>` for commands and `#` for channels,
// and they work inside *any* door — including inside `files`, which is what
// makes ⌘P a place you can change your mind in rather than a dead end. `#` is
// VS Code's symbol prefix; there are no symbols here yet (ADR-005 rung 4
// refuses everything but reading), and a channel is the thing this fork has
// that a `#` names on every chat product he uses.
//
// **`?` is deliberately not here.** Ask mode is `askMode.ts`'s and reads the
// raw query, because it does not narrow a list — it replaces one. A prefix
// table that owned `?` as well would put "which sources" and "is this a
// question at all" in one function, and they are answers to different
// questions.
//
// Pure: no React, no Tauri, no storage. `paletteSources.ts` owns what a source
// produces, `paletteModel.ts` owns the one ranking over the union, and
// `usePalette.ts` holds the door the owner opened with.

/** Which chord opened the palette. Three, and each is a claimant check in
 * `paletteKeys.ts`'s header. */
export type PaletteDoor = "go" | "files" | "commands";

/** What the list is pointed at right now: the door, unless a prefix moved it.
 * `channels` is reachable only by prefix — there is no chord for it, because
 * ⌘K already lists channels and a second chord for a subset of one list is a
 * key that teaches nothing. */
export type PaletteMode = PaletteDoor | "channels";

/** The sources by name. The names are the engine's vocabulary: this module
 * decides which are asked and `paletteSources.ts` decides what each answers,
 * so neither has to import the other's decisions. */
export type PaletteSourceId =
  | "projects"
  | "worktrees"
  | "channels"
  | "recent-files"
  | "panes"
  /** The crew this workspace has minted, one row each
   * (vingilot/docs/plans/2026-08-12-the-crew.md, Task 3). Its own source rather
   * than a handful of extra `actions`, for the reason `offers` exists: the rows
   * carry the *worktree* to a crew member, so a host with no work surface has
   * nothing to pre-address them with, and the narrowing that keeps panes off a
   * chat route is the one that should keep these off it too. */
  | "crew"
  | "actions"
  | "worktree-files";

/** **Which sources each mode asks, and in the order an empty query lists
 * them.** Where you can go first, then what you can do — `paletteSources.ts`'s
 * own rule, extended rather than replaced.
 *
 * `go` lists everything except one source: the worktree's whole file tree.
 * That is not an oversight and it is the reason ⌘P exists — a checkout has
 * thousands of files and six actions, and a front door that merged them would
 * answer every query with filenames. What `go` carries instead is the **recent
 * files**, which is the short list of the ones he has actually opened.
 *
 * `files` asks that one source and nothing else, for the mirror reason: a files
 * door that also listed projects would be the front door with extra steps. */
export const MODE_SOURCES: Record<PaletteMode, readonly PaletteSourceId[]> = {
  channels: ["channels"],
  commands: ["panes", "crew", "actions"],
  files: ["worktree-files"],
  go: [
    "projects",
    "worktrees",
    "channels",
    "recent-files",
    "panes",
    "crew",
    "actions",
  ],
};

/** **The sources one mode asks, narrowed to what this host actually has.**
 *
 * `offers` is the host saying what it can answer for, and it is why the shell's
 * palette on a chat route lists channels and projects but no panes: a screen
 * with no work surface has no pane to put anything in, and a row that ran
 * nothing would be worse than no row. `undefined` is "everything this build
 * has", which is the workspace.
 *
 * It lives here rather than in `paletteSources.ts` — where it was written and
 * from where it is still re-exported — because it is a fact about
 * `MODE_SOURCES` and needs none of the source *functions* to answer. That is
 * what lets three callers share one narrowing: which sources are matched
 * (`sourcesForMode`), whether a chord this host cannot answer for should fall
 * through (`usePalette.ts`), and which doors the hint row is allowed to teach
 * (`paletteHints` below). Three copies of that rule is exactly how a hint row
 * ends up advertising a chord that does nothing. */
export function sourceIdsForMode(
  mode: PaletteMode,
  offers?: readonly PaletteSourceId[],
): readonly PaletteSourceId[] {
  const wanted = MODE_SOURCES[mode];
  return offers === undefined
    ? wanted
    : wanted.filter((id) => offers.includes(id));
}

/** The prefix grammar, in the order it is tried. One character each: a longer
 * prefix would be a word the owner has to finish before the list reacts, and
 * the reaction is the whole point of typing it. */
export const PALETTE_PREFIXES: readonly {
  prefix: string;
  mode: PaletteMode;
}[] = [
  { mode: "commands", prefix: ">" },
  { mode: "channels", prefix: "#" },
];

/** What the field currently means. */
export interface PaletteQuery {
  /** Which sources are being asked. */
  mode: PaletteMode;
  /** The text the sources are matched against — the prefix removed, and
   * trimmed, so `> new worktree` and `>new worktree` are one query. */
  query: string;
  /** The prefix that moved the mode, or `null` when the door's own mode is in
   * force. Carried so the surface can show *why* the list narrowed; a mode
   * alone cannot say whether it was chosen by a chord or by a character. */
  prefix: string | null;
}

/** Read the field.
 *
 * **The prefix wins over the door**, always: it is the more recent of the two
 * decisions, and a `>` that did nothing inside ⌘P would be a grammar with a
 * hole in it that only shows up in the door nobody tested.
 *
 * A bare prefix (`>` and nothing else) is the mode with an empty query, which
 * is the mode's whole listing — the same thing an empty query means everywhere
 * else in this palette. */
export function readPaletteQuery(door: PaletteDoor, raw: string): PaletteQuery {
  for (const entry of PALETTE_PREFIXES) {
    if (raw.startsWith(entry.prefix)) {
      return {
        mode: entry.mode,
        prefix: entry.prefix,
        query: raw.slice(entry.prefix.length).trim(),
      };
    }
  }
  return { mode: door, prefix: null, query: raw.trim() };
}

/** What the field says when it is empty. Names the door rather than the app:
 * the surface is identical in all four modes, so this line is the only thing
 * on screen that says which list is under it. */
export function palettePlaceholder(mode: PaletteMode): string {
  switch (mode) {
    case "go":
      return "Go somewhere, or do something… (? to ask)";
    case "files":
      return "Open a file in this worktree…";
    case "commands":
      return "Run a command…";
    case "channels":
      return "Go to a channel…";
  }
}

/** One line per door, and it is the whole of what the palette teaches about
 * the grammar. Three lines, not a tutorial: the surface is already open and he
 * is already typing, so anything longer is read once and never again.
 *
 * The door he is in is dropped from its own hint — a surface telling him how to
 * reach where he is standing is noise, and the two remaining lines are then
 * exactly the two places he cannot see. */
export interface PaletteHint {
  /** The keys or the character that gets there, as the palette's own glyph
   * form. */
  key: string;
  what: string;
}

const HINTS: Record<PaletteMode, PaletteHint> = {
  channels: { key: "#", what: "channels" },
  commands: { key: ">", what: "commands" },
  files: { key: "⌘P", what: "files" },
  go: { key: "⌘K", what: "anywhere" },
};

/** What the hint row draws, given where the owner is **and what this host can
 * answer for**. The mode he is in is never offered, for the reason above; nor
 * is a door with no sources here.
 *
 * **The `offers` argument is not a refinement, it is the whole honesty of this
 * row.** Without it the hint row on a chat route prints "⌘P files" — a chord
 * that deliberately falls through there (`usePalette.ts`'s `offers`) — and "`>`
 * commands", which resolves to a mode whose sources are all absent and draws
 * the empty box. `usePalette.ts` argues that "a chord this app answers with an
 * empty box is a chord the owner learns not to press"; a hint row is the one
 * surface that would teach him to press it. So the same narrowing that decides
 * which chords a host answers decides which chords it advertises — one rule,
 * read twice.
 *
 * `go` is offered wherever it has anything at all, because it is the way back
 * out of a narrowing. */
export function paletteHints(
  mode: PaletteMode,
  offers?: readonly PaletteSourceId[],
): readonly PaletteHint[] {
  const order: PaletteMode[] = ["go", "files", "commands", "channels"];
  return order
    .filter((entry) => entry !== mode)
    .filter((entry) => sourceIdsForMode(entry, offers).length > 0)
    .map((entry) => HINTS[entry])
    .slice(0, 3);
}
