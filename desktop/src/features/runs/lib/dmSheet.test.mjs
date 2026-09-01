import assert from "node:assert/strict";
import { test } from "node:test";

import {
  closeDmSheet,
  closedDmSheet,
  dmPresenceSentence,
  isDmPillShowing,
  isDmSheetShowing,
  minimizeDmSheet,
  openDmSheet,
  restoreDmSheet,
} from "./dmSheet.ts";

const DM = "dm-luna";
const OTHER = "dm-someone-else";

test("nothing is showing until a conversation is chosen", () => {
  assert.equal(isDmSheetShowing(closedDmSheet), false);
  assert.equal(isDmPillShowing(closedDmSheet), false);
});

test("opening shows the sheet and only the sheet", () => {
  const open = openDmSheet(closedDmSheet, DM);
  assert.equal(open.channelId, DM);
  assert.equal(isDmSheetShowing(open), true);
  assert.equal(isDmPillShowing(open), false);
});

test("minimizing keeps the conversation and swaps sheet for pill", () => {
  const pill = minimizeDmSheet(openDmSheet(closedDmSheet, DM));
  assert.equal(pill.channelId, DM, "the pill stands for a named conversation");
  assert.equal(isDmSheetShowing(pill), false);
  assert.equal(isDmPillShowing(pill), true);
});

test("restore brings back the same conversation", () => {
  const back = restoreDmSheet(minimizeDmSheet(openDmSheet(closedDmSheet, DM)));
  assert.equal(back.channelId, DM);
  assert.equal(isDmSheetShowing(back), true);
  assert.equal(isDmPillShowing(back), false);
});

test("closing is a different act from minimizing: it forgets the channel", () => {
  const closed = closeDmSheet(minimizeDmSheet(openDmSheet(closedDmSheet, DM)));
  assert.deepEqual(closed, closedDmSheet);
  assert.equal(isDmSheetShowing(closed), false);
  assert.equal(isDmPillShowing(closed), false);
});

test("the sheet and the pill are never both showing", () => {
  const states = [
    closedDmSheet,
    openDmSheet(closedDmSheet, DM),
    minimizeDmSheet(openDmSheet(closedDmSheet, DM)),
    restoreDmSheet(minimizeDmSheet(openDmSheet(closedDmSheet, DM))),
    closeDmSheet(openDmSheet(closedDmSheet, DM)),
  ];
  for (const state of states) {
    assert.equal(isDmSheetShowing(state) && isDmPillShowing(state), false);
  }
});

test("choosing the minimized conversation again restores it", () => {
  const pill = minimizeDmSheet(openDmSheet(closedDmSheet, DM));
  const again = openDmSheet(pill, DM);
  assert.equal(isDmSheetShowing(again), true);
  assert.equal(isDmPillShowing(again), false);
});

test("choosing another conversation replaces the one in the sheet", () => {
  const swapped = openDmSheet(
    minimizeDmSheet(openDmSheet(closedDmSheet, DM)),
    OTHER,
  );
  assert.equal(swapped.channelId, OTHER);
  assert.equal(isDmSheetShowing(swapped), true);
});

test("open is identity-stable so a re-render is not a state change", () => {
  const open = openDmSheet(closedDmSheet, DM);
  assert.equal(openDmSheet(open, DM), open);
  assert.equal(minimizeDmSheet(closedDmSheet), closedDmSheet);
  assert.equal(restoreDmSheet(open), open);
  assert.equal(closeDmSheet(closedDmSheet), closedDmSheet);
});

test("a degraded socket takes the presence slot and says so", () => {
  for (const connection of ["reconnecting", "stalled", "disconnected"]) {
    const line = dmPresenceSentence({ connection, presence: "online" });
    assert.equal(line.connected, false);
    assert.match(line.text, /not connected/);
    assert.doesNotMatch(
      line.text,
      /online/,
      "a dead socket must not print a stale presence word",
    );
  }
});

test("a socket still coming up says that rather than a presence word", () => {
  for (const connection of ["connecting", "idle"]) {
    const line = dmPresenceSentence({ connection, presence: "away" });
    assert.equal(line.connected, false);
    assert.equal(line.text, "connecting…");
  }
});

test("a connected socket prints the real presence reading", () => {
  assert.deepEqual(
    dmPresenceSentence({ connection: "connected", presence: "online" }),
    { connected: true, text: "online · direct message" },
  );
  assert.deepEqual(
    dmPresenceSentence({ connection: "connected", presence: "offline" }),
    { connected: true, text: "offline · direct message" },
  );
});

test("no presence reading claims nothing about presence", () => {
  assert.deepEqual(
    dmPresenceSentence({ connection: "connected", presence: undefined }),
    { connected: true, text: "direct message" },
  );
});
