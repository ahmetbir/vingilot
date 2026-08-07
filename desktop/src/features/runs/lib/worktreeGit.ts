// What `git worktree list` says about a project, and how that meets the
// coordinator's own worktree read model in one column
// (vingilot/docs/plans/2026-08-07-workspace-v1.md, Task 6).
//
// **Two sources, and only one of them is authoritative about existence.** The
// coordinator knows the worktrees a Run provisioned, with the run status and
// diff evidence that make a row worth looking at. git knows every worktree
// that actually exists on disk — including the ones the owner made himself,
// which the coordinator has no row for and never will. So the coordinator's
// rows are kept as they are, and git's are folded in where they add something.
//
// Pure: no Tauri, no React, no coordinator client. `worktreeClient.ts` makes
// the calls, this module decides what the answers mean.

import {
  type GroupedWorktrees,
  localBindingId,
  localWorktreePath,
  type Repo,
  type Worktree,
  worktreeCwd,
} from "./projects.ts";
import { normalizeRepoPath } from "./repoChoice.ts";

/** The project a listing is made against: an id to file the answer under, and
 * a path to run git in. */
export interface ProjectRef {
  id: string;
  path: string;
}

/** The identity of the project set, as a string.
 *
 * `repos` is rebuilt from a polled workspace snapshot every couple of seconds,
 * so its array identity says nothing about whether the projects changed — and
 * an effect keyed on the array would run `git worktree list` per project every
 * poll forever. JSON rather than a delimiter, because a project path may
 * legally contain any character a delimiter could be. */
export function projectsKey(repos: readonly ProjectRef[]): string {
  return JSON.stringify(repos.map((repo) => [repo.id, repo.path]));
}

/** The projects back out of the key, so an effect can be a function of the
 * key alone rather than of an array it must not depend on. Tolerant like
 * every other read in this feature: a pair this build cannot make sense of is
 * dropped, and the worst case is a project that lists no worktrees. */
export function readProjectsKey(key: string): ProjectRef[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(key);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const projects: ProjectRef[] = [];
  for (const pair of parsed) {
    if (!Array.isArray(pair)) continue;
    const [id, path] = pair;
    if (typeof id === "string" && typeof path === "string") {
      projects.push({ id, path });
    }
  }
  return projects;
}

/** One record of `git worktree list --porcelain`, as
 * desktop/src-tauri/src/vingilot_worktree/porcelain.rs serialises it. */
export interface GitWorktree {
  path: string;
  /** Short branch name, or `null` when detached or bare. */
  branch: string | null;
  head: string | null;
  /** The repository's own working tree — git lists it first, and it is the
   * one worktree that can never be removed. */
  isMain: boolean;
  detached: boolean;
  locked: boolean;
  prunable: boolean;
}

function isGitWorktree(value: unknown): value is GitWorktree {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.path === "string" &&
    (typeof v.branch === "string" || v.branch === null) &&
    (typeof v.head === "string" || v.head === null) &&
    typeof v.isMain === "boolean" &&
    typeof v.detached === "boolean" &&
    typeof v.locked === "boolean" &&
    typeof v.prunable === "boolean"
  );
}

/** Tolerant read of what `worktree_list` answered — the same boundary
 * discipline `readRepos` keeps, for the same reason: a record this build
 * cannot read is dropped, never thrown on and never half-trusted into a row
 * that a terminal would then be opened against. */
export function readGitWorktrees(value: unknown): GitWorktree[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isGitWorktree);
}

/** A git worktree as a `Worktree` row, so the column, the ⌘1…9 map and the
 * terminal treat it like any other.
 *
 * Every coordinator-owned field is `null`: there is no run here, no objective,
 * no diff evidence. That is the honest shape — `worktreeSummary` renders a
 * null owner run as "clean", which is exactly what a worktree nobody is
 * running anything in is. */
export function localWorktreeRow(repo: Repo, gw: GitWorktree): Worktree {
  return {
    added: null,
    base_commit: gw.head ?? "",
    binding_id: localBindingId(gw.path),
    branch: gw.branch,
    commit_sha: null,
    lifecycle: gw.prunable ? "prunable" : "ready",
    owner_run_id: null,
    owner_run_objective: null,
    owner_run_status: null,
    removed: null,
    repo_id: repo.id,
    // `detached` rather than a branch name the row does not have: the label
    // falls back to the role (`worktreeSummary`), and "detached" is what the
    // owner would call it.
    role: gw.detached ? "detached" : "local",
  };
}

/** The coordinator's rows, plus every git worktree they do not already stand
 * for.
 *
 * Two kinds of duplicate are dropped, and nothing else is:
 *
 * - **git's main entry**, always. The repo's own checkout is already the
 *   synthetic `main:<repo id>` row at the head of the list, and it is the row
 *   every git command in this feature runs against.
 * - **a path a coordinator row already resolves to** (`worktreeCwd`), so a
 *   Run's worktree appears once, with its run status, rather than twice with
 *   half the information on the second copy.
 *
 * Appended rather than merged in place: the existing order backs the ⌘1…9
 * shortcuts, and a worktree appearing on disk must not renumber the keys
 * under the owner's fingers. */
export function withLocalWorktrees(
  repo: Repo,
  rows: readonly Worktree[],
  git: readonly GitWorktree[],
  worktreeRoot: string | null,
): Worktree[] {
  const covered = new Set<string>([normalizeRepoPath(repo.path)]);
  for (const row of rows) {
    const cwd =
      worktreeRoot === null ? null : worktreeCwd(repo, row, worktreeRoot);
    if (cwd !== null) covered.add(normalizeRepoPath(cwd));
  }

  const extra = git
    .filter((gw) => !gw.isMain && !covered.has(normalizeRepoPath(gw.path)))
    .map((gw) => localWorktreeRow(repo, gw));

  return [...rows, ...extra];
}

/** The open worktrees that no listing can currently speak for — the ones a
 * caller must treat as still live even though nothing in the index mentions
 * them.
 *
 * **"git could not read this project" and "this project has no worktrees" are
 * the same value and must not be the same conclusion.** A project on an
 * unmounted volume, or one whose `.git` a `git -C` cannot reach, answers
 * `NotARepo`; the workspace then sees an index with none of that project's
 * worktrees in it and reads the absence as "these have left, kill their
 * shells" (`terminalTabs.ts`'s `dropWorktrees`) — ending, with their tmux
 * sessions, shells the owner had running an hour ago.
 *
 * The only rows a git listing contributes are the `local:` ones, so while any
 * project is unreadable those are the rows nothing can adjudicate, and they
 * are held. Which project a `local:` id belongs to is deliberately not
 * guessed: a worktree does not have to live under the repository it belongs
 * to (ours live under `~/.vingilot/worktrees/`), so path containment would be
 * a guess, and the direction to be wrong in is "kept a shell alive one poll
 * too long", never "killed one". Coordinator-owned and main-checkout rows come
 * from elsewhere and stay adjudicable throughout. */
export function unlistedWorktrees(
  openBindingIds: readonly string[],
  unreadableRepoIds: readonly string[],
): string[] {
  if (unreadableRepoIds.length === 0) return [];
  return openBindingIds.filter((id) => localWorktreePath(id) !== null);
}

/** `groupWorktrees`' output with every project's git worktrees folded in.
 *
 * Every project, not only the one on screen. The workspace's terminal
 * bookkeeping treats "not in the index" as "this worktree has left, kill its
 * shells" (`terminalTabs.ts`'s `dropWorktrees`), so a listing that covered
 * only the selected project would end every other project's terminals the
 * moment the owner switched away — the exact bug that model exists to
 * prevent. */
export function withLocalGroups(
  repos: readonly Repo[],
  grouped: GroupedWorktrees,
  byRepo: Readonly<Record<string, readonly GitWorktree[]>>,
  worktreeRoot: string | null,
): GroupedWorktrees {
  const merged: Record<string, Worktree[]> = {};
  for (const repo of repos) {
    merged[repo.id] = withLocalWorktrees(
      repo,
      grouped.byRepo[repo.id] ?? [],
      byRepo[repo.id] ?? [],
      worktreeRoot,
    );
  }
  return { byRepo: merged, unknown: grouped.unknown };
}
