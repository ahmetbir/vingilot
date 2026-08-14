// What the status bar is allowed to say about terminals outliving the app.
//
// The same honesty rule the isolation copy follows: never imply a persistence
// that is not there, and never imply more of it than there is. Two things go
// wrong if this drifts. Claiming persistence the app cannot deliver costs the
// owner a day's shell state the first time they trust it. Claiming it without
// its boundary is the subtler failure — tmux sessions survive quitting the
// app and do not survive a reboot, and someone who read only the first half
// finds that out by losing everything after a restart they did not choose.
//
// So the boundary is in the visible label, not only in the hover text — on
// surfaces with room for a sentence (the scratch shell's own footer). The
// status bar is not one of those: it is a glance surface, and a sentence
// there dissolves into the `·`-separated run around it. The bar shows the
// `short` — a word that names the backing and claims nothing — and carries
// the label and detail together in its tooltip. The rule that keeps this
// honest: **a short may state a fact but never half a promise.** "tmux" is a
// fact; "persistent" without "not a reboot" is the drift the label was
// written to prevent, so the persistence claim itself never appears in a
// short at all.
//
// **Two claims live here, and they must not be readable as each other.**
// `persistenceCopy` is about **the worktree's terminals** — the tabs in the
// strip, backed by tmux. `SCRATCH_PERSISTENCE` is about the scratch shell,
// which is backed by nothing and is meant to be. They sit in one file for
// exactly that reason: the way this drifts is one sentence being written
// without the other in view, and the worktree label saying "terminals:" was
// already a sentence a scratch shell could hide inside. So the worktree copy
// names its subject in the label, and the scratch copy says what it is *not*
// covered by.

import type { PtyBacking } from "@/features/runs/lib/ptyClient";

export interface PersistenceCopy {
  /** The status bar's glance form: a word or two naming the backing, never
   * the persistence claim itself (header's rule). */
  short: string;
  /** One line carrying the claim and its limit together, for surfaces with
   * room for a sentence — the scratch footer, and the bar's tooltip. */
  label: string;
  /** The same thing said in full, for the title/tooltip. */
  detail: string;
}

const TMUX: PersistenceCopy = {
  detail:
    "Each of this worktree's terminal tabs runs inside a tmux session, so it keeps running after you quit the app and is still there when you open it again. It does not survive a reboot, a tmux kill-server, or a crash — the same limits as any other tmux session on this machine. The scratch shell is not one of these and keeps nothing.",
  label:
    "worktree terminals: persistent (tmux) — survive quitting the app, not a reboot",
  short: "tmux",
};

const APP_PROCESS: PersistenceCopy = {
  detail:
    "tmux was not found, so each of this worktree's terminal tabs is a plain shell this app owns. Quitting the app ends it and nothing is kept. Install tmux to keep them running across restarts.",
  label: "worktree terminals: this session only — they end when the app quits",
  short: "session-only",
};

/** What the scratch shell is, said in its own sentence.
 *
 * **It names every door that ends it, including the ones the owner walks
 * through without meaning to.** Closing it is the obvious one. Going to another
 * worktree ends it too (`scratchTerminal.ts`'s `scratchOnWorktree`), and so does
 * leaving this screen (`RunsScreen`'s unmount) — and a shell running `tail -f`
 * or a build dies with them, with nothing asked and nothing to undo. The
 * alternative was to warn before ending a shell with something live in it; this
 * copy is the other choice, and it is the honest one for a terminal whose whole
 * point is being thrown away: a scratch shell that stops to ask permission is a
 * tab with extra steps. Saying so up front is what makes that trade the owner's
 * rather than a surprise, so this sentence must keep saying it.
 *
 * Not a reading of `PtyBacking` and deliberately not a function of it: a
 * scratch shell asks for the direct spawn whatever tmux is on the machine
 * (`vingilot_pty/tmux.rs`'s `Lifetime::Ephemeral`), so there is one answer and
 * no state in which this could say something else. A copy that switched on the
 * backing would be a copy that could one day claim persistence for the one
 * terminal whose whole point is not having any. */
export const SCRATCH_PERSISTENCE: PersistenceCopy = {
  detail:
    "The scratch shell is not one of this worktree's terminals. It has no tab in the strip, no tmux session behind it, and nothing about it is written down. It ends when you close it, when you go to another worktree or project, when you leave this screen, and when you quit the app — and whatever it is running at the time ends with it, unasked: a tail, a build, a long test run. Anything that has to outlive that belongs in one of this worktree's terminal tabs, which is what the line beside this one is about.",
  label:
    "scratch shell: nothing is kept — closing it or leaving ends it, and what it is running",
  short: "scratch: not kept",
};

/** The copy for a backing, or `null` when the backing is not known yet.
 *
 * `null` renders nothing at all rather than a default. A guess here is a
 * claim, and an unanswered `pty_backing` (a browser preview, an app still
 * starting) is not evidence for either answer. */
export function persistenceCopy(
  backing: PtyBacking | null,
): PersistenceCopy | null {
  if (backing === "tmux") return TMUX;
  if (backing === "app-process") return APP_PROCESS;
  return null;
}
