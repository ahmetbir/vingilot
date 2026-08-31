// Two things the diff tab remembers about how the owner reads a diff:
// whether whitespace-only changes are hidden, and whether long lines wrap
// (DIFF-TAB-BRIEF §"Behavior to wire" — "Ignore whitespace and Wrap persist
// per user").
//
// **The same store shape `diffMode.ts` uses, deliberately.** That file argues
// the whole design — a module singleton, a listener set, `localStorage` as a
// best-effort mirror, versioned key, NOT community-scoped and therefore
// deliberately absent from `resetCommunityState()` — and these two flags are
// the same kind of thing it holds: a preference about *reading*, not a fact
// about a relay. A second design here would be a second answer to the same
// question.
//
// **Why not one record with three fields.** `diffMode` is already stored,
// already read by two panes, and already has a key with a version on it.
// Folding it in would rewrite a preference the owner has set for a change that
// adds two unrelated booleans, and the failure mode of getting that wrong is
// silently forgetting his split choice. Two keys cost nothing.
//
// Pure of React; the binding is `useDiffTabPrefs` at the bottom of this file's
// consumer, and the store below is testable under `node --test`.

/** What the toolbar's two ghost toggles hold. */
export interface DiffTabPrefs {
  /** Hide changes whose only difference is whitespace. Off by default: a diff
   * that hid lines it was never asked to hide would be answering a question
   * the owner did not ask. */
  ignoreWhitespace: boolean;
  /** Soft-wrap long lines instead of scrolling them sideways. Off by default
   * for the reason `diffLayout.ts` states at length — above the patch's own
   * column floor the grid is worth more than the wrap. Below that floor the
   * surface wraps anyway, and this flag is what lets the owner ask for it
   * above it. */
  wrap: boolean;
}

const DEFAULTS: DiffTabPrefs = { ignoreWhitespace: false, wrap: false };

/** Versioned like every other stored preference in this fork: a later shape
 * takes a new key, so an older build reading a newer record finds nothing and
 * starts from the defaults — and the defaults are the reading that hides
 * nothing. */
const STORAGE_KEY = "vingilot-diff-tab-prefs.v1";

const listeners = new Set<() => void>();

/** Anything unrecognised — absent, malformed, written by another build —
 * reads as the defaults rather than throwing inside the render that puts the
 * tab up. */
export function parseDiffTabPrefs(
  raw: string | null | undefined,
): DiffTabPrefs {
  if (typeof raw !== "string" || raw === "") return DEFAULTS;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return DEFAULTS;
    const record = value as Record<string, unknown>;
    return {
      ignoreWhitespace: record.ignoreWhitespace === true,
      wrap: record.wrap === true,
    };
  } catch {
    return DEFAULTS;
  }
}

function readStored(): DiffTabPrefs {
  try {
    return parseDiffTabPrefs(globalThis.localStorage?.getItem(STORAGE_KEY));
  } catch {
    return DEFAULTS;
  }
}

let prefs: DiffTabPrefs = readStored();

export function getDiffTabPrefs(): DiffTabPrefs {
  return prefs;
}

/** Record a change and tell everyone reading it. A storage that refuses the
 * write costs the next restart this one preference and nothing else. */
export function setDiffTabPref<K extends keyof DiffTabPrefs>(
  key: K,
  value: DiffTabPrefs[K],
): void {
  if (prefs[key] === value) return;
  prefs = { ...prefs, [key]: value };
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Best effort: the in-memory value still applies for this session.
  }
  for (const listener of listeners) listener();
}

export function subscribeDiffTabPrefs(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The defaults, for a snapshot taken where there is no storage to read. */
export function serverDiffTabPrefs(): DiffTabPrefs {
  return DEFAULTS;
}

/** Test-only: nothing in the product un-chooses a preference the owner set. */
export function resetDiffTabPrefsForTests(): void {
  prefs = DEFAULTS;
  try {
    globalThis.localStorage?.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to undo.
  }
  for (const listener of listeners) listener();
}
