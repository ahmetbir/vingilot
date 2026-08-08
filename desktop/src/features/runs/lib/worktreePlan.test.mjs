import assert from "node:assert/strict";
import { test } from "node:test";
import { localBindingId, mainCheckout } from "./projects.ts";
import {
  branchSlug,
  explainWorktreeError,
  planWorktree,
  readWorktreeError,
  removableWorktree,
  removeWorktreeConfirm,
  worktreePathFor,
} from "./worktreePlan.ts";

const repo = { id: "buzz", name: "vingilot", path: "/repos/vingilot" };
const ROOT = "/Users/o/.vingilot/worktrees";

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
// where a worktree lands
// ---------------------------------------------------------------------

test("a worktree lands under the same root the executor uses, per project", () => {
  assert.equal(
    worktreePathFor(ROOT, repo, "fix-the-thing"),
    "/Users/o/.vingilot/worktrees/buzz/fix-the-thing",
  );
});

test("a slash in the branch name does not become a directory level", () => {
  assert.equal(
    worktreePathFor(ROOT, repo, "feature/login"),
    "/Users/o/.vingilot/worktrees/buzz/feature-login",
  );
});

test("a trailing slash on the root does not double up", () => {
  assert.equal(
    worktreePathFor(`${ROOT}/`, repo, "fix"),
    "/Users/o/.vingilot/worktrees/buzz/fix",
  );
});

test("branchSlug never produces an empty or hidden directory name", () => {
  assert.equal(branchSlug("....."), "worktree");
  assert.equal(branchSlug(".hidden"), "hidden");
  assert.equal(branchSlug("üç ağaç"), "a-a");
  assert.equal(branchSlug("keep_this.one-2"), "keep_this.one-2");
});

// ---------------------------------------------------------------------
// planWorktree
// ---------------------------------------------------------------------

test("a branch and a base become the call git is about to be given", () => {
  const planned = planWorktree({
    base: " main ",
    branch: " fix ",
    repo,
    worktreeRoot: ROOT,
  });
  assert.equal(planned.ok, true);
  assert.deepEqual(planned.plan, {
    base: "main",
    branch: "fix",
    path: "/Users/o/.vingilot/worktrees/buzz/fix",
    repoPath: "/repos/vingilot",
  });
});

test("an empty branch or base is refused before git is called", () => {
  const noBranch = planWorktree({
    base: "HEAD",
    branch: "   ",
    repo,
    worktreeRoot: ROOT,
  });
  assert.equal(noBranch.ok, false);
  assert.match(noBranch.reason, /name the branch/);

  const noBase = planWorktree({
    base: "",
    branch: "fix",
    repo,
    worktreeRoot: ROOT,
  });
  assert.equal(noBase.ok, false);
  assert.match(noBase.reason, /HEAD/);
});

test("without a worktree root there is nowhere to put it, and it says so", () => {
  const planned = planWorktree({
    base: "HEAD",
    branch: "fix",
    repo,
    worktreeRoot: null,
  });
  assert.equal(planned.ok, false);
});

test("branch-name legality is left to git, not re-decided here", () => {
  // `check-ref-format` is the authority (vingilot_worktree/mod.rs); a second
  // copy of its rules in this module would eventually disagree with it.
  const planned = planWorktree({
    base: "HEAD",
    branch: "has a space",
    repo,
    worktreeRoot: ROOT,
  });
  assert.equal(planned.ok, true);
});

// ---------------------------------------------------------------------
// what may be removed
// ---------------------------------------------------------------------

test("the project's own checkout has no removable form at all", () => {
  // Not "the button is hidden" — there is no value to hand to the remove
  // call, so no code path anywhere can ask git to remove the repository.
  assert.equal(removableWorktree(repo, mainCheckout(repo), ROOT), null);
});

test("a Run's worktree is not removable from the column", () => {
  // git would remove the directory; the coordinator would never hear about
  // it, keep `removed` null, and re-emit the row on the next poll — a row
  // that opens a shell in a directory that is no longer there. A Run's
  // worktree is retired by the Run.
  assert.equal(removableWorktree(repo, task(), ROOT), null);
});

function local(path, overrides = {}) {
  return task({
    binding_id: localBindingId(path),
    branch: "fix",
    owner_run_id: null,
    role: "local",
    ...overrides,
  });
}

test("a worktree git listed is removable at the path its id carries", () => {
  const path = `${ROOT}/buzz/fix`;
  const target = removableWorktree(repo, local(path), ROOT);
  assert.equal(target.path, path);
  assert.equal(target.label, "fix");
});

test("a worktree whose path cannot be worked out is not removable", () => {
  // Never a guessed path: this is the one call that could cost the owner a
  // directory, so an unresolvable row simply has no remove.
  assert.equal(
    removableWorktree(repo, task({ owner_run_id: null }), ROOT),
    null,
  );
  assert.equal(removableWorktree(repo, local(`${ROOT}/buzz/fix`), null), null);
});

test("the confirm promises what actually happens: a checkout, not history", () => {
  const path = `${ROOT}/buzz/fix`;
  const target = removableWorktree(
    repo,
    local(path, { branch: "run/aaa" }),
    ROOT,
  );
  const confirm = removeWorktreeConfirm(target);
  assert.match(confirm.title, /run\/aaa/);
  assert.match(confirm.body, new RegExp(path));
  assert.match(confirm.body, /branch and every commit on it stay/);
  assert.match(confirm.body, /git refuses and nothing is removed/);
  assert.match(confirm.body, /never overridden/);
});

// ---------------------------------------------------------------------
// refusals
// ---------------------------------------------------------------------

test("a dirty refusal carries every path that is in the way", () => {
  const error = readWorktreeError({
    entries: [" M README.md", "?? scratch.txt"],
    kind: "dirty",
    path: "/w/fix",
    total: 2,
  });
  const refusal = explainWorktreeError(error);
  assert.deepEqual(refusal.entries, [" M README.md", "?? scratch.txt"]);
  assert.match(refusal.message, /2 uncommitted changes/);
  assert.match(refusal.message, /NOT removed/);
  assert.match(refusal.message, /Commit or stash/);
});

test("a dirty refusal says how many paths it did not list", () => {
  const refusal = explainWorktreeError({
    entries: ["?? a"],
    kind: "dirty",
    path: "/w/fix",
    total: 41,
  });
  assert.match(refusal.message, /40 more not listed/);
});

test("removing the repository itself is refused in git's terms too", () => {
  const refusal = explainWorktreeError({
    kind: "main-worktree",
    path: "/repos/vingilot",
  });
  assert.match(refusal.message, /project's own checkout/);
  assert.match(refusal.message, /forgets the path and touches nothing/);
});

test("a name collision names the branch, and says nothing was changed", () => {
  const refusal = explainWorktreeError({
    branch: "fix",
    kind: "branch-exists",
  });
  assert.match(refusal.message, /"fix" already exists/);
  assert.match(refusal.message, /nothing was changed/);
});

test("an occupied path is reported with the path, and left alone", () => {
  const refusal = explainWorktreeError({
    kind: "path-exists",
    path: "/w/fix",
  });
  assert.deepEqual(refusal.entries, ["/w/fix"]);
  assert.match(refusal.message, /left\s+exactly as it is/);
});

test("a base ref that resolves to nothing is quoted back", () => {
  const refusal = explainWorktreeError({ base: "nope", kind: "unknown-base" });
  assert.match(refusal.message, /"nope" names no commit/);
});

test("every refusal shape reads back off the wire", () => {
  const shapes = [
    { kind: "git-missing" },
    { kind: "not-a-repo", path: "/p" },
    { branch: "b", kind: "invalid-branch" },
    { branch: "b", kind: "branch-exists" },
    { kind: "path-exists", path: "/p" },
    { base: "x", kind: "unknown-base" },
    { kind: "main-worktree", path: "/p" },
    { kind: "not-a-worktree", path: "/p" },
    { kind: "brief-exists", path: "/w/fix/PLAN.md" },
    { kind: "invalid-brief-name", name: "../PLAN.md" },
    { command: "git worktree remove /p", kind: "git-failed", stderr: "no" },
  ];
  for (const shape of shapes) {
    const read = readWorktreeError(shape);
    assert.notEqual(read, null, `${shape.kind} did not read back`);
    assert.equal(read.kind, shape.kind);
    assert.notEqual(explainWorktreeError(read).message, "");
  }
});

test("a brief already on the base branch is reported as a file, not as a worktree", () => {
  // The worktree exists when this arrives; the sentence must be about the
  // file, and it must promise the file was left alone.
  const refusal = explainWorktreeError({
    kind: "brief-exists",
    path: "/w/fix/PLAN.md",
  });
  assert.deepEqual(refusal.entries, ["/w/fix/PLAN.md"]);
  assert.match(refusal.message, /left exactly as it is/);
  assert.match(refusal.message, /nothing was written over/);
  assert.doesNotMatch(refusal.message, /removed/);
});

test("a brief filename that is not a filename is quoted back, with nothing written", () => {
  const refusal = explainWorktreeError({
    kind: "invalid-brief-name",
    name: "../PLAN.md",
  });
  assert.match(refusal.message, /"\.\.\/PLAN\.md" is not a filename/);
  assert.match(refusal.message, /nothing was written/);
});

test("an unreadable refusal is null rather than a guess at which one it was", () => {
  assert.equal(readWorktreeError(null), null);
  assert.equal(readWorktreeError({ kind: "something-new" }), null);
  assert.equal(readWorktreeError("boom"), null);
});

test("a dirty refusal missing its fields still counts what it has", () => {
  const read = readWorktreeError({ entries: ["?? a", 7], kind: "dirty" });
  assert.deepEqual(read.entries, ["?? a"]);
  assert.equal(read.total, 1);
  assert.equal(read.path, "");
});
