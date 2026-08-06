// Resolving the workspace's open terminal tabs to the pair a `<Terminal>` is
// rendered from: a PTY session id, and where its shell starts.
//
// Which tabs are open is `terminalTabs.ts`'s model; which of them the owner
// has really closed is that module's too. What lives here is the half that
// needs to know about repos and checkouts — a worktree binding id means
// nothing to a shell until it has been resolved back to a directory on this
// machine, and this is the only module that knows how.
//
// The distinction both modules exist to draw: a terminal that is merely
// hidden — a different worktree selected, a different tab, a different
// project — keeps its shell. Only a tab the owner closed, or a worktree that
// has left the workspace entirely, is "really closed". React unmounting a
// `<Terminal>` is neither, and must never be mistaken for either, which is why
// the decision lives in a pure model rather than in a component's cleanup
// function.

import type { GroupedWorktrees, Repo, Worktree } from "./projects.ts";
import { worktreeCwd } from "./projects.ts";
import {
  layoutSessions,
  sessionIdFor,
  type TabLayout,
} from "./terminalTabs.ts";

/** One worktree, resolved back to the repo that owns it — the pair a
 * terminal needs before it can derive a cwd. */
export interface IndexedWorktree {
  repo: Repo;
  worktree: Worktree;
}

/** What `<Terminal>` is rendered from: the PTY session id (`<binding id>#<tab
 * ordinal>`) and where its shell starts. `cwd: null` is the honest "not
 * derivable yet" — the terminal shows a waiting state instead of opening a
 * session somewhere arbitrary.
 *
 * The binding id and ordinal travel alongside the id they compose so the work
 * surface can tell which strip a terminal belongs to and which of them is
 * showing, without parsing the id back apart. */
export interface TerminalSession {
  sessionId: string;
  bindingId: string;
  n: number;
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

/** The terminals to render — every open tab of every open worktree, each tab
 * of one worktree in its strip's order.
 *
 * Every tab of a worktree starts in the same directory, because a worktree is
 * one checkout: the tabs are concurrent shells against it, not different
 * places. A tab whose worktree is not indexed is dropped rather than rendered
 * against a guessed cwd. */
export function openTerminals(
  layout: TabLayout,
  index: ReadonlyMap<string, IndexedWorktree>,
  worktreeRoot: string | null,
): TerminalSession[] {
  const sessions: TerminalSession[] = [];
  for (const { bindingId, n } of layoutSessions(layout)) {
    const entry = index.get(bindingId);
    if (entry === undefined) continue;
    sessions.push({
      bindingId,
      cwd:
        worktreeRoot === null
          ? null
          : worktreeCwd(entry.repo, entry.worktree, worktreeRoot),
      n,
      sessionId: sessionIdFor(bindingId, n),
    });
  }
  return sessions;
}
