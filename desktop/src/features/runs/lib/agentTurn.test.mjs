import assert from "node:assert/strict";
import { test } from "node:test";
import {
  boundaryNote,
  canRun,
  explainAvailability,
  explainFailure,
  readAgentFailure,
  readAvailability,
  readTurn,
  turnSummary,
} from "./agentTurn.ts";

test("an unconfigured workspace is told which variables to set", () => {
  const availability = readAvailability({
    kind: "not-configured",
    variables: ["VINGILOT_ACP_AGENT_COMMAND", "BUZZ_ACP_AGENT_COMMAND"],
  });
  const explained = explainAvailability(availability);
  assert.equal(explained.ready, false);
  assert.match(explained.message, /VINGILOT_ACP_AGENT_COMMAND/);
  assert.match(explained.message, /BUZZ_ACP_AGENT_COMMAND/);
});

test("a configured agent that is not installed is a different sentence", () => {
  const explained = explainAvailability(
    readAvailability({ kind: "missing", program: "goose" }),
  );
  assert.equal(explained.ready, false);
  assert.match(explained.message, /goose/);
  // Not the "you have not configured one" sentence: the owner already did.
  assert.doesNotMatch(explained.message, /no ACP agent is configured/);
});

test("an unreadable answer says so rather than claiming nothing is configured", () => {
  const explained = explainAvailability(
    readAvailability({ kind: "who-knows" }),
  );
  assert.equal(explained.ready, false);
  assert.match(explained.message, /could not ask/);
});

test("a resolved agent is ready and names the path it was found at", () => {
  const availability = readAvailability({
    command: { args: ["acp"], program: "goose" },
    kind: "ready",
    resolved: "/opt/homebrew/bin/goose",
  });
  assert.deepEqual(availability, {
    args: ["acp"],
    kind: "ready",
    program: "goose",
    resolved: "/opt/homebrew/bin/goose",
  });
  assert.deepEqual(explainAvailability(availability), {
    message: "/opt/homebrew/bin/goose",
    ready: true,
  });
});

test("a ready answer missing its command is not read as ready", () => {
  assert.equal(readAvailability({ kind: "ready", resolved: "/x" }), null);
  assert.equal(readAvailability(null), null);
});

test("running needs both a prompt and an agent", () => {
  const ready = readAvailability({
    command: { args: [], program: "codex-acp" },
    kind: "ready",
    resolved: "/usr/local/bin/codex-acp",
  });
  const none = readAvailability({ kind: "not-configured", variables: [] });
  assert.equal(canRun("fix the parser", ready), true);
  assert.equal(canRun("   \n ", ready), false);
  assert.equal(canRun("fix the parser", none), false);
  assert.equal(canRun("fix the parser", null), false);
});

test("a turn is read with its transcript in the order it arrived", () => {
  const turn = readTurn({
    dropped: 0,
    sessionId: "ses_1",
    stderr: "",
    stopReason: "end_turn",
    trace: [
      { kind: "permission", text: "granted Edit greeter.py" },
      { kind: "tool-call", text: "edit greeter.py [completed]" },
      { kind: "message", text: "added farewell()" },
    ],
  });
  assert.notEqual(turn, null);
  assert.deepEqual(
    turn.trace.map((entry) => entry.kind),
    ["permission", "tool-call", "message"],
  );
  assert.equal(turnSummary(turn), "finished");
});

test("a trace entry of a kind this build does not know is dropped, not rendered blank", () => {
  const turn = readTurn({
    sessionId: "s",
    stopReason: "end_turn",
    trace: [
      { kind: "telepathy", text: "…" },
      { kind: "message", text: "hi" },
    ],
  });
  assert.deepEqual(turn.trace, [{ kind: "message", seq: 0, text: "hi" }]);
});

test("a turn that did not end normally says so before the diff is read", () => {
  const turn = readTurn({
    dropped: 3,
    sessionId: "s",
    stopReason: "max_tokens",
    stderr: "",
    trace: [],
  });
  assert.equal(turnSummary(turn), "stopped: max_tokens, 3 entries not shown");
});

test("a shape with no stop reason is not a turn", () => {
  assert.equal(readTurn({ sessionId: "s" }), null);
  assert.equal(readTurn("end_turn"), null);
});

test("silence is reported with what was already changed left alone", () => {
  const failure = readAgentFailure({
    kind: "silent",
    phase: "turn",
    seconds: 300,
  });
  assert.deepEqual(failure, { kind: "silent", phase: "turn", seconds: 300 });
  const said = explainFailure(failure);
  assert.match(said, /300s/);
  assert.match(said, /Nothing it had already changed was undone/);
});

test("the agent's own refusal keeps its code and its words", () => {
  const said = explainFailure(
    readAgentFailure({
      code: -32001,
      kind: "refused",
      message: "auth required",
    }),
  );
  assert.match(said, /-32001/);
  assert.match(said, /auth required/);
});

test("an agent that died is reported with what it wrote on the way out", () => {
  const said = explainFailure(
    readAgentFailure({
      kind: "exited",
      message: "the agent exited (exit status: 3): no credentials",
    }),
  );
  assert.match(said, /no credentials/);
});

test("a thrown value that is not a refusal is still explained", () => {
  assert.equal(readAgentFailure("boom"), null);
  assert.match(explainFailure(null), /cannot read/);
});

test("no copy in this feature claims the agent is contained", () => {
  // ADR-003: a worktree is a collision boundary, not a security boundary.
  // This is the guard that keeps a well-meaning edit from promising isolation
  // the app does not have.
  const everything = [
    boundaryNote,
    explainAvailability(
      readAvailability({ kind: "not-configured", variables: [] }),
    ).message,
    explainAvailability(readAvailability({ kind: "missing", program: "goose" }))
      .message,
    explainFailure(
      readAgentFailure({ kind: "silent", phase: "turn", seconds: 1 }),
    ),
    explainFailure(readAgentFailure({ kind: "too-long", seconds: 1 })),
  ].join(" ");
  for (const forbidden of ["isolat", "sandbox", "contain", "safe", "secure"]) {
    assert.doesNotMatch(
      everything.toLowerCase(),
      new RegExp(forbidden),
      `copy implies a boundary the worktree is not: ${forbidden}`,
    );
  }
});

test("the boundary note says what a worktree does and what it does not", () => {
  assert.match(boundaryNote, /worktree/);
  assert.match(boundaryNote, /does not hold the agent in/);
});
