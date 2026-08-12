// The MRU list and the walk through it, with no React and no keyboard
// (vingilot/docs/plans/2026-08-12-vscode-muscle-memory.md, Task 3).

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MRU_CAP,
  NO_FILE_READING,
  placeKey,
  readFileReport,
  rememberPlace,
  stepSwitcher,
  SWITCHER_CLOSED,
  switcherLanding,
} from "./placeMru.ts";

/** A place, written short. The pane defaults to something that is not Files so
 * the `file` field stays out of the way of tests that are not about it. */
function at(worktreeId, pane = "terminal", file = null) {
  return { file, pane, worktreeId };
}

test("a place is worktree, pane and file — and all three are part of its identity", () => {
  assert.notEqual(placeKey(at("wt-a")), placeKey(at("wt-b")));
  assert.notEqual(
    placeKey(at("wt-a", "terminal")),
    placeKey(at("wt-a", "diff")),
  );
  assert.notEqual(
    placeKey(at("wt-a", "files", "src/main.rs")),
    placeKey(at("wt-a", "files", "src/lib.rs")),
  );
  // The Files pane with nothing open is not the Files pane with a file open.
  assert.notEqual(
    placeKey(at("wt-a", "files", null)),
    placeKey(at("wt-a", "files", "src/main.rs")),
  );
  // And the same address twice is the same string, whatever object it arrived in.
  assert.equal(
    placeKey(at("wt-a", "files", "src/main.rs")),
    placeKey({ file: "src/main.rs", pane: "files", worktreeId: "wt-a" }),
  );
});

test("no separator collision: two different addresses cannot spell the same key", () => {
  // The reason `placeKey` joins on NUL rather than on ":" or "/". A worktree id
  // ending in the separator plus a bare pane name would collide with a longer
  // id under any separator a path or an id can actually contain.
  assert.notEqual(
    placeKey(at("wt:a", "files", "b")),
    placeKey(at("wt", "files", "a:b")),
  );
  assert.notEqual(
    placeKey(at("wt/a", "files", "b")),
    placeKey(at("wt", "files", "a/b")),
  );
});

test("the newest place is the head, and the order is the path he walked", () => {
  let places = [];
  places = rememberPlace(places, at("a"));
  places = rememberPlace(places, at("b"));
  places = rememberPlace(places, at("c"));
  assert.deepEqual(
    places.map((place) => place.worktreeId),
    ["c", "b", "a"],
  );
});

test("going back somewhere moves it to the head rather than adding a second copy", () => {
  // The dedupe, and the whole reason ⌃Tab toggles between two places: after
  // landing on `a` the list has to read `[a, c, b]` and not `[a, c, b, a]`.
  let places = [];
  for (const id of ["a", "b", "c"]) places = rememberPlace(places, at(id));
  places = rememberPlace(places, at("a"));
  assert.deepEqual(
    places.map((place) => place.worktreeId),
    ["a", "c", "b"],
  );
  assert.equal(places.length, 3);
});

test("recording the place he is already at changes nothing, by identity", () => {
  // Not an optimisation: this is called from an effect on a screen that
  // re-renders on a 2s poll, and a new array each time is a re-render each time.
  const places = rememberPlace([], at("a"));
  assert.equal(rememberPlace(places, at("a")), places);
  // A place that differs in any of the three fields is a different place, and
  // does produce a new list.
  assert.notEqual(rememberPlace(places, at("a", "diff")), places);
});

test("the list is capped, and it is the oldest that falls off", () => {
  let places = [];
  for (let n = 0; n < MRU_CAP + 5; n += 1) {
    places = rememberPlace(places, at(`wt-${n}`));
  }
  assert.equal(places.length, MRU_CAP);
  // Newest first, so the head is the last one recorded and the tail is the
  // oldest survivor — the five before it are gone.
  assert.equal(places[0].worktreeId, `wt-${MRU_CAP + 4}`);
  assert.equal(places[MRU_CAP - 1].worktreeId, "wt-5");
});

test("a repeat visit does not spend a slot", () => {
  let places = [];
  for (let n = 0; n < MRU_CAP; n += 1)
    places = rememberPlace(places, at(`wt-${n}`));
  places = rememberPlace(places, at("wt-0"));
  assert.equal(places.length, MRU_CAP);
  assert.deepEqual(places.map((place) => place.worktreeId).slice(0, 2), [
    "wt-0",
    `wt-${MRU_CAP - 1}`,
  ]);
});

/** A list of `count` places, newest first. */
function trail(count) {
  return Array.from({ length: count }, (_unused, n) => at(`wt-${n}`));
}

test("a tap is one step to the previous place — the alt-tab reflex", () => {
  // Press ⌃⇥, release ⌃, with nothing in between. The first step must land on
  // index 1: index 0 is where he already is, so a switcher that highlighted it
  // would make the whole gesture a no-op.
  const places = trail(4);
  const tapped = stepSwitcher(SWITCHER_CLOSED, places.length, 1);
  assert.equal(tapped.index, 1);
  assert.equal(switcherLanding(tapped, places), places[1]);
});

test("a hold walks, and the walk is the same reducer the tap is", () => {
  const places = trail(4);
  let state = SWITCHER_CLOSED;
  state = stepSwitcher(state, places.length, 1);
  state = stepSwitcher(state, places.length, 1);
  assert.equal(state.index, 2);
  state = stepSwitcher(state, places.length, 1);
  assert.equal(switcherLanding(state, places), places[3]);
});

test("⇧ steps back, and both ends wrap", () => {
  const places = trail(4);
  // ⇧⌃⇥ from closed goes to the oldest place: a list you cannot fall off is one
  // you can drive without watching where you are.
  const back = stepSwitcher(SWITCHER_CLOSED, places.length, -1);
  assert.equal(back.index, 3);
  assert.equal(switcherLanding(back, places), places[3]);
  // Off the end, forward.
  assert.equal(stepSwitcher({ index: 3 }, places.length, 1).index, 0);
  // Off the front, backward, from a position that is not the head.
  assert.equal(stepSwitcher({ index: 0 }, places.length, -1).index, 3);
});

test("one place opens on itself — heard must never look like silent", () => {
  // The first behaviour here was "fewer than two is closed", and the owner
  // pressed the chord on a fresh trail and reported that ⌃Tab did nothing —
  // indistinguishable from the chord never arriving. The overlay now opens on
  // the one place and says there is nowhere else yet (`PlaceSwitcher.tsx`).
  assert.equal(stepSwitcher(SWITCHER_CLOSED, 1, 1).index, 0);
  assert.equal(stepSwitcher(SWITCHER_CLOSED, 1, -1).index, 0);
  // An open switcher whose list shrank to one under the held key clamps to the
  // survivor rather than vanishing mid-gesture.
  assert.equal(stepSwitcher({ index: 2 }, 1, 1).index, 0);
});

test("zero places stays closed — there is no row to draw", () => {
  assert.equal(stepSwitcher(SWITCHER_CLOSED, 0, -1).index, null);
  assert.equal(stepSwitcher(SWITCHER_CLOSED, 0, 1).index, null);
});

/** A report, as the Files pane makes it. `path` `null` is "nothing open". */
function said(worktree, path = null) {
  return { path, worktree };
}

test("a report that just arrived is a reading of the pane that made it", () => {
  const report = said("/wt/a", "src/main.rs");
  const reading = readFileReport(NO_FILE_READING, "files:wt-a", report);
  assert.equal(reading.live, true);
  assert.equal(reading.report, report);
  assert.equal(reading.mount, "files:wt-a");
});

test("the same report under a different pane is stale, and the mount key alone cannot say so", () => {
  // **The defect this reducer exists for.** Open a file in worktree A, switch the
  // pane to Diff, switch back: the pane is remounted with an empty viewer, but
  // the mount key is `files:wt-a` both times — so a comparison of keys would call
  // the old report live and the workspace would record a place naming a file that
  // is not on screen.
  const report = said("/wt/a", "src/main.rs");
  let reading = readFileReport(NO_FILE_READING, "files:wt-a", report);
  assert.equal(reading.live, true);
  reading = readFileReport(reading, "diff:wt-a", report);
  assert.equal(reading.live, false, "the pane that made the report is gone");
  reading = readFileReport(reading, "files:wt-a", report);
  assert.equal(
    reading.live,
    false,
    "and coming back to the same key is a different pane, not the same one",
  );
  // The new pane speaking is what ends it, and "nothing open" ends it too — which
  // is the whole reason emptiness is reported rather than left silent.
  const empty = said("/wt/a");
  reading = readFileReport(reading, "files:wt-a", empty);
  assert.equal(reading.live, true);
  assert.equal(reading.report.path, null);
});

test("a worktree switch expires it as surely as a pane switch does", () => {
  const report = said("/wt/a", "src/main.rs");
  let reading = readFileReport(NO_FILE_READING, "files:wt-a", report);
  reading = readFileReport(reading, "files:wt-b", report);
  assert.equal(reading.live, false);
});

test("two reports of emptiness in a row are two reports, told apart by identity", () => {
  // Not by value: `{path: null}` twice is the same reading of two different
  // panes, and a reducer comparing contents would leave the second one stale for
  // ever — no place would be recorded for the pane he is standing in.
  let reading = readFileReport(NO_FILE_READING, "files:wt-a", said("/wt/a"));
  reading = readFileReport(reading, "diff:wt-a", reading.report);
  assert.equal(reading.live, false);
  reading = readFileReport(reading, "files:wt-a", said("/wt/a"));
  assert.equal(reading.live, true);
});

test("a report and a mount change in one render resolve to the report", () => {
  // The newer of the two facts. A report can only have come from the pane
  // mounted now; a pane that has been unmounted has nothing to say.
  const first = said("/wt/a", "src/main.rs");
  const reading = readFileReport(
    readFileReport(NO_FILE_READING, "files:wt-a", first),
    "files:wt-b",
    said("/wt/b", "src/lib.rs"),
  );
  assert.equal(reading.live, true);
  assert.equal(reading.report.worktree, "/wt/b");
});

test("nothing changed is the same reading, by identity", () => {
  // Folded during render on a screen that re-renders on a 2s poll, and folded
  // twice per render under StrictMode — a new object each time would be a new
  // reading each time.
  const report = said("/wt/a", "src/main.rs");
  const reading = readFileReport(NO_FILE_READING, "files:wt-a", report);
  assert.equal(readFileReport(reading, "files:wt-a", report), reading);
  // Including the stale state: folding the same facts again must not un-stale it.
  const stale = readFileReport(reading, "diff:wt-a", report);
  assert.equal(readFileReport(stale, "diff:wt-a", report), stale);
});

test("before any pane has spoken there is no reading, and no report to mistake for one", () => {
  assert.equal(NO_FILE_READING.live, false);
  assert.equal(NO_FILE_READING.report, null);
  const reading = readFileReport(NO_FILE_READING, "diff:wt-a", null);
  assert.equal(reading.live, false);
  assert.equal(reading.report, null);
});

test("a closed switcher lands nowhere, and so does one pointing past the end", () => {
  const places = trail(3);
  assert.equal(switcherLanding(SWITCHER_CLOSED, places), null);
  // The list shrank while ⌃ was down. Landing on `undefined` would be a
  // navigation to nothing.
  assert.equal(switcherLanding({ index: 5 }, places), null);
  assert.equal(switcherLanding({ index: 0 }, []), null);
});
