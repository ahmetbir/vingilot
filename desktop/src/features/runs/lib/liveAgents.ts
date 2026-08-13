// What an agent in a worktree's terminal is doing — the frontend's reading of
// `vingilot_hooks` (vingilot/docs/plans/2026-08-12-hooks-and-the-dots.md,
// Task 3).
//
// The backend answers one map per poll, keyed by binding id, and holds
// everything true about liveness: the event vocabulary, the precedence between
// two sessions in one worktree, and — the part nothing here may re-decide — the
// decay that removes a session which has stopped talking. **A worktree with no
// entry has no live agent**, which is "nothing has answered", never "quiet".
// That is the same reading `useWorktreeStats` gives a missing stat and the same
// one `attentionSignal.ts` is built on, so this signal joins the dots without
// teaching the screen a second way to be silent.
//
// Three decisions live here and nowhere else.
//
// **The join is by binding id first and by path second.** Most rows are
// `local:<hex-of-path>` and the backend derives exactly that id from the hook's
// cwd, so the map lookup answers. A *project's own checkout* is different: its
// row carries a synthetic `main:<repo id>` that no path can produce
// (`binding.ts`'s own header says so), so an agent working in it is filed under
// the `local:` id of the same directory. `agentFor` therefore takes the cwd as
// well and falls back to comparing paths — which is why `AgentLiveness` carries
// one. Without that, the one checkout the owner is most likely to run `claude`
// in is the one worktree this feature cannot see.
//
// **The sentence for the bar is the backend's, whole.** `state.rs` produces it
// beside the state for `attentionSignal.ts`'s reason — a sentence assembled by
// a surface drifts from the state it explains — and `Liveness::word`'s own
// header names this bar as its caller ("the bottom bar prefixes the harness").
// So the segment is `claude · ` plus that sentence, and this module writes no
// vocabulary of its own.
//
// **The dot's sentence is not that sentence**, and that is not a contradiction.
// A dot's tooltip has to name the signal it came from — every state in
// `attentionSignal.ts` does — so its words are "an agent in this worktree's
// terminal is waiting for approval: Bash", one sentence with the harness's
// state and tool inside it rather than two concatenated. It is built from
// `state` and `tool`, which the backend carries beside the sentence for exactly
// this, and never by splitting the sentence back apart.
//
// Pure except for `liveAgents()`, which is one `invoke` and no logic.

import { invoke } from "@tauri-apps/api/core";

/** What the backend says about one state a worktree's sessions are in. Mirrors
 * `vingilot_hooks::state::AgentLiveness`. */
export interface AgentLiveness {
  /** `asking` is the only one that raises a needs-you dot. */
  state: "working" | "waiting" | "asking";
  /** The harness's own words — "working — Bash", "waiting for approval: Bash",
   * "2 sessions working". Rendered whole by the bottom bar. */
  sentence: string;
  /** How many sessions are in this state here. */
  sessions: number;
  /** The worktree directory, when the backend derived the id from one. */
  path: string | null;
  /** The tool this state is about, when exactly one session is speaking. */
  tool: string | null;
}

/** Every worktree's live agents, once per poll. */
export interface LiveAgents {
  byBinding: Readonly<Record<string, AgentLiveness>>;
  /** Sessions the backend could attribute to no worktree. Held apart so
   * nothing draws them on a row by accident; read by no surface today, and
   * kept in the type because dropping it in the client would make the answer
   * look complete when it is not. */
  unattributed: AgentLiveness | null;
}

/** The empty answer, shared rather than rebuilt — a caller with nothing has to
 * pass *this* absence, for `NO_MARK`'s reason. */
export const NO_AGENTS: LiveAgents = { byBinding: {}, unattributed: null };

const STATES = new Set(["working", "waiting", "asking"]);

/** One agent record out of whatever came back, or `null`.
 *
 * Defensive on purpose: this crosses the IPC boundary, and a build of the app
 * whose backend is older than its frontend (a `tauri dev` against a stale
 * binary, which happens daily here) would otherwise put `undefined` into a
 * sentence on screen. A record this reader cannot understand is no answer,
 * which draws nothing — the same outcome as a worktree with no session. */
function readAgent(raw: unknown): AgentLiveness | null {
  if (raw === null || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.state !== "string" || !STATES.has(record.state))
    return null;
  if (typeof record.sentence !== "string" || record.sentence === "")
    return null;
  return {
    path: typeof record.path === "string" ? record.path : null,
    sentence: record.sentence,
    sessions: typeof record.sessions === "number" ? record.sessions : 1,
    state: record.state as AgentLiveness["state"],
    tool: typeof record.tool === "string" ? record.tool : null,
  };
}

export function readLiveAgents(raw: unknown): LiveAgents {
  if (raw === null || typeof raw !== "object") return NO_AGENTS;
  const record = raw as Record<string, unknown>;
  const byBinding: Record<string, AgentLiveness> = {};
  const map = record.byBinding;
  if (map !== null && typeof map === "object") {
    for (const [id, value] of Object.entries(map as Record<string, unknown>)) {
      const agent = readAgent(value);
      if (agent !== null) byBinding[id] = agent;
    }
  }
  return { byBinding, unattributed: readAgent(record.unattributed) };
}

/** Ask the backend. Answers `NO_AGENTS` rather than throwing: the endpoint may
 * never have come up (no loopback, no entropy), and a machine with no hook
 * endpoint is one where the dots say what they said yesterday — not one where
 * a poll has to be caught by every caller. */
export async function liveAgents(): Promise<LiveAgents> {
  try {
    return readLiveAgents(await invoke<unknown>("hook_liveness"));
  } catch {
    return NO_AGENTS;
  }
}

/** The agent for one worktree — by binding id, then by directory. `null` when
 * nothing has answered about it. See this module's header for why the second
 * lookup exists. */
export function agentFor(
  agents: LiveAgents,
  bindingId: string,
  cwd: string | null,
): AgentLiveness | null {
  const direct = agents.byBinding[bindingId];
  if (direct !== undefined) return direct;
  if (cwd === null) return null;
  for (const agent of Object.values(agents.byBinding)) {
    if (agent.path === cwd) return agent;
  }
  return null;
}

/** What the bottom bar says about the selected worktree's agent — the harness,
 * then the harness's own words. `null` when there is no session, because
 * absence says nothing and a segment reading "claude · none" would be this bar
 * claiming to know a terminal is idle. */
export function agentSegment(agent: AgentLiveness | null): string | null {
  return agent === null ? null : `claude · ${agent.sentence}`;
}
