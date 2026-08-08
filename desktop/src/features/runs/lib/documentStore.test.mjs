import assert from "node:assert/strict";
import { test } from "node:test";

import { documentKey } from "./documents.ts";
import { readDocument, writeDocument } from "./documentStore.ts";

const A = documentKey("notes", "/tmp/a");
const B = documentKey("notes", "/tmp/b");

function shim(initial = null) {
  let value = initial;
  return {
    getItem: () => value,
    read: () => value,
    setItem: (_key, next) => {
      value = next;
    },
  };
}

test("a document written is the document read back", () => {
  const storage = shim();
  assert.equal(writeDocument(A, "half a page", 1, storage), true);
  assert.equal(readDocument(A, storage), "half a page");
});

test("one project's notes are not another's", () => {
  const storage = shim();
  writeDocument(A, "about a", 1, storage);
  writeDocument(B, "about b", 2, storage);
  assert.equal(readDocument(A, storage), "about a");
  assert.equal(readDocument(B, storage), "about b");
});

test("two windows on one document: the later write wins, whole", () => {
  // Both windows share this origin's storage. Neither is told about the
  // other, so what the second writes is the document — the paragraph the
  // first added is not merged in, it is gone. Stated here as the behaviour it
  // is, so a later merge is a change to a test rather than a surprise.
  const storage = shim();
  writeDocument(A, "the first window's page", 1, storage);
  writeDocument(A, "the second window's page", 2, storage);
  assert.equal(readDocument(A, storage), "the second window's page");
});

test("a build with nowhere to write says so instead of claiming a save", () => {
  assert.equal(writeDocument(A, "typed into the void", 1, null), false);
  assert.equal(readDocument(A, null), "");
});

test("storage that refuses the write reports it, and keeps what was already there", () => {
  const storage = shim();
  writeDocument(A, "what was saved", 1, storage);
  const refusing = {
    getItem: storage.getItem,
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
  };
  assert.equal(writeDocument(A, "what could not be", 2, refusing), false);
  assert.equal(readDocument(A, storage), "what was saved");
});

test("a read a webview refuses costs the render nothing", () => {
  const unreadable = {
    getItem: () => {
      throw new Error("SecurityError");
    },
    setItem: () => {},
  };
  assert.doesNotThrow(() => readDocument(A, unreadable));
});
