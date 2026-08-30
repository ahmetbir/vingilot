// The dock's resize rail (redesign P3, mockup `.rz2` / `#rz2`): a drag on
// the boundary between the terminal and the dock, in the axis the position
// dictates — column-resize beside a right card, row-resize over a drawer
// (vingilot.js:81-83).
//
// **Pixels, not a ratio.** The dock is a fixed-size card (`--dockw` /
// `--dockh`), so unlike `PaneDivider` this rail reports the pointer's
// distance from the dock's far edge and lets the caller clamp it
// (`dockModel.ts`) — the same shape the mockup's own handler has. Keyboard:
// the WAI-ARIA separator pattern `PaneDivider` established — arrows nudge,
// with ⇧ coarse — so a resize is reachable without a pointer.

import * as React from "react";

import {
  DOCK_RESIZE_STEP,
  DOCK_RESIZE_STEP_COARSE,
  DOCK_RESIZER_PX,
} from "@/features/runs/lib/dockModel";

export function DockResizer({
  axis,
  focusRef,
  onSize,
  size,
}: {
  /** `x` resizes a right card's width; `y` a drawer's height. */
  axis: "x" | "y";
  /** Where focus lands when the split comes back — the work surface's
   * keyboard-owner rule, inherited from `PaneDivider`. */
  focusRef?: React.RefObject<HTMLDivElement | null>;
  /** The wanted size in px, raw — the caller clamps and stores. */
  onSize: (px: number) => void;
  /** The dock's current size, the keyboard's base. */
  size: number;
}) {
  const [dragging, setDragging] = React.useState(false);
  const railRef = React.useRef<HTMLDivElement | null>(null);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    railRef.current?.setPointerCapture(event.pointerId);
    setDragging(true);
  };
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    // The dock is the host's last member, so the host's far edge is the
    // dock's — measured live rather than cached at mousedown (the mockup
    // caches because its dock edge cannot move; a drawer's bottom is the
    // surface's, which a window resize moves).
    const host = railRef.current?.parentElement?.getBoundingClientRect();
    if (host === undefined || host === null) return;
    onSize(
      axis === "x"
        ? host.right - event.clientX - DOCK_RESIZER_PX / 2
        : host.bottom - event.clientY - DOCK_RESIZER_PX / 2,
    );
  };
  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    railRef.current?.releasePointerCapture(event.pointerId);
    setDragging(false);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step =
      event.shiftKey === true ? DOCK_RESIZE_STEP_COARSE : DOCK_RESIZE_STEP;
    const grow =
      axis === "x" ? event.key === "ArrowLeft" : event.key === "ArrowUp";
    const shrink =
      axis === "x" ? event.key === "ArrowRight" : event.key === "ArrowDown";
    if (!grow && !shrink) return;
    event.preventDefault();
    onSize(size + (grow ? step : -step));
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: `PaneDivider`'s reason — the suggested <hr> is a static rule; a separator that moves is the WAI-ARIA window splitter, a focusable widget with a value, which <hr> cannot carry
    <div
      aria-label={
        axis === "x" ? "resize the dock's width" : "resize the drawer's height"
      }
      aria-orientation={axis === "x" ? "vertical" : "horizontal"}
      aria-valuenow={Math.round(size)}
      className={`group relative z-10 shrink-0 rounded ${
        axis === "x" ? "cursor-col-resize" : "cursor-row-resize"
      } ${dragging ? "bg-foreground/[.14]" : "hover:bg-foreground/[.14]"} focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring`}
      data-testid="dock-resizer"
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      ref={(node) => {
        railRef.current = node;
        if (focusRef !== undefined) focusRef.current = node;
      }}
      role="separator"
      style={
        axis === "x" ? { width: DOCK_RESIZER_PX } : { height: DOCK_RESIZER_PX }
      }
      tabIndex={0}
      title="Drag to resize — arrow keys work too"
    >
      {/* The mockup's three-dot grip (`.rz::before`), as DOM. */}
      <span
        aria-hidden="true"
        className={`absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 gap-[6px] ${
          axis === "x" ? "flex-col" : "flex-row"
        }`}
      >
        <span className="h-[3.5px] w-[3.5px] rounded-full bg-foreground/40" />
        <span className="h-[3.5px] w-[3.5px] rounded-full bg-foreground/40" />
        <span className="h-[3.5px] w-[3.5px] rounded-full bg-foreground/40" />
      </span>
    </div>
  );
}
