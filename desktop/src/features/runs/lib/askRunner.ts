// The one call that asks. Both doors into ask mode end here, so there is one
// conversation and one place that decides what an answer is
// (vingilot/docs/plans/2026-08-08-palette-and-documents.md, Task 2).
//
// No logic of its own: `askThread.ts` says what an answer is worth keeping,
// `agentTurn.ts` says what each failure reads as, and `askStore.ts` holds both.
// What is here is the order — the question is recorded *before* the turn runs,
// so a question is never lost to a turn that never comes back.
//
// It is the same `agent_run` the Agent pane's own box uses: one adapter, one
// worktree, one turn. Nothing here shells out, and nothing here runs
// `claude -p`.

import { runAgent } from "@/features/runs/lib/agentClient";
import { explainFailure } from "@/features/runs/lib/agentTurn";
import { settleAsk, startAsk } from "@/features/runs/lib/askStore";
import { answerFromTurn } from "@/features/runs/lib/askThread";

/** Ask `question` in `cwd`. Resolves when the exchange is settled — a refusal
 * is an outcome, not a throw, and is written onto the exchange the same way an
 * answer is. Does nothing when a question is already in flight. */
export async function ask(cwd: string, question: string): Promise<void> {
  const id = startAsk(cwd, question);
  if (id === null) return;
  const result = await runAgent(cwd, question);
  settleAsk(
    cwd,
    id,
    result.ok
      ? { answer: answerFromTurn(result.value) }
      : { refusal: explainFailure(result.error) },
  );
}
