import assert from "node:assert/strict";
import { test } from "node:test";
import { groupWorktrees } from "./projects.ts";
import { openTerminals, worktreeIndex } from "./terminalSessions.ts";
import {
  applyTabCommand,
  emptyLayout,
  ensureWorktree,
} from "./terminalTabs.ts";

/** A layout with one worktree open at `count` tabs. */
function withTabs(bindingId, count, from = emptyLayout()) {
  let layout = ensureWorktree(from, bindingId);
  for (let i = 1; i < count; i++) {
    layout = applyTabCommand(layout, bindingId, { type: "new" }).layout;
  }
  return layout;
}

const REPO_A = { id: "a", name: "a", path: "/repos/a" };
const REPO_B = { id: "b", name: "b", path: "/repos/b" };

function taskWorktree(bindingId, repoId, ownerRunId) {
  return {
    added: null,
    base_commit: "",
    binding_id: bindingId,
    branch: "feat/x",
    commit_sha: null,
    lifecycle: "ready",
    owner_run_id: ownerRunId,
    owner_run_objective: null,
    owner_run_status: null,
    removed: null,
    repo_id: repoId,
    role: "task",
  };
}

test("the index carries every repo's own checkout, which no coordinator row backs", () => {
  const grouped = groupWorktrees([REPO_A, REPO_B], []);
  const index = worktreeIndex([REPO_A, REPO_B], grouped);
  assert.deepEqual([...index.keys()].sort(), ["main:a", "main:b"]);
  assert.equal(index.get("main:a")?.repo, REPO_A);
});

test("the index carries task worktrees alongside the checkouts", () => {
  const wt = taskWorktree("bind-1", "a", "run-1");
  const grouped = groupWorktrees([REPO_A], [wt]);
  const index = worktreeIndex([REPO_A], grouped);
  assert.deepEqual([...index.keys()].sort(), ["bind-1", "main:a"]);
  assert.equal(index.get("bind-1")?.worktree, wt);
});

test("a worktree whose repo this client has not caught up to is not indexed", () => {
  // groupWorktrees buckets it into `unknown`; without a repo there is no
  // path to derive a cwd from, so it cannot back a terminal.
  const grouped = groupWorktrees(
    [REPO_A],
    [taskWorktree("orphan", "gone", "r")],
  );
  const index = worktreeIndex([REPO_A], grouped);
  assert.equal(index.has("orphan"), false);
});

test("every open tab resolves to a session id and a cwd", () => {
  const wt = taskWorktree("bind-1", "a", "run-1");
  const grouped = groupWorktrees([REPO_A], [wt]);
  const index = worktreeIndex([REPO_A], grouped);
  const layout = withTabs("main:a", 1, withTabs("bind-1", 2));

  assert.deepEqual(openTerminals(layout, index, "/home/w"), [
    { bindingId: "bind-1", cwd: "/home/w/run-1", n: 1, sessionId: "bind-1#1" },
    { bindingId: "bind-1", cwd: "/home/w/run-1", n: 2, sessionId: "bind-1#2" },
    { bindingId: "main:a", cwd: "/repos/a", n: 1, sessionId: "main:a#1" },
  ]);
});

test("every tab of one worktree starts in the same directory — a worktree is one checkout", () => {
  const grouped = groupWorktrees([REPO_A], []);
  const index = worktreeIndex([REPO_A], grouped);
  const cwds = new Set(
    openTerminals(withTabs("main:a", 3), index, "/home/w").map((t) => t.cwd),
  );
  assert.deepEqual([...cwds], ["/repos/a"]);
});

test("an unresolved worktree root leaves every cwd null rather than guessing one", () => {
  const grouped = groupWorktrees([REPO_A], []);
  const index = worktreeIndex([REPO_A], grouped);
  assert.deepEqual(openTerminals(withTabs("main:a", 1), index, null), [
    { bindingId: "main:a", cwd: null, n: 1, sessionId: "main:a#1" },
  ]);
});

test("a tab whose worktree is not indexed is dropped, not rendered against a guessed cwd", () => {
  const grouped = groupWorktrees([REPO_A], []);
  const index = worktreeIndex([REPO_A], grouped);
  assert.deepEqual(openTerminals(withTabs("ghost", 2), index, "/home/w"), []);
});
