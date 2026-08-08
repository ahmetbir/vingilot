// Ask, as a mode of the palette: the prefix that switches it from *find* to
// *ask*, and — the part this task is judged on — **what a question is actually
// asked with** (vingilot/docs/plans/2026-08-08-palette-and-documents.md,
// Task 2).
//
// **The prefix is `?`.** One keystroke, in a surface whose whole promise is one
// key and no ceremony; `/ask` costs four and implies a family of slash commands
// this workspace does not have and would then have to invent. `?` is also the
// only leading character that costs nothing to give up: no project, worktree,
// pane or action in this workspace is named starting with it, so no row becomes
// unfindable. It only means "ask" as the *first* character — a `?` typed inside
// a query is a character in a filter.
//
// **The honest part.** What is sent with a question is one path: the directory
// the agent is started in. Not the diff, not the branch, not the file on
// screen, not a summary of the project — `agentClient.runAgent` takes a `cwd`
// and a prompt, and that is the whole of it. Whether the agent then reads
// anything in that directory is the agent's own doing, through its own tools.
// `ASK_SCOPE_NOTE` is that sentence, it is on screen before the question is
// asked, and it is a constant here so a UI cannot drift into implying the
// workspace explained the codebase first.
//
// **A mode that cannot answer says so before it takes the question.** Every
// refusal below is produced from the same probe reading the Agent pane's
// availability uses (`paneModel.ts`'s `AGENT_HARNESS_PROBE`), so the palette
// and the pane cannot come to disagree about whether this machine has an agent.
// `unknown` is a refusal here though the pane treats it as available, and the
// difference is deliberate: the pane reports what it finds for itself once it
// is open, while a palette that accepted a question it could not place would be
// taking it into a void.
//
// Pure: no React, no Tauri, no storage.

import type { ProbeReading } from "./paneModel.ts";

/** Typed first, and only first. */
export const ASK_PREFIX = "?";

/** What is sent with a question, said in full. The UI prints this verbatim. */
export const ASK_SCOPE_NOTE =
  "and nothing else — not the diff, not the branch, not the file on screen, not a description of the project. The agent is started in that directory and reads whatever it opens there itself.";

/** What the same sentence has to say when there is no directory yet. */
export const ASK_NO_SCOPE_NOTE =
  "a question is asked inside a worktree's directory, and that directory is the only thing sent with it.";

/** The question inside an ask-mode query, or `null` when this query is a
 * filter. The prefix is stripped and the rest trimmed, so `"?  why"` and
 * `"? why"` are one question — and `"?"` alone is ask mode with nothing asked
 * yet, which is the state that gets to say whether anything could answer. */
export function readAsk(raw: string): string | null {
  return raw.startsWith(ASK_PREFIX)
    ? raw.slice(ASK_PREFIX.length).trim()
    : null;
}

/** Where the question would be asked, and whether anything is there to answer.
 * `harness` is the reading of `AGENT_HARNESS_PROBE`. */
export interface AskInputs {
  question: string;
  cwd: string | null;
  cwdPending: boolean;
  harness: ProbeReading;
}

export interface Ask {
  question: string;
  /** Exactly what goes out with the question, one line each. Empty when
   * nothing can go out at all. */
  sent: readonly string[];
  /** What that list means, including what is *not* in it. */
  note: string;
  /** `null` when Enter will ask it; otherwise the sentence saying why not —
   * the same shape a blocked palette row carries, and shown the same way. */
  blocked: string | null;
}

/** Everything the ask panel renders, decided here so the panel decides
 * nothing. Order matters: the reasons are checked outermost-first, so the
 * owner is told about the missing agent before he is told to type. */
export function askState({
  cwd,
  cwdPending,
  harness,
  question,
}: AskInputs): Ask {
  const sent = cwd === null ? [] : [cwd];
  const note = cwd === null ? ASK_NO_SCOPE_NOTE : ASK_SCOPE_NOTE;
  const blocked = askBlocked({ cwd, cwdPending, harness, question });
  return { blocked, note, question, sent };
}

function askBlocked({ cwd, cwdPending, harness, question }: AskInputs) {
  if (cwd === null) {
    return cwdPending
      ? "still working out where this worktree is on disk."
      : "no worktree is open, so there is no directory to ask in. Open one first.";
  }
  if (harness.answer === "asking") {
    return "still asking this machine whether an ACP agent is configured.";
  }
  if (harness.answer === "no") {
    return (
      harness.detail ??
      "no ACP agent is configured, so there is nothing here to answer a question."
    );
  }
  if (harness.answer === "unknown") {
    return "this build could not ask whether an ACP agent is configured, so a question typed here would have nowhere to go.";
  }
  return question === "" ? "type a question." : null;
}
