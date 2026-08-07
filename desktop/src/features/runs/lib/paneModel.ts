// What sits beside the terminal, how wide it is, and whether it is showing at
// all — the whole of the work surface's layout, as data
// (vingilot/docs/plans/2026-08-07-panes-and-polish.md, Task 4).
//
// **The right side of the split is a slot.** Diff, Runs, Evidence and Agent
// are panes that plug into it, and so are the panes that do not exist yet
// (Plan, Notes, agent chat, stack status). That is why the layout is data and
// not a set of booleans in a component: every later feature adds a row to a
// table rather than a branch to a render.
//
// **Availability is part of a pane, not of its caller.** A Diff pane without a
// checkout has nothing to read; an Evidence pane without an owner run has no
// transcript. Both must *say so* — a pane that renders empty is
// indistinguishable from a worktree with nothing in it, and one that vanishes
// from the picker looks like a bug in the picker. So availability answers with
// a sentence, and the frame prints it.
//
// **"Not yet" is not "no".** `cwdPending` exists because the worktree root is
// resolved asynchronously on app start: for the first frames after launch a
// worktree that has a perfectly good checkout cannot name it. Telling the
// owner then that this worktree has no directory would be reading an empty
// answer as a negative one, so that case is its own status and says it is
// waiting.
//
// Keyed by worktree binding id, like `terminalTabStore.ts`'s tab layout and
// for the same reason: the owner works one way in his main checkout and
// another in a run's worktree, and coming back to either should look like how
// he left it.

/** Every pane the work surface can show. This list is the extension point the
 * later features plug into — a Plan pane, a Notes pane, a stack-status pane
 * are each one entry here plus one component.
 *
 * **It is internal, and stays internal.** No part of it is exported to
 * anything outside this feature, and none of it is a stable contract yet:
 * freezing a plugin API before more than these panes have been written against
 * it would freeze whatever these four happened to need. It becomes an API when
 * a pane nobody here wrote needs one, not before. */
export const PANE_IDS = [
  "terminal",
  "diff",
  "agent",
  "evidence",
  "runs",
] as const;

export type PaneId = (typeof PANE_IDS)[number];

/** The pane on the left, which the owner does not choose.
 *
 * Not a placeholder for a picker nobody got round to: the terminal's instances
 * are owned by `RunsScreen` and outlive every view of them, so unlike the other
 * panes it cannot be *constructed* into a slot — moving it between sides would
 * mean re-creating an xterm and re-attaching its session, which is how
 * scrollback gets destroyed. A left picker is a real feature, and its first
 * task is that problem, not this constant. */
export const LEFT_PANE: PaneId = "terminal";

/** What the panes are allowed to know about the worktree under them. Facts,
 * not components — an availability rule that needed a React hook would be a
 * rule that could not be tested. */
export interface PaneContext {
  /** The worktree's own directory, or `null` when this app cannot name one. */
  cwd: string | null;
  /** True while the answer for `cwd` has not arrived yet (the desktop shell's
   * home-directory lookup is in flight). A `null` cwd means two different
   * things depending on this flag, and only one of them is a refusal. */
  cwdPending: boolean;
  /** The Run that owns this worktree, or `null` for one nobody's run made. */
  ownerRunId: string | null;
}

/** Whether a pane can do its job here, and what to say when it cannot.
 *
 * `pending` is deliberately not `unavailable`: it means the backing may well
 * be there and this app has not been told yet, so the pane stays selectable
 * and the frame says it is waiting. */
export type PaneAvailability =
  | { status: "available" }
  | { status: "pending"; note: string }
  | { status: "unavailable"; reason: string };

const AVAILABLE: PaneAvailability = { status: "available" };

/** Always available. The terminal is the one pane that reports its own waiting
 * state from the inside — it has a session and a screen to show even before a
 * cwd resolves — so intercepting it here would replace a live terminal with a
 * sentence about one. */
export function terminalAvailability(): PaneAvailability {
  return AVAILABLE;
}

/** git needs a directory. */
export function diffAvailability(ctx: PaneContext): PaneAvailability {
  if (ctx.cwd !== null) return AVAILABLE;
  if (ctx.cwdPending) {
    return { note: "waiting for this worktree's checkout…", status: "pending" };
  }
  return {
    reason:
      "this worktree has no directory this app can name, so there is nothing for git to read here.",
    status: "unavailable",
  };
}

/** So does an agent — it is started *in* a worktree. Whether a harness is
 * installed is a separate question the pane asks for itself, because the
 * answer comes from a subprocess probe and nothing synchronous can know it. */
export function agentAvailability(ctx: PaneContext): PaneAvailability {
  if (ctx.cwd !== null) return AVAILABLE;
  if (ctx.cwdPending) {
    return { note: "waiting for this worktree's checkout…", status: "pending" };
  }
  return {
    reason:
      "this worktree has no directory this app can name, so an agent has nowhere to be started.",
    status: "unavailable",
  };
}

/** An owner run is the transcript. A worktree the owner made himself has none,
 * and never will — that is a fact about the worktree, not a delay. */
export function evidenceAvailability(ctx: PaneContext): PaneAvailability {
  if (ctx.ownerRunId !== null) return AVAILABLE;
  return {
    reason:
      "no run owns this worktree, so there is no transcript to read. A worktree you made yourself never has one.",
    status: "unavailable",
  };
}

/** The workspace always has a run list, even when it is empty — and an empty
 * one is an answer worth showing. */
export function runsAvailability(): PaneAvailability {
  return AVAILABLE;
}

/** Which side of the split a pane is asked about. */
export interface PaneState {
  /** The pane in the right slot. Kept while collapsed, so restoring brings
   * back what was there rather than a default. */
  right: PaneId;
  /** True while the right slot is hidden and the terminal has the full width.
   * The owner's pre-pane layout, one keystroke away and remembered. */
  collapsed: boolean;
  /** The left pane's share of the surface, 0…1. */
  ratio: number;
}

export type PaneLayout = Record<string, PaneState>;

/** The terminal keeps the larger half by default: it is what the owner came
 * for, and the pane beside it is the reference material. */
export const DEFAULT_RATIO = 0.6;

/** Neither side may be squeezed to a sliver.
 *
 * This is a terminal guard as much as a taste one. A pty's width is its
 * shell's width, and under tmux the attached client's size *is* the session's
 * size — dragging the divider to the edge would re-wrap every line of the
 * scrollback to fit a column count nobody wants, and dragging back does not
 * un-wrap it. */
export const MIN_RATIO = 0.2;
export const MAX_RATIO = 0.8;

/** One arrow press on the focused divider. Small enough that holding the key
 * is a smooth resize rather than a jump between two layouts. */
export const RATIO_STEP = 0.02;

/** The same press with ⇧ — for crossing the surface without holding a key
 * down for four seconds. */
export const RATIO_STEP_COARSE = 0.1;

const DEFAULT_STATE: PaneState = {
  collapsed: false,
  ratio: DEFAULT_RATIO,
  right: "diff",
};

/** What a worktree nobody has arranged yet looks like: the split, open, with
 * Diff beside the terminal. Diff rather than nothing because the split is the
 * feature and a surface that looks identical to the old one teaches the owner
 * nothing — and ⌥⌘B puts it back the way it was, per worktree, for good. */
export function defaultPaneState(): PaneState {
  return { ...DEFAULT_STATE };
}

/** The arrangement recorded under `key`, or the default for a worktree that
 * has none. */
export function panesFor(layout: PaneLayout, key: string): PaneState {
  return layout[key] ?? DEFAULT_STATE;
}

/** What the right-hand picker may offer: every pane except the one already on
 * the left. Two slots showing the same pane is not a layout anybody wants, and
 * for the terminal it is not even possible — there is one set of sessions. */
export function rightChoices(): PaneId[] {
  return PANE_IDS.filter((id) => id !== LEFT_PANE);
}

export function clampRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return DEFAULT_RATIO;
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio));
}

/** Returns the layout unchanged — the same object, not a copy — when nothing
 * moves, so a caller mirroring it into storage on every change does not write
 * on a no-op. Every writer below keeps that property. */
function withState(
  layout: PaneLayout,
  key: string,
  next: PaneState,
): PaneLayout {
  const current = panesFor(layout, key);
  if (
    current.right === next.right &&
    current.collapsed === next.collapsed &&
    current.ratio === next.ratio
  ) {
    return layout;
  }
  return { ...layout, [key]: next };
}

/** Choosing a pane also opens the slot: picking Diff from a collapsed surface
 * can only mean "and show it to me". */
export function withRight(
  layout: PaneLayout,
  key: string,
  right: PaneId,
): PaneLayout {
  const current = panesFor(layout, key);
  return withState(layout, key, { ...current, collapsed: false, right });
}

export function withRatio(
  layout: PaneLayout,
  key: string,
  ratio: number,
): PaneLayout {
  const current = panesFor(layout, key);
  return withState(layout, key, { ...current, ratio: clampRatio(ratio) });
}

export function nudgeRatio(
  layout: PaneLayout,
  key: string,
  delta: number,
): PaneLayout {
  return withRatio(layout, key, panesFor(layout, key).ratio + delta);
}

export function resetRatio(layout: PaneLayout, key: string): PaneLayout {
  return withRatio(layout, key, DEFAULT_RATIO);
}

export function withCollapsed(
  layout: PaneLayout,
  key: string,
  collapsed: boolean,
): PaneLayout {
  const current = panesFor(layout, key);
  return withState(layout, key, { ...current, collapsed });
}

export function toggleCollapsed(layout: PaneLayout, key: string): PaneLayout {
  return withCollapsed(layout, key, !panesFor(layout, key).collapsed);
}

/** Where a drag put the divider, as a ratio of the surface it is inside.
 *
 * `null` for a surface with no width to divide — a work surface measured
 * mid-layout, or one inside a hidden subtree. The caller keeps the ratio it
 * had, which is the only safe reading: a 0-width surface would otherwise
 * resolve to the clamp floor and re-wrap a terminal nobody was dragging. */
export function ratioFromPointer(
  surfaceLeft: number,
  surfaceWidth: number,
  clientX: number,
): number | null {
  if (!Number.isFinite(surfaceWidth) || surfaceWidth <= 0) return null;
  if (!Number.isFinite(surfaceLeft) || !Number.isFinite(clientX)) return null;
  return clampRatio((clientX - surfaceLeft) / surfaceWidth);
}
