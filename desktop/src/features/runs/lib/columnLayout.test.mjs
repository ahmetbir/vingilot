import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LANDING_KEY,
  columnsFor,
  isCollapsed,
  parseColumnLayout,
  readColumnLayout,
  toggleColumn,
  withColumn,
  writeColumnLayout,
} from "./columnLayout.ts";

function memoryStorage(seed = {}) {
  const store = new Map(Object.entries(seed));
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
    store,
  };
}

test("an unknown key is everything expanded", () => {
  assert.deepEqual(columnsFor({}, "repo-1"), {
    sidebar: false,
    worktrees: false,
  });
  assert.equal(isCollapsed({}, LANDING_KEY, "sidebar"), false);
});

test("collapsing one column leaves the other alone", () => {
  const layout = withColumn({}, "repo-1", "worktrees", true);
  assert.deepEqual(columnsFor(layout, "repo-1"), {
    sidebar: false,
    worktrees: true,
  });
});

test("each project keeps its own collapse state", () => {
  let layout = withColumn({}, "repo-1", "sidebar", true);
  layout = withColumn(layout, "repo-2", "worktrees", true);
  assert.equal(isCollapsed(layout, "repo-1", "sidebar"), true);
  assert.equal(isCollapsed(layout, "repo-1", "worktrees"), false);
  assert.equal(isCollapsed(layout, "repo-2", "sidebar"), false);
  assert.equal(isCollapsed(layout, "repo-2", "worktrees"), true);
});

test("the landing view is a key like any other", () => {
  const layout = withColumn({}, LANDING_KEY, "sidebar", true);
  assert.equal(isCollapsed(layout, LANDING_KEY, "sidebar"), true);
  assert.equal(isCollapsed(layout, "repo-1", "sidebar"), false);
});

test("setting a flag to what it already is returns the same layout", () => {
  const collapsed = withColumn({}, "repo-1", "sidebar", true);
  assert.equal(withColumn(collapsed, "repo-1", "sidebar", true), collapsed);

  // The identity here is what keeps a caller that mirrors the layout into
  // storage on every change from writing on a no-op.
  const empty = {};
  assert.equal(withColumn(empty, "repo-1", "worktrees", false), empty);
});

test("toggle flips exactly one flag of one key", () => {
  let layout = toggleColumn({}, "repo-1", "sidebar");
  assert.equal(isCollapsed(layout, "repo-1", "sidebar"), true);
  layout = toggleColumn(layout, "repo-1", "sidebar");
  assert.equal(isCollapsed(layout, "repo-1", "sidebar"), false);
});

test("withColumn does not mutate the layout it was given", () => {
  const layout = withColumn({}, "repo-1", "sidebar", true);
  const next = withColumn(layout, "repo-1", "worktrees", true);
  assert.equal(isCollapsed(layout, "repo-1", "worktrees"), false);
  assert.equal(isCollapsed(next, "repo-1", "worktrees"), true);
});

test("missing, empty, and unparseable storage read as everything expanded", () => {
  assert.deepEqual(parseColumnLayout(null), {});
  assert.deepEqual(parseColumnLayout(""), {});
  assert.deepEqual(parseColumnLayout("{"), {});
  assert.deepEqual(parseColumnLayout("[]"), {});
  assert.deepEqual(parseColumnLayout("null"), {});
  assert.deepEqual(parseColumnLayout('"collapsed"'), {});
});

test("only a literal true collapses a column", () => {
  const layout = parseColumnLayout(
    JSON.stringify({
      "repo-1": { sidebar: "true", worktrees: 1 },
      "repo-2": { sidebar: true },
    }),
  );
  assert.deepEqual(layout, { "repo-2": { sidebar: true, worktrees: false } });
});

test("keys whose value is not an object are dropped", () => {
  const layout = parseColumnLayout(
    JSON.stringify({
      "": { sidebar: true },
      "repo-1": ["sidebar"],
      "repo-2": 7,
      "repo-3": null,
      "repo-4": { worktrees: true },
    }),
  );
  assert.deepEqual(layout, { "repo-4": { sidebar: false, worktrees: true } });
});

test("a fully expanded key is not kept — it says nothing", () => {
  assert.deepEqual(
    parseColumnLayout(
      JSON.stringify({ "repo-1": { sidebar: false, worktrees: false } }),
    ),
    {},
  );
});

test("a layout survives a write and a read", () => {
  const storage = memoryStorage();
  let layout = withColumn({}, "repo-1", "worktrees", true);
  layout = withColumn(layout, LANDING_KEY, "sidebar", true);
  writeColumnLayout(layout, storage);
  assert.deepEqual(readColumnLayout(storage), layout);
});

test("a storage that refuses the write does not throw", () => {
  const refusing = {
    getItem: () => null,
    setItem: () => {
      throw new Error("quota");
    },
  };
  assert.doesNotThrow(() =>
    writeColumnLayout(
      { "repo-1": { sidebar: true, worktrees: false } },
      refusing,
    ),
  );
});

test("hand-edited storage costs the collapse state, not the screen", () => {
  const storage = memoryStorage({ "vingilot-columns.v1": "not json" });
  assert.deepEqual(readColumnLayout(storage), {});
});
