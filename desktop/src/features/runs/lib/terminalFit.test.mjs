import assert from "node:assert/strict";
import { test } from "node:test";
import {
  resolveFit,
  resolveFitAction,
  shouldFit,
  shouldResizePty,
} from "./terminalFit.ts";

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

const hidden = resolveFit(0, 0, null);
const unmeasured = resolveFit(1400, 760, null);
const measured = resolveFit(1400, 760, { cols: 213, rows: 51 });

test("a measured terminal with no session opens at the size it measured", () => {
  assert.deepEqual(resolveFitAction("unopened", measured), {
    cols: 213,
    rows: 51,
    type: "open",
  });
});

test("a measured terminal with a live session resizes it", () => {
  assert.deepEqual(resolveFitAction("open", measured), {
    cols: 213,
    rows: 51,
    type: "resize",
  });
});

test("a hidden terminal never opens a session", () => {
  // The defect this rule exists for: the version it replaced spawned a shell
  // at a placeholder 80x24 here, and under tmux that reshapes a session
  // restored from a previous app run — 213x51 down to 80x23 on tmux 3.6a,
  // re-wrapping the scrollback the owner came back for.
  assert.deepEqual(resolveFitAction("unopened", hidden), { type: "idle" });
});

test("a terminal whose cell box is unmeasured waits rather than opening", () => {
  assert.deepEqual(resolveFitAction("unopened", unmeasured), { type: "retry" });
});

test("no decision short of a measurement can open a session", () => {
  // Structural: `open` is reachable from exactly one decision type, so no
  // future branch can reintroduce an invented geometry.
  for (const phase of ["unopened", "opening", "open"]) {
    for (const decision of [hidden, unmeasured]) {
      assert.notEqual(resolveFitAction(phase, decision).type, "open");
    }
  }
});

test("an open already in flight is left alone", () => {
  // A second pty_open would race the first, and the geometry it would carry
  // is the one the first is already applying.
  assert.deepEqual(resolveFitAction("opening", measured), { type: "idle" });
  assert.deepEqual(resolveFitAction("opening", unmeasured), { type: "idle" });
});

test("a measurement that lands on the geometry the shell already has is not a resize", () => {
  // A drag of the pane divider remeasures on every pointermove; roughly half
  // of those land on the same column count as the frame before, and each one
  // that got through was a TIOCSWINSZ, a SIGWINCH and a full tmux redraw for
  // a shape that did not change.
  assert.deepEqual(
    resolveFitAction("open", measured, { cols: 213, rows: 51 }),
    {
      type: "idle",
    },
  );
  assert.deepEqual(
    resolveFitAction("open", measured, { cols: 212, rows: 51 }),
    {
      cols: 213,
      rows: 51,
      type: "resize",
    },
  );
  assert.deepEqual(
    resolveFitAction("open", measured, { cols: 213, rows: 50 }),
    {
      cols: 213,
      rows: 51,
      type: "resize",
    },
  );
  // Nothing has been given to this session yet, so nothing can be said to
  // match it — the first measurement after an open always reaches the shell.
  assert.deepEqual(resolveFitAction("open", measured, null), {
    cols: 213,
    rows: 51,
    type: "resize",
  });
});

test("a matching geometry never suppresses an open", () => {
  // The open is what tells the backend the session exists at all; a session
  // that has not been opened has no geometry to match against.
  assert.deepEqual(
    resolveFitAction("unopened", measured, { cols: 213, rows: 51 }),
    { cols: 213, rows: 51, type: "open" },
  );
});

test("a collapsed but measured pane is left alone rather than retried", () => {
  // Measured and decided: retrying would spin frames on a geometry that is
  // not going to improve on its own.
  const collapsed = resolveFit(1400, 6, { cols: 213, rows: 1 });
  assert.deepEqual(resolveFitAction("unopened", collapsed), { type: "idle" });
  assert.deepEqual(resolveFitAction("open", collapsed), { type: "idle" });
});
