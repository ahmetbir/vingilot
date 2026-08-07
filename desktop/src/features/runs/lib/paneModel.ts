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
// **A pane may need to ask the world something.** Availability is synchronous
// — it runs inside a render — and the questions that decide whether a pane can
// work here mostly are not: is a harness installed, is a docker daemon up. So
// a pane declares a `PaneProbe`, the host runs every probe the registry
// carries without knowing what any of them asks, and the answer arrives in the
// context. Without that, every such pane would need a new field on
// `PaneFacts`, computed in `RunsScreen` and threaded down — which is the host
// being edited for each new pane, and the opposite of a table.
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
export interface PaneFacts {
  /** The worktree's own directory, or `null` when this app cannot name one. */
  cwd: string | null;
  /** True while the answer for `cwd` has not arrived yet (the desktop shell's
   * home-directory lookup is in flight). A `null` cwd means two different
   * things depending on this flag, and only one of them is a refusal. */
  cwdPending: boolean;
  /** The Run that owns this worktree, or `null` for one nobody's run made. */
  ownerRunId: string | null;
  /** The selected worktree's binding id, `null` on a surface with none. Panes
   * name what they are a reading of in terms of this rather than the host
   * deciding for them; see `PaneEntry.identity`. */
  worktreeId: string | null;
}

/** How far the asking has got on a question a pane put to the world.
 *
 * - `asking`: nobody has answered yet. Not a refusal — the pane says it is
 *   waiting, the same distinction `cwdPending` draws.
 * - `unknown`: the question could not be put at all (no backend to ask, a
 *   probe that threw). A **terminal** state, not a wait: this is the one the
 *   pending/absent confusion keeps producing, so it is its own word and a
 *   pane that reads it must not report a refusal it never received.
 * - `yes` / `no`: the world answered. */
export type ProbeAnswer = "asking" | "no" | "unknown" | "yes";

/** What a probe found. `null` is "the question could not be put", which is not
 * the same answer as `{ present: false }` and must never be folded into it. */
export type ProbeFinding = { present: boolean; detail?: string } | null;

/** A question a pane needs the world to answer before it can say whether it
 * can work here — "is a harness installed?", "is there a docker daemon?".
 *
 * It exists because `availability` is synchronous by design (it runs inside a
 * render, and a rule needing a hook could not be tested), and the interesting
 * questions are not. A pane declares the question here and reads the answer
 * out of its context; the host runs whatever probes the registry carries
 * without knowing what any of them is about. That is the difference between a
 * new pane being a row in a table and a new pane being an edit to the host. */
export interface PaneProbe {
  id: string;
  ask: (facts: PaneFacts) => Promise<ProbeFinding>;
  /** What the answer depends on, when it depends on anything. Omitted for a
   * question about the machine, which is asked once per app run; a question
   * about the worktree returns something that changes with it (`cwd`, say) and
   * is re-asked when it does. */
  keyOf?: (facts: PaneFacts) => string;
}

/** An answer, plus whatever the world said beyond yes or no — a probe that
 * knows *why* is the difference between "no agent harness" and a sentence
 * naming the variable to set. */
export interface ProbeReading {
  answer: ProbeAnswer;
  detail: string | null;
}

const NOT_ASKED: ProbeReading = { answer: "asking", detail: null };
const UNASKABLE: ProbeReading = { answer: "unknown", detail: null };

/** What the panes are allowed to know, and to ask. */
export interface PaneContext extends PaneFacts {
  /** The reading for a question some pane registered a probe for. A question
   * nobody registered reads as `unknown`, never as `no`. */
  probe: (id: string) => ProbeReading;
}

/** Where an answer for this probe is filed. Two probes with the same id are
 * the same question; the same probe against two worktrees is two answers. */
export function probeSlot(probe: PaneProbe, facts: PaneFacts): string {
  return `${probe.id}\u0000${probe.keyOf === undefined ? "" : probe.keyOf(facts)}`;
}

export function readProbeFinding(finding: ProbeFinding): ProbeReading {
  if (finding === null) return UNASKABLE;
  return {
    answer: finding.present ? "yes" : "no",
    detail: finding.detail ?? null,
  };
}

/** The `probe` a context carries, built from whatever answers the host has
 * collected so far. Pure, so a test states its probe answers directly. */
export function probeReader(
  probes: PaneProbe[],
  answers: Record<string, ProbeReading>,
  facts: PaneFacts,
): (id: string) => ProbeReading {
  return (id) => {
    const probe = probes.find((entry) => entry.id === id);
    // Reading "no probe registered" as "no" would be an empty read taken for
    // a refusal — the mistake this project has made twice.
    if (probe === undefined) return UNASKABLE;
    return answers[probeSlot(probe, facts)] ?? NOT_ASKED;
  };
}

/** A context whose questions cannot be put at all — for a surface rendered
 * with no probe runner behind it. */
export function noProbes(): (id: string) => ProbeReading {
  return () => UNASKABLE;
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

/** The question the Agent pane cannot answer from facts alone: whether this
 * machine has a harness to hand a worktree to. `paneRegistry.tsx` registers
 * the probe that answers it. */
export const AGENT_HARNESS_PROBE = "agent-harness";

/** So does an agent — it is started *in* a worktree. And it needs a harness,
 * which is a question about the machine rather than about the worktree, so it
 * goes through a probe: the answer comes from a subprocess and nothing
 * synchronous can know it. */
export function agentAvailability(ctx: PaneContext): PaneAvailability {
  if (ctx.cwd === null) {
    if (ctx.cwdPending) {
      return {
        note: "waiting for this worktree's checkout…",
        status: "pending",
      };
    }
    return {
      reason:
        "this worktree has no directory this app can name, so an agent has nowhere to be started.",
      status: "unavailable",
    };
  }
  const harness = ctx.probe(AGENT_HARNESS_PROBE);
  if (harness.answer === "asking") {
    return { note: "looking for an agent harness…", status: "pending" };
  }
  if (harness.answer === "no") {
    return {
      reason:
        harness.detail ??
        "no ACP agent harness is installed on this machine, so there is nothing here to hand this worktree to.",
      status: "unavailable",
    };
  }
  // `unknown` is available on purpose: a build that could not put the question
  // has not been told no, and the panel reports what it finds for itself.
  return AVAILABLE;
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

/** Neither side may be squeezed to a sliver. A matter of taste, and nothing
 * else — a ratio cannot bound a column count, and this one was documented as
 * if it could. `MIN_LEFT_PX` below is the guard that was meant. */
export const MIN_RATIO = 0.2;
export const MAX_RATIO = 0.8;

/** One terminal cell's advance, in CSS pixels, for @xterm/xterm's stock 15px
 * monospace. Measured on the real surface rather than assumed: a 636px left
 * pane fits 68 columns, which is 9.1px a column once the pane's own padding
 * and xterm's scrollbar gutter are out of it. */
const CELL_PX = 9;

/** What a left pane spends on things that are not cells — its `px-2` and the
 * scrollbar gutter xterm reserves. Counted, because a floor derived from cell
 * width alone lands about a column and a half short of the number it claims. */
const TERMINAL_CHROME_PX = 32;

/** The terminal's floor, in pixels: **80 columns**, the width every TUI, every
 * man page and every wrapped commit message assumes.
 *
 * This is the guard `MIN_RATIO` was described as being and could not be. A
 * pty's width is its shell's width, and under tmux the sole attached client's
 * size *is* the session's size, so a drag that narrows the terminal re-wraps
 * every line of the scrollback to fit — and dragging back does not un-wrap it.
 * A ratio cannot say that: measured on a 549px work surface, the 0.2 ratio
 * clamp let a drag reach **12 columns**, which is the exact loss
 * `terminalFit.ts` exists to prevent arriving by a new path. */
export const MIN_LEFT_PX = 80 * CELL_PX + TERMINAL_CHROME_PX;

/** The right pane's floor. Smaller than the terminal's on purpose: what a
 * narrow Diff pane costs is legibility, and what a narrow terminal costs is
 * the scrollback. When a surface cannot hold both floors the terminal's wins
 * and this one gives way — and the owner's move there is ⌥⌘B, which is the
 * layout he had before there was a right pane at all. */
export const MIN_RIGHT_PX = 240;

/** The divider's own width, in CSS pixels.
 *
 * **It is the row's third member, not a hairline between two halves.** The
 * ratio divides what is left after it, so a floor derived from the whole
 * surface overstates what the left pane gets by exactly this much: measured on
 * the 1195px surface a maximised window gives, `MIN_LEFT_PX / surfaceWidth`
 * put the terminal at 747px — **79 columns**, one short of the number
 * `MIN_LEFT_PX` is named for, and the missing 5px were the divider.
 *
 * `PaneDivider` sizes itself from this constant instead of from a width class,
 * so the number the row is laid out with and the number this file subtracts
 * are one number. That is what makes the arithmetic below checkable against
 * what is drawn rather than only against itself. */
export const DIVIDER_PX = 8;

/** What the two panes actually have to divide between them: the surface, less
 * the divider standing in it. A surface narrower than the divider has nothing
 * to divide and answers 0, which every caller reads as "not measured yet". */
export function splitWidth(surfaceWidth: number): number {
  if (!Number.isFinite(surfaceWidth)) return 0;
  return Math.max(0, surfaceWidth - DIVIDER_PX);
}

/** The clamp for a surface whose width is known: the taste clamp, then the
 * floors, in that order.
 *
 * A surface of 0 (measured mid-layout, or inside a hidden subtree) has no
 * floors to apply — the ratio it was given comes back clamped only by taste,
 * because inventing a floor from a width nobody has measured is how a terminal
 * gets resized to a shape nobody laid out. */
export function clampRatioAt(ratio: number, surfaceWidth: number): number {
  const wanted = clampRatio(ratio);
  const shared = splitWidth(surfaceWidth);
  if (shared <= 0) return wanted;
  const floor = Math.min(MIN_LEFT_PX / shared, MAX_RATIO);
  const ceiling = Math.max(1 - MIN_RIGHT_PX / shared, floor);
  return Math.min(ceiling, Math.max(floor, wanted));
}

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

/** Where a drag put the divider, as a ratio of the width the panes share.
 *
 * The pointer holds the *middle* of the divider, and the divider is a member
 * of the row rather than a line drawn on the boundary — so the boundary the
 * owner is aiming at is half a divider to the left of his pointer, and the
 * width it divides is `splitWidth`, not the whole surface.
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
  const shared = splitWidth(surfaceWidth);
  if (shared <= 0) return null;
  if (!Number.isFinite(surfaceLeft) || !Number.isFinite(clientX)) return null;
  const boundary = clientX - surfaceLeft - DIVIDER_PX / 2;
  // Clamped to this surface's floors, not just to the ratio: the divider has
  // to stop where the layout stops, or the pointer walks on past a divider
  // that is no longer under it.
  return clampRatioAt(boundary / shared, surfaceWidth);
}
