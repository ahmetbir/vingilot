// What `worktree_stats` answers, at this island's boundary
// (desktop/src-tauri/src/vingilot_worktree/stat.rs).
//
// The one distinction this file exists to keep: **"git could not read this
// worktree" and "this worktree is clean" are different answers.** Both arrive
// with every count at zero, and reading the first as the second puts the word
// "clean" under a worktree nobody has looked inside. `unreadable` is what
// separates them, and `dirtyOf` is the only place allowed to decide.
//
// Pure: no Tauri, no React. `worktreeClient.ts` makes the call.

/** One worktree's uncommitted state. Mirrors `WorktreeStat`
 * (vingilot_worktree/stat.rs) field-for-field. */
export interface WorktreeStat {
  /** The path this describes, exactly as it was asked for — the key a caller
   * matches its rows back on. */
  path: string;
  /** git's own counts against this worktree's `HEAD`, staged included. Binary
   * files count nothing on either side. */
  additions: number;
  deletions: number;
  /** Tracked files differing from `HEAD`. Not derivable from the counts: a
   * binary or mode-only change is a changed file with zero lines. */
  changedFiles: number;
  /** Files git has never seen, `.gitignore` respected. */
  untracked: number;
  dirty: boolean;
  /** Which files changed — tracked then untracked, repo-relative, capped by
   * the backend at `MAX_STAT_PATHS` (vingilot_worktree/stat.rs).
   *
   * **`null` and `[]` are different answers, and this is the one field where
   * that distinction is easy to lose.** `[]` is git saying "nothing changed
   * here"; `null` is this build being handed a record with no `paths` at all —
   * a backend older than the field, or a shape it cannot read — and it must
   * never be read as an empty set, because an empty set silently *agrees* with
   * every other worktree that it shares no files. That is the same
   * `unreadable`-is-not-clean rule this module opens with, applied one level
   * down: `worktreeOverlap.ts` draws nothing from a `null`.
   *
   * Not a count of anything: past the cap this is a subset while
   * `changedFiles`/`untracked` stay true. */
  paths: string[] | null;
  /** git named more changed files than `paths` carries. An overlap read off a
   * truncated list may under-report and may never claim to be complete. */
  pathsTruncated: boolean;
  /** git had no answer for this path. Every count above is then meaningless
   * rather than zero. */
  unreadable: boolean;
}

function num(v: Record<string, unknown>, key: string): number {
  const value = v[key];
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : 0;
}

function isStat(value: unknown): value is WorktreeStat {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.path === "string" && typeof v.dirty === "boolean";
}

/** The changed-file list, or `null` when the record carries none.
 *
 * `null` rather than `[]` for a missing or unreadable field, for the reason
 * `WorktreeStat.paths` documents: an empty list is a claim ("this worktree
 * changed nothing"), and a record that never made that claim must not be read
 * as having made it. Individual entries are still filtered — one unusable path
 * must not cost the caller the other forty, the same rule `readWorktreeDiff`
 * keeps for file records. */
function readPaths(v: Record<string, unknown>): string[] | null {
  if (!Array.isArray(v.paths)) return null;
  return v.paths.filter(
    (path): path is string => typeof path === "string" && path !== "",
  );
}

/** Tolerant read of a batch of stats — the same boundary discipline
 * `readGitWorktrees` keeps. A record without a path or a `dirty` flag says
 * nothing usable about a worktree and is dropped; the counts on a record that
 * has both are coerced, because a missing count is a zero and a negative one
 * is not a number git produced. */
export function readWorktreeStats(value: unknown): WorktreeStat[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isStat).map((raw) => {
    const v = raw as unknown as Record<string, unknown>;
    return {
      additions: num(v, "additions"),
      changedFiles: num(v, "changedFiles"),
      deletions: num(v, "deletions"),
      dirty: v.dirty === true,
      path: raw.path,
      paths: readPaths(v),
      pathsTruncated: v.pathsTruncated === true,
      unreadable: v.unreadable === true,
      untracked: num(v, "untracked"),
    };
  });
}

/** The stat a row may be rendered from, or `null`.
 *
 * An unreadable stat is `null` rather than itself: everything downstream —
 * the counts, the dirty marker, the ordering — treats `null` as "nothing is
 * known here", which is exactly what an unreadable worktree is. A caller that
 * wants to *say* git could not read it asks the raw record. */
export function usableStat(
  stat: WorktreeStat | undefined,
): WorktreeStat | null {
  if (stat === undefined || stat.unreadable) return null;
  return stat;
}
