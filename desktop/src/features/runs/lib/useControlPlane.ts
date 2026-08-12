// Whether this machine has a control plane, how hard the workspace keeps asking,
// and making sure the workspace row exists at all.
//
// **Upstream code moved out of `RunsScreen.tsx`, not new behaviour.** That screen
// had reached 995 lines against this repository's 1000-line ceiling
// (`desktop/scripts/check-file-sizes.mjs`), and the rule here is to split the
// file rather than raise the number. This is the block that came out, chosen
// because it is the most cohesive unit in there and nothing outside it depends on
// its internals: three states, three effects and one derivation, all about one
// question the screen asks once and then keeps asking. The screen's own header
// already described it as a separate subject.
//
// **The cadence is not a constant, and that is the whole reason this exists.** On
// a machine where nothing has ever answered, hammering 127.0.0.1 every 2s forever
// is noise against a port that is not going to be listening. `reachability.ts`
// decides when that settles and the banner says so in words; what is here is the
// part that has to hold state: when reachability first went, what time it is now,
// and the poll interval the whole screen's polls share.
//
// **`pollMs` is owned by the caller and adjusted from here, which is a knot rather
// than a preference.** The three polls take `pollMs` as an argument, and the value
// can only be chosen from what those same polls reported — so the state has to be
// declared before them and decided after them. It is adjusted during render (the
// same "adjust state when an input changes" `useDocument.ts` does) rather than in
// an effect, so no poll ever runs at a cadence the previous tick already
// disproved.
//
// Nothing here is fork-specific except which coordinator it talks to; the rules
// it applies all live in `reachability.ts`, where they are tested without a
// renderer.

import * as React from "react";

import {
  applyMutations,
  getWorkspace,
} from "@/features/runs/lib/coordinatorClient";
import {
  type ControlPlaneKind,
  controlPlaneKind,
  controlPlanePollMs,
} from "@/features/runs/lib/reachability";

/** The cadence every coordinator poll in the app starts at — the workspace's
 * three, and the pin polls inside `DeckPane` and `RunList`, which take it as a
 * prop rather than keeping timers of their own.
 *
 * A cadence only some of the polls obeyed would not be a policy: the settle to
 * 30s exists to stop hammering a port nothing is listening on, and one 2s timer
 * left behind keeps most of the hammer. */
export const POLL_INTERVAL_MS = 2000;

export interface ControlPlaneOptions {
  /** Whether the last poll answered. */
  reachable: boolean;
  /** The last time one did, or `null` — the whole of the evidence that a control
   * plane exists on this machine at all. Nothing configures one, so an answer is
   * the only thing that can tell a coordinator that went down apart from a
   * machine that never had one. */
  lastOk: Date | null;
  /** The interval the caller's polls are currently running at. */
  pollMs: number;
  /** Where the decided interval goes. Called during render, and only when the
   * number really moved. */
  setPollMs: (ms: number) => void;
  workspaceId: string;
}

export interface ControlPlane {
  /** Which of the two sentences the workspace is entitled to say. */
  kind: ControlPlaneKind;
  /** The moment reachability first flipped false — `null` while reachable. */
  unreachableSince: Date | null;
  /** A clock that ticks once a second, for the banner's "since" and for the
   * settle arithmetic. */
  now: Date;
}

export function useControlPlane({
  lastOk,
  pollMs,
  reachable,
  setPollMs,
  workspaceId,
}: ControlPlaneOptions): ControlPlane {
  const [unreachableSince, setUnreachableSince] = React.useState<Date | null>(
    null,
  );
  React.useEffect(() => {
    if (!reachable) {
      setUnreachableSince((prev) => prev ?? new Date());
    } else {
      setUnreachableSince(null);
    }
  }, [reachable]);

  const [now, setNow] = React.useState(() => new Date());
  React.useEffect(() => {
    const handle = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(handle);
  }, []);

  // Workspace bootstrap: the dev workspace id is hardcoded by the caller, but the
  // row may not exist yet on a fresh coordinator DB. GET first; if that 404s,
  // POST an (empty) mutation — the mutations endpoint has ensure semantics
  // server-side, so this creates the workspace row as a side effect of its first
  // write.
  React.useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      const snapshot = await getWorkspace(workspaceId);
      if (cancelled || snapshot.ok) return;
      if (snapshot.kind === "api" && snapshot.status === 404) {
        await applyMutations(workspaceId, 0, []);
      }
    }
    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  const kind = controlPlaneKind(reachable, lastOk !== null);
  const nextPollMs = controlPlanePollMs(
    kind,
    unreachableSince,
    now,
    POLL_INTERVAL_MS,
  );
  if (nextPollMs !== pollMs) setPollMs(nextPollMs);

  return { kind, now, unreachableSince };
}
