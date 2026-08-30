// **What the workspace knows, where a chat route can read it**
// (vingilot/docs/plans/2026-08-12-an-ide-of-a-kind.md, Task 2).
//
// ⌘K is one gesture everywhere now, and on a chat route the component that
// holds the projects, the worktrees and the file the viewer had open is *not
// mounted* — `RunsScreen` is the /workspace route's own lazy chunk. So the
// front door on a chat route would be channels and nothing else, which is the
// old split with the halves swapped.
//
// This module is the answer, and it is deliberately the small one: the
// workspace **publishes** a flat snapshot of the three lists it owns, and the
// shell's palette reads it. Nothing here polls, nothing here calls a backend,
// and nothing here is authoritative — the live lists are still `RunsScreen`'s,
// and on /workspace the palette reads those directly. This is a copy for the
// screens that cannot see them.
//
// **It is honest about being a copy.** The rows it produces are the projects
// the workspace last had, and selecting one lands on /workspace, where the live
// list is what actually opens (`workspaceLanding.ts`). A project removed while
// he was in a channel is therefore a row that navigates to a workspace that no
// longer has it — which resolves as "nothing selected", the same answer the
// deep-link door already gives, rather than as a wrong project opening.
//
// **Persisted, and that is the feature.** A cold start on a chat route has
// never mounted the workspace, and a ⌘K there answering "you have no projects"
// would be a false statement about the machine. `localStorage` is the same
// tolerance `paletteStore.ts` takes and for the same reason: the worst a bad
// value costs is a row that navigates somewhere and finds nothing.
//
// **No entry in `resetCommunityState()`, and the reason is the content.** That
// list exists for module-level caches holding *community-scoped* data
// (`useCommunityInit.ts`). Everything here is machine-scoped: a project is a
// directory on this disk, a worktree is a git checkout in it, a recent file is
// a path inside one. None of it changes meaning when the relay does, and
// `paletteStore.ts`'s recents are held on exactly the same footing.

/** A project, as a row needs it. */
export interface WorldProject {
  id: string;
  name: string;
  path: string;
}

/** A worktree, under the project that owns it. Since P1.1 (owner veto 4 — the
 * sidebar draws every project's worktree children under THAT project's row)
 * the snapshot carries **every** project's worktrees, not just the open
 * one's, and each row names its repo. */
export interface WorldWorktree {
  bindingId: string;
  /** The owning project's id — `Worktree.repo_id`, the coordinator's own
   * relation, copied so a chat-route surface can group children under their
   * repo row without re-deriving anything. */
  repoId: string;
  label: string;
  detail: string;
  /** git's read of the tree at publish time: `true` clean, `false` dirty,
   * `null` when git had not answered — never coerced. A copy like everything
   * else here: the live read is the workspace's. */
  clean: boolean | null;
}

/** A file the viewer has had open, most recent first. */
export interface WorldFile {
  worktree: string;
  path: string;
  line: number | null;
}

export interface PaletteWorld {
  projects: readonly WorldProject[];
  worktrees: readonly WorldWorktree[];
  recentFiles: readonly WorldFile[];
}

export const EMPTY_WORLD: PaletteWorld = {
  projects: [],
  recentFiles: [],
  worktrees: [],
};

/** How many files are remembered. The palette's own recents cap, for the same
 * argument: long enough to be the week's work, short enough that the empty
 * list is still a shortlist. */
export const MAX_RECENT_FILES = 8;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Versioned: a shape change gets a new key rather than a migration, so an
 * older build reading a newer snapshot finds nothing and starts empty instead
 * of half-understanding it. */
const WORLD_KEY = "vingilot-palette-world.v2";

const NO_STORAGE: StorageLike = { getItem: () => null, setItem: () => {} };

function defaultStorage(): StorageLike {
  return (
    (globalThis as { localStorage?: StorageLike }).localStorage ?? NO_STORAGE
  );
}

function stringOf(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/** Read a stored snapshot. Anything malformed reads as empty — never a throw,
 * because this runs during the render that puts the shell on screen. */
export function parseWorld(raw: string | null): PaletteWorld {
  if (raw === null || raw === "") return EMPTY_WORLD;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return EMPTY_WORLD;
  }
  if (typeof parsed !== "object" || parsed === null) return EMPTY_WORLD;
  const held = parsed as Record<string, unknown>;
  const projects: WorldProject[] = [];
  for (const entry of Array.isArray(held.projects) ? held.projects : []) {
    const row = entry as Record<string, unknown>;
    const id = stringOf(row?.id);
    const name = stringOf(row?.name);
    if (id === null || name === null) continue;
    projects.push({ id, name, path: stringOf(row?.path) ?? "" });
  }
  const worktrees: WorldWorktree[] = [];
  for (const entry of Array.isArray(held.worktrees) ? held.worktrees : []) {
    const row = entry as Record<string, unknown>;
    const bindingId = stringOf(row?.bindingId);
    const label = stringOf(row?.label);
    const repoId = stringOf(row?.repoId);
    // A row that names no repo cannot be drawn under one, and v2's key means
    // no stored snapshot legitimately lacks it — drop, don't guess.
    if (bindingId === null || label === null || repoId === null) continue;
    worktrees.push({
      bindingId,
      clean: typeof row?.clean === "boolean" ? row.clean : null,
      detail: stringOf(row?.detail) ?? "",
      label,
      repoId,
    });
  }
  const recentFiles: WorldFile[] = [];
  for (const entry of Array.isArray(held.recentFiles) ? held.recentFiles : []) {
    const row = entry as Record<string, unknown>;
    const worktree = stringOf(row?.worktree);
    const path = stringOf(row?.path);
    if (worktree === null || path === null) continue;
    const line =
      typeof row?.line === "number" && row.line > 0 ? row.line : null;
    recentFiles.push({ line, path, worktree });
  }
  return {
    projects,
    recentFiles: recentFiles.slice(0, MAX_RECENT_FILES),
    worktrees,
  };
}

/** The list with this file moved to the front, deduped by worktree + path and
 * capped. Pure, and it is where "most recent first, no duplicates" lives. */
export function withRecentFile(
  files: readonly WorldFile[],
  file: WorldFile,
): WorldFile[] {
  return [
    file,
    ...files.filter(
      (held) => held.worktree !== file.worktree || held.path !== file.path,
    ),
  ].slice(0, MAX_RECENT_FILES);
}

let world: PaletteWorld | null = null;
type Listener = (next: PaletteWorld) => void;
const listeners = new Set<Listener>();

export function readWorld(
  storage: StorageLike = defaultStorage(),
): PaletteWorld {
  if (world === null) world = parseWorld(storage.getItem(WORLD_KEY));
  return world;
}

function commit(next: PaletteWorld, storage: StorageLike): void {
  world = next;
  try {
    storage.setItem(WORLD_KEY, JSON.stringify(next));
  } catch {
    // Losing a snapshot costs the next cold start its project rows and nothing
    // else; failing the render that produced it is not survivable.
  }
  for (const listen of [...listeners]) {
    try {
      listen(next);
    } catch {
      // A subscriber's failure is not the publisher's.
    }
  }
}

/** The workspace's two lists. Called on every render of a screen that
 * re-renders on a 2s poll, so it returns without writing when nothing moved —
 * compared by content, since both arrays are rebuilt every render. */
export function publishPlaces(
  projects: readonly WorldProject[],
  worktrees: readonly WorldWorktree[],
  storage: StorageLike = defaultStorage(),
): void {
  const held = readWorld(storage);
  const next = { ...held, projects, worktrees };
  if (JSON.stringify(next) === JSON.stringify(held)) return;
  commit(next, storage);
}

/** One file the viewer opened. */
export function rememberFile(
  file: WorldFile,
  storage: StorageLike = defaultStorage(),
): void {
  const held = readWorld(storage);
  const recentFiles = withRecentFile(held.recentFiles, file);
  if (JSON.stringify(recentFiles) === JSON.stringify(held.recentFiles)) return;
  commit({ ...held, recentFiles }, storage);
}

export function subscribeWorld(listen: Listener): () => void {
  listeners.add(listen);
  return () => {
    listeners.delete(listen);
  };
}

/** Drop the in-memory copy and every subscriber. For tests. */
export function resetWorld(): void {
  world = null;
  listeners.clear();
}
