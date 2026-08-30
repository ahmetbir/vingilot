// The snapshot a chat route's ⌘K reads
// (vingilot/docs/plans/2026-08-12-an-ide-of-a-kind.md, Task 2).

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  EMPTY_WORLD,
  MAX_RECENT_FILES,
  parseWorld,
  publishPlaces,
  readWorld,
  rememberFile,
  resetWorld,
  withRecentFile,
} from "./paletteWorld.ts";

function memory(seed = null) {
  let held = seed;
  return {
    getItem: () => held,
    read: () => held,
    setItem: (_key, value) => {
      held = value;
    },
  };
}

test("a missing, unparseable or wrongly-shaped store reads as empty", () => {
  // Never a throw: this runs during the render that puts the shell on screen.
  assert.deepEqual(parseWorld(null), EMPTY_WORLD);
  assert.deepEqual(parseWorld(""), EMPTY_WORLD);
  assert.deepEqual(parseWorld("{not json"), EMPTY_WORLD);
  assert.deepEqual(parseWorld("[1,2,3]"), EMPTY_WORLD);
  assert.deepEqual(parseWorld('{"projects":"nope"}'), EMPTY_WORLD);
});

test("a row missing the fields a palette row needs is dropped, not defaulted", () => {
  // A project with no name would draw a row with no label — findable by
  // nothing, and a navigation to somewhere he cannot read.
  const held = parseWorld(
    JSON.stringify({
      projects: [{ id: "p1" }, { id: "p2", name: "buzz", path: "/b" }],
      recentFiles: [{ path: "src/main.rs" }],
      worktrees: [{ bindingId: "w1" }],
    }),
  );
  assert.deepEqual(held.projects, [{ id: "p2", name: "buzz", path: "/b" }]);
  assert.deepEqual(held.worktrees, []);
  assert.deepEqual(held.recentFiles, []);
});

test("a recent file moves to the front rather than being listed twice", () => {
  const one = { line: null, path: "src/main.rs", worktree: "/w" };
  const two = { line: 12, path: "src/lib.rs", worktree: "/w" };
  const after = withRecentFile(withRecentFile([], one), two);
  assert.deepEqual(after, [two, one]);
  const again = withRecentFile(after, { ...one, line: 3 });
  assert.deepEqual(again, [{ ...one, line: 3 }, two]);
});

test("the same path in two checkouts is two files", () => {
  // Two checkouts of one project both have src/main.rs; deduping on the path
  // alone would silently drop one of them.
  const left = { line: null, path: "src/main.rs", worktree: "/a" };
  const right = { line: null, path: "src/main.rs", worktree: "/b" };
  assert.deepEqual(withRecentFile([left], right), [right, left]);
});

test("the list is capped", () => {
  let held = [];
  for (let at = 0; at < MAX_RECENT_FILES + 5; at += 1) {
    held = withRecentFile(held, { line: null, path: `f${at}`, worktree: "/w" });
  }
  assert.equal(held.length, MAX_RECENT_FILES);
  assert.equal(held[0].path, `f${MAX_RECENT_FILES + 4}`);
});

test("what the workspace publishes is what a cold shell reads back", () => {
  resetWorld();
  const store = memory();
  publishPlaces(
    [{ id: "p1", name: "vingilot", path: "/v" }],
    [
      {
        bindingId: "w1",
        clean: true,
        detail: "the project's checkout",
        label: "main",
        repoId: "p1",
      },
    ],
    store,
  );
  rememberFile({ line: 9, path: "src/main.rs", worktree: "/v" }, store);
  // A different process, reading the same storage: the case that matters is a
  // cold start on a chat route, which has never mounted the workspace.
  resetWorld();
  const cold = readWorld(store);
  assert.deepEqual(cold.projects, [{ id: "p1", name: "vingilot", path: "/v" }]);
  assert.equal(cold.worktrees[0].label, "main");
  // The repo relation and git's answer ride the snapshot (P1.1 veto 4).
  assert.equal(cold.worktrees[0].repoId, "p1");
  assert.equal(cold.worktrees[0].clean, true);
  assert.deepEqual(cold.recentFiles, [
    { line: 9, path: "src/main.rs", worktree: "/v" },
  ]);
});

test("publishing the same places twice writes once", () => {
  // Called from a screen that re-renders on a 2s poll, with both arrays rebuilt
  // every time; a write per tick would be a subscriber notification per tick.
  resetWorld();
  const store = memory();
  let writes = 0;
  const counting = {
    getItem: store.getItem,
    setItem: (key, value) => {
      writes += 1;
      store.setItem(key, value);
    },
  };
  const projects = [{ id: "p1", name: "vingilot", path: "/v" }];
  publishPlaces(projects, [], counting);
  publishPlaces([...projects], [], counting);
  publishPlaces([{ id: "p1", name: "vingilot", path: "/v" }], [], counting);
  assert.equal(writes, 1);
});

test("a storage that refuses the write costs a snapshot and not the render", () => {
  resetWorld();
  const refusing = {
    getItem: () => null,
    setItem: () => {
      throw new Error("quota");
    },
  };
  publishPlaces([{ id: "p1", name: "v", path: "/v" }], [], refusing);
  // Still in memory for this run, which is the half that can be kept.
  assert.equal(readWorld(refusing).projects.length, 1);
});
