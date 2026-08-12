// ⌘F and the bar's own three keys, as a map
// (vingilot/docs/plans/2026-08-12-vscode-muscle-memory.md, Task 1).
//
// The chord *arriving* — and, just as importantly, still reaching upstream's
// find-in-this-channel everywhere else — is proved in a browser
// (`desktop/tests/e2e/workspace-find.spec.ts`), because a claimant check is a
// reading of source and only a press proves a chord reaches a webview. What is
// here is the meaning: which keydowns these two maps answer to, and which they
// refuse.

import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveFindBarKey, resolveFindKey } from "./findKeys.ts";

const OPEN = { type: "open-find" };

function press(over = {}) {
  return resolveFindKey({ key: "f", primaryModifier: true, ...over });
}

function inBar(over = {}) {
  return resolveFindBarKey({ key: "Enter", primaryModifier: false, ...over });
}

test("the chord is ⌘F", () => {
  assert.deepEqual(press(), OPEN);
  // A caps-locked keyboard reports the capital, and the chord he pressed is the
  // same chord.
  assert.deepEqual(press({ key: "F" }), OPEN);
});

test("⇧⌘F is left alone, because it is the checkout-wide search", () => {
  // Two different questions, two different chords — `searchKeys.ts` guards the
  // other way round, so the pair covers the letter exactly once.
  assert.equal(press({ shiftKey: true }), null);
});

test("⌥ is not ignored — an unchecked chord is how ⌘W was lost", () => {
  assert.equal(press({ altKey: true }), null);
  assert.equal(press({ altKey: true, shiftKey: true }), null);
});

test("nothing without the primary modifier, so typing an f is typing an f", () => {
  assert.equal(press({ primaryModifier: false }), null);
});

test("a held-down chord is one press, not thirty a second", () => {
  // Each repeat re-selects the field, which would make the field untypeable.
  assert.equal(press({ repeat: true }), null);
});

test("no other key is this chord", () => {
  for (const key of ["g", "k", "/", "Enter", "Escape", "ArrowDown", "F3"]) {
    assert.equal(press({ key }), null, key);
  }
});

test("in the bar: Enter walks forward, ⇧Enter back", () => {
  assert.deepEqual(inBar(), { type: "next" });
  assert.deepEqual(inBar({ shiftKey: true }), { type: "previous" });
});

test("in the bar: Escape closes, held or not", () => {
  // Idempotent, so a held key is not a reason to refuse — a bar that would not
  // close because the key was held is a trap.
  assert.deepEqual(inBar({ key: "Escape" }), { type: "close" });
  assert.deepEqual(inBar({ key: "Escape", repeat: true }), { type: "close" });
});

test("in the bar: a modified Enter or Escape is not this bar's", () => {
  // ⌘Enter and ⌘Escape belong to surfaces this bar knows nothing about, and a
  // walk that fired on them would be this bar taking a chord it never checked.
  assert.equal(inBar({ primaryModifier: true }), null);
  assert.equal(inBar({ altKey: true }), null);
  assert.equal(inBar({ key: "Escape", primaryModifier: true }), null);
  assert.equal(inBar({ key: "Escape", altKey: true }), null);
});

test("in the bar: everything else is typing", () => {
  for (const key of ["a", "F", "Tab", "ArrowDown", "Home", "/", "1"]) {
    assert.equal(inBar({ key }), null, key);
  }
  // Including the chord that opened it: ⌘F inside the field is handled by the
  // window listener (it re-selects), not by this map.
  assert.equal(inBar({ key: "f", primaryModifier: true }), null);
});
