// Pure model for the **TAB SPLIT** — two tabs sharing the stage, each drawing
// whatever it draws, with a divider between them (2026-08-29 redesign, P4.7;
// owner: "iki tab yan yana acabilmeliyim filan").
//
// **Three different things in this app are called "split", and this is the
// third one.** The plan's own Vocabulary section fixes the names; they are
// repeated here because this is the module most likely to be mistaken for one
// of the others:
//
// 1. **Terminal split** (`terminalSplit.ts`, ⌘D / ⇧⌘D) — TWO PTYS inside ONE
//    tab, with a divider. About shells. Nothing here knows what a pty is.
// 2. **Diff Split/Unified** (`diffMode.ts`, the `.dvseg` control) — a RENDERING
//    MODE of one patch: side-by-side columns against one inline column. Nothing
//    in the layout splits; no second tab, no pane, no pty. It belongs to the
//    diff viewer alone and this module must never be reached from it.
// 3. **Tab split** — this file. Two TABS on the stage.
//
// A diff rendered in Split mode, inside a tab that is itself in a tab split, is
// an ordinary legal state: three dividers on screen, three meanings, each named
// for what it does. Nothing here may ever be called "unified".
//
// **What a tab split is.** One extra *stage key* beside the strip's own
// selection, and a ratio. The left half always draws whatever the existing
// selection resolves to — the showing view, or the active terminal — so the two
// models that own tabs (`terminalTabs.ts`, `viewTabs.ts`) are untouched by this
// one and keep meaning exactly what they meant. The right half draws the
// secondary key. That is the whole state, and keeping it that thin is what lets
// the halves be *geometry* rather than containers.
//
// **The pty-safety invariant, and how this model earns it.** P2's rule stands:
// a tab that moves must never reattach, resize or end a terminal. A model that
// held two LISTS — one per half — would make "move this tab to the other half"
// a removal from one list and an insertion into another, which is a different
// parent in the DOM, which is a new xterm, a fresh attach and a replay into a
// box that has not been laid out (`WorkSurface.tsx`'s header). So there are no
// lists: there is one key naming which tab the right half draws, and the host
// renders every terminal exactly where it always rendered it and merely gives
// it a different `order` and `flex-grow`. A tab changing halves changes two CSS
// numbers on a box that never moves in the tree. Nothing is unmounted, nothing
// is reparented, and no `pty_*` call is anywhere on the path.
//
// **Not persisted, deliberately, and for `viewTabs.ts`'s reason.** Half of what
// a tab split can hold is a *reading* — a file as it is now, a patch as git
// reports it now — and those are not written to disk because restoring one puts
// last week's reading on screen wearing a live tab's chrome. A split whose
// right half was such a reading would be restored pointing at nothing, so the
// arrangement lives as long as the workspace does, which is the life of the
// reading it can hold.

/** A tab on the stage, from either of the two lists that own tabs. */
export type StageTab =
  | { kind: "terminal"; n: number }
  | { kind: "view"; id: string };

/** Which half of the stage. `left` is the strip's own selection, `right` is
 * the secondary — see the header for why the asymmetry is the point. */
export type TabSplitHalf = "left" | "right";

const TERMINAL_PREFIX = "term:";
const VIEW_PREFIX = "view:";

/** The one string that names a tab across both lists.
 *
 * Injective: a terminal's key is the prefix plus decimal digits, a view's is
 * the prefix plus a `viewId` — and `viewId` never starts with `term:`, since
 * its own three shapes are `file:`, `commit:`, `diff:` and the bare word
 * `history`. Nothing parses a key back to reach a pty; `parseStageKey` exists
 * so a host can ask "is the tab under the cursor a shell or a reading", which
 * is a question about what to draw. */
export function stageKey(tab: StageTab): string {
  return tab.kind === "terminal"
    ? `${TERMINAL_PREFIX}${tab.n}`
    : `${VIEW_PREFIX}${tab.id}`;
}

/** The tab a key names, or `null` for a string this module did not mint. */
export function parseStageKey(key: string): StageTab | null {
  if (key.startsWith(TERMINAL_PREFIX)) {
    const digits = key.slice(TERMINAL_PREFIX.length);
    if (!/^[0-9]+$/.test(digits)) return null;
    return { kind: "terminal", n: Number(digits) };
  }
  if (key.startsWith(VIEW_PREFIX)) {
    const id = key.slice(VIEW_PREFIX.length);
    return id === "" ? null : { id, kind: "view" };
  }
  return null;
}

/** The strip's order as stage keys: the shells first, then the readings, which
 * is exactly the row the owner sees (`TerminalTabStrip.tsx`). */
export function stageOrder(
  tabs: readonly number[],
  views: readonly { readonly id: string }[],
): string[] {
  return [
    ...tabs.map((n) => stageKey({ kind: "terminal", n })),
    ...views.map((view) => stageKey({ id: view.id, kind: "view" })),
  ];
}

export interface TabSplitState {
  /** The stage key the RIGHT half draws. Never equal to the left half's — see
   * `openTabSplit`. */
  readonly secondary: string;
  /** The left half's share, 0.2–0.8, clamped on every write for
   * `terminalSplit.ts`'s reason: a half at zero pixels is a terminal that was
   * just resized to nothing. */
  readonly ratio: number;
  /** Which half the keyboard is in. ⌘W closes the tab in THIS half, and the
   * strip lights it. */
  readonly focus: TabSplitHalf;
}

/** Every worktree's tab split, keyed by binding id — a record for the reason
 * `TabLayout` is one: membership is the question asked of it. */
export type TabSplitLayout = Readonly<Record<string, TabSplitState>>;

/** The floor either half may be dragged to. */
export const MIN_TAB_SPLIT_RATIO = 0.2;

export function emptyTabSplits(): TabSplitLayout {
  return {};
}

export function tabSplitOf(
  layout: TabSplitLayout,
  bindingId: string | null,
): TabSplitState | null {
  if (bindingId === null) return null;
  return Object.hasOwn(layout, bindingId) ? layout[bindingId] : null;
}

function clampRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0.5;
  if (ratio < MIN_TAB_SPLIT_RATIO) return MIN_TAB_SPLIT_RATIO;
  if (ratio > 1 - MIN_TAB_SPLIT_RATIO) return 1 - MIN_TAB_SPLIT_RATIO;
  return ratio;
}

/** Put a tab in the right half.
 *
 * Refused when the key would be the left half's too: one tab cannot be in two
 * places, and a shell certainly cannot — there is one pty and one xterm behind
 * it. The caller (`useDeckLayers.ts`) is what moves the left half's selection
 * off the tab being split, using `neighbourKey` below; this only ever states
 * the arrangement, never reaches into the two tab models.
 *
 * Focus goes to the new half, which is VS Code's own answer and the useful one:
 * the owner split *this* tab out, so this tab is the one he is now looking at. */
export function openTabSplit(
  layout: TabSplitLayout,
  bindingId: string,
  secondary: string,
  primary: string,
): TabSplitLayout {
  if (secondary === primary) return layout;
  const current = tabSplitOf(layout, bindingId);
  const ratio = current === null ? 0.5 : current.ratio;
  return { ...layout, [bindingId]: { focus: "right", ratio, secondary } };
}

/** End the split — the stage goes back to one tab. Closes nothing: both halves
 * were already open tabs and stay open tabs, which is the difference between
 * this and `closeSplit` in `terminalSplit.ts`, where the second half is a shell
 * that only the split gave a surface to. */
export function closeTabSplit(
  layout: TabSplitLayout,
  bindingId: string,
): TabSplitLayout {
  if (!Object.hasOwn(layout, bindingId)) return layout;
  const { [bindingId]: _ended, ...rest } = layout;
  return rest;
}

export function setTabSplitRatio(
  layout: TabSplitLayout,
  bindingId: string,
  ratio: number,
): TabSplitLayout {
  const current = tabSplitOf(layout, bindingId);
  if (current === null) return layout;
  const clamped = clampRatio(ratio);
  if (clamped === current.ratio) return layout;
  return { ...layout, [bindingId]: { ...current, ratio: clamped } };
}

/** Move the keyboard to a half. A worktree with no split has one half and
 * nothing to move to. */
export function focusTabSplit(
  layout: TabSplitLayout,
  bindingId: string,
  half: TabSplitHalf,
): TabSplitLayout {
  const current = tabSplitOf(layout, bindingId);
  if (current === null || current.focus === half) return layout;
  return { ...layout, [bindingId]: { ...current, focus: half } };
}

/** Which half a key is drawn in, or `null` when it is not on the stage at all.
 *
 * The one question the host asks per tab per render, and the reason the halves
 * can be geometry: the answer is a CSS `order` and a `flex-grow`, applied to a
 * box that never changes parents. */
export function halfOf(
  split: TabSplitState | null,
  key: string,
  primary: string,
): TabSplitHalf | null {
  if (split !== null && key === split.secondary) return "right";
  if (key === primary) return "left";
  return null;
}

/** What the strip's own selection should fall back to when the tab it names is
 * being moved into the other half — the neighbour, the way every close in this
 * app lands on the tab that took the old one's place.
 *
 * `null` when there is nothing to fall back to, which is a stage with one tab
 * on it: a split needs two, and refusing is the honest answer. */
export function neighbourKey(
  ordered: readonly string[],
  key: string,
): string | null {
  const at = ordered.indexOf(key);
  if (at === -1) return null;
  const rest = ordered.filter((other) => other !== key);
  if (rest.length === 0) return null;
  return rest[Math.min(at, rest.length - 1)];
}

/** Forget the worktrees the tab model no longer holds. Closes nothing — a tab
 * split owns no session, the same argument `pruneViews` makes. */
export function pruneTabSplits(
  layout: TabSplitLayout,
  liveBindingIds: readonly string[],
): TabSplitLayout {
  const live = new Set(liveBindingIds);
  const kept: Record<string, TabSplitState> = {};
  let dropped = false;
  for (const [bindingId, split] of Object.entries(layout)) {
    if (live.has(bindingId)) kept[bindingId] = split;
    else dropped = true;
  }
  return dropped ? kept : layout;
}

/** End a split whose right half is not an open tab any more.
 *
 * The repair for the ordinary case, not an exotic one: closing the secondary
 * tab from the strip, or its worktree losing that shell, leaves a key naming
 * nothing — and a half drawing nothing is a blank column beside the work.
 * Returns its input untouched when the key is still live, so a caller can use
 * reference equality to skip the write and this settles instead of looping. */
export function reconcileTabSplit(
  layout: TabSplitLayout,
  bindingId: string,
  liveKeys: readonly string[],
): TabSplitLayout {
  const split = tabSplitOf(layout, bindingId);
  if (split === null) return layout;
  if (liveKeys.includes(split.secondary)) return layout;
  return closeTabSplit(layout, bindingId);
}
