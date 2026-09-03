import assert from "node:assert/strict";
import { test } from "node:test";

import { reportContext } from "./feedbackContext.ts";

test("a report carries where he was, the window, and the build", () => {
  const ctx = reportContext(
    {
      innerHeight: 900,
      innerWidth: 1700,
      location: { hash: "#/workspace", pathname: "/" },
      navigator: { platform: "MacIntel" },
    },
    "1.3.0",
  );
  assert.deepEqual(ctx, {
    platform: "MacIntel",
    route: "#/workspace",
    version: "1.3.0",
    viewport: "1700x900",
  });
});

test("with no hash the path stands in for the route", () => {
  const ctx = reportContext(
    {
      innerHeight: 1,
      innerWidth: 1,
      location: { hash: "", pathname: "/settings" },
      navigator: { platform: "x" },
    },
    "v",
  );
  assert.equal(ctx.route, "/settings");
});
