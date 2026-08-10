import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isScopeCollapsed,
  parseCollapsedScopes,
  readCollapsedScopes,
  withScopeCollapsed,
  writeCollapsedScopes,
} from "./teamScopeStore.ts";

function shim(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value),
    store,
  };
}

const KEY = "vingilot-team-scope.v1";
const THREAD = "channel-abc";
const OTHER = "channel-def";

test("a thread nobody has had an opinion about shows its scope", () => {
  // The default is the whole argument for the sentence existing: it earns its
  // length on first read, and a thread this app has never heard of has not had
  // one.
  assert.equal(isScopeCollapsed({}, THREAD), false);
  assert.equal(isScopeCollapsed(readCollapsedScopes(shim()), THREAD), false);
});

test("the choice is remembered, and only for the thread it was made in", () => {
  const one = withScopeCollapsed({}, THREAD, true);
  assert.equal(isScopeCollapsed(one, THREAD), true);
  // Two threads about the same worktree are two conversations. Putting one
  // scope away says nothing about a scope that has never been on screen.
  assert.equal(isScopeCollapsed(one, OTHER), false);
});

test("the full text comes back, and the record forgets rather than flags", () => {
  const away = withScopeCollapsed({}, THREAD, true);
  const back = withScopeCollapsed(away, THREAD, false);
  assert.equal(isScopeCollapsed(back, THREAD), false);
  // Absent, not `false`: the file only ever holds the threads that are put
  // away, so the record cannot grow a second way of saying "open".
  assert.deepEqual(back, {});
});

test("a no-op returns the same object, so nothing is written on it", () => {
  const away = withScopeCollapsed({}, THREAD, true);
  assert.equal(withScopeCollapsed(away, THREAD, true), away);
  const open = {};
  assert.equal(withScopeCollapsed(open, THREAD, false), open);
  // A channel with no id is not a thread, and cannot be recorded against.
  assert.equal(withScopeCollapsed(open, "", true), open);
});

test("a thread with no channel yet is never collapsed", () => {
  // The preflight, where the sentence is doing its first job and there is no
  // thread to have had an opinion about.
  assert.equal(isScopeCollapsed({ "": true }, null), false);
  assert.equal(isScopeCollapsed({ "": true }, ""), false);
});

test("storage that cannot be read is not an answer about any thread", () => {
  for (const raw of [null, "", "{", "[]", '"nope"', "17"]) {
    assert.deepEqual(parseCollapsedScopes(raw), {}, `raw ${raw}`);
  }
  // A half-readable record keeps whatever is readable and drops the rest,
  // rather than throwing inside the render that puts the pane up.
  assert.deepEqual(
    parseCollapsedScopes(
      JSON.stringify({ [THREAD]: true, [OTHER]: "yes", "": true, third: 1 }),
    ),
    { [THREAD]: true },
  );
});

test("what is written is what is read back", () => {
  const storage = shim();
  writeCollapsedScopes(withScopeCollapsed({}, THREAD, true), storage);
  assert.equal(storage.store.get(KEY), JSON.stringify({ [THREAD]: true }));
  assert.equal(isScopeCollapsed(readCollapsedScopes(storage), THREAD), true);
});

test("a storage that refuses the write costs the preference and not the render", () => {
  const refusing = {
    getItem: () => null,
    setItem: () => {
      throw new Error("quota");
    },
  };
  assert.doesNotThrow(() => writeCollapsedScopes({ [THREAD]: true }, refusing));
});
