// The retry policy, as a gate rather than as a paragraph
// (`lib/reachability.ts`, vingilot/docs/plans/2026-08-10-coordinator-optional.md
// Task 2).
//
// `controlPlanePollMs` decides how hard the workspace looks for a coordinator,
// and the whole value of "settles to 30s" is that NO poll is left hammering: a
// policy three of five polls obey is not a policy, it is a smaller number in a
// log. That is not something a unit test of the function can see — the function
// was right, the wiring was not, and two components kept 2s timers of their own
// while the banner said there was nothing to wait for.
//
// So this checks the wiring: in the runs UI, a coordinator poll takes its
// cadence from the host's `pollMs` prop. The two exceptions are named below
// with the reason they are exceptions, which is the only way an exception is
// distinguishable from an oversight.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const uiRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "ui",
);

/** Polls whose subject cannot exist on a machine with no control plane, so
 * they can never be the "absent" case the settled cadence is for: both are
 * readings of one run, and a run is something only a coordinator can have
 * produced. An outage keeps the fast cadence by policy, so a fixed 2s here is
 * the policy rather than an escape from it. */
const RUN_SCOPED = new Map([
  ["RunDetail.tsx", "polls one run and its evidence; opened from a run row"],
  ["EvidencePane.tsx", "polls the owner run's evidence, or nothing at all"],
]);

/** The interval expression of every `usePolling(fn, interval)` in `text`.
 * Walks parens rather than matching a regex to the closer: the fetcher
 * argument is routinely a call of its own. */
function pollIntervals(text) {
  const out = [];
  const CALL = /\busePolling\s*\(/g;
  for (const m of text.matchAll(CALL)) {
    let depth = 1;
    let commaAt = -1;
    let i = m.index + m[0].length;
    for (; i < text.length && depth > 0; i += 1) {
      const ch = text[i];
      if (ch === "(" || ch === "[" || ch === "{") depth += 1;
      else if (ch === ")" || ch === "]" || ch === "}") depth -= 1;
      else if (ch === "," && depth === 1 && commaAt === -1) commaAt = i;
    }
    // A one-argument call takes usePolling's own default, which is a 2s timer
    // nothing can steer — as much a hardcoded cadence as the literal is.
    out.push(commaAt === -1 ? "<default>" : text.slice(commaAt + 1, i - 1));
  }
  return out;
}

/** The interval expression with a trailing comma and comments stripped. */
function normalize(expr) {
  return expr
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/,\s*$/, "")
    .trim();
}

test("every coordinator poll in the runs UI takes the host's cadence", () => {
  const offenders = [];
  let checked = 0;
  for (const entry of readdirSync(uiRoot, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".tsx")) continue;
    if (RUN_SCOPED.has(entry.name)) continue;
    const text = readFileSync(path.join(uiRoot, entry.name), "utf8");
    for (const raw of pollIntervals(text)) {
      checked += 1;
      const expr = normalize(raw);
      if (expr !== "pollMs") offenders.push(`${entry.name}: ${expr}`);
    }
  }
  // An empty scan would pass this test while proving nothing — the polls it
  // guards are the reason it exists.
  assert.ok(checked >= 3, `expected coordinator polls to scan, saw ${checked}`);
  assert.deepEqual(offenders, []);
});

test("the run-scoped exemptions still exist and still poll", () => {
  for (const [name, reason] of RUN_SCOPED) {
    const text = readFileSync(path.join(uiRoot, name), "utf8");
    assert.ok(
      pollIntervals(text).length > 0,
      `${name} is exempt (${reason}) but no longer polls — drop the exemption`,
    );
  }
});
