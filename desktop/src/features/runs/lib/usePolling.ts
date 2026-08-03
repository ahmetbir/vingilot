// usePolling: fixed-interval polling with honest reachability. No
// exponential backoff — this is a local dev tool talking to a coordinator on
// localhost, not a public API client.
//
// Ported verbatim from vingilot/workbench/src/api/poll.ts (ADR-001's
// 2026-08-03 reversal) — the sibling app is donor code once this lands.

import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiResult } from "./coordinatorClient.ts";

export interface PollingState<T> {
  data: T | null;
  reachable: boolean;
  lastOk: Date | null;
  /** Forces an immediate tick and restarts the interval from now — the
   * unreachable banner's "Retry now" button uses this instead of waiting
   * out the fixed cadence. */
  retryNow: () => void;
}

const DEFAULT_INTERVAL_MS = 2000;

export function usePolling<T>(
  fn: () => Promise<ApiResult<T>>,
  ms: number = DEFAULT_INTERVAL_MS,
): PollingState<T> {
  const [state, setState] = useState<{
    data: T | null;
    reachable: boolean;
    lastOk: Date | null;
  }>({
    data: null,
    reachable: true,
    lastOk: null,
  });
  const [epoch, setEpoch] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  // biome-ignore lint/correctness/useExhaustiveDependencies: epoch is an intentional re-run trigger only; its value is not consumed in the effect body
  useEffect(() => {
    let cancelled = false;

    async function tick() {
      const result = await fnRef.current();
      if (cancelled) return;
      setState((prev) => {
        if (result.ok) {
          return { data: result.value, reachable: true, lastOk: new Date() };
        }
        if (result.kind === "unreachable") {
          // Keep the last-good data — the list/deck read stale-but-labeled
          // state, not a blank screen, while the control plane is down.
          return { ...prev, reachable: false };
        }
        // A reachable-but-erroring server (4xx/5xx) is still reachable.
        return { ...prev, reachable: true };
      });
    }

    tick();
    const handle = setInterval(tick, ms);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
    // `epoch` is bumped by retryNow() purely to re-run this effect (an
    // immediate tick + a freshly-scheduled interval), not read otherwise.
  }, [ms, epoch]);

  const retryNow = useCallback(() => setEpoch((e) => e + 1), []);

  return { ...state, retryNow };
}
