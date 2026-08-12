// What a worktree's changes are, as data the Diff panel renders and nothing
// else (vingilot/docs/plans/2026-08-07-workspace-v1.md, Task 7).
//
// The wire shape of `WorktreeDiff` (desktop/src-tauri/src/vingilot_worktree/
// diff.rs) plus the copy that goes with it. Pure: no Tauri, no React.
//
// **The limits are the backend's, not this module's.** Every cap the answer
// was produced under travels back inside it, so the sentence on screen says
// the number git was actually held to. A second copy of "2000" over here would
// be right until the day someone changed one of them.
//
// **Nothing is rounded up into a reassuring shape.** A binary file says it is
// one rather than rendering as an empty patch; a cut patch says it was cut; a
// list that stopped at the cap says how many files it did not read. "No
// changes" is a thing this panel may only say when it is true.

import { isLocalWorktree, type Worktree } from "./projects.ts";

/** What happened to a file. `untracked` is not a `git diff` status — git does
 * not mention these files at all, so the backend lists them separately. */
export type DiffChange =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "type-changed"
  | "untracked"
  | "other";

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

export interface DiffFile {
  path: string;
  /** Where a renamed or copied file came from. */
  oldPath: string | null;
  change: DiffChange;
  additions: number;
  deletions: number;
  /** git produces no textual patch for this file. */
  binary: boolean;
  patch: string;
  truncated: boolean;
}

export interface DiffLimits {
  maxFiles: number;
  maxUntracked: number;
  maxPatchLines: number;
  maxPatchBytes: number;
}

export interface WorktreeDiff {
  base: string;
  files: DiffFile[];
  additions: number;
  deletions: number;
  omittedFiles: number;
  omittedUntracked: number;
  limits: DiffLimits;
}

function num(v: Record<string, unknown>, key: string): number {
  const value = v[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function readChange(value: unknown): DiffChange {
  return CHANGES.find((change) => change === value) ?? "other";
}

function readFile(value: unknown): DiffFile | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.path !== "string" || v.path === "") return null;
  return {
    additions: num(v, "additions"),
    binary: v.binary === true,
    change: readChange(v.change),
    deletions: num(v, "deletions"),
    oldPath: typeof v.oldPath === "string" ? v.oldPath : null,
    patch: typeof v.patch === "string" ? v.patch : "",
    path: v.path,
    truncated: v.truncated === true,
  };
}

/** Tolerant read of what `worktree_diff` answered — the same boundary
 * discipline every other read in this feature keeps. A file record this build
 * cannot make sense of is dropped rather than thrown on, because one
 * unreadable record must not cost the owner the other forty. */
export function readWorktreeDiff(value: unknown): WorktreeDiff | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const rawLimits =
    typeof v.limits === "object" && v.limits !== null
      ? (v.limits as Record<string, unknown>)
      : {};
  const files = Array.isArray(v.files)
    ? v.files.map(readFile).filter((file): file is DiffFile => file !== null)
    : [];
  return {
    additions: num(v, "additions"),
    base: typeof v.base === "string" ? v.base : "",
    deletions: num(v, "deletions"),
    files,
    limits: {
      maxFiles: num(rawLimits, "maxFiles"),
      maxPatchBytes: num(rawLimits, "maxPatchBytes"),
      maxPatchLines: num(rawLimits, "maxPatchLines"),
      maxUntracked: num(rawLimits, "maxUntracked"),
    },
    omittedFiles: num(v, "omittedFiles"),
    omittedUntracked: num(v, "omittedUntracked"),
  };
}

/** What a worktree is read against unless the owner says otherwise.
 *
 * `HEAD` for a worktree this app or the owner made: the question there is
 * "what have I changed and not committed", which is the one VS Code's own
 * gutter answers. A Run's worktree instead defaults to the commit it was
 * branched from, because what is worth reading there is everything the Run
 * did, committed or not — and that commit is the only fixed point that
 * survives the Run committing again while you are looking at it. */
export function defaultDiffBase(wt: Worktree): string {
  if (isLocalWorktree(wt)) return "HEAD";
  const base = wt.base_commit.trim();
  return base === "" ? "HEAD" : base;
}

/** One letter per change, the way `git status` writes them. `U` for untracked
 * is `git status`'s own `??` said in one character. */
export function changeMark(change: DiffChange): string {
  switch (change) {
    case "added":
      return "A";
    case "modified":
      return "M";
    case "deleted":
      return "D";
    case "renamed":
      return "R";
    case "copied":
      return "C";
    case "type-changed":
      return "T";
    case "untracked":
      return "U";
    case "other":
      return "?";
  }
}

export function changeLabel(change: DiffChange): string {
  return change === "type-changed" ? "type changed" : change;
}

/** The path as the list shows it: a rename says where it came from, because
 * "moved.txt +0 −0" on its own is a change nobody can account for. */
export function fileLabel(file: DiffFile): string {
  return file.oldPath === null ? file.path : `${file.oldPath} → ${file.path}`;
}

/** A label split where an ellipsis must not fall: everything up to and
 * including the last `/`, and the name the file goes by.
 *
 * CSS truncation elides the *tail*, and the tail of a path is the half that
 * identifies it. Measured in the built bundle at 1728×1117, where the changed-
 * file rows are 163px of `text-sm`: three files under
 * `desktop/src/features/runs/` all rendered as `desktop/src/features/ru…` —
 * one string, three different files, and no way to tell which row to click.
 * So the two halves are given to the layout separately and only the lead is
 * allowed to give way (`PathLabel` in `ui/WorktreeDiffPanel.tsx`).
 *
 * A label with no `/` is all name. A rename's arrow stays in the lead, because
 * the name worth keeping on screen is the one the file has now. A label that
 * ends in `/` has no name to protect, so it is left whole rather than reduced
 * to an empty span. */
export function labelParts(label: string): { lead: string; name: string } {
  const cut = label.lastIndexOf("/");
  if (cut < 0 || cut === label.length - 1) return { lead: "", name: label };
  return { lead: label.slice(0, cut + 1), name: label.slice(cut + 1) };
}

/** Where this patch starts in the file as it is now — the `+` side of its first
 * hunk header, 1-based — or `null` when the patch names no line.
 *
 * **What makes "show the whole file" land where he was reading.** A patch is a
 * reading of a few lines and the question it raises is about the rest of them;
 * dropping him at line 1 of a 2,000-line file answers a different question. The
 * `+` side and not the `-` side because the file the viewer opens is the file
 * as it is now.
 *
 * The hunk's own start rather than the first `+`/`-` line inside it: git puts
 * three lines of context there, and landing on them is landing on the change
 * with its surroundings already on screen.
 *
 * `null` — the top of the file — for a binary file, an empty patch, a header
 * this does not recognise, and git's `+0` (a hunk against a side of the diff
 * that has no lines). A line invented from a header that was not there would
 * put him somewhere the change is not, which is worse than the top. */
export function firstHunkLine(patch: string): number | null {
  for (const line of patch.split("\n")) {
    if (!line.startsWith("@@")) continue;
    const found = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (found === null) return null;
    const at = Number(found[1]);
    return at >= 1 ? at : null;
  }
  return null;
}

/** What this file is not showing, in words, or `null` when it is showing all
 * of itself. The limits come from the answer, so the number here is the number
 * that was applied. */
export function fileNote(file: DiffFile, limits: DiffLimits): string | null {
  if (file.binary) {
    return "binary file — git produces no line-by-line patch for it, so there is nothing to render here. Its change is real; only the rendering is missing.";
  }
  if (file.truncated) {
    return (
      `patch cut off — this file changed by more than ${limits.maxPatchLines} lines ` +
      `or ${Math.round(limits.maxPatchBytes / 1024)} KB, and the rest is not shown. ` +
      "Read it in full with git."
    );
  }
  if (file.patch === "") {
    return "no textual change to show — an empty file, or a change git records outside the content (a mode or type change).";
  }
  return null;
}

/** The line above the list: how much changed, and what was left out of the
 * answer entirely. `null` when nothing was left out — the panel then shows the
 * counts alone rather than an "everything is fine" sentence nobody needs. */
export function diffSummary(diff: WorktreeDiff): {
  headline: string;
  omission: string | null;
} {
  const count = diff.files.length;
  const headline =
    `${count} file${count === 1 ? "" : "s"} changed, ` +
    `+${diff.additions} −${diff.deletions} vs ${diff.base}`;

  const parts: string[] = [];
  if (diff.omittedFiles > 0) {
    parts.push(
      `${diff.omittedFiles} more changed file${diff.omittedFiles === 1 ? "" : "s"} ` +
        `not read (this stops at ${diff.limits.maxFiles})`,
    );
  }
  if (diff.omittedUntracked > 0) {
    parts.push(
      `${diff.omittedUntracked} more untracked file${diff.omittedUntracked === 1 ? "" : "s"} ` +
        `not read (this stops at ${diff.limits.maxUntracked})`,
    );
  }
  return {
    headline,
    omission:
      parts.length === 0
        ? null
        : `${parts.join("; ")} — the counts above are of what is listed, not of the worktree.`,
  };
}
