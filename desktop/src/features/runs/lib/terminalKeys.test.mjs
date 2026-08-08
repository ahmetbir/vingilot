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

test("alt held takes every chord except the tab arrows and the scratch shell out of this map", () => {
  assert.equal(
    resolveKey({ key: "1", primaryModifier: true, altKey: true }),
    null,
  );
  assert.equal(
    resolveKey({ key: "Escape", primaryModifier: false, altKey: true }),
    null,
  );
  assert.equal(
    resolveKey({ key: "`", primaryModifier: true, altKey: true }),
    null,
  );
  assert.equal(
    resolveKey({ key: "w", primaryModifier: true, altKey: true }),
    null,
  );
});

test("alt+primary+t opens the scratch shell", () => {
  assert.deepEqual(
    resolveKey({ altKey: true, key: "t", primaryModifier: true }),
    { type: "open-scratch-terminal" },
  );
});

test("the scratch chord survives caps lock and macOS's option composition", () => {
  // Caps lock reports "T" for the unshifted chord; ⌥t composes to "†" when
  // the option layer still applies, the same reading paneKeys accepts "∫" for.
  assert.deepEqual(
    resolveKey({ altKey: true, key: "T", primaryModifier: true }),
    { type: "open-scratch-terminal" },
  );
  assert.deepEqual(
    resolveKey({ altKey: true, key: "†", primaryModifier: true }),
    { type: "open-scratch-terminal" },
  );
});

test("the scratch chord needs both modifiers and refuses shift", () => {
  // ⌥T alone is a dagger the owner is typing; ⌘T is a terminal tab, which is
  // the opposite of this; ⇧⌥⌘T is nobody's and was never checked for
  // claimants, so claiming it by ignoring shift would be taking it blind.
  assert.equal(
    resolveKey({ altKey: true, key: "t", primaryModifier: false }),
    null,
  );
  assert.deepEqual(resolveKey({ key: "t", primaryModifier: true }), {
    type: "new-terminal-tab",
  });
  assert.equal(
    resolveKey({
      altKey: true,
      key: "T",
      primaryModifier: true,
      shiftKey: true,
    }),
    null,
  );
});

test("a held-down scratch chord opens one shell, not thirty", () => {
  assert.equal(
    resolveKey({
      altKey: true,
      key: "t",
      primaryModifier: true,
      repeat: true,
    }),
    null,
  );
});

test("primary+t opens a new terminal tab", () => {
  assert.deepEqual(resolveKey({ key: "t", primaryModifier: true }), {
    type: "new-terminal-tab",
  });
});

test("shift+primary+w closes the showing terminal tab", () => {
  assert.deepEqual(
    resolveKey({ key: "W", primaryModifier: true, shiftKey: true }),
    { type: "close-terminal-tab" },
  );
});

test("primary+w is left to the macOS menu, which resolves it before we ever see it", () => {
  // Tauri's default application menu binds ⌘W to Close Window and macOS
  // dispatches menu key equivalents ahead of the webview. Claiming it here
  // would not close a tab; it would close the owner's window.
  assert.equal(resolveKey({ key: "w", primaryModifier: true }), null);
  assert.equal(resolveKey({ key: "W", primaryModifier: true }), null);
});

test("caps lock does not lose the tab chords", () => {
  // macOS reports "T" for ⌘T with caps lock on, and shift is still not held.
  assert.deepEqual(resolveKey({ key: "T", primaryModifier: true }), {
    type: "new-terminal-tab",
  });
  // …and "w" for ⇧⌘W with caps lock on, where shift IS held.
  assert.deepEqual(
    resolveKey({ key: "w", primaryModifier: true, shiftKey: true }),
    { type: "close-terminal-tab" },
  );
});

test("shift+primary+t is left to whatever else claims it", () => {
  assert.equal(
    resolveKey({ key: "T", primaryModifier: true, shiftKey: true }),
    null,
  );
});

test("a held-down chord resolves once, not once per auto-repeat", () => {
  // ⌘T spawns a shell and, under tmux, a session. ~15-30 keydowns a second
  // from a leaned-on key would leave dozens of them running, closable one
  // click at a time.
  assert.equal(
    resolveKey({ key: "t", primaryModifier: true, repeat: true }),
    null,
  );
  assert.equal(
    resolveKey({
      key: "W",
      primaryModifier: true,
      repeat: true,
      shiftKey: true,
    }),
    null,
  );
  assert.equal(
    resolveKey({ key: "1", primaryModifier: true, repeat: true }),
    null,
  );
  assert.equal(
    resolveKey({
      altKey: true,
      key: "ArrowRight",
      primaryModifier: true,
      repeat: true,
    }),
    null,
  );
});

test("t and w without the primary modifier are just letters", () => {
  assert.equal(resolveKey({ key: "t", primaryModifier: false }), null);
  assert.equal(resolveKey({ key: "w", primaryModifier: false }), null);
});

test("alt+primary+arrows move between terminal tabs", () => {
  assert.deepEqual(
    resolveKey({ altKey: true, key: "ArrowLeft", primaryModifier: true }),
    { dir: -1, type: "step-terminal-tab" },
  );
  assert.deepEqual(
    resolveKey({ altKey: true, key: "ArrowRight", primaryModifier: true }),
    { dir: 1, type: "step-terminal-tab" },
  );
});

test("shift added to the tab arrows moves the tab itself", () => {
  assert.deepEqual(
    resolveKey({
      altKey: true,
      key: "ArrowRight",
      primaryModifier: true,
      shiftKey: true,
    }),
    { dir: 1, type: "move-terminal-tab" },
  );
});

test("arrows without both modifiers are left alone", () => {
  // Alt+arrow alone is the app's own back/forward chord on non-mac
  // (app/navigation/useBackForwardControls.ts); a bare arrow is text
  // navigation inside the terminal.
  assert.equal(
    resolveKey({ altKey: true, key: "ArrowLeft", primaryModifier: false }),
    null,
  );
  assert.equal(
    resolveKey({ altKey: false, key: "ArrowLeft", primaryModifier: true }),
    null,
  );
  assert.equal(resolveKey({ key: "ArrowRight", primaryModifier: false }), null);
});

test("alt+primary with a key that is neither an arrow nor the scratch chord resolves to nothing", () => {
  assert.equal(
    resolveKey({ altKey: true, key: "ArrowUp", primaryModifier: true }),
    null,
  );
  assert.equal(
    resolveKey({ altKey: true, key: "b", primaryModifier: true }),
    null,
  );
  assert.equal(
    resolveKey({ altKey: true, key: "1", primaryModifier: true }),
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
