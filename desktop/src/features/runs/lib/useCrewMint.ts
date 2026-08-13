// The offer, wired: what the workspace asks once, and the calls that make a
// crew out of a yes (vingilot/docs/plans/2026-08-12-the-crew.md, Task 2).
//
// **The offer is what this workspace is missing**, which on the primary install
// path is not the whole roster: community onboarding provisions four of the
// five itself and never provisions Mate. `crewOffer` subtracts (rule 1b in
// `crewMint.ts`), so the rows below can be one row or five.
//
// **Every call below already exists.** Persona activation is
// `setPersonaActive`, the definition→instance mapping is
// `buildInstanceInputForDefinition` (the one place that mapping lives, so it
// cannot drift per surface), and the mint is
// `useCreateManagedAgentMutation` — `Keys::generate`, the record, the nest,
// exactly as `managed_agents::create_managed_agent` has always done it. This
// hook adds no infrastructure; it is the order those calls run in and the
// decision about whether to ask at all, which is `crewMint.ts` and is pure.
//
// **Standalone holds, and it holds by construction rather than by hope.** Read
// the create command: phases 1–3 generate keys, compute the auth tag and save
// the record under a lock, `try_regenerate_nest` writes the nest, and the relay
// is *phase 4* — its failure comes back as `profileSyncError` **beside a
// created agent**, not as an `Err`. So a mint with no coordinator and no
// reachable relay produces the whole crew on this machine and one honest
// sentence about what has not happened yet (`mintSentence`). There is no second
// path for offline and no spinner waiting for a socket.
//
// **The four go to the thread, Mate does not.** `berth` decides one field —
// `teamId` — and that is the whole mechanical difference: a thread member is
// minted into `builtin-team:crew` the way the welcome bootstrap mints it, and
// Mate is minted with no team at all, which is what keeps it out of every
// channel member list by default (the assistant plan's identity decision).
// Every one of them is `respondTo: "owner-only"`, because the Captain is who
// they are for.
//
// **Nothing is spawned here**, and that is `welcomeGuide.ts`'s decision for
// these same personas rather than a new one: minting is the offer, and a row of
// adapter processes starting the instant he says yes is a commitment to his
// machine the dialog never asked about. What starts a crew member is what
// already started one — opening a team thread (`useTeamThread.openThread`
// deploys the team's personas into the channel) or the start button in My
// Agents.

import * as React from "react";

import {
  useCreateManagedAgentMutation,
  useManagedAgentsQuery,
} from "@/features/agents/hooks";
import {
  availableRuntimesForStart,
  buildInstanceInputForDefinition,
  resolveStartRuntimeForDefinition,
} from "@/features/agents/lib/instanceInputForDefinition";
import { useAvailableAcpRuntimes } from "@/features/agents/hooks";
import { useGlobalAgentConfig } from "@/features/agents/useGlobalAgentConfig";
import { listPersonas, setPersonaActive } from "@/shared/api/tauriPersonas";
import type { AgentPersona, CreateManagedAgentInput } from "@/shared/api/types";

import {
  type CrewMintRequest,
  type CrewMintResult,
  type CrewMintRow,
  crewMintPlan,
  crewMintRows,
  crewOffer,
  crewOnDeck,
  mintSentence,
  withMintChecked,
  withMintName,
} from "./crewMint.ts";
import { crewOfferDeclined, declineCrewOffer } from "./crewMintStore.ts";
import { CREW, CREW_TEAM_ID } from "./crewRoster.ts";

export interface CrewMint {
  /** Whether the dialog is on screen. */
  open: boolean;
  rows: readonly CrewMintRow[];
  setName: (personaId: string, name: string) => void;
  setChecked: (personaId: string, mint: boolean) => void;
  /** Mint everything still checked. Resolves when the last one has answered. */
  mint: () => void;
  minting: boolean;
  /** What happened, once something has. `null` before the button is pressed. */
  sentence: string | null;
  /** "Not now" — remembered, and nothing asks again. */
  decline: () => void;
  /** Close the dialog without deciding. The offer comes back next time the
   * workspace opens, which is the difference between this and `decline`. */
  dismiss: () => void;
}

/** The name a mint runs under, and the one field `berth` decides. */
function crewCreateInput(
  request: CrewMintRequest,
  base: CreateManagedAgentInput,
): CreateManagedAgentInput {
  return {
    ...base,
    name: request.name,
    // Owner-only for all five: the crew answers the Captain. Mate's plan says
    // so explicitly and the other four inherit it from `welcomeGuide.ts`, which
    // mints the same personas the same way.
    respondTo: "owner-only",
    // See this file's header: minting is not starting.
    spawnAfterCreate: false,
    startOnAppLaunch: false,
    // The one mechanical difference between a thread member and the First
    // Mate. Undefined rather than empty — the backend refuses a team id it
    // cannot find, and "" would be a lookup on a team that does not exist.
    teamId: request.berth === "thread" ? CREW_TEAM_ID : undefined,
  };
}

export function useCrewMint(): CrewMint {
  const agentsQuery = useManagedAgentsQuery();
  const runtimesQuery = useAvailableAcpRuntimes();
  const { globalConfig } = useGlobalAgentConfig();
  const createAgent = useCreateManagedAgentMutation();

  // Read once, on the way in. A subscription would be a second answer to a
  // question that only this hook's own `decline` can change.
  const [declined, setDeclined] = React.useState(crewOfferDeclined);
  const [dismissed, setDismissed] = React.useState(false);
  const [rows, setRows] = React.useState<readonly CrewMintRow[]>([]);
  const [drawn, setDrawn] = React.useState(false);
  const [minting, setMinting] = React.useState(false);
  const [sentence, setSentence] = React.useState<string | null>(null);

  // `undefined` from the query is "has not answered", and `crewOffer` is built
  // to tell that apart from "answered, and there is none" — see rule 1 in
  // `crewMint.ts`'s header. Collapsing them here would undo it.
  const onDeck =
    agentsQuery.data === undefined ? null : crewOnDeck(CREW, agentsQuery.data);
  const offer = crewOffer({ crew: CREW, crewOnDeck: onDeck, declined });

  // **The rows are drawn once, from the first answer, and never redrawn.**
  // Which members are missing is a fact about the agent list, and minting
  // invalidates that list — so rows that re-derived from it would empty
  // themselves out from under the sentence standing next to them, and a
  // rename he typed would be overwritten by any refetch. Set during render
  // rather than in an effect so the dialog never draws a frame with no rows
  // in it (React's own "adjusting state while rendering").
  if (!drawn && offer.show) {
    setDrawn(true);
    setRows(crewMintRows(offer.missing));
  }

  const setName = React.useCallback((personaId: string, name: string) => {
    setRows((current) => withMintName(current, personaId, name));
  }, []);

  const setChecked = React.useCallback((personaId: string, mint: boolean) => {
    setRows((current) => withMintChecked(current, personaId, mint));
  }, []);

  const decline = React.useCallback(() => {
    declineCrewOffer();
    setDeclined(true);
  }, []);

  const dismiss = React.useCallback(() => setDismissed(true), []);

  const preferredRuntime = globalConfig.preferred_runtime;
  const createOne = createAgent.mutateAsync;

  const mint = React.useCallback(() => {
    if (minting) return;
    setMinting(true);
    setSentence(null);
    const plan = crewMintPlan(rows);
    void (async () => {
      // **Both lists are acquired, not read off a query that may not have
      // answered.** The Mint button is enabled from first paint and ACP
      // discovery probes binaries, so a click that beat it would hand
      // `resolveStartRuntimeForDefinition` an empty list and get "No available
      // runtime found for this agent." for all five — the failure
      // `availableRuntimesForStart` exists to prevent, and the one
      // `welcomeGuide.ts` avoids by calling the commands directly. The persona
      // catalog has the same shape and the same answer.
      const results: CrewMintResult[] = [];
      let personasById: Map<string, AgentPersona>;
      let runtimes: Awaited<ReturnType<typeof availableRuntimesForStart>>;
      try {
        [personasById, runtimes] = await Promise.all([
          listPersonas().then(
            (list) =>
              new Map<string, AgentPersona>(
                list.map((persona) => [persona.id, persona]),
              ),
          ),
          availableRuntimesForStart(runtimesQuery),
        ]);
      } catch (error) {
        setSentence(
          mintSentence(
            plan.map((request) => ({
              error: error instanceof Error ? error.message : String(error),
              name: request.name,
              offRelay: false,
            })),
          ),
        );
        setMinting(false);
        return;
      }
      for (const request of plan) {
        try {
          const persona = personasById.get(request.personaId);
          if (persona === undefined) {
            throw new Error(
              `${request.personaId} is not in this app's persona catalog.`,
            );
          }
          // Sequential, and the reason is `welcomeGuide.ts`'s: activation is a
          // read-modify-write over one shared file, so two in flight can lose
          // one another's write and leave a crew member permanently inactive —
          // which `create_managed_agent` then refuses to mint against.
          if (!persona.isActive) {
            await setPersonaActive(request.personaId, true);
          }
          const { runtime } = resolveStartRuntimeForDefinition(
            persona,
            runtimes,
            preferredRuntime,
          );
          const created = await createOne(
            crewCreateInput(
              request,
              await buildInstanceInputForDefinition(persona, runtime),
            ),
          );
          results.push({
            error: null,
            name: request.name,
            // The agent exists; only its profile did not reach a relay. See
            // this file's header on why that is not a failure.
            offRelay: created.profileSyncError !== null,
          });
        } catch (error) {
          results.push({
            error: error instanceof Error ? error.message : String(error),
            name: request.name,
            offRelay: false,
          });
        }
      }
      setSentence(mintSentence(results));
      setMinting(false);
    })();
  }, [createOne, minting, preferredRuntime, rows, runtimesQuery]);

  return {
    decline,
    dismiss,
    mint,
    minting,
    // **A sentence outranks the offer.** Minting invalidates the agent list,
    // so the moment the crew exists `crewOffer` starts refusing — and a dialog
    // that vanished on its own success would take the sentence with it and
    // leave him unable to tell a mint from a no-op. Once there is something to
    // report, only "Done" closes this.
    open: sentence !== null ? !dismissed : offer.show && !dismissed,
    rows,
    sentence,
    setChecked,
    setName,
  };
}
