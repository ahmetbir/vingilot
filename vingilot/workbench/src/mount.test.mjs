import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { walk } from "../scripts/import-graph.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

test("the harness reaches the upstream message timeline", async () => {
  const reached = await walk(path.join(here, "SpikeHarness.tsx"));
  const hit = [...reached].some((f) =>
    f.endsWith(path.join("features", "messages", "ui", "MessageTimeline.tsx")),
  );
  assert.ok(hit, "harness does not import MessageTimeline — nothing is being spiked");
});
