import assert from "node:assert/strict";
import { test } from "node:test";

import {
  HIGHLIGHT_BYTE_CEILING,
  languageOf,
  markedLineIndex,
  previewableAsMarkdown,
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

test("a known file under the budget is highlighted, and says nothing about it", () => {
  const plan = viewerPlan("src/main.rs", 900);
  assert.equal(plan.render, "highlighted");
  assert.equal(plan.language, "rust");
  // A reason is what is shown when something is NOT happening. A viewer that
  // narrated its successes would be one more line of chrome in a 440px pane.
  assert.equal(plan.why, null);
});

test("a long file is highlighted too — the chat-message line ceiling is gone", () => {
  // Task 0 (vingilot/docs/plans/2026-08-12-vscode-muscle-memory.md): the
  // 150-line ceiling was `CodeBlock.tsx`'s chat constant, and the viewer no
  // longer pays it — the tokenise runs in the background instead. A 5,000-line
  // file under the byte budget is a highlighted file.
  const plan = viewerPlan("src/main.rs", 100_000);
  assert.equal(plan.render, "highlighted");
  assert.equal(plan.why, null);
});

test("a minified bundle is caught by the byte budget, with both numbers said", () => {
  // One line, eight megabytes. TextMate grammars are superlinear on line
  // length and one line cannot be sliced, so the bound is bytes — and it is a
  // sentence on screen, not a silent fallback.
  const plan = viewerPlan("dist/bundle.js", HIGHLIGHT_BYTE_CEILING + 1);
  assert.equal(plan.render, "plain");
  assert.match(plan.why, /KiB/);
  assert.match(plan.why, new RegExp(String(HIGHLIGHT_BYTE_CEILING / 1024)));
});

test("the byte budget is inclusive", () => {
  assert.equal(
    viewerPlan("a.ts", HIGHLIGHT_BYTE_CEILING).render,
    "highlighted",
  );
  assert.equal(viewerPlan("a.ts", HIGHLIGHT_BYTE_CEILING + 1).render, "plain");
});

test("an unknown type says it is unknown rather than blaming the budget", () => {
  // Two reasons for plain text, and they are two different things he might do
  // next. A single sentence covering both would say nothing.
  const unknown = viewerPlan("data.parquet", 30);
  const tooBig = viewerPlan("a.rs", HIGHLIGHT_BYTE_CEILING + 1);
  assert.notEqual(unknown.why, tooBig.why);
  assert.match(unknown.why, /no syntax this pane knows/);
});

test("only a markdown file offers a prose preview", () => {
  // The Source⇄Preview toggle's one gate: language markdown AND a `.md`
  // extension. A `.rs` has no prose form, so the toggle is not offered.
  assert.equal(previewableAsMarkdown("docs/README.md"), true);
  assert.equal(previewableAsMarkdown("NOTES.MD"), true);
  assert.equal(previewableAsMarkdown("src/main.rs"), false);
  assert.equal(previewableAsMarkdown("a/b/c.json"), false);
  assert.equal(previewableAsMarkdown("plain.txt"), false);
});

test("mdx is markdown-highlighted but not markdown-previewable", () => {
  // `languageOf` maps `.mdx` to an mdx grammar, so it colours; but the chat
  // pipeline renders CommonMark+GFM, not MDX's JSX components — rendering an
  // `.mdx` as markdown would silently drop the half that is the point of it.
  assert.equal(languageOf("guide.mdx"), "mdx");
  assert.equal(previewableAsMarkdown("guide.mdx"), false);
});

test("a markdown file over the tokenise budget still previews", () => {
  // The byte ceiling bounds Shiki, not react-markdown: `viewerPlan` falls to
  // plain source for a huge `.md`, but the file is still previewable prose.
  assert.equal(
    viewerPlan("BIG.md", HIGHLIGHT_BYTE_CEILING + 1).render,
    "plain",
  );
  assert.equal(previewableAsMarkdown("BIG.md"), true);
});
