// Pure model for splitting one terminal tab into two live shells — iTerm's
// ⌘D / ⇧⌘D, inside this app's own tab model (2026-08-29 redesign, P2;
// owner: "terminali ikiye bolmeli suruklemeli").
//
// **What a split is.** One extra pty session beside a tab's own, drawn in the
// same tab with a draggable divider between them. The tab stays the unit the
// strip knows: `terminalTabs.ts` still owns ordinals, selection and closing,
// and knows nothing about this module — a split is a fact *about* a session,
// keyed by that session's id, held beside the tab layout the way the scratch
// shell is held beside it. That is what keeps the two models from having to
// agree about anything except a string.
//
// **The second session's id is derived, not allocated.** `<primary>~half`.
// Injectivity against every other id this app mints:
//
// - A tab's id is `sessionIdFor(bindingId, n)` and always ends in the decimal
//   digits of its ordinal; this one always ends in `~half`, which no run of
//   digits is. A binding id containing `~half` changes nothing — the ordinal
//   after the last `#` is still what a tab id ends with.
// - A scratch id (`scratchTerminal.ts`) contains no `#`; this one contains
//   its primary's, and every primary has at least one.
// - Deriving from a primary that is itself a half would double the suffix
//   (`…~half~half`), which `openSplit` below refuses to produce: only a tab's
//   own session may be split.
//
// The derived id crosses the same three alphabets a tab's does and meets them
// the same way: tmux escapes `~` and `#` to hex (`tmux.rs::session_name`), and
// the Tauri output event carries the id in its payload, never in an event
// name. Persistence follows the primary's: the half is spawned the ordinary
// persistent way, so under tmux it survives a restart exactly as its tab does,
// and the saved layout (`splitStore.ts`) is what names it on the way back in.
//
// **Closing cascades one way only.** Closing a tab closes its half (a half
// with no tab has no surface to be drawn on); closing a half leaves the tab
// exactly as it was. `cascadeSplits` is the one function every "sessions
// really closed" path must route through — the caller that takes a
// `TabLayoutChange.closed` without cascading it is the caller that leaves a
// shell running with nothing tracking it.

/** Which way the divider runs, named for the act rather than the axis:
 * `right` puts the new shell beside the old (a vertical divider), `down` puts
 * it below (a horizontal one) — iTerm's own vocabulary for ⌘D and ⇧⌘D. */
export type SplitDirection = "right" | "down";

/** One tab's split: the direction and how much of the box the primary keeps. */
export interface TabSplit {
  readonly direction: SplitDirection;
  /** The primary's share, 0.2–0.8. Clamped on every write, not only at the
   * divider: a stored ratio is read back on restart and must arrive usable. */
  readonly ratio: number;
}

/** Every split, keyed by the primary session's id. A record for the same
 * reason `TabLayout` is one: membership is the question asked of it. */
export type SplitLayout = Readonly<Record<string, TabSplit>>;

/** A split transition and whatever it really ended — the same pairing
 * `TabLayoutChange` uses, for the same reason. */
export interface SplitChange {
  splits: SplitLayout;
  /** Session ids whose pty must really be closed. */
  closed: readonly string[];
}

const HALF_SUFFIX = "~half";

/** The floor either side may be dragged to. */
export const MIN_SPLIT_RATIO = 0.2;

export function emptySplits(): SplitLayout {
  return {};
}

/** The second shell's session id, derived from the tab's own. */
export function splitSessionId(primary: string): string {
  return `${primary}${HALF_SUFFIX}`;
}

/** True for an id this module derived — the one question a host needs to ask
 * an id it is about to treat as a tab's. */
export function isSplitSessionId(sessionId: string): boolean {
  return sessionId.endsWith(HALF_SUFFIX);
}

export function splitOf(splits: SplitLayout, primary: string): TabSplit | null {
  return Object.hasOwn(splits, primary) ? splits[primary] : null;
}

function clampRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0.5;
  if (ratio < MIN_SPLIT_RATIO) return MIN_SPLIT_RATIO;
  if (ratio > 1 - MIN_SPLIT_RATIO) return 1 - MIN_SPLIT_RATIO;
  return ratio;
}

/** Split a tab's terminal, or re-aim an existing split.
 *
 * Splitting an already-split tab in the same direction is a no-op — the
 * second shell is running and a chord must not cost the owner what is in it.
 * The other direction merely turns the divider: same two sessions, new
 * arrangement, nothing closed. A half cannot be split again (refused, not
 * nested): one divider is a split, a tree of them is a tiling manager this
 * surface has not earned. */
export function openSplit(
  splits: SplitLayout,
  primary: string,
  direction: SplitDirection,
): SplitLayout {
  if (isSplitSessionId(primary)) return splits;
  const current = splitOf(splits, primary);
  if (current !== null) {
    if (current.direction === direction) return splits;
    return { ...splits, [primary]: { ...current, direction } };
  }
  return { ...splits, [primary]: { direction, ratio: 0.5 } };
}

/** Close a tab's split half, really ending its shell. The tab itself is not
 * this module's to touch and is left exactly as it was. */
export function closeSplit(splits: SplitLayout, primary: string): SplitChange {
  if (!Object.hasOwn(splits, primary)) return { closed: [], splits };
  const { [primary]: _closed, ...rest } = splits;
  return { closed: [splitSessionId(primary)], splits: rest };
}

/** Move the divider. Clamped so neither shell can be dragged below
 * `MIN_SPLIT_RATIO` of the box — a pane at zero pixels is a pane whose pty
 * was just resized to nothing. A tab with no split ignores this. */
export function setSplitRatio(
  splits: SplitLayout,
  primary: string,
  ratio: number,
): SplitLayout {
  const current = splitOf(splits, primary);
  if (current === null) return splits;
  const clamped = clampRatio(ratio);
  if (clamped === current.ratio) return splits;
  return { ...splits, [primary]: { ...current, ratio: clamped } };
}

/** The tabs are gone, so their halves go with them.
 *
 * `closedPrimaries` is a `TabLayoutChange.closed` — the tab model naming what
 * it really ended — and this answers with the halves those tabs were
 * carrying, which the tab model has no name for. Every path that applies a
 * tab close must route its `closed` list through here; the split layout also
 * sheds the entries, so a later tab reusing nothing can inherit nothing. */
export function cascadeSplits(
  splits: SplitLayout,
  closedPrimaries: readonly string[],
): SplitChange {
  if (closedPrimaries.length === 0) return { closed: [], splits };
  const closed: string[] = [];
  let rest: Record<string, TabSplit> | null = null;
  for (const primary of closedPrimaries) {
    if (!Object.hasOwn(splits, primary)) continue;
    closed.push(splitSessionId(primary));
    rest ??= { ...splits };
    delete rest[primary];
  }
  if (rest === null) return { closed: [], splits };
  return { closed, splits: rest };
}

/** Drop stored splits whose primary is not an open session any more — the
 * repair for a saved layout that outlived its tabs (a crash between the two
 * writes, hand-edited storage). Nothing is closed here: a session this app
 * has no tab for is `sweep_orphaned_terminals`'s to end, not a render's. */
export function pruneSplits(
  splits: SplitLayout,
  openSessionIds: readonly string[],
): SplitLayout {
  const open = new Set(openSessionIds);
  const kept: Record<string, TabSplit> = {};
  let dropped = false;
  for (const [primary, split] of Object.entries(splits)) {
    if (open.has(primary)) kept[primary] = split;
    else dropped = true;
  }
  return dropped ? kept : splits;
}
