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

// Hardcoded dev workspace id.
const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";

export function App() {
  const { data, reachable, lastOk } = usePolling(() => listRuns(WORKSPACE_ID));
  const runs: RunSummary[] = data ?? [];

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
        <RunRail runs={runs} activeRunId={activeTabId === "deck" ? null : activeTabId} onSelectRun={openRun} />
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
          deckContent={<Deck workspaceId={WORKSPACE_ID} runs={runs} onOpenRun={openRun} />}
          renderRunContent={(id) => <div className="vg-run-stub">Run view for {id} lands in Task 6.</div>}
        />
      </main>
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
