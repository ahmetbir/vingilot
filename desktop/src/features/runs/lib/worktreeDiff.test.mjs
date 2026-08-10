import assert from "node:assert/strict";
import { test } from "node:test";
import { localBindingId } from "./projects.ts";
import {
  changeMark,
  defaultDiffBase,
  diffSummary,
  fileLabel,
  fileNote,
  labelParts,
  readWorktreeDiff,
} from "./worktreeDiff.ts";

const limits = {
  maxFiles: 400,
  maxPatchBytes: 262144,
  maxPatchLines: 2000,
  maxUntracked: 100,
};

function file(overrides = {}) {
  return {
    additions: 2,
    binary: false,
    change: "modified",
    deletions: 1,
    oldPath: null,
    patch: "@@ -1 +1 @@\n-a\n+b\n",
    path: "src/a.ts",
    truncated: false,
    ...overrides,
  };
}

function answer(overrides = {}) {
  return {
    additions: 2,
    base: "HEAD",
    deletions: 1,
    files: [file()],
    limits,
    omittedFiles: 0,
    omittedUntracked: 0,
    ...overrides,
  };
}

function worktree(overrides = {}) {
  return {
    added: null,
    base_commit: "abc1234",
    binding_id: "b1",
    branch: "run/aaa",
    commit_sha: null,
    lifecycle: "ready",
    owner_run_id: "r1",
    owner_run_objective: null,
    owner_run_status: "running",
    removed: null,
    repo_id: "buzz",
    role: "task",
    ...overrides,
  };
}

// ---------------------------------------------------------------------
// reading the answer
// ---------------------------------------------------------------------

test("a well-formed answer round-trips", () => {
  const diff = readWorktreeDiff(answer());
  assert.equal(diff.files.length, 1);
  assert.equal(diff.files[0].path, "src/a.ts");
  assert.equal(diff.limits.maxPatchLines, 2000);
});

test("one unreadable file record does not cost the others", () => {
  const diff = readWorktreeDiff(
    answer({ files: [file(), { path: 7 }, null, file({ path: "b.ts" })] }),
  );
  assert.deepEqual(
    diff.files.map((f) => f.path),
    ["src/a.ts", "b.ts"],
  );
});

test("a change this build does not know is 'other', never invented", () => {
  const diff = readWorktreeDiff(
    answer({ files: [file({ change: "quantum-entangled" })] }),
  );
  assert.equal(diff.files[0].change, "other");
  assert.equal(changeMark("other"), "?");
});

test("a shape that is not a diff at all reads as null, not as an empty diff", () => {
  // The distinction the whole panel rests on: "no changes" must never be
  // said on the strength of a payload nobody could parse.
  assert.equal(readWorktreeDiff(null), null);
  assert.equal(readWorktreeDiff("no"), null);
  assert.deepEqual(readWorktreeDiff({}).files, []);
});

test("missing counts read as zero rather than NaN on screen", () => {
  const diff = readWorktreeDiff({ base: "HEAD", files: [{ path: "a" }] });
  assert.equal(diff.additions, 0);
  assert.equal(diff.files[0].additions, 0);
  assert.equal(diff.files[0].binary, false);
});

// ---------------------------------------------------------------------
// what a worktree is read against
// ---------------------------------------------------------------------

test("a worktree the owner made is read against HEAD", () => {
  const wt = worktree({
    base_commit: "deadbee",
    binding_id: localBindingId("/w/fix"),
    owner_run_id: null,
    role: "local",
  });
  assert.equal(defaultDiffBase(wt), "HEAD");
});

test("a Run's worktree is read against the commit it branched from", () => {
  assert.equal(defaultDiffBase(worktree()), "abc1234");
});

test("a row with no recorded base still has a base to read against", () => {
  assert.equal(defaultDiffBase(worktree({ base_commit: "  " })), "HEAD");
});

// ---------------------------------------------------------------------
// the copy — every limit is stated, not just applied
// ---------------------------------------------------------------------

test("a binary file says why there is no patch, not 'no changes'", () => {
  const note = fileNote(file({ binary: true, patch: "" }), limits);
  assert.match(note, /binary file/);
  assert.match(note, /change is real/);
});

test("a cut patch states the limit that cut it", () => {
  const note = fileNote(file({ truncated: true }), limits);
  assert.match(note, /2000 lines/);
  assert.match(note, /256 KB/);
  assert.match(note, /Read it in full with git/);
});

test("an empty patch is explained rather than left blank", () => {
  assert.match(fileNote(file({ patch: "" }), limits), /no textual change/);
});

test("a file showing all of itself says nothing", () => {
  assert.equal(fileNote(file(), limits), null);
});

test("the summary says what the counts are of when files were left out", () => {
  const { headline, omission } = diffSummary(
    readWorktreeDiff(
      answer({
        additions: 9,
        deletions: 4,
        omittedFiles: 12,
        omittedUntracked: 3,
      }),
    ),
  );
  assert.match(headline, /1 file changed/);
  assert.match(headline, /\+9 −4 vs HEAD/);
  assert.match(
    omission,
    /12 more changed files not read \(this stops at 400\)/,
  );
  assert.match(
    omission,
    /3 more untracked files not read \(this stops at 100\)/,
  );
  assert.match(omission, /not of the worktree/);
});

test("nothing left out means no sentence about leaving things out", () => {
  assert.equal(diffSummary(readWorktreeDiff(answer())).omission, null);
});

test("a rename shows both names, so +0 −0 is accountable", () => {
  assert.equal(
    fileLabel(file({ oldPath: "old/name.txt", path: "new/name.txt" })),
    "old/name.txt → new/name.txt",
  );
  assert.equal(fileLabel(file()), "src/a.ts");
});

test("the name is what a row cannot afford to elide", () => {
  // The three fixture paths from the 16-inch measurement: identical for
  // twenty-three characters, which is all a 163px row of text-sm shows. What
  // tells them apart is entirely in `name`.
  const paths = [
    "desktop/src/features/runs/lib/paneModel.ts",
    "desktop/src/features/runs/ui/WorktreeDiffPanel.tsx",
    "desktop/src/features/runs/lib/diffLayout.ts",
  ];
  const names = paths.map((path) => labelParts(path).name);
  assert.deepEqual(names, [
    "paneModel.ts",
    "WorktreeDiffPanel.tsx",
    "diffLayout.ts",
  ]);
  assert.equal(new Set(names).size, 3);
  assert.equal(
    labelParts(paths[0]).lead,
    "desktop/src/features/runs/lib/",
    "the lead is everything the ellipsis may eat",
  );
  // Rejoining is the whole contract: the row shows the label, in two boxes.
  for (const path of paths) {
    const { lead, name } = labelParts(path);
    assert.equal(lead + name, path);
  }
});

test("a rename keeps the name it has now, and a bare name keeps itself", () => {
  assert.deepEqual(labelParts("old/name.txt → new/place/renamed.txt"), {
    lead: "old/name.txt → new/place/",
    name: "renamed.txt",
  });
  assert.deepEqual(labelParts("README.md"), { lead: "", name: "README.md" });
  assert.deepEqual(labelParts(""), { lead: "", name: "" });
  // Nothing to protect: a label that ends in a slash is left whole rather than
  // split into a lead and an empty name that renders as nothing at all.
  assert.deepEqual(labelParts("src/"), { lead: "", name: "src/" });
});
