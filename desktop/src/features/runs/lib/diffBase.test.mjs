import assert from "node:assert/strict";
import { test } from "node:test";

import { baseChoices, readWorktreeRefs, sinceBranchPoint } from "./diffBase.ts";

const local = (branch) => ({
  added: null,
  base_commit: "0".repeat(40),
  binding_id: "local:6c",
  branch,
  commit_sha: null,
  lifecycle: "active",
  owner_run_id: null,
  owner_run_objective: null,
  owner_run_status: null,
  removed: null,
  repo_id: "r",
  role: "task",
});

test("since a branch point is git's merge-base form", () => {
  assert.equal(sinceBranchPoint("main"), "main...HEAD");
});

test("with a default branch the quick rows offer it three ways", () => {
  const refs = {
    defaultBranch: "main",
    head: "feat",
    local: ["main", "feat"],
    remote: ["origin/main", "origin/feat"],
  };
  const { quick, local: l, remote } = baseChoices(refs, local("feat"));
  assert.deepEqual(
    quick.map((c) => c.base),
    ["HEAD", "main...HEAD", "main", "origin/main...HEAD"],
  );
  // The branch he is on is not offered against itself.
  assert.deepEqual(
    l.map((c) => c.base),
    ["main...HEAD"],
  );
  assert.deepEqual(
    remote.map((c) => c.base),
    ["origin/main...HEAD", "origin/feat...HEAD"],
  );
});

test("on the default branch itself, main is not offered against main", () => {
  const refs = {
    defaultBranch: "main",
    head: "main",
    local: ["main"],
    remote: ["origin/main"],
  };
  const { quick } = baseChoices(refs, local("main"));
  assert.deepEqual(
    quick.map((c) => c.base),
    ["HEAD"],
  );
});

test("a run's worktree offers its branch point too", () => {
  const wt = {
    ...local("x"),
    base_commit: "abcdef0123456789".padEnd(40, "0"),
    binding_id: "wt-run",
    owner_run_id: "run-1",
  };
  const refs = { defaultBranch: null, head: "x", local: ["x"], remote: [] };
  const { quick } = baseChoices(refs, wt);
  assert.equal(quick[1].base, "abcdef0123456789".padEnd(40, "0"));
  assert.equal(quick[1].label, "Since abcdef0");
});

test("a shape this build cannot read is nothing listed, not a throw", () => {
  assert.deepEqual(readWorktreeRefs(null), {
    defaultBranch: null,
    head: null,
    local: [],
    remote: [],
  });
  assert.deepEqual(
    readWorktreeRefs({
      local: ["a", 3, ""],
      remote: "x",
      head: "",
      defaultBranch: "main",
    }),
    {
      defaultBranch: "main",
      head: null,
      local: ["a"],
      remote: [],
    },
  );
});
