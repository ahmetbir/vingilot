// The mint offer's four promises, pinned: when it is shown, what a rename
// does, that a decline is remembered, and that the sentence afterwards says
// what actually happened (vingilot/docs/plans/2026-08-12-the-crew.md, Task 2).
//
// The roster is asserted against `welcomeGuide.ts`'s starter list here rather
// than in that file's own test, because this is the module that adds Mate to
// it — the two lists are one list with one deliberate difference, and this is
// where the difference is stated.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  crewMintPlan,
  crewMintRows,
  crewOffer,
  crewOnDeck,
  mintName,
  mintSentence,
  withMintChecked,
  withMintName,
} from "./crewMint.ts";
import { CREW, CREW_TEAM_ID, crewMember } from "./crewRoster.ts";
import { crewOfferDeclined, declineCrewOffer } from "./crewMintStore.ts";

function memoryStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

// ── The roster ───────────────────────────────────────────────────────────────

test("the roster is five, and exactly one of them is the owner-only DM", () => {
  assert.equal(CREW.length, 5);
  const dm = CREW.filter((member) => member.berth === "dm");
  assert.deepEqual(
    dm.map((member) => member.personaId),
    ["builtin:mate"],
  );
});

test("the roster's persona ids are the built-in catalog's, and the team is the Rust-seeded one", () => {
  assert.deepEqual(
    CREW.map((member) => member.personaId),
    [
      "builtin:mate",
      "builtin:navigator",
      "builtin:bosun",
      "builtin:lookout",
      "builtin:scribe",
    ],
  );
  assert.equal(CREW_TEAM_ID, "builtin-team:crew");
});

test("crewMember: a bee is not crew, and neither is a null persona", () => {
  assert.equal(crewMember("builtin:fizz"), null);
  assert.equal(crewMember(null), null);
  assert.equal(crewMember("builtin:lookout")?.name, "Lookout");
});

// ── Whether the offer is shown at all ────────────────────────────────────────

test("crewOffer: a list that has not answered is not an empty one", () => {
  const offer = crewOffer({ crew: CREW, crewOnDeck: null, declined: false });
  assert.equal(offer.show, false);
  assert.match(offer.because, /has not answered/);
});

test("crewOffer: a workspace with no crew and no decline is offered the whole roster", () => {
  const offer = crewOffer({ crew: CREW, crewOnDeck: [], declined: false });
  assert.equal(offer.show, true);
  assert.deepEqual(offer.missing, CREW);
});

test("crewOffer: a remembered decline hides it, and says so", () => {
  const offer = crewOffer({ crew: CREW, crewOnDeck: [], declined: true });
  assert.equal(offer.show, false);
  assert.match(offer.because, /declined/);
});

// The one that matters on the primary install path: community onboarding
// (`welcomeGuide.ts`'s `WELCOME_TEAM_STARTERS`) mints these four itself and
// deliberately never mints Mate, and this dialog is the only surface that
// does. An offer that refused because *something* was aboard would leave the
// First Mate unreachable on every machine that ever opened a Welcome channel.
test("crewOffer: onboarding's four aboard and Mate absent — the offer is exactly that one row", () => {
  const offer = crewOffer({
    crew: CREW,
    crewOnDeck: [
      "builtin:navigator",
      "builtin:bosun",
      "builtin:lookout",
      "builtin:scribe",
    ],
    declined: false,
  });
  assert.equal(offer.show, true);
  assert.deepEqual(
    offer.missing.map((member) => member.personaId),
    ["builtin:mate"],
  );
  const rows = crewMintRows(offer.missing);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].defaultName, "Mate");
});

test("crewOffer: one aboard is not enough to stop asking — the other four still are the offer", () => {
  const offer = crewOffer({
    crew: CREW,
    crewOnDeck: ["builtin:scribe"],
    declined: false,
  });
  assert.equal(offer.show, true);
  assert.equal(offer.missing.length, 4);
  assert.equal(
    offer.missing.some((member) => member.personaId === "builtin:scribe"),
    false,
  );
});

test("crewOffer: the whole crew aboard is what stops the asking", () => {
  const offer = crewOffer({
    crew: CREW,
    crewOnDeck: CREW.map((member) => member.personaId),
    declined: false,
  });
  assert.equal(offer.show, false);
  assert.match(offer.because, /already aboard/);
});

test("crewOnDeck: bees and hand-written agents are not crew", () => {
  assert.deepEqual(
    crewOnDeck(CREW, [
      { personaId: "builtin:fizz" },
      { personaId: null },
      { personaId: "some-persona-he-wrote" },
    ]),
    [],
  );
});

test("crewOnDeck: two instances of one persona count once", () => {
  assert.deepEqual(
    crewOnDeck(CREW, [
      { personaId: "builtin:bosun" },
      { personaId: "builtin:bosun" },
    ]),
    ["builtin:bosun"],
  );
});

// ── The rows, and the rename ─────────────────────────────────────────────────

test("crewMintRows: five rows, all ticked, each starting on the persona's own name", () => {
  const rows = crewMintRows(CREW);
  assert.equal(rows.length, 5);
  assert.ok(rows.every((row) => row.mint));
  assert.ok(rows.every((row) => row.name === row.defaultName));
});

test("withMintName: the rename lands on one row and nothing else moves", () => {
  const rows = crewMintRows(CREW);
  const renamed = withMintName(rows, "builtin:lookout", "Watch");
  assert.equal(
    renamed.find((row) => row.personaId === "builtin:lookout")?.name,
    "Watch",
  );
  assert.equal(
    renamed.find((row) => row.personaId === "builtin:bosun"),
    rows.find((row) => row.personaId === "builtin:bosun"),
  );
});

test("mintName: the rename is applied, trimmed", () => {
  const rows = withMintName(crewMintRows(CREW), "builtin:mate", "  Nabi  ");
  const mate = rows.find((row) => row.personaId === "builtin:mate");
  assert.equal(mate.name, "  Nabi  ", "the field keeps what he typed");
  assert.equal(mintName(mate), "Nabi");
});

test("mintName: an emptied field falls back to the persona's name, never to nothing", () => {
  const rows = withMintName(crewMintRows(CREW), "builtin:scribe", "   ");
  const scribe = rows.find((row) => row.personaId === "builtin:scribe");
  assert.equal(mintName(scribe), "Scribe");
});

test("crewMintPlan: an unticked row is absent from the plan, and the rename is in it", () => {
  const rows = withMintChecked(
    withMintName(crewMintRows(CREW), "builtin:navigator", "Pilot"),
    "builtin:bosun",
    false,
  );
  const plan = crewMintPlan(rows);
  assert.equal(plan.length, 4);
  assert.equal(
    plan.some((request) => request.personaId === "builtin:bosun"),
    false,
  );
  assert.equal(
    plan.find((request) => request.personaId === "builtin:navigator")?.name,
    "Pilot",
  );
});

test("crewMintPlan: the berth rides along, because it is the one field it decides", () => {
  const plan = crewMintPlan(crewMintRows(CREW));
  assert.equal(
    plan.find((request) => request.personaId === "builtin:mate")?.berth,
    "dm",
  );
  assert.ok(
    plan
      .filter((request) => request.personaId !== "builtin:mate")
      .every((request) => request.berth === "thread"),
  );
});

// ── The decline, remembered ──────────────────────────────────────────────────

test("declineCrewOffer: a decline survives into the next read", () => {
  const storage = memoryStorage();
  assert.equal(crewOfferDeclined(storage), false);
  declineCrewOffer(storage);
  assert.equal(crewOfferDeclined(storage), true);
});

test("crewOfferDeclined: storage that throws reads as 'not declined', so the offer is asked rather than lost", () => {
  const broken = {
    getItem: () => {
      throw new Error("no storage");
    },
    setItem: () => {
      throw new Error("no storage");
    },
  };
  assert.equal(crewOfferDeclined(broken), false);
  assert.doesNotThrow(() => declineCrewOffer(broken));
});

test("crewOfferDeclined: a value from some other build is not a decline", () => {
  assert.equal(
    crewOfferDeclined(memoryStorage({ "vingilot-crew-offer.v1": "yes" })),
    false,
  );
});

// ── What the dialog is allowed to claim afterwards ───────────────────────────

test("mintSentence: names who is aboard and says the keys are local", () => {
  const said = mintSentence([
    { name: "Mate", error: null, offRelay: false },
    { name: "Lookout", error: null, offRelay: false },
  ]);
  assert.match(said, /Mate, Lookout are aboard/);
  assert.match(said, /keys minted on this machine/);
  assert.match(said, /nothing sent anywhere/);
  assert.doesNotMatch(said, /relay/i);
});

test("mintSentence: an unreachable relay is an honest clause, not a failure", () => {
  const said = mintSentence([{ name: "Bosun", error: null, offRelay: true }]);
  assert.match(said, /Bosun is aboard/);
  assert.match(said, /No relay answered/);
  assert.match(said, /join the thread when there is one/);
  assert.doesNotMatch(said, /could not be minted/);
});

test("mintSentence: a partial failure names both halves", () => {
  const said = mintSentence([
    { name: "Navigator", error: null, offRelay: false },
    { name: "Scribe", error: "No available runtime found.", offRelay: false },
  ]);
  assert.match(said, /Navigator is aboard/);
  assert.match(said, /1 could not be minted: Scribe — No available runtime/);
});

test("mintSentence: nothing minted at all does not claim a crew", () => {
  assert.match(
    mintSentence([{ name: "Mate", error: "keyring locked", offRelay: false }]),
    /No crew could be minted\. keyring locked/,
  );
  assert.match(mintSentence([]), /Nothing was minted/);
});
