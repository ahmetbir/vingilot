import { unreachableView } from "./reachability.ts";

interface UnreachableProps {
  reachable: boolean;
  since: Date | null;
  now: Date;
  intervalMs: number;
  onRetryNow: () => void;
}

/** Design 7c: a persistent, non-dismissible lane above the status bar while
 * the control plane is unreachable. It clears itself the instant reachable
 * flips back to true — there is no manual dismiss, because the state it
 * reports isn't something the user can wave away. V1 queues nothing: new
 * Runs and transitions are disabled elsewhere (Deck, RunView) while this is
 * up, and this lane says so in words rather than pretending a write queue
 * exists. */
export function Unreachable({ reachable, since, now, intervalMs, onRetryNow }: UnreachableProps) {
  const view = unreachableView(reachable, since, now, intervalMs);
  if (view === null) return null;

  return (
    <div className="vg-unreachable" role="alert" aria-live="assertive">
      <span className="vg-unreachable__glyph" aria-hidden="true">
        ⚠
      </span>
      <span className="vg-unreachable__text">
        CONTROL PLANE UNREACHABLE — read-only since {view.since.toLocaleTimeString()} · new Runs and transitions
        queue nothing (disabled) · retrying · next in {view.nextRetrySecs}s
      </span>
      <button type="button" className="vg-button vg-unreachable__retry" onClick={onRetryNow}>
        Retry now
      </button>
    </div>
  );
}
