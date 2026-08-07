// Handing one worktree to an ACP agent
// (vingilot/docs/plans/2026-08-07-workspace-v1.md, Task 8).
//
// A prompt, one turn, and the agent's own transcript. What it changed is not
// shown here on purpose: the Diff tab reads that from git, the same way it
// reads the owner's own edits, so there is one answer about a worktree's
// contents rather than two that can disagree.
//
// Every decision is in `lib/agentTurn.ts` — whether Run does anything, what
// each failure says, and the boundary sentence that must be on screen whether
// or not an agent is configured. **A worktree is a collision boundary, not a
// security boundary** (ADR-003): nothing here may read as isolation, and
// `agentTurn.test.mjs` fails the build if it starts to.
//
// Asked once, when the panel opens. The probe stats a few directories; polling
// it would ask a question whose answer changes when the owner edits his shell
// profile, which is not something to watch for.

import * as React from "react";

import { probeAgent, runAgent } from "@/features/runs/lib/agentClient";
import {
  type AgentAvailability,
  type AgentTurn,
  boundaryNote,
  canRun,
  explainAvailability,
  explainFailure,
  type TraceKind,
  turnSummary,
} from "@/features/runs/lib/agentTurn";

const TRACE_CLASS: Record<TraceKind, string> = {
  message: "text-foreground",
  permission: "text-amber-600 dark:text-amber-400",
  plan: "text-muted-foreground",
  thought: "text-muted-foreground italic",
  "tool-call": "text-emerald-600 dark:text-emerald-400",
};

const TRACE_MARK: Record<TraceKind, string> = {
  message: "",
  permission: "✓ ",
  plan: "▸ ",
  thought: "",
  "tool-call": "⚙ ",
};

interface Props {
  /** The worktree's own directory, or `null` before the desktop shell has
   * resolved one — an agent cannot be started somewhere this app cannot
   * name. */
  cwd: string | null;
}

export function AgentPanel({ cwd }: Props) {
  const [availability, setAvailability] =
    React.useState<AgentAvailability | null>(null);
  const [asked, setAsked] = React.useState(false);
  const [prompt, setPrompt] = React.useState("");
  const [running, setRunning] = React.useState(false);
  const [turn, setTurn] = React.useState<AgentTurn | null>(null);
  const [refusal, setRefusal] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      const answered = await probeAgent();
      if (cancelled) return;
      setAvailability(answered);
      setAsked(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const agent = explainAvailability(availability);
  const ready = cwd !== null && canRun(prompt, availability) && !running;

  async function start() {
    if (cwd === null || !ready) return;
    setRunning(true);
    // The previous turn's transcript goes: it described a different prompt,
    // and leaving it under a running one reads as this turn's output.
    setTurn(null);
    setRefusal(null);
    const result = await runAgent(cwd, prompt);
    setRunning(false);
    if (result.ok) {
      setTurn(result.value);
    } else {
      setRefusal(explainFailure(result.error));
    }
  }

  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3"
      data-testid="work-surface-agent-tab"
    >
      <div className="flex flex-col gap-1">
        <p className="text-xs text-muted-foreground">{boundaryNote}</p>
        <p
          className="font-mono text-2xs text-muted-foreground/70"
          data-testid="agent-availability"
        >
          {asked ? agent.message : "asking…"}
        </p>
      </div>

      <textarea
        className="min-h-24 w-full resize-y rounded-lg border border-border/60 bg-background px-3 py-2 text-sm outline-none focus:border-border"
        data-testid="agent-prompt"
        disabled={running}
        onChange={(event) => setPrompt(event.target.value)}
        placeholder="what should the agent do in this worktree?"
        value={prompt}
      />

      <div className="flex items-center gap-2">
        <button
          className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
          data-testid="agent-run"
          disabled={!ready}
          onClick={() => void start()}
          type="button"
        >
          {running ? "running…" : "Run"}
        </button>
        {cwd === null ? (
          <span className="text-xs text-muted-foreground">
            this worktree has no directory this app can name.
          </span>
        ) : null}
        {turn !== null ? (
          <span className="text-xs text-muted-foreground">
            {turnSummary(turn)} — open Diff to read what changed.
          </span>
        ) : null}
      </div>

      {refusal !== null ? (
        <p className="text-sm text-destructive" data-testid="agent-refusal">
          {refusal}
        </p>
      ) : null}

      {turn !== null && turn.trace.length > 0 ? (
        <div
          className="flex flex-col gap-1 rounded-lg border border-border/60 bg-muted/30 p-3 font-mono text-xs"
          data-testid="agent-trace"
        >
          {turn.trace.map((entry) => (
            <div
              className={`whitespace-pre-wrap break-words ${TRACE_CLASS[entry.kind]}`}
              key={entry.seq}
            >
              {TRACE_MARK[entry.kind]}
              {entry.text}
            </div>
          ))}
        </div>
      ) : null}

      {turn !== null && turn.stderr.trim().length > 0 ? (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">what the agent logged</summary>
          <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-2xs">
            {turn.stderr}
          </pre>
        </details>
      ) : null}
    </div>
  );
}
