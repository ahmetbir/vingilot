// The scratch buffer's debounce, over a write that answers later
// (vingilot/docs/plans/2026-08-12-vscode-muscle-memory.md, Task 4).
//
// `autosave.test.mjs` proves the debounce and the ceiling over a synchronous
// store. What is only true here is everything between asking and being answered:
// that `saved` is said from the answer, that two writes are never out at once,
// and that the text he typed while a write was in flight is not the text that is
// lost.

import assert from "node:assert/strict";
import { test } from "node:test";

import { CEILING_MS, DEBOUNCE_MS } from "./autosave.ts";
import { createScratchAutosave } from "./scratchAutosave.ts";

/** A clock the test moves by hand — the same shim `autosave.test.mjs` uses, so
 * "did the page's ending write?" has an exact answer rather than a race. */
function fakeClock() {
  let now = 0;
  let nextHandle = 1;
  const timers = new Map();
  return {
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
  };
}

/** Let every already-resolved promise's continuation run. The machine's state
 * moves in `.then`, so a test that asserted straight after `advance` would be
 * asserting one microtask too early. */
async function settled() {
  for (let turn = 0; turn < 4; turn += 1) await Promise.resolve();
}

/** An autosave over a write the test answers by hand.
 *
 * `answer(n, landed)` settles the nth write. Nothing resolves on its own, which
 * is the whole point: the window between asking and answering is where every
 * claim in this file lives, and a write that resolved immediately would close it
 * before anything could be observed. */
function harness({ saved = "" } = {}) {
  const time = fakeClock();
  const writes = [];
  const states = [];
  const machine = createScratchAutosave({
    clock: time.clock,
    onState: (state) => states.push(state),
    saved,
    write: (text) =>
      new Promise((resolve, reject) => {
        writes.push({ reject, resolve, text });
      }),
  });
  return {
    answer: async (n, landed) => {
      writes[n]?.resolve(landed);
      await settled();
    },
    machine,
    refuse: async (n) => {
      writes[n]?.reject(new Error("the bridge to the backend is gone"));
      await settled();
    },
    states,
    /** Just the text of every write asked for, in order. */
    sent: () => writes.map((write) => write.text),
    time,
  };
}

test("nothing is written while the typing is still going", async () => {
  const { machine, sent, time } = harness();
  machine.edit("a");
  time.advance(DEBOUNCE_MS - 1);
  machine.edit("ab");
  time.advance(DEBOUNCE_MS - 1);
  machine.edit("abc");
  assert.deepEqual(sent(), []);

  time.advance(DEBOUNCE_MS);
  assert.deepEqual(sent(), ["abc"]);
});

test("typing that never pauses is still written, at the ceiling", async () => {
  const { machine, sent, time } = harness();
  let text = "";
  for (let n = 0; n * (DEBOUNCE_MS / 2) < CEILING_MS; n += 1) {
    text += "x";
    machine.edit(text);
    time.advance(DEBOUNCE_MS / 2);
  }
  assert.deepEqual(sent(), [text]);
});

test("saved is said from the answer, never from the asking", async () => {
  // The promise this module exists for. Between the write leaving and the file
  // taking it, the only honest word is `unsaved` — a buffer that said `saved`
  // there would be saying it about a write that can still be refused.
  const { answer, machine, sent, states, time } = harness();
  machine.edit("half a postmortem");
  assert.deepEqual(states, ["unsaved"]);

  time.advance(DEBOUNCE_MS);
  assert.deepEqual(sent(), ["half a postmortem"]);
  await settled();
  assert.deepEqual(states, ["unsaved"], "the asking is not the answer");

  await answer(0, true);
  assert.deepEqual(states, ["unsaved", "saved"]);
});

test("one write at a time, and the newest text is the one that lands", async () => {
  // Two writes out at once would race for one temp path and one rename inside
  // vingilot_scratch, and the loser is a buffer that says saved while holding
  // somebody else's bytes.
  const { answer, machine, sent, states, time } = harness();
  machine.edit("first");
  time.advance(DEBOUNCE_MS);
  assert.deepEqual(sent(), ["first"]);

  // He keeps typing while the write is out. Twice, so the assertion is about
  // the *newest* text rather than about the next one.
  machine.edit("first and second");
  time.advance(DEBOUNCE_MS);
  machine.edit("first and second and third");
  time.advance(DEBOUNCE_MS);
  assert.deepEqual(sent(), ["first"], "no second write while one is out");

  await answer(0, true);
  // Sent the moment the first was answered, and it is the last thing he typed —
  // not the first thing he typed after the write left.
  assert.deepEqual(sent(), ["first", "first and second and third"]);
  // And still not saved: one of the two writes has landed, the buffer on screen
  // is the other one.
  assert.deepEqual(states, ["unsaved"]);

  await answer(1, true);
  assert.deepEqual(states, ["unsaved", "saved"]);
});

test("a write the file refuses is never reported as saved, and the text stays", async () => {
  const { answer, machine, sent, states, time } = harness();
  machine.edit("a buffer on a disk with nothing left");
  time.advance(DEBOUNCE_MS);
  await answer(0, false);
  assert.deepEqual(states, ["unsaved", "failed"]);

  // The text is still outstanding, so the next keystroke tries again — and a
  // disk that has been cleared says saved, which is the first time that word is
  // true.
  machine.edit("a buffer on a disk with room again");
  time.advance(DEBOUNCE_MS);
  assert.deepEqual(sent().length, 2);
  await answer(1, true);
  assert.deepEqual(states, ["unsaved", "failed", "saved"]);
});

test("a write that never answered at all is a refusal too", async () => {
  // The IPC failing and the filesystem refusing are the same fact to somebody
  // looking at a buffer that is not saved, so a rejection must not escape as an
  // unhandled one and must not leave the state on `unsaved` forever.
  const { machine, refuse, states, time } = harness();
  machine.edit("something worth keeping");
  time.advance(DEBOUNCE_MS);
  await refuse(0);
  assert.deepEqual(states, ["unsaved", "failed"]);
});

test("the page ending writes what was typed into the buffer", async () => {
  // The one ending that will not get its timer: `pagehide`/`beforeunload`. The
  // overlay closing is deliberately not one of them — the buffer is global and
  // its machine outlives the overlay — so this is the only caller of `stop`.
  const { machine, sent, time } = harness();
  machine.edit("the last thing I typed");
  time.advance(DEBOUNCE_MS - 100);
  assert.deepEqual(sent(), []);

  machine.stop();
  assert.deepEqual(sent(), ["the last thing I typed"]);
  // And the timer went with it, so nothing writes a second time.
  assert.equal(time.armed(), 0);
  time.advance(DEBOUNCE_MS * 10);
  assert.deepEqual(sent(), ["the last thing I typed"]);
});

test("a buffer nobody typed into writes nothing when the page ends", async () => {
  const { machine, sent, states } = harness({ saved: "already on disk" });
  machine.stop();
  machine.stop();
  assert.deepEqual(sent(), []);
  assert.deepEqual(states, []);
});

test("an edit undone back to what the file holds writes nothing", async () => {
  const { machine, sent, states, time } = harness({ saved: "kept" });
  machine.edit("kept!");
  assert.deepEqual(states, ["unsaved"]);
  machine.edit("kept");
  assert.deepEqual(states, ["unsaved", "saved"]);

  time.advance(DEBOUNCE_MS * 2);
  assert.deepEqual(sent(), []);
});

test("typing back to the file's own text while a write is out is still outstanding", async () => {
  // The case a synchronous autosave cannot have. The file holds "a"; he types
  // "ab", the write leaves, he deletes the "b". The buffer on screen is now "a"
  // again — but "a" is not what the write out there is going to put in the file,
  // so this is emphatically not `saved`, and the undo has to be written.
  const { answer, machine, sent, states, time } = harness({ saved: "a" });
  machine.edit("ab");
  time.advance(DEBOUNCE_MS);
  assert.deepEqual(sent(), ["ab"]);

  machine.edit("a");
  assert.deepEqual(states, ["unsaved"], "a write is out for text he undid");

  await answer(0, true);
  assert.deepEqual(sent(), ["ab", "a"]);
  await answer(1, true);
  assert.deepEqual(states, ["unsaved", "saved"]);
});
