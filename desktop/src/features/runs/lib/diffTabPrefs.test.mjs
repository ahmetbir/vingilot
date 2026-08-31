import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import {
  getDiffTabPrefs,
  parseDiffTabPrefs,
  resetDiffTabPrefsForTests,
  setDiffTabPref,
  subscribeDiffTabPrefs,
} from "./diffTabPrefs.ts";
import {
  getResolvedNotes,
  resetResolvedNotesForTests,
  serverResolvedNotes,
  setNoteResolved,
} from "./reviewResolvedStore.ts";

beforeEach(() => {
  resetDiffTabPrefsForTests();
  resetResolvedNotesForTests();
});

test("the defaults hide nothing and wrap nothing", () => {
  // A diff that hid lines it was never asked to hide would be answering a
  // question the owner did not ask.
  assert.deepEqual(getDiffTabPrefs(), { ignoreWhitespace: false, wrap: false });
});

test("a record from another build reads as the defaults rather than throwing", () => {
  for (const stored of [null, undefined, "", "not json", "[]", "3"]) {
    assert.deepEqual(
      parseDiffTabPrefs(stored),
      { ignoreWhitespace: false, wrap: false },
      String(stored),
    );
  }
  assert.deepEqual(parseDiffTabPrefs('{"wrap":true}'), {
    ignoreWhitespace: false,
    wrap: true,
  });
  // Anything that is not the literal `true` is false, so a future shape cannot
  // turn a filter on by accident.
  assert.deepEqual(parseDiffTabPrefs('{"wrap":"yes"}'), {
    ignoreWhitespace: false,
    wrap: false,
  });
});

test("a change is recorded once and everybody reading it is told", () => {
  let told = 0;
  const stop = subscribeDiffTabPrefs(() => {
    told += 1;
  });
  setDiffTabPref("ignoreWhitespace", true);
  assert.equal(told, 1);
  assert.equal(getDiffTabPrefs().ignoreWhitespace, true);
  // Setting it to what it already is is not a change and wakes nobody.
  setDiffTabPref("ignoreWhitespace", true);
  assert.equal(told, 1);
  setDiffTabPref("wrap", true);
  assert.equal(told, 2);
  assert.deepEqual(getDiffTabPrefs(), { ignoreWhitespace: true, wrap: true });
  stop();
});

test("resolved notes are a set of event ids, and the empty snapshot is stable", () => {
  assert.equal(getResolvedNotes().size, 0);
  setNoteResolved("abc", true);
  assert.equal(getResolvedNotes().has("abc"), true);
  setNoteResolved("abc", false);
  assert.equal(getResolvedNotes().has("abc"), false);
  // `useSyncExternalStore` compares snapshots by identity; a fresh Set each
  // call is an infinite render.
  assert.equal(serverResolvedNotes(), serverResolvedNotes());
});
