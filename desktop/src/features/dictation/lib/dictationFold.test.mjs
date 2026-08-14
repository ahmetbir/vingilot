// The dictation fold, proved: append-only, spacing-aware, and the rich-text
// delta a caller inserts is exactly the suffix the fold implies.
// (vingilot/docs/plans/2026-08-13-voice.md, Task 3.)

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  dictationCaretInsertionText,
  dictationInsertionText,
  foldDictationSegment,
} from "./dictationFold.ts";

test("first segment into an empty draft needs no leading space", () => {
  assert.equal(foldDictationSegment("", "hello there"), "hello there");
});

test("a second segment gets exactly one space before it", () => {
  assert.equal(
    foldDictationSegment("hello there", "how are you"),
    "hello there how are you",
  );
});

test("an existing trailing space is not doubled", () => {
  assert.equal(
    foldDictationSegment("typed by hand ", "and now spoken"),
    "typed by hand and now spoken",
  );
});

test("an existing trailing newline is not turned into a space+newline", () => {
  assert.equal(
    foldDictationSegment("line one\n", "line two"),
    "line one\nline two",
  );
});

test("a segment that trims to nothing changes nothing", () => {
  assert.equal(foldDictationSegment("hello", "   "), "hello");
  assert.equal(foldDictationSegment("hello", ""), "hello");
});

test("leading/trailing whitespace on the segment itself is trimmed", () => {
  assert.equal(foldDictationSegment("hello", "  world  "), "hello world");
});

test("no partial/replace case exists — every call only ever appends", () => {
  // The recon's whole point: there is no interim string to fold over a
  // previous one. Two calls in sequence must never shrink or rewrite what
  // came before — each result must start with the previous result.
  const afterFirst = foldDictationSegment("", "the quick brown fox");
  const afterSecond = foldDictationSegment(afterFirst, "jumps over the dog");
  assert.ok(afterSecond.startsWith(afterFirst));
});

test("rich-text delta is the fold's suffix, not the whole text", () => {
  const existing = "hello there";
  const delta = dictationInsertionText(existing, "how are you");
  assert.equal(delta, " how are you");
  assert.equal(existing + delta, foldDictationSegment(existing, "how are you"));
});

test("rich-text delta is empty when the segment is empty", () => {
  assert.equal(dictationInsertionText("hello", "   "), "");
});

test("rich-text delta into an empty draft is the trimmed segment itself", () => {
  assert.equal(dictationInsertionText("", "  hi  "), "hi");
});

// `dictationCaretInsertionText` — spacing computed from the caret, not from
// the end of the document (mid-text caret is the whole point: the composer's
// caret is not always at the end, unlike the Ask box's).

test("caret at the very end behaves like the end-of-document fold", () => {
  const text = "hello there";
  assert.equal(
    dictationCaretInsertionText(text, text.length, "how are you"),
    " how are you",
  );
});

test("caret at the very start of existing text gets a trailing space, no leading space", () => {
  assert.equal(dictationCaretInsertionText("world", 0, "hello"), "hello ");
});

test("caret mid-text with no adjacent whitespace gets both a leading and a trailing space", () => {
  // "helloworld" with the caret between "hello" and "world" (offset 5) —
  // dictating "there" must not glue onto either neighbor.
  const text = "helloworld";
  assert.equal(dictationCaretInsertionText(text, 5, "there"), " there ");
});

test("caret right after an existing space needs no leading space", () => {
  // "hello world", caret at offset 6 (just after "hello ", before "world").
  const text = "hello world";
  assert.equal(dictationCaretInsertionText(text, 6, "there"), "there ");
});

test("caret right before an existing space needs no trailing space", () => {
  // "hello world", caret at offset 5 (just after "hello", before " world").
  const text = "hello world";
  assert.equal(dictationCaretInsertionText(text, 5, "there"), " there");
});

test("caret between two spaces needs neither", () => {
  const text = "hello  world";
  assert.equal(dictationCaretInsertionText(text, 6, "there"), "there");
});

test("caret in an empty draft needs no space on either side", () => {
  assert.equal(dictationCaretInsertionText("", 0, "hello"), "hello");
});

test("caret insertion trims the segment and drops a whitespace-only one", () => {
  assert.equal(dictationCaretInsertionText("hello world", 5, "  "), "");
  assert.equal(
    dictationCaretInsertionText("hello world", 5, "  there  "),
    " there",
  );
});
