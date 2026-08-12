// What the viewer does with a file it has: which language to ask Shiki for, and
// whether to ask it at all
// (vingilot/docs/plans/2026-08-12-files-pane-design.md, §4).
//
// **Shiki is already shipped and is reused, not replaced.**
// `shared/ui/markdown/CodeBlock.tsx` exports `SyntaxHighlightedCode`, with a
// singleton highlighter, a lazy per-language grammar load, a per-theme load and
// a token cache. The Files pane renders that component. It adds no highlighter,
// no grammar bundle and no theme.
//
// **What that costs on a large file, which is the part Task 3 asks to be said
// out loud.** Three things, all of them upstream's and all of them real:
//
//   1. `MAX_HIGHLIGHT_LINES = 150`. Past 150 newlines `SyntaxHighlightedCode`
//      returns plain `<span>` lines — *silently*. In a markdown code block that
//      is invisible and fine. In a file viewer it is a lie: a 400-line file
//      would render unhighlighted with nothing on screen saying why, and the
//      only available conclusion is that the highlighting is broken.
//   2. `codeToTokens` is synchronous and runs on the main thread inside a
//      `useMemo`. Shiki is a TextMate grammar engine — roughly 1–3 ms per 100
//      lines for a common grammar — so a 2,000-line file is tens of
//      milliseconds of blocked main thread, felt as a hitch in the terminal
//      beside the pane. The terminal staying responsive is the product.
//   3. The first file of a new language costs a dynamic `import()` of a grammar
//      (tens to a few hundred KB), and after `MAX_LOADED_LANGUAGES = 30` new
//      languages are silently not loaded at all.
//
// So the decision, and it is the honest half of the trade Task 3 permits: **a
// file over the ceiling renders as plain text and the pane says so, in words,
// with the numbers in them.** The fallback is upstream's either way; what is
// added here is that he can read it. A fallback he cannot see is a bug report.
//
// **The 150 is mirrored, not imported, and that is a known coupling.**
// `CodeBlock.tsx` does not export the constant, and adding an export there is
// an upstream touch for a number. If the mirror drifts, this file over- or
// under-reports the ceiling by a few lines and the file renders plain either
// way — it cannot drift into a freeze, because the component's own check is
// what actually decides. Named here so the next reader knows it is deliberate.

import { humanCount } from "@/features/runs/lib/filesModel";

/** Mirrors `MAX_HIGHLIGHT_LINES` in `shared/ui/markdown/CodeBlock.tsx`. See the
 * header: not imported because it is not exported, and the consequence of drift
 * is a wrong sentence rather than a wrong render. */
export const HIGHLIGHT_LINE_CEILING = 150;

/** The second ceiling, and this one is ours. A file can be 40 lines and 8 MB —
 * a minified bundle is one line per file — so a line ceiling alone bounds
 * nothing. 128 KiB is a quarter of the backend's 512 KiB read cap: past it the
 * tokenising is felt even when the line count says it should not be. */
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
 * line — upstream's `SyntaxHighlightedCode` emits a `<span data-line>` per line
 * and the plain fallback emits its own — so the marked line is found by index
 * either way, and the `line - 1` that turns his 1-based number into that index
 * was written out twice. Arithmetic that appears in two places is arithmetic
 * that is right in one of them.
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

/** How to render this file, with the sentence for the case where it is not
 * highlighted.
 *
 * The order of the checks is the order of the reasons he would want: an unknown
 * type first (nothing to highlight it *as*), then the two ceilings, each naming
 * its own number against the file's own. */
export function viewerPlan(
  path: string,
  lines: number,
  bytes: number,
): ViewerPlan {
  const language = languageOf(path);
  if (language === "plain") {
    return {
      language,
      render: "plain",
      why: "no syntax this pane knows for this kind of file — shown as plain text.",
    };
  }
  if (lines > HIGHLIGHT_LINE_CEILING) {
    return {
      language,
      render: "plain",
      why: `${humanCount(lines)} lines — shown as plain text, because syntax highlighting here is limited to ${HIGHLIGHT_LINE_CEILING} lines to keep the terminal responsive.`,
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
