import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_RECENTS,
  parseRecents,
  readRecents,
  withRecent,
  writeRecents,
} from "./paletteStore.ts";

/** The `localStorage` shim `paneStore.test.mjs` uses, for the same reason:
 * `node --test` has no DOM, and asserting against what was *stored* is the
 * only way to know the round trip works. */
function shim(seed = {}) {
  const cells = { ...seed };
  return {
    cells,
    getItem: (key) => cells[key] ?? null,
    setItem: (key, value) => {
      cells[key] = value;
    },
  };
}

test("running something moves it to the front without duplicating it", () => {
  assert.deepEqual(withRecent(["a", "b"], "c"), ["c", "a", "b"]);
  assert.deepEqual(withRecent(["a", "b", "c"], "c"), ["c", "a", "b"]);
  assert.deepEqual(withRecent([], "a"), ["a"]);
});

test("the list is capped, and it is the oldest that falls off", () => {
  let recents = [];
  for (let n = 0; n < MAX_RECENTS + 4; n += 1) {
    recents = withRecent(recents, `id-${n}`);
  }
  assert.equal(recents.length, MAX_RECENTS);
  assert.equal(recents[0], `id-${MAX_RECENTS + 3}`);
  assert.equal(recents.at(-1), `id-4`);
});

test("what is written is what comes back", () => {
  const storage = shim();
  writeRecents(["pane:diff", "project:p1"], storage);
  assert.deepEqual(readRecents(storage), ["pane:diff", "project:p1"]);
});

test("nothing stored reads as no recents, not as a throw", () => {
  assert.deepEqual(readRecents(shim()), []);
  assert.deepEqual(parseRecents(null), []);
  assert.deepEqual(parseRecents(""), []);
});

test("a wrongly-shaped or unparseable store reads as empty", () => {
  assert.deepEqual(parseRecents("{ not json"), []);
  assert.deepEqual(parseRecents('{"recents":["a"]}'), []);
  assert.deepEqual(parseRecents("42"), []);
});

test("junk inside the list is dropped and the rest survives", () => {
  assert.deepEqual(parseRecents('["a", 7, "", null, "b", "a"]'), ["a", "b"]);
});

test("an over-long stored list is capped on the way in as well as out", () => {
  const long = JSON.stringify(
    Array.from({ length: MAX_RECENTS + 5 }, (_, n) => `id-${n}`),
  );
  assert.equal(parseRecents(long).length, MAX_RECENTS);
  const storage = shim();
  writeRecents(JSON.parse(long), storage);
  assert.equal(
    JSON.parse(storage.cells["vingilot-palette.v1"]).length,
    MAX_RECENTS,
  );
});

test("a storage that refuses the write costs the next restart and nothing else", () => {
  const refusing = {
    getItem: () => null,
    setItem: () => {
      throw new Error("quota");
    },
  };
  assert.doesNotThrow(() => writeRecents(["a"], refusing));
});
