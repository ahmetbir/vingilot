// What `vingilot <path>` from a terminal means to this workspace
// (vingilot/docs/plans/2026-08-12-an-ide-of-a-kind.md, Task 1 — the door in).
//
// The Rust half (`vingilot_shim`) has already done the part that needs a
// filesystem: the path is absolute, canonical, and known to exist, and a
// `:line` suffix has been split off or refused. What is left is the part that
// needs the *workspace* — which of the owner's projects and worktrees this path
// is inside — and that is here, pure, so every branch has a test and none of
// them needs a running app.
//
// **Deepest place wins, and that is the whole ranking.** A local worktree lives
// under its project's directory often enough (`.vingilot/worktrees` is beside
// the repo, but a `git worktree add ./wt-x` is *inside* it) that the containing
// project would otherwise swallow every path in it. The longest matching prefix
// is the most specific true statement about where the file is, and it is the
// one the owner meant: he ran the command standing in that checkout.
//
// **A prefix is a directory boundary, never a string prefix.** `/w/repo` is not
// a parent of `/w/repohaus`, and a resolver that thought so would land a file
// in a worktree it has nothing to do with — the same class of error
// `filesTarget.shouldLand` exists to prevent between two checkouts of one
// project.
//
// **Unknown is an answer with a next action.** A path in no project at all is
// not a failure: it is the add-project flow, pre-filled with the directory,
// which is exactly what the owner is asking for by running the command there.
// The one thing it must not do is guess a project to put it in.

/** One place the workspace can land on: a project, or one of its worktrees.
 *
 * Built by the host from `repos`, the worktrees it holds and `worktreeCwd` —
 * this module never derives a path, so there is one derivation of "where is
 * this worktree" in the app and this is a consumer of it rather than a second
 * copy. */
export interface KnownPlace {
  repoId: string;
  /** The worktree's binding id, or `null` for the project itself.
   *
   * The project row exists as a place of its own because the app may hold no
   * worktree list for a project that is not the selected one — and "I know this
   * project, I have not listed its checkouts yet" must still land somewhere
   * better than the add-project dialog. */
  bindingId: string | null;
  /** Absolute, and the same string `PaneProps.cwd` carries. */
  path: string;
}

/** What the shim asked for, after `vingilot_shim::resolve_open`. Mirrors
 * `OpenRequest`'s serialisation exactly — one shape crossing the bridge. */
export interface OpenRequest {
  path: string;
  line: number | null;
  directory: boolean;
}

/** Where the workspace should go.
 *
 * `file` carries `bindingId` even though the viewer only needs `worktree`,
 * because landing a file means *selecting* the checkout it is in first: the
 * Files pane is mounted per worktree, and a request for a file of a worktree
 * that is not on screen would be dropped by `shouldLand` — correctly, and
 * silently, which is the failure this field exists to prevent. */
export type OpenResolution =
  | {
      type: "file";
      repoId: string;
      bindingId: string | null;
      /** The checkout's own directory — `FileTarget.worktree`. */
      worktree: string;
      /** Worktree-relative, as `file_read` takes it. */
      path: string;
      line: number | null;
    }
  | { type: "worktree"; repoId: string; bindingId: string }
  | { type: "project"; repoId: string }
  | {
      type: "unknown";
      /** The directory to pre-fill the add-project flow with: the directory
       * itself, or a named file's parent. Never the file — nothing adds a file
       * as a project, and handing the dialog one would make the owner delete
       * the last path segment by hand every time. */
      directory: string;
    };

/** The parent directory of an absolute path, or the path itself at the root. */
function parentOf(path: string): string {
  const cut = path.lastIndexOf("/");
  if (cut <= 0) return "/";
  return path.slice(0, cut);
}

/** Trailing slashes off, so `/w/repo/` and `/w/repo` are one place. `/` keeps
 * its slash: it is the only path that is entirely one. */
function normalise(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

/** Is `path` inside `root`, or `root` itself? Directory-boundary aware — see
 * the header. */
export function within(root: string, path: string): boolean {
  const base = normalise(root);
  const target = normalise(path);
  if (target === base) return true;
  return target.startsWith(base === "/" ? "/" : `${base}/`);
}

/** The most specific place containing `path`, or `null`.
 *
 * Ties — two places at one path, which is what a project and its primary
 * checkout are — go to the one that names a worktree: it is the more specific
 * true statement, and it is the one that puts a Files pane on screen. */
export function deepestPlace(
  places: readonly KnownPlace[],
  path: string,
): KnownPlace | null {
  let best: KnownPlace | null = null;
  for (const place of places) {
    if (!within(place.path, path)) continue;
    if (best === null) {
      best = place;
      continue;
    }
    const longer = normalise(place.path).length - normalise(best.path).length;
    if (longer > 0) {
      best = place;
      continue;
    }
    if (longer === 0 && best.bindingId === null && place.bindingId !== null) {
      best = place;
    }
  }
  return best;
}

/** `path` relative to `root`, for a path already known to be within it. */
function relativeTo(root: string, path: string): string {
  const base = normalise(root);
  if (base === "/") return normalise(path).slice(1);
  return normalise(path).slice(base.length + 1);
}

/** Where `request` should land, given what the workspace knows.
 *
 * **A directory that is not itself a known place lands on the place around
 * it.** `vingilot .` two levels down in a checkout is still "show me this
 * checkout" — there is no pane for a subdirectory, and refusing would make the
 * command work only from a repository root, which is not where anybody stands
 * when they type it. */
export function resolveOpen(
  request: OpenRequest,
  places: readonly KnownPlace[],
): OpenResolution {
  const place = deepestPlace(places, request.path);
  if (place === null) {
    return {
      directory: request.directory
        ? normalise(request.path)
        : parentOf(normalise(request.path)),
      type: "unknown",
    };
  }
  if (!request.directory) {
    return {
      bindingId: place.bindingId,
      line: request.line,
      path: relativeTo(place.path, request.path),
      repoId: place.repoId,
      type: "file",
      worktree: normalise(place.path),
    };
  }
  if (place.bindingId === null) {
    return { repoId: place.repoId, type: "project" };
  }
  return { bindingId: place.bindingId, repoId: place.repoId, type: "worktree" };
}

/** The sentence for a path this workspace has no project for. Words rather than
 * a silent dialog, because the dialog it opens is about a *different* thing
 * (adding a project) and the owner asked to see a file. */
export function unknownPlaceSentence(directory: string): string {
  return `${directory} is not inside a project this workspace knows. Add it as a project and the file opens here.`;
}
