import assert from "node:assert/strict";
import { test } from "node:test";

import { firstRegistered, physicalToClient } from "./nativeDrop.ts";

test("physical pixels are divided by the device pixel ratio", () => {
  // A drop at physical (800, 600) on a 2x screen is over the CSS point
  // (400, 300); skipping this puts every Retina drop in the wrong quadrant.
  assert.deepEqual(physicalToClient({ x: 800, y: 600 }, 2), { x: 400, y: 300 });
});

test("a 1x screen is a pass-through", () => {
  assert.deepEqual(physicalToClient({ x: 640, y: 480 }, 1), { x: 640, y: 480 });
});

test("a fractional ratio scales both axes", () => {
  assert.deepEqual(physicalToClient({ x: 300, y: 150 }, 1.5), {
    x: 200,
    y: 100,
  });
});

test("a nonsense ratio falls back to 1:1 rather than dividing by zero", () => {
  assert.deepEqual(physicalToClient({ x: 10, y: 20 }, 0), { x: 10, y: 20 });
  assert.deepEqual(physicalToClient({ x: 10, y: 20 }, -2), { x: 10, y: 20 });
});

test("the nearest registered ancestor owns the drop", () => {
  // The hit element is not itself a zone; its parent is. The walk from the
  // cursor outward stops at the first owner.
  const terminal = { id: "terminal" };
  const child = { id: "xterm-row" };
  const registered = new Set([terminal]);
  assert.equal(
    firstRegistered([child, terminal, { id: "app" }], registered),
    terminal,
  );
});

test("the innermost of two nested zones wins", () => {
  // Chain is nearest-first, so an inner zone shadows an outer one it sits in.
  const inner = { id: "inner" };
  const outer = { id: "outer" };
  const registered = new Set([inner, outer]);
  assert.equal(firstRegistered([inner, outer], registered), inner);
});

test("a drop over no zone routes to nobody", () => {
  const registered = new Set([{ id: "terminal" }]);
  assert.equal(firstRegistered([{ id: "elsewhere" }], registered), null);
});
