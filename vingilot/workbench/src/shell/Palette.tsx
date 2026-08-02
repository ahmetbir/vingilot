import type { RunSummary } from "../model/run.ts";

interface PaletteProps {
  open: boolean;
  runs: RunSummary[];
  activeRunId: string | null;
  onClose: () => void;
  onSelectRun: (id: string) => void;
}

/** ⌘K palette: typed rows ranked with the active run's scope first, then
 * the rest by recency. Task 4 only has run rows to show — command rows
 * (e.g. "new run") arrive with the Deck in Task 5. */
export function Palette({ open, runs, activeRunId, onClose, onSelectRun }: PaletteProps) {
  if (!open) return null;

  const ordered = [...runs].sort((a, b) => {
    if (a.id === activeRunId) return -1;
    if (b.id === activeRunId) return 1;
    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
  });

  return (
    <div className="vg-palette-overlay" role="presentation" onClick={onClose}>
      <div
        className="vg-palette"
        role="dialog"
        aria-label="command palette"
        onClick={(e) => e.stopPropagation()}
      >
        {ordered.length === 0 ? (
          <p className="vg-palette__empty">no runs — ⌘K or the Deck composer starts one</p>
        ) : (
          <ul className="vg-palette__list">
            {ordered.map((run) => (
              <li key={run.id}>
                <button
                  type="button"
                  className="vg-palette__row"
                  onClick={() => {
                    onSelectRun(run.id);
                    onClose();
                  }}
                >
                  <span className="vg-palette__objective">{run.objective}</span>
                  <span className="vg-palette__status">{run.status}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
