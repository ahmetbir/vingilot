// Pure model for the Deck's tasks strip — the row of task chips above the
// terminal (2026-08-29 redesign, P2; mockup `.tasks`).
//
// **What a task is here, and why it is not a run.** The mockup draws several
// named tasks over one worktree, each owning its own set of terminal tabs. The
// runs feature cannot honestly back that: a worktree carries at most ONE owner
// run (`projects.ts`'s `owner_run_id`), and the workspace's run list is not
// keyed by worktree at all (`RunSummary` has no binding id — only a
// `RunDetail`'s grants do). Mapping chips onto runs would give every worktree
// a strip of zero or one chip and a `+` that provisions infrastructure. So a
// task is what the mockup's own data says it is: **a named group of the
// worktree's terminal tabs**. The plan's P2 line — "a task = a named
// run/session" — is met at the session end of that sentence, and this header
// is the decision record.
//
// **This module groups; it does not own.** `terminalTabs.ts` stays the single
// authority on ordinals, session ids and `nextN` — every shell a task holds
// is a tab there, so the saved tab layout, the sweep, and every close path
// keep working with no second registry of sessions. What is added is one
// invariant this module maintains: **the groups of a worktree partition its
// tabs** — every ordinal in exactly one group. `reconcileTasks` is the repair
// for any pair of layouts that disagree (a stored strip meeting a newer tab
// layout, a caller that changed tabs without saying so), and every command
// below preserves the invariant by construction.
//
// A group's `tabs` order is the strip's display order; the underlying
// `WorktreeTabs.tabs` order stops being shown anywhere once tasks exist, and
// nothing here re-reads meaning into it.

import { normalizeStripName } from "./stripName.ts";
import {
  applyTabCommand,
  sessionIdFor,
  type TabLayout,
  type WorktreeTabs,
  worktreeTabs,
} from "./terminalTabs.ts";

/** One task chip: a name over a non-empty set of tab ordinals. */
export interface TaskGroup {
  /** Stable for the group's life; only ever rises within a worktree, so a
   * closed task's id is never reused — the same argument `nextN` makes. */
  readonly id: number;
  /** What the chip says. Defaults to the id ("task 3") — an honest ordinal,
   * never an invented objective. */
  readonly name: string;
  /** This task's tabs, in strip order. Never empty. */
  readonly tabs: readonly number[];
  /** The ordinal this task shows when selected — its own memory of where the
   * owner was, one of `tabs`. */
  readonly active: number;
}

export interface WorktreeTaskStrip {
  /** Chip order, left to right. Never empty while the worktree has tabs. */
  readonly groups: readonly TaskGroup[];
  readonly nextId: number;
}

export type TaskLayout = Readonly<Record<string, WorktreeTaskStrip>>;

/** What the owner asked the strip to do — the chips' own vocabulary, beside
 * (not inside) `TabCommand`, which stays the tab bar's. */
export type TaskCommand =
  | { type: "new-task" }
  | { type: "select-task"; id: number }
  | { type: "close-task"; id: number }
  /** Call this chip something (P4.5). The field already existed — this is the
   * act that writes it, and a whitespace-only name restores `task N`. */
  | { type: "rename-task"; id: number; name: string };

/** One deck transition: both layouts, and whatever it really ended — the same
 * travel-together rule `TabLayoutChange` states, over two layouts. */
export interface DeckChange {
  layout: TabLayout;
  tasks: TaskLayout;
  /** Session ids whose pty must really be closed. The caller also owes these
   * to `cascadeSplits` — a closed tab takes its split half with it. */
  closed: readonly string[];
}

export function emptyTasks(): TaskLayout {
  return {};
}

/** What a chip is called before the owner calls it anything, and what it goes
 * back to when he clears the name. Exported so the strip can seed its editor
 * with the same string the model would fall back to. */
export function defaultTaskName(id: number): string {
  return `task ${id}`;
}

/** A worktree's strip made true against its tabs, whatever state it arrived
 * in — `null` (never seen), stale (a tab closed elsewhere), or foreign to it
 * (ordinals it never had). Idempotent, and reference-stable when nothing
 * needed repair, so a render can call it freely. */
export function reconcileTasks(
  strip: WorktreeTaskStrip | null,
  wt: WorktreeTabs,
): WorktreeTaskStrip {
  const live = new Set(wt.tabs);
  const claimed = new Set<number>();
  const groups: TaskGroup[] = [];
  let changed = strip === null;
  let nextId = strip?.nextId ?? 1;

  for (const group of strip?.groups ?? []) {
    const tabs = group.tabs.filter((n) => live.has(n) && !claimed.has(n));
    for (const n of tabs) claimed.add(n);
    if (tabs.length === 0) {
      changed = true;
      continue;
    }
    const active = tabs.includes(group.active) ? group.active : tabs[0];
    if (tabs.length !== group.tabs.length || active !== group.active) {
      changed = true;
      groups.push({ ...group, active, tabs });
    } else {
      groups.push(group);
    }
    if (group.id >= nextId) {
      nextId = group.id + 1;
      changed = true;
    }
  }

  // Ordinals no group claims: they belong with the tab the owner is on, or
  // failing that with the last group, or failing that with a group of their
  // own — a tab must never be unreachable from the strip.
  const orphans = wt.tabs.filter((n) => !claimed.has(n));
  if (orphans.length > 0) {
    changed = true;
    const home = groups.findIndex((g) => g.tabs.includes(wt.active));
    const at = home !== -1 ? home : groups.length - 1;
    if (at >= 0) {
      const group = groups[at];
      groups[at] = { ...group, tabs: [...group.tabs, ...orphans] };
    } else {
      groups.push({
        active: orphans.includes(wt.active) ? wt.active : orphans[0],
        id: nextId,
        name: defaultTaskName(nextId),
        tabs: orphans,
      });
      nextId += 1;
    }
  }

  if (!changed && strip !== null) return strip;
  return { groups, nextId };
}

/** The group holding one ordinal. After `reconcileTasks`, every live ordinal
 * has one; `null` says the pair of layouts has not been reconciled. */
export function taskOf(strip: WorktreeTaskStrip, n: number): TaskGroup | null {
  return strip.groups.find((g) => g.tabs.includes(n)) ?? null;
}

/** What the tab bar shows while tasks exist: the active task's tabs, in the
 * task's own order, wearing the worktree's real active ordinal. Shaped as a
 * `WorktreeTabs` so `TerminalTabStrip` needs no second vocabulary — `nextN`
 * rides along untouched and unread. */
export function stripView(
  wt: WorktreeTabs,
  strip: WorktreeTaskStrip,
): WorktreeTabs {
  const group = taskOf(strip, wt.active);
  if (group === null) return wt;
  // Spread rather than rebuilt from three fields: the tab NAMES (P4.5) ride
  // along with everything else the worktree's strip carries, so the tab bar
  // draws what the owner called each shell rather than falling back to the
  // ordinals every time a task is on screen.
  return { ...wt, tabs: group.tabs };
}

function replaceStrip(
  tasks: TaskLayout,
  bindingId: string,
  strip: WorktreeTaskStrip,
): TaskLayout {
  return { ...tasks, [bindingId]: strip };
}

function replaceGroup(
  strip: WorktreeTaskStrip,
  group: TaskGroup,
): WorktreeTaskStrip {
  return {
    ...strip,
    groups: strip.groups.map((g) => (g.id === group.id ? group : g)),
  };
}

function unchanged(layout: TabLayout, tasks: TaskLayout): DeckChange {
  return { closed: [], layout, tasks };
}

/** A reconciled reading of one worktree's pair, or `null` when it has no
 * tabs at all — the same refusal `applyTabCommand` makes for a stray key. */
function pairFor(
  layout: TabLayout,
  tasks: TaskLayout,
  bindingId: string,
): { wt: WorktreeTabs; strip: WorktreeTaskStrip } | null {
  const wt = worktreeTabs(layout, bindingId);
  if (wt === null) return null;
  const stored = Object.hasOwn(tasks, bindingId) ? tasks[bindingId] : null;
  return { strip: reconcileTasks(stored, wt), wt };
}

/** Apply one tab command with the task invariant maintained.
 *
 * The `step` and `move` arms are re-scoped to the active task — the strip on
 * screen is the task's, so ⌥⌘←/→ walking tabs the owner cannot see would be
 * keys acting on a hidden surface. Everything else delegates its tab-model
 * half to `applyTabCommand` and repairs the groups around the result. */
export function applyDeckTabCommand(
  layout: TabLayout,
  tasks: TaskLayout,
  bindingId: string,
  command:
    | { type: "new" }
    | { type: "close"; n: number }
    | { type: "select"; n: number }
    | { type: "step"; dir: -1 | 1 }
    | { type: "move"; dir: -1 | 1 }
    | { type: "reorder"; n: number; before: number | null }
    | { type: "rename"; n: number; name: string },
): DeckChange {
  const pair = pairFor(layout, tasks, bindingId);
  if (pair === null) return unchanged(layout, tasks);
  const { strip, wt } = pair;

  switch (command.type) {
    case "new": {
      // The new ordinal joins the task the owner is in — the mockup's `+` on
      // the tab bar adds to the current task; a new *task* is `new-task`.
      const fresh = wt.nextN;
      const applied = applyTabCommand(layout, bindingId, { type: "new" });
      const group = taskOf(strip, wt.active) ?? strip.groups[0];
      const grown: TaskGroup = {
        ...group,
        active: fresh,
        tabs: [...group.tabs, fresh],
      };
      return {
        closed: applied.closed,
        layout: applied.layout,
        tasks: replaceStrip(tasks, bindingId, replaceGroup(strip, grown)),
      };
    }
    // A tab's name is the tab model's, and the groups have nothing to say
    // about it: no ordinal joins or leaves a task, so the strip is passed
    // through reconciled and otherwise untouched.
    case "rename": {
      const applied = applyTabCommand(layout, bindingId, command);
      return {
        closed: [],
        layout: applied.layout,
        tasks: replaceStrip(tasks, bindingId, strip),
      };
    }
    case "select": {
      const applied = applyTabCommand(layout, bindingId, command);
      const group = taskOf(strip, command.n);
      const next =
        group === null || group.active === command.n
          ? strip
          : replaceGroup(strip, { ...group, active: command.n });
      return {
        closed: [],
        layout: applied.layout,
        tasks: replaceStrip(tasks, bindingId, next),
      };
    }
    case "step": {
      const group = taskOf(strip, wt.active);
      if (group === null || group.tabs.length < 2) {
        return unchanged(layout, replaceStrip(tasks, bindingId, strip));
      }
      const index = group.tabs.indexOf(wt.active);
      const target =
        group.tabs[
          (index + command.dir + group.tabs.length) % group.tabs.length
        ];
      return applyDeckTabCommand(
        layout,
        replaceStrip(tasks, bindingId, strip),
        bindingId,
        {
          n: target,
          type: "select",
        },
      );
    }
    case "move": {
      const group = taskOf(strip, wt.active);
      if (group === null) {
        return unchanged(layout, replaceStrip(tasks, bindingId, strip));
      }
      const index = group.tabs.indexOf(wt.active);
      const target = index + command.dir;
      if (target < 0 || target >= group.tabs.length) {
        return unchanged(layout, replaceStrip(tasks, bindingId, strip));
      }
      const reordered = [...group.tabs];
      [reordered[index], reordered[target]] = [
        reordered[target],
        reordered[index],
      ];
      return {
        closed: [],
        layout,
        tasks: replaceStrip(
          tasks,
          bindingId,
          replaceGroup(strip, { ...group, tabs: reordered }),
        ),
      };
    }
    // The pointer's reorder (redesign P4.7, item 3). Applied to BOTH lists:
    // the raw layout, which is what is written to disk, and the task group,
    // which is what the strip actually draws (`stripView`). Reordering only
    // the first would leave the tab under the owner's finger where it was —
    // the strip he is dragging in is the group's list, not the layout's.
    //
    // A drop onto a tab that is not in this task lands nowhere: `before` is
    // filtered against the group, so a stray key changes neither list rather
    // than silently pulling a tab across a task boundary.
    case "reorder": {
      const group = taskOf(strip, command.n);
      if (group === null) return unchanged(layout, tasks);
      const applied = applyTabCommand(layout, bindingId, command);
      const from = group.tabs.indexOf(command.n);
      const rest = group.tabs.filter((n) => n !== command.n);
      const at =
        command.before === null ? rest.length : rest.indexOf(command.before);
      if (from === -1 || at === -1) return unchanged(layout, tasks);
      return {
        closed: [],
        layout: applied.layout,
        tasks: replaceStrip(
          tasks,
          bindingId,
          replaceGroup(strip, {
            ...group,
            tabs: [...rest.slice(0, at), command.n, ...rest.slice(at)],
          }),
        ),
      };
    }
    case "close": {
      const group = taskOf(strip, command.n);
      if (group === null) return unchanged(layout, tasks);
      const applied = applyTabCommand(layout, bindingId, command);
      const after = worktreeTabs(applied.layout, bindingId);
      if (after === null) return unchanged(layout, tasks);

      // Closing the last tab overall replaced it with a fresh one
      // (`closeTab`'s rule); the fresh ordinal takes the closed one's seat in
      // its group, so the strip keeps one chip rather than none.
      if (wt.tabs.length === 1) {
        const fresh = after.active;
        return {
          closed: applied.closed,
          layout: applied.layout,
          tasks: replaceStrip(
            tasks,
            bindingId,
            replaceGroup(strip, { ...group, active: fresh, tabs: [fresh] }),
          ),
        };
      }

      const remaining = group.tabs.filter((n) => n !== command.n);
      if (remaining.length > 0) {
        // Selection stays inside the task: the neighbour that took the closed
        // tab's place there, not whatever sat beside it in the raw layout.
        const index = group.tabs.indexOf(command.n);
        const groupActive =
          group.active === command.n
            ? remaining[Math.min(index, remaining.length - 1)]
            : group.active;
        const repaired = replaceGroup(strip, {
          ...group,
          active: groupActive,
          tabs: remaining,
        });
        const layoutActive =
          wt.active === command.n
            ? applyTabCommand(applied.layout, bindingId, {
                n: groupActive,
                type: "select",
              }).layout
            : applied.layout;
        return {
          closed: applied.closed,
          layout: layoutActive,
          tasks: replaceStrip(tasks, bindingId, repaired),
        };
      }

      // The task's last tab: the chip goes with it, and selection lands on a
      // neighbouring task's own remembered tab.
      const at = strip.groups.findIndex((g) => g.id === group.id);
      const groups = strip.groups.filter((g) => g.id !== group.id);
      const landing = groups[Math.min(at, groups.length - 1)];
      const layoutActive =
        wt.active === command.n
          ? applyTabCommand(applied.layout, bindingId, {
              n: landing.active,
              type: "select",
            }).layout
          : applied.layout;
      return {
        closed: applied.closed,
        layout: layoutActive,
        tasks: replaceStrip(tasks, bindingId, { ...strip, groups }),
      };
    }
  }
}

/** Apply one task command. Same shape, chip-level acts. */
export function applyTaskCommand(
  layout: TabLayout,
  tasks: TaskLayout,
  bindingId: string,
  command: TaskCommand,
): DeckChange {
  const pair = pairFor(layout, tasks, bindingId);
  if (pair === null) return unchanged(layout, tasks);
  const { strip, wt } = pair;

  switch (command.type) {
    case "new-task": {
      const fresh = wt.nextN;
      const applied = applyTabCommand(layout, bindingId, { type: "new" });
      const group: TaskGroup = {
        active: fresh,
        id: strip.nextId,
        name: defaultTaskName(strip.nextId),
        tabs: [fresh],
      };
      return {
        closed: applied.closed,
        layout: applied.layout,
        tasks: replaceStrip(tasks, bindingId, {
          groups: [...strip.groups, group],
          nextId: strip.nextId + 1,
        }),
      };
    }
    case "select-task": {
      const group = strip.groups.find((g) => g.id === command.id);
      if (group === null || group === undefined) {
        return unchanged(layout, replaceStrip(tasks, bindingId, strip));
      }
      const applied = applyTabCommand(layout, bindingId, {
        n: group.active,
        type: "select",
      });
      return {
        closed: [],
        layout: applied.layout,
        tasks: replaceStrip(tasks, bindingId, strip),
      };
    }
    // The chip's own name, written where it already lived. No tab moves, no
    // session ends, and the layout is returned untouched — a rename is a
    // label, and the strip that draws it is the only thing that changes.
    case "rename-task": {
      const group = strip.groups.find((g) => g.id === command.id);
      if (group === undefined) {
        return unchanged(layout, replaceStrip(tasks, bindingId, strip));
      }
      const typed = normalizeStripName(command.name);
      const name = typed === "" ? defaultTaskName(group.id) : typed;
      if (name === group.name) {
        return unchanged(layout, replaceStrip(tasks, bindingId, strip));
      }
      return {
        closed: [],
        layout,
        tasks: replaceStrip(
          tasks,
          bindingId,
          replaceGroup(strip, { ...group, name }),
        ),
      };
    }
    case "close-task": {
      const group = strip.groups.find((g) => g.id === command.id);
      if (group === undefined) {
        return unchanged(layout, replaceStrip(tasks, bindingId, strip));
      }
      const closed = group.tabs.map((n) => sessionIdFor(bindingId, n));
      const remainingTabs = wt.tabs.filter((n) => !group.tabs.includes(n));

      // Closing the last task mirrors closing the last tab: the worktree is
      // never left with an empty strip, and the fresh shell is genuinely
      // fresh — new ordinals, new sessions.
      if (remainingTabs.length === 0) {
        const fresh = wt.nextN;
        const freshGroup: TaskGroup = {
          active: fresh,
          id: strip.nextId,
          name: defaultTaskName(strip.nextId),
          tabs: [fresh],
        };
        return {
          closed,
          layout: {
            ...layout,
            [bindingId]: { active: fresh, nextN: fresh + 1, tabs: [fresh] },
          },
          tasks: replaceStrip(tasks, bindingId, {
            groups: [freshGroup],
            nextId: strip.nextId + 1,
          }),
        };
      }

      const at = strip.groups.findIndex((g) => g.id === group.id);
      const groups = strip.groups.filter((g) => g.id !== group.id);
      const landing = groups[Math.min(at, groups.length - 1)];
      const active = group.tabs.includes(wt.active)
        ? landing.active
        : wt.active;
      return {
        closed,
        layout: {
          ...layout,
          [bindingId]: { active, nextN: wt.nextN, tabs: remainingTabs },
        },
        tasks: replaceStrip(tasks, bindingId, { ...strip, groups }),
      };
    }
  }
}

/** Forget the worktrees the tab model no longer holds. The tab model already
 * named every session those worktrees were keeping (`dropWorktrees` /
 * `closeWorktrees`); this only sheds the chip data, so it closes nothing. */
export function pruneTasks(tasks: TaskLayout, layout: TabLayout): TaskLayout {
  const kept: Record<string, WorktreeTaskStrip> = {};
  let dropped = false;
  for (const [bindingId, strip] of Object.entries(tasks)) {
    if (Object.hasOwn(layout, bindingId)) kept[bindingId] = strip;
    else dropped = true;
  }
  return dropped ? kept : tasks;
}
