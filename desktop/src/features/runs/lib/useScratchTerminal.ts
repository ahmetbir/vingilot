// The scratch terminal's lifecycle inside the workspace screen
// (vingilot/docs/plans/2026-08-08-scratch-and-team-thread.md, Task 1).
//
// What a scratch shell *means* is `scratchTerminal.ts`: a pure model of one
// nullable session and the three transitions it has. What is here is the part
// that cannot be pure — the ordinal that only ever rises, the three doors the
// owner has into the shell, and the two departures that end it. One subject,
// and it was the last long stretch of `RunsScreen` that was about a single
// thing, so it lives here rather than interleaved with that screen's polling,
// its tab layout and its dialogs.
//
// **Held above `WorkSurface`, deliberately.** That component unmounts the
// moment the owner goes back to the landing view, so a scratch held there
// would be forgotten on the way out and its shell left running with nothing
// tracking it. This hook's host is the component that stays mounted for as
// long as the screen is on, which is what makes the unmount cleanup below the
// real "the screen went away" signal rather than a guess at one.
//
// **Every `pty_close` a scratch ever earns is issued here.** The model names
// what each transition ended and this hook closes exactly that; a caller that
// took the new value without closing what left it is the leak `ScratchChange`
// exists to prevent.

import * as React from "react";

import { ptyClose } from "@/features/runs/lib/ptyClient";
import {
  closeScratch,
  openScratch,
  type Scratch,
  scratchBlocked,
  scratchOnWorktree,
} from "@/features/runs/lib/scratchTerminal";

export interface ScratchTerminal {
  /** The shell that is open, or `null`. One nullable value, never a flag
   * beside a session. */
  session: Scratch;
  /** Opens on the worktree the owner is standing in, and does nothing when
   * `scratchBlocked` says it cannot be opened there. */
  open: () => void;
  close: () => void;
  /** ⌥⌘T both ways: a key that opens a surface and then does nothing is a key
   * the owner presses twice looking for the way out. */
  toggle: () => void;
}

export interface ScratchTerminalOptions {
  /** The worktree the owner is standing in — `null` on the landing view, and
   * in a project with nothing picked yet. Leaving one ends its shell. */
  worktreeId: string | null;
  /** Where that worktree is on disk. `null` is refused rather than opened
   * somewhere arbitrary. */
  cwd: string | null;
  /** The home-directory lookup has not answered yet. A different refusal from
   * "this worktree has no checkout", and `scratchBlocked` is where the two are
   * told apart. */
  cwdPending: boolean;
}

export function useScratchTerminal({
  cwd,
  cwdPending,
  worktreeId,
}: ScratchTerminalOptions): ScratchTerminal {
  // The scratch shell, which is deliberately **not** part of the terminal tab
  // layout: entering it would put this session in the saved layout and in the
  // worktree's strip at once, and give ⇧⌘W a claim on it
  // (`lib/scratchTerminal.ts`).
  const [scratch, setScratch] = React.useState<Scratch>(null);
  // The ordinal the next scratch takes. Only ever rises, so a closed shell's
  // id is never handed to a later one — the same argument `nextN` makes for a
  // strip, and the same race it defends against.
  const nextScratch = React.useRef(1);

  const applyScratch = React.useCallback(
    (change: { closed: readonly string[]; scratch: Scratch }) => {
      setScratch(change.scratch);
      for (const sessionId of change.closed) void ptyClose(sessionId);
    },
    [],
  );

  // The screen going away is the third door, and nothing was watching it.
  //
  // The host unmounts on any route change, on a reload, and on the community
  // remount — none of which is an app run, and none of which closed the shell.
  // It kept running behind nothing, and `nextScratch` is a ref, so the remount
  // started the ordinals at 1 again: `pty_open` found that id still registered,
  // took its replay branch, and returned **before** the spawn and before the
  // cwd was applied. The next ⌥⌘T then drew the previous worktree's live shell,
  // with its scrollback and its real cwd, under a header printing the new
  // worktree's path.
  //
  // Read through a ref because a cleanup closes over the render it was created
  // in, and the session that has to be ended is whichever one is open at the
  // moment the screen goes — not whichever one existed when this effect ran.
  const scratchNow = React.useRef<Scratch>(null);
  scratchNow.current = scratch;
  React.useEffect(
    () => () => {
      const open = scratchNow.current;
      if (open !== null) void ptyClose(open.sessionId);
    },
    [],
  );

  // The owner went somewhere else. A shell kept alive behind a surface that no
  // longer draws it is exactly the residue this terminal exists not to leave —
  // and its header names a checkout that is no longer the one on screen.
  React.useEffect(() => {
    const change = scratchOnWorktree(scratch, worktreeId);
    // Reference equality is the model's own "nothing happened" (staying put
    // returns the same value), so this re-runs freely and acts only on a move.
    if (change.scratch === scratch) return;
    applyScratch(change);
  }, [applyScratch, scratch, worktreeId]);

  // Both doors to the scratch shell, over one rule. `scratchBlocked` is the
  // same function the palette row's sentence comes from, so a chord cannot
  // open a shell the palette says it will not, and neither of them can open
  // one somewhere arbitrary.
  const open = React.useCallback(() => {
    if (
      worktreeId === null ||
      cwd === null ||
      scratchBlocked(worktreeId, cwd, cwdPending) !== null
    ) {
      return;
    }
    const change = openScratch(scratch, {
      bindingId: worktreeId,
      cwd,
      nonce: nextScratch.current,
    });
    // Consumed only when it produced a new shell — reopening onto the one
    // already running must not burn an ordinal, or the numbers would count
    // key presses rather than shells.
    if (change.scratch !== scratch) nextScratch.current += 1;
    applyScratch(change);
  }, [applyScratch, cwd, cwdPending, scratch, worktreeId]);

  const close = React.useCallback(() => {
    applyScratch(closeScratch(scratch));
  }, [applyScratch, scratch]);

  const toggle = React.useCallback(() => {
    if (scratch !== null) close();
    else open();
  }, [close, open, scratch]);

  return { close, open, session: scratch, toggle };
}
