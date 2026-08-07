import assert from "node:assert/strict";
import { test } from "node:test";

import { DEFAULT_RATIO, MAX_RATIO, MIN_RATIO } from "./paneModel.ts";
import {
  parsePaneLayout,
  readPaneLayout,
  writePaneLayout,
} from "./paneStore.ts";

const LAYOUT_KEY = "vingilot-panes.v1";

function memoryStorage(seed = {}) {
  const store = new Map(Object.entries(seed));
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
    read: (key) => store.get(key) ?? null,
  };
}

test("an arrangement survives the round trip", () => {
  const storage = memoryStorage();
  const layout = { wt: { collapsed: true, ratio: 0.45, right: "runs" } };
  writePaneLayout(layout, storage);
  assert.deepEqual(readPaneLayout(storage), layout);
});

test("nothing stored is no arrangement, not a broken one", () => {
  assert.deepEqual(parsePaneLayout(null), {});
  assert.deepEqual(parsePaneLayout(""), {});
  assert.deepEqual(parsePaneLayout("{not json"), {});
  assert.deepEqual(parsePaneLayout("[]"), {});
  assert.deepEqual(parsePaneLayout("42"), {});
});

test("a value this build does not recognise is coerced, never dropped whole", () => {
  const layout = parsePaneLayout(
    JSON.stringify({
      wt: { collapsed: "yes", ratio: "wide", right: "plan" },
    }),
  );
  assert.deepEqual(layout.wt, {
    collapsed: false,
    ratio: DEFAULT_RATIO,
    right: "diff",
  });
});

test("a ratio from outside this build's clamp is brought inside it", () => {
  const layout = parsePaneLayout(
    JSON.stringify({
      a: { collapsed: false, ratio: 0.98, right: "diff" },
      b: { collapsed: false, ratio: -1, right: "diff" },
    }),
  );
  assert.equal(layout.a.ratio, MAX_RATIO);
  assert.equal(layout.b.ratio, MIN_RATIO);
});

test("keys that are not arrangements are dropped", () => {
  const layout = parsePaneLayout(
    JSON.stringify({
      "": { collapsed: false, ratio: 0.5, right: "runs" },
      list: [1, 2],
      nothing: null,
      real: { collapsed: false, ratio: 0.5, right: "runs" },
      text: "runs",
    }),
  );
  assert.deepEqual(Object.keys(layout), ["real"]);
});

test("a storage that refuses the write costs the layout, not the render", () => {
  const refusing = {
    getItem: () => null,
    setItem: () => {
      throw new Error("quota");
    },
  };
  assert.doesNotThrow(() =>
    writePaneLayout(
      { wt: { collapsed: false, ratio: 0.5, right: "runs" } },
      refusing,
    ),
  );
});

test("the storage key is versioned so an older build starts from defaults", () => {
  const storage = memoryStorage();
  writePaneLayout(
    { wt: { collapsed: false, ratio: 0.5, right: "runs" } },
    storage,
  );
  assert.notEqual(storage.read(LAYOUT_KEY), null);
});
