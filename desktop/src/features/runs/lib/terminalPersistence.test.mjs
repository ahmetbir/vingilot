import assert from "node:assert/strict";
import { test } from "node:test";
import { persistenceCopy } from "./terminalPersistence.ts";

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
