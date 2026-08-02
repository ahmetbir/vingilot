import { useCallback, useEffect, useState } from "react";
import { applyMutations, getWorkspace, listRuns, transitionRun } from "./api/coordinator.ts";
import { usePolling } from "./api/poll.ts";
import { Deck } from "./deck/Deck.tsx";
import type { RunSummary } from "./model/run.ts";
import { resolveKey } from "./shell/keys.ts";
import { Palette } from "./shell/Palette.tsx";
import { flatRailOrder, RunRail } from "./shell/RunRail.tsx";
import { StatusBar } from "./shell/StatusBar.tsx";
import { StopButton } from "./shell/StopButton.tsx";
import { TabArea } from "./shell/TabArea.tsx";
import { Unreachable } from "./system/Unreachable.tsx";

// Hardcoded dev workspace id.
const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
const POLL_INTERVAL_MS = 2000;

export function App() {
  const { data, reachable, lastOk, retryNow } = usePolling(() => listRuns(WORKSPACE_ID), POLL_INTERVAL_MS);
  const runs: RunSummary[] = data ?? [];

  // The moment reachability first flipped false — null while reachable.
  // Unreachable.tsx (and the countdown inside it) is a pure function of
  // (reachable, unreachableSince, now); this is the one bit of state that
  // isn't derivable from usePolling's own return.
  const [unreachableSince, setUnreachableSince] = useState<Date | null>(null);
  useEffect(() => {
    if (!reachable) {
      setUnreachableSince((prev) => prev ?? new Date());
    } else {
      setUnreachableSince(null);
    }
  }, [reachable]);

  // A ticking clock so the "next retry in Ns" countdown counts down live,
  // not just on the next poll's data change. Cheap: one re-render/second,
  // and only meaningfully visible while the unreachable lane is up.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const handle = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(handle);
  }, []);

  const [activeTabId, setActiveTabId] = useState<string>("deck");
  const [openRunIds, setOpenRunIds] = useState<string[]>([]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [stopEngaged, setStopEngaged] = useState(false);

  const openRun = useCallback((id: string) => {
    setOpenRunIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setActiveTabId(id);
  }, []);

  // Workspace bootstrap: the dev workspace id is hardcoded above, but the
  // row may not exist yet on a fresh coordinator DB. GET first; if that
  // 404s, POST an (empty) mutation — the mutations endpoint has ensure
  // semantics server-side, so this creates the workspace row as a side
  // effect of its first write.
  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      const snapshot = await getWorkspace(WORKSPACE_ID);
      if (cancelled || snapshot.ok) return;
      if (snapshot.kind === "api" && snapshot.status === 404) {
        await applyMutations(WORKSPACE_ID, 0, []);
      }
    }
    bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  const closeRunTab = useCallback((id: string) => {
    setOpenRunIds((prev) => prev.filter((x) => x !== id));
    setActiveTabId((prev) => (prev === id ? "deck" : prev));
  }, []);

  useEffect(() => {
    function handleKeyDown(evt: KeyboardEvent) {
      const action = resolveKey(evt, { paletteOpen });
      if (action === null) return;
      evt.preventDefault();
      switch (action.type) {
        case "open-palette":
          setPaletteOpen(true);
          break;
        case "close-palette":
        case "close":
          setPaletteOpen(false);
          break;
        case "select-run": {
          const target = flatRailOrder(runs)[action.n - 1];
          if (target) openRun(target.id);
          break;
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // runs is read fresh on every keydown via closure; re-subscribing per
    // update keeps cmd+1..9 pointed at the current rail order.
  }, [paletteOpen, runs, openRun]);

  const activeRun = runs.find((r) => r.id === activeTabId) ?? null;

  async function engageStop() {
    setStopEngaged(true);
    const live = runs.filter((r) => r.status === "running" || r.status === "verifying");
    await Promise.all(live.map((r) => transitionRun(r.id, "paused", "stop engaged")));
  }

  function releaseStop() {
    setStopEngaged(false);
  }

  return (
    <div className="vg-shell">
      <aside className="vg-shell__rail" aria-label="runs">
        <RunRail
          runs={runs}
          activeRunId={activeTabId === "deck" ? null : activeTabId}
          onSelectRun={openRun}
          staleAsOf={reachable ? null : lastOk}
        />
      </aside>
      <main className="vg-shell__tabs" aria-label="workspace">
        <div className="vg-shell__topbar">
          {stopEngaged && <div className="vg-stop-bar" aria-hidden="true" />}
          <StopButton engaged={stopEngaged} onEngage={engageStop} onRelease={releaseStop} />
        </div>
        <TabArea
          runs={runs}
          openRunIds={openRunIds}
          activeTabId={activeTabId}
          onSelectTab={setActiveTabId}
          onCloseTab={closeRunTab}
          deckContent={<Deck workspaceId={WORKSPACE_ID} runs={runs} onOpenRun={openRun} reachable={reachable} />}
        />
      </main>
      <Unreachable
        reachable={reachable}
        since={unreachableSince}
        now={now}
        intervalMs={POLL_INTERVAL_MS}
        onRetryNow={retryNow}
      />
      <footer className="vg-shell__status" aria-label="status">
        <StatusBar workspaceId={WORKSPACE_ID} activeRun={activeRun} reachable={reachable} lastOk={lastOk} />
      </footer>
      <Palette
        open={paletteOpen}
        runs={runs}
        activeRunId={activeTabId === "deck" ? null : activeTabId}
        onClose={() => setPaletteOpen(false)}
        onSelectRun={openRun}
      />
    </div>
  );
}
