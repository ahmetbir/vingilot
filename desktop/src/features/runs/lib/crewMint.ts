// **Offered, never imposed** — when a workspace with no crew is asked whether
// it wants one, what the five rows say, what the Captain's rename does, and
// what the dialog is allowed to claim once the minting has run
// (vingilot/docs/plans/2026-08-12-the-crew.md, Task 2).
//
// **The whole decision is here and none of the machinery is.** Minting a
// managed agent is `managed_agents::create_managed_agent` — keys generated,
// record saved, nest regenerated — and this module cannot mint anything: it
// produces a plan, reads an outcome, and writes one sentence. `useCrewMint.ts`
// is what calls the bridge, which is why this file can be driven by a plain
// `node --test` with no DOM and no Tauri.
//
// **Three rules the surface must not be able to bend:**
//
// 1. **An unanswered list is not an empty one.** `crewOnDeck: null` means the
//    managed-agent list has not come back; it is *not* "this workspace has no
//    crew", and offering to mint five agents on the strength of a question
//    nobody has answered is how an app mints ten. `crewOffer` refuses on
//    `null` and says so.
// 1b. **The offer is what is missing, never all-or-nothing.** Community
//    onboarding seeds four of the roster itself (`welcomeGuide.ts`'s
//    `WELCOME_TEAM_STARTERS` — Navigator, Bosun, Lookout, Scribe), and it
//    deliberately never mints Mate. An offer that refused the moment *one*
//    crew member existed would therefore never fire on the primary install
//    path, and the First Mate — the one member this dialog is the only door
//    to — would be unreachable on every machine that ever opened a Welcome
//    channel. So `crewOffer` subtracts: it offers the members this workspace
//    does not have, and refuses only when there are none. "Nothing nags" is
//    kept by the decline, which is remembered, not by asking once.
// 2. **A decline is remembered and nothing nags.** Once declined the offer is
//    hidden for good — the storage half is `crewMintStore.ts`, and the reason
//    it is a separate module is that this one is pure.
// 3. **Minting is local, so the sentence afterwards must be too.** The relay
//    is Phase 4 of the create command and its failure comes back as
//    `profileSyncError` beside a *created* agent — the crew exists, the keys
//    are on this machine, the nest is written. `mintSentence` says exactly
//    that and never spins: "will join the thread when there is one" is a fact
//    about a record on disk, not a promise about a socket.
//
// Pure: no React, no Tauri, no storage.

import type { CrewBerth, CrewMember } from "./crewRoster.ts";

/** One row of the dialog: a crew member, the name the Captain has typed for
 * it, and whether it is being minted. */
export interface CrewMintRow {
  personaId: string;
  /** The persona's own name — what an emptied field falls back to, and what
   * the row is still called if he never touches it. */
  defaultName: string;
  job: string;
  berth: CrewBerth;
  /** What is in the text field, **verbatim** — leading spaces and all. Trimming
   * as he types would move his cursor; the trim happens once, in `mintName`,
   * at the moment the name is used for something. */
  name: string;
  /** Default on, per the plan: the offer is the whole crew, and unchecking is
   * the Captain's edit rather than his assembly job. */
  mint: boolean;
}

/** One row per crew member handed over — which is the *missing* ones, not the
 * whole roster: see rule 1b in this file's header. */
export function crewMintRows(
  crew: readonly CrewMember[],
): readonly CrewMintRow[] {
  return crew.map((member) => ({
    berth: member.berth,
    defaultName: member.name,
    job: member.job,
    mint: true,
    name: member.name,
    personaId: member.personaId,
  }));
}

/** The name a row will actually be minted under: what he typed, trimmed, or
 * the persona's own name when he has left the field empty.
 *
 * **An emptied field is not a nameless agent.** `create_managed_agent` refuses
 * an empty name outright ("agent name is required"), so a dialog that passed
 * one through would turn a blank field into a failed mint with a backend error
 * in it. The persona's name is the honest fallback: the persona is the job,
 * and the job is what he did not rename. */
export function mintName(row: CrewMintRow): string {
  const typed = row.name.trim();
  return typed === "" ? row.defaultName : typed;
}

/** Replace one row's name. Every row is returned, so the caller's array
 * identity changes exactly when something did. */
export function withMintName(
  rows: readonly CrewMintRow[],
  personaId: string,
  name: string,
): readonly CrewMintRow[] {
  return rows.map((row) =>
    row.personaId === personaId && row.name !== name ? { ...row, name } : row,
  );
}

/** Check or uncheck one row. */
export function withMintChecked(
  rows: readonly CrewMintRow[],
  personaId: string,
  mint: boolean,
): readonly CrewMintRow[] {
  return rows.map((row) =>
    row.personaId === personaId && row.mint !== mint ? { ...row, mint } : row,
  );
}

/** One agent to mint: the persona to bind it to, the name the Captain settled
 * on, and the berth that decides whether it joins the crew team or stays an
 * owner-only DM. */
export interface CrewMintRequest {
  personaId: string;
  name: string;
  berth: CrewBerth;
}

/** What the dialog's button will actually do, in row order. Unchecked rows are
 * absent rather than carried with a flag: a request list that still held them
 * would need every consumer to re-apply the same filter, and one that forgot
 * would mint what he unchecked. */
export function crewMintPlan(
  rows: readonly CrewMintRow[],
): readonly CrewMintRequest[] {
  return rows
    .filter((row) => row.mint)
    .map((row) => ({
      berth: row.berth,
      name: mintName(row),
      personaId: row.personaId,
    }));
}

/** Whether the offer is on screen — and, when it is, *who it is an offer of*;
 * when it is not, the sentence saying why. The reason is not drawn anywhere; it
 * is here so a test can state which of the rules refused, rather than asserting
 * `false` and believing it for the wrong reason. */
export type CrewOffer =
  | { show: true; missing: readonly CrewMember[] }
  | { show: false; because: string };

export interface CrewOfferInput {
  /** The roster this workspace could have. */
  crew: readonly CrewMember[];
  /** The persona ids of crew members this workspace already has a managed
   * agent for, or **`null` while the list has not answered**. The distinction
   * is rule 1 in this file's header and it is the one that matters. */
  crewOnDeck: readonly string[] | null;
  /** Whether the Captain has already said no. */
  declined: boolean;
}

export function crewOffer({
  crew,
  crewOnDeck,
  declined,
}: CrewOfferInput): CrewOffer {
  if (crewOnDeck === null) {
    return {
      because: "the managed-agent list has not answered yet.",
      show: false,
    };
  }
  if (declined) {
    return {
      because: "the Captain declined the crew, and nothing asks twice.",
      show: false,
    };
  }
  const aboard = new Set(crewOnDeck);
  const missing = crew.filter((member) => !aboard.has(member.personaId));
  if (missing.length === 0) {
    return {
      because: "every one of the crew is already aboard.",
      show: false,
    };
  }
  return { missing, show: true };
}

/** Which of the roster this workspace already has, by persona id. Agents whose
 * persona is not crew — the bees, anything he wrote himself — are not counted,
 * because the question this answers is "does the crew exist", not "are there
 * any agents". */
export function crewOnDeck(
  crew: readonly CrewMember[],
  agents: readonly { personaId: string | null }[],
): readonly string[] {
  const roster = new Set(crew.map((member) => member.personaId));
  const found = new Set<string>();
  for (const agent of agents) {
    if (agent.personaId !== null && roster.has(agent.personaId)) {
      found.add(agent.personaId);
    }
  }
  return [...found];
}

/** What one attempted mint came back as. `offRelay` is the create command's
 * `profileSyncError` — an agent that exists locally whose profile could not be
 * published — and it is deliberately not a failure: the record is on disk and
 * the keys are minted. */
export interface CrewMintResult {
  name: string;
  /** The refusal, or `null` when the agent was created. */
  error: string | null;
  offRelay: boolean;
}

/** What the dialog says once the button has run. One sentence, and every clause
 * in it is a fact somebody can check against `~/.vingilot` or the agents list.
 *
 * **The relay clause is the whole point of this function.** A crew minted with
 * no coordinator and no reachable relay is a complete crew: `Keys::generate` is
 * local, the record is local, `try_regenerate_nest` is local, and only Phase 4's
 * profile publish needs a socket. So the sentence says the crew exists and says
 * what has not happened yet — rather than showing a spinner over work that is
 * already done, which is the failure the plan names by name. */
export function mintSentence(results: readonly CrewMintResult[]): string {
  const made = results.filter((result) => result.error === null);
  const failed = results.filter((result) => result.error !== null);
  if (made.length === 0) {
    if (failed.length === 0) return "Nothing was minted — no crew was chosen.";
    return `No crew could be minted. ${failed[0]?.error ?? ""}`.trim();
  }

  const names = made.map((result) => result.name).join(", ");
  const head = `${names} ${made.length === 1 ? "is" : "are"} aboard — keys minted on this machine, nothing sent anywhere.`;
  const offRelay = made.some((result) => result.offRelay)
    ? " No relay answered, so their profiles are not published yet; they will join the thread when there is one."
    : "";
  const short =
    failed.length === 0
      ? ""
      : ` ${failed.length} could not be minted: ${failed.map((result) => `${result.name} — ${result.error ?? ""}`).join("; ")}.`;
  return `${head}${offRelay}${short}`;
}

/** The runtime a crew member should be minted on, as a *preference* handed to
 * `resolveStartRuntimeForDefinition` — which puts it first in line, ahead of
 * upstream's buzz-agent-first default.
 *
 * **Why the crew does not take upstream's default.** Crew personas carry no
 * runtime of their own, and for a runtime-less persona upstream prefers the
 * bundled `buzz-agent` sidecar — a deliberately minimal ACP agent, the right
 * default for a persona someone is trying out and exactly the wrong one for a
 * crew whose whole promise is real work. The first Mate minted under that
 * default answered every question with "yo", because that is what the stub
 * does. The crew prefers a real harness:
 *
 *   1. the owner's own preferred runtime, when it is set, available, and not
 *      the stub — his configuration outranks our taste;
 *   2. `claude`, the harness this product is built around;
 *   3. any other available runtime that is not the stub — an installed goose
 *      or codex beats an echo;
 *   4. `null`, which hands the decision back to upstream's default (the stub,
 *      when it is truly all there is — a crew member that says "yo" is still
 *      a key and a mailbox, and refusing to mint would cost the offer).
 */
export function crewPreferredRuntime(
  runtimes: readonly { id: string; availability: string }[],
  ownerPreferred: string | null | undefined,
): string | null {
  const available = runtimes.filter(
    (runtime) => runtime.availability === "available",
  );
  const has = (id: string) => available.some((runtime) => runtime.id === id);
  if (
    ownerPreferred != null &&
    ownerPreferred !== "buzz-agent" &&
    has(ownerPreferred)
  ) {
    return ownerPreferred;
  }
  if (has("claude")) return "claude";
  const real = available.find((runtime) => runtime.id !== "buzz-agent");
  return real?.id ?? null;
}
