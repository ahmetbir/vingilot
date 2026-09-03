// What each worktree was last read against — remembered (2026-09-04), so a
// worktree he reads against `main...HEAD` opens that way next time rather
// than back at `HEAD`. Keyed by binding id; the same `localStorage`
// arrangement as the other reading preferences (`diffTabPrefs.ts`), and for
// the same reason not community-scoped: a base is a fact about how he reads
// a checkout on this machine, not about a relay.

const KEY = "vingilot-diff-base.v1";

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function storage(): StorageLike | null {
  return (globalThis as { localStorage?: StorageLike }).localStorage ?? null;
}

function readAll(): Record<string, string> {
  try {
    const raw = storage()?.getItem(KEY);
    if (raw === null || raw === undefined) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "string" && v.trim() !== "") out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export function readDiffBase(bindingId: string): string | null {
  return readAll()[bindingId] ?? null;
}

export function writeDiffBase(bindingId: string, base: string): void {
  try {
    const all = readAll();
    all[bindingId] = base;
    storage()?.setItem(KEY, JSON.stringify(all));
  } catch {
    // A preference that did not persist costs the next open its base, not
    // the read in front of him.
  }
}
