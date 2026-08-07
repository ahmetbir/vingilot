// The `vingilot_agent` Tauri commands
// (desktop/src-tauri/src/vingilot_agent/). No logic lives here: `agentTurn.ts`
// decides what an answer means and what a refusal says, and is tested without
// a backend.
//
// Every call answers rather than throws. A refusal is the ordinary outcome of
// asking an agent to do something — no agent configured, an adapter that will
// not authenticate, a turn that ran too long — so it is a value the panel
// renders, never an exception a caller has to remember to catch.

import { invoke } from "@tauri-apps/api/core";

import {
  type AgentAvailability,
  type AgentFailure,
  type AgentTurn,
  readAgentFailure,
  readAvailability,
  readTurn,
} from "@/features/runs/lib/agentTurn";

export type AgentResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: AgentFailure | null };

/** Whether an agent is configured, without starting one.
 *
 * `null` rather than a guess when the answer is unreadable: `agentTurn.ts`
 * turns that into "could not ask", which is a different sentence from "you
 * have not configured one". */
export async function probeAgent(): Promise<AgentAvailability | null> {
  try {
    return readAvailability(await invoke<unknown>("agent_probe"));
  } catch {
    return null;
  }
}

/** One turn in `cwd`, which is a worktree's own directory.
 *
 * What the agent changed is deliberately not in the answer — the Diff tab
 * reads that from git, the same way it reads the owner's own edits. */
export async function runAgent(
  cwd: string,
  prompt: string,
): Promise<AgentResult<AgentTurn>> {
  let answered: unknown;
  try {
    answered = await invoke<unknown>("agent_run", { cwd, prompt });
  } catch (thrown) {
    return { error: readAgentFailure(thrown), ok: false };
  }
  const turn = readTurn(answered);
  if (turn === null) {
    return {
      error: {
        kind: "protocol",
        message: "the turn came back in a shape this build cannot read.",
      },
      ok: false,
    };
  }
  return { ok: true, value: turn };
}
