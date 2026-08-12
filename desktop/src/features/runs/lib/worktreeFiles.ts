// **⌘P's source: the selected worktree's files, read lazily**
// (vingilot/docs/plans/2026-08-12-an-ide-of-a-kind.md, Task 2).
//
// The palette's files door needs a list of paths; a checkout has more of them
// than anything should read on a keystroke. So this module holds the two
// decisions that make "read the tree" bounded, and holds them without React,
// Tauri or a filesystem — `useWorktreeFiles.ts` runs the reads, `filesClient.ts`
// makes the calls, and `filesModel.ts` owns what one directory's answer means.
//
// **Top-level first, deepen on the query.** With an empty field the answer is
// the root's own files: that is the listing the Files pane already has open, it
// arrives in one call, and a palette that walked a whole repository before
// showing anything would be a palette that is never open when he needs it. A
// query is the signal that the answer is somewhere he has not looked, so each
// pass reads a few more of the directories the previous pass named.
//
// **It reads the same command the Files pane reads** (`worktree_tree`), so
// there is one listing in this app and not two — a second walk would answer
// differently the day the backend's rules change, and the pane's rules are the
// ones with the cargo tests.
//
// **Two caps, and both are refusals rather than optimisations.** `DIR_BUDGET`
// is how many directories one pass may open, so typing stays typing; `DIR_CAP`
// is how many this module will ever open for one worktree, so a `node_modules`
// nobody ignored cannot turn the palette into a disk crawl. Past the cap the
// answer is what has been found, which is an honest partial list — and the
// alternative, a palette that keeps reading for a minute, is the same partial
// list with the app unusable during it.

import type { TreeEntry } from "@/features/runs/lib/filesModel";

/** How many unread directories one pass may open. Small: the pass runs on a
 * keystroke, and four reads that land before the next character is typed is
 * worth more than forty that land after the query has changed. */
export const DIR_BUDGET = 6;

/** How many directories this module will open for one worktree, ever. */
export const DIR_CAP = 400;

/** The listings that have arrived, by worktree-relative directory. `""` is the
 * root. A directory that is a key here has answered; one that is only named
 * inside a value has not. */
export type Listed = ReadonlyMap<string, readonly TreeEntry[]>;

/** Join a directory and a name into a worktree-relative path. The root's
 * children have no leading slash — that is the shape `file_read` takes. */
export function joinPath(dir: string, name: string): string {
  return dir === "" ? name : `${dir}/${name}`;
}

/** Every file path found so far, in listing order — parents before children,
 * which is the order the reads happened in and therefore the order that puts
 * the top level first.
 *
 * Directories are not rows: ⌘P opens a file, and a row that opened a directory
 * would be a row whose Enter did something the door does not name. */
export function knownFiles(listed: Listed): string[] {
  const paths: string[] = [];
  for (const [dir, entries] of listed) {
    for (const entry of entries) {
      if (entry.kind === "file") paths.push(joinPath(dir, entry.name));
    }
  }
  return paths;
}

/** The directories named by a listing that have not themselves been read, in
 * the order they were found. Breadth-first falls out of the map's own insertion
 * order: a pass appends the directories it opened, so their children are
 * considered after every sibling already in the queue. */
export function frontier(listed: Listed): string[] {
  const waiting: string[] = [];
  for (const [dir, entries] of listed) {
    for (const entry of entries) {
      if (entry.kind !== "directory") continue;
      const path = joinPath(dir, entry.name);
      if (!listed.has(path)) waiting.push(path);
    }
  }
  return waiting;
}

/** **What to read next**, given what is known and what he has typed.
 *
 * An empty query deepens nothing: the root is the answer until he asks a
 * question the root cannot answer. That is also what makes opening the door
 * cost exactly one call.
 *
 * Returns an empty list when the cap is reached, which is how the caller knows
 * to stop rather than by counting again. */
export function nextDirs(listed: Listed, query: string): string[] {
  if (query === "") return [];
  if (listed.size >= DIR_CAP) return [];
  return frontier(listed).slice(0, DIR_BUDGET);
}
