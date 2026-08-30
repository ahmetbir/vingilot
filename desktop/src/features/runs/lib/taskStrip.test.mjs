import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ensureWorktree,
  emptyLayout,
  sessionIdFor,
  worktreeTabs,
} from "./terminalTabs.ts";
import {
  applyDeckTabCommand,
  applyTaskCommand,
  emptyTasks,
  pruneTasks,
  reconcileTasks,
  stripView,
  taskOf,
} from "./taskStrip.ts";

const WT = "local:wt-1";

function opened() {
  return { layout: ensureWorktree(emptyLayout(), WT), tasks: emptyTasks() };
}

function strip(state) {
  const wt = worktreeTabs(state.layout, WT);
  return reconcileTasks(state.tasks[WT] ?? null, wt);
}

test("a worktree's first terminal reconciles into one task holding it", () => {
  const { layout } = opened();
  const wt = worktreeTabs(layout, WT);
  const s = reconcileTasks(null, wt);
  assert.equal(s.groups.length, 1);
  assert.deepEqual(s.groups[0].tabs, [1]);
  assert.equal(s.groups[0].active, 1);
  assert.match(s.groups[0].name, /task 1/);
});

test("reconcile is idempotent and reference-stable when nothing needs repair", () => {
  const { layout } = opened();
  const wt = worktreeTabs(layout, WT);
  const once = reconcileTasks(null, wt);
  assert.equal(reconcileTasks(once, wt), once);
});

test("a new task is a fresh shell in a fresh chip, and it shows", () => {
  let state = opened();
  state = applyTaskCommand(state.layout, state.tasks, WT, { type: "new-task" });
  const wt = worktreeTabs(state.layout, WT);
  const s = strip(state);
  assert.equal(s.groups.length, 2);
  assert.deepEqual(s.groups[1].tabs, [2]);
  assert.equal(wt.active, 2);
  assert.equal(taskOf(s, wt.active).id, s.groups[1].id);
  assert.deepEqual(state.closed, []);
});

test("a new tab joins the task the owner is in, not a new chip", () => {
  let state = opened();
  state = applyTaskCommand(state.layout, state.tasks, WT, { type: "new-task" });
  state = applyDeckTabCommand(state.layout, state.tasks, WT, { type: "new" });
  const s = strip(state);
  assert.equal(s.groups.length, 2);
  assert.deepEqual(s.groups[1].tabs, [2, 3]);
});

test("the tab bar shows only the active task's tabs", () => {
  let state = opened();
  state = applyTaskCommand(state.layout, state.tasks, WT, { type: "new-task" });
  state = applyDeckTabCommand(state.layout, state.tasks, WT, { type: "new" });
  const wt = worktreeTabs(state.layout, WT);
  const view = stripView(wt, strip(state));
  assert.deepEqual(view.tabs, [2, 3]);
  assert.equal(view.active, 3);
});

test("selecting a task lands on its own remembered tab", () => {
  let state = opened();
  state = applyTaskCommand(state.layout, state.tasks, WT, { type: "new-task" });
  const first = strip(state).groups[0];
  state = applyTaskCommand(state.layout, state.tasks, WT, {
    id: first.id,
    type: "select-task",
  });
  assert.equal(worktreeTabs(state.layout, WT).active, 1);
});

test("stepping wraps within the task and never leaves it", () => {
  let state = opened();
  state = applyDeckTabCommand(state.layout, state.tasks, WT, { type: "new" }); // task 1: [1,2]
  state = applyTaskCommand(state.layout, state.tasks, WT, { type: "new-task" }); // task 2: [3]
  state = applyTaskCommand(state.layout, state.tasks, WT, {
    id: strip(state).groups[0].id,
    type: "select-task",
  });
  // active = 2 (task 1's remembered tab). Step forward: wraps to 1, not 3.
  state = applyDeckTabCommand(state.layout, state.tasks, WT, {
    dir: 1,
    type: "step",
  });
  assert.equal(worktreeTabs(state.layout, WT).active, 1);
  state = applyDeckTabCommand(state.layout, state.tasks, WT, {
    dir: -1,
    type: "step",
  });
  assert.equal(worktreeTabs(state.layout, WT).active, 2);
});

test("closing a tab keeps selection inside its task", () => {
  let state = opened();
  state = applyDeckTabCommand(state.layout, state.tasks, WT, { type: "new" }); // [1,2]
  state = applyTaskCommand(state.layout, state.tasks, WT, { type: "new-task" }); // [3]
  state = applyTaskCommand(state.layout, state.tasks, WT, {
    id: strip(state).groups[0].id,
    type: "select-task",
  });
  state = applyDeckTabCommand(state.layout, state.tasks, WT, {
    n: 2,
    type: "close",
  });
  assert.deepEqual(state.closed, [sessionIdFor(WT, 2)]);
  const wt = worktreeTabs(state.layout, WT);
  assert.equal(wt.active, 1);
  assert.deepEqual(strip(state).groups[0].tabs, [1]);
});

test("closing a task's last tab closes the chip and lands on a neighbour task", () => {
  let state = opened();
  state = applyTaskCommand(state.layout, state.tasks, WT, { type: "new-task" }); // task2: [2], active
  state = applyDeckTabCommand(state.layout, state.tasks, WT, {
    n: 2,
    type: "close",
  });
  const s = strip(state);
  assert.equal(s.groups.length, 1);
  assert.equal(worktreeTabs(state.layout, WT).active, 1);
});

test("closing a whole task really ends every session it held", () => {
  let state = opened();
  state = applyTaskCommand(state.layout, state.tasks, WT, { type: "new-task" }); // task2: [2]
  state = applyDeckTabCommand(state.layout, state.tasks, WT, { type: "new" }); // task2: [2,3]
  const doomed = strip(state).groups[1];
  state = applyTaskCommand(state.layout, state.tasks, WT, {
    id: doomed.id,
    type: "close-task",
  });
  assert.deepEqual(state.closed, [sessionIdFor(WT, 2), sessionIdFor(WT, 3)]);
  const wt = worktreeTabs(state.layout, WT);
  assert.deepEqual(wt.tabs, [1]);
  assert.equal(wt.active, 1);
  assert.equal(strip(state).groups.length, 1);
});

test("closing the last task replaces it with a fresh one, never an empty strip", () => {
  let state = opened();
  const only = strip(state).groups[0];
  state = applyTaskCommand(state.layout, state.tasks, WT, {
    id: only.id,
    type: "close-task",
  });
  assert.deepEqual(state.closed, [sessionIdFor(WT, 1)]);
  const wt = worktreeTabs(state.layout, WT);
  assert.deepEqual(wt.tabs, [2]);
  const s = strip(state);
  assert.equal(s.groups.length, 1);
  assert.deepEqual(s.groups[0].tabs, [2]);
  assert.notEqual(s.groups[0].id, only.id);
});

test("a task id is never reused after its task closes", () => {
  let state = opened();
  state = applyTaskCommand(state.layout, state.tasks, WT, { type: "new-task" });
  const second = strip(state).groups[1];
  state = applyTaskCommand(state.layout, state.tasks, WT, {
    id: second.id,
    type: "close-task",
  });
  state = applyTaskCommand(state.layout, state.tasks, WT, { type: "new-task" });
  const third = strip(state).groups[1];
  assert.ok(third.id > second.id);
});

test("a stored strip meeting a newer tab layout adopts the strays and drops the dead", () => {
  const { layout } = opened();
  let state = { layout, tasks: emptyTasks() };
  state = applyDeckTabCommand(state.layout, state.tasks, WT, { type: "new" }); // [1,2]
  // A strip that knows about a tab that no longer exists, and not about 2.
  const stale = {
    groups: [{ active: 9, id: 1, name: "task 1", tabs: [9, 1] }],
    nextId: 2,
  };
  const wt = worktreeTabs(state.layout, WT);
  const repaired = reconcileTasks(stale, wt);
  assert.deepEqual(repaired.groups.flatMap((g) => g.tabs).sort(), [1, 2]);
  assert.equal(taskOf(repaired, 2) === null, false);
});

test("tasks for a worktree the tab model dropped are forgotten", () => {
  const { layout, tasks } = opened();
  const state = applyDeckTabCommand(layout, tasks, WT, { type: "new" });
  const pruned = pruneTasks(state.tasks, {});
  assert.deepEqual(pruned, {});
  assert.equal(pruneTasks(state.tasks, state.layout), state.tasks);
});

test("a command for a worktree with no strip is dropped", () => {
  const change = applyTaskCommand(emptyLayout(), emptyTasks(), WT, {
    type: "new-task",
  });
  assert.deepEqual(change.layout, {});
  assert.deepEqual(change.closed, []);
});
