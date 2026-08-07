import assert from "node:assert/strict";
import { test } from "node:test";
import { addRepoPlan, commitRepos, removeRepoPlan } from "./repoStore.ts";

const repository = { kind: "repository" };

const repo = (id, path, name = id) => ({ id, name, path });

/** A coordinator scripted by its write answers. Records every read and every
 * write so a test can assert what was actually sent, not just what came
 * back. */
function fakeIo(revisions, writeAnswers) {
  const reads = [];
  const writes = [];
  let readAt = 0;
  let wroteAt = 0;
  return {
    reads,
    writes,
    async read() {
      const revision = revisions[Math.min(readAt, revisions.length - 1)];
      readAt += 1;
      const state =
        typeof revision === "object" ? revision.state : { repos: [] };
      const value = {
        revision: typeof revision === "object" ? revision.revision : revision,
        state,
        state_hash: "h",
      };
      reads.push(value.revision);
      return { ok: true, value };
    },
    async write(expectedRevision, repos) {
      writes.push({ expectedRevision, repos });
      const answer = writeAnswers[Math.min(wroteAt, writeAnswers.length - 1)];
      wroteAt += 1;
      return answer;
    },
  };
}

const ok = {
  ok: true,
  value: { accepted: true, revision: 9, state_hash: "h" },
};
const conflict = {
  ok: false,
  kind: "conflict",
  error: "revision_mismatch",
  detail: "expected 3, found 4",
};
const unreachable = { ok: false, kind: "unreachable" };

test("a clean write quotes the revision it just read", async () => {
  const io = fakeIo([3], [ok]);
  const result = await commitRepos(io, addRepoPlan("/o/vingilot", repository));

  assert.equal(result.ok, true);
  assert.deepEqual(io.writes, [
    { expectedRevision: 3, repos: [repo("vingilot", "/o/vingilot")] },
  ]);
});

test("a 409 refreshes and retries exactly once, at the new revision", async () => {
  const io = fakeIo(
    [
      { revision: 3, state: { repos: [] } },
      { revision: 4, state: { repos: [repo("buzz", "/o/buzz")] } },
    ],
    [conflict, ok],
  );
  const result = await commitRepos(io, addRepoPlan("/o/vingilot", repository));

  assert.equal(result.ok, true);
  assert.deepEqual(io.reads, [3, 4]);
  assert.equal(io.writes.length, 2);
  assert.equal(io.writes[0].expectedRevision, 3);
  assert.equal(io.writes[1].expectedRevision, 4);
});

test("the retry replans against the winner's list rather than resending", async () => {
  // The whole point of replanning: a payload computed against the losing read
  // would drop the repo the winner just added.
  const io = fakeIo(
    [
      { revision: 3, state: { repos: [] } },
      { revision: 4, state: { repos: [repo("buzz", "/o/buzz")] } },
    ],
    [conflict, ok],
  );
  await commitRepos(io, addRepoPlan("/o/vingilot", repository));

  assert.deepEqual(io.writes[0].repos, [repo("vingilot", "/o/vingilot")]);
  assert.deepEqual(io.writes[1].repos, [
    repo("buzz", "/o/buzz"),
    repo("vingilot", "/o/vingilot"),
  ]);
});

test("a second 409 surfaces the conflict instead of trying again", async () => {
  const io = fakeIo([3, 4, 5], [conflict, conflict]);
  const result = await commitRepos(io, addRepoPlan("/o/vingilot", repository));

  assert.equal(result.ok, false);
  assert.match(result.reason, /changed while this was being written/);
  assert.equal(io.writes.length, 2, "a third write would be a clobber");
});

test("a path the winner added first is refused on the retry, not written twice", async () => {
  const io = fakeIo(
    [
      { revision: 3, state: { repos: [] } },
      { revision: 4, state: { repos: [repo("vingilot", "/o/vingilot")] } },
    ],
    [conflict, ok],
  );
  const result = await commitRepos(io, addRepoPlan("/o/vingilot", repository));

  assert.equal(result.ok, false);
  assert.match(result.reason, /already a project/);
  assert.equal(io.writes.length, 1, "the retry must not write a duplicate");
});

test("a refused plan never reaches the coordinator at all", async () => {
  const io = fakeIo([3], [ok]);
  const result = await commitRepos(
    io,
    addRepoPlan("/o/Documents", { kind: "not-a-repo", root: null }),
  );

  assert.equal(result.ok, false);
  assert.match(result.reason, /no \.git here/);
  assert.deepEqual(io.writes, []);
});

test("an unreachable coordinator is reported, and nothing is written", async () => {
  const io = {
    writes: [],
    async read() {
      return unreachable;
    },
    async write(expectedRevision, repos) {
      this.writes.push({ expectedRevision, repos });
      return ok;
    },
  };
  const result = await commitRepos(io, addRepoPlan("/o/vingilot", repository));

  assert.equal(result.ok, false);
  assert.match(result.reason, /not answering/);
  assert.deepEqual(io.writes, []);
});

test("a refusal that is not a conflict is surfaced without a retry", async () => {
  const io = fakeIo(
    [3],
    [
      {
        ok: false,
        kind: "api",
        status: 400,
        error: "bad_mutation",
        detail: "unknown key",
      },
    ],
  );
  const result = await commitRepos(io, addRepoPlan("/o/vingilot", repository));

  assert.equal(result.ok, false);
  assert.match(result.reason, /400 bad_mutation/);
  assert.equal(io.writes.length, 1);
});

test("remove writes the same list one entry shorter, and nothing else", async () => {
  const io = fakeIo(
    [
      {
        revision: 7,
        state: {
          repos: [repo("buzz", "/o/buzz"), repo("vingilot", "/o/vingilot")],
          deck: { pins: ["keep-me"] },
        },
      },
    ],
    [ok],
  );
  const result = await commitRepos(io, removeRepoPlan("buzz"));

  assert.equal(result.ok, true);
  assert.deepEqual(io.writes, [
    { expectedRevision: 7, repos: [repo("vingilot", "/o/vingilot")] },
  ]);
});

test("removing a repo that is already gone is not an error", async () => {
  const io = fakeIo(
    [{ revision: 7, state: { repos: [repo("vingilot", "/o/vingilot")] } }],
    [ok],
  );
  const result = await commitRepos(io, removeRepoPlan("buzz"));

  assert.equal(result.ok, true);
  assert.deepEqual(io.writes[0].repos, [repo("vingilot", "/o/vingilot")]);
});

test("a repo entry's unknown keys survive a remove untouched", async () => {
  // The array is the unit of change, so every write rewrites every entry —
  // a future client's fields must not be deleted by this one.
  const withExtra = { ...repo("vingilot", "/o/vingilot"), colour: "amber" };
  const io = fakeIo(
    [{ revision: 7, state: { repos: [repo("buzz", "/o/buzz"), withExtra] } }],
    [ok],
  );
  await commitRepos(io, removeRepoPlan("buzz"));

  assert.deepEqual(io.writes[0].repos, [withExtra]);
});
