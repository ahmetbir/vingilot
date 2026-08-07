// The divider between the two panes: drag it, double-click it to put it back,
// or focus it and move it with the arrows.
//
// **The keyboard is not a courtesy here.** The surface this divider sizes is a
// terminal, and someone working in a terminal has both hands on the keyboard
// by definition — a divider reachable only by mouse is a divider that is not
// reachable at all for the person most likely to want it. So it is a real tab
// stop with the WAI-ARIA window-splitter bindings (`lib/paneKeys.ts` decides
// what each key means; this file only delivers them).
//
// **The drag is live, and clamped rather than throttled.** A pty's width is
// its shell's width, so every step of a drag reaches the shell — that is what
// makes the drag feel like resizing a terminal rather than previewing one.
//
// What makes that safe is a floor in *pixels*, not in ratio: `clampRatioAt`
// keeps the terminal at 80 columns wherever the surface can hold them
// (`paneModel.ts` says why a ratio cannot). Two other things keep the cost of
// a live drag down to what it is worth: `terminalFit.ts` refuses any geometry
// at or under the fit addon's own floor, and it declines a resize whose column
// count has not changed since the last one — pixels move on every pointermove,
// cells do not.

import * as React from "react";

import {
  DIVIDER_PX,
  MAX_RATIO,
  MIN_RATIO,
  ratioFromPointer,
} from "@/features/runs/lib/paneModel";
import { resolveDividerKey } from "@/features/runs/lib/paneKeys";
import { hasPrimaryShortcutModifier } from "@/shared/lib/platform";

interface PaneDividerProps {
  /** The left pane's current share, for the value this separator reports. */
  ratio: number;
  /** The row both panes are in — a drag is only meaningful against its box,
   * and neither is a key press: every one of the three setters below is told
   * the width the gesture happened on, because a ratio stored against a
   * surface that never allowed it is a divider that moves on its own later. */
  surfaceRef: React.RefObject<HTMLDivElement | null>;
  onRatio: (ratio: number, surfaceWidth: number) => void;
  onNudge: (delta: number, surfaceWidth: number) => void;
  onReset: (surfaceWidth: number) => void;
  onToggle: () => void;
  /** The splitter's own element, so the work surface can put focus back on it
   * when the right pane is restored from the rail — the control that was
   * focused a moment ago is gone by then. */
  focusRef?: React.RefObject<HTMLDivElement | null>;
}

function percent(ratio: number): number {
  return Math.round(ratio * 100);
}

export function PaneDivider({
  focusRef,
  onNudge,
  onRatio,
  onReset,
  onToggle,
  ratio,
  surfaceRef,
}: PaneDividerProps) {
  const [dragging, setDragging] = React.useState(false);

  /** The row's width right now. Read from the ref inside an event handler,
   * never during a render — and 0 when there is nothing to read, which every
   * clamp downstream takes as "no floors to apply" rather than as a floor of
   * zero. */
  function surfaceWidthNow(): number {
    return surfaceRef.current?.getBoundingClientRect().width ?? 0;
  }

  function moveTo(clientX: number) {
    const surface = surfaceRef.current;
    if (surface === null) return;
    const box = surface.getBoundingClientRect();
    const next = ratioFromPointer(box.left, box.width, clientX);
    // `null` is a surface with no width to divide — mid-layout, or inside a
    // hidden subtree. Keeping the ratio it had is the only safe reading.
    if (next !== null) onRatio(next, box.width);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const action = resolveDividerKey({
      altKey: event.altKey,
      key: event.key,
      primaryModifier: hasPrimaryShortcutModifier(event.nativeEvent),
      repeat: event.repeat,
      shiftKey: event.shiftKey,
    });
    if (action === null) return;
    event.preventDefault();
    // Every key path is told the same width the drag path measures. The
    // keyboard used to be the one route that stored a ratio no surface had
    // agreed to.
    const width = surfaceWidthNow();
    if (action.type === "nudge") onNudge(action.delta, width);
    else if (action.type === "set-ratio") onRatio(action.ratio, width);
    else if (action.type === "reset-ratio") onReset(width);
    else onToggle();
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: the suggested <hr> is a static separator; a window splitter is a focusable widget with a value, which <hr> cannot carry
    <div
      aria-label="resize the panes"
      aria-orientation="vertical"
      aria-valuemax={percent(MAX_RATIO)}
      aria-valuemin={percent(MIN_RATIO)}
      aria-valuenow={percent(ratio)}
      className={`group flex shrink-0 cursor-col-resize items-stretch justify-center outline-none ${
        dragging ? "bg-primary/20" : "hover:bg-muted/60"
      } focus-visible:bg-primary/30`}
      data-testid="pane-divider"
      onDoubleClick={() => onReset(surfaceWidthNow())}
      onKeyDown={handleKeyDown}
      onLostPointerCapture={() => setDragging(false)}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        // Focus first, then suppress the default — the default is what starts a
        // text selection across the terminal, and it is also what would have
        // moved focus here.
        event.currentTarget.focus();
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);
      }}
      onPointerMove={(event) => {
        if (dragging) moveTo(event.clientX);
      }}
      onPointerUp={(event) => {
        if (!dragging) return;
        event.currentTarget.releasePointerCapture(event.pointerId);
        setDragging(false);
      }}
      ref={focusRef}
      role="separator"
      // Sized from the model's own constant rather than from a width class:
      // `clampRatioAt` subtracts this width before applying the terminal's
      // floor, and two numbers for one divider is how the floor came to land a
      // column short of the count it is named for. A rem-based class would also
      // change width under ⌘+ zoom while the constant did not.
      style={{ width: DIVIDER_PX }}
      tabIndex={0}
      title="Drag to resize, double-click to reset, ← → to adjust, Enter to hide the right pane"
    >
      <span
        aria-hidden="true"
        className="w-px bg-border/60 transition-colors group-hover:bg-border"
      />
    </div>
  );
}
