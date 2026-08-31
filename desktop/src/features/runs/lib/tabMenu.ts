// What a tab's own context menu means (2026-08-29 redesign, P4.7, item 4:
// "vscodedaki seyler lazim" — Close, Close others, Close to the right, Split,
// Copy path).
//
// Pure, and separate from the menu that draws it, for the reason every `resolve*`
// in this island is: the *rule* is what has to be right, and a rule that can
// only be exercised by opening a menu is a rule nobody exercises. What is here
// is which tabs an item names and what a path is; `TerminalTabStrip.tsx` draws
// the rows and `useDeckLayers.ts` performs them through the close paths that
// already exist — so every rule those paths keep (a strip is never left empty,
// a closed ordinal is never handed to a later shell) is kept here for free.
//
// **The close scopes are one function on one ordered list**, and that list is
// the strip's own order (`stageOrder`) — shells then readings, left to right,
// exactly the row the owner right-clicked in. Anything else would make "to the
// right" mean something the row does not show.

import type { ViewSubject } from "./viewTabs.ts";

/** Which tabs a close item names. */
export type TabCloseScope =
  /** Just this one — the same act as the tab's own × and as a middle-click. */
  | "this"
  /** Every other tab in the strip. */
  | "others"
  /** Everything after this one, this one kept. */
  | "right";

/** The keys a close scope names, in strip order.
 *
 * Order matters to the caller, not to this: closes are applied one at a time
 * through the tab models, and a model that renumbered would be applied against
 * a list that had moved under it. Keys are stable names (`tabSplit.ts`'s
 * `stageKey`), not positions, which is what makes applying them in sequence
 * safe. A target that is not in the list names nothing. */
export function tabsToClose(
  ordered: readonly string[],
  target: string,
  scope: TabCloseScope,
): readonly string[] {
  const at = ordered.indexOf(target);
  if (at === -1) return [];
  if (scope === "this") return [target];
  if (scope === "others") return ordered.filter((key) => key !== target);
  return ordered.slice(at + 1);
}

/** What "Copy path" copies.
 *
 * A tab is a view OF something, and the something is what a path names:
 *
 * - a file — the checkout's own directory joined to the worktree-relative path,
 *   because a bare `src/main.rs` pasted into a shell in another directory is a
 *   path to nothing;
 * - a commit — its full hash, which is what `git show` takes and what the tab's
 *   own label abbreviates;
 * - the worktree's diff — the base it is a diff against, which is the only
 *   thing about it that is not "here";
 * - history, and every SHELL — the checkout, because that is where they are.
 *
 * `null` for a worktree this app cannot name a directory for: there is nothing
 * to copy, and copying the empty string would read as "it worked".
 */
export function stageTabPath(
  cwd: string | null,
  subject: ViewSubject | null,
): string | null {
  if (subject === null || subject.kind === "history") return cwd;
  if (subject.kind === "commit") return subject.hash;
  if (subject.kind === "diff") return subject.base;
  if (cwd === null) return subject.path;
  return `${cwd.replace(/\/+$/, "")}/${subject.path}`;
}
