// The History pane's model
// (vingilot/docs/plans/2026-08-11-what-sent-him-to-vscode.md, Task 4).
//
// Everything here is pure and none of it needs a browser: how the wire is read
// when it is malformed, which sections git's four columns become, what the rows
// are and how the cursor walks them, how a page is appended without duplicating
// a commit, how a date is printed without a locale, which patch a status row
// gets — and, the rule this island puts hardest, that **"no commits yet" and
// "the working tree is clean" are only ever reachable from an answer git
// actually gave.**

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  appendPage,
  commitDate,
  commitPatchNote,
  commitRowKey,
  commitSubject,
  historyRows,
  logReading,
  missingPatchNote,
  olderNote,
  readCommit,
  readCommitPatch,
  readLogPage,
  readWorktreeStatus,
  rowFor,
  statusCount,
  statusHeadline,
  statusOmission,
  statusPatch,
  statusReading,
  statusSections,
  stepRow,
} from "./historyModel.ts";
import { readWorktreeDiff } from "./worktreeDiff.ts";

function commit(over = {}) {
  return {
    author: "Yusuf",
    date: "2026-08-12T02:18:33+03:00",
    hash: "a".repeat(40),
    refs: [],
    short: "aaaaaaa",
    subject: "Read what git already knows",
    ...over,
  };
}

function status(over = {}) {
  return {
    conflicted: [],
    limit: 1000,
    omitted: 0,
    staged: [],
    unstaged: [],
    untracked: [],
    ...over,
  };
}

function entry(over = {}) {
  return {
    change: "modified",
    code: "M.",
    oldPath: null,
    path: "src/a.rs",
    ...over,
  };
}

// ---------------------------------------------------------------------------
// reading the wire
// ---------------------------------------------------------------------------

test("a commit with no hash is dropped, because a row keyed by nothing cannot be opened", () => {
  assert.equal(readCommit({ subject: "orphan" }), null);
  assert.equal(readCommit(null), null);
  assert.equal(readCommit("a string"), null);
});

test("a commit missing its abbreviation gets one from its hash rather than a blank column", () => {
  const read = readCommit({ hash: "b".repeat(40) });
  assert.equal(read.short, "bbbbbbb");
  // And every other field is a value rather than undefined, so no row can
  // render `undefined` at the owner.
  assert.equal(read.author, "");
  assert.equal(read.subject, "");
  assert.deepEqual(read.refs, []);
});

test("one unreadable commit costs its own row and not the page", () => {
  const page = readLogPage({
    commits: [
      commit(),
      { subject: "no hash" },
      commit({ hash: "c".repeat(40) }),
    ],
    cursor: "c".repeat(40),
    limit: 200,
    more: true,
  });
  assert.equal(page.commits.length, 2);
  assert.equal(page.more, true);
  assert.equal(page.cursor, "c".repeat(40));
});

test("an empty cursor is no cursor — paging from `` would ask git about nothing", () => {
  assert.equal(
    readLogPage({ commits: [], cursor: "", limit: 200 }).cursor,
    null,
  );
  assert.equal(readLogPage({ commits: [] }).more, false);
});

test("a status entry with no path is dropped, and a change git has no letter for reads as other", () => {
  const read = readWorktreeStatus({
    limit: 1000,
    omitted: 3,
    staged: [entry(), { code: "A.", path: "" }],
    unstaged: [entry({ change: "sideways", path: "src/b.rs" })],
    untracked: "not an array",
  });
  assert.equal(read.staged.length, 1);
  assert.equal(read.unstaged[0].change, "other");
  assert.deepEqual(read.untracked, []);
  assert.equal(read.omitted, 3);
});

test("a commit patch is refused whole when either half is unreadable", () => {
  // The commit record is the existence check; a patch with no commit is an
  // answer about nothing.
  assert.equal(
    readCommitPatch({ diff: { files: [] } }, readWorktreeDiff),
    null,
  );
  assert.equal(readCommitPatch(null, readWorktreeDiff), null);
  const read = readCommitPatch(
    {
      commit: commit(),
      diff: { base: "HEAD~1", files: [] },
      merge: true,
      parent: "",
    },
    readWorktreeDiff,
  );
  // An empty parent string is no parent — the root case — rather than a commit
  // named by the empty string.
  assert.equal(read.parent, null);
  assert.equal(read.merge, true);
});

// ---------------------------------------------------------------------------
// git's four columns
// ---------------------------------------------------------------------------

test("empty sections are left out, and conflicted comes first because it blocks everything", () => {
  const sections = statusSections(
    status({
      conflicted: [entry({ path: "src/c.rs" })],
      staged: [entry()],
      untracked: [entry({ change: "untracked", path: "new.txt" })],
    }),
  );
  assert.deepEqual(
    sections.map((section) => section.id),
    ["conflicted", "staged", "untracked"],
  );
});

test("a file staged AND edited again appears in both sections, because that is what it is", () => {
  const both = status({
    staged: [entry({ code: "AM" })],
    unstaged: [entry({ code: "AM" })],
  });
  assert.equal(statusCount(both), 2);
  const rows = historyRows(statusSections(both), []);
  assert.equal(rows.length, 2);
  // Two rows, two different keys — folding them into one would hide precisely
  // the state the section exists to show.
  assert.notEqual(rows[0].key, rows[1].key);
});

test("the headline counts every column, and says clean only when every column is empty", () => {
  assert.equal(
    statusHeadline(
      status({ staged: [entry()], untracked: [entry({ path: "n" })] }),
    ),
    "1 staged, 1 untracked",
  );
  assert.equal(
    statusHeadline(status()),
    "nothing to commit — the working tree is clean.",
  );
});

test("the omission sentence quotes the cap that was applied, and says nothing when nothing was cut", () => {
  assert.equal(statusOmission(status()), null);
  const note = statusOmission(status({ limit: 1000, omitted: 12 }));
  assert.match(note, /12 more entries not listed/);
  assert.match(note, /stops at 1000/);
});

// ---------------------------------------------------------------------------
// rows and the cursor
// ---------------------------------------------------------------------------

test("status rows come before commits, so j walks from the last file into the newest commit", () => {
  const rows = historyRows(statusSections(status({ staged: [entry()] })), [
    commit(),
    commit({ hash: "d".repeat(40) }),
  ]);
  assert.deepEqual(
    rows.map((row) => row.kind),
    ["status", "commit", "commit"],
  );
});

test("the cursor clamps at both ends rather than wrapping", () => {
  const rows = historyRows([], [commit(), commit({ hash: "d".repeat(40) })]);
  const first = rows[0].key;
  const last = rows[1].key;
  // Held down at the bottom it stops there — a silent wrap is how the owner
  // ends up reading the wrong commit.
  assert.equal(stepRow(rows, last, 1), last);
  assert.equal(stepRow(rows, first, -1), first);
  assert.equal(stepRow(rows, first, 1), last);
  // Nothing selected: down lands on the first row, up on the last.
  assert.equal(stepRow(rows, null, 1), first);
  assert.equal(stepRow(rows, null, -1), last);
  assert.equal(stepRow([], null, 1), null);
});

test("a key naming no row resolves to nothing rather than to the first one", () => {
  const rows = historyRows([], [commit()]);
  assert.equal(rowFor(rows, "commit:nope"), null);
  assert.equal(rowFor(rows, null), null);
  assert.equal(rowFor(rows, commitRowKey("a".repeat(40))).kind, "commit");
});

// ---------------------------------------------------------------------------
// paging
// ---------------------------------------------------------------------------

test("a page appends without drawing a commit twice", () => {
  const shown = [commit(), commit({ hash: "d".repeat(40) })];
  const next = appendPage(shown, {
    // The cursor commit coming back is exactly the overlap this guards.
    commits: [
      commit({ hash: "d".repeat(40) }),
      commit({ hash: "e".repeat(40) }),
    ],
    cursor: "e".repeat(40),
    limit: 2,
    more: false,
  });
  assert.deepEqual(
    next.map((c) => c.hash[0]),
    ["a", "d", "e"],
  );
});

test("the older note counts what is on screen rather than repeating the cap", () => {
  assert.equal(olderNote(200, false), null);
  // **A count that is NOT the cap, and that is the whole test.** Asserted only
  // at 200 — which is `MAX_COMMITS` — a function that printed the constant and
  // ignored its argument passed, so the one drift this test is named for was the
  // one drift it could not see. A second page makes `shown` 400 and a partial
  // first page makes it less than 200; both must read as themselves.
  assert.equal(olderNote(37, true), "37 commits shown — there are older ones.");
  assert.equal(
    olderNote(400, true),
    "400 commits shown — there are older ones.",
  );
  assert.equal(
    olderNote(200, true),
    "200 commits shown — there are older ones.",
  );
});

// ---------------------------------------------------------------------------
// the rule: an empty read is "no answer", never "nothing there"
// ---------------------------------------------------------------------------

test('"no commits yet" is unreachable from anything but an answer', () => {
  assert.equal(logReading({ status: "idle" }, "").show, "reading");
  assert.equal(logReading({ status: "reading" }, "").show, "reading");
  assert.equal(
    logReading({ error: {}, status: "refused" }, "git said no").show,
    "refused",
  );
  // Only here.
  const empty = logReading(
    { commits: [], more: false, status: "answered" },
    "",
  );
  assert.equal(empty.show, "empty");
  assert.match(empty.note, /no commits yet/);
});

test('"the working tree is clean" is unreachable from anything but an answer', () => {
  assert.equal(statusReading({ status: "idle" }, "").show, "reading");
  assert.equal(statusReading({ status: "reading" }, "").show, "reading");
  assert.equal(
    statusReading({ error: {}, status: "refused" }, "git said no").note,
    "git said no",
  );
  const clean = statusReading({ answer: status(), status: "answered" }, "");
  assert.equal(clean.show, "empty");
  assert.match(clean.note, /working tree is clean/);
});

test("a refusal is git's own words, passed through rather than paraphrased", () => {
  const words = "fatal: not a git repository";
  assert.equal(logReading({ error: {}, status: "refused" }, words).note, words);
  assert.equal(
    statusReading({ error: {}, status: "refused" }, words).note,
    words,
  );
});

// ---------------------------------------------------------------------------
// commits, printed
// ---------------------------------------------------------------------------

test("a date is the author's own clock, not the reader's, and not a locale", () => {
  // The offset is deliberately not UTC: put through a Date this would re-zone
  // into whoever is reading, and "when did I write this" is a question about
  // the author's clock. Sliced, it is what git said.
  assert.equal(commitDate("2026-08-12T02:18:33+03:00"), "2026-08-12 02:18");
  assert.equal(commitDate("2026-08-11T23:18:33Z"), "2026-08-11 23:18");
  // A field this does not recognise is shown as itself rather than as an
  // invented plausible date.
  assert.equal(commitDate("not a date"), "not a date");
});

test("a commit git allowed to have no subject says so instead of rendering blank", () => {
  assert.equal(commitSubject(commit({ subject: "" })), "(no subject)");
  assert.equal(commitSubject(commit()), "Read what git already knows");
});

test("a merge says what its patch is, and the first commit says what it was read against", () => {
  const merge = commitPatchNote({
    commit: commit(),
    diff: {},
    merge: true,
    parent: "f".repeat(40),
  });
  assert.match(merge, /a merge/);
  assert.match(merge, /first parent/);
  assert.match(merge, /not the whole of what it joined/);

  const root = commitPatchNote({
    commit: commit(),
    diff: {},
    merge: false,
    parent: null,
  });
  assert.match(root, /first commit in this repository/);

  // An ordinary commit gets no sentence — a note under every commit is a note
  // nobody reads.
  assert.equal(
    commitPatchNote({
      commit: commit(),
      diff: {},
      merge: false,
      parent: "f".repeat(40),
    }),
    null,
  );
});

// ---------------------------------------------------------------------------
// a status row's patch
// ---------------------------------------------------------------------------

test("a status row finds its patch in the HEAD diff, by its new path or its old one", () => {
  const diff = readWorktreeDiff({
    base: "HEAD",
    files: [
      {
        additions: 2,
        deletions: 1,
        patch: "@@ -1 +1 @@\n-a\n+b\n",
        path: "src/a.rs",
      },
      { oldPath: "old.txt", patch: "@@\n", path: "new.txt" },
    ],
    limits: {
      maxFiles: 400,
      maxPatchBytes: 1024,
      maxPatchLines: 100,
      maxUntracked: 50,
    },
  });
  assert.equal(statusPatch(diff, entry()).patch, "@@ -1 +1 @@\n-a\n+b\n");
  // A rename is one file under two names, and status may name either side.
  assert.equal(statusPatch(diff, entry({ path: "old.txt" })).path, "new.txt");
});

test("a file status lists that the diff does not mention is said, not shown as an empty patch", () => {
  const diff = readWorktreeDiff({ base: "HEAD", files: [], limits: {} });
  assert.equal(statusPatch(diff, entry()), null);
  const note = missingPatchNote(entry({ code: "MM" }));
  // It names the file, git's own code, and why the two reads can disagree.
  assert.match(note, /src\/a\.rs/);
  assert.match(note, /MM/);
  assert.match(note, /two separate reads/);
});

test("an untracked DIRECTORY is told what it is, not blamed on a race that did not happen", () => {
  // **The one mismatch that is deterministic and permanent.** `worktree_status`
  // reads `--untracked-files=normal`, so a directory nothing in which is tracked
  // is ONE row ending in `/`; `worktree_diff` lists untracked *files*
  // (`ls-files --others`, no `--directory`), so `build/a.o` is in the diff and
  // `build/` never is. The raced-read sentence would tell him the tree moved
  // between two reads when nothing moved at all.
  const diff = readWorktreeDiff({
    base: "HEAD",
    files: [
      {
        change: "untracked",
        patch: "@@ -0,0 +1 @@\n+junk\n",
        path: "build/a.o",
      },
    ],
    limits: {
      maxFiles: 400,
      maxPatchBytes: 1024,
      maxPatchLines: 100,
      maxUntracked: 50,
    },
  });
  const directory = entry({ change: "untracked", code: "??", path: "build/" });
  assert.equal(statusPatch(diff, directory), null);

  const note = missingPatchNote(directory);
  assert.match(note, /build\//);
  assert.match(note, /is a directory, not a file/);
  // And it does not reach for the sentence about two reads disagreeing, which
  // is the wrong explanation here.
  assert.doesNotMatch(note, /two separate reads/);
  assert.doesNotMatch(note, /may have moved/);
});

test("a binary file carries its sentence INSTEAD of a patch; a truncated one carries both", () => {
  const limits = {
    maxFiles: 400,
    maxPatchBytes: 1024,
    maxPatchLines: 100,
    maxUntracked: 50,
  };
  const diff = readWorktreeDiff({
    base: "HEAD",
    files: [
      { binary: true, path: "logo.png" },
      {
        // A cut patch is a full prefix of what git read, not an empty one — the
        // distinction the pane's layout turns on.
        patch: "@@ -1,2 +1,2 @@\n-old\n+new\n",
        path: "pnpm-lock.yaml",
        truncated: true,
      },
    ],
    limits,
  });

  // Nothing to draw: git produces no line-by-line patch for a binary file, so
  // the sentence is all there is.
  const binary = statusPatch(diff, entry({ path: "logo.png" }));
  assert.match(binary.note, /binary file/);
  assert.equal(binary.patch, "");

  // **Both.** The sentence says the rest was cut; the patch is the part that was
  // read, and dropping it would throw away everything git did answer — the same
  // file in the Diff pane shows the warning AND the lines.
  const cut = statusPatch(diff, entry({ path: "pnpm-lock.yaml" }));
  assert.match(cut.note, /patch cut off/);
  assert.notEqual(cut.patch, "");
  assert.match(cut.patch, /\+new/);
});
