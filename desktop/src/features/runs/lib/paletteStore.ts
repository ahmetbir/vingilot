// What "recent" means for the palette, and where it lives between app runs.
//
// **A recent is a candidate the owner ran *from the palette*, most recent
// first.** Not "a project you visited", not "a worktree you looked at": those
// would have to be instrumented at every navigation path in the workspace, and
// they would fill the empty palette with the things the owner just did by
// other means — which is the list he already knows. What running from here
// records is the one signal this surface owns and can state honestly: *these
// are the answers this palette gave you, and they were the right ones.*
//
// A blocked row records nothing, because nothing ran.
//
// The id is `Candidate.id`, which is derived from what a row *is* (a repo id, a
// binding id, a pane id, an action's name) rather than from where it sat, so a
// recorded recent still finds its row after the list around it has changed.
// One that no longer matches anything is not pruned on write — a project can
// come back, and forgetting it the first time its repo is off a mounted volume
// would be an empty read taken for a deletion. `assembleView` simply skips it.
//
// Storage is `localStorage`, injectable so a plain `node --test` (no DOM) can
// pass an in-memory shim — the same arrangement `paneStore.ts` and
// `terminalTabStore.ts` use, and tolerant for the same reason: the worst a
// wrong value costs is the order of a list, and an owner whose recents quietly
// vanish has no way to find out why.

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Versioned: a future shape change gets a new key rather than a migration, so
 * an older build reading a newer list finds nothing and starts empty instead
 * of half-understanding it. */
const RECENTS_KEY = "vingilot-palette.v1";

/** How many are kept. Long enough that the week's work is in the empty
 * palette, short enough that the empty palette is still a shortlist rather
 * than a history — past this, the answer is to type. */
export const MAX_RECENTS = 8;

const NO_STORAGE: StorageLike = {
  getItem: () => null,
  setItem: () => {},
};

function defaultStorage(): StorageLike {
  return (
    (globalThis as { localStorage?: StorageLike }).localStorage ?? NO_STORAGE
  );
}

/** The list with `id` moved to the front, capped. Pure, and it is where the
 * "most recent first, no duplicates" rule actually lives. */
export function withRecent(recents: readonly string[], id: string): string[] {
  return [id, ...recents.filter((entry) => entry !== id)].slice(0, MAX_RECENTS);
}

/** Read a stored list. Missing, unparseable or wrongly-shaped storage reads as
 * empty — never a throw, because this is called during the render that puts
 * the workspace screen on screen. */
export function parseRecents(raw: string | null): string[] {
  if (raw === null || raw === "") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const seen = new Set<string>();
  const recents: string[] = [];
  for (const entry of parsed) {
    if (typeof entry !== "string" || entry === "" || seen.has(entry)) continue;
    seen.add(entry);
    recents.push(entry);
  }
  return recents.slice(0, MAX_RECENTS);
}

export function readRecents(storage: StorageLike = defaultStorage()): string[] {
  return parseRecents(storage.getItem(RECENTS_KEY));
}

/** Mirror the list back. A storage that refuses the write (quota, a
 * private-mode webview) costs the next restart its recents and nothing else. */
export function writeRecents(
  recents: readonly string[],
  storage: StorageLike = defaultStorage(),
): void {
  try {
    storage.setItem(RECENTS_KEY, JSON.stringify(recents.slice(0, MAX_RECENTS)));
  } catch {
    // Losing the order of a list is survivable; failing the render that
    // produced it is not.
  }
}
