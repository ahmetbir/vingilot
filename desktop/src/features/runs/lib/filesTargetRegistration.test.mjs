// `filesTarget.ts` ends with a doc comment claiming it is *"registered in
// `resetCommunityState()`"*. This is the test that makes the claim true.
//
// **Why a test that reads source as text.** The registration is a call in a
// list — `useCommunityInit.ts`'s `resetCommunityState()`, the one function that
// runs on a community change — and a list with no registration hook is exactly
// the shape that cannot fail: deleting the import and the call left `pnpm
// test`, `pnpm check`, `pnpm tsc --noEmit` and `check-seams.sh` all green, which
// is how the invariant came to be documented and unenforced in the first place.
// `check-seams.sh` validates that the PATH is declared, never that the call is
// still in it.
//
// The honest alternative — exporting the reset list as an array so membership
// could be asserted through the module system — is a change to the shape of an
// upstream function for a fork's benefit, and this island's seam into that file
// is deliberately *one import and one call* (`vingilot/seams.yaml`). So the
// assertion is made from this side of the seam instead, where a fork-owned test
// carries a fork-owned invariant and upstream's file keeps its shape.
//
// It is a coarse test and it knows it: it proves the call is written, not that
// it runs. What it catches is the only way this has ever broken — the call
// going missing while every gate stays green.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const INIT = fileURLToPath(
  new URL("../../communities/useCommunityInit.ts", import.meta.url),
);

/** The body of `resetCommunityState`, so a call that merely appears somewhere
 * else in the file — in a comment, in a different function — does not count as
 * a registration. */
function resetBody() {
  const source = readFileSync(INIT, "utf8");
  const start = source.indexOf("function resetCommunityState");
  assert.notEqual(
    start,
    -1,
    "useCommunityInit.ts no longer declares resetCommunityState() — the community-switch reset list has moved, and every reset registered in it needs re-checking, this one included",
  );
  const open = source.indexOf("{\n", source.indexOf(")", start));
  const end = source.indexOf("\n}", open);
  assert.notEqual(end, -1, "resetCommunityState()'s body did not close");
  return source.slice(open, end);
}

test("resetFileTargets is registered in resetCommunityState", () => {
  // The claim `filesTarget.ts`'s own doc comment makes. Without this, the
  // comment is a statement about a caller that nothing checks: a target naming
  // a worktree from the community just left would still be waiting when the
  // next community's Files pane mounts, and it would land on it.
  assert.match(
    resetBody(),
    /\bresetFileTargets\(\);/,
    "resetCommunityState() no longer calls resetFileTargets() — a file target filed against the community just left will be waiting for the next community's Files pane (see filesTarget.ts's closing comment and vingilot/seams.yaml)",
  );
});

test("the reset is imported from the module that owns it", () => {
  // A call to some other `resetFileTargets` would satisfy the test above while
  // resetting nothing this module holds.
  const source = readFileSync(INIT, "utf8");
  assert.match(
    source,
    /import \{ resetFileTargets \} from "@\/features\/runs\/lib\/filesTarget";/,
    "useCommunityInit.ts no longer imports resetFileTargets from @/features/runs/lib/filesTarget",
  );
});
