import assert from "node:assert/strict";
import { test } from "node:test";

import { CEILING_MS, createAutosave, DEBOUNCE_MS } from "./autosave.ts";

/** A clock the test moves by hand, so "did the unmount write?" has an exact
 * answer rather than a race with a real timer. */
function fakeClock() {
  let now = 0;
  let nextHandle = 1;
  const timers = new Map();
  return {
    clock: {
      clearTimer: (handle) => {
        timers.delete(handle);
      },
      now: () => now,
      setTimer: (fn, ms) => {
        const handle = nextHandle;
        nextHandle += 1;
        timers.set(handle, { at: now + ms, fn });
        return handle;
      },
    },
    /** Timers still armed — a debounce that was cancelled leaves none. */
    armed: () => timers.size,
    advance: (ms) => {
      now += ms;
      for (const [handle, timer] of [...timers]) {
        if (timer.at <= now) {
          timers.delete(handle);
          timer.fn();
        }
      }
    },
  };
}

/** An autosave over a recording write, with `saved` as what storage holds. */
function harness({ saved = "", accept = true } = {}) {
  const time = fakeClock();
  const writes = [];
  const states = [];
  const autosave = createAutosave({
    clock: time.clock,
    onState: (state) => states.push(state),
    saved,
    write: (text) => {
      writes.push(text);
      return typeof accept === "function" ? accept(text) : accept;
    },
  });
  return { autosave, states, time, writes };
}

test("nothing is written while the typing is still going", () => {
  const { autosave, time, writes } = harness();
  autosave.edit("a");
  time.advance(DEBOUNCE_MS - 1);
  autosave.edit("ab");
  time.advance(DEBOUNCE_MS - 1);
  autosave.edit("abc");
  assert.deepEqual(writes, []);

  time.advance(DEBOUNCE_MS);
  assert.deepEqual(writes, ["abc"]);
});

test("an editor that ends mid-debounce writes what was typed into it", () => {
  // The failure the plan names: the pane is swapped, ⌥⌘B hides the right
  // side, the project changes — the timer holding the newest text is
  // cancelled, and the sentence the owner watched himself type is gone.
  const { autosave, time, writes } = harness();
  autosave.edit("the last thing I typed");
  time.advance(DEBOUNCE_MS - 100);
  assert.deepEqual(writes, []);

  autosave.stop();
  assert.deepEqual(writes, ["the last thing I typed"]);
  // And the pending write went with the editor: nothing writes again after it
  // is gone, which for a document another window may now own would be a stale
  // write landing on top of a live one.
  assert.equal(time.armed(), 0);
  time.advance(DEBOUNCE_MS * 10);
  assert.deepEqual(writes, ["the last thing I typed"]);
});

test("an editor nobody typed into writes nothing when it ends", () => {
  const { autosave, states, writes } = harness({ saved: "already here" });
  autosave.stop();
  assert.deepEqual(writes, []);
  assert.deepEqual(states, []);
});

test("typing that never pauses is still written, at the ceiling", () => {
  const { autosave, time, writes } = harness();
  // A keystroke every half-debounce: the trailing timer is reset every time
  // and would never fire on its own.
  let text = "";
  for (let n = 0; n * (DEBOUNCE_MS / 2) < CEILING_MS; n += 1) {
    text += "x";
    autosave.edit(text);
    time.advance(DEBOUNCE_MS / 2);
  }
  assert.equal(writes.length, 1);
  assert.equal(writes[0], text);
});

test("an edit undone back to what is stored writes nothing and reads as saved", () => {
  const { autosave, states, time, writes } = harness({ saved: "kept" });
  autosave.edit("kept!");
  assert.deepEqual(states, ["unsaved"]);
  autosave.edit("kept");
  assert.deepEqual(states, ["unsaved", "saved"]);

  time.advance(DEBOUNCE_MS * 2);
  assert.deepEqual(writes, []);
});

test("a write storage refuses is never reported as saved", () => {
  let accepted = false;
  const { autosave, states, time, writes } = harness({
    accept: () => accepted,
  });
  autosave.edit("a note in a webview with no quota left");
  time.advance(DEBOUNCE_MS);
  assert.deepEqual(writes, ["a note in a webview with no quota left"]);
  assert.deepEqual(states, ["unsaved", "failed"]);

  // The text stays outstanding, so the next edit tries again — and a storage
  // that has come back says saved, which is the first time that word is true.
  accepted = true;
  autosave.edit("a note in a webview with room again");
  time.advance(DEBOUNCE_MS);
  assert.equal(writes.length, 2);
  assert.deepEqual(states, ["unsaved", "failed", "saved"]);
});

test("one burst of typing is one write, not thirty", () => {
  const { autosave, time, writes } = harness();
  for (const text of ["t", "th", "thi", "this"]) {
    autosave.edit(text);
    time.advance(10);
  }
  time.advance(DEBOUNCE_MS);
  assert.deepEqual(writes, ["this"]);
});
