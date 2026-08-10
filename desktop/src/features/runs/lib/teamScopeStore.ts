// Whether the scope sentence at the top of a team thread is put away, per
// thread (vingilot/docs/plans/2026-08-11-what-sent-him-to-vscode.md, Task 1).
//
// > *"üstteki prompt mudur nedir çok sinir bozucu, onu kapatma ya da küçültme
// > tuşu da gelmeli."*
//
// **The sentence is not the problem, and it is not shortened here or
// anywhere.** It enumerates what is and is not sent — that the path goes in the
// channel's description and the branch in its name, that nothing is prepended
// to his messages, that the agents are not started in that directory and may
// not be able to open it. Every clause of that is a thing he could otherwise
// only find out by being wrong about it, and `teamThread.ts` argues why it is
// worded the way it is. What was wrong is that it is worth reading once and is
// then in the way for the rest of the thread's life: measured on his 16-inch
// laptop, the header it sits in was **401px of a 992px pane** — 40% of the
// conversation — because a 500-character sentence wraps a long way in a 243px
// column.
//
// **So it collapses, and the choice is his and is kept.** Default open: a
// thread he has never read the scope of gets it, which is the whole point of
// having written it. Once he puts it away it stays away *for that thread*, and
// the same control brings the full text back — not a summary of it.
//
// **Keyed by the thread's channel id**, not by the worktree. Two threads about
// the same worktree are two conversations, possibly with different teams, and
// a second thread's scope has not been read just because the first one's was.
// That is also why this is not a field on `teamThreadStore.ts`'s binding: that
// record is keyed by worktree, holds the *pointer* to the current thread, and
// its header says a shape change there takes a new key rather than a migration.
// A preference about a channel does not belong in a pointer to one.
//
// Storage is injectable so plain `node --test` (no DOM) can pass a shim, like
// every other store in this feature.

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Versioned for the same reason `teamThreadStore.ts` is: a later shape change
 * takes a new key, so an older build reading a newer record finds nothing and
 * starts from the default rather than half-understanding it. Starting from the
 * default here means the sentence is shown, which is the safe direction — the
 * failure that matters is hiding it from someone who has not read it. */
const COLLAPSED_KEY = "vingilot-team-scope.v1";

const NO_STORAGE: StorageLike = {
  getItem: () => null,
  setItem: () => {},
};

function defaultStorage(): StorageLike {
  return (
    (globalThis as { localStorage?: StorageLike }).localStorage ?? NO_STORAGE
  );
}

/** The threads whose scope sentence is put away. Only the collapsed ones are
 * recorded: absence is the default and the default is open, so a thread this
 * app has never heard of shows its scope. */
export type CollapsedScopes = Record<string, true>;

/** Read the record. Missing, unparseable or half-readable storage reads as
 * whatever *is* readable — never a throw, because this runs inside the render
 * that puts the pane up, and never an unreadable row standing in for a
 * collapsed one. */
export function parseCollapsedScopes(raw: string | null): CollapsedScopes {
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
  const collapsed: CollapsedScopes = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (key === "" || value !== true) continue;
    collapsed[key] = true;
  }
  return collapsed;
}

export function readCollapsedScopes(
  storage: StorageLike = defaultStorage(),
): CollapsedScopes {
  return parseCollapsedScopes(storage.getItem(COLLAPSED_KEY));
}

/** Mirror the record back. A storage that refuses the write costs the next
 * restart this one preference and nothing else — the sentence comes back, which
 * is the side to fail on. */
export function writeCollapsedScopes(
  collapsed: CollapsedScopes,
  storage: StorageLike = defaultStorage(),
): void {
  try {
    storage.setItem(COLLAPSED_KEY, JSON.stringify(collapsed));
  } catch {
    // See above: losing a preference is survivable, failing this render is not.
  }
}

/** Whether this thread's scope is put away. A thread with no channel yet — the
 * pane before the thread is opened — is never collapsed: the preflight is the
 * one place the sentence is doing its first job, and there is no thread to have
 * had an opinion about. */
export function isScopeCollapsed(
  collapsed: CollapsedScopes,
  channelId: string | null,
): boolean {
  if (channelId === null || channelId === "") return false;
  return collapsed[channelId] === true;
}

/** Record the choice. Returns the record unchanged — the same object, not a
 * copy — when nothing moves, so a caller mirroring it into storage on every
 * change does not write on a no-op. */
export function withScopeCollapsed(
  collapsed: CollapsedScopes,
  channelId: string,
  put: boolean,
): CollapsedScopes {
  if (channelId === "") return collapsed;
  const was = collapsed[channelId] === true;
  if (was === put) return collapsed;
  if (!put) {
    const next = { ...collapsed };
    delete next[channelId];
    return next;
  }
  return { ...collapsed, [channelId]: true };
}
