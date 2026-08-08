import assert from "node:assert/strict";
import { test } from "node:test";
import {
  pendingAskId,
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
  assert.equal(pendingAskId(), id);
  resetAskPending();
});

test("settling writes the answer and releases the pending mark", () => {
  resetAskPending();
  const storage = shim();
  const id = startAsk("/tmp/wt/a", "why", 1, storage);
  settleAsk("/tmp/wt/a", id, { answer: "because" }, storage);
  assert.equal(readThread("/tmp/wt/a", storage)[0]?.answer, "because");
  assert.equal(pendingAskId(), null);
});

test("one question at a time — a second is refused rather than queued", () => {
  resetAskPending();
  const storage = shim();
  const first = startAsk("/tmp/wt/a", "one", 1, storage);
  const second = startAsk("/tmp/wt/a", "two", 2, storage);
  assert.notEqual(first, null);
  assert.equal(second, null);
  assert.equal(readThread("/tmp/wt/a", storage).length, 1);
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
  assert.equal(pendingAskId(), null);
});
