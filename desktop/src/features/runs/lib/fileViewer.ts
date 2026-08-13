// What the viewer does with a file it has: which language to ask Shiki for, and
// whether to ask it at all
// (vingilot/docs/plans/2026-08-12-files-pane-design.md, §4;
// vingilot/docs/plans/2026-08-12-vscode-muscle-memory.md, Task 0).
//
// **Shiki is already shipped and is reused, not replaced.**
// `shared/ui/markdown/CodeBlock.tsx` owns the singleton highlighter, the
// grammar cache and the theme cache. What changed with Task 0 is *when* it is
// asked, not what: the viewer renders plain text immediately and tokenises in
// the background (`tokenizeChunked`, an async export of the same module), so
// nothing here waits on a tokeniser and the old 150-line chat-message ceiling
// is gone with the synchronous path that needed it.
//
// **One ceiling remains, and it is stated: the tokenise budget.** A file can be
// 40 lines and 8 MB — a minified bundle is one line per file — and TextMate
// grammars are superlinear on line length, so a byte bound is what actually
// bounds the work. 128 KiB is a quarter of the backend's 512 KiB read cap; past
// it the file renders as plain text and the pane says so, with the numbers.
// A fallback he cannot see is a bug report.

import { humanCount } from "@/features/runs/lib/filesModel";

/** The tokenise budget. The one ceiling the viewer still applies, and it is a
 * budget rather than a chat-message constant: the background tokenise slices
 * its work (`CodeBlock.tsx`'s `tokenizeChunked`, measurements there), but a
 * pathological line — a minified bundle — cannot be sliced below one line, so
 * the bound is bytes and it is said on screen when it is applied. */
export const HIGHLIGHT_BYTE_CEILING = 128 * 1024;

/** How the viewer will render this file, and why.
 *
 * `why` is `null` for the highlighted case on purpose: a reason is what is
 * shown when something is *not* happening, and a viewer that also narrated its
 * successes would be one more line of chrome in a 440px pane. */
export type ViewerPlan =
  | { render: "highlighted"; language: string; why: null }
  | { render: "plain"; language: string; why: string };

/** Extension → the Shiki language id.
 *
 * A table rather than a guess, because `loadLanguage` on an id Shiki does not
 * know throws and the component then falls back to plain text with no reason —
 * the exact silent failure this file exists to end. Every id here is a Shiki
 * bundled language.
 *
 * Deliberately short. It covers what is in this repository and what the owner
 * writes; an unknown extension is `plain`, which is a correct answer and not a
 * gap. Adding a row is how this grows. */
const BY_EXTENSION: Record<string, string> = {
  bash: "bash",
  c: "c",
  cjs: "javascript",
  cpp: "cpp",
  cs: "csharp",
  css: "css",
  dart: "dart",
  go: "go",
  h: "c",
  hpp: "cpp",
  html: "html",
  java: "java",
  js: "javascript",
  json: "json",
  jsonc: "jsonc",
  jsx: "jsx",
  kt: "kotlin",
  lua: "lua",
  md: "markdown",
  mdx: "mdx",
  mjs: "javascript",
  mts: "typescript",
  php: "php",
  py: "python",
  rb: "ruby",
  rs: "rust",
  scss: "scss",
  sh: "shellscript",
  sql: "sql",
  svelte: "svelte",
  swift: "swift",
  toml: "toml",
  ts: "typescript",
  tsx: "tsx",
  vue: "vue",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  zsh: "shellscript",
};

/** Files whose whole name is the type. A `Dockerfile` has no extension and is
 * not plain text; neither is a `Justfile`. */
const BY_NAME: Record<string, string> = {
  ".gitignore": "ini",
  ".gitmodules": "ini",
  Dockerfile: "docker",
  Justfile: "make",
  Makefile: "make",
  justfile: "make",
  makefile: "make",
};

/** `"plain"` for anything this table does not name — which is an answer, not a
 * failure. */
export function languageOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const named = BY_NAME[name];
  if (named !== undefined) return named;
  const dot = name.lastIndexOf(".");
  // A leading dot is a dotfile's dot, not an extension's: `.gitignore` is
  // matched by name above, and `.env` has no extension to look up.
  if (dot <= 0) return "plain";
  return BY_EXTENSION[name.slice(dot + 1).toLowerCase()] ?? "plain";
}

/** Which rendered line a target's `line` is, counted from zero.
 *
 * **One function because there are two renderers.** Both draw one element per
 * line — the tokenised body and the plain one each emit a `<span data-line>`
 * per line — so the marked line is found by index either way, and the
 * `line - 1` that turns his 1-based number into that index was written out
 * twice. Arithmetic that appears in two places is arithmetic that is right in
 * one of them.
 *
 * `null` is "no line was asked for", which is what a file opened from the tree
 * has: marking line 1 there would put a highlight on a row he did not ask
 * about. A `line` below 1, or one that is not a whole number, is a caller that
 * cannot mean it — lines are counted from 1 — and is `null` rather than a
 * negative index that would silently mark the last element. */
export function markedLineIndex(line: number | null): number | null {
  if (line === null || !Number.isInteger(line) || line < 1) return null;
  return line - 1;
}

/** Whether this file may be read as rendered prose rather than as its source.
 *
 * The one gate the Source⇄Preview toggle applies, and it is the language rather
 * than the render decision on purpose: a markdown file over the tokenise budget
 * falls to `render: "plain"` (`viewerPlan` above), but it is still markdown and
 * the reader may still want it as prose — the byte ceiling bounds Shiki's
 * superlinear tokeniser, not react-markdown, which is the app's chat pipeline
 * and parses the same text every message already does. So the toggle is offered
 * whenever the language is markdown, highlighted or not, and is absent for every
 * other kind of file — a `.rs` has no prose form and a control that did nothing
 * would be a door onto the same room.
 *
 * `languageOf` maps both `.md` and `.mdx` to markdown grammars; only `.md` is
 * offered a preview, because the chat pipeline renders CommonMark+GFM and an
 * `.mdx` file's JSX component syntax is not that — rendering it as markdown would
 * silently drop the half of the file that is the point of the extension. */
export function previewableAsMarkdown(path: string): boolean {
  return languageOf(path) === "markdown" && path.toLowerCase().endsWith(".md");
}

/** How to render this file, with the sentence for the case where it is not
 * highlighted.
 *
 * The order of the checks is the order of the reasons he would want: an unknown
 * type first (nothing to highlight it *as*), then the budget, naming its own
 * number against the file's own. */
export function viewerPlan(path: string, bytes: number): ViewerPlan {
  const language = languageOf(path);
  if (language === "plain") {
    return {
      language,
      render: "plain",
      why: "no syntax this pane knows for this kind of file — shown as plain text.",
    };
  }
  if (bytes > HIGHLIGHT_BYTE_CEILING) {
    return {
      language,
      render: "plain",
      why: `${humanCount(Math.round(bytes / 1024))} KiB — shown as plain text, because syntax highlighting here is limited to ${HIGHLIGHT_BYTE_CEILING / 1024} KiB.`,
    };
  }
  return { language, render: "highlighted", why: null };
}
