import assert from "node:assert/strict";
import { test } from "node:test";

import {
  activeView,
  clearActiveView,
  closeView,
  emptyViews,
  openView,
  pruneViews,
  selectView,
  viewId,
  viewLabel,
  viewTitle,
  worktreeViews,
} from "./viewTabs.ts";

const WT = "local:wt-1";

const FILE = { kind: "file", line: null, path: "src/main.rs" };
const OTHER = { kind: "file", line: null, path: "src/lib.rs" };
const COMMIT = { hash: "a".repeat(40), kind: "commit", short: "aaaaaaa" };

function views(layout) {
  return worktreeViews(layout, WT);
}

test("opening a view puts it in the strip and shows it", () => {
  const layout = openView(emptyViews(), WT, FILE);
  assert.equal(views(layout).tabs.length, 1);
  assert.equal(activeView(views(layout)).subject.path, "src/main.rs");
});

test("opening the same file twice is one tab, not two", () => {
  // The rule every editor keeps, and the one that stops a tree the owner is
  // clicking through from filling the strip.
  let layout = openView(emptyViews(), WT, FILE);
  layout = openView(layout, WT, OTHER);
  layout = openView(layout, WT, FILE);
  assert.equal(views(layout).tabs.length, 2);
  assert.equal(activeView(views(layout)).subject.path, "src/main.rs");
});

test("re-opening a file at a line moves inside the tab that is there", () => {
  // A line is not part of a file's identity: "show me main.rs:40" while
  // main.rs is open is a jump, never a second tab for one file.
  let layout = openView(emptyViews(), WT, FILE);
  layout = openView(layout, WT, { ...FILE, line: 40 });
  assert.equal(views(layout).tabs.length, 1);
  assert.equal(activeView(views(layout)).subject.line, 40);
});

test("a commit and a diff are their own kinds of view", () => {
  let layout = openView(emptyViews(), WT, COMMIT);
  layout = openView(layout, WT, { base: "origin/main", kind: "diff" });
  assert.equal(views(layout).tabs.length, 2);
  assert.equal(viewId(COMMIT), `commit:${"a".repeat(40)}`);
  assert.equal(
    viewId({ base: "origin/main", kind: "diff" }),
    "diff:origin/main",
  );
});

test("closing the showing view falls back to a neighbour, then to the shells", () => {
  // A view has no pty behind it, so the honest landing place when the last one
  // closes is the terminals — which were never gone.
  let layout = openView(emptyViews(), WT, FILE);
  layout = openView(layout, WT, OTHER);
  layout = closeView(layout, WT, viewId(OTHER));
  assert.equal(views(layout).active, viewId(FILE));
  layout = closeView(layout, WT, viewId(FILE));
  assert.equal(views(layout).active, null);
  assert.deepEqual(views(layout).tabs, []);
});

test("closing a view that is not showing leaves the selection where it is", () => {
  let layout = openView(emptyViews(), WT, FILE);
  layout = openView(layout, WT, OTHER);
  layout = closeView(layout, WT, viewId(FILE));
  assert.equal(views(layout).active, viewId(OTHER));
  assert.equal(views(layout).tabs.length, 1);
});

test("clearing the selection keeps the tabs — the shells come forward, nothing closes", () => {
  // What every gesture that touches a SHELL does on its way: ⌘T, a tab click,
  // ⌥⌘→. The reading is still one click away afterwards.
  let layout = openView(emptyViews(), WT, FILE);
  layout = clearActiveView(layout, WT);
  assert.equal(views(layout).active, null);
  assert.equal(views(layout).tabs.length, 1);
  assert.equal(activeView(views(layout)), null);
  // And it is idempotent: a second shell gesture writes nothing.
  assert.equal(clearActiveView(layout, WT), layout);
});

test("selecting a view id nothing holds changes nothing", () => {
  const layout = openView(emptyViews(), WT, FILE);
  assert.equal(selectView(layout, WT, "file:nowhere"), layout);
  assert.equal(closeView(layout, WT, "file:nowhere"), layout);
});

test("a worktree nobody has opened a view in reads as empty, never as null", () => {
  const empty = worktreeViews(emptyViews(), "unvisited");
  assert.deepEqual(empty.tabs, []);
  assert.equal(empty.active, null);
  assert.equal(activeView(empty), null);
});

test("worktrees that left the workspace are forgotten, and the rest untouched", () => {
  let layout = openView(emptyViews(), WT, FILE);
  layout = openView(layout, "gone", OTHER);
  const kept = pruneViews(layout, [WT]);
  assert.deepEqual(Object.keys(kept), [WT]);
  // Reference-stable when nothing drops, so a caller mirroring it does not
  // write on a no-op.
  assert.equal(pruneViews(kept, [WT]), kept);
});

test("a tab says what it is: a basename in the strip, the whole path on hover", () => {
  assert.equal(viewLabel(FILE), "main.rs");
  assert.equal(viewTitle(FILE), "src/main.rs");
  assert.equal(viewTitle({ ...FILE, line: 12 }), "src/main.rs:12");
  assert.equal(viewLabel(COMMIT), "aaaaaaa");
  assert.equal(viewTitle(COMMIT), "commit aaaaaaa");
  assert.equal(viewLabel({ base: "HEAD", kind: "diff" }), "diff");
  assert.equal(
    viewTitle({ base: "HEAD", kind: "diff" }),
    "working tree against HEAD",
  );
  // A file at the root of the checkout has no slash to cut at.
  assert.equal(
    viewLabel({ kind: "file", line: null, path: "README.md" }),
    "README.md",
  );
});
