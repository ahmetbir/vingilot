import assert from "node:assert/strict";
import { test } from "node:test";

import {
  branchFromTitle,
  BRIEF_FILE,
  briefText,
  MAX_BRANCH_CHARS,
  planBlocked,
  planOffer,
  planTitle,
} from "./planBrief.ts";

test("the title is the plan's first heading", () => {
  assert.equal(
    planTitle("# Turn a plan into a worktree\n\nWhat the work is.\n"),
    "Turn a plan into a worktree",
  );
  // A plan that starts straight into prose still has a first line.
  assert.equal(
    planTitle("Rebase before the demo\nthen ship\n"),
    "Rebase before the demo",
  );
  // Blank lines and a closed ATX heading.
  assert.equal(planTitle("\n\n### The palette ###\n"), "The palette");
});

test("a rule is not a title, so the search goes past it", () => {
  // Offering a branch named after a horizontal rule is the failure this
  // guards: `###` strips to nothing, and nothing is not a name.
  assert.equal(planTitle("###\n\n# The real title\n"), "The real title");
});

test("a plan with no words in it has no title", () => {
  assert.equal(planTitle(""), null);
  assert.equal(planTitle("\n   \n\t\n"), null);
  assert.equal(planTitle("##\n#\n"), null);
});

test("the branch offered is the title, lowercased and joined by hyphens", () => {
  assert.equal(
    branchFromTitle("Turn a plan into a worktree"),
    "turn-a-plan-into-a-worktree",
  );
  assert.equal(branchFromTitle("Fix: the 80th column!"), "fix-the-80th-column");
  assert.equal(
    branchFromTitle("  --leading and trailing--  "),
    "leading-and-trailing",
  );
});

test("a Turkish title keeps its own letters", () => {
  // The owner writes in Turkish and git ref names are UTF-8. Reducing these
  // to `dok-manlar` would be this app deciding his language is a problem.
  assert.equal(
    branchFromTitle("Plan sekmesi ve dokümanlar"),
    "plan-sekmesi-ve-dokümanlar",
  );
  assert.equal(
    branchFromTitle("Çalışan şeyleri bozma"),
    "çalışan-şeyleri-bozma",
  );
});

test("a title made only of punctuation offers nothing rather than a made-up name", () => {
  assert.equal(branchFromTitle("!!! ??? ..."), "");
  assert.equal(branchFromTitle("---"), "");
  assert.equal(planOffer("...\n").branch, "");
});

test("no dot reaches the offer, because a dot is what git's ref rules are about", () => {
  // `.lock` endings, leading dots and `..` are all git refusals; none of them
  // can be spelled once dots are gone.
  assert.equal(branchFromTitle("v1.2.3 .lock ..hidden"), "v1-2-3-lock-hidden");
  assert.ok(!branchFromTitle("release 2.0.lock").includes("."));
});

test("a long title is cut at a word, not mid-word", () => {
  const offered = branchFromTitle(
    "The palette and the two documents a project carries, and everything else besides",
  );
  assert.ok(offered.length <= MAX_BRANCH_CHARS, offered);
  assert.ok(!offered.endsWith("-"), offered);
  // Cut at a boundary: every piece of the offer is a whole word of the title.
  assert.equal(
    offered,
    "the-palette-and-the-two-documents-a-project-carries-and",
  );
});

test("a title with no word boundary to cut at is still cut to the cap", () => {
  const offered = branchFromTitle("x".repeat(MAX_BRANCH_CHARS + 20));
  assert.equal(offered.length, MAX_BRANCH_CHARS);
});

test("an empty plan is what blocks the action, and an unusable title is not", () => {
  const onEmpty = planBlocked(planOffer(""));
  assert.notEqual(onEmpty, null);
  // It names the file, because "empty" on its own does not tell the owner
  // what would have been written.
  assert.ok(onEmpty.includes(BRIEF_FILE), onEmpty);
  // Whitespace is empty.
  assert.equal(planBlocked(planOffer("   \n")), onEmpty);
  // A title that yields no branch name is a field the owner fills in, not a
  // refusal: the offer is empty and the action is still open.
  const punctuation = planOffer("...\n\nthe work is real\n");
  assert.equal(punctuation.branch, "");
  assert.equal(planBlocked(punctuation), null);
});

test("the plan is written verbatim, with a terminator and nothing else", () => {
  assert.equal(briefText("# Plan\n\nbody\n"), "# Plan\n\nbody\n");
  assert.equal(briefText("no trailing newline"), "no trailing newline\n");
  // Nothing is prepended: a brief the owner has to read past to find his own
  // first line is not his brief.
  assert.ok(briefText("# Plan\n").startsWith("# Plan"));
});
