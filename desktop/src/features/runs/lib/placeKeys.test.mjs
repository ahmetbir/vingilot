// What ⌃⇥ means, and everything it must refuse
// (vingilot/docs/plans/2026-08-12-vscode-muscle-memory.md, Task 3).

import assert from "node:assert/strict";
import { test } from "node:test";

import { resolvePlaceKey, resolvePlaceListKey } from "./placeKeys.ts";

/** One keydown, with everything released unless it is named. */
function press(over) {
  return { key: "Tab", primaryModifier: false, ...over };
}

test("⌃⇥ steps forward and ⇧⌃⇥ steps back", () => {
  assert.deepEqual(resolvePlaceKey(press({ ctrlKey: true })), {
    delta: 1,
    type: "step",
  });
  assert.deepEqual(resolvePlaceKey(press({ ctrlKey: true, shiftKey: true })), {
    delta: -1,
    type: "step",
  });
});

test("a held ⇥ keeps walking — the one chord in this island that repeats", () => {
  // Everywhere else a repeat is refused because each press is a discrete act.
  // Here the discrete act is releasing ⌃, and holding ⇥ down the list is how an
  // alt-tab switcher is driven with the thumb still on the modifier.
  assert.deepEqual(resolvePlaceKey(press({ ctrlKey: true, repeat: true })), {
    delta: 1,
    type: "step",
  });
});

test("⇥ without ⌃ is not this map's — it is still the browser's focus walk", () => {
  assert.equal(resolvePlaceKey(press({})), null);
  assert.equal(resolvePlaceKey(press({ shiftKey: true })), null);
});

test("the chord is Control itself, not the platform's primary modifier", () => {
  // The one map here that reads raw modifiers. `primaryModifier` is ⌘ on macOS
  // and Ctrl elsewhere, so a map written against it would answer to ⌘⇥ — which
  // macOS resolves above every window and a webview never sees — while refusing
  // the real ⌃⇥ on Linux and Windows, where that same flag *is* `ctrlKey`.
  assert.equal(resolvePlaceKey(press({ primaryModifier: true })), null);
  // **This is the off-mac press, exactly as `usePlaceSwitcher` builds it.** On
  // Linux and Windows `hasPrimaryShortcutModifier` returns true for ⌃, so ⌃⇥
  // arrives with both flags set — and it is still the step, because `tauri.conf`
  // builds for those platforms and the generated sheet prints ⌃⇥ on them.
  assert.deepEqual(
    resolvePlaceKey(press({ ctrlKey: true, primaryModifier: true })),
    { delta: 1, type: "step" },
  );
  // ⌃⌘⇥ is a chord nobody checked against the claimants, so it is nobody's —
  // refused by the physical ⌘, which is the only reading that means the same
  // thing on every platform.
  assert.equal(
    resolvePlaceKey(press({ ctrlKey: true, metaKey: true })),
    null,
    "macOS: ⌃⌘⇥",
  );
  assert.equal(
    resolvePlaceKey(
      press({ ctrlKey: true, metaKey: true, primaryModifier: false }),
    ),
    null,
    "off-mac: ⌃ with Super, which platform.ts reports as no primary modifier",
  );
});

test("⌥⌃⇥ is nobody's", () => {
  assert.equal(resolvePlaceKey(press({ altKey: true, ctrlKey: true })), null);
});

test("⌃ on any other key falls straight through to the terminal underneath", () => {
  // The gesture is held over a shell more often than anywhere else, so a map
  // that answered broadly with ⌃ down would swallow ⌃C, ⌃D, ⌃R.
  for (const key of ["c", "d", "r", "a", "Enter", "ArrowDown", "Escape"]) {
    assert.equal(resolvePlaceKey(press({ ctrlKey: true, key })), null, key);
  }
});

test("Esc calls the walk off, and it arrives with ⌃ still held", () => {
  // The state this key is pressed in is one where the modifier is *down* — so a
  // map that refused on `ctrlKey` would be a cancel that never fires.
  assert.deepEqual(
    resolvePlaceListKey({ key: "Escape", primaryModifier: false }),
    {
      type: "cancel",
    },
  );
  assert.deepEqual(
    resolvePlaceListKey({
      ctrlKey: true,
      key: "Escape",
      primaryModifier: false,
    }),
    { type: "cancel" },
  );
});

test("nothing else is the open switcher's — the walk is the chord and the commit is letting go", () => {
  for (const key of ["Enter", "ArrowDown", "ArrowUp", "Tab", "a", " "]) {
    assert.equal(
      resolvePlaceListKey({ ctrlKey: true, key, primaryModifier: false }),
      null,
      key,
    );
  }
  // A held Esc answers once: the rest would be answering for a switcher that is
  // no longer open.
  assert.equal(
    resolvePlaceListKey({
      key: "Escape",
      primaryModifier: false,
      repeat: true,
    }),
    null,
  );
  // ⌘Esc and ⌥Esc belong to whoever binds them, not here — refused by the
  // physical ⌘, because the cancel arrives with ⌃ held and off-mac that alone
  // sets `primaryModifier`. A refusal on that flag would be a cancel that never
  // fires on Linux or Windows, which is the reading below.
  assert.equal(
    resolvePlaceListKey({
      key: "Escape",
      metaKey: true,
      primaryModifier: true,
    }),
    null,
  );
  assert.deepEqual(
    resolvePlaceListKey({
      ctrlKey: true,
      key: "Escape",
      primaryModifier: true,
    }),
    { type: "cancel" },
    "off-mac ⌃Esc, which platform.ts reports as the primary modifier",
  );
  assert.equal(
    resolvePlaceListKey({
      altKey: true,
      key: "Escape",
      primaryModifier: false,
    }),
    null,
  );
});
