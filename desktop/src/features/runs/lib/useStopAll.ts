// The STOP control's state and act — engaged flag, pause-everything, release.
//
// **Split out of `RunsScreen.tsx` at the 1000-line ratchet** (the
// pane-nav-absorb plan's sidebar-accordion portal is what pushed it over —
// the rule is that an edit to a file at the ceiling begins with a split, and
// this was the seam already there: three lines of state and one act that
// reads only the runs list, knowing nothing about the rest of the screen).
// Same shape, same reason, as `usePaletteCommands.ts` and `usePaneActs.ts`.

import * as React from "react";

import { transitionRun } from "@/features/runs/lib/coordinatorClient";
import type { RunSummary } from "@/features/runs/lib/runModel";

export interface StopAll {
  stopEngaged: boolean;
  /** Pause every live run, and say the switch is thrown before the first
   * transition answers — STOP must read as engaged the moment it is hit. */
  engageStop: () => Promise<void>;
  releaseStop: () => void;
}

export function useStopAll(runs: RunSummary[]): StopAll {
  const [stopEngaged, setStopEngaged] = React.useState(false);

  const held = React.useRef(runs);
  held.current = runs;

  const engageStop = React.useCallback(async () => {
    setStopEngaged(true);
    const live = held.current.filter(
      (run) => run.status === "running" || run.status === "verifying",
    );
    await Promise.all(
      live.map((run) => transitionRun(run.id, "paused", "stop engaged")),
    );
  }, []);

  const releaseStop = React.useCallback(() => {
    setStopEngaged(false);
  }, []);

  return { engageStop, releaseStop, stopEngaged };
}
