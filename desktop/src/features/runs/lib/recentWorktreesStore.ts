// Where the recent-worktrees memory lives between app runs — the same
// arrangement as `terminalTabStore.ts`: `localStorage`, injectable for
// `node --test`, versioned key, and an unreadable record reads as no memory,
// which costs the order and nothing else.
//
// Read by the deck (`useDeckLayers.ts`) and by the palette's worktree source,
// which lists the most recent first. The palette reads the record directly
// rather than being handed the list, because the shell palette has no deck to
// be handed it by and the record is the same either way.

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const KEY = "vingilot-recent-worktrees.v1";

const NO_STORAGE: StorageLike = {
  getItem: () => null,
  setItem: () => {},
};

function defaultStorage(): StorageLike {
  return (
    (globalThis as { localStorage?: StorageLike }).localStorage ?? NO_STORAGE
  );
}

export function parseRecent(raw: string | null): readonly string[] {
  if (raw === null || raw === "") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const seen = new Set<string>();
  const order: string[] = [];
  for (const id of parsed) {
    if (typeof id !== "string" || id === "" || seen.has(id)) continue;
    seen.add(id);
    order.push(id);
  }
  return order;
}

export function readRecent(
  storage: StorageLike = defaultStorage(),
): readonly string[] {
  try {
    return parseRecent(storage.getItem(KEY));
  } catch {
    return [];
  }
}

export function writeRecent(
  order: readonly string[],
  storage: StorageLike = defaultStorage(),
): void {
  try {
    storage.setItem(KEY, JSON.stringify(order));
  } catch {
    // Losing the memory is survivable; failing the render is not.
  }
}
