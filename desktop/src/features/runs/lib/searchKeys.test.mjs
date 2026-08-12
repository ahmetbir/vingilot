// ⇧⌘F, as a map (vingilot/docs/plans/2026-08-11-what-sent-him-to-vscode.md,
// Task 2). The chord that arrives is proved in the browser
// (desktop/tests/e2e/workspace-search.spec.ts) — a claimant check is a reading
// of source, and only a press proves a chord reaches a webview. What is here is
// the meaning: which keydowns this map answers to and, more importantly, which
// it refuses.

import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveSearchKey } from "./searchKeys.ts";

const OPEN = { type: "open-search" };

function press(over = {}) {
  return resolveSearchKey({
    key: "f",
    primaryModifier: true,
    shiftKey: true,
    ...over,
  });
}

test("the chord is ⇧⌘F", () => {
  assert.deepEqual(press(), OPEN);
  // A caps-locked keyboard reports the capital, and the chord he pressed is the
  // same chord.
  assert.deepEqual(press({ key: "F" }), OPEN);
});

test("⌘F is left alone, because it is upstream's find-in-this-channel", () => {
  // **The whole reason this chord has a ⇧ in it.**
  // `features/search/useChannelFind.ts` binds the platform find chord on this
  // letter with `!event.shiftKey` in its own guard. Answering a bare ⌘F here
  // would take a working feature away from every other screen in the app —
  // silently, because both handlers would run and only one would be visible.
  assert.equal(press({ shiftKey: false }), null);
});

test("nothing without the primary modifier, so typing an F is typing an F", () => {
  assert.equal(press({ primaryModifier: false }), null);
  assert.equal(press({ primaryModifier: false, shiftKey: false }), null);
});

test("⌥ is not ignored — an unchecked chord is how ⌘W was lost", () => {
  // ⌥⇧⌘F is nobody's, and claiming it by ignoring ⌥ would be taking a chord
  // this map's own claimant check never covered.
  assert.equal(press({ altKey: true }), null);
});

test("a held-down chord is one press, not thirty a second", () => {
  assert.equal(press({ repeat: true }), null);
});

test("no other key is this chord", () => {
  for (const key of ["g", "k", "/", "Enter", "ArrowDown", "F1"]) {
    assert.equal(press({ key }), null, key);
  }
});
