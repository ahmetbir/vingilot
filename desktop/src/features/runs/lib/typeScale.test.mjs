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

function sizeHits(text) {
  const hits = [];
  for (const [index, line] of text.split("\n").entries()) {
    for (const match of line.matchAll(SIZE)) {
      hits.push({ line: index + 1, text: line, token: match[0] });
    }
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
        hit.text.includes("uppercase") &&
        hit.text.includes("tracking-[0.14em]");
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
  // xterm measures its cell box from this element's computed font. A Tailwind
  // size here would resize the grid and hand tmux a new column count for a
  // session the owner never touched — which is why the scale stops at this
  // container and not at the pane around it.
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
