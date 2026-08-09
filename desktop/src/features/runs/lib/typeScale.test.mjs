// The workspace's type scale, as a gate rather than as a paragraph
// (vingilot/docs/workbench.md, "The type scale").
//
// The scale was written down after the owner read the workspace and found
// "some tiny, some huge": the rules that already existed gated *literals*
// (`pnpm check:px-text`), and every size in here was a legal token — the
// disagreement was which token, on surfaces written days apart. A document
// alone re-loses that argument the next time a pane is added, so the two
// invariants that can be checked from the source are checked here.
//
// What this cannot check is whether a given line took the right role; that is
// what the table in workbench.md is for. What it can check is that the scale
// has only the four sizes in it, and that the eyebrow's uppercase styling is
// not worn by anything at another size — which is exactly how the drift
// started.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const featureRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

/** Every source file under features/runs, with its repo-ish relative path. */
function sources(dir = featureRoot) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...sources(full));
    } else if (/\.(ts|tsx|css)$/.test(entry.name)) {
      out.push({
        path: path.relative(featureRoot, full),
        text: readFileSync(full, "utf8"),
      });
    }
  }
  return out;
}

/** Any Tailwind text-size utility, stock token or arbitrary literal. The
 * arbitrary form is already refused app-wide by `pnpm check:px-text`; it is
 * matched here so a literal that slipped in reads as a scale failure too. */
const SIZE = /\btext-(\[[^\]]*\]|3xs|2xs|xs|sm|base|lg|[2-9]?xl)\b/g;

const SCALE = new Set(["text-sm", "text-xs", "text-2xs", "text-3xs"]);

/** The offset just past the string or template literal opening at `open`.
 * Substitutions are not descended into: a `${…}` holding its own backtick is
 * not a thing this island writes, and skipping to the closing backtick can
 * only ever widen the span that follows, never cut one short. */
function endOfString(text, open) {
  const quote = text[open];
  for (let i = open + 1; i < text.length; i += 1) {
    if (text[i] === "\\") {
      i += 1;
      continue;
    }
    if (text[i] === quote) {
      return i + 1;
    }
  }
  return text.length;
}

/** The offset just past the JSX attribute value opening at `open` — a quoted
 * string, a template literal, or a braced expression. Strings inside a braced
 * expression are skipped whole, so a brace that is only ever a character in a
 * class name or a message cannot close it early. */
function endOfValue(text, open) {
  if (/["'`]/.test(text[open])) {
    return endOfString(text, open);
  }
  if (text[open] !== "{") {
    return -1;
  }
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i];
    if (/["'`]/.test(ch)) {
      i = endOfString(text, i) - 1;
      continue;
    }
    if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return i + 1;
      }
    }
  }
  return -1;
}

/** Every `className=…` value in a file, as [start, end) offsets. */
function classNameSpans(text) {
  const spans = [];
  for (const match of text.matchAll(/className\s*=\s*/g)) {
    const open = match.index + match[0].length;
    const end = endOfValue(text, open);
    if (end > open) {
      spans.push({ start: open, end });
    }
  }
  return spans;
}

/** Every text-size utility in a file, each carrying the whole class list it was
 * written in rather than the physical line it landed on. A Tailwind class list
 * wraps constantly here — a `cn()` split over arguments, a template literal, a
 * formatter breaking one long string — and a check that reads a single line
 * judges an element by a fragment of it: the size on one line and the styling
 * on the next reads as both a miss and a false alarm. Outside a className (a
 * stylesheet, a string constant) the line is the widest honest context there
 * is, so that is what the hit carries. */
function sizeHits(text) {
  const spans = classNameSpans(text);
  const lineStarts = [0];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === "\n") {
      lineStarts.push(i + 1);
    }
  }
  const hits = [];
  for (const match of text.matchAll(SIZE)) {
    const at = match.index;
    let line = lineStarts.length;
    while (lineStarts[line - 1] > at) {
      line -= 1;
    }
    const span = spans.find((it) => at >= it.start && at < it.end);
    hits.push({
      line,
      token: match[0],
      context: span
        ? text.slice(span.start, span.end)
        : text.slice(lineStarts[line - 1], lineStarts[line] ?? text.length),
    });
  }
  return hits;
}

test("the workspace has exactly four text sizes", () => {
  const strays = [];
  for (const file of sources()) {
    for (const hit of sizeHits(file.text)) {
      if (!SCALE.has(hit.token)) {
        strays.push(`${file.path}:${hit.line}: ${hit.token}`);
      }
    }
  }
  assert.deepEqual(
    strays,
    [],
    `off-scale text sizes — the workspace scale is ${[...SCALE].join(", ")}`,
  );
});

test("the eyebrow's styling belongs to the eyebrow alone", () => {
  // Both directions, because each one alone lets the drift back in: a heading
  // at another size reads as a heading and is not one, and an eyebrow-sized
  // label without the styling is a 8px line of body text.
  const wrong = [];
  for (const file of sources()) {
    for (const hit of sizeHits(file.text)) {
      const eyebrowStyle =
        hit.context.includes("uppercase") &&
        hit.context.includes("tracking-[0.14em]");
      if (hit.token === "text-3xs" && !eyebrowStyle) {
        wrong.push(
          `${file.path}:${hit.line}: text-3xs without the eyebrow styling`,
        );
      }
      if (eyebrowStyle && hit.token !== "text-3xs") {
        wrong.push(`${file.path}:${hit.line}: eyebrow styling at ${hit.token}`);
      }
    }
  }
  assert.deepEqual(wrong, []);
});

test("the terminal's own box carries no text size", () => {
  // The type inside is xterm's own and is never inherited: @xterm/xterm 5.5.0
  // defaults to `fontSize: 15` and writes it out explicitly wherever it counts
  // — onto the element it measures a cell from, and onto `.xterm-rows` through
  // a stylesheet it appends itself (lib/xterm.js; its css/xterm.css carries no
  // font rule at all). A size on this host would therefore change nothing
  // today. What this pins is the boundary, not a resize: app styling never
  // starts creeping onto the element xterm owns, so the day something inside
  // does read an inherited font is a day nobody has to find.
  const text = readFileSync(path.join(featureRoot, "ui/Terminal.tsx"), "utf8");
  const at = text.indexOf("ref={containerRef}");
  assert.notEqual(at, -1, "Terminal.tsx no longer has an xterm host element");
  const opens = text.lastIndexOf("<div", at);
  const host = text.slice(opens, at);
  assert.equal(
    new RegExp(SIZE.source).test(host),
    false,
    `the xterm host element carries a text size: ${host.trim()}`,
  );
});
