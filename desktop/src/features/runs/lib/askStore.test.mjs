import assert from "node:assert/strict";
import { test } from "node:test";
import {
  pendingAsk,
  readThread,
  resetAskPending,
  settleAsk,
  startAsk,
  subscribeToAsks,
  writeThreads,
} from "./askStore.ts";

function shim(initial = null) {
  let value = initial;
  return {
    getItem: () => value,
    setItem: (_key, next) => {
      value = next;
    },
    read: () => value,
  };
}

test("a question is stored the moment it is asked, not when it is answered", () => {
  resetAskPending();
  const storage = shim();
  const id = startAsk("/tmp/wt/a", "why is this slow", 1_700, storage);
  assert.notEqual(id, null);
  const rows = readThread("/tmp/wt/a", storage);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.question, "why is this slow");
  assert.equal(rows[0]?.answer, null);
  assert.equal(pendingAsk()?.id, id);
  resetAskPending();
});

test("the mark names the directory the running turn is in", () => {
  resetAskPending();
  const storage = shim();
  startAsk("/tmp/wt/other", "why", 1, storage);
  // A refusal shown in a *different* worktree has to say where the turn that
  // blocks it is running, so the pending mark carries it.
  assert.equal(pendingAsk()?.cwd, "/tmp/wt/other");
  resetAskPending();
});

test("settling writes the answer and releases the pending mark", () => {
  resetAskPending();
  const storage = shim();
  const id = startAsk("/tmp/wt/a", "why", 1, storage);
  settleAsk("/tmp/wt/a", id, { answer: "because" }, storage);
  assert.equal(readThread("/tmp/wt/a", storage)[0]?.answer, "because");
  assert.equal(pendingAsk(), null);
});

test("one turn at a time — a second question is kept and refused, never dropped", () => {
  resetAskPending();
  const storage = shim();
  const first = startAsk("/tmp/wt/a", "one", 1, storage);
  const second = startAsk("/tmp/wt/a", "two", 2, storage);
  assert.notEqual(first, null);
  // Not started: the mark is still the first turn's.
  assert.equal(second, null);
  assert.equal(pendingAsk()?.id, first);
  // But written, with the reason it never ran on it. A question the owner
  // typed and watched disappear is the failure this guards.
  const rows = readThread("/tmp/wt/a", storage);
  assert.equal(rows.length, 2);
  assert.equal(rows[1]?.question, "two");
  assert.equal(rows[1]?.answer, null);
  assert.match(rows[1]?.refusal ?? "", /one adapter runs at a time/);
  assert.notEqual(rows[1]?.id, rows[0]?.id);
  resetAskPending();
});

test("the refused question does not settle when the running one comes back", () => {
  resetAskPending();
  const storage = shim();
  const first = startAsk("/tmp/wt/a", "one", 1, storage);
  startAsk("/tmp/wt/a", "two", 2, storage);
  settleAsk("/tmp/wt/a", first, { answer: "because" }, storage);
  const rows = readThread("/tmp/wt/a", storage);
  assert.equal(rows[0]?.answer, "because");
  assert.equal(rows[1]?.answer, null);
  assert.match(rows[1]?.refusal ?? "", /one adapter runs at a time/);
  // And the door is open again for the question he now has to retype.
  assert.equal(pendingAsk(), null);
  resetAskPending();
});

test("subscribers hear the ask and the answer", () => {
  resetAskPending();
  const storage = shim();
  let heard = 0;
  const stop = subscribeToAsks(() => {
    heard += 1;
  });
  const id = startAsk("/tmp/wt/a", "why", 1, storage);
  assert.equal(heard, 1);
  settleAsk("/tmp/wt/a", id, { refusal: "no agent" }, storage);
  assert.equal(heard, 2);
  stop();
  startAsk("/tmp/wt/a", "again", 2, storage);
  assert.equal(heard, 2);
  resetAskPending();
});

test("threads are read back per directory, and an unknown one is empty", () => {
  const storage = shim();
  writeThreads(
    {
      "/tmp/wt/a": [
        {
          answer: "kept",
          askedAt: 1,
          cwd: "/tmp/wt/a",
          id: "x1",
          question: "q",
          refusal: null,
        },
      ],
    },
    storage,
  );
  assert.equal(readThread("/tmp/wt/a", storage)[0]?.answer, "kept");
  assert.deepEqual(readThread("/tmp/wt/elsewhere", storage), []);
});

test("a storage that refuses every write costs the thread, never the render", () => {
  resetAskPending();
  const refusing = {
    getItem: () => null,
    setItem: () => {
      throw new Error("quota");
    },
  };
  const id = startAsk("/tmp/wt/a", "why", 1, refusing);
  assert.notEqual(id, null);
  settleAsk("/tmp/wt/a", id, { answer: "fine" }, refusing);
  assert.equal(pendingAsk(), null);
});
