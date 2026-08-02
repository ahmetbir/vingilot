import { railGroups, statusClass, wallClock } from "../model/run.ts";
import type { RunMode, RunSummary } from "../model/run.ts";

interface RunRailProps {
  runs: RunSummary[];
  activeRunId: string | null;
  onSelectRun: (id: string) => void;
}

const GROUP_LABELS = {
  needsYou: "NEEDS YOU",
  live: "LIVE",
  recent: "RECENT",
} as const;

const GROUP_KEYS = ["needsYou", "live", "recent"] as const;

/** The rail's flat order — the same concatenation cmd+1..9 indexes into.
 * Exported so App.tsx's keyboard handler and the rail agree on what "the
 * nth run" means without either recomputing the other's logic. */
export function flatRailOrder(runs: RunSummary[]): RunSummary[] {
  const groups = railGroups(runs);
  return [...groups.needsYou, ...groups.live, ...groups.recent];
}

export function RunRail({ runs, activeRunId, onSelectRun }: RunRailProps) {
  if (runs.length === 0) {
    return (
      <div className="vg-rail">
        <p className="vg-rail__empty">no runs — ⌘K or the Deck composer starts one</p>
      </div>
    );
  }

  const groups = railGroups(runs);
  const flat = flatRailOrder(runs);

  return (
    <div className="vg-rail">
      {GROUP_KEYS.map((key) => {
        const items = groups[key];
        if (items.length === 0) return null;
        return (
          <section className="vg-rail__group" key={key}>
            <h2 className="vg-rail__group-label">
              {GROUP_LABELS[key]} <span className="vg-rail__count">{items.length}</span>
            </h2>
            <ul className="vg-rail__list">
              {items.map((run) => {
                const railIndex = flat.indexOf(run);
                return (
                  <li key={run.id}>
                    <button
                      type="button"
                      className={
                        run.id === activeRunId ? "vg-rail__row vg-rail__row--active" : "vg-rail__row"
                      }
                      onClick={() => onSelectRun(run.id)}
                      title={railIndex < 9 ? `⌘${railIndex + 1}` : undefined}
                    >
                      <span
                        className={`vg-status-dot vg-status-dot--${statusClass(run.status)}`}
                        aria-hidden="true"
                      />
                      <span className="vg-rail__objective">{run.objective}</span>
                      <ModeChip mode={run.mode} />
                      <span className="vg-rail__meta">{rowMeta(run)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function rowMeta(run: RunSummary): string {
  const wc = wallClock(run, new Date());
  if (wc !== null) {
    return wc.limitSecs !== null ? `${wc.spentSecs}s / ${wc.limitSecs}s` : `${wc.spentSecs}s`;
  }
  return run.status;
}

/** Mode chip form rule: delegated (real grants) renders solid/enforced;
 * interactive (claimed, not enforced) renders dashed/stated; chat has no
 * grants at all so it gets no border — the absent-capability case. */
export function ModeChip({ mode }: { mode: RunMode }) {
  if (mode === "delegated") return <span className="chip chip--enforced">acp</span>;
  if (mode === "interactive") return <span className="chip chip--stated">int</span>;
  return <span className="vg-chip-plain">@ chat</span>;
}
