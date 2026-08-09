import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assembleView,
  matchCandidate,
  matchField,
  moveCursor,
  rankMatches,
} from "./paletteModel.ts";

/** A candidate with everything the ranking reads and nothing it does not. */
function cand(
  id,
  label,
  { blocked = null, detail = "", kind = "action" } = {},
) {
  return {
    blocked,
    chord: null,
    command: { type: "add-project" },
    detail,
    id,
    kind,
    label,
  };
}

/** The ids a ranking produced, which is the only thing a caller can see. */
function ids(matches) {
  return matches.map((match) => match.candidate.id);
}

function matchesFor(candidates, query) {
  return candidates.flatMap((candidate) => {
    const match = matchCandidate(candidate, query);
    return match === null ? [] : [match];
  });
}

test("the five tiers rank in the order they are named", () => {
  const q = "ab";
  const exact = matchField("ab", q).score;
  const prefix = matchField("abzz", q).score;
  const word = matchField("zz ab", q).score;
  const substring = matchField("zzab", q).score;
  const subsequence = matchField("azzb", q).score;
  assert.ok(exact > prefix, "exact must beat prefix");
  assert.ok(prefix > word, "prefix must beat a word start");
  assert.ok(word > substring, "a word start must beat a bare substring");
  assert.ok(substring > subsequence, "a substring must beat a scattered match");
});

test("the length penalty is capped, so a long field's prefix still outranks a short field's word", () => {
  // A field long enough that an uncapped length penalty would be worth more
  // than the whole tier gap, against the best word match there is.
  const q = "ab";
  const worstPrefix = matchField(`ab${"z".repeat(4000)}`, q).score;
  const bestWord = matchField(" ab", q).score;
  assert.ok(
    worstPrefix > bestWord,
    `a prefix match scored ${worstPrefix}, a word match ${bestWord}`,
  );
});

test("the offset penalty is capped, so a late word start still outranks an early substring", () => {
  const q = "ab";
  const lateWord = matchField(`${"z".repeat(4000)} ab`, q).score;
  const earlySubstring = matchField("zab", q).score;
  assert.ok(
    lateWord > earlySubstring,
    `a word match scored ${lateWord}, a substring ${earlySubstring}`,
  );
});

test("the slack penalty is capped, so a sprawling subsequence still scores as one", () => {
  const q = "ab";
  const sprawling = matchField(`a${"z".repeat(4000)}b`, q).score;
  assert.ok(sprawling > 0, `a scattered match scored ${sprawling}`);
});

test("a shorter field wins among equals, and an earlier hit wins among equals", () => {
  const q = "ab";
  assert.ok(matchField("zzab", q).score > matchField("zzabzzzzzzzz", q).score);
  assert.ok(matchField("zzab", q).score > matchField("zzzzzzzzab", q).score);
});

test("the ranges are the characters that scored", () => {
  assert.deepEqual(matchField("worktree", "work").ranges, [
    { end: 4, start: 0 },
  ]);
  // A scattered match reports one range per run, not one per character.
  assert.deepEqual(matchField("new terminal tab", "ntt").ranges, [
    { end: 1, start: 0 },
    { end: 5, start: 4 },
    { end: 14, start: 13 },
  ]);
});

test("no match at all is null, which is what keeps a row out of the list", () => {
  assert.equal(matchField("worktree", "xyz"), null);
  assert.equal(matchCandidate(cand("a", "worktree"), "xyz"), null);
});

test("the detail line matches, and reports itself as the field", () => {
  const candidate = cand("a", "Deck", { detail: "/Users/me/vingilot" });
  const match = matchCandidate(candidate, "vingilot");
  assert.equal(match.field, "detail");
  assert.deepEqual(match.ranges, [{ end: 18, start: 10 }]);
});

test("what a row is called outranks what is written under it — but not by much", () => {
  // The discount's exact size, stated as the two orderings it produces.
  const byLabel = cand("a", "vingilot-workspace");
  const byDetail = cand("b", "zzz", { detail: "vingilot" });
  const weaklyByLabel = cand("c", "the vingilot thing");
  // A perfect hit on the detail loses to a prefix of the label…
  assert.deepEqual(
    ids(rankMatches(matchesFor([byDetail, byLabel], "vingilot"), [])),
    ["a", "b"],
  );
  // …and beats a hit buried inside it.
  assert.deepEqual(
    ids(rankMatches(matchesFor([weaklyByLabel, byDetail], "vingilot"), [])),
    ["b", "c"],
  );
});

test("the best answer is first whichever source produced it", () => {
  // The palette's whole promise. `projects` is produced before `actions`, and
  // a per-source ordering — or a stable sort over the concatenation — would
  // leave the project on top with the exact match under it.
  const fromProjects = cand("project:diffusion", "diffusion-lab", {
    kind: "project",
  });
  const fromPanes = cand("pane:diff", "Diff", { kind: "pane" });
  const ranked = rankMatches(matchesFor([fromProjects, fromPanes], "diff"), []);
  assert.deepEqual(ids(ranked), ["pane:diff", "project:diffusion"]);
});

test("an action that cannot run sinks below one that can, and stays in the list", () => {
  // The blocked row is the one that would win every tiebreak — same label,
  // lower id, produced first — so only the penalty can put it second. With the
  // labels the other way round this test would pass on the tiebreak alone and
  // say nothing about availability at all.
  const stopped = cand("action:a", "New worktree…", {
    blocked: "no project is open.",
  });
  const runnable = cand("action:b", "New worktree…");
  const ranked = rankMatches(matchesFor([stopped, runnable], "new"), []);
  assert.deepEqual(ids(ranked), ["action:b", "action:a"]);
});

test("a blocked row still wins on a query that names it", () => {
  // Ranked down is not hidden: typing the thing's name in full must still put
  // it where its own sentence can be read.
  const stopped = cand("action:prune", "Prune missing worktrees…", {
    blocked: "nothing to prune.",
  });
  const other = cand("action:other", "Add project…");
  const ranked = rankMatches(matchesFor([other, stopped], "prune"), []);
  assert.deepEqual(ids(ranked), ["action:prune"]);
});

test("recency reorders equals", () => {
  const first = cand("project:x", "deploy", { kind: "project" });
  const second = cand("project:y", "deploy", { kind: "project" });
  const both = [first, second];
  // Identical text, so the match alone cannot separate them: id breaks the tie.
  assert.deepEqual(ids(rankMatches(matchesFor(both, "dep"), [])), [
    "project:x",
    "project:y",
  ]);
  assert.deepEqual(ids(rankMatches(matchesFor(both, "dep"), ["project:y"])), [
    "project:y",
    "project:x",
  ]);
});

test("the recents keep their own order among themselves", () => {
  // Two identical matches, both recent. The list has to come back in the order
  // they were run, not in the order their labels happen to sort.
  const a = cand("a", "aul");
  const b = cand("b", "bul");
  const ranked = rankMatches(matchesFor([a, b], "ul"), ["b", "a"]);
  assert.deepEqual(ids(ranked), ["b", "a"]);
});

test("recency never promotes a worse match over a better one", () => {
  // "Runs pane" is a prefix match; "prune" holds `run` in the middle of a
  // word. No amount of having been run lately makes the second the answer to
  // someone who typed "run".
  const better = cand("pane:runs", "Runs pane", { kind: "pane" });
  const worse = cand("action:prune", "prune");
  const ranked = rankMatches(matchesFor([better, worse], "run"), [
    "action:prune",
  ]);
  assert.deepEqual(ids(ranked), ["pane:runs", "action:prune"]);
});

test("an empty query leads with the recents, in the order they were run", () => {
  const all = [
    cand("a", "Alpha"),
    cand("b", "Bravo"),
    cand("c", "Charlie"),
    cand("d", "Delta"),
  ];
  const view = assembleView(matchesFor(all, ""), "", [
    "c",
    "gone-with-a-project",
    "a",
  ]);
  assert.deepEqual(ids(view.rows), ["c", "a", "b", "d"]);
  assert.equal(view.recentCount, 2);
});

test("an empty query with no history is still the whole workspace, not an empty box", () => {
  const all = [cand("a", "Alpha"), cand("b", "Bravo")];
  const view = assembleView(matchesFor(all, ""), "", []);
  assert.deepEqual(ids(view.rows), ["a", "b"]);
  assert.equal(view.recentCount, 0);
});

test("a ranked list is never divided", () => {
  const all = [cand("a", "Alpha"), cand("b", "Alpha-two")];
  const view = assembleView(matchesFor(all, "alpha"), "alpha", ["b"]);
  assert.equal(view.recentCount, 0);
});

test("the cursor wraps at both ends and an empty list has none", () => {
  assert.equal(moveCursor(0, -1, 3), 2);
  assert.equal(moveCursor(2, 1, 3), 0);
  assert.equal(moveCursor(0, 1, 3), 1);
  assert.equal(moveCursor(0, 1, 0), 0);
  assert.equal(moveCursor(5, -1, 0), 0);
});
