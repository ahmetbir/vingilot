// The `vingilot_worktree` Tauri commands
// (desktop/src-tauri/src/vingilot_worktree/). No logic lives here:
// `worktreeGit.ts` decides what a listing means, `worktreePlan.ts` decides
// what a refusal says, `worktreeDiff.ts` decides what a diff shows, and all
// three are tested without a backend.
//
// Every call answers rather than throws. A refusal is the ordinary outcome of
// two of these three commands — a dirty worktree, a branch name already taken
// — so it is a value the caller renders, never an exception something has to
// remember to catch.

import { invoke } from "@tauri-apps/api/core";

import {
  readWorktreeDiff,
  type WorktreeDiff,
} from "@/features/runs/lib/worktreeDiff";
import {
  type GitWorktree,
  readGitWorktrees,
} from "@/features/runs/lib/worktreeGit";
import {
  readWorktreeError,
  type RemovableWorktree,
  type WorktreeError,
  type WorktreePlan,
} from "@/features/runs/lib/worktreePlan";

export type WorktreeResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: WorktreeError };

/** Whatever came back from a rejected `invoke`, as a refusal. A shape this
 * build cannot read still has to reach the owner as words, so it is reported
 * as what it is — git, or the bridge to it, failing in a way this client has
 * no name for. */
function asError(thrown: unknown): WorktreeError {
  return (
    readWorktreeError(thrown) ?? {
      command: "git",
      kind: "git-failed",
      stderr: String(thrown),
    }
  );
}

export async function gitWorktrees(
  repoPath: string,
): Promise<WorktreeResult<GitWorktree[]>> {
  try {
    const listed = await invoke<unknown>("worktree_list", { repo: repoPath });
    return { ok: true, value: readGitWorktrees(listed) };
  } catch (thrown) {
    return { error: asError(thrown), ok: false };
  }
}

export async function gitWorktreeAdd(
  plan: WorktreePlan,
): Promise<WorktreeResult<GitWorktree[]>> {
  try {
    await invoke<unknown>("worktree_add", {
      base: plan.base,
      branch: plan.branch,
      path: plan.path,
      repo: plan.repoPath,
    });
  } catch (thrown) {
    return { error: asError(thrown), ok: false };
  }
  // The fresh listing rather than the one record git just made: the column
  // renders the whole list, and a second call here is cheaper than a merge
  // rule that has to be right about ordering.
  return gitWorktrees(plan.repoPath);
}

/** One worktree's changes against `base`, working tree included.
 *
 * `path` is the worktree's own directory rather than the project's: a linked
 * worktree has its own working files and its own HEAD, and that directory is
 * what git has to be asked in.
 *
 * A shape this build cannot read comes back as a refusal rather than as an
 * empty diff — "no changes" is a claim about the owner's work, and this is not
 * a place to make it on a guess. */
export async function gitWorktreeDiff(
  path: string,
  base: string,
): Promise<WorktreeResult<WorktreeDiff>> {
  try {
    const answered = await invoke<unknown>("worktree_diff", { base, path });
    const diff = readWorktreeDiff(answered);
    if (diff === null) {
      return {
        error: {
          command: "git diff",
          kind: "git-failed",
          stderr: "the diff came back in a shape this build cannot read.",
        },
        ok: false,
      };
    }
    return { ok: true, value: diff };
  } catch (thrown) {
    return { error: asError(thrown), ok: false };
  }
}

/** `target` is a `RemovableWorktree`, which cannot be constructed for the
 * project's own checkout (`worktreePlan.ts`). That is the point: there is no
 * call site anywhere that can ask this to remove a repository.
 *
 * No force flag is passed, here or in Rust. A worktree with uncommitted work
 * in it comes back as a `dirty` refusal listing what is in the way. */
export async function gitWorktreeRemove(
  repoPath: string,
  target: RemovableWorktree,
): Promise<WorktreeResult<GitWorktree[]>> {
  try {
    await invoke<unknown>("worktree_remove", {
      path: target.path,
      repo: repoPath,
    });
  } catch (thrown) {
    return { error: asError(thrown), ok: false };
  }
  return gitWorktrees(repoPath);
}
