// When the diff pane may ask git again, and what a re-read is not allowed to
// disturb (vingilot/docs/plans/2026-08-07-workspace-v1.md, Task 7 — the panel
// that showed the worktree as it was at the moment it was opened).
//
// The owner watches an agent work in the terminal beside this pane. A diff
// that does not move is not merely unhelpful, it is wrong: it looks current.
//
// **The interval is derived from what the last read cost, not chosen.** A
// `worktree_diff` is one `git diff` subprocess per changed file, and that is
// what it costs. Measured on the owner's machine (Apple silicon, warm page
// cache, `vingilot_worktree::diff::diff` against a temp repo, best of three):
//
//     files    1     10     40     100     200
//     ms      70    182    545    1263    2524
//
// — about 58 ms of fixed probing plus ~12 ms per changed file. A single fixed
// interval has to be wrong at one end of that: 2 s keeps a 100-file worktree
// permanently busy running git, and 30 s makes a three-file worktree feel as
// dead as it does today. So the pane spends a fixed *share* of one core
// instead of a fixed period: the next gap is the last read's duration times
// `COST_SHARE`, which holds git at 1/20th — 5% — of one core no matter how big
// the worktree got, and degrades by getting slower rather than by pinning the
// machine.
//
// In practice that is a ~3 s gap on a handful of files, ~11 s at forty, and
// the 30 s ceiling past a hundred and fifty. What the ceiling costs in
// staleness the pane pays back by *saying* how stale it is (`freshnessLabel`)
// and by keeping a Read button that is never disabled.
//
// **The gap is measured from the end of the last read, never from its start.**
// A read slower than its own interval cannot queue behind itself, because the
// next one is not scheduled until this one has landed — and `shouldRead`
// refuses outright while one is in flight, so the wake-up triggers cannot do
// what the timer cannot.
//
// Pure: no React, no Tauri, no clock of its own. `now` is always passed in,
// which is the only reason any of this is testable.

/** Why a read is being considered.
 *
 * - `opened` — the pane just mounted. It is keyed by worktree in the pane
 *   registry, so a worktree switch arrives here as a fresh mount and needs no
 *   trigger of its own.
 * - `tick` — the pump, wondering whether the gap has elapsed.
 * - `shown` — the window became visible again, or regained focus.
 * - `asked` — the owner pressed Read, or changed the base ref.
 */
export type RefreshTrigger = "asked" | "opened" | "shown" | "tick";

export interface RefreshState {
  /** When the last read *ended*, successful or not. `null` before the first.
   * The gap is measured from here rather than from when it started. */
  attemptedAt: number | null;
  /** What this pane owes before its next unprompted read. */
  gapMs: number;
  /** When the last *successful* read landed — what the freshness label is
   * about. A refusal does not make what is on screen any newer. */
  readAt: number | null;
  /** A read is in flight. Nothing but the owner may start another. */
  reading: boolean;
}

/** The floor. Below this the fixed ~58 ms probe cost starts to dominate the
 * read, and no eye can tell 3 s of staleness from none. */
export const MIN_GAP_MS = 3_000;

/** The ceiling. Even a worktree big enough to cost a second and a half of git
 * is re-read every half minute — with the label saying so — rather than
 * silently abandoned. */
export const MAX_GAP_MS = 30_000;

/** One part git to nineteen parts idle. The whole interval decision, in one
 * number: see this module's header for the measurement it is applied to. */
export const COST_SHARE = 20;

/** A pane that has never read. */
export const UNREAD: RefreshState = {
  attemptedAt: null,
  gapMs: MIN_GAP_MS,
  readAt: null,
  reading: false,
};

/** How long to wait after a read that took `tookMs`.
 *
 * A read that reported no duration at all (a clock that moved, a stub) is
 * treated as free rather than as instant-and-therefore-repeatable: it gets the
 * floor, not zero. */
export function nextGapMs(tookMs: number): number {
  if (!Number.isFinite(tookMs) || tookMs <= 0) return MIN_GAP_MS;
  const budgeted = Math.round(tookMs * COST_SHARE);
  return Math.min(MAX_GAP_MS, Math.max(MIN_GAP_MS, budgeted));
}

/** May a read start right now?
 *
 * The owner's own press is the only thing that outranks a read in flight, and
 * it does so because the alternative is a button that silently does nothing.
 * The caller drops the superseded answer rather than rendering it. */
export function shouldRead(
  state: RefreshState,
  at: { now: number; onScreen: boolean; trigger: RefreshTrigger },
): boolean {
  if (at.trigger === "asked") return true;
  // No stacking, ever. This is the whole guarantee — the pump, the wake-ups
  // and the mount all pass through here.
  if (state.reading) return false;
  // A pane nobody can see is a pane spending git subprocesses on nothing.
  // Visibility, not focus: a window on a second monitor is being looked at
  // even while the owner types elsewhere, and freezing it then would be the
  // original complaint again.
  if (!at.onScreen) return false;
  if (state.attemptedAt === null) return true;
  const since = at.now - state.attemptedAt;
  // A clock that moved backwards (a sleep, an NTP step) must not freeze this
  // pane until the difference has been waited out a second time.
  if (since < 0) return true;
  if (at.trigger === "tick") return since >= state.gapMs;
  // Coming back to the window is not a reason to re-read something read a
  // moment ago; ⌘-tabbing twice must not cost two reads.
  return since >= MIN_GAP_MS;
}

/** A read has started. */
export function began(state: RefreshState): RefreshState {
  return { ...state, reading: true };
}

/** A read has landed. `ok` is whether git answered, which is what decides
 * whether the panel got any newer — the gap is re-derived either way, because
 * a refusal that took two seconds cost two seconds. */
export function ended(
  state: RefreshState,
  at: { now: number; ok: boolean; tookMs: number },
): RefreshState {
  return {
    attemptedAt: at.now,
    gapMs: nextGapMs(at.tookMs),
    readAt: at.ok ? at.now : state.readAt,
    reading: false,
  };
}

/** How old what is on screen is, in words. The complaint this whole module
 * answers is that the pane looked current and was not, so a pane that has to
 * be stale says how stale rather than saying nothing. */
export function freshnessLabel(readAt: number | null, now: number): string {
  if (readAt === null) return "not read yet";
  const seconds = Math.max(0, Math.floor((now - readAt) / 1000));
  if (seconds < 5) return "read just now";
  if (seconds < 60) return `read ${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `read ${minutes}m ago`;
  return `read ${Math.floor(minutes / 60)}h ago`;
}

/** Where the reader was, carried across a re-read.
 *
 * The file he had open is followed by *path*, not by position: an agent that
 * creates a file sorts it into the middle of the list and would otherwise slide
 * the patch he was reading out from under him. A file that is gone — reverted,
 * committed away — leaves the cursor where it stood, which is where its
 * neighbours are, rather than snapping back to the top of a 200-file list. */
export function indexAfterRefresh(
  paths: readonly string[],
  wanted: string | null,
  previous: number,
): number {
  if (paths.length === 0) return 0;
  if (wanted !== null) {
    const found = paths.indexOf(wanted);
    if (found !== -1) return found;
  }
  return Math.min(Math.max(previous, 0), paths.length - 1);
}
