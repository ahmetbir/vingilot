// The three `vingilot_worktree` commands the History pane reads through
// (desktop/src-tauri/src/vingilot_worktree/{log,commit_patch,status}.rs).
// No logic lives here: `historyModel.ts` decides what an answer means and what a
// refusal says, and it is tested without a backend.
//
// **Three commands, and all three are reads.** `worktree_log`, `commit_diff`,
// `worktree_status` — that is the complete list this module can name, and the
// backend modules behind them each carry a test that fails a future edit
// reaching for a write verb. There is deliberately no fourth function here for
// staging, committing or discarding: Task 4 drew the line at reading, and a
// client function is where crossing it would start.
//
// **The patch of a source-control file comes from `worktree_diff`**, which is
// this island's existing read and is already the Diff pane's — see
// `historyModel.ts`'s `statusPatch` for what that patch therefore IS (staged and
// unstaged together, against HEAD) and why it is not a fourth command.
//
// Every call answers rather than throws. A refusal is an ordinary outcome —
// a worktree whose checkout has gone, a cursor naming no commit — so it is a
// value the pane renders, never an exception something has to remember to catch.
// The same shape `worktreeClient.ts` and `filesClient.ts` use, for the same
// reason.

import { invoke } from "@tauri-apps/api/core";

import {
  type CommitPatch,
  type LogPage,
  readCommitPatch,
  readLogPage,
  readWorktreeStatus,
  type WorktreeStatus,
} from "@/features/runs/lib/historyModel";
import { readWorktreeDiff } from "@/features/runs/lib/worktreeDiff";
import {
  readWorktreeError,
  type WorktreeError,
} from "@/features/runs/lib/worktreePlan";

export type HistoryResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: WorktreeError };

/** Whatever came back from a rejected `invoke`, as a refusal. A shape this
 * build cannot read still has to reach the owner as words, so it is reported as
 * what it is — git, or the bridge to it, failing in a way this client has no
 * name for. */
function asError(thrown: unknown): WorktreeError {
  return (
    readWorktreeError(thrown) ?? {
      command: "git",
      kind: "git-failed",
      stderr: String(thrown),
    }
  );
}

/** An answer this build could not read at all, as a refusal rather than as an
 * empty one. **The rule the whole island keeps**: an empty read is "no answer",
 * never "nothing there" — a `null` from a reader turned into an empty page would
 * tell the owner his repository has no history. */
function unreadable(command: string): WorktreeError {
  return {
    command,
    kind: "git-failed",
    stderr: `${command} answered in a shape this build cannot read.`,
  };
}

/** One page of history, newest first. `before` is the hash of the last commit
 * already shown; omit it for the first page. */
export async function readHistory(
  worktree: string,
  before: string | null,
): Promise<HistoryResult<LogPage>> {
  try {
    const answered = await invoke<unknown>("worktree_log", {
      // Omitted rather than sent as `null` for the first page: the command's
      // parameter is an `Option<String>`, and "no cursor" is the absence of one.
      ...(before === null ? {} : { before }),
      path: worktree,
    });
    const page = readLogPage(answered);
    if (page === null) return { error: unreadable("worktree_log"), ok: false };
    return { ok: true, value: page };
  } catch (thrown) {
    return { error: asError(thrown), ok: false };
  }
}

/** One commit's patch, in the same `WorktreeDiff` shape the Diff pane renders. */
export async function readCommitDiff(
  worktree: string,
  commit: string,
): Promise<HistoryResult<CommitPatch>> {
  try {
    const answered = await invoke<unknown>("commit_diff", {
      commit,
      path: worktree,
    });
    const patch = readCommitPatch(answered, readWorktreeDiff);
    if (patch === null) return { error: unreadable("commit_diff"), ok: false };
    return { ok: true, value: patch };
  } catch (thrown) {
    return { error: asError(thrown), ok: false };
  }
}

/** What is staged, what is not, what is untracked, what is conflicted. */
export async function readStatus(
  worktree: string,
): Promise<HistoryResult<WorktreeStatus>> {
  try {
    const answered = await invoke<unknown>("worktree_status", {
      path: worktree,
    });
    const status = readWorktreeStatus(answered);
    if (status === null) {
      return { error: unreadable("worktree_status"), ok: false };
    }
    return { ok: true, value: status };
  } catch (thrown) {
    return { error: asError(thrown), ok: false };
  }
}
