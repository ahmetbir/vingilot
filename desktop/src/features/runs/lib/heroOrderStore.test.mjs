import assert from "node:assert/strict";
import { test } from "node:test";

import {
  parseHeroOrder,
  readHeroOrder,
  writeHeroOrder,
} from "./heroOrderStore.ts";

function fakeStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

test("an order round-trips", () => {
  const storage = fakeStorage();
  writeHeroOrder(["a", "b"], storage);
  assert.deepEqual(readHeroOrder(storage), ["a", "b"]);
});

test("malformed or hand-edited storage reads as no order, never half of one", () => {
  for (const raw of ["not json", "{}", "[1, 2]", '["a", "", "a", 3]']) {
    const order = parseHeroOrder(raw);
    assert.ok(order.every((id) => typeof id === "string" && id !== ""));
    assert.equal(new Set(order).size, order.length);
  }
  assert.deepEqual(parseHeroOrder('["a", "", "a", 3]'), ["a"]);
});

test("storage that throws is no order, not a broken workspace", () => {
  const hostile = {
    getItem: () => {
      throw new Error("private mode");
    },
    setItem: () => {
      throw new Error("quota");
    },
  };
  assert.deepEqual(readHeroOrder(hostile), []);
  writeHeroOrder(["a"], hostile);
});
