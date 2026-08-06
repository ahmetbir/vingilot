import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveKey } from "./terminalKeys.ts";

test("primary+1 through primary+9 switch to worktree index 0-8", () => {
  for (let digit = 1; digit <= 9; digit++) {
    const action = resolveKey({ key: String(digit), primaryModifier: true });
    assert.deepEqual(action, { type: "switch-worktree", index: digit - 1 });
  }
});

test("primary+0 is not a worktree switch", () => {
  assert.equal(resolveKey({ key: "0", primaryModifier: true }), null);
});

test("digits without the primary modifier are not a worktree switch", () => {
  assert.equal(resolveKey({ key: "1", primaryModifier: false }), null);
});

test("primary+backtick focuses the terminal", () => {
  assert.deepEqual(resolveKey({ key: "`", primaryModifier: true }), {
    type: "focus-terminal",
  });
});

test("backtick without the primary modifier does not focus the terminal", () => {
  assert.equal(resolveKey({ key: "`", primaryModifier: false }), null);
});

test("Escape leaves the terminal", () => {
  assert.deepEqual(resolveKey({ key: "Escape", primaryModifier: false }), {
    type: "leave-terminal",
  });
});

test("Escape with the primary modifier held is not a leave (e.g. a chord in flight)", () => {
  assert.equal(resolveKey({ key: "Escape", primaryModifier: true }), null);
});

test("shift+primary+digit is not a worktree switch (reserved for other shortcuts)", () => {
  assert.equal(
    resolveKey({ key: "1", primaryModifier: true, shiftKey: true }),
    null,
  );
});

test("alt held short-circuits to null regardless of other flags", () => {
  assert.equal(
    resolveKey({ key: "1", primaryModifier: true, altKey: true }),
    null,
  );
  assert.equal(
    resolveKey({ key: "Escape", primaryModifier: false, altKey: true }),
    null,
  );
});

test("an unrelated key resolves to null", () => {
  assert.equal(resolveKey({ key: "a", primaryModifier: true }), null);
  assert.equal(resolveKey({ key: "Enter", primaryModifier: false }), null);
});

test("multi-character non-digit keys never crash digit parsing", () => {
  assert.equal(resolveKey({ key: "F1", primaryModifier: true }), null);
  assert.equal(resolveKey({ key: "", primaryModifier: true }), null);
});
