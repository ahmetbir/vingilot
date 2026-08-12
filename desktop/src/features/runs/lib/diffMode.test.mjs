import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import {
  effectiveDiffMode,
  getDiffMode,
  parseDiffMode,
  resetDiffModeForTests,
  setDiffMode,
  subscribeDiffMode,
} from "./diffMode.ts";

beforeEach(() => {
  resetDiffModeForTests();
});

test("the default is unified, which is the layout that always fits", () => {
  assert.equal(getDiffMode(), "unified");
  // Split is the wide-screen luxury; a default nobody chose has to be the one
  // that works in a 435px side pane.
  assert.equal(parseDiffMode(null), "unified");
  assert.equal(parseDiffMode(""), "unified");
  assert.equal(parseDiffMode(undefined), "unified");
});

test("a stored value from a future build reads as the default rather than throwing", () => {
  for (const stored of ["inline", "SPLIT", "{}", "0"]) {
    assert.equal(parseDiffMode(stored), "unified", stored);
  }
  assert.equal(parseDiffMode("split"), "split");
  assert.equal(parseDiffMode("unified"), "unified");
});

test("the choice is one flag, and everybody reading it is told", () => {
  // Two panes read this store (Diff and History) and they are never in one
  // subtree, so the notification is the only thing that keeps them agreeing.
  let told = 0;
  const stop = subscribeDiffMode(() => {
    told += 1;
  });
  setDiffMode("split");
  assert.equal(getDiffMode(), "split");
  assert.equal(told, 1);
  // Setting it to what it already is tells nobody: a no-op that re-rendered two
  // panes of patch would be a store that costs more than it holds.
  setDiffMode("split");
  assert.equal(told, 1);
  setDiffMode("unified");
  assert.equal(told, 2);
  stop();
  setDiffMode("split");
  assert.equal(told, 2);
});

test("a pane too narrow for two columns declines the choice without forgetting it", () => {
  // The behaviour: he chooses split at full-screen diff view, presses shift alt
  // cmd B back to the split surface and gets unified because 435px cannot hold
  // two columns — and pressing it again gives him split back, unchosen a second
  // time. Clearing the flag would be the app un-choosing it while he watched.
  setDiffMode("split");
  assert.equal(effectiveDiffMode(getDiffMode(), false), "unified");
  assert.equal(getDiffMode(), "split");
  assert.equal(effectiveDiffMode(getDiffMode(), true), "split");
});

test("a wide pane does not turn split on by itself", () => {
  assert.equal(effectiveDiffMode("unified", true), "unified");
  assert.equal(effectiveDiffMode("unified", false), "unified");
});
