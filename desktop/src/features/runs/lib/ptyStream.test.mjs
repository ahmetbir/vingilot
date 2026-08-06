import assert from "node:assert/strict";
import { test } from "node:test";
import { acceptPtyChunk, initialPtyStreamState } from "./ptyStream.ts";

/** Fold a whole sequence of events, returning everything written in order. */
function run(chunks) {
  let state = initialPtyStreamState();
  const written = [];
  for (const chunk of chunks) {
    const result = acceptPtyChunk(state, chunk);
    state = result.state;
    written.push(...result.write);
  }
  return { state, written };
}

const live = (seq, data) => ({ data, replay: false, seq });
const replay = (through, data) => ({ data, replay: true, seq: through });

test("a fresh session's empty replay unblocks the stream", () => {
  const { written } = run([replay(0, ""), live(0, "$ "), live(1, "ls\r\n")]);
  assert.deepEqual(written, ["$ ", "ls\r\n"]);
});

test("output arriving before the replay is held, not written twice", () => {
  // The exact overlap: the reader thread emits chunk 0, then pty_open
  // snapshots a screen that already contains it.
  const { written } = run([
    live(0, "compiling foo\r\n"),
    replay(1, "$ cargo build\r\ncompiling foo\r\n"),
    live(1, "compiling bar\r\n"),
  ]);
  assert.deepEqual(written, [
    "$ cargo build\r\ncompiling foo\r\n",
    "compiling bar\r\n",
  ]);
});

test("held output past the replay mark is released after the replay", () => {
  const { written } = run([
    live(3, "past the snapshot\r\n"),
    replay(3, "everything up to here\r\n"),
  ]);
  assert.deepEqual(written, [
    "everything up to here\r\n",
    "past the snapshot\r\n",
  ]);
});

test("held output is released in stream order, not arrival order", () => {
  // Two threads emit: the reader and the pty_open command. Arrival order
  // across an IPC boundary is not send order.
  const { written } = run([
    live(5, "second\r\n"),
    live(4, "first\r\n"),
    replay(4, "screen\r\n"),
  ]);
  assert.deepEqual(written, ["screen\r\n", "first\r\n", "second\r\n"]);
});

test("live output emitted after the snapshot but below the mark is dropped", () => {
  // The replay can land before a chunk the snapshot already contains — the
  // filter has to survive that, not just the buffering path.
  const { written } = run([replay(7, "screen\r\n"), live(6, "already shown")]);
  assert.deepEqual(written, ["screen\r\n"]);
});

test("an empty replay never writes an empty string to the terminal", () => {
  const { written } = run([replay(0, "")]);
  assert.deepEqual(written, []);
});

test("a second replay for the same view is ignored", () => {
  const { written } = run([
    replay(0, "screen\r\n"),
    live(0, "live\r\n"),
    replay(1, "screen\r\nlive\r\n"),
  ]);
  assert.deepEqual(written, ["screen\r\n", "live\r\n"]);
});

test("a replay that never arrives cannot retain output without bound", () => {
  const chunks = [];
  for (let seq = 0; seq < 1000; seq += 1) chunks.push(live(seq, `${seq}\r\n`));
  const { state, written } = run(chunks);
  assert.deepEqual(written, []);
  assert.equal(state.held.length, 256);
  // Oldest-first eviction: what survives is the most recent output.
  assert.equal(state.held[state.held.length - 1].seq, 999);
});

test("accepting a chunk does not mutate the state it was given", () => {
  const before = initialPtyStreamState();
  acceptPtyChunk(before, live(0, "x"));
  assert.deepEqual(before, { held: [], replayThrough: null });
});
