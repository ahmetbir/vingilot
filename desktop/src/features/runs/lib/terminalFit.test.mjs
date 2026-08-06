import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveFit, shouldFit, shouldResizePty } from "./terminalFit.ts";

test("a laid-out container is fittable", () => {
  assert.equal(shouldFit(800, 600), true);
});

test("a hidden container measures 0x0 and is never fittable", () => {
  assert.equal(shouldFit(0, 0), false);
});

test("either axis at zero is enough to refuse the fit", () => {
  assert.equal(shouldFit(800, 0), false);
  assert.equal(shouldFit(0, 600), false);
});

test("a negative measurement is refused rather than treated as a size", () => {
  assert.equal(shouldFit(-1, 600), false);
  assert.equal(shouldFit(800, -1), false);
});

test("a non-finite measurement is refused", () => {
  assert.equal(shouldFit(Number.NaN, 600), false);
  assert.equal(shouldFit(800, Number.NaN), false);
  assert.equal(shouldFit(Number.POSITIVE_INFINITY, 600), false);
  assert.equal(shouldFit(800, Number.POSITIVE_INFINITY), false);
});

test("a sub-pixel but real measurement is still a fit", () => {
  assert.equal(shouldFit(0.5, 0.5), true);
});

test("an ordinary terminal size is pushed to the pty", () => {
  assert.equal(shouldResizePty(80, 24), true);
  assert.equal(shouldResizePty(213, 51), true);
});

test("the fit addon's clamp floor is refused on either axis", () => {
  // @xterm/addon-fit 0.10.0 proposes Math.max(2, cols) / Math.max(1, rows),
  // so a container with no box still "fits" — to exactly this floor.
  assert.equal(shouldResizePty(2, 1), false);
  assert.equal(shouldResizePty(2, 51), false);
  assert.equal(shouldResizePty(213, 1), false);
});

test("dimensions below the clamp floor are refused too", () => {
  assert.equal(shouldResizePty(0, 0), false);
  assert.equal(shouldResizePty(1, 24), false);
  assert.equal(shouldResizePty(80, 0), false);
  assert.equal(shouldResizePty(-80, -24), false);
});

test("a fractional or non-finite dimension never reaches the pty", () => {
  assert.equal(shouldResizePty(80.5, 24), false);
  assert.equal(shouldResizePty(80, 24.5), false);
  assert.equal(shouldResizePty(Number.NaN, 24), false);
  assert.equal(shouldResizePty(80, Number.POSITIVE_INFINITY), false);
});

test("a dimension past the pty's u16 window size is refused, not truncated", () => {
  // cols/rows cross into Rust as u16 (vingilot_pty's pty_resize); anything
  // wider would wrap to a small number rather than error.
  assert.equal(shouldResizePty(65_536, 24), false);
  assert.equal(shouldResizePty(80, 65_536), false);
  assert.equal(shouldResizePty(65_535, 65_535), true);
});

test("a laid-out container with a real proposal is applied to both halves", () => {
  assert.deepEqual(resolveFit(1400, 760, { cols: 213, rows: 51 }), {
    cols: 213,
    rows: 51,
    type: "apply",
  });
});

test("a hidden container is refused whatever it proposes", () => {
  assert.deepEqual(resolveFit(0, 0, { cols: 213, rows: 51 }), {
    type: "refuse",
  });
  assert.deepEqual(resolveFit(0, 0, null), { type: "refuse" });
});

test("an on-screen container that has proposed nothing is a wait, not 80x24", () => {
  // The bug this exists for: an XTerm constructed inside a display:none
  // subtree has an unmeasured cell box, so addon-fit proposes nothing and
  // fit() silently no-ops — while term.cols/rows still read the constructor
  // default 80x24. Adopting those shrinks a live 213x51 shell.
  assert.deepEqual(resolveFit(1400, 760, null), { type: "wait" });
});

test("a proposal at the fit addon's clamp floor is refused, not waited on", () => {
  // A real-but-collapsed pane: measured, decided, and not worth having. The
  // caller must stop rather than spin on frames waiting for it to improve.
  assert.deepEqual(resolveFit(1400, 6, { cols: 213, rows: 1 }), {
    type: "refuse",
  });
  assert.deepEqual(resolveFit(4, 760, { cols: 2, rows: 51 }), {
    type: "refuse",
  });
});

test("a proposal past the pty's u16 window is refused", () => {
  assert.deepEqual(resolveFit(1400, 760, { cols: 65_536, rows: 51 }), {
    type: "refuse",
  });
});

test("a fractional proposal never reaches the pty", () => {
  assert.deepEqual(resolveFit(1400, 760, { cols: 213.5, rows: 51 }), {
    type: "refuse",
  });
});
