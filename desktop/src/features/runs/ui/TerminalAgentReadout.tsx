// The terminal bar's right side — the mockup `.tright`'s live half.
//
// The mockup drew "Opus 4.6 · working 2m 14s". What this app can honestly
// say about a worktree's terminal agent is `vingilot_hooks`' liveness
// (`lib/liveAgents.ts`): the harness name, the backend's own sentence
// ("working — Bash"), and nothing about the model — the hooks carry no model
// name, and inventing one is exactly the fake data this phase forbids. So
// the readout is the spinner, the harness sentence via `agentSegment` (the
// same words the status bar prints, one source), and an elapsed measured
// from when THIS app first observed the state — anchored client-side because
// the hooks carry no start time either. The elapsed restarts when the
// sentence changes state (working → waiting is a different watch), and the
// whole readout renders nothing when no agent is live: an empty right side
// is the honest reading of an empty worktree.

import * as React from "react";

import {
  agentFor,
  agentSegment,
  type AgentLiveness,
} from "@/features/runs/lib/liveAgents";
import { useLiveAgents } from "@/features/runs/lib/useLiveAgents";

/** m:ss under an hour, h:mm:ss above — a watch face, not a sentence. */
function elapsedLabel(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function useObservedSince(agent: AgentLiveness | null): number | null {
  // The anchor is per state-word: a harness that moves from working to
  // waiting starts a new observation, and one that goes quiet drops it.
  const anchor = React.useRef<{ state: string; at: number } | null>(null);
  if (agent === null) {
    anchor.current = null;
  } else if (anchor.current === null || anchor.current.state !== agent.state) {
    anchor.current = { at: Date.now(), state: agent.state };
  }
  return anchor.current?.at ?? null;
}

export function TerminalAgentReadout({
  bindingId,
  cwd,
}: {
  bindingId: string;
  cwd: string | null;
}) {
  const agents = useLiveAgents();
  const agent = agentFor(agents, bindingId, cwd);
  const since = useObservedSince(agent);

  // One ticking second-hand, running only while there is a watch to drive.
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (since === null) return;
    setNow(Date.now());
    const handle = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(handle);
  }, [since]);

  const segment = agentSegment(agent);
  if (agent === null || segment === null || since === null) return null;

  return (
    <span
      className="flex shrink-0 items-center gap-2 text-2xs text-muted-foreground"
      data-testid="terminal-agent-readout"
      title={`${segment} — observed by this app for ${elapsedLabel(now - since)}`}
    >
      <span
        aria-hidden="true"
        className="h-2.5 w-2.5 shrink-0 animate-spin rounded-full border-[1.5px] border-foreground/15 border-t-[var(--vingilot-accent)]"
      />
      <span className="truncate" data-testid="terminal-agent-sentence">
        {segment}
      </span>
      <span className="tabular-nums" data-testid="terminal-agent-elapsed">
        {elapsedLabel(now - since)}
      </span>
    </span>
  );
}
