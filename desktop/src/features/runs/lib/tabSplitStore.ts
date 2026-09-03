// Which tab splits survive a restart, and which deliberately do not.
//
// > *"Ayrıca spliti de aklında tutmuyor."*
//
// `tabSplit.ts`'s header refused persistence outright, and its reason was
// sound: **half of what a tab split can hold is a reading** — a file as it was,
// a patch as git reported it — and restoring one puts last week's reading on
// screen wearing a live tab's chrome, or names a view id that no longer exists
// at all.
//
// That reason covers exactly one of the two cases. A split whose right half is
// a TERMINAL has nothing to go stale: the pty outlives the window (that is what
// `vingilot_pty`'s tmux backing is for), the ordinal is the fork's stable name
// for it, and the arrangement is two CSS numbers over boxes that never move.
// So the rule is the reason, applied rather than rounded up:
//
//   right half is a terminal  → written, and restored
//   right half is a reading   → not written, and dropped on read
//
// The filter runs on BOTH sides on purpose. Writing only terminals is what
// keeps a stale reading out of storage; dropping non-terminals on read is what
// keeps a hand-edited or older-build record from putting one back. Neither
// alone is enough, and the pair costs one predicate.

import {
  clampRatio,
  emptyTabSplits,
  parseStageKey,
  type TabSplitLayout,
  type TabSplitState,
} from "@/features/runs/lib/tabSplit";

/** The subset of `Storage` this module needs, so a test can pass a fake and a
 * webview that refuses storage is a no-op rather than a crash. */
interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const NO_STORAGE: StorageLike = {
  getItem: () => null,
  setItem: () => {},
};

function defaultStorage(): StorageLike {
  return (
    (globalThis as { localStorage?: StorageLike }).localStorage ?? NO_STORAGE
  );
}

/** `.v1` and its own key: the tab layout's record is written on a different
 * cadence and a split that failed to parse must not cost anyone their tabs. */
const SPLIT_KEY = "vingilot-tab-split.v1";

/** True when this split's right half is a live shell rather than a reading —
 * the whole of the rule above. */
function isTerminalSplit(state: TabSplitState): boolean {
  return parseStageKey(state.secondary)?.kind === "terminal";
}

function readState(value: unknown): TabSplitState | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;
  const { secondary, ratio, focus } = candidate;
  if (typeof secondary !== "string") return null;
  if (focus !== "left" && focus !== "right") return null;
  if (typeof ratio !== "number" || !Number.isFinite(ratio)) return null;
  const state: TabSplitState = {
    focus,
    ratio: clampRatio(ratio),
    secondary,
  };
  // A reading never comes back, whoever wrote it.
  return isTerminalSplit(state) ? state : null;
}

/** Every stored split whose right half is a terminal, keyed by binding id.
 *
 * Unreadable storage, malformed JSON and a record that is not an object all
 * answer the same way — no splits — because the arrangement is a convenience
 * and refusing to open the workspace over it would not be. */
export function readTabSplits(
  storage: StorageLike = defaultStorage(),
): TabSplitLayout {
  let raw: string | null = null;
  try {
    raw = storage.getItem(SPLIT_KEY);
  } catch {
    return emptyTabSplits();
  }
  if (raw === null) return emptyTabSplits();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyTabSplits();
  }
  if (typeof parsed !== "object" || parsed === null) return emptyTabSplits();
  const layout: Record<string, TabSplitState> = {};
  for (const [bindingId, value] of Object.entries(
    parsed as Record<string, unknown>,
  )) {
    const state = readState(value);
    if (state !== null) layout[bindingId] = state;
  }
  return layout;
}

/** Mirror the terminal-only splits back to storage.
 *
 * A worktree whose split holds a reading is written as absent rather than
 * omitted-and-forgotten: absent is what the next read would produce for it
 * anyway, and it keeps "what is on disk" equal to "what would be restored". */
export function writeTabSplits(
  layout: TabSplitLayout,
  storage: StorageLike = defaultStorage(),
): void {
  const keepable: Record<string, TabSplitState> = {};
  for (const [bindingId, state] of Object.entries(layout)) {
    if (isTerminalSplit(state)) keepable[bindingId] = state;
  }
  try {
    storage.setItem(SPLIT_KEY, JSON.stringify(keepable));
  } catch {
    // Losing the arrangement is survivable; failing the render that produced
    // it is not.
  }
}
