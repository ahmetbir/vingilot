import assert from "node:assert/strict";
import { test } from "node:test";
import { groupWorktrees, localBindingId } from "./projects.ts";
import {
  localWorktreeRow,
  projectsKey,
  readGitWorktrees,
  readProjectsKey,
  withLocalGroups,
  withLocalWorktrees,
} from "./worktreeGit.ts";

const repo = { id: "buzz", name: "vingilot", path: "/repos/vingilot" };

function gw(overrides = {}) {
  return {
    branch: "fix",
    detached: false,
    head: "abc123",
    isMain: false,
    locked: false,
    path: "/root/buzz/fix",
    prunable: false,
    ...overrides,
  };
}

function task(overrides = {}) {
  return {
    added: null,
    base_commit: "abc",
    binding_id: "b1",
    branch: "run/aaa",
    commit_sha: null,
    lifecycle: "ready",
    owner_run_id: "r1",
    owner_run_objective: null,
    owner_run_status: "running",
    removed: null,
    repo_id: "buzz",
    role: "task",
    ...overrides,
  };
}

// ---------------------------------------------------------------------
// readGitWorktrees
// ---------------------------------------------------------------------

test("readGitWorktrees keeps well-formed records and drops the rest", () => {
  const listed = readGitWorktrees([
    gw(),
    { path: "/only-a-path" },
    null,
    "not an object",
  ]);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].path, "/root/buzz/fix");
});

test("readGitWorktrees answers [] for anything that is not a list", () => {
  assert.deepEqual(readGitWorktrees(undefined), []);
  assert.deepEqual(readGitWorktrees({ worktrees: [] }), []);
});

test("a detached record keeps its null branch rather than inventing one", () => {
  const listed = readGitWorktrees([gw({ branch: null, detached: true })]);
  assert.equal(listed[0].branch, null);
  assert.equal(listed[0].detached, true);
});

// ---------------------------------------------------------------------
// localWorktreeRow
// ---------------------------------------------------------------------

test("a git worktree becomes a row with no owner run and no invented evidence", () => {
  const row = localWorktreeRow(repo, gw());
  assert.equal(row.repo_id, "buzz");
  assert.equal(row.branch, "fix");
  assert.equal(row.binding_id, localBindingId("/root/buzz/fix"));
  assert.equal(row.owner_run_id, null);
  assert.equal(row.owner_run_status, null);
  assert.equal(row.added, null);
  assert.equal(row.removed, null);
});

test("a detached worktree is labelled by its role, not by a fake branch", () => {
  const row = localWorktreeRow(repo, gw({ branch: null, detached: true }));
  assert.equal(row.branch, null);
  assert.equal(row.role, "detached");
});

// ---------------------------------------------------------------------
// withLocalWorktrees
// ---------------------------------------------------------------------

test("a worktree only git knows about is appended to the column", () => {
  const rows = groupWorktrees([repo], []).byRepo.buzz;
  const merged = withLocalWorktrees(repo, rows, [gw()], "/root");
  assert.equal(merged.length, 2);
  assert.equal(
    merged[0].role,
    "primary",
    "the repo's own checkout stays first",
  );
  assert.equal(merged[1].branch, "fix");
});

test("git's own main entry never becomes a second main row", () => {
  const rows = groupWorktrees([repo], []).byRepo.buzz;
  const merged = withLocalWorktrees(
    repo,
    rows,
    [gw({ branch: "main", isMain: true, path: "/repos/vingilot" })],
    "/root",
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0].role, "primary");
});

test("a coordinator worktree is not listed twice when git reports it too", () => {
  const rows = groupWorktrees([repo], [task()]).byRepo.buzz;
  // The coordinator's row resolves to <root>/<owner_run_id>.
  const merged = withLocalWorktrees(
    repo,
    rows,
    [gw({ path: "/root/r1" })],
    "/root",
  );
  assert.equal(merged.length, 2);
  assert.equal(merged[1].owner_run_id, "r1", "the row with the run survives");
});

test("a trailing slash does not turn one worktree into two rows", () => {
  const rows = groupWorktrees([repo], []).byRepo.buzz;
  const merged = withLocalWorktrees(
    repo,
    rows,
    [gw({ path: "/repos/vingilot/" })],
    "/root",
  );
  assert.equal(merged.length, 1);
});

test("without a worktree root, only the repo's own path can be deduplicated", () => {
  // Honest degradation: a coordinator row's path cannot be derived yet, so
  // git's copy of it is appended rather than silently dropped.
  const rows = groupWorktrees([repo], [task()]).byRepo.buzz;
  const merged = withLocalWorktrees(
    repo,
    rows,
    [gw({ path: "/root/r1" })],
    null,
  );
  assert.equal(merged.length, 3);
});

// ---------------------------------------------------------------------
// withLocalGroups
// ---------------------------------------------------------------------

test("every project's git worktrees are folded in, not only the open one", () => {
  // The workspace kills the shells of any worktree missing from the index
  // (terminalTabs.ts), so a listing that covered one project would end the
  // others' terminals on a project switch.
  const other = { id: "web", name: "web", path: "/repos/web" };
  const grouped = groupWorktrees([repo, other], []);
  const merged = withLocalGroups(
    [repo, other],
    grouped,
    { buzz: [gw()], web: [gw({ path: "/root/web/spike" })] },
    "/root",
  );
  assert.equal(merged.byRepo.buzz.length, 2);
  assert.equal(merged.byRepo.web.length, 2);
  assert.equal(
    merged.byRepo.web[1].binding_id,
    localBindingId("/root/web/spike"),
  );
});

test("a project git said nothing about keeps exactly the rows it had", () => {
  const grouped = groupWorktrees([repo], [task()]);
  const merged = withLocalGroups([repo], grouped, {}, "/root");
  assert.deepEqual(
    merged.byRepo.buzz.map((w) => w.role),
    ["primary", "task"],
  );
});

test("worktrees of an unknown repo stay in the unknown bucket", () => {
  const grouped = groupWorktrees([], [task()]);
  const merged = withLocalGroups([], grouped, {}, "/root");
  assert.equal(merged.unknown.length, 1);
});

// ---------------------------------------------------------------------
// projectsKey
// ---------------------------------------------------------------------

test("the project key round-trips ids and paths exactly", () => {
  const projects = [
    { id: "buzz", path: "/repos/vingilot" },
    { id: "web", path: '/repos/a "quoted", odd\\path' },
    { id: "notes", path: "/repos/çalışma" },
  ];
  assert.deepEqual(readProjectsKey(projectsKey(projects)), projects);
});

test("the project key changes only when the projects do", () => {
  const a = [{ id: "buzz", name: "vingilot", path: "/repos/vingilot" }];
  // A fresh array of fresh objects, as every poll produces.
  const b = [{ id: "buzz", name: "vingilot", path: "/repos/vingilot" }];
  assert.equal(projectsKey(a), projectsKey(b));
  assert.notEqual(
    projectsKey(a),
    projectsKey([...a, { id: "web", path: "/w" }]),
  );
  assert.notEqual(
    projectsKey(a),
    projectsKey([{ id: "buzz", path: "/repos/elsewhere" }]),
  );
});

test("a key this build cannot read lists no projects rather than throwing", () => {
  assert.deepEqual(readProjectsKey("not json"), []);
  assert.deepEqual(readProjectsKey('{"repos":[]}'), []);
  assert.deepEqual(readProjectsKey('[["buzz"],["web","/w"],7]'), [
    { id: "web", path: "/w" },
  ]);
});
