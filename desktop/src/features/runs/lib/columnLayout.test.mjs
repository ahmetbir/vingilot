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
  assert.deepEqual(columnsFor({}, "repo-1"), { sidebar: false });
  assert.equal(isCollapsed({}, LANDING_KEY, "sidebar"), false);
});

test("each project keeps its own collapse state", () => {
  const layout = withColumn({}, "repo-1", "sidebar", true);
  assert.equal(isCollapsed(layout, "repo-1", "sidebar"), true);
  assert.equal(isCollapsed(layout, "repo-2", "sidebar"), false);
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
  assert.equal(withColumn(empty, "repo-1", "sidebar", false), empty);
});

test("toggle flips exactly one flag of one key", () => {
  let layout = toggleColumn({}, "repo-1", "sidebar");
  assert.equal(isCollapsed(layout, "repo-1", "sidebar"), true);
  layout = toggleColumn(layout, "repo-1", "sidebar");
  assert.equal(isCollapsed(layout, "repo-1", "sidebar"), false);
});

test("withColumn does not mutate the layout it was given", () => {
  const layout = withColumn({}, "repo-1", "sidebar", true);
  const next = withColumn(layout, "repo-2", "sidebar", true);
  assert.equal(isCollapsed(layout, "repo-2", "sidebar"), false);
  assert.equal(isCollapsed(next, "repo-2", "sidebar"), true);
  assert.equal(isCollapsed(next, "repo-1", "sidebar"), true);
});

test("missing, empty, and unparseable storage read as everything expanded", () => {
  assert.deepEqual(parseColumnLayout(null), {});
  assert.deepEqual(parseColumnLayout(""), {});
  assert.deepEqual(parseColumnLayout("{"), {});
  assert.deepEqual(parseColumnLayout("[]"), {});
  assert.deepEqual(parseColumnLayout("null"), {});
  assert.deepEqual(parseColumnLayout('"collapsed"'), {});
});

test("only a literal true collapses the sidebar", () => {
  const layout = parseColumnLayout(
    JSON.stringify({
      "repo-1": { sidebar: "true" },
      "repo-2": { sidebar: true },
    }),
  );
  assert.deepEqual(layout, { "repo-2": { sidebar: true } });
});

test("keys whose value is not an object are dropped", () => {
  const layout = parseColumnLayout(
    JSON.stringify({
      "": { sidebar: true },
      "repo-1": ["sidebar"],
      "repo-2": 7,
      "repo-3": null,
      "repo-4": { sidebar: true },
    }),
  );
  assert.deepEqual(layout, { "repo-4": { sidebar: true } });
});

test("a fully expanded key is not kept — it says nothing", () => {
  assert.deepEqual(
    parseColumnLayout(JSON.stringify({ "repo-1": { sidebar: false } })),
    {},
  );
});

test("a layout survives a write and a read", () => {
  const storage = memoryStorage();
  let layout = withColumn({}, "repo-1", "sidebar", true);
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
    writeColumnLayout({ "repo-1": { sidebar: true } }, refusing),
  );
});

test("hand-edited storage costs the collapse state, not the screen", () => {
  const storage = memoryStorage({ "vingilot-columns.v2": "not json" });
  assert.deepEqual(readColumnLayout(storage), {});
});

// The tests below are the two discard decisions this file has carried, which
// are the parts of it that are decisions rather than mechanism.
//
// First (2026-08-11-one-column-design.md §3): `worktrees` became `nav`, the
// key was versioned to `.v2`, and `.v1` is never read again.
//
// Second (2026-08-14-single-sidebar.md, Task 2): `nav` itself is retired —
// the workspace nav lives inside the app sidebar now, which the `sidebar`
// flag already covers. A stored `nav: true` is discarded, not migrated, and
// the key stays `.v2` because the shape only narrowed: an older build reading
// a newer layout finds `nav` absent and starts the nav expanded (the safe
// direction), while this build reading an older layout keeps the `sidebar`
// preference the owner actually still has.

test("a layout written by the two-column build is not read by this one", () => {
  const storage = memoryStorage({
    "vingilot-columns.v1": JSON.stringify({
      "repo-1": { sidebar: true, worktrees: true },
    }),
  });
  assert.deepEqual(readColumnLayout(storage), {});
});

test("writing this build's layout leaves the old key where it was", () => {
  // Deliberate: an older build must still find its own layout. The discard is
  // "never read again", not "deleted".
  const before = JSON.stringify({
    "repo-1": { sidebar: true, worktrees: true },
  });
  const storage = memoryStorage({ "vingilot-columns.v1": before });
  writeColumnLayout(withColumn({}, "repo-1", "sidebar", true), storage);
  assert.equal(storage.store.get("vingilot-columns.v1"), before);
  assert.deepEqual(JSON.parse(storage.store.get("vingilot-columns.v2")), {
    "repo-1": { sidebar: true },
  });
});

test("a stored nav flag collapses nothing — discarded, not migrated", () => {
  // What a machine that ran the ⇧⌘B build has under `.v2` right now. The
  // sidebar preference survives; the nav flag says nothing this build
  // understands and must not become a sidebar that is quietly collapsed.
  assert.deepEqual(
    parseColumnLayout(
      JSON.stringify({
        "repo-1": { nav: true, sidebar: false },
        "repo-2": { nav: true, sidebar: true },
      }),
    ),
    { "repo-2": { sidebar: true } },
  );
});

test("the two-column member name collapses nothing either", () => {
  assert.deepEqual(
    parseColumnLayout(
      JSON.stringify({ "repo-1": { sidebar: false, worktrees: true } }),
    ),
    {},
  );
});
