import assert from "node:assert/strict";
import { test } from "node:test";
import { readWorktreeStats, usableStat } from "./worktreeStat.ts";

const answered = {
  additions: 12,
  changedFiles: 3,
  deletions: 4,
  dirty: true,
  path: "/w/fix",
  unreadable: false,
  untracked: 2,
};

test("a well-formed batch reads through unchanged", () => {
  assert.deepEqual(readWorktreeStats([answered]), [answered]);
});

test("anything that is not an array is no stats, never a throw", () => {
  for (const value of [null, undefined, {}, "[]", 3]) {
    assert.deepEqual(readWorktreeStats(value), []);
  }
});

test("a record without a path or a dirty flag says nothing usable and is dropped", () => {
  const kept = readWorktreeStats([
    { ...answered, path: 7 },
    { ...answered, dirty: "yes" },
    null,
    answered,
  ]);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].path, "/w/fix");
});

test("a missing count is zero and a nonsense one does not survive as itself", () => {
  const [stat] = readWorktreeStats([
    { deletions: -4, dirty: true, path: "/w/odd", untracked: Number.NaN },
  ]);
  assert.deepEqual(stat, {
    additions: 0,
    changedFiles: 0,
    deletions: 0,
    dirty: true,
    path: "/w/odd",
    unreadable: false,
    untracked: 0,
  });
});

test("an unreadable worktree is not a clean one", () => {
  // Both arrive with every count at zero. Reading the first as the second
  // puts the word "clean" under a worktree nobody looked inside.
  const unread = { ...answered, dirty: false, unreadable: true };
  assert.equal(usableStat(unread), null);
  assert.equal(usableStat(undefined), null);
  assert.equal(usableStat({ ...answered, dirty: false }).dirty, false);
});
