import assert from "node:assert/strict";
import { test } from "node:test";

import {
  HIGHLIGHT_BYTE_CEILING,
  HIGHLIGHT_LINE_CEILING,
  languageOf,
  markedLineIndex,
  viewerPlan,
} from "./fileViewer.ts";

test("the marked line is one index, for both renderers", () => {
  // His numbers are 1-based and the DOM's are 0-based, and that subtraction
  // used to be written once per render path — arithmetic in two places is
  // arithmetic that is right in one of them.
  assert.equal(markedLineIndex(1), 0);
  assert.equal(markedLineIndex(42), 41);
});

test("no line asked for marks nothing, and neither does a line nobody can mean", () => {
  // A file opened from the tree has no interesting line; marking line 1 there
  // would put a highlight on a row he did not ask about.
  assert.equal(markedLineIndex(null), null);
  // 0 and negatives are callers that cannot mean it. `null` rather than a
  // negative index, which would silently mark the LAST line of the file.
  assert.equal(markedLineIndex(0), null);
  assert.equal(markedLineIndex(-3), null);
  assert.equal(markedLineIndex(2.5), null);
  assert.equal(markedLineIndex(Number.NaN), null);
});

test("a language is taken from the extension, case-insensitively", () => {
  assert.equal(languageOf("src/main.rs"), "rust");
  assert.equal(languageOf("desktop/src/app/App.TSX"), "tsx");
  assert.equal(languageOf("a/b/c.yml"), "yaml");
  assert.equal(languageOf("notes.md"), "markdown");
});

test("a file whose whole name is the type is named by it", () => {
  // A Dockerfile has no extension and is not plain text.
  assert.equal(languageOf("Dockerfile"), "docker");
  assert.equal(languageOf("deep/dir/Justfile"), "make");
  assert.equal(languageOf(".gitignore"), "ini");
});

test("an unknown type is plain, which is an answer and not a gap", () => {
  // Guessing an id Shiki does not know makes `loadLanguage` throw, and the
  // component then falls back to plain text with no reason on screen — the
  // exact silent failure this module exists to end.
  assert.equal(languageOf("data.parquet"), "plain");
  assert.equal(languageOf("LICENSE"), "plain");
  // A dotfile's dot is not an extension.
  assert.equal(languageOf(".env"), "plain");
});

test("a small known file is highlighted, and says nothing about it", () => {
  const plan = viewerPlan("src/main.rs", 40, 900);
  assert.equal(plan.render, "highlighted");
  assert.equal(plan.language, "rust");
  // A reason is what is shown when something is NOT happening. A viewer that
  // narrated its successes would be one more line of chrome in a 440px pane.
  assert.equal(plan.why, null);
});

test("a file over the line ceiling renders plain AND says why, with both numbers", () => {
  // The honest half of reusing upstream's highlighter: past its ceiling it
  // falls back silently, and a 400-line file rendering unhighlighted with
  // nothing saying why reads as broken highlighting.
  const plan = viewerPlan("src/main.rs", 1204, 40_000);
  assert.equal(plan.render, "plain");
  assert.equal(plan.language, "rust");
  assert.match(plan.why, /1,204 lines/);
  assert.match(plan.why, new RegExp(String(HIGHLIGHT_LINE_CEILING)));
});

test("the line ceiling is inclusive", () => {
  assert.equal(
    viewerPlan("a.ts", HIGHLIGHT_LINE_CEILING, 100).render,
    "highlighted",
  );
  assert.equal(
    viewerPlan("a.ts", HIGHLIGHT_LINE_CEILING + 1, 100).render,
    "plain",
  );
});

test("a minified bundle is caught by the byte ceiling, which the line count cannot see", () => {
  // One line, eight megabytes. A line ceiling alone bounds nothing.
  const plan = viewerPlan("dist/bundle.js", 1, HIGHLIGHT_BYTE_CEILING + 1);
  assert.equal(plan.render, "plain");
  assert.match(plan.why, /KiB/);
});

test("an unknown type says it is unknown rather than blaming a ceiling", () => {
  // Three reasons for plain text, and they are three different things he
  // might do next. A single sentence covering all of them says nothing.
  const unknown = viewerPlan("data.parquet", 3, 30);
  const tooLong = viewerPlan("a.rs", 5000, 30);
  const tooBig = viewerPlan("a.rs", 1, HIGHLIGHT_BYTE_CEILING + 1);
  assert.equal(new Set([unknown.why, tooLong.why, tooBig.why]).size, 3);
  assert.match(unknown.why, /no syntax this pane knows/);
});
