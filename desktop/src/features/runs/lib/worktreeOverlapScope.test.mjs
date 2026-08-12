// The two rules `worktreeOverlaps` cannot enforce for itself, proved here:
// **one repository per comparison**, and **what counts as an answer**.
//
// `worktreeOverlap.test.mjs` owns the intersection itself — pairing, ordering,
// plurals, the "at least" of a cut list, the silence of a `paths: null`. It is
// handed one already-assembled list, so it can say nothing about how that list
// was drawn. The assembly is where a workspace-wide mistake lives: put two
// projects in one call and every repository with a `README.md` marks every row
// (the boundary), or drop `pathsTruncated` on the way in and a floor is
// reported as a total (the truncation join). Both are single lines, both were
// invisible to every other layer's tests, and both are falsified below.

import assert from "node:assert/strict";
import { test } from "node:test";
import { overlapsByRepo } from "./worktreeOverlapScope.ts";

const REPOS = [
  { id: "repo-a", name: "alpha", path: "/tmp/alpha" },
  { id: "repo-b", name: "beta", path: "/tmp/beta" },
];

/** A coordinator worktree row, with only the fields this derivation reads:
 * the binding id it is filed under and the branch `worktreeSummary` labels it
 * by. The rest is filled in so the record is a real `Worktree`. */
function worktree(bindingId, branch, repoId) {
  return {
    added: null,
    base_commit: "0".repeat(40),
    binding_id: bindingId,
    branch,
    commit_sha: null,
    lifecycle: "active",
    owner_run_id: bindingId,
    owner_run_objective: null,
    owner_run_status: null,
    removed: null,
    repo_id: repoId,
    role: "task",
  };
}

function grouped(byRepo) {
  return { byRepo, unknown: [] };
}

/** git's answer for one worktree. `paths` present means it answered. */
function stat(paths, extra = {}) {
  return {
    additions: paths.length,
    changedFiles: paths.length,
    deletions: 0,
    dirty: paths.length > 0,
    path: "/tmp/wherever",
    paths,
    pathsTruncated: false,
    unreadable: false,
    untracked: 0,
    ...extra,
  };
}

test("two projects that changed the same file are not in conflict", () => {
  // The one thing this must not do. `src/app.ts` and `README.md` exist in
  // both repositories, and in a real workspace so do a hundred other paths —
  // comparing across projects would put a mark on nearly every row.
  const overlaps = overlapsByRepo({
    grouped: grouped({
      "repo-a": [worktree("wt-a1", "fix-login", "repo-a")],
      "repo-b": [worktree("wt-b1", "other-work", "repo-b")],
    }),
    repos: REPOS,
    stats: {
      "wt-a1": stat(["src/app.ts", "README.md"]),
      "wt-b1": stat(["src/app.ts", "README.md"]),
    },
  });

  assert.equal(overlaps.size, 0);
});

test("a project's own worktrees are still compared, alongside another project's", () => {
  // The other half of the same rule: scoping per repo must not cost a repo
  // its real overlaps. Both projects have a colliding pair of their own, and
  // neither pair may name the other project's branches.
  const overlaps = overlapsByRepo({
    grouped: grouped({
      "repo-a": [
        worktree("wt-a1", "fix-login", "repo-a"),
        worktree("wt-a2", "spike-ui", "repo-a"),
      ],
      "repo-b": [
        worktree("wt-b1", "other-work", "repo-b"),
        worktree("wt-b2", "other-spike", "repo-b"),
      ],
    }),
    repos: REPOS,
    stats: {
      "wt-a1": stat(["src/app.ts", "src/auth.ts", "README.md"]),
      "wt-a2": stat(["src/app.ts", "src/ui.tsx"]),
      "wt-b1": stat(["src/app.ts", "README.md"]),
      "wt-b2": stat(["README.md"]),
    },
  });

  assert.deepEqual([...overlaps.keys()].sort(), [
    "wt-a1",
    "wt-a2",
    "wt-b1",
    "wt-b2",
  ]);

  const a1 = overlaps.get("wt-a1");
  assert.deepEqual(a1.files, ["src/app.ts"]);
  assert.deepEqual(
    a1.peers.map((peer) => peer.label),
    ["spike-ui"],
  );
  assert.equal(a1.sentence, "1 file also changed in spike-ui");

  // repo-b's pair collides on `README.md` only — `src/app.ts` is wt-b1's alone
  // *within its own project*, however many worktrees of repo-a touched it.
  const b1 = overlaps.get("wt-b1");
  assert.deepEqual(b1.files, ["README.md"]);
  assert.deepEqual(
    b1.peers.map((peer) => peer.label),
    ["other-spike"],
  );
});

test("a worktree of a repo not in `repos` is compared against nothing", () => {
  // `grouped.byRepo` can carry a project this render does not have a `Repo`
  // for — a project just forgotten, or one whose rows arrived before the
  // workspace snapshot naming it did. `repos` is what the render is willing to
  // speak about, and the loop is driven by it for that reason.
  //
  // The hazard is that the orphan group is compared *internally*: iterating
  // `grouped.byRepo`'s own keys still scopes each group to itself (a group
  // carries its own boundary), so what leaks is not a cross-project comparison
  // but a mark on rows the screen has no project for. Which is why `repo-gone`
  // holds TWO worktrees sharing a file below: with one, it could not produce
  // an overlap under any implementation, and this test would pass whatever the
  // loop iterated.
  const overlaps = overlapsByRepo({
    grouped: grouped({
      "repo-a": [worktree("wt-a1", "fix-login", "repo-a")],
      "repo-gone": [
        worktree("wt-g1", "stale-one", "repo-gone"),
        worktree("wt-g2", "stale-two", "repo-gone"),
      ],
    }),
    repos: [REPOS[0]],
    stats: {
      "wt-a1": stat(["src/app.ts"]),
      "wt-g1": stat(["src/app.ts"]),
      "wt-g2": stat(["src/app.ts"]),
    },
  });

  // Not 2 (the orphan pair marking each other), and not 3 (that pair plus a
  // comparison that also crossed into repo-a). Nothing.
  assert.equal(overlaps.size, 0);
});

test("a truncated path list reaches the model, so the sentence says at least", () => {
  // The join between three layers that each argue this separately: `stat.rs`
  // cuts the list and flags it, `worktreeStat.ts` carries the flag, and
  // `worktreeOverlap.ts` words the sentence "at least". Severing it here
  // reports a floor as a total.
  const overlaps = overlapsByRepo({
    grouped: grouped({
      "repo-a": [
        worktree("wt-a1", "fix-login", "repo-a"),
        worktree("wt-a2", "spike-ui", "repo-a"),
      ],
    }),
    repos: [REPOS[0]],
    stats: {
      "wt-a1": stat(["src/app.ts", "src/auth.ts"], { pathsTruncated: true }),
      "wt-a2": stat(["src/app.ts", "src/auth.ts"]),
    },
  });

  // Both sides are worded from the floor — the peer whose own list was
  // complete still cannot claim a total against a subset.
  assert.equal(
    overlaps.get("wt-a1").sentence,
    "at least 2 files also changed in spike-ui",
  );
  assert.equal(
    overlaps.get("wt-a2").sentence,
    "at least 2 files also changed in fix-login",
  );
});

test("an untruncated pair says the count flat", () => {
  // The control for the case above: without the flag there is no hedge, so a
  // build that hard-coded "at least" everywhere is caught too.
  const overlaps = overlapsByRepo({
    grouped: grouped({
      "repo-a": [
        worktree("wt-a1", "fix-login", "repo-a"),
        worktree("wt-a2", "spike-ui", "repo-a"),
      ],
    }),
    repos: [REPOS[0]],
    stats: {
      "wt-a1": stat(["src/app.ts", "src/auth.ts"]),
      "wt-a2": stat(["src/app.ts", "src/auth.ts"]),
    },
  });

  assert.equal(
    overlaps.get("wt-a1").sentence,
    "2 files also changed in spike-ui",
  );
});

test("an unreadable stat is silence, not an empty tree", () => {
  // `usableStat` and not `stats[id]`: git had no answer for wt-a2, and the
  // path list riding along on that record is not a reading of anything. Read
  // raw it would mark two rows off a claim nobody made.
  const overlaps = overlapsByRepo({
    grouped: grouped({
      "repo-a": [
        worktree("wt-a1", "fix-login", "repo-a"),
        worktree("wt-a2", "unreadable", "repo-a"),
      ],
    }),
    repos: [REPOS[0]],
    stats: {
      "wt-a1": stat(["src/app.ts"]),
      "wt-a2": stat(["src/app.ts"], { unreadable: true }),
    },
  });

  assert.equal(overlaps.size, 0);
});

test("a worktree nothing has answered about neither marks nor is named", () => {
  // No entry in `stats` at all — the poll has not reached it, or the batch was
  // cut short of it. Its neighbours' real overlap survives; it takes no part.
  const overlaps = overlapsByRepo({
    grouped: grouped({
      "repo-a": [
        worktree("wt-a1", "fix-login", "repo-a"),
        worktree("wt-a2", "spike-ui", "repo-a"),
        worktree("wt-a3", "never-answered", "repo-a"),
      ],
    }),
    repos: [REPOS[0]],
    stats: {
      "wt-a1": stat(["src/app.ts"]),
      "wt-a2": stat(["src/app.ts"]),
    },
  });

  assert.deepEqual([...overlaps.keys()].sort(), ["wt-a1", "wt-a2"]);
  assert.equal(
    overlaps.get("wt-a1").sentence,
    "1 file also changed in spike-ui",
  );
  assert.ok(!overlaps.get("wt-a1").detail.includes("never-answered"));
});

test("a record carrying no path list is silence too", () => {
  // `worktreeStat.ts` reads a missing `paths` field as `null` — a backend
  // older than the field, or a shape it could not read. `[]` would be an
  // answer ("this worktree changed nothing") and would silently agree with
  // every neighbour that they share nothing.
  const overlaps = overlapsByRepo({
    grouped: grouped({
      "repo-a": [
        worktree("wt-a1", "fix-login", "repo-a"),
        worktree("wt-a2", "old-backend", "repo-a"),
      ],
    }),
    repos: [REPOS[0]],
    stats: {
      "wt-a1": stat(["src/app.ts"]),
      "wt-a2": { ...stat(["src/app.ts"]), paths: null },
    },
  });

  assert.equal(overlaps.size, 0);
});

test("the label the sentence uses is the row's own", () => {
  // `worktreeSummary`, not `branch` — a checkout with no branch is labelled by
  // its role, and the sentence has to name what the row is called.
  const primary = {
    ...worktree("wt-a1", null, "repo-a"),
    owner_run_id: null,
    role: "primary",
  };
  const overlaps = overlapsByRepo({
    grouped: grouped({
      "repo-a": [primary, worktree("wt-a2", "spike-ui", "repo-a")],
    }),
    repos: [REPOS[0]],
    stats: {
      "wt-a1": stat(["src/app.ts"]),
      "wt-a2": stat(["src/app.ts"]),
    },
  });

  assert.equal(overlaps.get("wt-a2").sentence, "1 file also changed in main");
});
