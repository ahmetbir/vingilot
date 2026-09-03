import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyTabCommand,
  closeWorktrees,
  dropWorktrees,
  emptyLayout,
  ensureWorktree,
  layoutSessions,
  sessionIdFor,
  tabName,
  worktreeTabs,
} from "./terminalTabs.ts";

/** A worktree with `count` tabs open, the first one showing. */
function withTabs(bindingId, count) {
  let layout = ensureWorktree(emptyLayout(), bindingId);
  for (let i = 1; i < count; i++) {
    layout = applyTabCommand(layout, bindingId, { type: "new" }).layout;
  }
  return applyTabCommand(layout, bindingId, { n: 1, type: "select" }).layout;
}

function tabsOf(layout, bindingId) {
  return worktreeTabs(layout, bindingId)?.tabs;
}

function activeOf(layout, bindingId) {
  return worktreeTabs(layout, bindingId)?.active;
}

test("a session id joins a worktree to a tab ordinal", () => {
  assert.equal(sessionIdFor("main:a", 1), "main:a#1");
});

test("a session id is unique per (worktree, ordinal), even for an id containing the separator", () => {
  const ids = [
    sessionIdFor("main:a", 1),
    sessionIdFor("main:a", 2),
    sessionIdFor("main:a", 11),
    sessionIdFor("main:b", 1),
    // A binding id that already ends in a separator and digits: the pair is
    // still recoverable because an ordinal never contains a separator, so the
    // last one is always the one the join added.
    sessionIdFor("main:a#1", 1),
    sessionIdFor("main:a#1", 2),
  ];
  assert.equal(new Set(ids).size, ids.length);
});

test("visiting a worktree gives it one tab, showing", () => {
  const layout = ensureWorktree(emptyLayout(), "main:a");
  assert.deepEqual(tabsOf(layout, "main:a"), [1]);
  assert.equal(activeOf(layout, "main:a"), 1);
});

test("revisiting a worktree leaves the strip the owner arranged alone", () => {
  const opened = withTabs("main:a", 3);
  const moved = applyTabCommand(opened, "main:a", {
    n: 3,
    type: "select",
  }).layout;
  assert.equal(ensureWorktree(moved, "main:a"), moved);
});

test("a worktree with no tabs open has none", () => {
  assert.equal(worktreeTabs(emptyLayout(), "main:a"), null);
});

test("a new tab lands at the end of the strip and shows", () => {
  const layout = applyTabCommand(
    ensureWorktree(emptyLayout(), "main:a"),
    "main:a",
    { type: "new" },
  ).layout;
  assert.deepEqual(tabsOf(layout, "main:a"), [1, 2]);
  assert.equal(activeOf(layout, "main:a"), 2);
});

test("a new tab never reuses a closed tab's ordinal", () => {
  // Reuse would hand a fresh tab the session id of a shell whose kill may
  // still be in flight — the owner's own scrollback, from the shell they
  // just closed.
  let layout = withTabs("main:a", 2);
  layout = applyTabCommand(layout, "main:a", { n: 2, type: "close" }).layout;
  layout = applyTabCommand(layout, "main:a", { type: "new" }).layout;
  assert.deepEqual(tabsOf(layout, "main:a"), [1, 3]);
});

test("closing a tab names the session that really ended", () => {
  const layout = withTabs("main:a", 2);
  const { closed } = applyTabCommand(layout, "main:a", { n: 2, type: "close" });
  assert.deepEqual(closed, ["main:a#2"]);
});

test("closing the showing tab selects the one that took its place", () => {
  let layout = withTabs("main:a", 3);
  layout = applyTabCommand(layout, "main:a", { n: 2, type: "select" }).layout;
  layout = applyTabCommand(layout, "main:a", { n: 2, type: "close" }).layout;
  assert.deepEqual(tabsOf(layout, "main:a"), [1, 3]);
  assert.equal(activeOf(layout, "main:a"), 3);
});

test("closing the last tab in the strip selects the new rightmost one", () => {
  let layout = withTabs("main:a", 3);
  layout = applyTabCommand(layout, "main:a", { n: 3, type: "select" }).layout;
  layout = applyTabCommand(layout, "main:a", { n: 3, type: "close" }).layout;
  assert.equal(activeOf(layout, "main:a"), 2);
});

test("closing a background tab does not move the selection", () => {
  let layout = withTabs("main:a", 3);
  layout = applyTabCommand(layout, "main:a", { n: 2, type: "select" }).layout;
  layout = applyTabCommand(layout, "main:a", { n: 3, type: "close" }).layout;
  assert.equal(activeOf(layout, "main:a"), 2);
});

test("closing the only tab replaces it with a fresh one rather than emptying the strip", () => {
  // A worktree with no tabs would strand its Terminal surface with nothing in
  // it and no affordance to get a shell back — the only one that makes a tab
  // lives in the strip that just disappeared.
  const layout = ensureWorktree(emptyLayout(), "main:a");
  const change = applyTabCommand(layout, "main:a", { n: 1, type: "close" });
  assert.deepEqual(change.closed, ["main:a#1"]);
  assert.deepEqual(tabsOf(change.layout, "main:a"), [2]);
  assert.equal(activeOf(change.layout, "main:a"), 2);
});

test("the tab that replaces the last one is a different session, not the same shell back", () => {
  const layout = ensureWorktree(emptyLayout(), "main:a");
  const { closed, layout: next } = applyTabCommand(layout, "main:a", {
    n: 1,
    type: "close",
  });
  const [fresh] = layoutSessions(next);
  assert.equal(sessionIdFor(fresh.bindingId, fresh.n), "main:a#2");
  assert.equal(closed.includes("main:a#2"), false);
});

test("closing a tab that is not in the strip changes nothing and closes nothing", () => {
  const layout = withTabs("main:a", 2);
  const change = applyTabCommand(layout, "main:a", { n: 9, type: "close" });
  assert.equal(change.layout, layout);
  assert.deepEqual(change.closed, []);
});

test("selecting a tab that is not in the strip is refused rather than showing nothing", () => {
  const layout = withTabs("main:a", 2);
  const next = applyTabCommand(layout, "main:a", {
    n: 9,
    type: "select",
  }).layout;
  assert.equal(activeOf(next, "main:a"), 1);
});

test("stepping moves the selection one tab along", () => {
  const layout = withTabs("main:a", 3);
  const right = applyTabCommand(layout, "main:a", {
    dir: 1,
    type: "step",
  }).layout;
  assert.equal(activeOf(right, "main:a"), 2);
});

test("stepping wraps at both ends", () => {
  const layout = withTabs("main:a", 3);
  const left = applyTabCommand(layout, "main:a", {
    dir: -1,
    type: "step",
  }).layout;
  assert.equal(activeOf(left, "main:a"), 3);
  const around = applyTabCommand(left, "main:a", {
    dir: 1,
    type: "step",
  }).layout;
  assert.equal(activeOf(around, "main:a"), 1);
});

test("stepping a one-tab strip is a harmless no-op, not a broken key", () => {
  const layout = ensureWorktree(emptyLayout(), "main:a");
  const next = applyTabCommand(layout, "main:a", {
    dir: 1,
    type: "step",
  }).layout;
  assert.equal(activeOf(next, "main:a"), 1);
});

test("stepping follows the strip's order, not the ordinals", () => {
  let layout = withTabs("main:a", 3);
  // Put tab 3 at the front: 3, 1, 2.
  layout = applyTabCommand(layout, "main:a", { n: 3, type: "select" }).layout;
  layout = applyTabCommand(layout, "main:a", { dir: -1, type: "move" }).layout;
  layout = applyTabCommand(layout, "main:a", { dir: -1, type: "move" }).layout;
  assert.deepEqual(tabsOf(layout, "main:a"), [3, 1, 2]);
  const next = applyTabCommand(layout, "main:a", {
    dir: 1,
    type: "step",
  }).layout;
  assert.equal(activeOf(next, "main:a"), 1);
});

test("moving reorders the strip and keeps the same tab showing", () => {
  let layout = withTabs("main:a", 3);
  layout = applyTabCommand(layout, "main:a", { n: 2, type: "select" }).layout;
  const next = applyTabCommand(layout, "main:a", {
    dir: 1,
    type: "move",
  }).layout;
  assert.deepEqual(tabsOf(next, "main:a"), [1, 3, 2]);
  assert.equal(activeOf(next, "main:a"), 2);
});

test("moving is clamped at either end rather than wrapping", () => {
  const layout = withTabs("main:a", 3);
  const stuck = applyTabCommand(layout, "main:a", {
    dir: -1,
    type: "move",
  }).layout;
  assert.deepEqual(tabsOf(stuck, "main:a"), [1, 2, 3]);
});

test("a reorder never renames a session", () => {
  // The ordinal names the shell; the position names nothing. If a move
  // renumbered tabs, every tab past the moved one would attach to a different
  // shell than the one it was showing.
  let layout = withTabs("main:a", 3);
  const before = layoutSessions(layout).map((s) =>
    sessionIdFor(s.bindingId, s.n),
  );
  layout = applyTabCommand(layout, "main:a", { dir: 1, type: "move" }).layout;
  const after = layoutSessions(layout).map((s) =>
    sessionIdFor(s.bindingId, s.n),
  );
  assert.deepEqual([...after].sort(), [...before].sort());
});

test("a command for a worktree with no strip is dropped, not a second way to open one", () => {
  const change = applyTabCommand(emptyLayout(), "main:a", { type: "new" });
  assert.deepEqual(change.layout, {});
  assert.deepEqual(change.closed, []);
});

test("every open tab of every worktree is listed, each worktree in strip order", () => {
  let layout = withTabs("main:a", 2);
  layout = ensureWorktree(layout, "main:b");
  const sessions = layoutSessions(layout).map((s) =>
    sessionIdFor(s.bindingId, s.n),
  );
  assert.deepEqual(
    sessions.filter((id) => id.startsWith("main:a")),
    ["main:a#1", "main:a#2"],
  );
  assert.deepEqual(
    sessions.filter((id) => id.startsWith("main:b")),
    ["main:b#1"],
  );
});

test("a worktree that left the workspace takes every one of its tabs with it", () => {
  let layout = withTabs("main:a", 2);
  layout = ensureWorktree(layout, "bind-1");
  const change = dropWorktrees(layout, ["main:a"]);
  assert.deepEqual(Object.keys(change.layout), ["main:a"]);
  assert.deepEqual(change.closed, ["bind-1#1"]);
});

test("a worktree merely switched away from keeps its tabs and its shells", () => {
  const layout = withTabs("main:a", 2);
  const change = dropWorktrees(layout, ["main:a", "main:b"]);
  assert.equal(change.layout, layout);
  assert.deepEqual(change.closed, []);
});

test("an empty live set is read as 'the workspace has not answered', not 'everything was removed'", () => {
  const layout = withTabs("main:a", 3);
  const change = dropWorktrees(layout, []);
  assert.equal(change.layout, layout);
  assert.deepEqual(change.closed, []);
});

test("removing a project closes every tab of every worktree it owned", () => {
  let layout = withTabs("main:a", 2);
  layout = ensureWorktree(layout, "bind-1");
  layout = ensureWorktree(layout, "main:b");
  const change = closeWorktrees(layout, ["main:a", "bind-1"]);
  assert.deepEqual(Object.keys(change.layout), ["main:b"]);
  assert.deepEqual(change.closed, ["main:a#1", "main:a#2", "bind-1#1"]);
});

test("closing worktrees that hold no tabs changes nothing", () => {
  const layout = withTabs("main:a", 2);
  const change = closeWorktrees(layout, ["main:b"]);
  assert.equal(change.layout, layout);
  assert.deepEqual(change.closed, []);
});

test("an empty removal list is a no-op, not a close-everything", () => {
  const layout = withTabs("main:a", 2);
  const change = closeWorktrees(layout, []);
  assert.equal(change.layout, layout);
  assert.deepEqual(change.closed, []);
});

test("a drag names a destination, and moves nothing but a list of numbers", () => {
  // The keyboard's `move` walks one position; a pointer names where it landed
  // (redesign P4.7, item 3). Nothing about a session moves either way: the
  // ordinal IS the pty's name, so a reorder rewrites an order and no id.
  let layout = withTabs("main:a", 3);
  const before = layoutSessions(layout).map((s) =>
    sessionIdFor(s.bindingId, s.n),
  );
  layout = applyTabCommand(layout, "main:a", {
    before: 1,
    n: 3,
    type: "reorder",
  }).layout;
  assert.deepEqual(tabsOf(layout, "main:a"), [3, 1, 2]);
  // Same three sessions, same three names.
  assert.deepEqual(
    layoutSessions(layout)
      .map((s) => sessionIdFor(s.bindingId, s.n))
      .sort(),
    [...before].sort(),
  );
  // And the selection is untouched: dragging arranges the strip, it does not
  // choose what to look at.
  assert.equal(activeOf(layout, "main:a"), 1);
});

test("a drag to the end, onto itself, or onto nothing", () => {
  const layout = withTabs("main:a", 3);
  assert.deepEqual(
    tabsOf(
      applyTabCommand(layout, "main:a", { before: null, n: 1, type: "reorder" })
        .layout,
      "main:a",
    ),
    [2, 3, 1],
  );
  // A tab dropped on itself, and a drop naming a tab that is not there: both
  // change nothing rather than guessing.
  assert.equal(
    applyTabCommand(layout, "main:a", { before: 2, n: 2, type: "reorder" })
      .layout,
    layout,
  );
  assert.equal(
    applyTabCommand(layout, "main:a", { before: 9, n: 2, type: "reorder" })
      .layout,
    layout,
  );
  assert.equal(
    applyTabCommand(layout, "main:a", { before: 1, n: 9, type: "reorder" })
      .layout,
    layout,
  );
});

test("a reorder closes nothing", () => {
  const change = applyTabCommand(withTabs("main:a", 3), "main:a", {
    before: 1,
    n: 2,
    type: "reorder",
  });
  assert.deepEqual(change.closed, []);
});

test("a new tab does not forget the names the other tabs were given", () => {
  // The bug this pins: `addTab` returned a fresh literal instead of spreading
  // the strip, so `names` went with it — one new tab, and every name in that
  // worktree was gone. It cost nothing and logged nothing; the labels were
  // simply not there at the next render, which is why the owner reported it as
  // names disappearing "sometimes".
  //
  // Opening a task goes through this same path, which is why one defect
  // answered for both halves of the report.
  let layout = ensureWorktree({}, "wt");
  layout = applyTabCommand(layout, "wt", {
    n: 1,
    name: "cargo watch",
    type: "rename",
  }).layout;
  assert.equal(tabName(worktreeTabs(layout, "wt"), 1), "cargo watch");

  const after = applyTabCommand(layout, "wt", { type: "new" }).layout;
  const wt = worktreeTabs(after, "wt");

  assert.equal(tabName(wt, 1), "cargo watch");
  // And the new ordinal is nameless, wearing its number as the strip's header
  // says it should.
  assert.equal(tabName(wt, wt.active), null);
});
