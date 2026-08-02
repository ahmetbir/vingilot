import { useRef, useState } from "react";

const HOLD_MS = 600;

interface StopButtonProps {
  engaged: boolean;
  onEngage: () => void;
  onRelease: () => void;
}

/** Fast-but-deliberate: a plain click can't fire it. Holding for 600ms
 * engages STOP (pausing every live run — App.tsx owns that call); a single
 * press while already engaged releases it immediately. */
export function StopButton({ engaged, onEngage, onRelease }: StopButtonProps) {
  const [holding, setHolding] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearTimer() {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  function startHold() {
    if (engaged) {
      onRelease();
      return;
    }
    setHolding(true);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setHolding(false);
      onEngage();
    }, HOLD_MS);
  }

  function cancelHold() {
    clearTimer();
    setHolding(false);
  }

  return (
    <button
      type="button"
      className={
        "vg-stop" + (engaged ? " vg-stop--engaged" : "") + (holding ? " vg-stop--holding" : "")
      }
      onPointerDown={startHold}
      onPointerUp={cancelHold}
      onPointerLeave={cancelHold}
      aria-pressed={engaged}
      title="hold to STOP — pauses every live run"
    >
      {engaged ? "STOPPED" : "STOP"}
    </button>
  );
}
