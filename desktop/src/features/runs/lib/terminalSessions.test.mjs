import assert from "node:assert/strict";
import { test } from "node:test";
import { groupWorktrees } from "./projects.ts";
import {
  openTerminals,
  sessionsToClose,
  worktreeIndex,
} from "./terminalSessions.ts";

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

test("a session whose worktree vanished from the workspace is closed", () => {
  assert.deepEqual(sessionsToClose(["main:a", "bind-1"], ["main:a"]), [
    "bind-1",
  ]);
});

test("a session merely switched away from stays open", () => {
  assert.deepEqual(
    sessionsToClose(["main:a", "main:b"], ["main:a", "main:b"]),
    [],
  );
});

test("an empty live set is read as 'the workspace has not answered', not 'everything was removed'", () => {
  // The worktree list is polled, not pushed. Treating one empty read as a
  // removal would kill the owner's running shells on a transient blip.
  assert.deepEqual(sessionsToClose(["main:a"], []), []);
});

test("closing is idempotent — nothing opened means nothing to close", () => {
  assert.deepEqual(sessionsToClose([], ["main:a"]), []);
});

test("opened sessions keep their visit order and resolve their cwd", () => {
  const wt = taskWorktree("bind-1", "a", "run-1");
  const grouped = groupWorktrees([REPO_A], [wt]);
  const index = worktreeIndex([REPO_A], grouped);

  assert.deepEqual(openTerminals(["bind-1", "main:a"], index, "/home/w"), [
    { cwd: "/home/w/run-1", sessionId: "bind-1" },
    { cwd: "/repos/a", sessionId: "main:a" },
  ]);
});

test("an unresolved worktree root leaves every cwd null rather than guessing one", () => {
  const grouped = groupWorktrees([REPO_A], []);
  const index = worktreeIndex([REPO_A], grouped);
  assert.deepEqual(openTerminals(["main:a"], index, null), [
    { cwd: null, sessionId: "main:a" },
  ]);
});

test("an opened session with no indexed worktree is dropped, not rendered against a guessed cwd", () => {
  const grouped = groupWorktrees([REPO_A], []);
  const index = worktreeIndex([REPO_A], grouped);
  assert.deepEqual(openTerminals(["ghost"], index, "/home/w"), []);
});
