// The divider between the two TABS sharing the stage (`lib/tabSplit.ts`) —
// the third divider this app draws, and named for what it does so it can never
// be read as one of the other two.
//
// On screen at once, legally: this one between two tabs, `TerminalSplitDivider`
// between two shells inside one of those tabs, and the diff viewer's own column
// rule inside a patch drawn in Split mode. Three dividers, three meanings.
// This is the outermost of them, so it is the one that moves whole tabs.
//
// Deliberately not `TerminalSplitDivider`: that one belongs to a tab's own two
// ptys and takes a `SplitDirection` this axis does not have — a tab split is
// side by side, full stop, because the strip above it is a row and a stage cut
// horizontally would put a tab's label a long way from its box. (It was also
// deliberately not `PaneDivider`, which was welded to the stage-versus-dock
// model and its ⌥⌘B vocabulary; that file was deleted in P7, unimported.)
//
// The ratio is measured against this divider's own parent — the pane body that
// also lays the two halves out — so the number handed up is the number the
// layout consumes, with no second measurement to disagree with it. Keyboard:
// arrows nudge by 2%, matching the axis; the model clamps to 20% either side,
// so a caller that skipped this component could not produce a zero-pixel half
// either.

import * as React from "react";

const NUDGE = 0.02;

interface TabSplitDividerProps {
  /** The LEFT half's current share, for the ARIA reading. */
  ratio: number;
  onRatio: (ratio: number) => void;
}

export function TabSplitDivider({ onRatio, ratio }: TabSplitDividerProps) {
  const ref = React.useRef<HTMLDivElement | null>(null);

  const ratioAt = React.useCallback((event: { clientX: number }) => {
    const host = ref.current?.parentElement;
    const divider = ref.current;
    if (host == null || divider == null) return null;
    const box = host.getBoundingClientRect();
    const own = divider.getBoundingClientRect();
    // The host's box includes this divider itself; the halves share what is
    // left. Measuring the pointer from the divider's midline is what lets a
    // grab anywhere on the handle drag without a jump.
    const usable = box.width - own.width;
    if (usable <= 0) return null;
    return (event.clientX - box.left - own.width / 2) / usable;
  }, []);

  return (
    // biome-ignore lint/a11y/useSemanticElements: a separator that moves is a slider-like widget, not a <hr>
    <div
      aria-label="tab split divider"
      aria-orientation="vertical"
      aria-valuemax={80}
      aria-valuemin={20}
      aria-valuenow={Math.round(ratio * 100)}
      className="group relative z-10 w-1 shrink-0 cursor-col-resize bg-border/60 transition-colors hover:bg-[var(--vingilot-accent)]/60 focus-visible:bg-[var(--vingilot-accent)]/60 focus-visible:outline-none"
      data-testid="tab-split-divider"
      onKeyDown={(event) => {
        if (event.key === "ArrowRight") {
          event.preventDefault();
          onRatio(ratio + NUDGE);
        } else if (event.key === "ArrowLeft") {
          event.preventDefault();
          onRatio(ratio - NUDGE);
        }
      }}
      onPointerDown={(event) => {
        // Primary button only: a right-click is a context menu, not a drag.
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        const next = ratioAt(event);
        if (next !== null) onRatio(next);
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      }}
      ref={ref}
      role="separator"
      style={{ order: 1 }}
      tabIndex={0}
      title="Drag to resize the tab split (min 20% each side)"
    >
      {/* A wider invisible hit area than the 4px line, so the drag does not
       * demand pixel aim — the same trick every divider in this app plays. */}
      <div aria-hidden="true" className="absolute -inset-x-1 inset-y-0" />
    </div>
  );
}
