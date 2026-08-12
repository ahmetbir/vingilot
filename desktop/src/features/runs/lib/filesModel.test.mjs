import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

import {
  ancestors,
  enterOn,
  filesRefusal,
  flatten,
  humanCount,
  humanSize,
  joinPath,
  leftOf,
  parentPath,
  readFilesError,
  resolveFileTreeKey,
  rightOf,
  ROOT,
  selectablePaths,
  step,
  withExpanded,
} from "./filesModel.ts";

/** A directory that answered, in the shape the backend serialises. */
function listed(dir, entries, extra = {}) {
  return {
    listing: {
      dir,
      entries,
      limit: 2000,
      truncated: false,
      ...extra,
    },
    status: "listed",
  };
}

const dir = (name) => ({ kind: "directory", name, size: null });
const file = (name, size = 10) => ({ kind: "file", name, size });

/** The tree the row tests read: a root with one directory and one file, and
 * the directory's own two children already answered. */
const DIRS = {
  [ROOT]: listed(ROOT, [dir("src"), file("README.md", 100)]),
  src: listed("src", [dir("deep"), file("main.rs", 200)]),
  "src/deep": listed("src/deep", [file("inner.rs", 20)]),
};

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

test("a path is joined to its directory, and the root adds no separator", () => {
  assert.equal(joinPath(ROOT, "README.md"), "README.md");
  assert.equal(joinPath("src", "main.rs"), "src/main.rs");
});

test("a path knows its parent, and the root has none", () => {
  assert.equal(parentPath("src/deep/inner.rs"), "src/deep");
  assert.equal(parentPath("README.md"), ROOT);
  assert.equal(parentPath(ROOT), null);
});

test("the ancestors of a path are what has to be open for it to be seen", () => {
  // The door from outside lands on a file nobody has expanded to. This is the
  // list it opens.
  assert.deepEqual(ancestors("src/deep/inner.rs"), [ROOT, "src", "src/deep"]);
  assert.deepEqual(ancestors("README.md"), [ROOT]);
});

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

test("a closed tree draws only the root's own entries", () => {
  const rows = flatten(DIRS, {});
  assert.deepEqual(selectablePaths(rows), ["src", "README.md"]);
});

test("an expanded directory splices its rows in under it, at one more depth", () => {
  const rows = flatten(DIRS, { src: true });
  assert.deepEqual(selectablePaths(rows), [
    "src",
    "src/deep",
    "src/main.rs",
    "README.md",
  ]);
  const deep = rows.find((row) => row.path === "src/deep");
  assert.equal(deep.depth, 1);
  assert.equal(rows.find((row) => row.path === "src").depth, 0);
});

test("expanding two levels nests two levels", () => {
  const rows = flatten(DIRS, { src: true, "src/deep": true });
  assert.deepEqual(selectablePaths(rows), [
    "src",
    "src/deep",
    "src/deep/inner.rs",
    "src/main.rs",
    "README.md",
  ]);
  assert.equal(rows.find((row) => row.path === "src/deep/inner.rs").depth, 2);
});

test("a directory still being read draws a wait, not an empty directory", () => {
  // The house rule, in the one place a user can see it: an empty read is "no
  // answer", never "nothing there". Collapse these two into one branch and an
  // open directory looks empty for as long as git takes.
  const rows = flatten({ ...DIRS, src: { status: "loading" } }, { src: true });
  const note = rows.find((row) => row.row === "note");
  assert.equal(note.text, "reading…");
  // And it is not selectable — a wait is not somewhere the keyboard can land.
  assert.deepEqual(selectablePaths(rows), ["src", "README.md"]);
});

test("a directory that was refused draws the refusal in place", () => {
  const rows = flatten(
    {
      ...DIRS,
      src: {
        error: { kind: "not-a-repo", path: "/tmp/gone" },
        status: "refused",
      },
    },
    { src: true },
  );
  const note = rows.find((row) => row.row === "note");
  assert.match(note.text, /not a git repository/);
});

test("a truncated directory says so, with the backend's own number", () => {
  // A cap applied silently is a reader that lies about what is in the
  // repository. The number is the one the answer carried, not a second copy.
  const rows = flatten(
    { [ROOT]: listed(ROOT, [file("a.txt")], { limit: 2000, truncated: true }) },
    {},
  );
  const note = rows.find((row) => row.row === "note");
  assert.match(note.text, /more than 2000 entries/);
});

test("a directory nobody has asked about draws nothing rather than throwing", () => {
  // `expanded` and `dirs` are two records and can disagree for a frame — the
  // click that expands is not the answer that lists.
  const rows = flatten(DIRS, { "src/deep": true, unknown: true });
  assert.deepEqual(selectablePaths(rows), ["src", "README.md"]);
});

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

test("down and up walk the drawn rows", () => {
  const rows = flatten(DIRS, { src: true });
  assert.equal(step(rows, null, "next"), "src");
  assert.equal(step(rows, "src", "next"), "src/deep");
  assert.equal(step(rows, "src/deep", "previous"), "src");
});

test("the selection does not wrap at either end", () => {
  // The ends of a list are a useful thing to feel, and a jump from the last
  // row to the first moves him somewhere he did not ask to be.
  const rows = flatten(DIRS, {});
  assert.equal(step(rows, "README.md", "next"), "README.md");
  assert.equal(step(rows, "src", "previous"), "src");
});

test("home and end reach the ends, and a selection that is gone lands on the first row", () => {
  const rows = flatten(DIRS, { src: true });
  assert.equal(step(rows, "src/main.rs", "first"), "src");
  assert.equal(step(rows, "src", "last"), "README.md");
  // A tree with no selection has no keyboard; this is the case that produces
  // one without anybody choosing it.
  assert.equal(step(rows, "src/deep/inner.rs", "next"), "src");
});

test("right opens a shut directory and steps into an open one", () => {
  const shut = flatten(DIRS, {});
  assert.deepEqual(rightOf(shut, "src"), { act: "expand", path: "src" });
  const open = flatten(DIRS, { src: true });
  assert.deepEqual(rightOf(open, "src"), { act: "select", path: "src/deep" });
});

test("right on a file does nothing, and neither does right on a directory whose children are still being read", () => {
  const rows = flatten(DIRS, { src: true });
  assert.equal(rightOf(rows, "src/main.rs"), null);
  // Jumping past a loading directory to the next sibling would skip the very
  // rows he is waiting for.
  const waiting = flatten(
    { ...DIRS, src: { status: "loading" } },
    { src: true },
  );
  assert.equal(rightOf(waiting, "src"), null);
});

test("left shuts an open directory and otherwise goes up to the parent", () => {
  const open = flatten(DIRS, { src: true });
  assert.deepEqual(leftOf(open, "src"), { act: "collapse", path: "src" });
  assert.deepEqual(leftOf(open, "src/main.rs"), {
    act: "select",
    path: "src",
  });
});

test("left at the root has nowhere to go", () => {
  const rows = flatten(DIRS, {});
  assert.equal(leftOf(rows, "README.md"), null);
});

test("enter opens a file and toggles a directory", () => {
  const rows = flatten(DIRS, {});
  assert.deepEqual(enterOn(rows, "README.md"), {
    act: "open",
    path: "README.md",
  });
  assert.deepEqual(enterOn(rows, "src"), { act: "toggle", path: "src" });
  assert.equal(enterOn(rows, null), null);
});

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

const press = (key, extra = {}) => ({ key, primaryModifier: false, ...extra });

test("the five tree keys resolve, and nothing else does", () => {
  assert.deepEqual(resolveFileTreeKey(press("ArrowDown")), {
    to: "next",
    type: "step",
  });
  assert.deepEqual(resolveFileTreeKey(press("ArrowUp")), {
    to: "previous",
    type: "step",
  });
  assert.deepEqual(resolveFileTreeKey(press("Home")), {
    to: "first",
    type: "step",
  });
  assert.deepEqual(resolveFileTreeKey(press("End")), {
    to: "last",
    type: "step",
  });
  assert.deepEqual(resolveFileTreeKey(press("ArrowRight")), { type: "right" });
  assert.deepEqual(resolveFileTreeKey(press("ArrowLeft")), { type: "left" });
  assert.deepEqual(resolveFileTreeKey(press("Enter")), { type: "enter" });
  assert.equal(resolveFileTreeKey(press("j")), null);
  assert.equal(resolveFileTreeKey(press("Escape")), null);
});

test("a chord is not a tree move", () => {
  // Swallowing ⌘↑ or ⌥↑ would cost him a shortcut for standing in this pane,
  // which is the rule paneKeys.ts states for the divider.
  assert.equal(
    resolveFileTreeKey({ key: "ArrowDown", primaryModifier: true }),
    null,
  );
  assert.equal(resolveFileTreeKey(press("ArrowDown", { altKey: true })), null);
});

// ---------------------------------------------------------------------------
// Expansion record
// ---------------------------------------------------------------------------

test("the expansion record returns itself unchanged on a no-op", () => {
  // The same object, not a copy — so a caller mirroring this into React state
  // does not re-render on a click that changed nothing.
  const shutAlready = {};
  assert.equal(withExpanded(shutAlready, "src", false), shutAlready);
  const open = withExpanded(shutAlready, "src", true);
  assert.equal(withExpanded(open, "src", true), open);
  const shut = withExpanded(open, "src", false);
  assert.deepEqual(shut, {});
  assert.notEqual(shut, open);
});

// ---------------------------------------------------------------------------
// Refusals — each one its own sentence
// ---------------------------------------------------------------------------

test("too large carries the real size and the cap", () => {
  // "Too large" without a number is a sentence he can do nothing with: with
  // it, he knows whether to reach for `less` or for `head`.
  const words = filesRefusal({
    cap: 512 * 1024,
    kind: "too-large",
    path: "run.log",
    size: 191 * 1024 * 1024,
  });
  assert.match(words, /run\.log/);
  assert.match(words, /191 MiB/);
  assert.match(words, /512 KiB/);
});

test("binary, unreadable and outside-path are three different sentences", () => {
  const binary = filesRefusal({ kind: "binary", path: "a.png" });
  const unreadable = filesRefusal({
    detail: "Permission denied (os error 13)",
    kind: "unreadable",
    path: "b.txt",
  });
  const outside = filesRefusal({ kind: "outside-path", path: "escape" });
  // Distinct, and each one names its own thing — a single "could not show
  // this file" covering all three is what Task 3 forbids.
  assert.equal(new Set([binary, unreadable, outside]).size, 3);
  assert.match(binary, /looks binary/);
  assert.match(unreadable, /Permission denied/);
  assert.match(outside, /outside this worktree/);
});

test("every refusal kind has words", () => {
  // A kind added to the union without a sentence would render as `undefined`.
  const each = [
    { kind: "git-missing" },
    { kind: "not-a-repo", path: "/tmp/x" },
    { kind: "outside-path", path: "x" },
    { kind: "not-found", path: "x" },
    { cap: 1024, kind: "too-large", path: "x", size: 2048 },
    { kind: "binary", path: "x" },
    { detail: "d", kind: "unreadable", path: "x" },
    { command: "git ls-files", kind: "git-failed", stderr: "boom" },
  ];
  for (const error of each) {
    const words = filesRefusal(error);
    assert.equal(typeof words, "string");
    assert.ok(words.length > 10, `${error.kind} has no sentence`);
  }
});

test("a payload that is not one of ours is not read as a refusal", () => {
  // A shape this build cannot read must not be silently turned into a refusal
  // it never received.
  assert.equal(readFilesError({ kind: "something-else" }), null);
  assert.equal(readFilesError("boom"), null);
  assert.equal(readFilesError(null), null);
  assert.deepEqual(readFilesError({ kind: "binary", path: "a.png" }), {
    kind: "binary",
    path: "a.png",
  });
});

/** Run one expression in a fresh node whose *default* locale is `locale`, and
 * give back what it printed.
 *
 * **A child process because a default locale cannot be changed once node has
 * started.** ICU reads `LC_ALL`/`LANG` at startup and nothing after that moves
 * it, so a locale claim tested in-process is a claim about whichever machine
 * ran it — which is the whole defect these tests exist for. The same flags this
 * runner was started with, minus `--test`, so the child can import a `.ts`
 * module the same way. */
function underLocale(locale, expression) {
  const flags = process.execArgv.filter((flag) => !flag.startsWith("--test"));
  return execFileSync(
    process.execPath,
    [...flags, "--input-type=module", "--eval", expression],
    {
      encoding: "utf8",
      env: { ...process.env, LANG: locale, LC_ALL: locale },
      stdio: ["ignore", "pipe", "pipe"],
    },
  ).trim();
}

test("a count is separated the way the sentence around it is written", () => {
  // A real defect this test caught rather than a preference: the sentences in
  // this pane are English, and a bare `toLocaleString()` takes the machine's
  // locale — on the owner's Mac, which is Turkish, "1,204 lines" rendered as
  // "1.204 lines". A number formatted by one locale inside a sentence written
  // in another is a mismatch, not localisation.
  assert.equal(humanCount(1204), "1,204");
  assert.equal(humanCount(999), "999");
  assert.equal(humanCount(1_000_000), "1,000,000");
});

test("the separator is the sentence's even on a machine that disagrees", () => {
  // **The assertions above cannot catch the defect on a machine that is
  // already en-US**, which CI's runner is: there, dropping the "en-US" from
  // `toLocaleString` changes nothing and every equality still holds. The pin
  // was a property of the owner's Turkish laptop, which is the opposite of the
  // defect it was written for — that defect was itself a property of his
  // laptop. So the machine is moved instead of the expectation.
  const url = new URL("./filesModel.ts", import.meta.url).href;

  // The control, and it is not optional: if the child ignored the environment,
  // the real assertion below would pass for the wrong reason and this guard
  // would be the only thing that noticed.
  assert.equal(
    underLocale("de_DE.UTF-8", "process.stdout.write((1204).toLocaleString())"),
    "1.204",
    "the child really took the locale it was given",
  );

  assert.equal(
    underLocale(
      "de_DE.UTF-8",
      `import { humanCount } from ${JSON.stringify(url)};` +
        "process.stdout.write(humanCount(1204));",
    ),
    "1,204",
  );
});

test("sizes read as sizes, and no answer reads as nothing at all", () => {
  assert.equal(humanSize(0), "0 B");
  assert.equal(humanSize(512), "512 B");
  assert.equal(humanSize(2048), "2.0 KiB");
  assert.equal(humanSize(512 * 1024), "512 KiB");
  assert.equal(humanSize(5 * 1024 * 1024), "5.0 MiB");
  // `null` is a directory, or a file this app could not stat. Never "0 B".
  assert.equal(humanSize(null), "");
});
