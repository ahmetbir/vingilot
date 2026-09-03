import assert from "node:assert/strict";
import { test } from "node:test";

import { heroChipLabel } from "./heroLabel.ts";
import { localBindingId } from "./projects.ts";

test("a checkout under a worktrees root is repo/worktree", () => {
  assert.equal(
    heroChipLabel("local:x", "/Users/me/.vingilot/worktrees/ai/dev"),
    "ai/dev",
  );
  assert.equal(
    heroChipLabel("wt-1", "/Volumes/ugreen/worktrees/vingilot/spike-a/"),
    "vingilot/spike-a",
  );
});

test("the repo's own checkout is its directory's name", () => {
  assert.equal(
    heroChipLabel("main:repo-1", "/Users/me/self-hosted/ptss"),
    "ptss",
  );
});

test("a local worktree with no session yet reads its path off the binding id", () => {
  const id = localBindingId("/Users/me/.vingilot/worktrees/hsm/qr");
  assert.equal(heroChipLabel(id, null), "hsm/qr");
});

test("a checkout the coordinator provisioned is called by its branch, not its run id", () => {
  assert.equal(
    heroChipLabel("wt-1", "/Users/me/.vingilot/worktrees/run-8f3a", "spike-a"),
    "spike-a",
  );
  // But a real repo/worktree path wins over the branch: that is the name he uses.
  assert.equal(
    heroChipLabel("wt-1", "/Users/me/.vingilot/worktrees/ai/dev", "feature/x"),
    "ai/dev",
  );
});

test("with no path anywhere, the id loses its scheme and nothing else", () => {
  assert.equal(heroChipLabel("main:ptss", null), "ptss");
  assert.equal(heroChipLabel("wt-striprename", null), "wt-striprename");
});
