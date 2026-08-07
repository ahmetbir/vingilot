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
  const layout = { wt: { ratio: 0.45, right: "runs", solo: "right" } };
  writePaneLayout(layout, storage);
  assert.deepEqual(readPaneLayout(storage), layout);
});

test("a layout written before there were two solos still reads as one", () => {
  // The key stays v1 through the shape change on purpose: a new key would
  // silently reset every arrangement the owner has made, which is the one
  // outcome this module exists to avoid. `collapsed: true` meant the terminal
  // alone and still does.
  const layout = parsePaneLayout(
    JSON.stringify({
      hidden: { collapsed: true, ratio: 0.45, right: "runs" },
      shown: { collapsed: false, ratio: 0.45, right: "runs" },
    }),
  );
  assert.equal(layout.hidden.solo, "left");
  assert.equal(layout.hidden.ratio, 0.45);
  assert.equal(layout.shown.solo, null);
});

test("a solo this build does not recognise is the split, not a guess", () => {
  const layout = parsePaneLayout(
    JSON.stringify({
      wt: { ratio: 0.5, right: "runs", solo: "middle" },
    }),
  );
  assert.equal(layout.wt.solo, null);
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
      wt: { ratio: "wide", right: "plan", solo: "yes" },
    }),
  );
  assert.deepEqual(layout.wt, {
    ratio: DEFAULT_RATIO,
    right: "diff",
    solo: null,
  });
});

test("a ratio from outside this build's clamp is brought inside it", () => {
  const layout = parsePaneLayout(
    JSON.stringify({
      a: { ratio: 0.98, right: "diff", solo: null },
      b: { ratio: -1, right: "diff", solo: null },
    }),
  );
  assert.equal(layout.a.ratio, MAX_RATIO);
  assert.equal(layout.b.ratio, MIN_RATIO);
});

test("keys that are not arrangements are dropped", () => {
  const layout = parsePaneLayout(
    JSON.stringify({
      "": { ratio: 0.5, right: "runs", solo: null },
      list: [1, 2],
      nothing: null,
      real: { ratio: 0.5, right: "runs", solo: null },
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
      { wt: { ratio: 0.5, right: "runs", solo: null } },
      refusing,
    ),
  );
});

test("the storage key is versioned so an older build starts from defaults", () => {
  const storage = memoryStorage();
  writePaneLayout({ wt: { ratio: 0.5, right: "runs", solo: null } }, storage);
  assert.notEqual(storage.read(LAYOUT_KEY), null);
});
