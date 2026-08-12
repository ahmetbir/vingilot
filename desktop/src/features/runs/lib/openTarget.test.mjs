import assert from "node:assert/strict";
import { test } from "node:test";
import {
  deepestPlace,
  resolveOpen,
  unknownPlaceSentence,
  within,
} from "./openTarget.ts";

/** One project, its own checkout, and a worktree nested inside it — the layout
 * that makes "deepest wins" load-bearing rather than decorative. */
const PLACES = [
  { bindingId: null, path: "/w/repo", repoId: "r1" },
  { bindingId: "main:r1", path: "/w/repo", repoId: "r1" },
  { bindingId: "local:/w/repo/wt-x", path: "/w/repo/wt-x", repoId: "r1" },
  { bindingId: null, path: "/w/other", repoId: "r2" },
];

const file = (path, line = null) => ({ directory: false, line, path });
const dir = (path) => ({ directory: true, line: null, path });

test("a prefix is a directory boundary and never a string prefix", () => {
  assert.equal(within("/w/repo", "/w/repo"), true);
  assert.equal(within("/w/repo", "/w/repo/src/main.rs"), true);
  // The one that matters: landing a file in a checkout it has nothing to do
  // with is the same class of error `filesTarget.shouldLand` exists to prevent.
  assert.equal(within("/w/repo", "/w/repohaus/src/main.rs"), false);
  assert.equal(within("/w/repo", "/w/rep"), false);
  // Trailing slashes are the same place, either side.
  assert.equal(within("/w/repo/", "/w/repo"), true);
  assert.equal(within("/w/repo", "/w/repo/"), true);
  // The root contains everything, and is not a prefix that eats a separator.
  assert.equal(within("/", "/w/repo"), true);
});

test("the deepest place wins, and a worktree beats the project at the same path", () => {
  assert.equal(
    deepestPlace(PLACES, "/w/repo/wt-x/src/main.rs")?.bindingId,
    "local:/w/repo/wt-x",
  );
  // A tie at one path — a project and its own primary checkout — goes to the
  // one that names a worktree: it is the more specific true statement and it is
  // the one that puts a Files pane on screen.
  assert.equal(
    deepestPlace(PLACES, "/w/repo/src/main.rs")?.bindingId,
    "main:r1",
  );
  assert.equal(deepestPlace(PLACES, "/elsewhere/x"), null);
});

test("a file in a known worktree lands in the viewer at the line", () => {
  assert.deepEqual(resolveOpen(file("/w/repo/wt-x/src/main.rs", 412), PLACES), {
    bindingId: "local:/w/repo/wt-x",
    line: 412,
    path: "src/main.rs",
    repoId: "r1",
    type: "file",
    worktree: "/w/repo/wt-x",
  });
});

test("a file with no line is the top of the file, not line 1", () => {
  // `filesTarget.ts`'s distinction, kept across the bridge: null is "no
  // interesting line", and inventing one would put a highlight on a row he did
  // not ask about.
  assert.equal(resolveOpen(file("/w/repo/README.md"), PLACES).line, null);
});

test("a worktree directory lands on that worktree", () => {
  assert.deepEqual(resolveOpen(dir("/w/repo/wt-x"), PLACES), {
    bindingId: "local:/w/repo/wt-x",
    repoId: "r1",
    type: "worktree",
  });
});

test("a subdirectory of a checkout is still that checkout", () => {
  // Nobody stands at a repository root when they type this. Refusing here
  // would make the command work only from one directory per project.
  assert.deepEqual(resolveOpen(dir("/w/repo/wt-x/src/deep/er"), PLACES), {
    bindingId: "local:/w/repo/wt-x",
    repoId: "r1",
    type: "worktree",
  });
});

test("a project whose worktrees are not listed yet still lands on the project", () => {
  // The reason the project itself is a place: the app holds no worktree list
  // for a project that is not the selected one, and "I know this project" must
  // land somewhere better than the add-project dialog.
  assert.deepEqual(resolveOpen(dir("/w/other/nested"), PLACES), {
    repoId: "r2",
    type: "project",
  });
  // And a file inside it resolves against the project's own directory, with no
  // binding to select first.
  assert.deepEqual(resolveOpen(file("/w/other/a/b.ts", 3), PLACES), {
    bindingId: null,
    line: 3,
    path: "a/b.ts",
    repoId: "r2",
    type: "file",
    worktree: "/w/other",
  });
});

test("an unknown directory pre-fills add-project with the directory itself", () => {
  assert.deepEqual(resolveOpen(dir("/elsewhere/new-thing"), PLACES), {
    directory: "/elsewhere/new-thing",
    type: "unknown",
  });
});

test("an unknown file pre-fills with its parent, never with the file", () => {
  // Nothing adds a file as a project, and handing the dialog one would make
  // him delete the last path segment by hand every single time.
  assert.deepEqual(
    resolveOpen(file("/elsewhere/new-thing/src/x.rs", 9), PLACES),
    {
      directory: "/elsewhere/new-thing/src",
      type: "unknown",
    },
  );
  assert.match(
    unknownPlaceSentence("/elsewhere/new-thing/src"),
    /not inside a project/,
  );
});

test("no places at all is unknown rather than a crash", () => {
  // The first run of a fresh install: the shim is on PATH before any project
  // has been added, so this is a state the owner can actually reach.
  assert.deepEqual(resolveOpen(dir("/w/repo"), []), {
    directory: "/w/repo",
    type: "unknown",
  });
});

test("trailing slashes on a place do not change where a file lands", () => {
  const slashed = [{ bindingId: "b", path: "/w/repo/", repoId: "r1" }];
  assert.deepEqual(resolveOpen(file("/w/repo/src/main.rs", 1), slashed), {
    bindingId: "b",
    line: 1,
    path: "src/main.rs",
    repoId: "r1",
    type: "file",
    worktree: "/w/repo",
  });
});
