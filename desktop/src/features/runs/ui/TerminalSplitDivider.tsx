// The divider between a split terminal's two shells (`lib/terminalSplit.ts`)
// — the "suruklemeli" half of the owner's ask.
//
// Deliberately not `PaneDivider`: that component was welded to the work
// surface's left/right pane model (its solo gestures, its `clampRatioAt`
// floors, its ⌥⌘B vocabulary), none of which means anything inside one tab.
// (P7 deleted it — nothing had imported it since the dock landed.)
// This one knows exactly three things: which way it lies, where the pointer
// is inside its parent, and that neither side may go below 20%
// (`MIN_SPLIT_RATIO` — the model clamps too, so a caller that skips this
// component cannot produce a zero-pixel shell either).
//
// The ratio is measured against the divider's own parent — the split host box
// that also lays the two shells out — so the number handed up is the number
// the layout consumes, with no second measurement to disagree with it.
// Keyboard: arrows nudge by 2%, matching the divider's own axis; Enter/Space
// do nothing on purpose (there is no solo to toggle here).

import * as React from "react";

import type { SplitDirection } from "@/features/runs/lib/terminalSplit";

const NUDGE = 0.02;

interface TerminalSplitDividerProps {
  direction: SplitDirection;
  /** The primary's current share, for the ARIA reading. */
  ratio: number;
  onRatio: (ratio: number) => void;
}

export function TerminalSplitDivider({
  direction,
  onRatio,
  ratio,
}: TerminalSplitDividerProps) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const vertical = direction === "right"; // divider line runs vertically

  const ratioAt = React.useCallback(
    (event: { clientX: number; clientY: number }) => {
      const host = ref.current?.parentElement;
      const divider = ref.current;
      if (host == null || divider == null) return null;
      const box = host.getBoundingClientRect();
      const own = divider.getBoundingClientRect();
      // The host's box includes this divider itself; the halves share what
      // is left. Dividing by the full width put the computed ratio off by
      // the divider's share (P2 verify, minor 4) — subtract it, and measure
      // the pointer from the divider's midline so a grab anywhere on the
      // handle drags without a jump.
      if (vertical) {
        const usable = box.width - own.width;
        if (usable <= 0) return null;
        return (event.clientX - box.left - own.width / 2) / usable;
      }
      const usable = box.height - own.height;
      if (usable <= 0) return null;
      return (event.clientY - box.top - own.height / 2) / usable;
    },
    [vertical],
  );

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    // Primary button only: a right-click is a context menu, not a drag.
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const next = ratioAt(event);
    if (next !== null) onRatio(next);
  };
  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const grow = vertical ? "ArrowRight" : "ArrowDown";
    const shrink = vertical ? "ArrowLeft" : "ArrowUp";
    if (event.key === grow) {
      event.preventDefault();
      onRatio(ratio + NUDGE);
    } else if (event.key === shrink) {
      event.preventDefault();
      onRatio(ratio - NUDGE);
    }
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: a separator that moves is a slider-like widget, not a <hr>
    <div
      aria-label="terminal split divider"
      aria-orientation={vertical ? "vertical" : "horizontal"}
      aria-valuemax={80}
      aria-valuemin={20}
      aria-valuenow={Math.round(ratio * 100)}
      className={`group relative z-10 shrink-0 ${
        vertical ? "w-1 cursor-col-resize" : "h-1 cursor-row-resize"
      } bg-border/60 transition-colors hover:bg-[var(--vingilot-accent)]/60 focus-visible:bg-[var(--vingilot-accent)]/60 focus-visible:outline-none`}
      data-testid="terminal-split-divider"
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      ref={ref}
      role="separator"
      tabIndex={0}
      title="Drag to resize the split (min 20% each side)"
    >
      {/* A wider invisible hit area than the 4px line, so the drag does not
       * demand pixel aim — the same trick every divider in this app plays. */}
      <div
        aria-hidden="true"
        className={`absolute ${vertical ? "-inset-x-1 inset-y-0" : "inset-x-0 -inset-y-1"}`}
      />
    </div>
  );
}
