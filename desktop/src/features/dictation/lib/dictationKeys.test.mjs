// Hold the right ⌥ to talk: down starts, up ends, nothing else resolves.

import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveDictationHold } from "./dictationKeys.ts";

const START = { type: "hold-start" };
const END = { type: "hold-end" };

function ev({
  code = "AltRight",
  key = "Alt",
  kind = "down",
  location = 2,
  repeat = false,
} = {}) {
  return { code, key, kind, location, repeat };
}

test("right ⌥ down starts, up ends", () => {
  assert.deepEqual(resolveDictationHold(ev()), START);
  assert.deepEqual(resolveDictationHold(ev({ kind: "up" })), END);
});

test("a browser that reports only the location still resolves", () => {
  assert.deepEqual(resolveDictationHold(ev({ code: "" })), START);
});

test("the left ⌥ is the text's and resolves to nothing", () => {
  assert.equal(
    resolveDictationHold(ev({ code: "AltLeft", location: 1 })),
    null,
  );
  assert.equal(resolveDictationHold(ev({ code: "", location: 1 })), null);
});

test("auto-repeat of a held key is not a second start", () => {
  assert.equal(resolveDictationHold(ev({ repeat: true })), null);
});

test("the old chord, and every other key, resolves to nothing", () => {
  assert.equal(
    resolveDictationHold(ev({ code: "KeyD", key: "d", location: 0 })),
    null,
  );
  assert.equal(
    resolveDictationHold(ev({ code: "Space", key: " ", location: 0 })),
    null,
  );
});
