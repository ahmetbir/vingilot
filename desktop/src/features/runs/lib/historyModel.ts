// What git already knows about this checkout, as data the History pane renders
// and nothing else (vingilot/docs/plans/2026-08-11-what-sent-him-to-vscode.md,
// Task 4).
//
// The wire shapes of `worktree_log`, `commit_diff` and `worktree_status`
// (desktop/src-tauri/src/vingilot_worktree/{log,commit_patch,status}.rs) plus
// the copy that goes with them. Pure: no Tauri, no React, no DOM.
//
// **Everything this module describes is a read.** There is no stage, no
// unstage, no discard, no commit, and no shape here that could carry one — the
// backend modules say the same thing about themselves and prove it with a test
// each. Task 4 drew that line and asked for it to be said out loud: showing what
// would be committed is a different promise from committing, the second one has
// a destructive failure mode, and the terminal is one keystroke away in the pane
// next door.
//
// **An empty read is "no answer", never "nothing there."** `logReading` and
// `statusReading` below cannot produce "no commits" or "nothing to commit" from
// anything but an answer git actually gave — the same rule `searchModel.ts`
// keeps about "no matches", and for the same reason: a sentence claiming the
// owner's repository is empty may only be said when it was read.
//
// **The limits are the backend's, not this module's.** Every cap an answer was
// produced under travels back inside it (`limit`, `more`, `omitted`), so the
// sentence on screen says the number that was actually applied. A second copy of
// "200" over here would be right until the day one of them moved.

import {
  type DiffChange,
  fileNote,
  type WorktreeDiff,
} from "@/features/runs/lib/worktreeDiff";
import type { WorktreeError } from "@/features/runs/lib/worktreePlan";

// ---------------------------------------------------------------------------
// what the backend answers
// ---------------------------------------------------------------------------

/** One commit, as the pane prints it. `vingilot_worktree::log::Commit`. */
export interface Commit {
  /** The full hash. What every later call is made with — an abbreviation is for
   * reading, and can become ambiguous as a repository grows. */
  hash: string;
  /** git's own abbreviation, for display only. */
  short: string;
  author: string;
  /** ISO-8601 with the author's own offset (`%aI`). */
  date: string;
  /** Ref names pointing here — `HEAD -> main`, `tag: v1`. Empty for almost
   * every commit, which is why it is a list rather than a string. */
  refs: string[];
  /** This commit's parents, in git's own order (`%P`). Empty for a root
   * commit, which is a fact and not a gap.
   *
   * **The field the lane graph is drawn from** (`commitGraph.ts`). Until
   * P4.1 the backend did not report it, which is why P3's History panel drew
   * a column of dots and said so rather than inventing a topology. */
  parents: string[];
  subject: string;
}

/** One page of history. `vingilot_worktree::log::LogPage`. */
export interface LogPage {
  commits: Commit[];
  /** The page size this answer was produced under. */
  limit: number;
  /** There is at least one commit older than the last one listed — read one
   * past the page rather than inferred from a full page. */
  more: boolean;
  /** What to ask the next page with. `null` for a page with nothing on it. */
  cursor: string | null;
}

/** One commit's patch. `vingilot_worktree::commit_patch::CommitPatch`.
 *
 * `diff` is the very same `WorktreeDiff` the Diff pane renders, which is what
 * lets `PatchView` draw both — Task 4's "do not fork the patch component". */
export interface CommitPatch {
  commit: Commit;
  /** The commit this was read against — the first parent — or `null` for the
   * first commit in the repository. */
  parent: string | null;
  /** More than one parent, so the patch below is what this merge brought into
   * its first parent's branch and not the whole of what it joined. */
  merge: boolean;
  diff: WorktreeDiff;
}

/** One file in one of git's status columns.
 * `vingilot_worktree::status::StatusEntry`. */
export interface StatusEntry {
  path: string;
  /** Where a renamed or copied file came from. */
  oldPath: string | null;
  change: DiffChange;
  /** git's own two-character `XY`, carried verbatim so a state this build has
   * no word for is still shown as what git called it. */
  code: string;
}

/** `vingilot_worktree::status::WorktreeStatus`. */
export interface WorktreeStatus {
  /** Index against HEAD: what would be committed. */
  staged: StatusEntry[];
  /** Working tree against the index: what would not. */
  unstaged: StatusEntry[];
  untracked: StatusEntry[];
  conflicted: StatusEntry[];
  /** The cap all four lists were read under. */
  limit: number;
  /** Entries beyond the cap, across all four lists. */
  omitted: number;
}

// ---------------------------------------------------------------------------
// tolerant reads of the wire
// ---------------------------------------------------------------------------
//
// The same boundary discipline every other read in this feature keeps: a record
// this build cannot make sense of is dropped rather than thrown on, because one
// unreadable row must not cost the owner the other two hundred.

function str(v: Record<string, unknown>, key: string): string {
  const value = v[key];
  return typeof value === "string" ? value : "";
}

function num(v: Record<string, unknown>, key: string): number {
  const value = v[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function obj(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) return null;
  return value as Record<string, unknown>;
}

/** One commit record, or `null` for one with no hash — a row keyed by nothing
 * cannot be selected, opened, or paged from, so it is not a row. */
export function readCommit(value: unknown): Commit | null {
  const v = obj(value);
  if (v === null) return null;
  const hash = str(v, "hash");
  if (hash === "") return null;
  return {
    author: str(v, "author"),
    date: str(v, "date"),
    hash,
    // An answer with no `parents` reads as a root commit's empty list, which
    // draws a lane that ends — never as a lane that continues into a hash
    // nothing named.
    parents: Array.isArray(v.parents)
      ? v.parents.filter((hash): hash is string => typeof hash === "string")
      : [],
    refs: Array.isArray(v.refs)
      ? v.refs.filter((ref): ref is string => typeof ref === "string")
      : [],
    short: str(v, "short") === "" ? hash.slice(0, 7) : str(v, "short"),
    subject: str(v, "subject"),
  };
}

export function readLogPage(value: unknown): LogPage | null {
  const v = obj(value);
  if (v === null) return null;
  return {
    commits: Array.isArray(v.commits)
      ? v.commits
          .map(readCommit)
          .filter((commit): commit is Commit => commit !== null)
      : [],
    cursor: typeof v.cursor === "string" && v.cursor !== "" ? v.cursor : null,
    limit: num(v, "limit"),
    more: v.more === true,
  };
}

function readStatusEntry(value: unknown): StatusEntry | null {
  const v = obj(value);
  if (v === null) return null;
  const path = str(v, "path");
  if (path === "") return null;
  return {
    change: readChange(v.change),
    code: str(v, "code"),
    oldPath: typeof v.oldPath === "string" ? v.oldPath : null,
    path,
  };
}

/** The change letters `worktreeDiff.ts` already names, read the same way. Kept
 * as one list rather than imported as a runtime value because `DiffChange` is a
 * type: a change this build has no name for reads as `other`, which is what the
 * backend calls it too. */
const CHANGES: readonly DiffChange[] = [
  "added",
  "modified",
  "deleted",
  "renamed",
  "copied",
  "type-changed",
  "untracked",
  "other",
];

function readChange(value: unknown): DiffChange {
  return CHANGES.find((change) => change === value) ?? "other";
}

function readEntries(value: unknown): StatusEntry[] {
  return Array.isArray(value)
    ? value
        .map(readStatusEntry)
        .filter((entry): entry is StatusEntry => entry !== null)
    : [];
}

export function readWorktreeStatus(value: unknown): WorktreeStatus | null {
  const v = obj(value);
  if (v === null) return null;
  return {
    conflicted: readEntries(v.conflicted),
    limit: num(v, "limit"),
    omitted: num(v, "omitted"),
    staged: readEntries(v.staged),
    unstaged: readEntries(v.unstaged),
    untracked: readEntries(v.untracked),
  };
}

/** `readWorktreeDiff` is `worktreeDiff.ts`'s, deliberately — the diff inside a
 * commit's answer is the same shape the Diff pane reads, and a second reader
 * here would be the fork of it that Task 4 forbade one level up. */
export function readCommitPatch(
  value: unknown,
  readDiff: (raw: unknown) => WorktreeDiff | null,
): CommitPatch | null {
  const v = obj(value);
  if (v === null) return null;
  const commit = readCommit(v.commit);
  if (commit === null) return null;
  const diff = readDiff(v.diff);
  if (diff === null) return null;
  return {
    commit,
    diff,
    merge: v.merge === true,
    parent: typeof v.parent === "string" && v.parent !== "" ? v.parent : null,
  };
}

// ---------------------------------------------------------------------------
// source control: git's four columns, as sections
// ---------------------------------------------------------------------------

export type StatusSectionId =
  | "conflicted"
  | "staged"
  | "unstaged"
  | "untracked";

export interface StatusSection {
  id: StatusSectionId;
  title: string;
  /** What this column IS, in one clause — because "staged" and "unstaged" are
   * git's words for two questions the owner does not have to remember the
   * difference between at 2am. */
  note: string;
  entries: StatusEntry[];
}

/** The four columns, in the order they are worth reading, with the empty ones
 * left out.
 *
 * **Conflicted first**, because it is the one that blocks everything else, and
 * a merge conflict listed under two other headings is one that gets scrolled
 * past. Then staged, unstaged, untracked — index outward, which is the order
 * `git status` itself prints them in.
 *
 * **A file can be in two sections at once and appears in both.** `AM` is a file
 * added to the index and then edited again; folding it into one row would hide
 * precisely the state this section exists to show. */
export function statusSections(status: WorktreeStatus): StatusSection[] {
  const all: StatusSection[] = [
    {
      entries: status.conflicted,
      id: "conflicted",
      note: "both sides changed these; git stopped and left them to you.",
      title: "Conflicted",
    },
    {
      entries: status.staged,
      id: "staged",
      note: "in the index — this is what a commit would contain.",
      title: "Staged",
    },
    {
      entries: status.unstaged,
      id: "unstaged",
      note: "changed on disk but not in the index — a commit would not contain this.",
      title: "Not staged",
    },
    {
      entries: status.untracked,
      id: "untracked",
      note: "git has never been told about these files.",
      title: "Untracked",
    },
  ];
  return all.filter((section) => section.entries.length > 0);
}

/** How many entries are listed, across every section. */
export function statusCount(status: WorktreeStatus): number {
  return (
    status.conflicted.length +
    status.staged.length +
    status.unstaged.length +
    status.untracked.length
  );
}

/** The line above the sections. **Only ever called with an answer** — the
 * "clean" branch is a claim about the owner's checkout, and `statusReading`
 * below is what guarantees nothing reaches here that git did not say. */
export function statusHeadline(status: WorktreeStatus): string {
  const parts: string[] = [];
  if (status.conflicted.length > 0) {
    parts.push(`${status.conflicted.length} conflicted`);
  }
  if (status.staged.length > 0) parts.push(`${status.staged.length} staged`);
  if (status.unstaged.length > 0) {
    parts.push(`${status.unstaged.length} not staged`);
  }
  if (status.untracked.length > 0) {
    parts.push(`${status.untracked.length} untracked`);
  }
  if (parts.length === 0) {
    return "nothing to commit — the working tree is clean.";
  }
  return parts.join(", ");
}

/** What the status answer left out, in words, or `null` when it left nothing
 * out. The cap is the backend's and is quoted from the answer, so the number
 * here is the number that was applied. */
export function statusOmission(status: WorktreeStatus): string | null {
  if (status.omitted <= 0) return null;
  return (
    `${status.omitted} more entr${status.omitted === 1 ? "y" : "ies"} not listed ` +
    `(this stops at ${status.limit}) — the counts above are of what is listed, ` +
    "not of the worktree."
  );
}

// ---------------------------------------------------------------------------
// commits
// ---------------------------------------------------------------------------

/** The author date as the row prints it: `2026-08-12 02:18`.
 *
 * Sliced out of git's own `%aI` rather than put through `Intl` or a `Date`.
 * Two reasons, and the second is the one that matters. A `Date` would re-zone
 * the instant into whoever is *reading*, so a commit written at 14:00 in Berlin
 * reads as 15:00 in Istanbul — but "when did I write this" is a question about
 * the author's clock, and git already answered it with the offset attached.
 * And a locale-formatted string is a different string on a different machine,
 * which is a test that passes where it was written and nowhere else.
 *
 * A date this does not recognise is returned as itself: it is git's own field,
 * and showing it raw beats inventing a plausible one. */
export function commitDate(iso: string): string {
  const found = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso);
  return found === null ? iso : `${found[1]} ${found[2]}`;
}

/** The subject as the row prints it. A commit git allowed to have an empty
 * subject says so, rather than rendering a blank row the owner cannot tell from
 * a broken one. */
export function commitSubject(commit: Commit): string {
  return commit.subject === "" ? "(no subject)" : commit.subject;
}

/** One page appended to what is already on screen, without duplicating a row he
 * has already read.
 *
 * The backend pages by cursor and skips the cursor commit, so an overlap should
 * be impossible — this is the guard for the case where it is not (a page asked
 * for twice, an answer that arrived out of order). Dropping by hash rather than
 * trusting the sequence, because a commit drawn twice is a history the owner
 * cannot count. */
export function appendPage(
  existing: readonly Commit[],
  page: LogPage,
): Commit[] {
  const seen = new Set(existing.map((commit) => commit.hash));
  const added = page.commits.filter((commit) => !seen.has(commit.hash));
  return [...existing, ...added];
}

/** What the "older" control says, or `null` when there is nothing older.
 *
 * Says the count it has rather than the cap, so the sentence and the list on
 * screen cannot contradict each other. */
export function olderNote(shown: number, more: boolean): string | null {
  if (!more) return null;
  return `${shown} commits shown — there are older ones.`;
}

// ---------------------------------------------------------------------------
// the pane's rows, as one navigable list
// ---------------------------------------------------------------------------
//
// Source control and history are one pane (see `HistoryPane.tsx` for why), so
// they are one list to the keyboard: `j`/`k` walk from the last untracked file
// straight into the newest commit without a Tab in between. A second cursor per
// section would be two things to keep track of for one question.

export type HistoryRow =
  | {
      kind: "status";
      key: string;
      section: StatusSectionId;
      entry: StatusEntry;
    }
  | { kind: "commit"; key: string; commit: Commit };

/** A row's key. Prefixed by kind and, for a status row, by section: the same
 * path is a different row in "Staged" and in "Not staged", and those two rows
 * show different things. */
export function rowKey(row: HistoryRow): string {
  return row.key;
}

function statusRowKey(section: StatusSectionId, path: string): string {
  return `status:${section}:${path}`;
}

export function commitRowKey(hash: string): string {
  return `commit:${hash}`;
}

/** Every row on screen, in the order they are drawn. */
export function historyRows(
  sections: readonly StatusSection[],
  commits: readonly Commit[],
): HistoryRow[] {
  const status: HistoryRow[] = sections.flatMap((section) =>
    section.entries.map((entry) => ({
      entry,
      key: statusRowKey(section.id, entry.path),
      kind: "status" as const,
      section: section.id,
    })),
  );
  const history: HistoryRow[] = commits.map((commit) => ({
    commit,
    key: commitRowKey(commit.hash),
    kind: "commit" as const,
  }));
  return [...status, ...history];
}

export function rowFor(
  rows: readonly HistoryRow[],
  key: string | null,
): HistoryRow | null {
  if (key === null) return null;
  return rows.find((row) => row.key === key) ?? null;
}

/** Where the cursor lands after a step.
 *
 * Clamped at both ends rather than wrapping, the same decision `diffKeys.ts`
 * made and for the same reason: a history is a list, not a ring, and `j` held
 * down at the bottom silently starting again at the top is how the owner ends up
 * reading the wrong commit. `null` for an empty list. */
export function stepRow(
  rows: readonly HistoryRow[],
  selected: string | null,
  dir: -1 | 1,
): string | null {
  if (rows.length === 0) return null;
  const at = rows.findIndex((row) => row.key === selected);
  const from = at < 0 ? (dir === 1 ? -1 : rows.length) : at;
  const next = Math.min(Math.max(from + dir, 0), rows.length - 1);
  return rows[next].key;
}

// ---------------------------------------------------------------------------
// how the pane divides itself
// ---------------------------------------------------------------------------

// `historyLayout` — the list-vs-patch division of one pane — was deleted with
// the division itself: the lists live in the Deck sidebar's History accordion
// member now and the patch has the pane whole at every width
// (vingilot/docs/plans/2026-08-14-pane-nav-absorb.md, Task 5 — honest
// deletion, not a flag).

// ---------------------------------------------------------------------------
// readings: what the pane is entitled to say, and when
// ---------------------------------------------------------------------------

export type LogState =
  | { status: "idle" }
  | { status: "reading" }
  | { status: "answered"; commits: Commit[]; more: boolean }
  | { status: "refused"; error: WorktreeError };

export interface Reading {
  /** Which of the four things is on screen. The testid says which, so a spec
   * can tell "still reading" from "nothing there" — the distinction this whole
   * module exists to keep. */
  show: "rows" | "reading" | "empty" | "refused";
  note: string | null;
}

/** What the history half may say.
 *
 * **"no commits" is only reachable from `answered`.** A repository that has been
 * `git init`ed and never committed really does have no history, and the backend
 * says so deliberately rather than failing — but a pane that drew the same
 * sentence while the read was in flight would be claiming it about every
 * repository for the first few hundred milliseconds. */
export function logReading(state: LogState, refusal: string): Reading {
  switch (state.status) {
    case "idle":
      return { note: null, show: "reading" };
    case "reading":
      return { note: "reading this worktree's history…", show: "reading" };
    case "refused":
      return { note: refusal, show: "refused" };
    case "answered":
      if (state.commits.length === 0) {
        return {
          note: "no commits yet — nothing has been committed in this worktree.",
          show: "empty",
        };
      }
      return {
        note: olderNote(state.commits.length, state.more),
        show: "rows",
      };
  }
}

export type StatusState =
  | { status: "idle" }
  | { status: "reading" }
  | { status: "answered"; answer: WorktreeStatus }
  | { status: "refused"; error: WorktreeError };

/** What the source-control half may say. Same rule: "the working tree is clean"
 * is a claim about the owner's checkout and is only reachable from an answer. */
export function statusReading(state: StatusState, refusal: string): Reading {
  switch (state.status) {
    case "idle":
      return { note: null, show: "reading" };
    case "reading":
      return { note: "reading this worktree's status…", show: "reading" };
    case "refused":
      return { note: refusal, show: "refused" };
    case "answered":
      if (statusCount(state.answer) === 0) {
        return { note: statusHeadline(state.answer), show: "empty" };
      }
      return { note: statusOmission(state.answer), show: "rows" };
  }
}

// ---------------------------------------------------------------------------
// the patch half
// ---------------------------------------------------------------------------

/** What a commit's patch header says about where the left-hand side came from.
 *
 * The merge sentence is the one that earns its place: `git show` on a merge
 * prints no patch at all, and the backend deliberately reads the first parent
 * instead — which is a *choice among several true answers*, so it is said out
 * loud rather than left to look like the whole story. */
export function commitPatchNote(answer: CommitPatch): string | null {
  if (answer.merge) {
    return (
      `a merge — this is what it brought into its first parent ` +
      `(${answer.parent === null ? "none" : answer.parent.slice(0, 7)}), ` +
      "not the whole of what it joined."
    );
  }
  if (answer.parent === null) {
    return "the first commit in this repository — read against the empty tree.";
  }
  return null;
}

/** What a status file's patch is read against. HEAD, and `statusPatch` below
 * says at length what that therefore is and why it is not a fourth backend
 * command. In the model rather than the pane because the pane's read
 * (`gitWorktreeDiff(cwd, STATUS_BASE)`) and the patch header's scope sentence
 * ("against HEAD…") both name it, and two copies of the base is how the
 * sentence drifts from the read. */
export const STATUS_BASE = "HEAD";

/** One status file's patch, taken out of a worktree diff read against HEAD.
 *
 * **Why this is where a source-control file's patch comes from, and what it
 * therefore is.** `worktree_diff` answers one question — "how does this checkout
 * differ from a base" — and against `HEAD` that is *staged and unstaged
 * together*. It is not git's two columns read separately, and this file says so
 * rather than labelling a combined patch "Staged". The alternative was a fourth
 * backend command for `git diff --cached`, and `diff.rs` is 986 lines against a
 * hard 1000-line ceiling: growing it for this would have meant splitting the
 * file that every other patch in the app comes out of, in the same change that
 * added a pane. The line Task 4 drew was at reading, and this reads.
 *
 * A file git's status lists that the diff does not mention is reported as
 * exactly that, rather than as an empty patch — the two are separate reads and
 * can disagree if the tree moved between them. */
export interface FilePatch {
  path: string;
  patch: string;
  note: string | null;
}

export function statusPatch(
  diff: WorktreeDiff,
  entry: StatusEntry,
): FilePatch | null {
  // No guard for a collapsed directory here, deliberately: `worktree_diff`
  // answers files, and a file's path never ends in `/`, so the find below cannot
  // match one and this returns `null` on its own. A guard would be a branch
  // nothing could reach and therefore nothing could test. What the directory
  // case changes is the *sentence* — `missingPatchNote`.
  const found = diff.files.find(
    (file) => file.path === entry.path || file.oldPath === entry.path,
  );
  if (found === undefined) return null;
  return {
    note: fileNote(found, diff.limits),
    patch: found.patch,
    path: found.path,
  };
}

/** The sentence for a status row the HEAD diff has nothing to say about.
 *
 * **Two different things look the same from here and only one of them is a
 * race.** A collapsed directory is deterministic and permanent: `worktree_diff`
 * lists untracked *files* (`ls-files --others`, no `--directory`), so `build/a.o`
 * and `build/b.o` are in the diff and `build/` never is. Reusing the raced-read
 * sentence for it would tell him the tree moved when nothing moved, and send him
 * to look for a problem that is not there. */
export function missingPatchNote(entry: StatusEntry): string {
  // `worktree_status` reads `--untracked-files=normal`, which reports a
  // directory nothing in which is tracked as one row ending in `/` (`build/`)
  // rather than as every file under it. git's paths never end in `/` otherwise,
  // so the trailing slash is the whole test.
  if (entry.path.endsWith("/")) {
    return (
      `${entry.path} is a directory, not a file: nothing in it is tracked, so ` +
      "git reports it as one row rather than as every file under it. A patch " +
      "is per file, so there is no single patch for this row — the Diff pane " +
      "lists the files inside it one by one."
    );
  }
  return (
    `git's status lists ${entry.path} (${entry.code}), but the patch read ` +
    "against HEAD does not include it. Those are two separate reads: the tree " +
    "may have moved between them, or this may be a change git records outside " +
    "the file's content."
  );
}
