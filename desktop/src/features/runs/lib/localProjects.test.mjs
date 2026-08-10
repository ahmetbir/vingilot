import assert from "node:assert/strict";
import { test } from "node:test";
import {
  acknowledgeImport,
  addLocalProject,
  EMPTY_LOCAL_PROJECTS,
  importNotice,
  pushDecision,
  readLocalProjects,
  removeLocalProject,
  seedOnceDecision,
  serializeLocalProjects,
  unreconciledNotice,
} from "./localProjects.ts";

const repository = { kind: "repository" };

const repo = (id, path, name = id) => ({ id, name, path });

/** A document as it would come back from the file, without going through
 * JSON — the seed and push tests are about the decision, not the parse. */
const doc = (repos, imported = null, foreign = []) => ({
  foreign,
  imported,
  repos,
  version: 1,
});

/** A document that has already taken a coordinator's list once — the state
 * every push below is about, since a list never taken is a standoff rather
 * than something to push. */
const seeded = (repos) =>
  doc(repos, { acknowledged: true, at: "2026-08-10T09:00:00.000Z", count: 1 });

// ---------------------------------------------------------------------------
// Reading the file
// ---------------------------------------------------------------------------

test("a machine with no file yet reads as the empty list, not as a failure", () => {
  const read = readLocalProjects(null);
  assert.equal(read.ok, true);
  assert.deepEqual(read.doc, EMPTY_LOCAL_PROJECTS);
});

test("a file that cannot be parsed is refused rather than read as empty", () => {
  // The whole seed condition turns on "the local list is empty", so a parse
  // failure that answered `[]` would be a licence to overwrite the owner's
  // file with whatever the coordinator held.
  const read = readLocalProjects("{ this is not json");
  assert.equal(read.ok, false);
  assert.match(read.reason, /valid JSON/);
});

test("a file from a newer build is refused instead of being rewritten", () => {
  const read = readLocalProjects(JSON.stringify({ repos: [], version: 99 }));
  assert.equal(read.ok, false);
  assert.match(read.reason, /newer build/);
});

test("a JSON array, or anything that is not an object, is refused", () => {
  assert.equal(readLocalProjects("[]").ok, false);
  assert.equal(readLocalProjects('"projects"').ok, false);
  assert.equal(readLocalProjects("null").ok, false);
});

test("an object with no repos array is refused", () => {
  assert.equal(readLocalProjects(JSON.stringify({ version: 1 })).ok, false);
});

test("entries the build cannot read survive a read and a write", () => {
  const text = JSON.stringify({
    repos: [{ future: "shape" }, repo("buzz", "/src/buzz")],
    version: 1,
  });
  const read = readLocalProjects(text);
  assert.equal(read.ok, true);
  assert.deepEqual(read.doc.repos, [repo("buzz", "/src/buzz")]);

  const written = JSON.parse(serializeLocalProjects(read.doc));
  assert.deepEqual(written.repos, [
    { future: "shape" },
    repo("buzz", "/src/buzz"),
  ]);
});

test("what is written reads back as what was written", () => {
  const before = doc([repo("buzz", "/src/buzz"), repo("talon", "/src/talon")], {
    acknowledged: false,
    at: "2026-08-10T09:00:00.000Z",
    count: 2,
  });
  const read = readLocalProjects(serializeLocalProjects(before));
  assert.equal(read.ok, true);
  assert.deepEqual(read.doc, before);
});

// ---------------------------------------------------------------------------
// Add and remove, with no coordinator anywhere
// ---------------------------------------------------------------------------

test("a machine that has never seen a coordinator can add a project", () => {
  const added = addLocalProject(
    EMPTY_LOCAL_PROJECTS,
    "/Users/o/work/talon",
    repository,
  );
  assert.equal(added.ok, true);
  assert.deepEqual(added.doc.repos, [
    { id: "talon", name: "talon", path: "/Users/o/work/talon" },
  ]);
});

test("and still has it after a restart", () => {
  // The restart, exactly: what was written to the file is all that crosses
  // the gap, and nothing else is consulted on the way back up.
  const added = addLocalProject(
    EMPTY_LOCAL_PROJECTS,
    "/Users/o/work/talon",
    repository,
  );
  const reopened = readLocalProjects(serializeLocalProjects(added.doc));
  assert.equal(reopened.ok, true);
  assert.deepEqual(reopened.doc.repos, [
    { id: "talon", name: "talon", path: "/Users/o/work/talon" },
  ]);
});

test("adding the same folder twice is refused in the folder's words", () => {
  const first = addLocalProject(EMPTY_LOCAL_PROJECTS, "/src/buzz", repository);
  const second = addLocalProject(first.doc, "/src/buzz/", repository);
  assert.equal(second.ok, false);
  assert.match(second.reason, /already a project/);
});

test("a directory that is not a repository is refused, and nothing is added", () => {
  const added = addLocalProject(EMPTY_LOCAL_PROJECTS, "/tmp/notes", {
    kind: "not-a-repo",
    root: null,
  });
  assert.equal(added.ok, false);
  assert.deepEqual(EMPTY_LOCAL_PROJECTS.repos, []);
});

test("removing forgets exactly one path and leaves the rest in order", () => {
  const before = doc([
    repo("a", "/src/a"),
    repo("b", "/src/b"),
    repo("c", "/src/c"),
  ]);
  assert.deepEqual(removeLocalProject(before, "b").repos, [
    repo("a", "/src/a"),
    repo("c", "/src/c"),
  ]);
});

test("removing a project that is already gone is not an error", () => {
  const before = doc([repo("a", "/src/a")]);
  assert.deepEqual(removeLocalProject(before, "gone").repos, before.repos);
});

// ---------------------------------------------------------------------------
// The seed — the one read from the coordinator, and the four ways it refuses
// ---------------------------------------------------------------------------

const AT = "2026-08-10T09:00:00.000Z";

test("an empty machine seeds from a coordinator that answered", () => {
  const decision = seedOnceDecision(
    EMPTY_LOCAL_PROJECTS,
    { answered: true, repos: [repo("buzz", "/src/buzz")] },
    AT,
  );
  assert.equal(decision.seed, true);
  assert.deepEqual(decision.doc.repos, [repo("buzz", "/src/buzz")]);
  assert.deepEqual(decision.doc.imported, {
    acknowledged: false,
    at: AT,
    count: 1,
  });
});

test("a coordinator that has not answered seeds nothing and marks nothing", () => {
  // The failure this exists for: on the Mac mini, marking the import done
  // against a coordinator that was merely slow would replace his real list
  // with an empty one that can never be seeded again.
  const decision = seedOnceDecision(
    EMPTY_LOCAL_PROJECTS,
    { answered: false },
    AT,
  );
  assert.deepEqual(decision, { seed: false, why: "no-answer" });
});

test("a coordinator that answered with no projects does not burn the seed", () => {
  const decision = seedOnceDecision(
    EMPTY_LOCAL_PROJECTS,
    { answered: true, repos: [] },
    AT,
  );
  assert.deepEqual(decision, { seed: false, why: "nothing-to-import" });
});

test("a list that was already started is never merged into", () => {
  const decision = seedOnceDecision(
    doc([repo("talon", "/src/talon")]),
    { answered: true, repos: [repo("buzz", "/src/buzz")] },
    AT,
  );
  assert.deepEqual(decision, { seed: false, why: "list-not-empty" });
});

test("a second launch does not import again, even into an emptied list", () => {
  // He imported five, then forgot all five. They do not come back.
  const seeded = seedOnceDecision(
    EMPTY_LOCAL_PROJECTS,
    { answered: true, repos: [repo("buzz", "/src/buzz")] },
    AT,
  );
  const emptied = removeLocalProject(seeded.doc, "buzz");
  const again = seedOnceDecision(
    emptied,
    { answered: true, repos: [repo("buzz", "/src/buzz")] },
    "2026-08-11T09:00:00.000Z",
  );
  assert.deepEqual(again, { seed: false, why: "already-imported" });
});

test("the import survives the file, so the once holds across a restart", () => {
  const seeded = seedOnceDecision(
    EMPTY_LOCAL_PROJECTS,
    { answered: true, repos: [repo("buzz", "/src/buzz")] },
    AT,
  );
  const reopened = readLocalProjects(serializeLocalProjects(seeded.doc));
  assert.deepEqual(reopened.doc.imported, {
    acknowledged: false,
    at: AT,
    count: 1,
  });
});

// ---------------------------------------------------------------------------
// Saying it happened
// ---------------------------------------------------------------------------

test("an import that happened is said, with its count and where the list is", () => {
  const seeded = seedOnceDecision(
    EMPTY_LOCAL_PROJECTS,
    { answered: true, repos: [repo("a", "/a"), repo("b", "/b")] },
    AT,
  );
  const notice = importNotice(seeded.doc);
  assert.match(notice, /2 projects were imported/);
  assert.match(notice, /~\/\.vingilot\/projects\.json/);
});

test("a machine that imported nothing says nothing", () => {
  assert.equal(importNotice(EMPTY_LOCAL_PROJECTS), null);
});

test("the notice goes away once it is read, and stays away", () => {
  const seeded = seedOnceDecision(
    EMPTY_LOCAL_PROJECTS,
    { answered: true, repos: [repo("a", "/a")] },
    AT,
  );
  const read = acknowledgeImport(seeded.doc);
  assert.equal(importNotice(read), null);
  const reopened = readLocalProjects(serializeLocalProjects(read));
  assert.equal(importNotice(reopened.doc), null);
});

// ---------------------------------------------------------------------------
// The push — one direction
// ---------------------------------------------------------------------------

test("a coordinator that already agrees is not written to", () => {
  const local = seeded([repo("buzz", "/src/buzz")]);
  assert.deepEqual(
    pushDecision(local, { repos: [repo("buzz", "/src/buzz")] }),
    {
      push: false,
      why: "already-agrees",
    },
  );
});

test("a project added locally is pushed to the coordinator", () => {
  const local = seeded([
    repo("buzz", "/src/buzz"),
    repo("talon", "/src/talon"),
  ]);
  assert.deepEqual(
    pushDecision(local, { repos: [repo("buzz", "/src/buzz")] }),
    {
      push: true,
      repos: [repo("buzz", "/src/buzz"), repo("talon", "/src/talon")],
    },
  );
});

test("a project only the coordinator has is dropped, not pulled back", () => {
  // One direction: the local list is the authority, so a repo that is here
  // and not there was forgotten here.
  const local = seeded([repo("buzz", "/src/buzz")]);
  assert.deepEqual(
    pushDecision(local, {
      repos: [repo("buzz", "/src/buzz"), repo("stale", "/src/stale")],
    }),
    { push: true, repos: [repo("buzz", "/src/buzz")] },
  );
});

test("a rename is a difference worth pushing", () => {
  const local = seeded([repo("buzz", "/src/buzz", "Buzz")]);
  assert.deepEqual(
    pushDecision(local, { repos: [repo("buzz", "/src/buzz")] }),
    {
      push: true,
      repos: [repo("buzz", "/src/buzz", "Buzz")],
    },
  );
});

test("the push carries back entries this build could not read", () => {
  const local = seeded([repo("buzz", "/src/buzz")]);
  assert.deepEqual(
    pushDecision(local, { repos: [{ from: "a newer client" }] }),
    {
      push: true,
      repos: [{ from: "a newer client" }, repo("buzz", "/src/buzz")],
    },
  );
});

test("an empty machine pushes nothing to an empty coordinator", () => {
  assert.deepEqual(pushDecision(EMPTY_LOCAL_PROJECTS, { repos: [] }), {
    push: false,
    why: "already-agrees",
  });
});

// ---------------------------------------------------------------------------
// The standoff: a list started here, and a coordinator list never taken
// ---------------------------------------------------------------------------

test("a list this machine never took is not overwritten by one started here", () => {
  // The order that loses his projects if this is written the obvious way: the
  // new build ran while the coordinator was down, he added one project, and
  // the coordinator came back holding the five that only it has.
  const local = doc([repo("added-here", "/src/added-here")]);
  assert.deepEqual(
    pushDecision(local, {
      repos: [repo("a", "/a"), repo("b", "/b"), repo("c", "/c")],
    }),
    { push: false, why: "never-seen-this-list" },
  );
});

test("once the list has been taken, the local list is the authority again", () => {
  const local = seeded([repo("added-here", "/src/added-here")]);
  assert.deepEqual(
    pushDecision(local, { repos: [repo("a", "/a"), repo("b", "/b")] }),
    { push: true, repos: [repo("added-here", "/src/added-here")] },
  );
});

test("a coordinator holding nothing is not a list to stand off against", () => {
  const local = doc([repo("added-here", "/src/added-here")]);
  assert.deepEqual(pushDecision(local, { repos: [] }), {
    push: true,
    repos: [repo("added-here", "/src/added-here")],
  });
});

test("the standoff is said, with its count and the way out of it", () => {
  const local = doc([repo("added-here", "/src/added-here")]);
  const notice = unreconciledNotice(local, {
    repos: [repo("a", "/a"), repo("b", "/b")],
  });
  assert.match(notice, /coordinator holds 2 projects/);
  assert.match(notice, /Nothing was pushed to it and nothing was taken/);
  assert.match(notice, /forget the project added here/);
});

test("nothing is said when there is no standoff", () => {
  const local = seeded([repo("buzz", "/src/buzz")]);
  assert.equal(unreconciledNotice(local, { repos: [repo("a", "/a")] }), null);
  assert.equal(
    unreconciledNotice(EMPTY_LOCAL_PROJECTS, { repos: [repo("a", "/a")] }),
    null,
  );
});
