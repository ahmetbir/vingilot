import assert from "node:assert/strict";
import { test } from "node:test";
import {
  readRepos,
  groupWorktrees,
  worktreeSummary,
  worktreeCwd,
} from "./projects.ts";

// ---------------------------------------------------------------------
// readRepos
// ---------------------------------------------------------------------

test("readRepos: null state → []", () => {
  assert.deepEqual(readRepos(null), []);
});

test("readRepos: empty object → []", () => {
  assert.deepEqual(readRepos({}), []);
});

test("readRepos: repos not an array → []", () => {
  assert.deepEqual(readRepos({ repos: "nope" }), []);
});

test("readRepos: never throws on arbitrary garbage shapes", () => {
  assert.deepEqual(readRepos(undefined), []);
  assert.deepEqual(readRepos("string"), []);
  assert.deepEqual(readRepos(42), []);
  assert.deepEqual(readRepos([1, 2, 3]), []);
  assert.deepEqual(readRepos({ repos: null }), []);
});

test("readRepos: a malformed element is dropped, never throws", () => {
  const state = {
    repos: [
      { id: "buzz", name: "buzz", path: "/Users/x/buzz" },
      { id: "no-name", path: "/Users/x/whatever" }, // missing name
      { id: "no-path", name: "whatever" }, // missing path
      "not-an-object",
      null,
      42,
    ],
  };
  assert.deepEqual(readRepos(state), [
    { id: "buzz", name: "buzz", path: "/Users/x/buzz" },
  ]);
});

test("readRepos: valid multi-entry array parses in order", () => {
  const state = {
    repos: [
      { id: "buzz", name: "buzz", path: "/Users/x/buzz" },
      { id: "vingilot", name: "vingilot", path: "/Users/x/vingilot" },
    ],
  };
  assert.deepEqual(readRepos(state), [
    { id: "buzz", name: "buzz", path: "/Users/x/buzz" },
    { id: "vingilot", name: "vingilot", path: "/Users/x/vingilot" },
  ]);
});

// Audit finding (deckPins lesson, mirrored): putRepos writes the whole
// `repos` array back, so an unknown extra key on a repo object must survive
// a read/write round-trip rather than being silently dropped.
test("readRepos preserves unknown extra keys on an otherwise-valid repo", () => {
  const state = {
    repos: [
      {
        id: "buzz",
        name: "buzz",
        path: "/Users/x/buzz",
        futureField: "some-future-client-wrote-this",
      },
    ],
  };
  const repos = readRepos(state);
  assert.equal(repos.length, 1);
  assert.equal(repos[0].futureField, "some-future-client-wrote-this");
});

// ---------------------------------------------------------------------
// groupWorktrees
// ---------------------------------------------------------------------

function wt(overrides = {}) {
  return {
    binding_id: "b1",
    repo_id: "buzz",
    branch: "run/bz-142",
    role: "task",
    lifecycle: "ready",
    base_commit: "abc123",
    owner_run_id: "r1",
    owner_run_status: "running",
    owner_run_objective: "do the thing",
    added: 214,
    removed: 87,
    commit_sha: "75269de",
    ...overrides,
  };
}

test("groupWorktrees: every worktree lands under its repo", () => {
  const repos = [{ id: "buzz", name: "buzz", path: "/x/buzz" }];
  const w1 = wt({ binding_id: "b1", repo_id: "buzz" });
  const w2 = wt({ binding_id: "b2", repo_id: "buzz" });
  const { byRepo, unknown } = groupWorktrees(repos, [w1, w2]);
  assert.deepEqual(byRepo, { buzz: [w1, w2] });
  assert.deepEqual(unknown, []);
});

test("groupWorktrees: a repo with no worktrees still gets an entry ([])", () => {
  const repos = [
    { id: "buzz", name: "buzz", path: "/x/buzz" },
    { id: "vingilot", name: "vingilot", path: "/x/vingilot" },
  ];
  const w1 = wt({ binding_id: "b1", repo_id: "buzz" });
  const { byRepo } = groupWorktrees(repos, [w1]);
  assert.deepEqual(byRepo, { buzz: [w1], vingilot: [] });
});

test("groupWorktrees: a worktree whose repo_id matches no known repo lands in unknown, not dropped", () => {
  const repos = [{ id: "buzz", name: "buzz", path: "/x/buzz" }];
  const known = wt({ binding_id: "b1", repo_id: "buzz" });
  const orphan = wt({ binding_id: "b2", repo_id: "ghost-repo" });
  const { byRepo, unknown } = groupWorktrees(repos, [known, orphan]);
  assert.deepEqual(byRepo, { buzz: [known] });
  assert.deepEqual(unknown, [orphan]);
});

test("groupWorktrees: no repos at all → every worktree is unknown", () => {
  const orphan = wt({ binding_id: "b1", repo_id: "buzz" });
  const { byRepo, unknown } = groupWorktrees([], [orphan]);
  assert.deepEqual(byRepo, {});
  assert.deepEqual(unknown, [orphan]);
});

// ---------------------------------------------------------------------
// worktreeSummary
// ---------------------------------------------------------------------

test("worktreeSummary: a branch worktree uses the branch as its label", () => {
  const summary = worktreeSummary(wt({ branch: "run/bz-142" }));
  assert.equal(summary.label, "run/bz-142");
});

test("worktreeSummary: a primary checkout with no branch labels as 'main'", () => {
  const summary = worktreeSummary(
    wt({
      branch: null,
      role: "primary",
      owner_run_id: null,
      owner_run_status: null,
      owner_run_objective: null,
      added: null,
      removed: null,
      commit_sha: null,
    }),
  );
  assert.equal(summary.label, "main");
});

test("worktreeSummary: no owner run → stateClass 'clean'", () => {
  const summary = worktreeSummary(
    wt({
      owner_run_id: null,
      owner_run_status: null,
      owner_run_objective: null,
    }),
  );
  assert.equal(summary.stateClass, "clean");
});

test("worktreeSummary: owner run status maps through runModel's statusClass", () => {
  assert.equal(
    worktreeSummary(wt({ owner_run_status: "running" })).stateClass,
    "live",
  );
  assert.equal(
    worktreeSummary(wt({ owner_run_status: "completed" })).stateClass,
    "ok",
  );
  assert.equal(
    worktreeSummary(wt({ owner_run_status: "blocked" })).stateClass,
    "attn",
  );
  assert.equal(
    worktreeSummary(wt({ owner_run_status: "failed" })).stateClass,
    "stop",
  );
});

test("worktreeSummary: diff counts present → {added, removed}", () => {
  const summary = worktreeSummary(wt({ added: 214, removed: 87 }));
  assert.deepEqual(summary.diff, { added: 214, removed: 87 });
});

test("worktreeSummary: no diff evidence yet → diff is null, not {0, 0}", () => {
  const summary = worktreeSummary(wt({ added: null, removed: null }));
  assert.equal(summary.diff, null);
});

// ---------------------------------------------------------------------
// worktreeCwd
// ---------------------------------------------------------------------

const repo = { id: "buzz", name: "buzz", path: "/Users/x/buzz" };

test("worktreeCwd: primary role cwd is the repo's own path, ignoring worktreeRoot", () => {
  const primary = wt({
    role: "primary",
    branch: null,
    owner_run_id: null,
  });
  assert.equal(
    worktreeCwd(repo, primary, "/Users/x/.vingilot/worktrees"),
    "/Users/x/buzz",
  );
});

test("worktreeCwd: a task worktree's cwd is <worktreeRoot>/<owner_run_id>", () => {
  const task = wt({ role: "task", owner_run_id: "r1" });
  assert.equal(
    worktreeCwd(repo, task, "/Users/x/.vingilot/worktrees"),
    "/Users/x/.vingilot/worktrees/r1",
  );
});

test("worktreeCwd: a trailing slash on worktreeRoot doesn't double up", () => {
  const task = wt({ role: "task", owner_run_id: "r1" });
  assert.equal(
    worktreeCwd(repo, task, "/Users/x/.vingilot/worktrees/"),
    "/Users/x/.vingilot/worktrees/r1",
  );
});

test("worktreeCwd: a task worktree with no owner run yet has no derivable cwd", () => {
  const task = wt({ role: "task", owner_run_id: null });
  assert.equal(worktreeCwd(repo, task, "/Users/x/.vingilot/worktrees"), null);
});
