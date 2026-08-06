// Pure model for which PTY sessions the workspace is holding open, and which
// of them the owner has really closed.
//
// The distinction this module exists to draw: a terminal that is merely
// hidden — a different worktree selected, a different tab, a different
// project — keeps its shell. Only a worktree that has left the workspace
// entirely is "really closed", and only then may its shell be killed. React
// unmounting a `<Terminal>` is not that event and must never be mistaken for
// it, which is why the decision lives here rather than in a component's
// cleanup function.

import type { GroupedWorktrees, Repo, Worktree } from "./projects.ts";
import { worktreeCwd } from "./projects.ts";

/** One worktree, resolved back to the repo that owns it — the pair a
 * terminal needs before it can derive a cwd. */
export interface IndexedWorktree {
  repo: Repo;
  worktree: Worktree;
}

/** What `<Terminal>` is rendered from: the PTY session id (the worktree
 * binding id) and where its shell starts. `cwd: null` is the honest
 * "not derivable yet" — the terminal shows a waiting state instead of
 * opening a session somewhere arbitrary. */
export interface TerminalSession {
  sessionId: string;
  cwd: string | null;
}

/** Every worktree the workspace currently knows about, keyed by binding id.
 *
 * Built from `groupWorktrees`' output rather than the coordinator's raw
 * worktree list, because a repo's own checkout (`main:<repo id>`) is
 * synthesised client-side and has no coordinator row — a liveness check
 * against the raw list would read every checkout as already gone.
 * `grouped.unknown` is deliberately excluded: without a known repo there is
 * no path to start a shell in. */
export function worktreeIndex(
  repos: readonly Repo[],
  grouped: GroupedWorktrees,
): Map<string, IndexedWorktree> {
  const index = new Map<string, IndexedWorktree>();
  for (const repo of repos) {
    for (const worktree of grouped.byRepo[repo.id] ?? []) {
      index.set(worktree.binding_id, { repo, worktree });
    }
  }
  return index;
}

/** The open sessions whose worktree no longer exists — the owner really
 * closed them, so their shell should be killed rather than kept warm for a
 * reattach that can never happen.
 *
 * An empty `liveWorktreeIds` returns nothing. The worktree list is polled,
 * not pushed, so a single empty read is "the workspace has not answered
 * yet", and acting on it would kill the owner's running shells over a blip.
 * This costs no real coverage: every repo contributes its own checkout to
 * the live set, so the set is only empty when there are no repos at all —
 * in which case nothing could have been opened. */
export function sessionsToClose(
  openedSessionIds: readonly string[],
  liveWorktreeIds: readonly string[],
): string[] {
  if (liveWorktreeIds.length === 0) return [];
  const live = new Set(liveWorktreeIds);
  return openedSessionIds.filter((id) => !live.has(id));
}

/** The terminals to render, in the order their worktrees were first visited.
 * An id with no indexed worktree is dropped rather than rendered against a
 * guessed cwd. */
export function openTerminals(
  openedSessionIds: readonly string[],
  index: ReadonlyMap<string, IndexedWorktree>,
  worktreeRoot: string | null,
): TerminalSession[] {
  const sessions: TerminalSession[] = [];
  for (const sessionId of openedSessionIds) {
    const entry = index.get(sessionId);
    if (entry === undefined) continue;
    sessions.push({
      cwd:
        worktreeRoot === null
          ? null
          : worktreeCwd(entry.repo, entry.worktree, worktreeRoot),
      sessionId,
    });
  }
  return sessions;
}
