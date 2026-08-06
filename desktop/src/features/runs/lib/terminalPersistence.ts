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

import type { PtyBacking } from "@/features/runs/lib/ptyClient";

export interface PersistenceCopy {
  /** One line for the status bar. Carries the claim and its limit together. */
  label: string;
  /** The same thing said in full, for the title/tooltip. */
  detail: string;
}

const TMUX: PersistenceCopy = {
  detail:
    "Each terminal runs inside a tmux session, so it keeps running after you quit the app and is still there when you open it again. It does not survive a reboot, a tmux kill-server, or a crash — the same limits as any other tmux session on this machine.",
  label:
    "terminals: persistent (tmux) — survive quitting the app, not a reboot",
};

const APP_PROCESS: PersistenceCopy = {
  detail:
    "tmux was not found, so each terminal is a plain shell this app owns. Quitting the app ends it and nothing is kept. Install tmux to keep terminals running across restarts.",
  label: "terminals: this session only — they end when the app quits",
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
