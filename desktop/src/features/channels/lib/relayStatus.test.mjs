import assert from "node:assert/strict";
import { test } from "node:test";
import { relayStatus } from "./relayStatus.ts";

// The chat status bar's one right-hand fact: the relay connection, in the
// same short-word contract `controlPlaneStatus` already keeps ("synced" /
// "not answering" / "no control plane"). Every word is a reading of
// `useRelayConnection`'s state — nothing here polls, guesses, or invents.

test("every connection state has a word, and no two degraded states share one", () => {
  const states = [
    "idle",
    "connecting",
    "connected",
    "reconnecting",
    "stalled",
    "disconnected",
  ];
  const words = states.map((state) => relayStatus(state).word);
  for (const word of words) {
    assert.ok(word.length > 0);
    // A glance word, not a sentence: the sentence is the tooltip's.
    assert.ok(word.length <= 24, `"${word}" is a sentence, not a word`);
  }
  assert.equal(new Set(words).size, words.length);
});

test("connected is a fact, not a click — only recoverable states offer reconnect", () => {
  // The bar's click targets are honest: a word is a button only when clicking
  // it does something. `connecting`/`reconnecting` are already in flight —
  // offering a second reconnect there is a lie about what the click adds.
  assert.equal(relayStatus("connected").canReconnect, false);
  assert.equal(relayStatus("connecting").canReconnect, false);
  assert.equal(relayStatus("reconnecting").canReconnect, false);
  assert.equal(relayStatus("idle").canReconnect, true);
  assert.equal(relayStatus("stalled").canReconnect, true);
  assert.equal(relayStatus("disconnected").canReconnect, true);
});

test("a stalled relay says 'not answering' — the app's one vocabulary for that state", () => {
  // `controlPlaneStatus` already says "not answering" for a service that was
  // there and stopped replying. Two bars, one language.
  assert.equal(relayStatus("stalled").word, "not answering");
});

test("no word overclaims: degraded states never read as connected", () => {
  for (const state of ["idle", "reconnecting", "stalled", "disconnected"]) {
    assert.notEqual(relayStatus(state).word, "connected");
    assert.doesNotMatch(relayStatus(state).word, /^connected/);
  }
});

test("every state carries a tooltip sentence that says more than the word", () => {
  for (const state of [
    "idle",
    "connecting",
    "connected",
    "reconnecting",
    "stalled",
    "disconnected",
  ]) {
    const status = relayStatus(state);
    assert.ok(status.detail.length > status.word.length);
  }
});

test("the recoverable details say what a click does", () => {
  for (const state of ["idle", "stalled", "disconnected"]) {
    assert.match(relayStatus(state).detail, /[Cc]lick/);
  }
});
