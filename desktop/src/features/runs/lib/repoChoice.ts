// Turning a directory the owner picked into a project, or into a refusal
// they can act on (vingilot/docs/plans/2026-08-07-workspace-v1.md, Task 4).
//
// Pure: no coordinator client, no Tauri, no React. `repoClient.ts` gets the
// path and the probe, this module decides what they mean, and
// `localProjects.ts` writes the result into this machine's own list. Splitting it that way is what lets every refusal below
// be a test rather than a thing you have to click through.
//
// **Every refusal names the next action.** A wrong folder is the ordinary
// case here — the owner reaches for a subdirectory, or the bare mirror they
// push to — and "not a git repository" tells them nothing they did not
// already suspect. What they need is which folder to pick instead, which is
// why the probe distinguishes three shapes (vingilot_repo/mod.rs) rather than
// answering yes/no.

import type { Repo } from "./projects.ts";

/** What `repo_probe` said about the directory
 * (desktop/src-tauri/src/vingilot_repo/mod.rs). */
export type RepoProbe =
  | { kind: "repository" }
  | { kind: "worktree" }
  | { kind: "bare" }
  | { kind: "not-a-repo"; root: string | null };

/** Tolerant read of a probe that arrived over IPC, `null` for anything this
 * client does not recognise — the same boundary discipline `readRepos` keeps
 * (projects.ts), for the same reason: a shape we cannot read is a refusal to
 * report, never a throw and never a guess at which of four answers it was. */
export function readRepoProbe(value: unknown): RepoProbe | null {
  if (typeof value !== "object" || value === null) return null;
  const kind = (value as Record<string, unknown>).kind;
  if (kind === "repository" || kind === "worktree" || kind === "bare") {
    return { kind };
  }
  if (kind !== "not-a-repo") return null;
  const root = (value as Record<string, unknown>).root;
  return { kind: "not-a-repo", root: typeof root === "string" ? root : null };
}

export type RepoChoice =
  | { ok: true; repo: Repo }
  | { ok: false; reason: string };

/** Trailing separators removed, so `/repo` and `/repo/` are one path and
 * therefore one project. The lone root keeps its slash — it is the path, not
 * a separator on the end of one. Nothing else is rewritten: two genuinely
 * different paths to one directory (a symlink, a case-insensitive volume)
 * stay two projects, because the owner picked them and this module cannot
 * resolve either question without touching the disk it deliberately does
 * not. */
export function normalizeRepoPath(path: string): string {
  let end = path.length;
  while (end > 1 && path[end - 1] === "/") end -= 1;
  return path.slice(0, end);
}

function lastSegment(path: string): string {
  const at = path.lastIndexOf("/");
  return at === -1 ? path : path.slice(at + 1);
}

/** A path's last segment reduced to `[a-z0-9-]`. The id ends up inside a
 * binding id (`main:<id>`), inside a PTY session id, and — escaped — inside a
 * tmux session name, so keeping it to an alphabet everything downstream
 * already handles verbatim costs nothing and removes a whole class of
 * question. `"repo"` when a path has no usable segment at all (`/`), which
 * `uniqueRepoId` then makes distinct. */
export function repoIdFor(path: string): string {
  const slug = lastSegment(normalizeRepoPath(path))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug === "" ? "repo" : slug;
}

/** The first id in `<base>`, `<base>-2`, `<base>-3`… that no existing repo
 * holds. Two checkouts of one project (`~/work/buzz` and `~/review/buzz`) are
 * two projects with one derived id, and the second must not silently take
 * over the first's worktrees, terminals, or tabs. */
function uniqueRepoId(base: string, existing: readonly Repo[]): string {
  const taken = new Set(existing.map((repo) => repo.id));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

/** The display name: the directory's own name, as the owner sees it in
 * Finder. Unlike the id this is not reduced to an alphabet — nothing keys off
 * it, and "My Notes" should read as "My Notes". */
export function repoNameFor(path: string): string {
  const segment = lastSegment(normalizeRepoPath(path));
  return segment === "" ? normalizeRepoPath(path) : segment;
}

/** Decide whether a picked directory becomes a project.
 *
 * Duplicates are checked before the probe: a path already added was validated
 * when it was, and "you already have this" is the more useful answer than
 * anything about its git layout. */
export function chooseRepo(
  path: string,
  probe: RepoProbe,
  existing: readonly Repo[],
): RepoChoice {
  const normalized = normalizeRepoPath(path);

  const already = existing.find(
    (repo) => normalizeRepoPath(repo.path) === normalized,
  );
  if (already !== undefined) {
    return {
      ok: false,
      reason: `already a project — "${already.name}" is this same folder.`,
    };
  }

  if (probe.kind === "bare") {
    return {
      ok: false,
      reason:
        `${normalized} is a bare repository. It has no working tree, ` +
        "so there is no checkout to open a shell in and nothing to diff. " +
        "Pick a clone of it instead.",
    };
  }

  if (probe.kind === "not-a-repo") {
    return {
      ok: false,
      reason:
        probe.root === null
          ? `no .git here — ${normalized} is not a git repository.`
          : `no .git here — that folder is inside ${probe.root}. Pick ${probe.root} itself.`,
    };
  }

  // A linked worktree is accepted like any ordinary checkout: it has a
  // working tree with a branch checked out, which is everything a project
  // needs here. Its git directory living inside another repository is not
  // this app's concern — `git worktree add` from inside one adds to that same
  // repository, which is the behaviour the owner would expect anyway.
  return {
    ok: true,
    repo: {
      id: uniqueRepoId(repoIdFor(normalized), existing),
      name: repoNameFor(normalized),
      path: normalized,
    },
  };
}

/** The confirm shown before a project leaves the workspace.
 *
 * The copy is here, and tested, because it is a promise about the owner's
 * disk rather than decoration: removing a project **forgets a path**. There
 * is no code path in this feature that deletes, moves, or writes anything
 * inside a project directory, and the sentence the owner reads before
 * confirming has to be the one that is true. */
export interface RemoveProjectConfirm {
  title: string;
  body: string;
  confirmLabel: string;
}

export function removeProjectConfirm(repo: Repo): RemoveProjectConfirm {
  return {
    title: `Remove ${repo.name} from this workspace?`,
    body:
      "Removing a project forgets the path. It never touches the directory " +
      `on disk: ${repo.path} and everything in it stay exactly where they ` +
      "are. Add it again whenever you want it back.",
    confirmLabel: "Forget path",
  };
}
