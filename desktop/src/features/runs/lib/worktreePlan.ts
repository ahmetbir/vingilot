// Opening and closing a worktree, as decisions rather than clicks
// (vingilot/docs/plans/2026-08-07-workspace-v1.md, Task 6): where a new
// worktree lands, what may be removed, and what every refusal says.
//
// **Removing is the dangerous direction, so the model is what stops it.**
// `removableWorktree` is the only way to obtain the argument
// `worktreeClient.ts`'s remove takes, and it answers `null` for the repo's own
// checkout. A UI that forgot to hide the button, or a keyboard path added
// later, cannot construct the value — the repository is not removable in the
// type system, not merely absent from a render. (The Rust side refuses it
// again, before git is asked, because a rule worth having is worth having on
// both sides of the IPC.)
//
// **Nothing here deletes anything.** `git worktree remove` removes the
// worktree directory it created, and refuses outright when there is
// uncommitted work in it. That refusal is surfaced with the dirty paths
// listed and the operation abandoned. `--force` is never sent, from anywhere.

import {
  isMainCheckout,
  type Repo,
  type Worktree,
  worktreeCwd,
} from "./projects.ts";

/** Why git did not do the thing — the wire shape of `WorktreeError`
 * (desktop/src-tauri/src/vingilot_worktree/mod.rs). */
export type WorktreeError =
  | { kind: "git-missing" }
  | { kind: "not-a-repo"; path: string }
  | { kind: "invalid-branch"; branch: string }
  | { kind: "branch-exists"; branch: string }
  | { kind: "path-exists"; path: string }
  | { kind: "unknown-base"; base: string }
  | { kind: "dirty"; path: string; entries: string[]; total: number }
  | { kind: "main-worktree"; path: string }
  | { kind: "not-a-worktree"; path: string }
  | { kind: "git-failed"; command: string; stderr: string };

function str(v: Record<string, unknown>, key: string): string {
  const value = v[key];
  return typeof value === "string" ? value : "";
}

/** Tolerant read of a refusal that arrived over IPC. `null` for a shape this
 * build does not know — the caller then says so in its own words rather than
 * rendering a guess at which refusal it was. */
export function readWorktreeError(value: unknown): WorktreeError | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  switch (v.kind) {
    case "git-missing":
      return { kind: "git-missing" };
    case "not-a-repo":
      return { kind: "not-a-repo", path: str(v, "path") };
    case "invalid-branch":
      return { kind: "invalid-branch", branch: str(v, "branch") };
    case "branch-exists":
      return { kind: "branch-exists", branch: str(v, "branch") };
    case "path-exists":
      return { kind: "path-exists", path: str(v, "path") };
    case "unknown-base":
      return { kind: "unknown-base", base: str(v, "base") };
    case "main-worktree":
      return { kind: "main-worktree", path: str(v, "path") };
    case "not-a-worktree":
      return { kind: "not-a-worktree", path: str(v, "path") };
    case "git-failed":
      return {
        command: str(v, "command"),
        kind: "git-failed",
        stderr: str(v, "stderr"),
      };
    case "dirty": {
      const raw = v.entries;
      const entries = Array.isArray(raw)
        ? raw.filter((line): line is string => typeof line === "string")
        : [];
      return {
        entries,
        kind: "dirty",
        path: str(v, "path"),
        total: typeof v.total === "number" ? v.total : entries.length,
      };
    }
    default:
      return null;
  }
}

/** A refusal in words the owner can act on, plus the paths behind it.
 *
 * `entries` is separate from `message` because the dirty case is the one that
 * matters: "it refused" is useless, "these four files have changes you have
 * not committed" is the whole answer. */
export interface WorktreeRefusal {
  message: string;
  entries: string[];
}

export function explainWorktreeError(error: WorktreeError): WorktreeRefusal {
  switch (error.kind) {
    case "git-missing":
      return {
        entries: [],
        message: "no git on this machine that answers `git --version`.",
      };
    case "not-a-repo":
      return {
        entries: [],
        message: `${error.path} is not a git repository any more — nothing was changed.`,
      };
    case "invalid-branch":
      return {
        entries: [],
        message: `git will not accept "${error.branch}" as a branch name.`,
      };
    case "branch-exists":
      return {
        entries: [],
        message: `the branch "${error.branch}" already exists. Pick another name — nothing was changed.`,
      };
    case "path-exists":
      return {
        entries: [error.path],
        message:
          "something is already at the path this worktree would use. It was left " +
          "exactly as it is; move it yourself, or use a different branch name.",
      };
    case "unknown-base":
      return {
        entries: [],
        message: `"${error.base}" names no commit in this repository.`,
      };
    case "dirty": {
      const hidden = error.total - error.entries.length;
      return {
        entries: error.entries,
        message:
          `${error.path} has ${error.total} uncommitted change` +
          `${error.total === 1 ? "" : "s"}, so it was NOT removed` +
          `${hidden > 0 ? ` (${hidden} more not listed)` : ""}. ` +
          "Commit or stash them first — nothing here will remove them for you.",
      };
    }
    case "main-worktree":
      return {
        entries: [],
        message:
          `${error.path} is the project's own checkout, not a worktree of it. ` +
          "Remove the project from the sidebar instead — that forgets the path " +
          "and touches nothing on disk.",
      };
    case "not-a-worktree":
      return {
        entries: [],
        message: `git does not know ${error.path} as a worktree of this project.`,
      };
    case "git-failed":
      return {
        entries: [],
        message: `${error.command} refused: ${error.stderr.trim()}`,
      };
  }
}

/** A branch name reduced to one path segment.
 *
 * `feature/x` becomes `feature-x` rather than a nested directory: a worktree
 * root full of one-deep directories is one `git worktree list` away from being
 * understood, and removing a nested one would leave empty parents behind that
 * nothing in this feature is allowed to clean up. */
export function branchSlug(branch: string): string {
  const slug = branch
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[-._]+/, "")
    .replace(/[-._]+$/, "");
  return slug === "" ? "worktree" : slug;
}

/** Where a new worktree lands: `<worktree root>/<project id>/<branch slug>`.
 *
 * The root is the one the executor already uses
 * (`DEFAULT_WORKTREE_ROOT_SUFFIX`, `~/.vingilot/worktrees`), so everything
 * this app checks out lives under one directory the owner can find, back up,
 * or delete himself in a shell. The **project id** level is new and is what
 * keeps two projects' identically-named branches apart — the executor's own
 * `<root>/<run id>` layout gets away without it only because a run id is a
 * UUID. */
export function worktreePathFor(
  worktreeRoot: string,
  repo: Repo,
  branch: string,
): string {
  const root = worktreeRoot.endsWith("/")
    ? worktreeRoot.slice(0, -1)
    : worktreeRoot;
  return `${root}/${repo.id}/${branchSlug(branch)}`;
}

/** What `worktree_add` is called with. */
export interface WorktreePlan {
  repoPath: string;
  branch: string;
  base: string;
  path: string;
}

export type WorktreePlanResult =
  | { ok: true; plan: WorktreePlan }
  | { ok: false; reason: string };

/** Turn the two fields the owner filled in into a call, or into a refusal.
 *
 * Only the questions that can be answered without touching the disk are
 * answered here: is there a branch name, a base, and a place to put it.
 * Whether the branch name is *legal*, whether the base resolves, and whether
 * the path is free are git's answers (`vingilot_worktree/mod.rs` asks
 * `check-ref-format` and `rev-parse` rather than guessing), because a second
 * copy of git's rules in this file would eventually disagree with git. */
export function planWorktree(input: {
  repo: Repo;
  branch: string;
  base: string;
  worktreeRoot: string | null;
}): WorktreePlanResult {
  const branch = input.branch.trim();
  const base = input.base.trim();

  if (branch === "") {
    return { ok: false, reason: "name the branch this worktree checks out." };
  }
  if (base === "") {
    return {
      ok: false,
      reason: "name a base to branch from — HEAD is the usual answer.",
    };
  }
  if (input.worktreeRoot === null) {
    return {
      ok: false,
      reason:
        "this app cannot work out where worktrees go on this machine yet — " +
        "it needs the desktop shell for that.",
    };
  }

  return {
    ok: true,
    plan: {
      base,
      branch,
      path: worktreePathFor(input.worktreeRoot, input.repo, branch),
      repoPath: input.repo.path,
    },
  };
}

declare const removableWorktreeBrand: unique symbol;

/** A worktree that may be removed — obtainable only from
 * `removableWorktree`, which is what makes "the repo's own checkout is not
 * removable" a fact about the model rather than a fact about one component's
 * render. */
export interface RemovableWorktree {
  readonly [removableWorktreeBrand]: true;
  readonly bindingId: string;
  /** Absolute path of the worktree, which is how git names one. */
  readonly path: string;
  /** What the row is called on screen, for the confirm. */
  readonly label: string;
}

/** The removable form of a worktree, or `null`.
 *
 * `null` for exactly two rows, and they are the same refusal wearing two
 * hats: the synthetic main-checkout row **is** the repository (there is no
 * `git worktree remove` that could apply to it), and a row whose path cannot
 * be derived is one this app does not know the location of — asking git to
 * remove a path it guessed at is the one mistake that could cost the owner
 * something. */
export function removableWorktree(
  repo: Repo,
  wt: Worktree,
  worktreeRoot: string | null,
): RemovableWorktree | null {
  if (isMainCheckout(wt)) return null;
  if (worktreeRoot === null) return null;
  const path = worktreeCwd(repo, wt, worktreeRoot);
  if (path === null) return null;
  const label = wt.branch ?? wt.role;
  return { bindingId: wt.binding_id, label, path } as RemovableWorktree;
}

/** The confirm shown before a worktree is closed.
 *
 * The copy is tested because it is a promise about the owner's disk. Two
 * things it must say and keep saying: the branch survives (this removes a
 * working tree, not history), and uncommitted work is a refusal rather than a
 * casualty. */
export interface RemoveWorktreeConfirm {
  title: string;
  body: string;
  confirmLabel: string;
}

export function removeWorktreeConfirm(
  target: RemovableWorktree,
): RemoveWorktreeConfirm {
  return {
    body:
      `git removes the working tree at ${target.path}. The branch and every ` +
      "commit on it stay in the repository — this closes a checkout, it does " +
      "not delete work. If anything there is uncommitted, git refuses and " +
      "nothing is removed; that refusal is never overridden.",
    confirmLabel: "Remove worktree",
    title: `Remove the worktree for ${target.label}?`,
  };
}
