// **The crew, as the frontend needs it** — five names, five jobs, and the one
// fact that separates Mate from the other four
// (vingilot/docs/plans/2026-08-12-the-crew.md; the roster table there is this
// file's source, and the prompts themselves are the persona pack in
// vingilot/personas/vingilot-crew/).
//
// **This is a list of names, not a second catalog.** What a crew member *is* —
// its prompt, its scope, its refusals — lives in the pack and reaches the app
// through `managed_agents::personas`, which is the only catalog there is. What
// is written down here is the small amount a *surface* needs and the catalog
// does not carry: which berth a member has, and one line saying what it does,
// so a dialog offering to mint five agents can say what each one is for without
// printing a system prompt at him.
//
// **The persona ids are the contract**, and they are the same five strings the
// Rust module states (`vingilot_crew::MATE_ID` and its siblings) and the mock
// bridge mirrors. A test beside this file pins them against
// `welcomeGuide.ts`'s starters, which is the other frontend list of the same
// personas — the two cannot drift without failing.
//
// Pure: no React, no Tauri, no storage.

/** Where a crew member lives.
 *
 * - `thread` — a member of the worktree's team thread, minted into
 *   `builtin-team:crew` the way the welcome bootstrap already mints them.
 * - `dm` — an owner-only direct message and never a channel member. Mate, and
 *   only Mate: the assistant plan's identity decision
 *   (vingilot/docs/plans/2026-08-09-the-assistant.md) makes the First Mate a
 *   conversation between the Captain and the ship, so putting it in a room
 *   with four other agents would reverse that decision silently. It is a
 *   `berth` rather than a boolean because the two are read as *places* by both
 *   surfaces that consume this file, and "isDm" would read as a property of the
 *   agent rather than of where it is reachable. */
export type CrewBerth = "thread" | "dm";

export interface CrewMember {
  /** The built-in persona id — `managed_agents::personas`' own. */
  personaId: string;
  /** The default name, which is the persona's display name. The Captain can
   * replace it at mint time: the persona is the job, the name is his. */
  name: string;
  /** One line saying what this member is for, in the mint dialog's second row.
   * Deliberately short — the prompt is the real answer and it is in the repo. */
  job: string;
  berth: CrewBerth;
}

/** The roster, in the order the mint dialog lists it: Mate first because it is
 * the one that is not like the others, then the four who share the thread in
 * `WELCOME_TEAM_STARTERS`' own order. */
export const CREW: readonly CrewMember[] = [
  {
    berth: "dm",
    job: "the First Mate — knows the whole ship, answers in a direct message meant only for you",
    name: "Mate",
    personaId: "builtin:mate",
  },
  {
    berth: "thread",
    job: "plots the course — turns what you want into a plan with the risks named",
    name: "Navigator",
    personaId: "builtin:navigator",
  },
  {
    berth: "thread",
    job: "keeps the ship running — builds, toolchains, CI, the smallest fix that compiles",
    name: "Bosun",
    personaId: "builtin:bosun",
  },
  {
    berth: "thread",
    job: "sees trouble first — reviews diffs and names risks, and never edits",
    name: "Lookout",
    personaId: "builtin:lookout",
  },
  {
    berth: "thread",
    job: "writes the log — summaries, docs, changelogs, and says so when there is nothing to read",
    name: "Scribe",
    personaId: "builtin:scribe",
  },
];

/** The team the thread-berth crew are minted into — the Rust-seeded built-in
 * (`managed_agents::teams`' `builtin-team:crew`). Stated here rather than
 * imported from `welcomeGuide.ts` for the reason every pure module in this
 * island states its own constants: that file reaches the Tauri bridge at import
 * time and a `node --test` run cannot load it. The test beside this one asserts
 * the two strings are the same. */
export const CREW_TEAM_ID = "builtin-team:crew";

/** The roster member for a persona id, or `null` for a persona that is not
 * crew. `null` is the answer for every bee and every persona the Captain wrote
 * himself, which is why callers get a lookup rather than an assertion. */
export function crewMember(personaId: string | null): CrewMember | null {
  if (personaId === null) return null;
  return CREW.find((member) => member.personaId === personaId) ?? null;
}
