import assert from "node:assert/strict";
import { test } from "node:test";

import {
  capLibrary,
  documentKey,
  documentText,
  MAX_DOCUMENTS,
  parseLibrary,
  putDocument,
} from "./documents.ts";

const A = documentKey("notes", "/tmp/a");
const B = documentKey("notes", "/tmp/b");

test("a kind and a project name one document, and neither can be spelled into another's key", () => {
  assert.notEqual(
    documentKey("notes", "/tmp/vingilot"),
    documentKey("plan", "/tmp/vingilot"),
  );
  assert.notEqual(A, B);
  // A project path can contain any character a filesystem allows, including
  // the ones a lazier separator would use — so "plan /x" as a *project* must
  // not land on the plan document of "/x".
  assert.notEqual(documentKey("notes", "plan /x"), documentKey("plan", "/x"));
});

test("a half-readable library reads as everything that is readable", () => {
  const library = parseLibrary(
    JSON.stringify({
      [A]: { savedAt: 1, text: "keep me" },
      [B]: "not a document",
      broken: { savedAt: 3 },
    }),
  );
  assert.deepEqual(Object.keys(library), [A]);
  assert.equal(documentText(library, A), "keep me");
});

test("unreadable storage is no answer, not an empty document", () => {
  assert.deepEqual(parseLibrary(null), {});
  assert.deepEqual(parseLibrary("{not json"), {});
  assert.deepEqual(parseLibrary("[]"), {});
  // And a document nobody has written reads as empty rather than throwing.
  assert.equal(documentText({}, A), "");
});

test("a document cleared to nothing keeps no row", () => {
  const written = putDocument({}, A, "something", 10);
  const cleared = putDocument(written, A, "", 20);
  assert.deepEqual(Object.keys(cleared), []);
  assert.equal(documentText(cleared, A), "");
});

test("past the cap the least recently saved document goes", () => {
  let library = {};
  for (let n = 0; n < MAX_DOCUMENTS; n += 1) {
    library = putDocument(
      library,
      documentKey("notes", `/tmp/${n}`),
      `note ${n}`,
      n + 1,
    );
  }
  const newest = documentKey("notes", "/tmp/new");
  const full = putDocument(library, newest, "the newest", MAX_DOCUMENTS + 1);
  assert.equal(Object.keys(full).length, MAX_DOCUMENTS);
  assert.equal(documentText(full, newest), "the newest");
  assert.equal(documentText(full, documentKey("notes", "/tmp/0")), "");
  assert.equal(documentText(full, documentKey("notes", "/tmp/1")), "note 1");
});

test("the write that overfilled the library is never the one evicted", () => {
  let library = {};
  for (let n = 0; n < MAX_DOCUMENTS; n += 1) {
    // Every other document claims a clock far in the future — a foreign write,
    // or a machine whose clock moved.
    library = putDocument(
      library,
      documentKey("notes", `/tmp/${n}`),
      `note ${n}`,
      1_000_000 + n,
    );
  }
  const mine = documentKey("notes", "/tmp/mine");
  const full = putDocument(library, mine, "what I typed", 5);
  assert.equal(Object.keys(full).length, MAX_DOCUMENTS);
  assert.equal(documentText(full, mine), "what I typed");
});

test("a library under the cap is left exactly as it is", () => {
  const library = { [A]: { savedAt: 1, text: "a" } };
  assert.equal(capLibrary(library), library);
});
