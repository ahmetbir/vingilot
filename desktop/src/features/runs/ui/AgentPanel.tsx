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
//
// **This pane is where every turn in this worktree is kept**
// (vingilot/docs/plans/2026-08-08-palette-and-documents.md, Task 2). A `?` in
// the palette and the box below both go through `askRunner.ask`, so both are
// written to the same thread and both claim the same "a turn is out" mark.
// That is the whole reason the box does not call `agent_run` itself any more:
// its `running` was component-local, so the palette could not see it and would
// start a second adapter in this same worktree.
//
// The thread is therefore a conversation the owner can come back to for
// *either* door — including after a restart, which the box's own transcript
// has never survived. What is not kept is the transcript below: the trace is
// this turn's detail, and it is drawn from the outcome in hand, not storage.
//
// The pane reads the thread from `askStore.ts` rather than being handed it:
// a palette question is usually asked while this pane is not on screen, since
// asking is what switches to it.

import * as React from "react";

import { probeAgent } from "@/features/runs/lib/agentClient";
import {
  type AgentAvailability,
  type AgentTurn,
  boundaryNote,
  canRun,
  explainAvailability,
  type TraceKind,
  turnSummary,
} from "@/features/runs/lib/agentTurn";
import { ask } from "@/features/runs/lib/askRunner";
import {
  asksUnstored,
  readThread,
  subscribeToAsks,
} from "@/features/runs/lib/askStore";
import {
  type AskExchange,
  exchangeState,
  UNANSWERED_NOTE,
} from "@/features/runs/lib/askThread";
import { useAskPending } from "@/features/runs/lib/useAskPending";

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

/** One question — or one prompt from the box below; the thread does not sort
 * turns by which door started them — and whatever came back, with the
 * directory it was asked in on the record beside it. A thread read weeks later
 * has to say what each question was asked *with*, not what this surface would
 * send today. */
function Exchange({
  exchange,
  pending,
}: {
  exchange: AskExchange;
  pending: string | null;
}) {
  const state = exchangeState(exchange, pending);
  return (
    <article
      className="flex flex-col gap-1 border-b border-border/40 pb-2 last:border-b-0"
      data-state={state}
      data-testid={`ask-exchange-${exchange.id}`}
    >
      <p className="text-sm text-foreground">{exchange.question}</p>
      <p className="truncate font-mono text-3xs text-muted-foreground/70">
        asked in {exchange.cwd}
      </p>
      {state === "answered" ? (
        <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">
          {exchange.answer}
        </p>
      ) : null}
      {state === "refused" ? (
        <p className="text-sm text-destructive">{exchange.refusal}</p>
      ) : null}
      {state === "asking" ? (
        <p className="text-sm text-muted-foreground">asking…</p>
      ) : null}
      {state === "unanswered" ? (
        <p className="text-sm text-amber-600 dark:text-amber-500">
          {UNANSWERED_NOTE}
        </p>
      ) : null}
    </article>
  );
}

/** The thread for one directory, oldest first, kept in sync with whoever is
 * writing to it. Re-read on every notification rather than diffed: it is at
 * most twenty rows, and a cache here would be a second answer about what the
 * conversation is. */
function useAskThread(cwd: string | null) {
  const pending = useAskPending();
  const [exchanges, setExchanges] = React.useState<AskExchange[]>([]);
  // Whether what is drawn below is only in memory. Read at the same moment the
  // rows are, from the same notification, so the thread and the promise made
  // about it cannot come from two different instants.
  const [kept, setKept] = React.useState(true);

  React.useEffect(() => {
    function sync() {
      setExchanges(cwd === null ? [] : readThread(cwd));
      setKept(!asksUnstored());
    }
    sync();
    return subscribeToAsks(sync);
  }, [cwd]);

  return { exchanges, kept, pending };
}

export function AgentPanel({ cwd }: Props) {
  const thread = useAskThread(cwd);
  const [availability, setAvailability] =
    React.useState<AgentAvailability | null>(null);
  const [asked, setAsked] = React.useState(false);
  const [prompt, setPrompt] = React.useState("");
  const [turn, setTurn] = React.useState<AgentTurn | null>(null);

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
  // Derived from the one mark, not tracked beside it. `elsewhere` is a turn
  // this worktree cannot see and must still wait for — the guard is one
  // adapter for the whole app.
  const runningHere = thread.pending !== null && thread.pending.cwd === cwd;
  const elsewhere =
    thread.pending !== null && thread.pending.cwd !== cwd
      ? thread.pending.cwd
      : null;
  const ready =
    cwd !== null && canRun(prompt, availability) && thread.pending === null;

  async function start() {
    if (cwd === null || !ready) return;
    // The previous turn's transcript goes: it described a different prompt,
    // and leaving it under a running one reads as this turn's output.
    setTurn(null);
    // A refusal is not held here: `ask` has already written it onto this
    // prompt's row in the thread, where it survives the remount that a
    // worktree switch does to this component.
    const outcome = await ask(cwd, prompt);
    if (outcome.kind === "turn") setTurn(outcome.turn);
  }

  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3"
      data-testid="pane-agent"
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

      {thread.exchanges.length > 0 ? (
        <section className="flex flex-col gap-2" data-testid="ask-thread">
          <h3 className="text-3xs font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
            asked and run here
          </h3>
          {thread.kept ? null : (
            <p
              className="text-2xs text-amber-600 dark:text-amber-500"
              data-testid="ask-thread-unstored"
            >
              not kept — this app could not write to its own storage, so this
              conversation is here until the app closes.
            </p>
          )}
          {thread.exchanges.map((exchange) => (
            <Exchange
              exchange={exchange}
              key={exchange.id}
              pending={thread.pending?.id ?? null}
            />
          ))}
        </section>
      ) : null}

      <textarea
        className="min-h-24 w-full resize-y rounded-lg border border-border/60 bg-background px-3 py-2 text-sm outline-none focus:border-border"
        data-testid="agent-prompt"
        disabled={runningHere}
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
          {runningHere ? "running…" : "Run"}
        </button>
        {cwd === null ? (
          <span className="text-xs text-muted-foreground">
            this worktree has no directory this app can name.
          </span>
        ) : null}
        {elsewhere !== null ? (
          <span
            className="min-w-0 truncate text-xs text-amber-600 dark:text-amber-500"
            data-testid="agent-busy-elsewhere"
          >
            a turn is already running in {elsewhere}, and one adapter runs at a
            time.
          </span>
        ) : null}
        {turn !== null ? (
          <span className="text-xs text-muted-foreground">
            {turnSummary(turn)} — open Diff to read what changed.
          </span>
        ) : null}
      </div>

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
