// Pure model for the terminal tabs a worktree owns — the iTerm window this
// app replaces, one strip per worktree.
//
// The owner runs several shells against one checkout at once: an agent in one,
// a test loop in another, git in a third. Before this, a worktree had exactly
// one shell and the only way to get a second was a second worktree, which is a
// different checkout and therefore a different thing entirely.
//
// **What a tab is.** An ordinal, and nothing else. A tab is not a window, a
// title, or a process handle — it is the number that, joined to the worktree's
// binding id, names a PTY session (`sessionIdFor`). Everything else about a
// terminal already lives elsewhere: its shell in `vingilot_pty`, its screen in
// that session's scrollback, its persistence in tmux. Keeping a tab this thin
// is what lets the whole layout be written to disk and read back as data
// (`terminalTabStore.ts`) with nothing to reconcile against a live process.
//
// This module knows nothing about repos, checkouts, or where a shell starts —
// `terminalSessions.ts` resolves an id to a cwd, and only that module needs to
// know how. Here a worktree is a string.

/** Joins a worktree's binding id to a tab's ordinal.
 *
 * What matters about the separator is that the derivation stays injective;
 * what matters about the *id* is that nothing downstream may quietly require
 * an alphabet of it. Two things consume it, and only one of them constrains
 * it:
 *
 * - `vingilot_pty/tmux.rs` turns it into a tmux session name, passing
 *   `[A-Za-z0-9_]` through and escaping every other byte as `-<hex>`. `#`
 *   becomes `-23`, cannot collide with an escape, and needs no case there —
 *   the same way the `:` and `.` already inside binding ids need none.
 * - The Tauri output event does **not** consume it. It used to: the event was
 *   named after the session, and a Tauri event name admits only
 *   `[A-Za-z0-9-/:_]`, so `#` made the channel unconstructible at both ends
 *   with no error on either. The id now rides in the payload
 *   (`ptyStream.ts`'s `PTY_OUTPUT_EVENT`), which is why this is once again a
 *   free choice. Nothing may put it back into a name. */
const SESSION_SEPARATOR = "#";

/** The PTY session id for one worktree tab.
 *
 * Injective over (binding id, ordinal) pairs even when a binding id itself
 * contains the separator: an ordinal is a positive integer and so never
 * contains one, which means the last separator in the id is always the one
 * this added. Nothing parses the id back apart — the pair is the key, the
 * string is the name — but the two would have to be distinguishable for a
 * session to be, and they are. */
export function sessionIdFor(bindingId: string, n: number): string {
  return `${bindingId}${SESSION_SEPARATOR}${n}`;
}

/** One worktree's strip. */
export interface WorktreeTabs {
  /** Tab ordinals, left to right — the strip's order, which the owner can
   * change. Never empty: see `closeTab` for what the last tab does. */
  readonly tabs: readonly number[];
  /** The ordinal showing. Always one of `tabs`. */
  readonly active: number;
  /** The ordinal the next new tab will take.
   *
   * Only ever rises, and is never recomputed from `tabs`. A closed tab's
   * ordinal must not be handed to a later shell: closing kills the pty and
   * asks tmux to end the session, and if that kill lost a race the reused id
   * would attach the new tab to the old tab's session — the owner's own
   * scrollback, in the right worktree, from the shell they just closed. Rising
   * costs one integer and makes that unreachable. */
  readonly nextN: number;
}

/** Every worktree the workspace is holding terminals for, keyed by binding id.
 *
 * A record rather than a list because membership is the only question asked of
 * it across worktrees ("is this one open", "which of these are gone"). The key
 * order carries no meaning and nothing may read one into it — the only order
 * the owner sees is `tabs`, within a worktree. */
export type TabLayout = Readonly<Record<string, WorktreeTabs>>;

/** What a layout change closed, alongside the layout it produced.
 *
 * The two travel together because they must be applied together: a caller that
 * took the new layout without closing what left it would leave a shell running
 * with nothing tracking it, for the life of the app. */
export interface TabLayoutChange {
  layout: TabLayout;
  /** Session ids whose pty must really be closed — the owner ended these, or
   * their worktree left the workspace, so nothing will ever reattach. */
  closed: readonly string[];
}

/** What the owner asked the strip to do. One union so the whole strip is a
 * single callback rather than five, and so the key map (`terminalKeys.ts`) and
 * the mouse resolve to the same vocabulary. */
export type TabCommand =
  | { type: "new" }
  | { type: "close"; n: number }
  | { type: "select"; n: number }
  | { type: "step"; dir: -1 | 1 }
  | { type: "move"; dir: -1 | 1 }
  /** Drag-reorder: put tab `n` where `before` currently sits, or at the end of
   * the strip when `before` is `null` (redesign P4.7, item 3). The keyboard's
   * `move` walks one position at a time and is a different act; this one names
   * a destination, because a pointer does. */
  | { type: "reorder"; n: number; before: number | null };

export function emptyLayout(): TabLayout {
  return {};
}

/** One worktree's tabs, or `null` when it has none open. */
export function worktreeTabs(
  layout: TabLayout,
  bindingId: string,
): WorktreeTabs | null {
  return Object.hasOwn(layout, bindingId) ? layout[bindingId] : null;
}

/** Every open tab, as the pair that names its session.
 *
 * Grouped by worktree in the record's own key order, which means nothing;
 * within a worktree, strip order, which means everything. */
export function layoutSessions(
  layout: TabLayout,
): Array<{ bindingId: string; n: number }> {
  const sessions: Array<{ bindingId: string; n: number }> = [];
  for (const [bindingId, tabs] of Object.entries(layout)) {
    for (const n of tabs.tabs) sessions.push({ bindingId, n });
  }
  return sessions;
}

/** Give a worktree a strip if it has none — visiting one is what opens its
 * first terminal. A worktree that already has tabs is returned untouched, so
 * revisiting never disturbs the strip the owner arranged. */
export function ensureWorktree(
  layout: TabLayout,
  bindingId: string,
): TabLayout {
  if (Object.hasOwn(layout, bindingId)) return layout;
  return { ...layout, [bindingId]: { active: 1, nextN: 2, tabs: [1] } };
}

function replace(
  layout: TabLayout,
  bindingId: string,
  tabs: WorktreeTabs,
): TabLayout {
  return { ...layout, [bindingId]: tabs };
}

/** A new tab, at the end of the strip and showing.
 *
 * At the end rather than beside the active tab: the strip labels tabs by their
 * ordinal, so appending keeps the common case (never reordered) reading
 * 1, 2, 3 in the order the owner opened them. */
function addTab(wt: WorktreeTabs): WorktreeTabs {
  return {
    active: wt.nextN,
    nextN: wt.nextN + 1,
    tabs: [...wt.tabs, wt.nextN],
  };
}

function selectTab(wt: WorktreeTabs, n: number): WorktreeTabs {
  if (!wt.tabs.includes(n)) return wt;
  return { ...wt, active: n };
}

/** Move the selection one tab along, wrapping at either end.
 *
 * Wrapping because the strip is a ring in every terminal the owner already
 * uses, and because a one-tab worktree then makes ⌥⌘←/→ a harmless no-op
 * rather than a key that appears broken. */
function stepTab(wt: WorktreeTabs, dir: -1 | 1): WorktreeTabs {
  const index = wt.tabs.indexOf(wt.active);
  if (index === -1) return wt;
  const count = wt.tabs.length;
  const target = (index + dir + count) % count;
  return { ...wt, active: wt.tabs[target] };
}

/** Move the active tab one position along the strip. Clamped, not wrapped:
 * dragging a tab off one end and onto the other is a reorder nobody asked
 * for, and at the end of the strip "nothing moved" is the honest answer. */
function moveActiveTab(wt: WorktreeTabs, dir: -1 | 1): WorktreeTabs {
  const index = wt.tabs.indexOf(wt.active);
  if (index === -1) return wt;
  const target = index + dir;
  if (target < 0 || target >= wt.tabs.length) return wt;
  const tabs = [...wt.tabs];
  [tabs[index], tabs[target]] = [tabs[target], tabs[index]];
  return { ...wt, tabs };
}

/** Put a tab where another one sits — the pointer's reorder.
 *
 * **Nothing about a session moves.** A tab is an ordinal and the ordinal is the
 * name of a pty (`sessionIdFor`), so reordering rewrites a list of numbers and
 * touches nothing else: no id changes, no tmux session is renamed, and the
 * strip's labels stay with their shells rather than renumbering to match the
 * new order (this file's header). The selection is untouched for the same
 * reason — dragging a tab is arranging the strip, not choosing what to look at.
 *
 * `before` of `null` means the end of the strip. A `before` that names no tab,
 * or the tab itself, changes nothing. */
function reorderTab(
  wt: WorktreeTabs,
  n: number,
  before: number | null,
): WorktreeTabs {
  const from = wt.tabs.indexOf(n);
  if (from === -1 || n === before) return wt;
  const rest = wt.tabs.filter((tab) => tab !== n);
  const at = before === null ? rest.length : rest.indexOf(before);
  if (at === -1) return wt;
  return { ...wt, tabs: [...rest.slice(0, at), n, ...rest.slice(at)] };
}

/** Close one tab, and say which session that really ended.
 *
 * Unlike a worktree switch — which merely hides a terminal and must leave its
 * shell alone — this is a close the owner performed, so the pty is killed and
 * its tmux session ended.
 *
 * **Closing the last tab replaces it with a fresh one.** A worktree is never
 * left with an empty strip. The alternatives are both worse: refusing the
 * close makes ⌘W silently do nothing, which reads as a broken key rather than
 * a rule; and leaving the worktree with no tabs strands its Terminal surface
 * with nothing in it and no obvious way back, since the only affordance that
 * creates a tab lives in the strip that just disappeared. So ⌘W on the last
 * tab means "I am done with this shell" and gives back a clean one — the old
 * session is genuinely closed (a new ordinal, so a new session id, so a new
 * tmux session), which is exactly what closing a tab means everywhere else. */
function closeTab(
  layout: TabLayout,
  bindingId: string,
  wt: WorktreeTabs,
  n: number,
): TabLayoutChange {
  if (!wt.tabs.includes(n)) return { closed: [], layout };
  const closed = [sessionIdFor(bindingId, n)];

  if (wt.tabs.length === 1) {
    const fresh = wt.nextN;
    return {
      closed,
      layout: replace(layout, bindingId, {
        active: fresh,
        nextN: fresh + 1,
        tabs: [fresh],
      }),
    };
  }

  const index = wt.tabs.indexOf(n);
  const tabs = wt.tabs.filter((tab) => tab !== n);
  // Selection follows the tab that took the closed one's place, or the new
  // last tab when the closed one was rightmost — the same way every tabbed
  // thing the owner uses behaves.
  const active =
    wt.active === n ? tabs[Math.min(index, tabs.length - 1)] : wt.active;
  return {
    closed,
    layout: replace(layout, bindingId, { ...wt, active, tabs }),
  };
}

/** Apply one command to one worktree's strip.
 *
 * A command for a worktree with no strip is dropped rather than creating one:
 * only visiting a worktree opens its first terminal (`ensureWorktree`), and a
 * stray keystroke must not be a second way in. */
export function applyTabCommand(
  layout: TabLayout,
  bindingId: string,
  command: TabCommand,
): TabLayoutChange {
  const wt = worktreeTabs(layout, bindingId);
  if (wt === null) return { closed: [], layout };
  switch (command.type) {
    case "new":
      return { closed: [], layout: replace(layout, bindingId, addTab(wt)) };
    case "close":
      return closeTab(layout, bindingId, wt, command.n);
    case "select":
      return {
        closed: [],
        layout: replace(layout, bindingId, selectTab(wt, command.n)),
      };
    case "step":
      return {
        closed: [],
        layout: replace(layout, bindingId, stepTab(wt, command.dir)),
      };
    case "move":
      return {
        closed: [],
        layout: replace(layout, bindingId, moveActiveTab(wt, command.dir)),
      };
    case "reorder": {
      // The one command that routinely resolves to "nothing moved" — a tab
      // dropped back where it started, or on itself. Returning the input
      // layout rather than a fresh record with the same contents is what lets
      // the caller skip the write and the store skip a save for a drag that
      // changed nothing.
      const next = reorderTab(wt, command.n, command.before);
      return {
        closed: [],
        layout: next === wt ? layout : replace(layout, bindingId, next),
      };
    }
  }
}

/** Drop the worktrees that have left the workspace, and name every session
 * that went with them — the one event that means "really closed" for a whole
 * strip at once.
 *
 * An empty `liveBindingIds` changes nothing. The worktree list is polled, not
 * pushed, so a single empty read is "the workspace has not answered yet", and
 * acting on it would kill every shell the owner has running over a blip. This
 * costs no real coverage: every repo contributes its own checkout to the live
 * set, so the set is only empty when there are no repos at all — in which case
 * nothing could have been opened. */
export function dropWorktrees(
  layout: TabLayout,
  liveBindingIds: readonly string[],
): TabLayoutChange {
  if (liveBindingIds.length === 0) return { closed: [], layout };
  const live = new Set(liveBindingIds);
  return dropWhere(layout, (bindingId) => !live.has(bindingId));
}

/** Close named worktrees outright — the owner removed the project that owns
 * them, so their checkouts are no longer anything this workspace can reach.
 *
 * The complement of `dropWorktrees`, and separate from it because the two are
 * told different things. Liveness is polled, so "not in the live set" is only
 * probably gone and has to be read defensively; this is an act the owner
 * performed, so it needs no such caution and must not wait a poll interval to
 * take effect — a project's shells should end when it leaves, not a couple of
 * seconds later. */
export function closeWorktrees(
  layout: TabLayout,
  bindingIds: readonly string[],
): TabLayoutChange {
  if (bindingIds.length === 0) return { closed: [], layout };
  const doomed = new Set(bindingIds);
  return dropWhere(layout, (bindingId) => doomed.has(bindingId));
}

/** Drop every worktree the predicate accepts, naming each session that went
 * with it. Returns the original layout untouched when nothing matched, so a
 * caller can use reference equality to skip the write. */
function dropWhere(
  layout: TabLayout,
  drop: (bindingId: string) => boolean,
): TabLayoutChange {
  const closed: string[] = [];
  const kept: Record<string, WorktreeTabs> = {};
  for (const [bindingId, tabs] of Object.entries(layout)) {
    if (!drop(bindingId)) {
      kept[bindingId] = tabs;
      continue;
    }
    for (const n of tabs.tabs) closed.push(sessionIdFor(bindingId, n));
  }
  if (closed.length === 0) return { closed: [], layout };
  return { closed, layout: kept };
}
