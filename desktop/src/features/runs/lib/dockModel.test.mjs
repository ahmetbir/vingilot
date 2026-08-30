import assert from "node:assert/strict";
import { test } from "node:test";

import {
  clampDockHeight,
  clampDockWidth,
  DOCK_DEFAULT_H,
  DOCK_DEFAULT_W,
  DOCK_RESIZER_PX,
  DOCK_TABS,
  dockFitsBeside,
  dockSelection,
  paneOfTab,
  tabOfPane,
} from "./dockModel.ts";
import { MIN_LEFT_PX, PANE_IDS } from "./paneModel.ts";

test("the six tabs are the mockup's, in the mockup's order", () => {
  assert.deepEqual(DOCK_TABS, [
    "crew",
    "diff",
    "files",
    "checks",
    "history",
    "run",
  ]);
});

test("tab↔pane mapping round-trips for the four pane-backed tabs", () => {
  for (const tab of DOCK_TABS) {
    const pane = paneOfTab(tab);
    if (tab === "checks" || tab === "run") {
      assert.equal(pane, null);
    } else {
      assert.notEqual(pane, null);
      assert.equal(tabOfPane(pane), tab);
    }
  }
});

test("every registry pane resolves: a tab, or honestly tab-less", () => {
  const tabbed = PANE_IDS.filter((id) => tabOfPane(id) !== null);
  assert.deepEqual(tabbed.sort(), ["diff", "files", "history", "team"]);
});

test("a dock-only overlay wins; otherwise the slot's pane answers", () => {
  assert.deepEqual(dockSelection("diff", "checks"), {
    kind: "tab",
    tab: "checks",
  });
  assert.deepEqual(dockSelection("team", null), { kind: "tab", tab: "crew" });
  assert.deepEqual(dockSelection("notes", null), {
    kind: "pane",
    pane: "notes",
  });
});

test("width clamps to the mockup's 300..540 on an unmeasured surface", () => {
  assert.equal(clampDockWidth(100, 0), 300);
  assert.equal(clampDockWidth(9999, 0), 540);
  assert.equal(clampDockWidth(Number.NaN, 0), DOCK_DEFAULT_W);
});

test("the terminal's 80-column floor caps the dock on a narrow surface", () => {
  const surface = MIN_LEFT_PX + DOCK_RESIZER_PX + 320;
  assert.equal(clampDockWidth(540, surface), 320);
  // …but never under the mockup's own floor: below that the layout falls
  // back to solo, it does not draw a sliver.
  assert.equal(clampDockWidth(540, MIN_LEFT_PX + DOCK_RESIZER_PX + 100), 300);
});

test("dockFitsBeside is the solo fallback's own arithmetic", () => {
  assert.equal(dockFitsBeside(MIN_LEFT_PX + DOCK_RESIZER_PX + 300), true);
  assert.equal(dockFitsBeside(MIN_LEFT_PX + DOCK_RESIZER_PX + 299), false);
  // Unmeasured means "no claim", never "does not fit".
  assert.equal(dockFitsBeside(0), true);
});

test("drawer height clamps to the mockup's 170..480", () => {
  assert.equal(clampDockHeight(0), 170);
  assert.equal(clampDockHeight(9999), 480);
  assert.equal(clampDockHeight(Number.NaN), DOCK_DEFAULT_H);
});
