// What the owner has typed into a worktree thread and not yet sent
// (vingilot/docs/plans/2026-08-08-scratch-and-team-thread.md, Task 2).
//
// **Why this is a store at all, when `teamThreadStore.ts` says "no message text
// ever".** That rule is about the *conversation*: sent messages are Nostr events
// on the relay, signed by whoever wrote them, and a local copy of them would be
// a second, unsigned account of what was said. An **unsent** draft is the exact
// opposite case — it is text that has never left this machine, that no relay has
// been told about and no key has signed, and there is nowhere else it could
// possibly live. So it gets its own module and its own key rather than being
// folded into the pointer record, and `teamThreadStore.ts` keeps its invariant
// literally: a pointer, and nothing that was ever said.
//
// **Why not upstream's draft store (`features/messages/lib/useDrafts.ts`).** It
// is the right shape and already keyed by channel — but `clearAllDrafts()` is
// called from `resetCommunityState()`, which runs on exactly the reinit that
// remounts `<AppReady key={communityKey}>`. Putting this text there would mean
// wiring it into the teardown that is *the* thing losing it. Upstream says as
// much itself: `useReconnectRelay.ts` avoids the `reconnectCommunity()` path
// "to avoid unmounting the React tree and clearing draft state".
//
// **Why nothing here is reset on a community switch, deliberately.** This record
// is keyed by worktree binding id, and a worktree is a directory on this machine
// — it does not belong to a community and does not change when one is joined or
// left. A sentence typed about a checkout is still about that checkout after a
// reconnect. There is also no module-level cache here to reset: every function
// reads and writes storage directly, so AGENTS.md's "Community Switching" rule
// (module singletons must be torn down in `resetCommunityState()`) has nothing
// to bite on, which is the point.
//
// Storage is injectable so plain `node --test` (no DOM) can pass a shim.

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Versioned like the pointer record: a later shape change takes a new key
 * rather than a migration, so an older build finds nothing instead of
 * half-understanding a newer one. */
const DRAFTS_KEY = "vingilot-team-draft.v1";

const NO_STORAGE: StorageLike = {
  getItem: () => null,
  setItem: () => {},
};

function defaultStorage(): StorageLike {
  return (
    (globalThis as { localStorage?: StorageLike }).localStorage ?? NO_STORAGE
  );
}

/** Unsent text, by worktree binding id. One draft per worktree, because that is
 * what the pane offers: one thread, one composer. */
export type TeamDrafts = Record<string, string>;

/** Read stored drafts. Missing, unparseable or half-readable storage reads as
 * whatever *is* readable — never a throw, because this runs inside the render
 * that puts the pane up, and never an empty answer standing in for one
 * unreadable row. */
export function parseTeamDrafts(raw: string | null): TeamDrafts {
  if (raw === null || raw === "") return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {};
  }
  const drafts: TeamDrafts = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (key === "" || typeof value !== "string" || value === "") continue;
    drafts[key] = value;
  }
  return drafts;
}

export function readTeamDrafts(
  storage: StorageLike = defaultStorage(),
): TeamDrafts {
  return parseTeamDrafts(storage.getItem(DRAFTS_KEY));
}

/** Mirror the drafts back.
 *
 * A storage that refuses the write (quota, private mode) leaves the text where
 * it already is — in the pane's React state, which is what it had before this
 * store existed. That is a smaller loss than failing the keystroke, and it is
 * the only failure mode here that costs anything. */
export function writeTeamDrafts(
  drafts: TeamDrafts,
  storage: StorageLike = defaultStorage(),
): void {
  try {
    storage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
  } catch {
    // See above.
  }
}

export function draftFor(drafts: TeamDrafts, bindingId: string | null): string {
  if (bindingId === null) return "";
  return drafts[bindingId] ?? "";
}

/** Put a draft back. Empty text **removes the row** rather than storing `""`, so
 * the record does not grow one entry per worktree the owner ever opened a thread
 * in and then emptied. */
export function withDraft(
  drafts: TeamDrafts,
  bindingId: string,
  text: string,
): TeamDrafts {
  const current = drafts[bindingId] ?? "";
  if (current === text) return drafts;
  if (text === "") {
    const next = { ...drafts };
    delete next[bindingId];
    return next;
  }
  return { ...drafts, [bindingId]: text };
}
