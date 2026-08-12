// The file tree, as data: what a directory's answer is, how the answers stack
// into visible rows, and what each key does to the selection
// (vingilot/docs/plans/2026-08-11-what-sent-him-to-vscode.md, Task 3; design in
// vingilot/docs/plans/2026-08-12-files-pane-design.md).
//
// **Nothing here touches React, Tauri or a filesystem.** `filesClient.ts` puts
// the two commands, `FilesPane.tsx` holds the effects and the layout, and every
// decision either of them makes is a call into this file — which is what makes
// the decisions testable at all. The same split `paneModel.ts`, `diffLayout.ts`
// and `terminalKeys.ts` use, and for the same reason.
//
// **A directory has three states, not two.** `loading`, `listed` and `refused`
// are kept apart all the way to the row that is drawn, because an unexpanded
// directory, a directory still being read, and a directory git refused to list
// are three different things and only one of them is empty. Folding the third
// into "no children" is reading a refusal as an answer, which is the mistake
// this island has a house rule about.
//
// **The tree is lazy in the model too, not only in Rust.** `dirs` holds only
// the directories that have been asked about. Collapsing one keeps its answer —
// re-expanding is instant and costs no subprocess — and the pane's refresh
// re-asks only what is open.

import type { KeyInput } from "@/features/runs/lib/terminalKeys";

/** One row of a directory, exactly as `vingilot_files::tree` serialises it. */
export interface TreeEntry {
  name: string;
  kind: "directory" | "file";
  /** Bytes, or `null` for a directory and for a file the backend could not
   * `stat`. **`null` is "no answer", never zero** — a file behind a permission
   * and an empty file are different things. */
  size: number | null;
}

/** One directory's answer, with the cap it was produced under. */
export interface TreeListing {
  dir: string;
  entries: TreeEntry[];
  truncated: boolean;
  limit: number;
}

/** Why a read did not happen. The mirror of `vingilot_files::FilesError`; the
 * words are `filesRefusal` below, so the backend owns the facts and this file
 * owns the copy. */
export type FilesError =
  | { kind: "git-missing" }
  | { kind: "not-a-repo"; path: string }
  | { kind: "outside-path"; path: string }
  | { kind: "not-found"; path: string }
  | { kind: "too-large"; path: string; size: number; cap: number }
  | { kind: "binary"; path: string }
  | { kind: "unreadable"; path: string; detail: string }
  | { kind: "git-failed"; command: string; stderr: string };

const KINDS = new Set([
  "binary",
  "git-failed",
  "git-missing",
  "not-a-repo",
  "not-found",
  "outside-path",
  "too-large",
  "unreadable",
]);

/** Read a rejected `invoke`'s payload as a refusal, or `null` when it is not
 * one of ours. A shape this build cannot read must not be silently turned into
 * a refusal it never received — the caller reports it as the bridge failing,
 * which is what it is. */
export function readFilesError(thrown: unknown): FilesError | null {
  if (typeof thrown !== "object" || thrown === null) return null;
  const kind = (thrown as { kind?: unknown }).kind;
  if (typeof kind !== "string" || !KINDS.has(kind)) return null;
  return thrown as FilesError;
}

/** A count with thousands separators, pinned to `en-US`.
 *
 * **Pinned rather than `toLocaleString()`**, and the reason is a real defect
 * caught by this file's own test rather than a preference: the sentences in
 * this pane are English, and a bare `toLocaleString()` takes the *machine's*
 * locale — on the owner's Mac, which is Turkish, "1,204 lines" rendered as
 * "1.204 lines". A number formatted by one locale inside a sentence written in
 * another is not localisation, it is a mismatch, and the fix is to make the
 * number agree with the words around it. When these sentences are translated,
 * the locale moves here with them. */
export function humanCount(value: number): string {
  return value.toLocaleString("en-US");
}

/** Bytes, in the units a person reads. Kept here rather than in the component
 * so the tree's footer and the viewer's header cannot round differently. */
export function humanSize(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  const kib = bytes / 1024;
  if (kib < 1024) return `${kib < 10 ? kib.toFixed(1) : Math.round(kib)} KiB`;
  const mib = kib / 1024;
  return `${mib < 10 ? mib.toFixed(1) : Math.round(mib)} MiB`;
}

/** **Each refusal is its own sentence.** Task 3's last checkbox, and the reason
 * this is a function over a union rather than a string on the error: the three
 * bounds have three different next actions — open it in the terminal, accept
 * that it is not text, fix a permission — and one sentence covering all three
 * is a sentence he can do nothing with.
 *
 * Every sentence names the thing in the way. "Too large" carries the real size,
 * because without it he cannot tell whether to reach for `less` or for `head`. */
export function filesRefusal(error: FilesError): string {
  switch (error.kind) {
    case "git-missing":
      return "no git on this machine answers --version, so there is nothing here that can say what is in this checkout.";
    case "not-a-repo":
      return `${error.path} is not a git repository, so there is no checkout here to read.`;
    case "outside-path":
      return `${error.path} leads outside this worktree — a link out of the checkout, or a path that climbs above it — and this pane reads only inside the worktree you selected.`;
    case "not-found":
      return `there is nothing at ${error.path} in this worktree any more.`;
    case "too-large":
      return `${error.path} is ${humanSize(error.size)}, past this pane's ${humanSize(error.cap)} limit — it is a file for the terminal one pane over, not for a viewer.`;
    case "binary":
      return `${error.path} looks binary — there is a NUL byte in its first 8 KiB — so there is no text here to show.`;
    case "unreadable":
      return `${error.path} could not be read: ${error.detail}`;
    case "git-failed":
      return `${error.command} refused: ${error.stderr.trim()}`;
  }
}

/** What is known about one directory. `loading` is never rendered as empty. */
export type DirState =
  | { status: "loading" }
  | { status: "listed"; listing: TreeListing }
  | { status: "refused"; error: FilesError };

/** Every directory that has been asked about, keyed by its worktree-relative
 * path. `""` is the root. */
export type TreeDirs = Record<string, DirState>;

/** The directories the owner has opened. Absence is closed. */
export type Expanded = Record<string, true>;

/** The root's key. Written out because `""` in a lookup reads as a bug. */
export const ROOT = "";

export function joinPath(dir: string, name: string): string {
  return dir === ROOT ? name : `${dir}/${name}`;
}

/** The directory a path is in, or `null` for one at the root. */
export function parentPath(path: string): string | null {
  const cut = path.lastIndexOf("/");
  if (cut < 0) return path === ROOT ? null : ROOT;
  return path.slice(0, cut);
}

/** Every directory on the way to `path`, root first — what has to be expanded
 * for a file handed in from outside (§6 of the design: a search result) to be
 * visible in the tree. */
export function ancestors(path: string): string[] {
  const parts = path.split("/").filter((part) => part !== "");
  const found: string[] = [ROOT];
  for (let index = 0; index < parts.length - 1; index += 1) {
    found.push(parts.slice(0, index + 1).join("/"));
  }
  return found;
}

export function withExpanded(
  expanded: Expanded,
  path: string,
  open: boolean,
): Expanded {
  const was = expanded[path] === true;
  // Returns the same object when nothing moves, so a caller mirroring this
  // into state does not re-render on a no-op. Every writer in this island
  // keeps that property.
  if (was === open) return expanded;
  if (!open) {
    const next = { ...expanded };
    delete next[path];
    return next;
  }
  return { ...expanded, [path]: true };
}

/** One drawn line of the tree.
 *
 * `note` rows exist because a directory that is being read and a directory that
 * was refused both have to be visible *in place*, under the row that opened
 * them. They carry no path a selection can land on, which is what
 * `selectablePaths` is for. */
export type TreeRow =
  | {
      row: "entry";
      path: string;
      name: string;
      kind: "directory" | "file";
      size: number | null;
      depth: number;
      /** Directories only; always `false` for a file. */
      expanded: boolean;
    }
  | { row: "note"; key: string; depth: number; text: string };

/** How deep the tree may be drawn.
 *
 * Not a taste: `flatten` recurses over `dirs`, and `dirs` is keyed by a string
 * the backend produced. A checkout containing a symlink loop would be refused
 * by the backend's own path guard, but a bound here costs nothing and is the
 * difference between a bug and a blank window. Deeper than any real source
 * tree, shallower than a stack overflow. */
export const MAX_DEPTH = 32;

/** The visible rows, in order: the root's entries, with each expanded
 * directory's own rows spliced in under it.
 *
 * Pure over the two records, so the pane's whole drawn state is a function of
 * what has been read and what has been opened — there is no separate row list
 * to keep in step with either. */
export function flatten(dirs: TreeDirs, expanded: Expanded): TreeRow[] {
  const rows: TreeRow[] = [];
  // Note rows are keyed `<dir> <what>`. NUL because it is the one byte a
  // path cannot contain — the same reason `paneModel.ts`'s `probeSlot` uses it
  // — so a directory literally called `src loading` cannot collide with the
  // wait row of a directory called `src`.
  const walk = (dir: string, depth: number): void => {
    if (depth > MAX_DEPTH) return;
    const state = dirs[dir];
    if (state === undefined) return;
    if (state.status === "loading") {
      rows.push({
        depth,
        key: `${dir}\u0000loading`,
        row: "note",
        text: "reading…",
      });
      return;
    }
    if (state.status === "refused") {
      rows.push({
        depth,
        key: `${dir}\u0000refused`,
        row: "note",
        text: filesRefusal(state.error),
      });
      return;
    }
    for (const entry of state.listing.entries) {
      const path = joinPath(dir, entry.name);
      const open = entry.kind === "directory" && expanded[path] === true;
      rows.push({
        depth,
        expanded: open,
        kind: entry.kind,
        name: entry.name,
        path,
        row: "entry",
        size: entry.size,
      });
      if (open) walk(path, depth + 1);
    }
    if (state.listing.truncated) {
      rows.push({
        depth,
        key: `${dir}\u0000truncated`,
        row: "note",
        // The number is the backend's own, not a second copy of it: a cap
        // applied silently is a reader that lies about what is in the
        // repository.
        text: `more than ${state.listing.limit} entries here — the rest are not listed.`,
      });
    }
  };
  walk(ROOT, 0);
  return rows;
}

/** The rows a selection may land on, in drawn order. */
export function selectablePaths(rows: TreeRow[]): string[] {
  return rows.flatMap((row) => (row.row === "entry" ? [row.path] : []));
}

export function rowAt(rows: TreeRow[], path: string | null): TreeRow | null {
  if (path === null) return null;
  return rows.find((row) => row.row === "entry" && row.path === path) ?? null;
}

/** Where the selection goes.
 *
 * A selection whose row is gone — a directory collapsed under it, a refresh
 * that dropped the file — lands on the first row rather than on nothing: a
 * tree with no selection has no keyboard, and this is the case that produces
 * one without anybody choosing it. */
export function step(
  rows: TreeRow[],
  selected: string | null,
  to: "first" | "last" | "next" | "previous",
): string | null {
  const paths = selectablePaths(rows);
  if (paths.length === 0) return null;
  if (to === "first") return paths[0];
  if (to === "last") return paths[paths.length - 1];
  const at = selected === null ? -1 : paths.indexOf(selected);
  if (at < 0) return paths[0];
  const next = to === "next" ? at + 1 : at - 1;
  // Deliberately does not wrap. A tree that jumped from its last row to its
  // first on one more ↓ would move him somewhere he did not ask to be, and the
  // ends of a list are a useful thing to feel.
  if (next < 0 || next >= paths.length) return selected;
  return paths[next];
}

/** What → means on the selected row: open a shut directory, or step into an
 * open one. `null` on a file, which has nothing to open into. */
export function rightOf(
  rows: TreeRow[],
  selected: string | null,
): { act: "expand" | "select"; path: string } | null {
  const row = rowAt(rows, selected);
  if (row === null || row.row !== "entry") return null;
  if (row.kind !== "directory") return null;
  if (!row.expanded) return { act: "expand", path: row.path };
  const paths = selectablePaths(rows);
  const at = paths.indexOf(row.path);
  const child = paths[at + 1];
  // An expanded directory whose children are still being read, or whose
  // listing was refused, has no row to step onto. Staying put is the honest
  // answer; jumping past it to the next sibling would skip the very rows he
  // is waiting for.
  if (child === undefined || !child.startsWith(`${row.path}/`)) return null;
  return { act: "select", path: child };
}

/** What ← means: shut an open directory, or go up to the parent. `null` at the
 * root, where there is no up. */
export function leftOf(
  rows: TreeRow[],
  selected: string | null,
): { act: "collapse" | "select"; path: string } | null {
  const row = rowAt(rows, selected);
  if (row === null || row.row !== "entry") return null;
  if (row.kind === "directory" && row.expanded) {
    return { act: "collapse", path: row.path };
  }
  const parent = parentPath(row.path);
  if (parent === null || parent === ROOT) return null;
  return { act: "select", path: parent };
}

/** What Enter means: open a file, toggle a directory. */
export function enterOn(
  rows: TreeRow[],
  selected: string | null,
): { act: "open" | "toggle"; path: string } | null {
  const row = rowAt(rows, selected);
  if (row === null || row.row !== "entry") return null;
  return { act: row.kind === "file" ? "open" : "toggle", path: row.path };
}

/** One keydown on the tree, resolved.
 *
 * **Bound to the tree's own container, never to the window.** An unmodified
 * arrow belongs to whatever has focus, and a global arrow binding would move a
 * tree selection while he was moving a cursor in the terminal one pane over —
 * the rule `paneKeys.ts` states for the divider and for the same reason.
 *
 * Any chord falls through untouched: ⌘↑ is not a tree move, and swallowing it
 * would cost him a shortcut for standing in this pane. */
export type TreeKeyAction =
  | { type: "step"; to: "first" | "last" | "next" | "previous" }
  | { type: "right" }
  | { type: "left" }
  | { type: "enter" };

export function resolveFileTreeKey(input: KeyInput): TreeKeyAction | null {
  if (input.primaryModifier) return null;
  if (input.altKey === true) return null;
  switch (input.key) {
    case "ArrowDown":
      return { to: "next", type: "step" };
    case "ArrowUp":
      return { to: "previous", type: "step" };
    case "Home":
      return { to: "first", type: "step" };
    case "End":
      return { to: "last", type: "step" };
    case "ArrowRight":
      return { type: "right" };
    case "ArrowLeft":
      return { type: "left" };
    case "Enter":
      return { type: "enter" };
    default:
      return null;
  }
}
