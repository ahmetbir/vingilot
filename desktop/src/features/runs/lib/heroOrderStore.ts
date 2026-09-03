// Where the hero strip's order lives between app runs. The same arrangement
// as `terminalTabStore.ts`: `localStorage`, injectable for `node --test`,
// versioned key, and an unreadable record reads as no order — which costs the
// arrangement and nothing else, because `reconcileHeroOrder` rebuilds one
// from the tab model on the first render.

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const ORDER_KEY = "vingilot-hero-order.v1";

const NO_STORAGE: StorageLike = {
  getItem: () => null,
  setItem: () => {},
};

function defaultStorage(): StorageLike {
  return (
    (globalThis as { localStorage?: StorageLike }).localStorage ?? NO_STORAGE
  );
}

export function parseHeroOrder(raw: string | null): readonly string[] {
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

export function readHeroOrder(
  storage: StorageLike = defaultStorage(),
): readonly string[] {
  let raw: string | null = null;
  try {
    raw = storage.getItem(ORDER_KEY);
  } catch {
    return [];
  }
  return parseHeroOrder(raw);
}

export function writeHeroOrder(
  order: readonly string[],
  storage: StorageLike = defaultStorage(),
): void {
  try {
    storage.setItem(ORDER_KEY, JSON.stringify(order));
  } catch {
    // Losing the arrangement is survivable; failing the render is not.
  }
}
