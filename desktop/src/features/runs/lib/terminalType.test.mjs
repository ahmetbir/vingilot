import assert from "node:assert/strict";
import { test } from "node:test";

import {
  fileTerminalType,
  takeTerminalType,
  TYPE_TTL_MS,
} from "./terminalType.ts";

test("mail is delivered once, to its own session only", () => {
  fileTerminalType("wt#4", "pnpm dev\n", 1000);
  assert.equal(takeTerminalType("wt#5", 1001), null);
  assert.equal(takeTerminalType("wt#4", 1001), "pnpm dev\n");
  assert.equal(takeTerminalType("wt#4", 1002), null);
});

test("a second filing replaces the first — two presses, one intent", () => {
  fileTerminalType("wt#6", "old\n", 1000);
  fileTerminalType("wt#6", "new\n", 1001);
  assert.equal(takeTerminalType("wt#6", 1002), "new\n");
});

test("stale mail is dropped, never typed into a reused ordinal", () => {
  fileTerminalType("wt#7", "pnpm dev\n", 1000);
  assert.equal(takeTerminalType("wt#7", 1000 + TYPE_TTL_MS + 1), null);
  // And dropped for good — not merely refused this read.
  assert.equal(takeTerminalType("wt#7", 1001), null);
});
