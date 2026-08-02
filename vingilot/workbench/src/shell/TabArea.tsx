import type { ReactNode } from "react";
import type { RunSummary } from "../model/run.ts";

interface TabAreaProps {
  runs: RunSummary[];
  openRunIds: string[];
  activeTabId: string; // "deck" | a run id
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  deckContent: ReactNode;
  renderRunContent: (runId: string) => ReactNode;
}

/** Workspace-level tabs. Deck is fixed first and never closes; every Run
 * that has been opened (via the rail, the palette, or the Deck's own lanes)
 * gets a closable tab next to it. */
export function TabArea({
  runs,
  openRunIds,
  activeTabId,
  onSelectTab,
  onCloseTab,
  deckContent,
  renderRunContent,
}: TabAreaProps) {
  const runById = new Map(runs.map((r) => [r.id, r]));

  return (
    <div className="vg-tabarea">
      <div className="vg-tabarea__bar" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeTabId === "deck"}
          className={activeTabId === "deck" ? "vg-tab vg-tab--active" : "vg-tab"}
          onClick={() => onSelectTab("deck")}
        >
          Deck
        </button>
        {openRunIds.map((id) => {
          const run = runById.get(id);
          const label = run ? run.objective : id;
          return (
            <button
              type="button"
              role="tab"
              key={id}
              aria-selected={activeTabId === id}
              className={activeTabId === id ? "vg-tab vg-tab--active" : "vg-tab"}
              onClick={() => onSelectTab(id)}
            >
              <span className="vg-tab__label">{label}</span>
              <span
                role="button"
                aria-label={`close ${label}`}
                className="vg-tab__close"
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTab(id);
                }}
              >
                ×
              </span>
            </button>
          );
        })}
      </div>
      <div className="vg-tabarea__content">
        {activeTabId === "deck" ? deckContent : renderRunContent(activeTabId)}
      </div>
    </div>
  );
}
