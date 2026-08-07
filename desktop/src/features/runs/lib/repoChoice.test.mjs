import assert from "node:assert/strict";
import { test } from "node:test";
import {
  chooseRepo,
  normalizeRepoPath,
  readRepoProbe,
  removeProjectConfirm,
  repoIdFor,
  repoNameFor,
} from "./repoChoice.ts";

const repository = { kind: "repository" };
const worktree = { kind: "worktree" };
const bare = { kind: "bare" };
const notARepo = (root = null) => ({ kind: "not-a-repo", root });

const repo = (id, path, name = id) => ({ id, name, path });

test("an ordinary checkout becomes a project", () => {
  const choice = chooseRepo("/Users/o/self-hosted/vingilot", repository, []);
  assert.equal(choice.ok, true);
  assert.deepEqual(choice.repo, {
    id: "vingilot",
    name: "vingilot",
    path: "/Users/o/self-hosted/vingilot",
  });
});

test("a linked worktree becomes a project too — it has a checkout in it", () => {
  const choice = chooseRepo("/Users/o/.vingilot/worktrees/run-1", worktree, []);
  assert.equal(choice.ok, true);
  assert.equal(choice.repo.path, "/Users/o/.vingilot/worktrees/run-1");
});

test("a bare repository is refused, and the refusal says why it cannot work", () => {
  const choice = chooseRepo("/Users/o/mirrors/buzz.git", bare, []);
  assert.equal(choice.ok, false);
  assert.match(choice.reason, /bare repository/);
  assert.match(choice.reason, /no working tree/);
  assert.match(choice.reason, /Pick a clone of it instead/);
});

test("a plain directory is refused with the missing .git named", () => {
  const choice = chooseRepo("/Users/o/Documents", notARepo(), []);
  assert.equal(choice.ok, false);
  assert.match(choice.reason, /^no \.git here/);
  assert.match(choice.reason, /\/Users\/o\/Documents/);
});

test("a subdirectory of a checkout is refused by naming the checkout to pick", () => {
  const choice = chooseRepo(
    "/Users/o/vingilot/desktop/src",
    notARepo("/Users/o/vingilot"),
    [],
  );
  assert.equal(choice.ok, false);
  assert.match(choice.reason, /^no \.git here/);
  assert.match(choice.reason, /Pick \/Users\/o\/vingilot itself/);
});

test("a duplicate path is refused rather than added a second time", () => {
  const existing = [repo("vingilot", "/Users/o/vingilot")];
  const choice = chooseRepo("/Users/o/vingilot", repository, existing);
  assert.equal(choice.ok, false);
  assert.match(choice.reason, /already a project/);
  assert.match(choice.reason, /vingilot/);
});

test("a trailing slash is the same path, so it is still a duplicate", () => {
  const existing = [repo("vingilot", "/Users/o/vingilot")];
  const choice = chooseRepo("/Users/o/vingilot/", repository, existing);
  assert.equal(choice.ok, false);
  assert.match(choice.reason, /already a project/);
});

test("a duplicate is refused before its git layout is even consulted", () => {
  // The path was validated when it was first added; "you already have this"
  // is the answer that helps, whatever the probe now says.
  const existing = [repo("mirror", "/Users/o/mirror")];
  const choice = chooseRepo("/Users/o/mirror", bare, existing);
  assert.equal(choice.ok, false);
  assert.match(choice.reason, /already a project/);
});

test("two checkouts of one project are two projects with distinct ids", () => {
  const existing = [repo("buzz", "/Users/o/work/buzz")];
  const choice = chooseRepo("/Users/o/review/buzz", repository, existing);
  assert.equal(choice.ok, true);
  assert.equal(choice.repo.id, "buzz-2");
  assert.equal(choice.repo.name, "buzz");
  assert.equal(choice.repo.path, "/Users/o/review/buzz");
});

test("id disambiguation keeps counting past an id that is already taken", () => {
  const existing = [
    repo("buzz", "/a/buzz"),
    repo("buzz-2", "/b/buzz"),
    repo("buzz-3", "/c/buzz"),
  ];
  const choice = chooseRepo("/d/buzz", repository, existing);
  assert.equal(choice.ok, true);
  assert.equal(choice.repo.id, "buzz-4");
});

test("an id is reduced to an alphabet everything downstream handles verbatim", () => {
  assert.equal(repoIdFor("/Users/o/My Project"), "my-project");
  assert.equal(repoIdFor("/Users/o/buzz.git"), "buzz-git");
  assert.equal(repoIdFor("/Users/o/__tmp__"), "tmp");
  assert.equal(repoIdFor("/Users/o/üñî"), "repo");
  assert.equal(repoIdFor("/"), "repo");
});

test("the display name keeps the directory's own name, unslugged", () => {
  assert.equal(repoNameFor("/Users/o/My Project"), "My Project");
  assert.equal(repoNameFor("/Users/o/My Project/"), "My Project");
});

test("normalizing strips trailing separators but never the root itself", () => {
  assert.equal(normalizeRepoPath("/a/b/"), "/a/b");
  assert.equal(normalizeRepoPath("/a/b///"), "/a/b");
  assert.equal(normalizeRepoPath("/a/b"), "/a/b");
  assert.equal(normalizeRepoPath("/"), "/");
});

test("an unreadable probe is null, not a guess at which answer it was", () => {
  assert.equal(readRepoProbe(null), null);
  assert.equal(readRepoProbe("repository"), null);
  assert.equal(readRepoProbe({}), null);
  assert.equal(readRepoProbe({ kind: "something-new" }), null);
});

test("each probe the backend can send round-trips into the model", () => {
  assert.deepEqual(readRepoProbe({ kind: "repository" }), repository);
  assert.deepEqual(readRepoProbe({ kind: "worktree" }), worktree);
  assert.deepEqual(readRepoProbe({ kind: "bare" }), bare);
  assert.deepEqual(readRepoProbe({ kind: "not-a-repo", root: null }), {
    kind: "not-a-repo",
    root: null,
  });
  assert.deepEqual(readRepoProbe({ kind: "not-a-repo", root: "/a" }), {
    kind: "not-a-repo",
    root: "/a",
  });
});

test("remove-is-forget: the confirm promises the path, and only the path", () => {
  const { body, confirmLabel, title } = removeProjectConfirm(
    repo("vingilot", "/Users/o/self-hosted/vingilot"),
  );
  assert.match(title, /Remove vingilot from this workspace\?/);
  assert.match(body, /forgets the path/);
  assert.match(body, /never touches the directory on disk/);
  assert.match(body, /\/Users\/o\/self-hosted\/vingilot/);
  assert.match(body, /stay exactly where they are/);
  assert.equal(confirmLabel, "Forget path");
});

test("the confirm copy never implies anything is deleted", () => {
  // The one sentence standing between the owner and a misread of what this
  // button does. If a word below ever appears here, the copy is wrong before
  // the code is.
  const { body, confirmLabel, title } = removeProjectConfirm(
    repo("vingilot", "/Users/o/vingilot"),
  );
  for (const word of [
    "delete",
    "deleted",
    "erase",
    "destroy",
    "wipe",
    "permanently",
    "cannot be undone",
  ]) {
    assert.equal(
      `${title} ${body} ${confirmLabel}`.toLowerCase().includes(word),
      false,
      `remove copy must not say "${word}"`,
    );
  }
});
