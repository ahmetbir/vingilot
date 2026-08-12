// ⌘P's two bounded decisions, without a filesystem
// (vingilot/docs/plans/2026-08-12-an-ide-of-a-kind.md, Task 2).

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DIR_BUDGET,
  DIR_CAP,
  frontier,
  joinPath,
  knownFiles,
  nextDirs,
} from "./worktreeFiles.ts";

const dir = (name) => ({ kind: "directory", name, size: null });
const file = (name) => ({ kind: "file", name, size: 1 });

function listed(pairs) {
  return new Map(pairs);
}

test("the root's children have no leading slash", () => {
  // It is the shape `file_read` takes; a leading slash would make every row an
  // absolute path the backend refuses.
  assert.equal(joinPath("", "main.rs"), "main.rs");
  assert.equal(joinPath("src", "main.rs"), "src/main.rs");
});

test("only files are rows, and parents come before children", () => {
  const known = knownFiles(
    listed([
      ["", [file("README.md"), dir("src")]],
      ["src", [file("main.rs"), dir("bin")]],
      ["src/bin", [file("cli.rs")]],
    ]),
  );
  // A directory row would be a row whose Enter did something the door does not
  // name.
  assert.deepEqual(known, ["README.md", "src/main.rs", "src/bin/cli.rs"]);
});

test("the frontier is every named directory nothing has answered for", () => {
  const waiting = frontier(
    listed([
      ["", [dir("src"), dir("tests"), file("README.md")]],
      ["src", [dir("bin")]],
    ]),
  );
  assert.deepEqual(waiting, ["tests", "src/bin"]);
});

test("an empty query deepens nothing", () => {
  // Opening the door costs exactly one call. A door that walked the repository
  // before drawing would be a door that is never open when he needs it.
  const held = listed([["", [dir("src"), dir("tests")]]]);
  assert.deepEqual(nextDirs(held, ""), []);
  assert.deepEqual(nextDirs(held, "ma"), ["src", "tests"]);
});

test("a pass opens at most DIR_BUDGET directories", () => {
  const many = Array.from({ length: DIR_BUDGET + 4 }, (_at, index) =>
    dir(`d${index}`),
  );
  const step = nextDirs(listed([["", many]]), "x");
  assert.equal(step.length, DIR_BUDGET);
});

test("past the cap the answer is what has been found, and the walk stops", () => {
  // The refusal that keeps an unignored node_modules from turning the palette
  // into a disk crawl. Asserted as "stops", not as "slows": the caller reads an
  // empty answer as done.
  const capped = new Map();
  for (let at = 0; at < DIR_CAP; at += 1)
    capped.set(`d${at}`, [dir(`d${at}/x`)]);
  assert.deepEqual(nextDirs(capped, "anything"), []);
});
