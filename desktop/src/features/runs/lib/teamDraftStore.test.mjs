// What survives a remount, and what a half-readable record costs.
//
// The pane's own rule is that nothing the owner typed disappears without a
// word. That makes the read path the interesting one: a record that throws, or
// that answers `{}` because one row in it was nonsense, would lose a paragraph
// exactly as silently as the React state it replaced.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  draftFor,
  parseTeamDrafts,
  readTeamDrafts,
  withDraft,
  writeTeamDrafts,
} from "./teamDraftStore.ts";

function shim(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value),
    store,
  };
}

test("nothing stored reads as no drafts, not as a throw", () => {
  assert.deepEqual(parseTeamDrafts(null), {});
  assert.deepEqual(parseTeamDrafts(""), {});
  assert.deepEqual(parseTeamDrafts("{not json"), {});
  assert.deepEqual(parseTeamDrafts("[1,2]"), {});
});

test("one unreadable row does not cost the readable ones", () => {
  const parsed = parseTeamDrafts(
    JSON.stringify({
      "": "keyed by nothing",
      "binding-1": "why is the build red",
      "binding-2": 7,
      "binding-3": { text: "nested" },
      "binding-4": "",
    }),
  );
  assert.deepEqual(parsed, { "binding-1": "why is the build red" });
});

test("a draft written is the draft that comes back", () => {
  const storage = shim();
  writeTeamDrafts({ "binding-1": "a paragraph he typed" }, storage);
  assert.deepEqual(readTeamDrafts(storage), {
    "binding-1": "a paragraph he typed",
  });
});

test("newlines and whitespace come back exactly as typed", () => {
  const storage = shim();
  const typed = "  first line\n\n  second line, still indented  ";
  writeTeamDrafts(withDraft({}, "binding-1", typed), storage);
  assert.equal(draftFor(readTeamDrafts(storage), "binding-1"), typed);
});

test("each worktree keeps its own sentence", () => {
  let drafts = withDraft({}, "binding-1", "about the left checkout");
  drafts = withDraft(drafts, "binding-2", "about the right one");
  assert.equal(draftFor(drafts, "binding-1"), "about the left checkout");
  assert.equal(draftFor(drafts, "binding-2"), "about the right one");
  assert.equal(draftFor(drafts, "binding-3"), "");
  assert.equal(draftFor(drafts, null), "");
});

test("emptying a draft removes its row rather than storing an empty one", () => {
  const drafts = withDraft(
    { "binding-1": "typed then deleted", "binding-2": "kept" },
    "binding-1",
    "",
  );
  assert.deepEqual(drafts, { "binding-2": "kept" });
});

test("unchanged text is the same object, so the caller writes nothing", () => {
  const drafts = { "binding-1": "unchanged" };
  assert.equal(withDraft(drafts, "binding-1", "unchanged"), drafts);
  const empty = {};
  assert.equal(withDraft(empty, "binding-1", ""), empty);
});

test("a storage that refuses the write does not throw the render down", () => {
  const refusing = {
    getItem: () => null,
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
  };
  assert.doesNotThrow(() => writeTeamDrafts({ "binding-1": "kept" }, refusing));
});
