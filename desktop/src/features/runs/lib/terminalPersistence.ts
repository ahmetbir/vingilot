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
// So the boundary is in the visible label, not only in the hover text: the
// label is what gets read.
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
  /** One line for the status bar. Carries the claim and its limit together. */
  label: string;
  /** The same thing said in full, for the title/tooltip. */
  detail: string;
}

const TMUX: PersistenceCopy = {
  detail:
    "Each of this worktree's terminal tabs runs inside a tmux session, so it keeps running after you quit the app and is still there when you open it again. It does not survive a reboot, a tmux kill-server, or a crash — the same limits as any other tmux session on this machine. The scratch shell is not one of these and keeps nothing.",
  label:
    "worktree terminals: persistent (tmux) — survive quitting the app, not a reboot",
};

const APP_PROCESS: PersistenceCopy = {
  detail:
    "tmux was not found, so each of this worktree's terminal tabs is a plain shell this app owns. Quitting the app ends it and nothing is kept. Install tmux to keep them running across restarts.",
  label: "worktree terminals: this session only — they end when the app quits",
};

/** What the scratch shell is, said in its own sentence.
 *
 * Not a reading of `PtyBacking` and deliberately not a function of it: a
 * scratch shell asks for the direct spawn whatever tmux is on the machine
 * (`vingilot_pty/tmux.rs`'s `Lifetime::Ephemeral`), so there is one answer and
 * no state in which this could say something else. A copy that switched on the
 * backing would be a copy that could one day claim persistence for the one
 * terminal whose whole point is not having any. */
export const SCRATCH_PERSISTENCE: PersistenceCopy = {
  detail:
    "The scratch shell is not one of this worktree's terminals. It has no tab in the strip, no tmux session behind it, and nothing about it is written down: closing it ends it, and so does quitting the app. The persistence line beside this one is about the worktree's terminal tabs, not about this.",
  label: "scratch shell: nothing is kept — closing it ends it",
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
