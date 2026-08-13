// Where task worktrees are checked out — asked once for the whole app run.
//
// This was the first half of `useMachineFacts`, and it came out when a second
// surface needed it (vingilot/docs/plans/2026-08-12-hooks-and-the-dots.md,
// Task 3): `ProjectStatusBar` has to name the *directory* of the worktree it is
// standing in, because that is how a coordinator-provisioned worktree — whose
// binding id no path can produce — is matched to the agent working in it
// (`lib/liveAgents.ts`). `useMachineFacts` also probes the pty backing, which
// the bar already receives as a prop and must not ask for a second time.
//
// **The lookup is memoised at module scope, not per mount — and only a
// success is memoised.** The memo and its retry-on-failure rule live in
// `worktreeRootLookup.ts` (pure, testable under bare node); this hook is the
// React skin that hands it `homeDir` and turns the answer into state.
//
// **A failure is an answer.** A rejected `homeDir()` is not "still loading" —
// reading it as one is what left panes waiting forever for a checkout nothing
// was going to name — so `settled` goes true however the call finished. But a
// failure is not a *fact*: it is not cached, and the next mount asks again
// (the lookup module's header carries the defect that taught this).

import { homeDir } from "@tauri-apps/api/path";
import * as React from "react";

import { worktreeRootOnce } from "./worktreeRootLookup.ts";

export interface WorktreeRoot {
  /** The directory task worktrees are checked out under, or `null` when this
   * app cannot name one — a non-Tauri context (a plain browser preview), or a
   * lookup that failed. */
  worktreeRoot: string | null;
  /** True once the lookup has *finished*, however it finished. The distinction
   * `worktreeRoot === null` cannot make, and the one every pane reads as
   * `cwdPending`. */
  rootSettled: boolean;
}

export function useWorktreeRoot(): WorktreeRoot {
  const [state, setState] = React.useState<WorktreeRoot>({
    rootSettled: false,
    worktreeRoot: null,
  });
  React.useEffect(() => {
    let cancelled = false;
    void worktreeRootOnce(homeDir).then((worktreeRoot) => {
      if (!cancelled) setState({ rootSettled: true, worktreeRoot });
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}
