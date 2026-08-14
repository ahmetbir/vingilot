// ⌃⌘D resolves to toggle-dictation and nothing else does.

import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveDictationKey } from "./dictationKeys.ts";

const TOGGLE = { type: "toggle-dictation" };

function press({
  alt = false,
  ctrl = true,
  key = "d",
  primary = true,
  repeat = false,
  shift = false,
} = {}) {
  return {
    altKey: alt,
    ctrlKey: ctrl,
    key,
    primaryModifier: primary,
    repeat,
    shiftKey: shift,
  };
}

test("⌃⌘D resolves to toggle-dictation", () => {
  assert.deepEqual(resolveDictationKey(press()), TOGGLE);
});

test("case-insensitive: caps lock reporting 'D' still resolves", () => {
  assert.deepEqual(resolveDictationKey(press({ key: "D" })), TOGGLE);
});

test("without Control (plain ⌘D) resolves to nothing — that chord belongs to terminalKeys' deliberate absence", () => {
  assert.equal(resolveDictationKey(press({ ctrl: false })), null);
});

test("without the primary modifier (plain ⌃D) resolves to nothing", () => {
  assert.equal(resolveDictationKey(press({ primary: false })), null);
});

test("⌥ added (⌃⌥⌘D) resolves to nothing", () => {
  assert.equal(resolveDictationKey(press({ alt: true })), null);
});

test("⇧ added (⌃⇧⌘D) resolves to nothing", () => {
  assert.equal(resolveDictationKey(press({ shift: true })), null);
});

test("a different letter resolves to nothing", () => {
  assert.equal(resolveDictationKey(press({ key: "e" })), null);
});

test("auto-repeat is not a second press", () => {
  assert.equal(resolveDictationKey(press({ repeat: true })), null);
});
