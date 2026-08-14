import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveAccordionOpen } from "./SidebarAccordionSection.tsx";

// The single-open rule (pane-nav-absorb plan, Task 1). The DOM half — the
// collapsed body staying mounted, `aria-expanded` on the header — is held by
// `sidebar-deck-accordion.spec.ts` against a real render; what this file pins
// is the decision, which must never yield zero or two open members.

describe("resolveAccordionOpen", () => {
  it("opens a collapsed member", () => {
    assert.equal(resolveAccordionOpen("worktrees", "files"), "files");
  });

  it("keeps exactly one member open when the open header is clicked again", () => {
    assert.equal(resolveAccordionOpen("files", "files"), "files");
  });

  it("moves between the other members without ever passing through none", () => {
    let open = "worktrees";
    for (const clicked of ["files", "history", "chats", "worktrees"]) {
      open = resolveAccordionOpen(open, clicked);
      assert.equal(open, clicked);
      assert.notEqual(open, "");
    }
  });
});
