import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseTabLayout,
  readTabLayout,
  writeTabLayout,
} from "./terminalTabStore.ts";
import {
  applyTabCommand,
  emptyLayout,
  ensureWorktree,
} from "./terminalTabs.ts";

// A minimal in-memory stand-in for `localStorage` — these tests run under
// plain `node --test`, which has no DOM.
function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

test("a layout survives a write and a read — the restart path", () => {
  let layout = ensureWorktree(emptyLayout(), "main:a");
  layout = applyTabCommand(layout, "main:a", { type: "new" }).layout;
  layout = applyTabCommand(layout, "main:a", { type: "new" }).layout;
  layout = ensureWorktree(layout, "bind-1");

  const storage = memoryStorage();
  writeTabLayout(layout, storage);
  assert.deepEqual(readTabLayout(storage), layout);
});

test("a restored strip keeps which tab was showing", () => {
  let layout = ensureWorktree(emptyLayout(), "main:a");
  layout = applyTabCommand(layout, "main:a", { type: "new" }).layout;
  layout = applyTabCommand(layout, "main:a", { n: 1, type: "select" }).layout;

  const storage = memoryStorage();
  writeTabLayout(layout, storage);
  assert.equal(readTabLayout(storage)["main:a"].active, 1);
});

test("a restored strip keeps its ordinals rather than renumbering from one", () => {
  // The ordinal is what names the tmux session. Renumbering on restore would
  // point every restored tab at a different shell than the one it showed.
  let layout = ensureWorktree(emptyLayout(), "main:a");
  layout = applyTabCommand(layout, "main:a", { type: "new" }).layout;
  layout = applyTabCommand(layout, "main:a", { n: 1, type: "close" }).layout;

  const storage = memoryStorage();
  writeTabLayout(layout, storage);
  assert.deepEqual(readTabLayout(storage)["main:a"].tabs, [2]);
});

test("nothing stored reads as an empty layout", () => {
  assert.deepEqual(readTabLayout(memoryStorage()), {});
});

test("unparseable storage reads as an empty layout rather than throwing", () => {
  assert.deepEqual(parseTabLayout("{not json"), {});
  assert.deepEqual(parseTabLayout(""), {});
  assert.deepEqual(parseTabLayout(null), {});
});

test("a stored value that is not an object of strips reads as empty", () => {
  assert.deepEqual(parseTabLayout("[]"), {});
  assert.deepEqual(parseTabLayout("42"), {});
  assert.deepEqual(parseTabLayout("null"), {});
});

test("a corrupt strip is dropped while its neighbours are kept", () => {
  const raw = JSON.stringify({
    "main:a": { active: 1, nextN: 2, tabs: [1] },
    "main:b": { active: 7, nextN: 2, tabs: [1] },
  });
  assert.deepEqual(parseTabLayout(raw), {
    "main:a": { active: 1, nextN: 2, tabs: [1] },
  });
});

test("a strip with no tabs is dropped rather than restored as an empty worktree", () => {
  const raw = JSON.stringify({ "main:a": { active: 1, nextN: 2, tabs: [] } });
  assert.deepEqual(parseTabLayout(raw), {});
});

test("a strip whose next ordinal would reuse a live tab's is dropped", () => {
  // Restoring this would hand the next new tab the session id of a tab that
  // is already open — two tabs, one shell, both echoing the other.
  const raw = JSON.stringify({
    "main:a": { active: 2, nextN: 2, tabs: [1, 2] },
  });
  assert.deepEqual(parseTabLayout(raw), {});
});

test("non-integer, negative, and duplicate ordinals are all refused", () => {
  for (const tabs of [[1.5], [-1], [0], [1, 1], ["1"]]) {
    const raw = JSON.stringify({ "main:a": { active: 1, nextN: 99, tabs } });
    assert.deepEqual(parseTabLayout(raw), {}, JSON.stringify(tabs));
  }
});

test("a storage that refuses the write costs the next restart its strips and nothing else", () => {
  const refusing = {
    getItem: () => null,
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
  };
  assert.doesNotThrow(() =>
    writeTabLayout(ensureWorktree(emptyLayout(), "main:a"), refusing),
  );
});
