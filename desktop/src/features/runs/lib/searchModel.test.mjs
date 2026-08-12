// The search result model
// (vingilot/docs/plans/2026-08-11-what-sent-him-to-vscode.md, Task 2).
//
// Four things are proved here and none of them needs a browser: how hits group
// into files, which part of a line is the match, what each refusal says, and —
// the one Task 2 puts hardest — that **"no matches" is only ever reachable from
// an answer git actually gave.**

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  cappedNote,
  emphasis,
  emphasiser,
  groupHits,
  hitFor,
  hitKey,
  IDLE_NOTE,
  NO_MATCHES,
  readSearchError,
  resolveSearchListKey,
  searchReading,
  searchRefusal,
  stepHit,
} from "./searchModel.ts";

function hit(over = {}) {
  return {
    clipped: false,
    column: 0,
    line: 1,
    path: "src/a.rs",
    text: "let needle = 1;",
    ...over,
  };
}

function answer(over = {}) {
  return {
    capped: false,
    hits: [],
    limit: 2000,
    pattern: "needle",
    regex: false,
    ...over,
  };
}

// ---------------------------------------------------------------- grouping

test("hits group by file, in the order git first mentioned each", () => {
  // Not sorted: `git grep` walks the index, which is sorted by path already,
  // and re-sorting here would be doing again in a second place something that
  // is already true — then differing from it the first time JavaScript's
  // collation disagreed with git's byte order.
  const groups = groupHits([
    hit({ line: 3, path: "z.rs" }),
    hit({ line: 9, path: "a.rs" }),
    hit({ line: 4, path: "z.rs" }),
  ]);
  assert.deepEqual(
    groups.map((group) => group.path),
    ["z.rs", "a.rs"],
  );
  assert.deepEqual(
    groups[0].hits.map((found) => found.line),
    [3, 4],
  );
  assert.equal(groups[1].hits.length, 1);
});

test("a file git mentions twice is one group, not two", () => {
  // `--untracked` prints the tracked files and then the untracked ones, so one
  // path can in principle appear in both halves. Two headings for one file is
  // a list that looks like it lost track of itself.
  const groups = groupHits([
    hit({ line: 1, path: "a.rs" }),
    hit({ line: 2, path: "b.rs" }),
    hit({ line: 3, path: "a.rs" }),
  ]);
  assert.equal(groups.length, 2);
  assert.deepEqual(
    groups[0].hits.map((found) => found.line),
    [1, 3],
  );
});

test("no hits is no groups", () => {
  assert.deepEqual(groupHits([]), []);
});

// ---------------------------------------------------------------- the cap

test("a capped answer says how many it stopped at, not what the limit is", () => {
  // The cap can also be reached by the backend's byte budget, where the count
  // returned is whatever fitted rather than exactly `limit`. "Capped at 2,000"
  // over a list of three rows would be a sentence the screen contradicts.
  const note = cappedNote(
    answer({ capped: true, hits: [hit(), hit({ line: 2 })] }),
  );
  assert.match(note ?? "", /stopped at 2 matches/);
  assert.match(note ?? "", /there are more/);
});

test("an answer that is not capped says nothing about a cap", () => {
  assert.equal(cappedNote(answer({ hits: [hit()] })), null);
});

test("the count is grouped the way the sentences around it are written", () => {
  // Pinned to en-US through `humanCount`, for the reason `filesModel.ts`
  // records: a bare `toLocaleString()` takes the machine's locale, and on the
  // owner's Turkish Mac "2,000 matches" rendered as "2.000 matches" inside an
  // English sentence.
  const many = Array.from({ length: 2000 }, (_unused, at) => hit({ line: at }));
  assert.match(cappedNote(answer({ capped: true, hits: many })) ?? "", /2,000/);
});

// ------------------------------------------------------------- the refusals

test("each refusal is its own sentence, naming the thing in the way", () => {
  assert.match(searchRefusal({ kind: "git-missing" }), /--version/);
  assert.match(
    searchRefusal({ kind: "not-a-repo", path: "/tmp/x" }),
    /\/tmp\/x is not a git repository/,
  );
  assert.match(searchRefusal({ kind: "empty-pattern" }), /every line/);
  assert.match(searchRefusal({ kind: "timed-out", seconds: 10 }), /10 seconds/);
});

test("git's own refusal is passed through verbatim", () => {
  // An unbalanced bracket is a thing git already says better than this file
  // could. A paraphrase would put this app's opinion of his mistake between
  // him and the mistake.
  const said = searchRefusal({
    command: "git grep --no-color -n",
    kind: "git-failed",
    stderr: "fatal: -e option, '[': brackets ([ ]) not balanced\n",
  });
  assert.match(said, /fatal: -e option, '\[': brackets \(\[ \]\) not balanced/);
  assert.match(said, /git grep --no-color -n/);
});

test("five refusals, five different sentences", () => {
  // A single "search failed" covering all of them would pass a test that only
  // asked whether something was said.
  const said = new Set([
    searchRefusal({ kind: "git-missing" }),
    searchRefusal({ kind: "not-a-repo", path: "/tmp/x" }),
    searchRefusal({ kind: "empty-pattern" }),
    searchRefusal({ kind: "timed-out", seconds: 10 }),
    searchRefusal({ command: "git grep", kind: "git-failed", stderr: "no" }),
  ]);
  assert.equal(said.size, 5);
});

test("a payload this build cannot read is not turned into a refusal it never got", () => {
  assert.equal(readSearchError(null), null);
  assert.equal(readSearchError("boom"), null);
  assert.equal(readSearchError({ kind: "something-else" }), null);
  assert.deepEqual(readSearchError({ kind: "git-missing" }), {
    kind: "git-missing",
  });
});

// -------------------------------------------------------------- the reading

test('"no matches" is only ever reachable from an answer', () => {
  // **Task 2's hardest rule, and the reason `searchReading` exists at all.** A
  // pane that rendered an empty list while the search was still running would
  // be saying there is nothing there on the strength of not having been told
  // yet. Four states, four different things on screen.
  assert.deepEqual(searchReading({ status: "idle" }), {
    note: IDLE_NOTE,
    show: "idle",
  });
  assert.notEqual(IDLE_NOTE, NO_MATCHES);

  const searching = searchReading({ pattern: "needle", status: "searching" });
  assert.equal(searching.show, "searching");
  assert.match(searching.note, /searching for needle/);
  assert.notEqual(searching.note, NO_MATCHES);

  const refused = searchReading({
    error: { kind: "timed-out", seconds: 10 },
    status: "refused",
  });
  assert.equal(refused.show, "refused");
  assert.notEqual(refused.note, NO_MATCHES);

  // Only here.
  assert.deepEqual(searchReading({ answer: answer(), status: "answered" }), {
    note: NO_MATCHES,
    show: "empty",
  });
});

test("an answer with hits reads as hits, with the cap sentence beside them", () => {
  const plain = searchReading({
    answer: answer({ hits: [hit()] }),
    status: "answered",
  });
  assert.equal(plain.show, "hits");
  assert.equal(plain.note, null);
  assert.equal(plain.groups.length, 1);
  assert.equal(plain.hits.length, 1);

  const capped = searchReading({
    answer: answer({ capped: true, hits: [hit()] }),
    status: "answered",
  });
  assert.equal(capped.show, "hits");
  assert.match(capped.note ?? "", /stopped at 1 matches/);
});

// -------------------------------------------------------------- the emphasis

test("a literal match is emphasised exactly where git said it is", () => {
  const parts = emphasis(
    hit({ column: 4, text: "let needle = 1;" }),
    "needle",
    false,
  );
  assert.deepEqual(parts, {
    after: " = 1;",
    before: "let ",
    match: "needle",
  });
});

test("the column is a character offset, so a line with an em dash still lines up", () => {
  // The backend converted git's byte column; this asserts the model reads it as
  // characters and does not re-derive anything. **This fixture separates bytes
  // from characters and nothing else** — an em dash is three bytes but a single
  // UTF-16 code unit, so it is the twin of the Rust side's
  // `the_column_counts_characters_and_not_bytes`. It cannot see the distinction
  // this file actually has to make, which is the one below.
  const parts = emphasis(
    hit({ column: 2, text: "— needle here" }),
    "needle",
    false,
  );
  assert.equal(parts.before, "— ");
  assert.equal(parts.match, "needle");
});

test("the column counts code points, so an astral character does not shift the match", () => {
  // **The distinction the em dash above cannot make.** This file never sees
  // bytes; what it can get wrong is code *units* against code *points*, and
  // only a character outside the BMP tells them apart — U+1F30D is one code
  // point and two UTF-16 units, so `hit.text.split("")` or a plain
  // `slice` here silently loses the bold on every line with an emoji in it.
  const parts = emphasis(
    hit({ column: 2, text: "🌍 needle here" }),
    "needle",
    false,
  );
  assert.equal(parts.before, "🌍 ");
  assert.equal(parts.match, "needle");
  assert.equal(parts.after, " here");
});

test("a literal whose text is not at the column is drawn plainly rather than wrongly", () => {
  // A clipped line, or any future disagreement about what a character is: an
  // emphasis over the wrong characters is worse than none, because it is a
  // claim about where the match is.
  const parts = emphasis(
    hit({ column: 9, text: "let needle = 1;" }),
    "needle",
    false,
  );
  assert.equal(parts.match, "");
  assert.equal(parts.before, "let needle = 1;");
  assert.equal(parts.after, "");
});

test("a regex match is measured by this engine, anchored at git's column", () => {
  const parts = emphasis(
    hit({ column: 4, text: "let needle42 = 1;" }),
    "needle[0-9]+",
    true,
  );
  assert.deepEqual(parts, {
    after: " = 1;",
    before: "let ",
    match: "needle42",
  });
});

test("a regex this engine will not compile costs the emphasis and not the result", () => {
  // **The whole design of `emphasis`.** git ran a POSIX ERE and this file has
  // an ECMAScript engine; they differ at the edges. A second engine that could
  // change *which lines are results* would be a second opinion about the
  // repository. One that can only decide how many characters are bold is a
  // rendering detail — so a pattern JS cannot read still leaves a row, with the
  // whole line in it.
  const parts = emphasis(hit({ column: 4 }), "[[:alpha:]]+", true);
  assert.equal(parts.match, "");
  assert.equal(parts.before, "let needle = 1;");
});

test("a regex that compiles but does not match at the column is not forced to", () => {
  // Sticky, not `^`-glued: rewriting the owner's pattern to anchor it would
  // change what it means for anything already anchored or alternated.
  const parts = emphasis(hit({ column: 4 }), "zzz", true);
  assert.equal(parts.match, "");
});

test("a regex that matches elsewhere in the line is not dragged to the column", () => {
  // **The anchor, and the case `zzz` above cannot make.** `zzz` matches nowhere
  // in that line at all, so a build that searched the whole line instead of
  // measuring at git's column would still find nothing and still look right.
  // Here the pattern matches thirteen characters further on — an engine that
  // searched rather than anchored would bold `42` and thereby claim the match
  // is somewhere git never said it was, which is the one thing this function's
  // doc comment forbids.
  const parts = emphasis(
    hit({ column: 0, text: "zz needle 42;" }),
    "[0-9]+",
    true,
  );
  assert.equal(parts.match, "");
  assert.equal(parts.before, "zz needle 42;");
  assert.equal(parts.after, "");
});

// ------------------------------------------------- the second engine's bounds

test("a regex is never run against more of a line than it can be bounded on", () => {
  // **The bound the whole two-engine design turns on.** git already answered;
  // this engine only measures how many characters to embolden, and it runs on
  // the thread that draws the workspace where nothing can interrupt it. So it
  // sees a window, and a match that reaches the edge of that window is dropped
  // rather than guessed at: on the rest of the line it could go further, and an
  // emphasis that claims an end nobody checked is the wrong-place emphasis this
  // file refuses everywhere else.
  const long = emphasis(hit({ column: 0, text: "a".repeat(400) }), "a+", true);
  assert.equal(long.match, "", "a match filling the window is not trusted");
  assert.equal(
    long.before,
    "a".repeat(400),
    "and the row keeps its whole line",
  );

  // A short match on a long line is still measured — the window bounds the
  // engine, it does not switch the feature off.
  const short = emphasis(
    hit({ column: 0, text: `needle${"z".repeat(400)}` }),
    "needle",
    true,
  );
  assert.equal(short.match, "needle");
});

test("the second engine's time budget is spent by the answer, and then it draws plain", () => {
  // A catastrophically-backtracking pattern cannot be put in a unit test — that
  // is the point of it — so the clock is injected and made to charge ten
  // milliseconds a match. Two fit in the twenty-millisecond budget; the third
  // and everything after it is drawn plain, which is the degradation this file
  // calls correct: the row is still a row, it just is not bold.
  let tick = 0;
  const clock = () => {
    tick += 10;
    return tick;
  };
  const measure = emphasiser("needle", true, clock);
  assert.equal(measure(hit({ column: 4 })).match, "needle");
  assert.equal(measure(hit({ column: 4 })).match, "needle");
  assert.equal(measure(hit({ column: 4 })).match, "", "the budget is spent");
  assert.equal(
    measure(hit({ column: 4 })).before,
    "let needle = 1;",
    "and a hit past the budget still carries its whole line",
  );
});

test("a literal search spends no budget, because no second engine runs", () => {
  // The budget belongs to the regex engine, not to emphasis in general. A
  // literal pattern IS the match, so measuring it is a `startsWith` — charging
  // it against a wall clock would take the bold off long lists for no reason.
  let tick = 0;
  const clock = () => {
    tick += 1000;
    return tick;
  };
  const measure = emphasiser("needle", false, clock);
  for (let at = 0; at < 5; at += 1) {
    assert.equal(measure(hit({ column: 4 })).match, "needle");
  }
});

test("a column outside the line emphasises nothing", () => {
  assert.equal(emphasis(hit({ column: 999 }), "needle", false).match, "");
  assert.equal(emphasis(hit({ column: -1 }), "needle", false).match, "");
  assert.equal(
    emphasis(hit({ column: 0, text: "" }), "needle", false).match,
    "",
  );
});

// ------------------------------------------------------------ the selection

test("a hit's key names one row and reads the line first", () => {
  // `<line>:<path>` rather than `<path>:<line>`, because a path may contain a
  // colon and the line may not. It is also the element id, which is what
  // `aria-activedescendant` needs.
  assert.equal(hitKey(hit({ line: 12, path: "a:b.rs" })), "12:a:b.rs");
});

test("the arrows walk the hits and stop at both ends", () => {
  const hits = [hit({ line: 1 }), hit({ line: 2 }), hit({ line: 3 })];
  const keys = hits.map(hitKey);
  assert.equal(stepHit(hits, null, "next"), keys[0]);
  assert.equal(stepHit(hits, keys[0], "next"), keys[1]);
  assert.equal(
    stepHit(hits, keys[2], "next"),
    keys[2],
    "the end does not wrap",
  );
  assert.equal(stepHit(hits, keys[0], "previous"), keys[0], "nor the start");
  assert.equal(stepHit(hits, keys[2], "first"), keys[0]);
  assert.equal(stepHit(hits, keys[0], "last"), keys[2]);
});

test("a selection whose hit is gone lands on the first row rather than on nothing", () => {
  // A new answer arrived under him. A list with no selection has no keyboard,
  // and this is the case that produces one without anybody choosing it.
  const hits = [hit({ line: 7 })];
  assert.equal(stepHit(hits, "999:elsewhere.rs", "next"), hitKey(hits[0]));
  assert.equal(stepHit([], "anything", "next"), null);
});

test("the selected hit is found by its key, and a stale key finds nothing", () => {
  const hits = [hit({ line: 4 }), hit({ line: 5 })];
  assert.equal(hitFor(hits, hitKey(hits[1]))?.line, 5);
  assert.equal(hitFor(hits, null), null);
  assert.equal(hitFor(hits, "9:nope.rs"), null);
});

// ---------------------------------------------------------------- the keys

function listKey(over = {}) {
  return resolveSearchListKey({
    inField: false,
    key: "ArrowDown",
    primaryModifier: false,
    ...over,
  });
}

test("the arrows and Enter are the list's, in the field and out of it", () => {
  assert.deepEqual(listKey(), { to: "next", type: "step" });
  assert.deepEqual(listKey({ key: "ArrowUp" }), {
    to: "previous",
    type: "step",
  });
  assert.deepEqual(listKey({ key: "Enter" }), { type: "open" });
  // The point of claiming them in the field: type a query, walk into the
  // results with ↓, open one with ↵, without ever reaching for Tab.
  assert.deepEqual(listKey({ inField: true }), { to: "next", type: "step" });
  assert.deepEqual(listKey({ inField: true, key: "Enter" }), { type: "open" });
});

test("Home and End stay the field's while the caret is in it", () => {
  // They are not dead keys in a text field — they move the caret to the ends of
  // what he has typed, the way every field on this machine behaves. Taking them
  // to jump a result list would be this pane deciding his editing keys mean
  // something else.
  assert.equal(listKey({ inField: true, key: "Home" }), null);
  assert.equal(listKey({ inField: true, key: "End" }), null);
  assert.deepEqual(listKey({ key: "Home" }), { to: "first", type: "step" });
  assert.deepEqual(listKey({ key: "End" }), { to: "last", type: "step" });
});

test("a chord falls through, so ⇧⌘F still reaches the window", () => {
  assert.equal(listKey({ primaryModifier: true }), null);
  assert.equal(listKey({ altKey: true }), null);
  assert.equal(listKey({ key: "a" }), null);
});
