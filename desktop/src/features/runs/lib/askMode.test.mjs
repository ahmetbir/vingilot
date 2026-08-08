import assert from "node:assert/strict";
import { test } from "node:test";
import { ASK_PREFIX, ASK_SCOPE_NOTE, askState, readAsk } from "./askMode.ts";

const READY = { answer: "yes", detail: "/opt/homebrew/bin/some-acp" };

function inputs(over = {}) {
  return {
    cwd: "/tmp/wt/spike",
    cwdPending: false,
    harness: READY,
    inFlight: null,
    question: "why does the build fail",
    ...over,
  };
}

test("the prefix only means ask as the first character", () => {
  assert.equal(readAsk("? why is this slow"), "why is this slow");
  assert.equal(readAsk("?why is this slow"), "why is this slow");
  assert.equal(readAsk("?   spaced   "), "spaced");
  // A filter that happens to contain one is still a filter.
  assert.equal(readAsk("what? pane"), null);
  assert.equal(readAsk("prune"), null);
  assert.equal(readAsk(""), null);
  assert.equal(ASK_PREFIX, "?");
});

test("the prefix alone is ask mode with nothing asked yet", () => {
  assert.equal(readAsk("?"), "");
  const ask = askState(inputs({ question: "" }));
  assert.equal(ask.blocked, "type a question.");
  // And the scope is already on screen, before a word is typed.
  assert.deepEqual(ask.sent, ["/tmp/wt/spike"]);
});

test("what is sent is the one directory, and the note says what is not", () => {
  const ask = askState(inputs());
  assert.equal(ask.blocked, null);
  assert.deepEqual(ask.sent, ["/tmp/wt/spike"]);
  assert.equal(ask.note, ASK_SCOPE_NOTE);
  // The sentence is the promise. If a future change starts sending the diff,
  // this is the line that has to change with it.
  assert.match(ask.note, /not the diff/);
  assert.match(ask.note, /not the branch/);
  assert.match(ask.note, /reads whatever it opens there itself/);
  assert.doesNotMatch(ask.note, /knows|understands|indexed/);
});

test("no directory is a refusal, and a pending one says something else", () => {
  const open = askState(inputs({ cwd: null }));
  assert.match(open.blocked ?? "", /no worktree is open/);
  assert.deepEqual(open.sent, []);
  const waiting = askState(inputs({ cwd: null, cwdPending: true }));
  assert.match(waiting.blocked ?? "", /still working out where/);
});

test("no harness is said up front, in the words the probe used", () => {
  const ask = askState(
    inputs({
      harness: {
        answer: "no",
        detail: "no ACP agent is configured — set VINGILOT_ACP_AGENT_COMMAND.",
      },
    }),
  );
  assert.equal(
    ask.blocked,
    "no ACP agent is configured — set VINGILOT_ACP_AGENT_COMMAND.",
  );
});

test("a probe with no sentence of its own still refuses in words", () => {
  const ask = askState(inputs({ harness: { answer: "no", detail: null } }));
  assert.match(ask.blocked ?? "", /nothing here to answer/);
});

test("a harness still being looked for is not a refusal to configure one", () => {
  const ask = askState(inputs({ harness: { answer: "asking", detail: null } }));
  assert.match(ask.blocked ?? "", /still asking this machine/);
});

test("an unaskable build refuses rather than taking a question into a void", () => {
  const ask = askState(
    inputs({ harness: { answer: "unknown", detail: null } }),
  );
  assert.match(ask.blocked ?? "", /nowhere to go/);
});

test("a question asked while a turn is running is refused, not taken", () => {
  // The failure this holds: Enter closes the palette, so a question accepted
  // here and dropped by the store would be nowhere at all.
  const ask = askState(inputs({ inFlight: { cwd: "/tmp/wt/spike" } }));
  assert.match(ask.blocked ?? "", /already running here/);
  assert.match(ask.blocked ?? "", /one adapter runs at a time/);
});

test("a turn running somewhere else says where, rather than blaming this worktree", () => {
  const ask = askState(inputs({ inFlight: { cwd: "/tmp/wt/other" } }));
  assert.match(ask.blocked ?? "", /already running in \/tmp\/wt\/other/);
  // The scope block still describes where *this* question would go.
  assert.deepEqual(ask.sent, ["/tmp/wt/spike"]);
});

test("the running turn is named before the missing question", () => {
  // With `?` alone and a turn out, the useful sentence is the one that says
  // waiting is the next move — not one asking for a question that would be
  // refused the moment it was typed.
  const ask = askState(
    inputs({ inFlight: { cwd: "/tmp/wt/spike" }, question: "" }),
  );
  assert.match(ask.blocked ?? "", /already running here/);
});

test("the missing agent is named before the missing question", () => {
  // Both wrong at once: the owner's next move is to configure an agent, not to
  // type into a mode that cannot answer.
  const ask = askState(
    inputs({ harness: { answer: "no", detail: null }, question: "" }),
  );
  assert.match(ask.blocked ?? "", /nothing here to answer/);
});
