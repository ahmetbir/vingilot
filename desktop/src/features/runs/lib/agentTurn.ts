// What an ACP agent's turn amounts to, and what each way of failing says
// (vingilot/docs/plans/2026-08-07-workspace-v1.md, Task 8). Pure: every
// decision the Agent panel makes is made here, and tested without a backend.
//
// **The copy rule this file exists to hold.** A worktree is a collision
// boundary, not a security boundary (ADR-003). The agent runs as a child of
// this app, with this app's environment and the owner's own credentials, and
// an approved tool reaches whatever the owner's shell reaches. Nothing here
// may say isolated, sandboxed, or contained — `boundaryNote` is the sentence
// that says what is actually true, and the panel shows it whether or not an
// agent is configured.

/** Whether there is an agent to run, as `vingilot_agent::config` answers it. */
export type AgentAvailability =
  | { kind: "not-configured"; variables: string[] }
  | { kind: "missing"; program: string }
  | { kind: "ready"; program: string; args: string[]; resolved: string };

export type TraceKind =
  | "message"
  | "thought"
  | "tool-call"
  | "permission"
  | "plan";

export interface TraceEntry {
  kind: TraceKind;
  text: string;
  /** Position in the transcript, from 0. The transcript is append-only and
   * never reordered, so this is a stable identity for a row — two entries can
   * carry identical text (the same tool run twice) and would otherwise be
   * indistinguishable. */
  seq: number;
}

export interface AgentTurn {
  sessionId: string;
  stopReason: string;
  trace: TraceEntry[];
  dropped: number;
  stderr: string;
}

/** Every way a turn does not produce an answer, as `client.rs` serialises it. */
export type AgentFailure =
  | { kind: "empty-prompt" }
  | { kind: "not-configured"; variables: string[] }
  | { kind: "missing"; program: string }
  | { kind: "no-such-directory"; path: string }
  | { kind: "spawn"; program: string; message: string }
  | { kind: "protocol"; message: string }
  | { kind: "refused"; code: number; message: string }
  | { kind: "silent"; phase: string; seconds: number }
  | { kind: "too-long"; seconds: number }
  | { kind: "exited"; message: string }
  | { kind: "interrupted"; message: string };

const TRACE_KINDS: TraceKind[] = [
  "message",
  "thought",
  "tool-call",
  "permission",
  "plan",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === "string")
    : [];
}

/** The probe's answer, or `null` when the bridge said something this build
 * cannot read. `null` is not "no agent": the panel says it could not ask,
 * rather than telling the owner to configure something that may already be
 * configured. */
export function readAvailability(value: unknown): AgentAvailability | null {
  if (!isRecord(value)) return null;
  switch (value.kind) {
    case "not-configured":
      return { kind: "not-configured", variables: strings(value.variables) };
    case "missing": {
      const program = str(value.program);
      return program === null ? null : { kind: "missing", program };
    }
    case "ready": {
      const command = isRecord(value.command) ? value.command : null;
      const program = str(command?.program);
      const resolved = str(value.resolved);
      if (program === null || resolved === null) return null;
      return {
        args: strings(command?.args),
        kind: "ready",
        program,
        resolved,
      };
    }
    default:
      return null;
  }
}

function readTraceEntry(value: unknown): Omit<TraceEntry, "seq"> | null {
  if (!isRecord(value)) return null;
  const text = str(value.text);
  const kind = TRACE_KINDS.find((known) => known === value.kind);
  if (text === null || kind === undefined) return null;
  return { kind, text };
}

/** A finished turn, or `null` for a shape this build cannot read. */
export function readTurn(value: unknown): AgentTurn | null {
  if (!isRecord(value)) return null;
  const sessionId = str(value.sessionId);
  const stopReason = str(value.stopReason);
  if (sessionId === null || stopReason === null) return null;
  // Numbered after the unreadable entries are dropped, so the transcript on
  // screen is numbered by what it shows rather than by what arrived.
  const trace = (Array.isArray(value.trace) ? value.trace : [])
    .map(readTraceEntry)
    .filter((entry): entry is Omit<TraceEntry, "seq"> => entry !== null)
    .map((entry, seq) => ({ ...entry, seq }));
  return {
    dropped: typeof value.dropped === "number" ? value.dropped : 0,
    sessionId,
    stderr: str(value.stderr) ?? "",
    stopReason,
    trace,
  };
}

/** A refusal from the Rust side, or `null` if the thrown value is not one. */
export function readAgentFailure(value: unknown): AgentFailure | null {
  if (!isRecord(value)) return null;
  const kind = str(value.kind);
  switch (kind) {
    case "empty-prompt":
      return { kind };
    case "not-configured":
      return { kind, variables: strings(value.variables) };
    case "missing":
      return { kind, program: str(value.program) ?? "" };
    case "no-such-directory":
      return { kind, path: str(value.path) ?? "" };
    case "spawn":
      return {
        kind,
        message: str(value.message) ?? "",
        program: str(value.program) ?? "",
      };
    case "protocol":
    case "exited":
    case "interrupted":
      return { kind, message: str(value.message) ?? "" };
    case "refused":
      return {
        code: typeof value.code === "number" ? value.code : 0,
        kind,
        message: str(value.message) ?? "",
      };
    case "silent":
      return {
        kind,
        phase: str(value.phase) ?? "",
        seconds: typeof value.seconds === "number" ? value.seconds : 0,
      };
    case "too-long":
      return {
        kind,
        seconds: typeof value.seconds === "number" ? value.seconds : 0,
      };
    default:
      return null;
  }
}

/** What the panel says about the agent it has, or has not. `ready` is what
 * gates the Run button — nothing else may. */
export function explainAvailability(availability: AgentAvailability | null): {
  ready: boolean;
  message: string;
} {
  if (availability === null) {
    return {
      message: "could not ask this build whether an agent is configured.",
      ready: false,
    };
  }
  switch (availability.kind) {
    case "not-configured":
      return {
        message:
          availability.variables.length === 0
            ? "no ACP agent is configured."
            : `no ACP agent is configured — set ${availability.variables.join(" or ")} to an adapter that speaks ACP over stdio.`,
        ready: false,
      };
    case "missing":
      return {
        message: `${availability.program} is configured, and nothing executable by that name was found on PATH or in the usual install directories.`,
        ready: false,
      };
    case "ready":
      return { message: availability.resolved, ready: true };
  }
}

/** A failure as one sentence. Every branch names the thing that went wrong,
 * because the owner's next move differs for each. */
export function explainFailure(failure: AgentFailure | null): string {
  if (failure === null)
    return "the agent failed in a way this build cannot read.";
  switch (failure.kind) {
    case "empty-prompt":
      return "write what the agent should do first.";
    case "not-configured":
      return explainAvailability({
        kind: "not-configured",
        variables: failure.variables,
      }).message;
    case "missing":
      return explainAvailability({ kind: "missing", program: failure.program })
        .message;
    case "no-such-directory":
      return `there is no directory at ${failure.path} to work in.`;
    case "spawn":
      return `${failure.program} could not be started: ${failure.message}`;
    case "protocol":
      return `the agent said something that is not ACP: ${failure.message}`;
    case "refused":
      return `the agent refused (${failure.code}): ${failure.message}`;
    case "silent":
      return `the agent said nothing for ${failure.seconds}s during the ${failure.phase}, and was given up on. Nothing it had already changed was undone.`;
    case "too-long":
      return `the turn ran past its ${failure.seconds}s cap and was given up on. Nothing it had already changed was undone.`;
    case "exited":
      return failure.message;
    case "interrupted":
      return `the turn never ran: ${failure.message}`;
  }
}

/** Whether Run should do anything. A blank prompt is refused here rather than
 * by starting an adapter — which for the hosted ones means a network login —
 * to send it nothing. */
export function canRun(
  prompt: string,
  availability: AgentAvailability | null,
): boolean {
  return prompt.trim().length > 0 && explainAvailability(availability).ready;
}

/** What a finished turn says at a glance. `end_turn` is the agent's own word
 * for "I am done"; anything else is worth reading before the diff is. */
export function turnSummary(turn: AgentTurn): string {
  const stopped =
    turn.stopReason === "end_turn" ? "finished" : `stopped: ${turn.stopReason}`;
  const dropped = turn.dropped > 0 ? `, ${turn.dropped} entries not shown` : "";
  return `${stopped}${dropped}`;
}

/** The sentence that has to be on screen wherever an agent is run, and the
 * one thing in this file that is not about a failure. It says what a worktree
 * does and does not do, in the terms ADR-003 fixed. */
export const boundaryNote =
  "the agent works in this worktree so its changes stay off your other branches. it runs with your account and your environment — the worktree keeps work apart, it does not hold the agent in.";
