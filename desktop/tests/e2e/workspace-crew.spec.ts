// The crew, proved against a real render
// (vingilot/docs/plans/2026-08-12-the-crew.md, Tasks 2 and 3).
//
// `crewMint.test.mjs` and `crewReach.test.mjs` already say what the model
// decides. What only a browser can say is the part that is a *composition* of
// three things a unit test holds separately: that the offer draws itself on a
// workspace with no crew and draws all five, that a decline written to
// localStorage is still a decline after a reload, and that ⌘K grows crew rows
// once a crew exists — which crosses `useCrewReach` → `PaletteContext` →
// `crewSource` → `CommandPalette`, none of which is wired in a unit test.
//
// Every command is mocked (`installMockBridge`), including the built-in persona
// catalog the crew's rows are drawn from — nothing here reaches a relay, mints
// a real key, or writes to `~/.vingilot`.

import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

// Matches RunsScreen.tsx's hardcoded dev workspace id.
const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
const COORDINATOR_ORIGIN = "http://127.0.0.1:7117";

const REPOS = [{ id: "repo-left", name: "vingilot", path: "/tmp/vingilot" }];

/** The five, in the order the dialog lists them: the First Mate, then the four
 * who share a thread. Written out rather than imported so this spec fails when
 * the roster changes rather than agreeing with it. */
const CREW = [
  "builtin:mate",
  "builtin:navigator",
  "builtin:bosun",
  "builtin:lookout",
  "builtin:scribe",
];

async function mockCoordinator(page: Page) {
  await page.route(`${COORDINATOR_ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === `/v1/workspaces/${WORKSPACE_ID}`) {
      return route.fulfill({
        json: {
          revision: 1,
          state: { repos: REPOS },
          state_hash: "mock-state-hash",
        },
      });
    }
    if (url.pathname === `/v1/workspaces/${WORKSPACE_ID}/runs`) {
      return route.fulfill({ json: { runs: [] } });
    }
    if (url.pathname === `/v1/workspaces/${WORKSPACE_ID}/worktrees`) {
      return route.fulfill({ json: { worktrees: [] } });
    }
    return route.fulfill({
      json: { detail: `unmocked route: ${url.pathname}`, error: "not_found" },
      status: 404,
    });
  });
}

/** The one command the ⌘W test is about, recorded rather than answered — the
 * apparatus `workspace-close-request.spec.ts` established, kept to the three
 * helpers this spec uses. What matters is the sequence of claims the workspace
 * made, because that is what the backend reads while it holds a close request
 * open. */
async function stubBackend(page: Page) {
  await page.evaluate(() => {
    const internals = (
      window as unknown as {
        __TAURI_INTERNALS__: {
          invoke: (cmd: string, args?: unknown, opts?: unknown) => unknown;
        };
      }
    ).__TAURI_INTERNALS__;
    const passThrough = internals.invoke.bind(internals);
    window.__DISMISSIBLE__ = [];
    internals.invoke = (cmd, args, opts) => {
      if (String(cmd) === "window_set_dismissible") {
        window.__DISMISSIBLE__?.push(
          (args as { dismissible: boolean }).dismissible,
        );
        return Promise.resolve(null);
      }
      return passThrough(cmd, args, opts);
    };
  });
}

/** Record every `start_managed_agent` the app asks for, in order.
 *
 * The mock bridge already answers the command (it flips the agent to
 * `running` and stamps `last_started_at`), so this records the *asking* —
 * which is the half the mint defect was about. Five agents were created and
 * the command was never sent, so every card came up with a play button on it.
 * Installed the same way `stubBackend` installs its recorder, and passing
 * through so the bridge still does its work. */
async function recordStarts(page: Page) {
  await page.evaluate(() => {
    const internals = (
      window as unknown as {
        __TAURI_INTERNALS__: {
          invoke: (cmd: string, args?: unknown, opts?: unknown) => unknown;
        };
      }
    ).__TAURI_INTERNALS__;
    const passThrough = internals.invoke.bind(internals);
    window.__STARTED__ = [];
    internals.invoke = (cmd, args, opts) => {
      if (String(cmd) === "start_managed_agent") {
        window.__STARTED__?.push((args as { pubkey: string }).pubkey);
      }
      return passThrough(cmd, args, opts);
    };
  });
}

/** The claim the backend would read for a close request arriving now. */
async function dismissibleNow(page: Page) {
  const claims = await page.evaluate(() => window.__DISMISSIBLE__ ?? []);
  return claims.length === 0 ? null : claims[claims.length - 1];
}

/** The close request itself, over the channel the Rust side emits it on.
 * Written out rather than imported, exactly as the other specs that send it —
 * the string is the contract with `closeRequest.ts`. */
async function requestClose(page: Page) {
  await page.evaluate(async () => {
    const internals = (
      window as unknown as {
        __TAURI_INTERNALS__: {
          invoke: (cmd: string, args?: unknown) => unknown;
        };
      }
    ).__TAURI_INTERNALS__;
    await internals.invoke("plugin:event|emit", {
      event: "vingilot://close-requested",
      payload: null,
    });
  });
}

type Seed = { pubkey: string; name: string; personaId: string };

async function openWorkspace(page: Page, agents: Seed[] = []) {
  await page.setViewportSize({ height: 900, width: 1700 });
  await installMockBridge(
    page,
    {
      managedAgents: agents.map((agent) => ({
        name: agent.name,
        personaId: agent.personaId,
        pubkey: agent.pubkey,
        status: "stopped" as const,
      })),
    },
    // Every other spec is a workspace that has already answered the offer
    // (`installBridge`'s `seedCrewOfferAnswered`). This is the one spec that
    // wants to be asked — including the tests that expect *no* dialog, so that
    // what hides it there is the whole crew existing rather than the seed.
    { offerCrew: true },
  );
  await mockCoordinator(page);
  await page.goto("/#/workspace");
  await expect(page.getByTestId("runs-screen")).toBeVisible();
}

test.describe("the offer a workspace with no crew is made", () => {
  test("five rows, the First Mate apart from the other four", async ({
    page,
  }) => {
    await openWorkspace(page);

    const dialog = page.getByTestId("crew-mint-dialog");
    await expect(dialog).toBeVisible();
    for (const personaId of CREW) {
      await expect(
        page.getByTestId(`crew-mint-row-${personaId}`),
      ).toBeVisible();
      // Default all on: the offer is the whole crew, and unchecking is his
      // edit rather than his assembly job.
      await expect(
        page.getByTestId(`crew-mint-check-${personaId}`),
      ).toBeChecked();
    }
    // Exactly five — a sixth row would mean a roster this spec does not know.
    await expect(dialog.locator('[data-testid^="crew-mint-row-"]')).toHaveCount(
      5,
    );

    // The sentence that keeps the identity decision visible: Mate is not in
    // the room with the others.
    await expect(dialog).toContainText("does not");
    await expect(dialog).toContainText("direct message");
  });

  test("the Captain can rename a crew member before it is minted", async ({
    page,
  }) => {
    await openWorkspace(page);
    const field = page.getByTestId("crew-mint-name-builtin:lookout");
    await expect(field).toHaveValue("Lookout");
    await field.fill("Watch");
    await expect(field).toHaveValue("Watch");
    // Unchecking a row disables its field: a name for an agent that is not
    // being minted is a field that does nothing.
    await page.getByTestId("crew-mint-check-builtin:lookout").click();
    await expect(field).toBeDisabled();
  });

  // The crew offer is the one surface on this screen that raises *itself*, so
  // it is the one that most needs to be in `useWorkspaceDialogs`' single
  // reading of "a dialog is up" — the reading ⌃Tab's `blocked` and the close
  // request both ask. Proved here through ⌘W, because that is the half with
  // teeth: the backend reads `window_set_dismissible` synchronously while it
  // holds the close request open, so an unclaimed offer is answered by the
  // window closing rather than by the question being dismissed.
  test("⌘W dismisses the offer instead of being answered by the window", async ({
    page,
  }) => {
    await openWorkspace(page);
    // The stub has to be on the document before the screen that claims reads
    // it mounts, and leaving and coming back is what remounts it. Both gotos
    // are hash-only, so the stub survives — `workspace-close-request.spec.ts`
    // makes the same trip for the same reason. The offer comes back with the
    // remount: only a decline is remembered, and nothing was declined.
    await stubBackend(page);
    await page.goto("/#/");
    await page.goto("/#/workspace");
    await expect(page.getByTestId("crew-mint-dialog")).toBeVisible();

    // The claim, made as the offer raises itself rather than as the request
    // arrives: this is what the backend reads.
    await expect.poll(async () => dismissibleNow(page)).toBe(true);

    await requestClose(page);
    await expect(page.getByTestId("crew-mint-dialog")).toBeHidden();
    // The workspace under it is untouched — the gesture took the question, not
    // the window — and the claim is handed back so the next ⌘W reaches it.
    await expect(page.getByTestId("runs-screen")).toBeVisible();
    await expect.poll(async () => dismissibleNow(page)).toBe(false);
  });

  test("'Not now' is remembered, and nothing asks again after a reload", async ({
    page,
  }) => {
    await openWorkspace(page);
    await expect(page.getByTestId("crew-mint-dialog")).toBeVisible();

    await page.getByTestId("crew-mint-decline").click();
    await expect(page.getByTestId("crew-mint-dialog")).toBeHidden();

    // The decline lives in localStorage, which survives the reload. This is
    // the assertion the whole "nothing nags" promise rests on — and a reload
    // rather than a second `goto` of the same URL, which a hash router can
    // answer without remounting anything.
    await page.reload();
    await expect(page.getByTestId("runs-screen")).toBeVisible();
    await expect(page.getByTestId("crew-mint-dialog")).toBeHidden();
  });

  test("a workspace that already has the whole crew is never offered one", async ({
    page,
  }) => {
    await openWorkspace(
      page,
      CREW.map((personaId, n) => ({
        name: personaId.slice("builtin:".length),
        personaId,
        pubkey: String(n).repeat(64),
      })),
    );
    await expect(page.getByTestId("crew-mint-dialog")).toBeHidden();
  });

  // The primary install path: community onboarding mints the four thread crew
  // itself and never mints the First Mate, and this dialog is the only door to
  // it. So the offer subtracts — it is what is missing, not all-or-nothing.
  test("a workspace missing only the First Mate is offered exactly that row", async ({
    page,
  }) => {
    await openWorkspace(page, [
      {
        name: "Navigator",
        personaId: "builtin:navigator",
        pubkey: "1".repeat(64),
      },
      { name: "Bosun", personaId: "builtin:bosun", pubkey: "2".repeat(64) },
      { name: "Lookout", personaId: "builtin:lookout", pubkey: "3".repeat(64) },
      { name: "Scribe", personaId: "builtin:scribe", pubkey: "4".repeat(64) },
    ]);

    const dialog = page.getByTestId("crew-mint-dialog");
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId("crew-mint-row-builtin:mate")).toBeVisible();
    await expect(dialog.locator('[data-testid^="crew-mint-row-"]')).toHaveCount(
      1,
    );
  });
});

// Minting used to stop at the record. Measured on the owner's machine, all
// five crew instances came out with `last_started_at: null` and no harness
// log — a crew he had just been told was aboard, with a play button on every
// card. These are the tests that keep hiring and working the same gesture.
test.describe("a mint puts the crew to work, not just on the books", () => {
  test("every minted crew member is started", async ({ page }) => {
    await openWorkspace(page);
    await recordStarts(page);

    const dialog = page.getByTestId("crew-mint-dialog");
    await expect(dialog).toBeVisible();
    await page.getByTestId("crew-mint-confirm").click();

    // The sentence lands when the last one has answered.
    const sentence = page.getByTestId("crew-mint-sentence");
    await expect(sentence).toBeVisible();
    await expect(sentence).toContainText("aboard");

    // One start per minted member — the whole roster, since this workspace
    // had none of them. Polled because the sentence renders from the same
    // async pass the last start completes in.
    await expect
      .poll(async () => (await page.evaluate(() => window.__STARTED__)) ?? [])
      .toHaveLength(CREW.length);

    // Distinct pubkeys: five agents started, not one started five times.
    const started = (await page.evaluate(() => window.__STARTED__)) ?? [];
    expect(new Set(started).size).toBe(CREW.length);

    // Nothing refused, so the sentence says nothing about starting.
    await expect(sentence).not.toContainText("did not start");
  });

  test("a harness that refuses is named, and the mint still stands", async ({
    page,
  }) => {
    // The bridge's own failure knob, one error for one member: a start that
    // fails must not take the mint down with it, because the key and the
    // record already exist by the time a harness can refuse.
    await page.setViewportSize({ height: 900, width: 1700 });
    await installMockBridge(
      page,
      {
        startManagedAgentErrors: ["No available runtime found for this agent."],
      },
      { offerCrew: true },
    );
    await mockCoordinator(page);
    await page.goto("/#/workspace");
    await expect(page.getByTestId("runs-screen")).toBeVisible();

    await expect(page.getByTestId("crew-mint-dialog")).toBeVisible();
    await page.getByTestId("crew-mint-confirm").click();

    const sentence = page.getByTestId("crew-mint-sentence");
    await expect(sentence).toBeVisible();
    // Aboard — the mint stands.
    await expect(sentence).toContainText("aboard");
    // And the one that did not start is named, with the reason.
    await expect(sentence).toContainText("minted, but did not start");
    await expect(sentence).toContainText(
      "No available runtime found for this agent.",
    );
    // A start failure is never reported as a mint failure.
    await expect(sentence).not.toContainText("could not be minted");
  });
});

// "bunlar silinebilir olsun ya. crew de mate de. silince bi daha eklemek ister
// misin diye sorsun, kullanıcı isterse reddetsin." — the owner. Delete on a
// crew card used to route to persona deactivation, which the backend refuses
// while an agent references the persona, so removing a crew member answered
// with "… is still assigned to a managed agent."
test.describe("a crew member can be removed, and the offer asks again", () => {
  /** The whole crew minted, so the offer has nothing to ask about yet. */
  const WHOLE_CREW = CREW.map((personaId, n) => ({
    name: personaId.slice("builtin:".length),
    personaId,
    pubkey: String(n).repeat(64),
  }));

  test("removing Bosun takes its agent, and the offer comes back asking for it", async ({
    page,
  }) => {
    await page.setViewportSize({ height: 900, width: 1700 });
    await installMockBridge(
      page,
      { activePersonaIds: [...CREW], managedAgents: WHOLE_CREW },
      { offerCrew: true },
    );
    await mockCoordinator(page);

    // A full crew is never offered one — the starting point.
    await page.goto("/#/workspace");
    await expect(page.getByTestId("runs-screen")).toBeVisible();
    await expect(page.getByTestId("crew-mint-dialog")).toBeHidden();

    // One gesture, from the card he is looking at.
    await page.goto("/#/");
    await page.getByTestId("open-agents-view").click();
    await page.getByLabel("Open actions for Bosun").click();
    await page.getByRole("menuitem", { name: "Delete" }).click();

    // The dialog names the cascade and promises the persona comes back.
    const confirm = page.getByRole("alertdialog");
    await expect(confirm).toContainText("Remove Bosun and its 1 agent?");
    await expect(confirm).toContainText("the crew offer can mint it again");
    await confirm.getByRole("button", { name: "Remove" }).click();

    // Cascaded: the agent is gone, so nothing references the persona and the
    // deactivation the old path died on now succeeds. No "still assigned".
    await expect(confirm).toBeHidden();
    await expect(page.locator("[data-sonner-toast]")).not.toContainText(
      "still assigned",
    );
    await expect
      .poll(async () =>
        page.evaluate(async () => {
          const internals = (
            window as unknown as {
              __TAURI_INTERNALS__: {
                invoke: (cmd: string, args?: unknown) => Promise<unknown>;
              };
            }
          ).__TAURI_INTERNALS__;
          const agents = (await internals.invoke("list_managed_agents")) as {
            persona_id: string | null;
          }[];
          return agents.filter((a) => a.persona_id === "builtin:bosun").length;
        }),
      )
      .toBe(0);

    // And the offer asks again — by its own subtractive rule, for exactly the
    // member that is now missing.
    await page.goto("/#/workspace");
    const dialog = page.getByTestId("crew-mint-dialog");
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId("crew-mint-row-builtin:bosun")).toBeVisible();
    await expect(dialog.locator('[data-testid^="crew-mint-row-"]')).toHaveCount(
      1,
    );

    // "No thanks" is still remembered across a reload — removing a crew member
    // must not have disturbed the machinery that keeps the app from nagging.
    await page.getByTestId("crew-mint-decline").click();
    await expect(dialog).toBeHidden();
    await page.reload();
    await expect(page.getByTestId("runs-screen")).toBeVisible();
    await expect(page.getByTestId("crew-mint-dialog")).toBeHidden();
  });

  test("the First Mate is removable on the same one gesture", async ({
    page,
  }) => {
    // Mate is the owner-only DM rather than a thread member, so it reaches the
    // card through a different berth — and the owner asked for both by name
    // ("crew de mate de").
    await page.setViewportSize({ height: 900, width: 1700 });
    await installMockBridge(
      page,
      { activePersonaIds: [...CREW], managedAgents: WHOLE_CREW },
      { offerCrew: true },
    );
    await mockCoordinator(page);
    await page.goto("/#/");
    await page.getByTestId("open-agents-view").click();

    await page.getByLabel("Open actions for Mate").click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    const confirm = page.getByRole("alertdialog");
    await expect(confirm).toContainText("Remove Mate and its 1 agent?");
    await confirm.getByRole("button", { name: "Remove" }).click();
    await expect(confirm).toBeHidden();

    await page.goto("/#/workspace");
    await expect(page.getByTestId("crew-mint-row-builtin:mate")).toBeVisible();
  });
});

test.describe("the crew is reachable from ⌘K", () => {
  test("no crew, no crew rows", async ({ page }) => {
    await openWorkspace(page);
    // Get the offer out of the way first — it is modal, and ⌘K under it is a
    // key pressed at a dialog.
    await page.getByTestId("crew-mint-decline").click();
    await expect(page.getByTestId("crew-mint-dialog")).toBeHidden();

    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByTestId("palette")).toBeVisible();
    await page.getByTestId("palette-input").fill("Lookout");
    await expect(
      page.getByTestId("palette-row-crew:builtin:lookout"),
    ).toBeHidden();
  });

  test("a minted crew is rows, addressed by name and by errand", async ({
    page,
  }) => {
    // The whole crew, because the offer is subtractive: a workspace missing
    // three of them would be offered those three, and this test is about the
    // palette rather than about the dialog. Lookout was renamed at mint time.
    await openWorkspace(page, [
      { name: "Mate", personaId: "builtin:mate", pubkey: "a".repeat(64) },
      { name: "Watch", personaId: "builtin:lookout", pubkey: "b".repeat(64) },
      {
        name: "Navigator",
        personaId: "builtin:navigator",
        pubkey: "1".repeat(64),
      },
      { name: "Bosun", personaId: "builtin:bosun", pubkey: "2".repeat(64) },
      { name: "Scribe", personaId: "builtin:scribe", pubkey: "3".repeat(64) },
    ]);
    await expect(page.getByTestId("crew-mint-dialog")).toBeHidden();

    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByTestId("palette")).toBeVisible();

    // The First Mate: findable by name, and never blocked — the DM it answers
    // in is opened on demand rather than looked up.
    await page.getByTestId("palette-input").fill("Ask Mate");
    const mate = page.getByTestId("palette-row-crew:builtin:mate");
    await expect(mate).toBeVisible();
    await expect(mate).toContainText("Ask Mate…");
    await expect(mate).not.toHaveAttribute("data-blocked", "true");

    // Renamed at mint time, and the row is called what he called it — the
    // persona is the job, the name is his.
    await page.getByTestId("palette-input").fill("review");
    const lookout = page.getByTestId("palette-row-crew:builtin:lookout");
    await expect(lookout).toBeVisible();
    await expect(lookout).toContainText("Have Watch review this worktree");

    // And with no team thread open in this worktree it refuses with a
    // sentence rather than pretending there is somewhere to write.
    await expect(lookout).toHaveAttribute("data-blocked", "true");
    await expect(lookout).toContainText("no team thread yet");
  });
});

declare global {
  interface Window {
    /** Every `window_set_dismissible` claim this app made, in order. */
    __DISMISSIBLE__?: boolean[];
    /** Every pubkey this app asked to start, in order. */
    __STARTED__?: string[];
  }
}
