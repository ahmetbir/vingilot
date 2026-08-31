// Quick Actions' pure rules: template vars are filled ONLY from real state
// (redesign P4's standing constraint), a stored list is read tolerantly, and
// an empty stored list is a real answer, not a fallback trigger.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_QUICK_ACTIONS,
  quickActionVarsForWorktree,
  readQuickActionsList,
  renderQuickActionPrompt,
} from "./quickActions.ts";

test("a known var fills in from real state", () => {
  assert.equal(
    renderQuickActionPrompt("Open a PR for {{branch}}.", {
      branch: "feat/x",
      diff_summary: null,
      worktree_path: null,
    }),
    "Open a PR for feat/x.",
  );
});

test("a var with no value for this worktree renders empty, never the placeholder", () => {
  assert.equal(
    renderQuickActionPrompt("branch={{branch}}.", {
      branch: null,
      diff_summary: null,
      worktree_path: null,
    }),
    "branch=.",
  );
});

test("an unknown var is left untouched rather than blanked", () => {
  assert.equal(
    renderQuickActionPrompt("{{not_a_real_var}}", {
      branch: "x",
      diff_summary: null,
      worktree_path: null,
    }),
    "{{not_a_real_var}}",
  );
});

test("quickActionVarsForWorktree: no diff evidence yet is null, never +0 -0", () => {
  const wt = {
    added: null,
    base_commit: "0".repeat(40),
    binding_id: "wt-1",
    branch: "feat/x",
    commit_sha: null,
    lifecycle: "active",
    owner_run_id: null,
    owner_run_objective: null,
    owner_run_status: null,
    removed: null,
    repo_id: "repo-1",
    role: "task",
  };
  const vars = quickActionVarsForWorktree(wt, "/tmp/x");
  assert.equal(vars.branch, "feat/x");
  assert.equal(vars.diff_summary, null);
  assert.equal(vars.worktree_path, "/tmp/x");
});

test("quickActionVarsForWorktree: a real all-clean diff says so in words, not a zero", () => {
  const wt = {
    added: 0,
    base_commit: "0".repeat(40),
    binding_id: "wt-1",
    branch: "feat/x",
    commit_sha: "deadbeef",
    lifecycle: "active",
    owner_run_id: "run-1",
    owner_run_objective: null,
    owner_run_status: null,
    removed: 0,
    repo_id: "repo-1",
    role: "task",
  };
  assert.equal(quickActionVarsForWorktree(wt, null).diff_summary, "no changes");
});

test("quickActionVarsForWorktree: real added/removed counts render with the diff glyphs", () => {
  const wt = {
    added: 214,
    base_commit: "0".repeat(40),
    binding_id: "wt-1",
    branch: "feat/x",
    commit_sha: "deadbeef",
    lifecycle: "active",
    owner_run_id: "run-1",
    owner_run_objective: null,
    owner_run_status: null,
    removed: 38,
    repo_id: "repo-1",
    role: "task",
  };
  assert.equal(quickActionVarsForWorktree(wt, null).diff_summary, "+214 −38");
});

test("readQuickActionsList: malformed entries are dropped, never thrown on", () => {
  assert.deepEqual(
    readQuickActionsList([
      { id: "a", label: "A", promptTemplate: "do a" },
      { id: "", label: "no id", promptTemplate: "x" },
      { label: "missing id field", promptTemplate: "x" },
      "not even an object",
      null,
    ]),
    [{ id: "a", label: "A", promptTemplate: "do a" }],
  );
});

test("readQuickActionsList: a real empty list is [], not a fallback trigger", () => {
  assert.deepEqual(readQuickActionsList([]), []);
});

test("readQuickActionsList: a non-array answers []", () => {
  assert.deepEqual(readQuickActionsList({ not: "an array" }), []);
  assert.deepEqual(readQuickActionsList(null), []);
});

test("the mockup's two configurable defaults, verbatim (Stop and Review are not prompts)", () => {
  assert.deepEqual(
    DEFAULT_QUICK_ACTIONS.map((b) => b.label),
    ["Commit", "Create PR"],
  );
});
