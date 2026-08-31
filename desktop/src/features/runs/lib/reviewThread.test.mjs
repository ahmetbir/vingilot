import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyMessage,
  noteHeadline,
  notesByLine,
  patchAuthorInCrew,
  replyMessage,
  reviewNotes,
} from "./reviewThread.ts";

const AUTHORS = [
  { name: "Lookout", pubkey: "aa" },
  { name: "Mate", pubkey: "bb" },
];

const PATHS = [
  "desktop/src/features/runs/lib/diffTab.ts",
  "desktop/src/features/runs/ui/DiffTab.tsx",
  "README.md",
];

function message(pubkey, content, created_at = 1) {
  return { content, created_at, id: `${pubkey}:${created_at}`, pubkey };
}

test("a note is only drawn when the reviewer named a place in THIS diff", () => {
  const notes = reviewNotes({
    authors: AUTHORS,
    messages: [
      message("aa", "lib/diffTab.ts:88 — this ratio rounds a deletion away"),
      // No anchor at all: a message in the thread, and it stays there.
      message("aa", "the diff looks fine to me"),
      // A file this diff does not show.
      message("aa", "crates/buzz-relay/src/main.rs:12 — unrelated"),
      // A time, not a file.
      message("aa", "let us talk at 12:30"),
    ],
    paths: PATHS,
  });
  assert.equal(notes.length, 1);
  assert.equal(notes[0].path, "desktop/src/features/runs/lib/diffTab.ts");
  assert.equal(notes[0].line, 88);
});

test("nobody but the crew can leave a note inside the code", () => {
  const notes = reviewNotes({
    authors: AUTHORS,
    // The owner's own instruction, and a stranger's message: both name a real
    // file and a real line, and neither is a review.
    messages: [message("zz", "README.md:3 — please fix")],
    paths: PATHS,
  });
  assert.deepEqual(notes, []);
});

test("an ambiguous suffix is refused rather than landed on a guess", () => {
  const paths = ["a/mod.rs", "b/mod.rs"];
  const notes = reviewNotes({
    authors: AUTHORS,
    messages: [message("aa", "mod.rs:10 — this one")],
    paths,
  });
  // A note on the wrong `mod.rs` is worse than a note left in the thread.
  assert.deepEqual(notes, []);
});

test("with no crew and no paths there is nothing to place", () => {
  assert.deepEqual(
    reviewNotes({
      authors: [],
      messages: [message("aa", "README.md:1 — x")],
      paths: PATHS,
    }),
    [],
  );
  assert.deepEqual(
    reviewNotes({
      authors: AUTHORS,
      messages: [message("aa", "README.md:1 — x")],
      paths: [],
    }),
    [],
  );
});

test("notes are oldest first and grouped by the line they sit under", () => {
  const notes = reviewNotes({
    authors: AUTHORS,
    messages: [
      message("aa", "README.md:3 — second", 200),
      message("bb", "README.md:3 — first", 100),
      message("aa", "README.md:9 — elsewhere", 150),
    ],
    paths: PATHS,
  });
  assert.deepEqual(
    notes.map((note) => note.created_at),
    [100, 150, 200],
  );
  const byLine = notesByLine(notes, "README.md");
  assert.equal(byLine.get(3).length, 2);
  assert.equal(byLine.get(9).length, 1);
  assert.equal(byLine.get(4), undefined);
  // A file this diff shows but nobody wrote about has no entry at all.
  assert.equal(notesByLine(notes, PATHS[0]).size, 0);
});

test("the headline says what this build knows, and never a PR's review state", () => {
  const [note] = reviewNotes({
    authors: AUTHORS,
    messages: [message("aa", "README.md:42 — magic number")],
    paths: PATHS,
  });
  const headline = noteHeadline(note);
  assert.equal(headline, "left a note on line 42");
  // The owner's clarification: the two vocabularies must not merge.
  assert.equal(
    /requested changes|approved|pull request/i.test(headline),
    false,
  );
});

test("a reply is addressed the way the harness already addresses the crew", () => {
  const [note] = reviewNotes({
    authors: AUTHORS,
    messages: [message("aa", "README.md:42 — magic number")],
    paths: PATHS,
  });
  assert.equal(
    replyMessage(note, "  pulled it into a constant  ", "thread"),
    "@Lookout re README.md:42 — pulled it into a constant",
  );
  // A DM has one other party; naming them is noise — `crewReach.ts`'s rule.
  assert.equal(replyMessage(note, "done", "dm"), "re README.md:42 — done");
  assert.equal(
    applyMessage(note, "Bosun"),
    "@Bosun apply Lookout's note on README.md:42",
  );
});

test("Apply is only offered when the patch's author is crew this workspace has", () => {
  assert.equal(patchAuthorInCrew("Bosun", AUTHORS), null);
  assert.equal(patchAuthorInCrew(null, AUTHORS), null);
  assert.equal(patchAuthorInCrew("   ", AUTHORS), null);
  assert.equal(patchAuthorInCrew("lookout", AUTHORS)?.name, "Lookout");
});
