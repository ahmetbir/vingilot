import assert from "node:assert/strict";
import { test } from "node:test";
import { readWorktreeStats, usableStat } from "./worktreeStat.ts";

const answered = {
  additions: 12,
  changedFiles: 3,
  deletions: 4,
  dirty: true,
  path: "/w/fix",
  paths: ["src/app.ts", "src/auth.ts", "notes.md"],
  pathsTruncated: false,
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
    // No `paths` field at all — silence about which files changed, which is
    // not the same as the empty list below.
    paths: null,
    pathsTruncated: false,
    unreadable: false,
    untracked: 0,
  });
});

test("a record with no paths field is silent, not a worktree that changed nothing", () => {
  // The distinction the overlap mark rests on. `[]` says "nothing changed
  // here" and agrees with every other worktree that it shares no files; a
  // record that never carried the field made no such claim, and coercing it
  // to `[]` would put words in git's mouth. Same rule as `unreadable` one
  // level up.
  const [missing] = readWorktreeStats([{ dirty: true, path: "/w/old" }]);
  assert.equal(missing.paths, null);

  const [clean] = readWorktreeStats([
    { dirty: false, path: "/w/clean", paths: [] },
  ]);
  assert.deepEqual(clean.paths, []);
  assert.notEqual(clean.paths, null);

  // A `paths` that is not a list is unreadable, so it is silence too.
  for (const value of ["src/app.ts", 3, {}, null]) {
    const [odd] = readWorktreeStats([
      { dirty: true, path: "/w/odd", paths: value },
    ]);
    assert.equal(odd.paths, null);
  }
});

test("one unusable path does not cost the caller the others", () => {
  // The same tolerance `readWorktreeDiff` keeps for file records: a list that
  // arrived is an answer, and one bad entry in it is dropped rather than
  // discarding the entry it came with.
  const [stat] = readWorktreeStats([
    { dirty: true, path: "/w/fix", paths: ["src/app.ts", "", 7, "notes.md"] },
  ]);
  assert.deepEqual(stat.paths, ["src/app.ts", "notes.md"]);
});

test("a truncated path list is flagged, and only when the backend says so", () => {
  const [cut] = readWorktreeStats([
    { dirty: true, path: "/w/big", paths: ["a.ts"], pathsTruncated: true },
  ]);
  assert.equal(cut.pathsTruncated, true);
  // Anything other than a real `true` is not a claim that the list was cut.
  for (const value of [undefined, "true", 1, null]) {
    const [whole] = readWorktreeStats([
      { dirty: true, path: "/w/small", paths: ["a.ts"], pathsTruncated: value },
    ]);
    assert.equal(whole.pathsTruncated, false);
  }
});

test("an unreadable worktree is not a clean one", () => {
  // Both arrive with every count at zero. Reading the first as the second
  // puts the word "clean" under a worktree nobody looked inside.
  const unread = { ...answered, dirty: false, unreadable: true };
  assert.equal(usableStat(unread), null);
  assert.equal(usableStat(undefined), null);
  assert.equal(usableStat({ ...answered, dirty: false }).dirty, false);
});
