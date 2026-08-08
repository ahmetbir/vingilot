// The one call that runs a turn. Both doors — the palette's ask mode and the
// Agent pane's Run button — end here, so there is one conversation, one place
// that decides what an answer is, and **one mark saying a turn is out**
// (vingilot/docs/plans/2026-08-08-palette-and-documents.md, Task 2).
//
// The pane used to call `runAgent` itself and hold its own `running` flag. Two
// pieces of state for one fact is two pieces of state that can disagree, and
// they did: with a turn running from the pane, the palette saw nothing pending
// and started a second adapter in the same worktree — a second login and a
// second billed turn on a hosted adapter.
//
// No logic of its own: `askThread.ts` says what an answer is worth keeping,
// `agentTurn.ts` says what each failure reads as, and `askStore.ts` holds both.
// What is here is the order — the prompt is recorded *before* the turn runs,
// so a question is never lost to a turn that never comes back.
//
// It is the same `agent_run` either door used before: one adapter, one
// worktree, one turn. Nothing here shells out, and nothing here runs
// `claude -p`.

import { runAgent } from "@/features/runs/lib/agentClient";
import { type AgentTurn, explainFailure } from "@/features/runs/lib/agentTurn";
import { settleAsk, startAsk } from "@/features/runs/lib/askStore";
import { answerFromTurn } from "@/features/runs/lib/askThread";

/** What came back, for a caller that shows more than the thread does — the
 * pane draws the transcript, which is not kept. Every outcome is already on
 * the exchange this call wrote, so a caller that ignores it loses nothing. */
export type AskOutcome =
  | { kind: "turn"; turn: AgentTurn }
  | { kind: "refusal"; refusal: string }
  /** A turn was already running, so this one never started. The question is
   * on the thread carrying that reason (`askStore.ts`). */
  | { kind: "not-asked" };

/** Ask `question` in `cwd`. Resolves when the exchange is settled — a refusal
 * is an outcome, not a throw, and is written onto the exchange the same way an
 * answer is. */
export async function ask(cwd: string, question: string): Promise<AskOutcome> {
  const id = startAsk(cwd, question);
  if (id === null) return { kind: "not-asked" };
  const result = await runAgent(cwd, question);
  if (result.ok) {
    settleAsk(cwd, id, { answer: answerFromTurn(result.value) });
    return { kind: "turn", turn: result.value };
  }
  const refusal = explainFailure(result.error);
  settleAsk(cwd, id, { refusal });
  return { kind: "refusal", refusal };
}
