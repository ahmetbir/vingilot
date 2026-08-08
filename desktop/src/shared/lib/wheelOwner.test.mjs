import assert from "node:assert/strict";
import { test } from "node:test";

import {
  WHEEL_OWNER_ATTRIBUTE,
  pathOwnsTheWheel,
  wheelOwnerProps,
} from "./wheelOwner.ts";

/** An element carrying the attributes `wheelOwnerProps` would put on it. */
const claiming = (props) => ({
  hasAttribute: (name) => Object.hasOwn(props, name),
});
const plain = { hasAttribute: () => false };

test("an empty path owns nothing", () => {
  assert.equal(pathOwnsTheWheel([]), false);
});

test("a path of ordinary elements owns nothing", () => {
  assert.equal(pathOwnsTheWheel([plain, plain, plain]), false);
});

test("the element under the pointer can be the owner", () => {
  assert.equal(pathOwnsTheWheel([claiming(wheelOwnerProps), plain]), true);
});

test("so can an ancestor — the terminal marks the container xterm mounts into, and the pointer is over a row inside it", () => {
  assert.equal(
    pathOwnsTheWheel([plain, plain, claiming(wheelOwnerProps), plain]),
    true,
  );
});

test("the props and the attribute the lock looks for cannot drift apart", () => {
  assert.deepEqual(Object.keys(wheelOwnerProps), [WHEEL_OWNER_ATTRIBUTE]);
});

test("a different data attribute is not a claim", () => {
  assert.equal(
    pathOwnsTheWheel([claiming({ "data-buzz-conversation-scroll": "" })]),
    false,
  );
});

test("the non-element tail of a composed path is not an owner and does not throw", () => {
  // `composedPath()` ends with `document` and `window`, neither of which has
  // `hasAttribute` at all.
  assert.equal(pathOwnsTheWheel([plain, {}, { hasAttribute: null }]), false);
});
