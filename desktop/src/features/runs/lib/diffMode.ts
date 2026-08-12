// How a patch is drawn: one column or two
// (vingilot/docs/plans/2026-08-12-vscode-muscle-memory.md, Task 2).
//
// **One flag, for the whole app, not one per file.** Task 2 said so, and the
// reason is the gesture: he is walking a forty-file worktree with `j`/`k` and
// reading each patch. A choice remembered per file would mean the layout
// changed under him on every Enter, and a layout that changes when the content
// changes is a layout he cannot learn. So this is a preference about *how he
// reads diffs*, held once, and the Diff pane and the History pane read the same
// one — two panes, one answer, which is also what makes it the same product on
// both surfaces.
//
// **The default is unified, and stays unified.** Split is the wide-screen
// luxury; unified is the one that always fits, and on the machine this plan was
// written about the Diff pane in its side slot is 435px, which is not wide
// enough for two columns of anything. A default nobody chose must be the one
// that works everywhere.
//
// **Persisted, because a preference the app forgets is not remembered.** Same
// shape as `features/channels/lib/threadViewModePreference.ts`, which is
// upstream's own device-level view-mode preference: a module singleton, a
// listener set, `localStorage` as best-effort mirror. Not community-scoped and
// therefore deliberately NOT in `resetCommunityState()` — how he likes to read
// a diff of his own checkout has nothing to do with which relay he is talking
// to, and this store holds no community data to leak.
//
// The React binding is `lib/useDiffMode.ts`; nothing in this file imports React,
// so the model can be tested without one.

export type DiffMode = "unified" | "split";

/** Versioned like the fork's other stored preferences: a later shape change
 * takes a new key, so an older build reading a newer record finds nothing and
 * starts from the default. The default being unified means that failure lands
 * on the layout that always fits. */
const STORAGE_KEY = "vingilot-diff-mode.v1";

const DEFAULT_DIFF_MODE: DiffMode = "unified";

const listeners = new Set<() => void>();

/** Anything unrecognised — absent, empty, a mode from a future build, a value
 * some other tab wrote — reads as the default rather than throwing inside the
 * render that puts a pane up. */
export function parseDiffMode(value: string | null | undefined): DiffMode {
  return value === "split" || value === "unified" ? value : DEFAULT_DIFF_MODE;
}

function readStored(): DiffMode {
  try {
    return parseDiffMode(globalThis.localStorage?.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_DIFF_MODE;
  }
}

let mode: DiffMode = readStored();

/** The chosen mode, outside React. */
export function getDiffMode(): DiffMode {
  return mode;
}

/** Record the choice and tell everyone reading it. A storage that refuses the
 * write costs the next restart this one preference and nothing else. */
export function setDiffMode(next: DiffMode): void {
  if (next === mode) return;
  mode = next;
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, next);
  } catch {
    // Best effort: the in-memory value still applies for this session.
  }
  for (const listener of listeners) listener();
}

export function subscribeDiffMode(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The default, for a snapshot taken where there is no storage to read. */
export function serverDiffMode(): DiffMode {
  return DEFAULT_DIFF_MODE;
}

/** What a pane actually draws: the choice, unless this pane cannot seat two
 * columns (`diffLayout.ts`'s `splitFitsAt`).
 *
 * **A narrow pane does not forget the choice, it declines to honour it.** That
 * distinction is the behaviour: he chooses split at full-screen diff view,
 * presses ⇧⌥⌘B back to the split surface and gets unified because 435px cannot
 * hold two columns — and pressing ⇧⌥⌘B again gives him split back without
 * choosing it a second time. Clearing the flag on a narrow pane would have
 * meant the app un-chose it for him while he watched. */
export function effectiveDiffMode(
  choice: DiffMode,
  splitFits: boolean,
): DiffMode {
  return choice === "split" && splitFits ? "split" : "unified";
}

/** Reset to the default and drop the mirror. Test-only: nothing in the product
 * un-chooses a preference the owner set, which is the point of the paragraph
 * above. Exported because a unit test that reached into the module's private
 * `mode` would be testing something else. */
export function resetDiffModeForTests(): void {
  mode = DEFAULT_DIFF_MODE;
  try {
    globalThis.localStorage?.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to undo.
  }
  for (const listener of listeners) listener();
}
