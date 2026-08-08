import assert from "node:assert/strict";
import { test } from "node:test";
import { persistenceCopy, SCRATCH_PERSISTENCE } from "./terminalPersistence.ts";

test("an unknown backing claims nothing at all", () => {
  // A default here would be a claim. Neither answer is safe to guess: one
  // promises persistence that may not exist, the other denies persistence
  // the owner is relying on.
  assert.equal(persistenceCopy(null), null);
});

test("the tmux copy says persistent and names the backing", () => {
  const copy = persistenceCopy("tmux");
  assert.ok(copy);
  assert.match(copy.label, /persistent/);
  assert.match(copy.label, /tmux/);
});

test("the tmux copy carries its limit in the visible label, not only the detail", () => {
  // The label is what gets read. "persistent" on its own would be read as
  // "survives anything", and a reboot would then cost the owner every shell.
  const copy = persistenceCopy("tmux");
  assert.ok(copy);
  assert.match(copy.label, /not a reboot/);
  assert.match(copy.detail, /reboot/);
  assert.match(copy.detail, /kill-server/);
  assert.match(copy.detail, /crash/);
});

test("the tmux copy claims only a restart, never more", () => {
  const copy = persistenceCopy("tmux");
  assert.ok(copy);
  for (const overclaim of [/forever/i, /always/i, /never lose/i]) {
    assert.doesNotMatch(copy.label, overclaim);
    assert.doesNotMatch(copy.detail, overclaim);
  }
});

test("the fallback copy says this session only and never implies persistence", () => {
  const copy = persistenceCopy("app-process");
  assert.ok(copy);
  assert.match(copy.label, /this session only/);
  assert.doesNotMatch(copy.label, /persistent/);
  assert.doesNotMatch(copy.label, /survive/);
});

test("the fallback copy says what ends the terminal, and how to change it", () => {
  const copy = persistenceCopy("app-process");
  assert.ok(copy);
  assert.match(copy.label, /end when the app quits/);
  assert.match(copy.detail, /tmux was not found/);
  assert.match(copy.detail, /Install tmux/);
});

test("the two modes never read the same", () => {
  const tmux = persistenceCopy("tmux");
  const direct = persistenceCopy("app-process");
  assert.ok(tmux && direct);
  assert.notEqual(tmux.label, direct.label);
  assert.notEqual(tmux.detail, direct.detail);
});

test("the persistence claim names the terminals it is about", () => {
  // "terminals: persistent (tmux)" was a sentence the scratch shell could hide
  // inside — it is on the same bar, and it is a terminal. Naming the subject in
  // the *label* is what keeps the claim from covering a shell that keeps
  // nothing.
  for (const backing of ["tmux", "app-process"]) {
    const copy = persistenceCopy(backing);
    assert.ok(copy);
    assert.match(copy.label, /^worktree terminals:/);
    assert.doesNotMatch(copy.label, /scratch/i);
  }
});

test("the scratch copy claims no persistence of any kind", () => {
  assert.match(SCRATCH_PERSISTENCE.label, /nothing is kept/);
  assert.match(SCRATCH_PERSISTENCE.label, /closing it or leaving ends it/);
  for (const overclaim of [
    /persistent/i,
    /survive/i,
    /still there/i,
    /keeps running/i,
  ]) {
    assert.doesNotMatch(SCRATCH_PERSISTENCE.label, overclaim);
    assert.doesNotMatch(SCRATCH_PERSISTENCE.detail, overclaim);
  }
});

test("the scratch copy says every way it ends, not only the deliberate one", () => {
  // Closing it is the obvious one; quitting the app is the one an owner who
  // has read the line beside it would otherwise assume the opposite of. The
  // other two are the ones he walks into: `scratchOnWorktree` ends the shell
  // when he goes to another worktree, and `RunsScreen`'s unmount ends it when
  // he leaves the screen. A copy naming only the first two is a copy that lets
  // a running build die unannounced.
  assert.match(SCRATCH_PERSISTENCE.detail, /when you close it/);
  assert.match(SCRATCH_PERSISTENCE.detail, /another worktree or project/);
  assert.match(SCRATCH_PERSISTENCE.detail, /leave this screen/);
  assert.match(SCRATCH_PERSISTENCE.detail, /quit the app/);
  assert.match(SCRATCH_PERSISTENCE.detail, /no tmux session/);
  assert.match(SCRATCH_PERSISTENCE.detail, /no tab in the strip/);
});

test("the scratch copy says the command running in it goes too", () => {
  // The half a lifetime sentence leaves out: what is *lost* when the shell
  // ends. A `tail -f` or a build dies with it, and the label is where that has
  // to be said, because the label is what gets read.
  assert.match(SCRATCH_PERSISTENCE.label, /what it is running/);
  assert.match(SCRATCH_PERSISTENCE.detail, /whatever it is running/);
  assert.match(SCRATCH_PERSISTENCE.detail, /unasked/);
});

test("the scratch copy disclaims the line it sits beside", () => {
  // The two are rendered side by side, and the failure this guards is a reader
  // taking one line as covering both shells.
  assert.match(SCRATCH_PERSISTENCE.detail, /not one of this worktree's/);
  assert.notEqual(SCRATCH_PERSISTENCE.label, persistenceCopy("tmux").label);
  assert.notEqual(
    SCRATCH_PERSISTENCE.label,
    persistenceCopy("app-process").label,
  );
});
