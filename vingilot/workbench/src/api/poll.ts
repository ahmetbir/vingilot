// usePolling: fixed-interval polling with honest reachability. No
// exponential backoff — this is a local dev tool talking to a coordinator on
// localhost, not a public API client.

import { useEffect, useRef, useState } from "react";
import type { ApiResult } from "./coordinator.ts";

export interface PollingState<T> {
  data: T | null;
  reachable: boolean;
  lastOk: Date | null;
}

const DEFAULT_INTERVAL_MS = 2000;

export function usePolling<T>(fn: () => Promise<ApiResult<T>>, ms: number = DEFAULT_INTERVAL_MS): PollingState<T> {
  const [state, setState] = useState<PollingState<T>>({ data: null, reachable: true, lastOk: null });
  const fnRef = useRef(fn);
  fnRef.current = fn;

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
          // Keep the last-good data — the rail/deck read stale-but-labeled
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
  }, [ms]);

  return state;
}
