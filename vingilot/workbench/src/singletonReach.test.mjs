import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { reachableSingletons } from "../scripts/check-singleton-reach.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

test("every reachable community singleton is enumerated", async () => {
  const reached = await reachableSingletons(path.join(here, "SpikeHarness.tsx"));
  assert.ok(Array.isArray(reached));
  // Not an assertion of emptiness: this records the surface for the report.
  // Task 6 decides whether the count is acceptable.
  console.log(`reachable community singletons: ${reached.length}`);
  for (const name of reached) console.log("  " + name);
});
