import assert from "node:assert/strict";
import { test } from "node:test";
import { worktreeOverlaps } from "./worktreeOverlap.ts";

/** A worktree that answered. The default `truncated: false` is the ordinary
 * case; the two truncation tests below pass it explicitly. */
function answered(bindingId, label, paths, truncated = false) {
  return { bindingId, label, paths, truncated };
}

/** A worktree nothing has answered about — `paths: null`, which is the one
 * input this module treats as silence rather than as an empty set. */
function silent(bindingId, label) {
  return { bindingId, label, paths: null, truncated: false };
}

test("two worktrees that changed the same files name each other", () => {
  const overlaps = worktreeOverlaps([
    answered("wt-a", "fix-login", ["src/app.ts", "src/auth.ts", "README.md"]),
    answered("wt-b", "spike-ui", ["src/app.ts", "src/auth.ts", "src/ui.tsx"]),
  ]);

  assert.equal(overlaps.size, 2);
  const a = overlaps.get("wt-a");
  // Sorted, and only the shared files — `README.md` is A's alone.
  assert.deepEqual(a.files, ["src/app.ts", "src/auth.ts"]);
  assert.deepEqual(
    a.peers.map((peer) => peer.bindingId),
    ["wt-b"],
  );
  assert.equal(a.sentence, "2 files also changed in spike-ui");
  // The sentence provokes "which ones?", so the title answers it.
  assert.equal(
    a.detail,
    "2 files also changed in spike-ui: src/app.ts, src/auth.ts",
  );
  // The relation is symmetric, and each side names the OTHER.
  assert.equal(
    overlaps.get("wt-b").sentence,
    "2 files also changed in fix-login",
  );
});

test("one shared file is said in the singular", () => {
  // "1 files also changed" is read as a typo by everyone who reads it, which
  // costs the surface the same credibility a wrong dot does.
  const overlaps = worktreeOverlaps([
    answered("wt-a", "fix-login", ["src/app.ts"]),
    answered("wt-b", "spike-ui", ["src/app.ts"]),
  ]);
  assert.equal(
    overlaps.get("wt-a").sentence,
    "1 file also changed in spike-ui",
  );
});

test("worktrees that share nothing get no entry at all", () => {
  // Not an entry with an empty `peers` — a renderer must not be able to draw
  // an empty mark by forgetting to check.
  const overlaps = worktreeOverlaps([
    answered("wt-a", "fix-login", ["src/app.ts"]),
    answered("wt-b", "spike-ui", ["src/ui.tsx"]),
  ]);
  assert.equal(overlaps.size, 0);
});

test("a worktree nothing has answered about draws nothing and is named by nobody", () => {
  // The honesty rule this module exists for: `paths: null` is silence, not an
  // empty set. An empty set would silently AGREE that it shares no files with
  // anyone, which is a claim nothing made.
  const overlaps = worktreeOverlaps([
    answered("wt-a", "fix-login", ["src/app.ts"]),
    silent("wt-b", "spike-ui"),
  ]);
  assert.equal(overlaps.size, 0);

  // And with a third worktree that DID answer, the silent one is neither a
  // mark-holder nor a peer — the mark comes only from two real answers.
  const withThird = worktreeOverlaps([
    answered("wt-a", "fix-login", ["src/app.ts"]),
    silent("wt-b", "spike-ui"),
    answered("wt-c", "hotfix", ["src/app.ts"]),
  ]);
  assert.deepEqual([...withThird.keys()].sort(), ["wt-a", "wt-c"]);
  assert.equal(withThird.get("wt-a").sentence, "1 file also changed in hotfix");
  assert.equal(
    withThird.get("wt-c").sentence,
    "1 file also changed in fix-login",
  );
});

test("a worktree that answered with no changes is an answer, and shares nothing", () => {
  // The other side of the rule above: `[]` IS an answer, and it correctly
  // produces no overlap. The two must not be conflated in either direction.
  const overlaps = worktreeOverlaps([
    answered("wt-a", "fix-login", []),
    answered("wt-b", "spike-ui", []),
  ]);
  assert.equal(overlaps.size, 0);
});

test("a worktree overlapping two others names both, in a stable order", () => {
  const overlaps = worktreeOverlaps([
    answered("wt-a", "fix-login", ["src/app.ts", "src/auth.ts"]),
    answered("wt-b", "spike-ui", ["src/app.ts"]),
    answered("wt-c", "hotfix", ["src/auth.ts"]),
  ]);

  const a = overlaps.get("wt-a");
  // Ordered by label — "hotfix" before "spike-ui" — not by input order, so a
  // reordered poll does not reword the row.
  assert.deepEqual(
    a.peers.map((peer) => peer.label),
    ["hotfix", "spike-ui"],
  );
  assert.equal(
    a.sentence,
    "1 file also changed in hotfix; 1 file also changed in spike-ui",
  );
  // Both files, distinct and sorted.
  assert.deepEqual(a.files, ["src/app.ts", "src/auth.ts"]);
  // B and C share nothing with each other, so each names only A.
  assert.deepEqual(
    overlaps.get("wt-b").peers.map((peer) => peer.bindingId),
    ["wt-a"],
  );
  assert.deepEqual(
    overlaps.get("wt-c").peers.map((peer) => peer.bindingId),
    ["wt-a"],
  );
});

test("one file shared with two worktrees is one file, not two", () => {
  // `files` describes this tree; `peers` describes the pairs. Counting the
  // pairs would report "2 files" over a single overlapping file.
  const overlaps = worktreeOverlaps([
    answered("wt-a", "fix-login", ["src/app.ts"]),
    answered("wt-b", "spike-ui", ["src/app.ts"]),
    answered("wt-c", "hotfix", ["src/app.ts"]),
  ]);
  assert.deepEqual(overlaps.get("wt-a").files, ["src/app.ts"]);
  assert.equal(overlaps.get("wt-a").peers.length, 2);
});

test("a cut list says at least, because the number is then a floor", () => {
  // An existential claim off a subset is still true; a total is not. The
  // truncation of EITHER side is enough to make the count a floor.
  const overlaps = worktreeOverlaps([
    answered("wt-a", "fix-login", ["src/app.ts"], true),
    answered("wt-b", "spike-ui", ["src/app.ts"]),
  ]);
  assert.equal(
    overlaps.get("wt-a").sentence,
    "at least 1 file also changed in spike-ui",
  );
  // The side that was not cut is reading a cut peer, so it hedges too.
  assert.equal(
    overlaps.get("wt-b").sentence,
    "at least 1 file also changed in fix-login",
  );
});

test("a path listed twice by one worktree is still one file", () => {
  const overlaps = worktreeOverlaps([
    answered("wt-a", "fix-login", ["src/app.ts", "src/app.ts"]),
    answered("wt-b", "spike-ui", ["src/app.ts"]),
  ]);
  assert.equal(
    overlaps.get("wt-a").sentence,
    "1 file also changed in spike-ui",
  );
  assert.deepEqual(overlaps.get("wt-b").files, ["src/app.ts"]);
});

test("a long list of shared files is counted exactly and named in part", () => {
  // The count stays exact — nothing is hidden, only unlisted, because forty
  // paths in a tooltip is a tooltip nobody reads.
  const many = Array.from({ length: 12 }, (_, index) => `src/f${index}.ts`);
  const overlaps = worktreeOverlaps([
    answered("wt-a", "fix-login", many),
    answered("wt-b", "spike-ui", many),
  ]);
  const a = overlaps.get("wt-a");
  assert.equal(a.sentence, "12 files also changed in spike-ui");
  assert.match(a.detail, /and 4 more$/);
  assert.equal(a.files.length, 12);
});

test("a single worktree overlaps nothing, and neither does an empty workspace", () => {
  assert.equal(worktreeOverlaps([]).size, 0);
  assert.equal(
    worktreeOverlaps([answered("wt-a", "fix-login", ["src/app.ts"])]).size,
    0,
  );
});
