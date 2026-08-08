// Which team a worktree is talking to, and which relay channel that
// conversation is (vingilot/docs/plans/2026-08-08-scratch-and-team-thread.md,
// Task 2).
//
// **This is a pointer, and it must stay one.** The plan's one hard rule for
// this pane is that the conversation does not get a fourth local store: the
// messages are Nostr events on the relay, signed by the agents that wrote them,
// and this app reads them back the way every other channel is read. What
// localStorage holds is two ids per worktree — the team that was chosen, and
// the channel the thread ended up in — because those are answers about *this
// machine's* workspace that no relay can be asked. If a future change puts
// message text in here, the pane has lost the argument that justified it.
//
// Keyed by worktree binding id, like `paneStore.ts` and `terminalTabStore.ts`.
// Storage is injectable so plain `node --test` (no DOM) can pass a shim.

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Versioned: a later shape change takes a new key rather than a migration, so
 * an older build reading a newer record finds nothing and starts clean instead
 * of half-understanding it. */
const BINDINGS_KEY = "vingilot-team-thread.v1";

const NO_STORAGE: StorageLike = {
  getItem: () => null,
  setItem: () => {},
};

function defaultStorage(): StorageLike {
  return (
    (globalThis as { localStorage?: StorageLike }).localStorage ?? NO_STORAGE
  );
}

export interface TeamThreadBinding {
  teamId: string;
  /** The relay channel this worktree's thread is, or `null` for a team that has
   * been chosen but whose thread has not been opened yet. Two states rather
   * than one, because "chosen, not yet opened" is where the owner sees what
   * will be deployed on his behalf before anything is. */
  channelId: string | null;
}

export type TeamThreadBindings = Record<string, TeamThreadBinding>;

function readBinding(value: unknown): TeamThreadBinding | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.teamId !== "string" || record.teamId === "") return null;
  return {
    channelId:
      typeof record.channelId === "string" && record.channelId !== ""
        ? record.channelId
        : null,
    teamId: record.teamId,
  };
}

/** Read stored bindings. Missing, unparseable or half-readable storage reads as
 * whatever *is* readable — never a throw, because this runs inside the render
 * that puts the workspace screen up, and never an empty answer standing in for
 * one unreadable row. */
export function parseTeamThreadBindings(
  raw: string | null,
): TeamThreadBindings {
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
  const bindings: TeamThreadBindings = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (key === "") continue;
    const binding = readBinding(value);
    if (binding !== null) bindings[key] = binding;
  }
  return bindings;
}

export function readTeamThreadBindings(
  storage: StorageLike = defaultStorage(),
): TeamThreadBindings {
  return parseTeamThreadBindings(storage.getItem(BINDINGS_KEY));
}

/** Mirror the bindings back. A storage that refuses the write costs the next
 * restart its pointer and nothing else — the thread itself is on the relay, in
 * the owner's ordinary channel list, and is still there to be found by name. */
export function writeTeamThreadBindings(
  bindings: TeamThreadBindings,
  storage: StorageLike = defaultStorage(),
): void {
  try {
    storage.setItem(BINDINGS_KEY, JSON.stringify(bindings));
  } catch {
    // See above: losing a pointer is survivable, failing this render is not.
  }
}

/** Choose a team for a worktree. Choosing a different one **does not delete the
 * old thread** — it is a channel on the relay with the team's own words in it —
 * so this only forgets where it was, and the pane says so. */
export function withChosenTeam(
  bindings: TeamThreadBindings,
  bindingId: string,
  teamId: string,
): TeamThreadBindings {
  const current = bindings[bindingId];
  if (current !== undefined && current.teamId === teamId) return bindings;
  return { ...bindings, [bindingId]: { channelId: null, teamId } };
}

/** Forget which team this worktree was talking to, so the pane offers the
 * choice again. **Only the pointer goes** — the channel and everything the team
 * said in it are on the relay and stay there, which is exactly the property
 * that made a relay-backed thread the right answer. */
export function withNoTeam(
  bindings: TeamThreadBindings,
  bindingId: string,
): TeamThreadBindings {
  if (bindings[bindingId] === undefined) return bindings;
  const next = { ...bindings };
  delete next[bindingId];
  return next;
}

/** Record the channel a freshly opened thread landed in.
 *
 * Refuses to write against a different team than the one currently chosen: the
 * open is asynchronous, and an owner who switched teams while it was in flight
 * must not get the new team's pointer aimed at the old team's channel. */
export function withThreadChannel(
  bindings: TeamThreadBindings,
  bindingId: string,
  teamId: string,
  channelId: string,
): TeamThreadBindings {
  const current = bindings[bindingId];
  if (current === undefined || current.teamId !== teamId) return bindings;
  if (current.channelId === channelId) return bindings;
  return { ...bindings, [bindingId]: { channelId, teamId } };
}

export function bindingFor(
  bindings: TeamThreadBindings,
  bindingId: string | null,
): TeamThreadBinding | null {
  if (bindingId === null) return null;
  return bindings[bindingId] ?? null;
}
