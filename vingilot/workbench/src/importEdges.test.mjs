import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { forbiddenEdges } from "../scripts/check-import-edges.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

test("the harness reaches no upstream app shell module", async () => {
  const violations = await forbiddenEdges(path.join(here, "SpikeHarness.tsx"));
  assert.deepEqual(violations, []);
});

test("a deliberate app-shell import is detected", async () => {
  const violations = await forbiddenEdges(
    path.join(here, "fixtures", "__edgeProbe.tsx"),
  );
  assert.ok(
    violations.length > 0,
    "guard failed to detect a known-bad import — it would pass anything",
  );
});
