import assert from "node:assert/strict";
import test from "node:test";

import { personaDeleteDescription } from "./PersonaDeleteDialog.tsx";

// Regression guard for the persona-cascade consent copy: deleting a persona
// with instances also archives each instance's identity on the relay
// (NIP-IA 9035), a durable externally visible side effect. The confirmation
// dialog must disclose it before the destructive confirm, exactly like the
// direct agent-delete dialog does.

const persona = { displayName: "Scout" };

test("cascade delete discloses relay archival (plural)", () => {
  const copy = personaDeleteDescription(persona, 3);
  assert.match(copy, /deletes 3 agent instances/);
  assert.match(copy, /archives their identities on the relay/);
});

test("cascade delete discloses relay archival (singular)", () => {
  const copy = personaDeleteDescription(persona, 1);
  assert.match(copy, /deletes 1 agent instance /);
  assert.match(copy, /archives its identity on the relay/);
});

test("no instances → no archival claim (nothing is archived)", () => {
  const copy = personaDeleteDescription(persona, 0);
  assert.equal(copy, "Delete Scout.");
  assert.doesNotMatch(copy, /archiv/i);
});

test("null persona keeps the generic fallback", () => {
  assert.equal(personaDeleteDescription(null, 2), "Delete this agent.");
});

// ── Built-ins: removed, not deleted ──────────────────────────────────────────
//
// Delete on a built-in used to route to persona deactivation, which the
// backend refuses while a managed agent references it — the owner hit the
// cryptic "still assigned" error trying to remove a crew member. It now opens
// this dialog, so the copy has to say what the one gesture actually does:
// takes the agents, keeps the persona, and lets the crew offer ask again.

const builtIn = { displayName: "Bosun", isBuiltIn: true };

test("a built-in with agents names the cascade and promises the catalog keeps it", () => {
  const copy = personaDeleteDescription(builtIn, 2);
  assert.match(copy, /Remove Bosun and its 2 agents\?/);
  assert.match(copy, /The persona stays in the catalog/);
  assert.match(copy, /the crew offer can mint it again/);
  // Removing a built-in is not deleting it — the word would over-claim.
  assert.doesNotMatch(copy, /^Delete/);
});

test("a built-in with agents still discloses relay archival", () => {
  // The instances really are deleted and really are archived; a built-in
  // must not lose the disclosure a custom persona gets.
  assert.match(
    personaDeleteDescription(builtIn, 2),
    /identities are archived on the relay/,
  );
  assert.match(
    personaDeleteDescription(builtIn, 1),
    /identity is archived on the relay/,
  );
});

test("a built-in's agent count is singular at one", () => {
  const copy = personaDeleteDescription(builtIn, 1);
  assert.match(copy, /Remove Bosun and its 1 agent\?/);
  assert.doesNotMatch(copy, /1 agents/);
});

test("a built-in with no agents claims no cascade", () => {
  const copy = personaDeleteDescription(builtIn, 0);
  assert.equal(
    copy,
    "Remove Bosun from My Agents. The persona stays in the catalog; the crew offer can mint it again.",
  );
  assert.doesNotMatch(copy, /archiv/i);
});

test("a custom persona's copy is untouched by the built-in branch", () => {
  // The regression guard above is the contract for customs; this asserts the
  // new branch did not widen to them.
  const copy = personaDeleteDescription({ displayName: "Scout" }, 2);
  assert.match(copy, /^Delete Scout\./);
  assert.doesNotMatch(copy, /stays in the catalog/);
});
