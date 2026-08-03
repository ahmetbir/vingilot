// Fast-but-deliberate STOP: a plain click can't fire it. Holding for 600ms
// engages STOP (pausing every live run — RunsScreen owns that call); a
// single press while already engaged releases it immediately.
//
// Fixes the donor's hold bug (vingilot/workbench/src/shell/StopButton.tsx):
// that version tracked the hold with plain onPointerDown/Up/Leave, so a fast
// drag off the small button box fired a native pointerleave and silently
// cancelled the hold before the 600ms timer ever fired. This version calls
// `setPointerCapture` on pointerdown, so this element keeps receiving
// pointerup/pointerleave for that pointer regardless of where the cursor
// physically is — pointerleave now only fires for a genuine release/cancel,
// verified by holding in the browser (not just reading the timer logic).

import * as React from "react";

const HOLD_MS = 600;

interface StopAllButtonProps {
  engaged: boolean;
  onEngage: () => void;
  onRelease: () => void;
}

export function StopAllButton({
  engaged,
  onEngage,
  onRelease,
}: StopAllButtonProps) {
  const [holding, setHolding] = React.useState(false);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearTimer() {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  function handlePointerDown(event: React.PointerEvent<HTMLButtonElement>) {
    if (engaged) {
      onRelease();
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    setHolding(true);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setHolding(false);
      onEngage();
    }, HOLD_MS);
  }

  function endHold(event: React.PointerEvent<HTMLButtonElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    clearTimer();
    setHolding(false);
  }

  return (
    <button
      aria-pressed={engaged}
      className={`rounded-full border px-3 py-1 text-2xs font-semibold uppercase tracking-wide transition-colors ${
        engaged
          ? "border-destructive bg-destructive text-destructive-foreground"
          : holding
            ? "border-destructive bg-destructive/20 text-destructive"
            : "border-border text-muted-foreground hover:bg-muted/60"
      }`}
      data-testid="stop-all-button"
      onPointerCancel={endHold}
      onPointerDown={handlePointerDown}
      onPointerLeave={endHold}
      onPointerUp={endHold}
      title="hold to STOP — pauses every live run"
      type="button"
    >
      {engaged ? "STOPPED" : "STOP"}
    </button>
  );
}
