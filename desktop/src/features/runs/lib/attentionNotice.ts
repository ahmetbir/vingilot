// What the workspace says out loud, and the rule that keeps it quiet about the
// thing he is already looking at
// (vingilot/docs/plans/2026-08-09-signals-and-dashboards.md, Task 2).
//
// **Edges, not states.** Task 1's dots are standing claims, recomputed from
// scratch on every render and true for as long as the signal is. A notification
// is not a claim, it is an interruption: it must fire once, at the moment the
// claim becomes true, and never again while it stays true. So nothing here
// reads a single reading — every function below takes a *pair* of them, and
// what it returns is the difference.
//
// **The first reading only primes.** A worktree this app has no previous
// reading for cannot be said to have *become* anything: it may have been
// waiting since before the app was opened, or since before the owner navigated
// back to this screen (this module's caller unmounts on any route change, so
// that happens often). Firing on it would deliver the backlog as interruptions
// — the exact noise that costs the channel its credibility — so an id absent
// from `previous` is skipped rather than announced. No watermark, no seeded
// set: the rule falls out of comparing two readings.
//
// **Why `needs-you` alone.** It is the one state that does not resolve itself:
// a paused or blocked run stays that way until he answers, where a `working`
// row is moving and a `dirty` one is not going anywhere. `attentionSignal.ts`
// wrote that precedence down for the dots; this is the same order applied to
// the question "is this worth taking his attention for", and only the top of it
// clears the bar.
//
// **The answered turn is the second edge, and it is not a dot.** Task 1 dropped
// "an answer arrived and has not been seen" as a *state* because nothing marks
// an exchange read, so a dot would burn forever on every worktree ever asked a
// question. An edge needs no seen mark: the turn settling is a moment this app
// observed, it happens once, and after it fires there is nothing left standing.
// The same fact is honest as an interruption and dishonest as an indicator.
//
// Pure: no React, no Tauri, no store. `useAttentionNotices.ts` gathers the
// readings and does the sending.

import type { AttentionMark } from "./attentionSignal.ts";

/** One thing to say, about one worktree. */
export interface AttentionNotice {
  /** The worktree this is about: what the suppression rule compares against
   * what is on screen, and what the click lands on. */
  worktreeId: string;
  /** Where — the project and the branch, as a surface would name them. */
  title: string;
  /** What happened, and the signal it was read from. The words come from the
   * mark itself, so the notification and the dot's tooltip cannot come to
   * describe the same worktree differently. */
  body: string;
}

/** What the owner can see right now. Both fields are needed and neither is
 * enough: a focused window showing another worktree does not cover this one,
 * and this worktree selected in a window that is behind his browser is not
 * being looked at. */
export interface WorkspaceView {
  /** Whether this app's window has the OS focus. */
  focused: boolean;
  /** The worktree whose work surface is on screen — `null` on the landing view,
   * where nothing is. */
  worktreeId: string | null;
}

/**
 * **The suppression rule.** True when this notification must not be sent
 * because its subject is already in front of him.
 *
 * Notifications that fire while he is looking at the very thing are how a
 * channel is trained away: they arrive with nothing to do, get swiped, and the
 * next one — the one that mattered — is swiped with them. So the surface he is
 * standing in never announces itself.
 *
 * **Only the surface, not the sidebar.** A worktree row in the column carries
 * Task 1's dot, so a project's other worktrees are visible while he works in
 * one of them. That is not the same as being looked at: the dot is a standing
 * indicator he reads when he chooses to, and the whole point of this task is
 * the workspace reaching him when he is not reading. Suppression is therefore
 * the selected worktree only, and a sibling row going `needs-you` still speaks.
 */
export function suppressed(
  notice: AttentionNotice,
  view: WorkspaceView,
): boolean {
  return view.focused && view.worktreeId === notice.worktreeId;
}

/**
 * Every worktree that just entered `needs-you`, as something to say.
 *
 * `where` names a worktree the way a surface would — project and branch — and
 * returns `null` when this app cannot name it (a row that left the listing
 * between the two readings). A notification that cannot say where it is about
 * is not sent: "something needs you" is an interruption with no action in it.
 */
export function needsYouNotices(
  previous: ReadonlyMap<string, AttentionMark>,
  next: ReadonlyMap<string, AttentionMark>,
  where: (worktreeId: string) => string | null,
): AttentionNotice[] {
  const notices: AttentionNotice[] = [];
  for (const [worktreeId, mark] of next) {
    if (mark.state !== "needs-you") continue;
    const before = previous.get(worktreeId);
    // Absent: nothing to have changed from (see the header). Already
    // `needs-you`: the interruption was delivered when it became true.
    if (before === undefined || before.state === "needs-you") continue;
    const place = where(worktreeId);
    if (place === null) continue;
    notices.push({ body: mark.sentence, title: place, worktreeId });
  }
  return notices;
}

/** The turn this app had out in `worktreeId` has ended. `null` when the place
 * cannot be named, for the reason `needsYouNotices` gives.
 *
 * "Ended", not "answered": a turn that came back a refusal — no adapter on this
 * machine, a crashed process — also stopped waiting for him and also wrote its
 * outcome into the exchange (`askThread.ts`). Both are worth walking back for,
 * and the word covers both without claiming which one arrived. */
export function answeredNotice(
  worktreeId: string,
  where: string | null,
): AttentionNotice | null {
  if (where === null) return null;
  return {
    body: "the agent turn started here has ended — the Agent pane has what came back",
    title: where,
    worktreeId,
  };
}
