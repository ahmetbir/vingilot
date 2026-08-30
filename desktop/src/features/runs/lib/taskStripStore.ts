// Where the Deck's task chips live between app runs — beside the tab layout
// (`terminalTabStore.ts`), same storage arrangement, same rules: injectable
// storage, checked-not-repaired shapes, and a read that never throws.
//
// What is validated here is only the *shape* of a strip. Whether its ordinals
// still agree with the tab layout is a different question with a better
// answer: `taskStrip.ts`'s `reconcileTasks` repairs any disagreement at read
// time, so a strip that survived this parse but names a tab that is gone
// loses exactly that tab, not the whole strip — which is what a hand-repair
// here would have to reimplement, worse.

import type { StorageLike } from "./terminalTabStore.ts";
import {
  emptyTasks,
  type TaskGroup,
  type TaskLayout,
  type WorktreeTaskStrip,
} from "./taskStrip.ts";

/** Versioned like its siblings: a future shape change gets a new key. */
const TASKS_KEY = "vingilot-terminal-tasks.v1";

const NO_STORAGE: StorageLike = {
  getItem: () => null,
  setItem: () => {},
};

function defaultStorage(): StorageLike {
  return (
    (globalThis as { localStorage?: StorageLike }).localStorage ?? NO_STORAGE
  );
}

function isTaskGroup(value: unknown): value is TaskGroup {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (!Number.isInteger(v.id) || (v.id as number) < 1) return false;
  if (typeof v.name !== "string" || v.name === "") return false;
  if (!Array.isArray(v.tabs) || v.tabs.length === 0) return false;
  if (!v.tabs.every((n) => Number.isInteger(n) && (n as number) > 0)) {
    return false;
  }
  const tabs = v.tabs as number[];
  if (new Set(tabs).size !== tabs.length) return false;
  return typeof v.active === "number" && tabs.includes(v.active);
}

function isStrip(value: unknown): value is WorktreeTaskStrip {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.groups)) return false;
  if (!v.groups.every(isTaskGroup)) return false;
  const ids = (v.groups as TaskGroup[]).map((g) => g.id);
  if (new Set(ids).size !== ids.length) return false;
  if (!Number.isInteger(v.nextId)) return false;
  return ids.every((id) => id < (v.nextId as number));
}

export function parseTaskLayout(raw: string | null): TaskLayout {
  if (raw === null || raw === "") return emptyTasks();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyTasks();
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return emptyTasks();
  }
  const tasks: Record<string, WorktreeTaskStrip> = {};
  for (const [bindingId, value] of Object.entries(parsed)) {
    if (bindingId === "" || !isStrip(value)) continue;
    tasks[bindingId] = {
      groups: value.groups.map((g) => ({
        active: g.active,
        id: g.id,
        name: g.name,
        tabs: [...g.tabs],
      })),
      nextId: value.nextId,
    };
  }
  return tasks;
}

export function readTaskLayout(
  storage: StorageLike = defaultStorage(),
): TaskLayout {
  return parseTaskLayout(storage.getItem(TASKS_KEY));
}

export function writeTaskLayout(
  tasks: TaskLayout,
  storage: StorageLike = defaultStorage(),
): void {
  try {
    storage.setItem(TASKS_KEY, JSON.stringify(tasks));
  } catch {
    // Losing the chips is survivable; failing the render is not.
  }
}
