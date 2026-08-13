// What this machine answered, asked once.
//
// Two questions the workspace puts to the desktop shell on the way in, and puts
// exactly once because neither answer can change under it: **where the owner's
// home directory is** (every terminal's cwd derives from it, through
// `projects.ts`'s `worktreeCwd`) and **what is keeping terminals alive** (the
// backend probes tmux once per app run — `vingilot_pty/mod.rs`).
//
// They are one module rather than two because they share the shape that is easy
// to get wrong, and both got it wrong at some point in this island's history:
// **a failure is an answer.** A rejected `homeDir()` is not "still loading", and
// reading it as one left the Diff and Agent panes telling the owner to wait for
// a checkout nothing was going to name. So the pair of the two is a value and a
// *settled* flag, and `settled` goes true however the call finished. The pty
// backing has no flag of the same kind on purpose: the status bar says nothing
// about persistence when it does not know, and "nothing" is already what `null`
// draws — claiming either mode would be a guess with a consequence, since one of
// them promises shells that survive the app.
//
// Held here rather than in `RunsScreen` for no reason other than that it is a
// self-contained pair of one-shot effects with no dependency on anything that
// screen holds. That screen is at the file-size ceiling, and this is the block
// that comes out without cutting anything in half.

import * as React from "react";

import { ptyBacking, type PtyBacking } from "@/features/runs/lib/ptyClient";
import { useWorktreeRoot } from "@/features/runs/lib/useWorktreeRoot";

export interface MachineFacts {
  /** The directory task worktrees are checked out under, or `null` when this
   * app cannot name one — a non-Tauri context (a plain browser preview), or a
   * lookup that failed. */
  worktreeRoot: string | null;
  /** True once the home-directory lookup has *finished*, however it finished.
   * The distinction `worktreeRoot === null` cannot make, and the one every pane
   * reads as `cwdPending`. */
  rootSettled: boolean;
  /** What is keeping this machine's terminals alive, or `null` while there is
   * no backend to ask. */
  terminalBacking: PtyBacking | null;
}

export function useMachineFacts(): MachineFacts {
  // The home-directory half moved out when the bottom bar needed it too
  // (`lib/useWorktreeRoot.ts`), which also made it one lookup per app run
  // rather than one per mount — what this module's header always wanted.
  const { rootSettled, worktreeRoot } = useWorktreeRoot();

  const [terminalBacking, setTerminalBacking] =
    React.useState<PtyBacking | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    ptyBacking()
      .then((backing) => {
        if (!cancelled) setTerminalBacking(backing);
      })
      .catch(() => {
        // No backend to ask. Claiming either mode would be a guess.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { rootSettled, terminalBacking, worktreeRoot };
}
