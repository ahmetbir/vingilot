import assert from "node:assert/strict";
import { test } from "node:test";
import {
  answerFromTurn,
  appendExchange,
  capThreads,
  exchangeState,
  MAX_ANSWER_CHARS,
  MAX_DIRECTORIES,
  MAX_EXCHANGES,
  parseThreads,
  settleExchange,
} from "./askThread.ts";

function exchange(over = {}) {
  return {
    answer: null,
    askedAt: 1_000,
    cwd: "/tmp/wt/a",
    id: "x1",
    question: "why",
    refusal: null,
    ...over,
  };
}

function turn(trace) {
  return {
    dropped: 0,
    sessionId: "s1",
    stderr: "",
    stopReason: "end_turn",
    trace: trace.map((entry, seq) => ({ ...entry, seq })),
  };
}

test("an exchange keeps what it was asked with, not what would be sent now", () => {
  const threads = appendExchange({}, exchange({ cwd: "/tmp/wt/gone" }));
  assert.equal(threads["/tmp/wt/gone"]?.[0]?.cwd, "/tmp/wt/gone");
});

test("an answer is what the agent said, not the whole transcript", () => {
  const said = answerFromTurn(
    turn([
      { kind: "thought", text: "hmm" },
      { kind: "tool-call", text: "read src/main.rs" },
      { kind: "message", text: "  because the lockfile is stale.  " },
      { kind: "message", text: "run cargo update." },
    ]),
  );
  assert.equal(said, "because the lockfile is stale.\n\nrun cargo update.");
});

test("a turn that said nothing says so, rather than showing an empty answer", () => {
  const said = answerFromTurn(turn([{ kind: "tool-call", text: "ls" }]));
  assert.match(said, /without saying anything/);
  assert.match(said, /finished/);
});

test("an over-long answer is cut and the cut is said out loud", () => {
  const long = "x".repeat(MAX_ANSWER_CHARS + 500);
  const settled = settleExchange(
    appendExchange({}, exchange()),
    "/tmp/wt/a",
    "x1",
    { answer: long },
  );
  const kept = settled["/tmp/wt/a"]?.[0]?.answer ?? "";
  assert.ok(kept.length > MAX_ANSWER_CHARS);
  assert.match(kept, /the rest of this answer was not kept/);
  assert.equal(kept.startsWith("x".repeat(MAX_ANSWER_CHARS)), true);
});

test("settling one exchange leaves the others alone", () => {
  let threads = appendExchange({}, exchange({ id: "x1" }));
  threads = appendExchange(threads, exchange({ askedAt: 2_000, id: "x2" }));
  threads = settleExchange(threads, "/tmp/wt/a", "x2", { answer: "there" });
  const rows = threads["/tmp/wt/a"] ?? [];
  assert.equal(rows[0]?.answer, null);
  assert.equal(rows[1]?.answer, "there");
});

test("settling an id nobody has changes nothing", () => {
  const threads = appendExchange({}, exchange());
  assert.deepEqual(
    settleExchange(threads, "/tmp/wt/a", "nope", { answer: "?" }),
    threads,
  );
  assert.deepEqual(
    settleExchange(threads, "/tmp/nowhere", "x1", { answer: "?" }),
    threads,
  );
});

test("a refusal replaces an answer and never sits beside one", () => {
  let threads = appendExchange({}, exchange());
  threads = settleExchange(threads, "/tmp/wt/a", "x1", { refusal: "no agent" });
  const row = threads["/tmp/wt/a"]?.[0];
  assert.equal(row?.refusal, "no agent");
  assert.equal(row?.answer, null);
});

test("a thread keeps its most recent exchanges, oldest dropped first", () => {
  let threads = {};
  for (let n = 0; n < MAX_EXCHANGES + 3; n += 1) {
    threads = appendExchange(
      threads,
      exchange({ askedAt: n, id: `x${n}`, question: `q${n}` }),
    );
  }
  const rows = threads["/tmp/wt/a"] ?? [];
  assert.equal(rows.length, MAX_EXCHANGES);
  assert.equal(rows[0]?.question, "q3");
  assert.equal(rows[rows.length - 1]?.question, `q${MAX_EXCHANGES + 2}`);
});

test("the least recently asked-in directory is the one that goes", () => {
  let threads = {};
  for (let n = 0; n < MAX_DIRECTORIES + 1; n += 1) {
    threads = appendExchange(
      threads,
      exchange({ askedAt: n, cwd: `/tmp/wt/${n}`, id: `x${n}` }),
    );
  }
  assert.equal(Object.keys(threads).length, MAX_DIRECTORIES);
  assert.equal(threads["/tmp/wt/0"], undefined);
  assert.notEqual(threads[`/tmp/wt/${MAX_DIRECTORIES}`], undefined);
});

test("storage that cannot be read is empty, and half-readable rows survive", () => {
  assert.deepEqual(parseThreads(null), {});
  assert.deepEqual(parseThreads("not json"), {});
  assert.deepEqual(parseThreads("[]"), {});
  const half = parseThreads(
    JSON.stringify({
      "/tmp/wt/a": [
        { askedAt: 1, cwd: "/tmp/wt/a", id: "x1", question: "kept" },
        { question: "no id, no cwd" },
        7,
      ],
    }),
  );
  assert.equal(half["/tmp/wt/a"]?.length, 1);
  assert.equal(half["/tmp/wt/a"]?.[0]?.question, "kept");
  // A row with no answer field is unanswered, not answered with "undefined".
  assert.equal(half["/tmp/wt/a"]?.[0]?.answer, null);
});

test("an empty directory is not carried around", () => {
  assert.deepEqual(capThreads({ "/tmp/wt/a": [] }), {});
});

test("a row nothing is working on does not claim to be asking", () => {
  const waiting = exchange();
  assert.equal(exchangeState(waiting, "x1"), "asking");
  assert.equal(exchangeState(waiting, null), "unanswered");
  assert.equal(exchangeState(waiting, "someone-else"), "unanswered");
  assert.equal(exchangeState(exchange({ answer: "yes" }), "x1"), "answered");
  assert.equal(exchangeState(exchange({ refusal: "no" }), "x1"), "refused");
});
