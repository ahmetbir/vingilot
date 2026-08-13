import assert from "node:assert/strict";
import test from "node:test";

import {
  foldHarborStep,
  foldHarborSteps,
  isHarborRelayUrl,
  orderedHarborSteps,
  readHarborAutoStart,
  writeHarborAutoStart,
} from "./tauriHarbor.ts";

const step = (id, state, detail = "") => ({ step: id, state, detail });

test("foldHarborStep appends a step id it has not seen", () => {
  const start = foldHarborStep([], step("checking-docker", "running"));
  assert.deepEqual(start, [step("checking-docker", "running")]);
});

test("foldHarborStep replaces the entry for a step id it already holds", () => {
  const running = [step("checking-docker", "running", "checking…")];
  const done = foldHarborStep(running, step("checking-docker", "done", "ok"));
  assert.equal(done.length, 1);
  assert.deepEqual(done, [step("checking-docker", "done", "ok")]);
});

test("foldHarborStep does not mutate its input", () => {
  const before = [step("checking-docker", "running")];
  const snapshot = JSON.parse(JSON.stringify(before));
  foldHarborStep(before, step("checking-docker", "done"));
  assert.deepEqual(before, snapshot);
});

test("foldHarborSteps merges a batch, last state per id winning", () => {
  const streamed = foldHarborSteps(
    [],
    [
      step("checking-docker", "running"),
      step("checking-docker", "done"),
      step("writing-bundle", "running"),
    ],
  );
  // The final report re-sends every step; merging it must not duplicate.
  const merged = foldHarborSteps(streamed, [
    step("checking-docker", "done"),
    step("writing-bundle", "done"),
    step("starting", "done"),
    step("waiting-for-health", "done"),
  ]);
  assert.deepEqual(
    merged.map((s) => [s.step, s.state]),
    [
      ["checking-docker", "done"],
      ["writing-bundle", "done"],
      ["starting", "done"],
      ["waiting-for-health", "done"],
    ],
  );
});

test("orderedHarborSteps sorts into the canonical four-step order", () => {
  const scrambled = [
    step("waiting-for-health", "running"),
    step("checking-docker", "done"),
    step("starting", "running"),
    step("writing-bundle", "done"),
  ];
  assert.deepEqual(
    orderedHarborSteps(scrambled).map((s) => s.step),
    ["checking-docker", "writing-bundle", "starting", "waiting-for-health"],
  );
});

test("isHarborRelayUrl accepts only the loopback harbor authority", () => {
  assert.equal(isHarborRelayUrl("ws://127.0.0.1:7447"), true);
  assert.equal(isHarborRelayUrl("ws://127.0.0.1:7447/"), true);
  // localhost is NOT the same host to the relay — it must not read as a harbor.
  assert.equal(isHarborRelayUrl("ws://localhost:7447"), false);
  assert.equal(isHarborRelayUrl("wss://relay.example.com"), false);
  assert.equal(isHarborRelayUrl(null), false);
  assert.equal(isHarborRelayUrl(""), false);
  assert.equal(isHarborRelayUrl("not a url"), false);
});

test("harbor auto-start preference round-trips through storage", () => {
  const store = new Map();
  globalThis.window = {
    localStorage: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, value),
      removeItem: (key) => store.delete(key),
    },
  };
  try {
    assert.equal(readHarborAutoStart(), false);
    writeHarborAutoStart(true);
    assert.equal(readHarborAutoStart(), true);
    writeHarborAutoStart(false);
    assert.equal(readHarborAutoStart(), false);
  } finally {
    delete globalThis.window;
  }
});
