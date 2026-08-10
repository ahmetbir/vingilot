// Talking to a Buzz agent team about a worktree, proved against a real render
// (vingilot/docs/plans/2026-08-08-scratch-and-team-thread.md, Task 2;
// vingilot/docs/plans/2026-08-09-team-thread-fidelity.md, Tasks 1 and 2).
//
// `teamThread.test.mjs` says what each sentence reads as; `teamThreadStore.test.mjs`
// says what is kept and what is refused. What only a browser can say is the
// claim these tasks are judged on:
//
// - that the conversation in this pane **is upstream's**, not a second one
//   built beside it. The assertions are on upstream-owned testids
//   (`message-composer`, `message-row`) and on the *absence* of the island's
//   old ones (`team-composer`, `team-send`) — a pane that grew its own composer
//   back would turn this red. The failure that made it matter: no upstream
//   composer meant no mention autocomplete and no `p` tags, and `buzz-acp`
//   dispatches on a mention filter, so the team could not hear him;
// - that **the team can be addressed**: `@` in the hosted composer offers the
//   deployed members by name, and the message that leaves carries their `p`
//   tag. Both are asserted against a message sent the same way from
//   `/channels/general`, because "the same as a normal channel" is the claim,
//   not "a mention happens";
// - that **what the scope sentence claims is what happens**. It no longer
//   promises a line in front of each message, because nothing prepends one any
//   more: the path is in the channel's description and the branch in its name.
//   The spec asserts the claim and asserts that a sent message carries the
//   typed words and nothing else;
// - that the channel he ends up with in his sidebar is **named the way he
//   would have named it** — team, project, branch, no `wt-` and no hash — and
//   that a thread from the build before this one is renamed in place without
//   the pointer or the recovery path losing it. The mark recovery matches on
//   is asserted on the row `get_channels` returns, because a mark the recovery
//   path cannot read is a recovery path that cannot work;
// - that opening a thread reaches **the relay**: a channel that did not exist
//   before, read off `sign_event`, which is where every relay message this app
//   publishes is signed;
// - that **"could not ask" is not "no"** — with `list_teams` throwing, the pane
//   says it could not ask and stays open, rather than reporting a machine with
//   no teams on it;
// - that with no team configured the pane says so, in its own sentence, and
//   hosts nothing.
//
// The coordinator is mocked the same way workspace-ask.spec.ts mocks it, and
// the pty commands are stubbed for the same reason: what is under test is one
// pane, and the work surface underneath it must still mount.

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";

const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
const COORDINATOR_ORIGIN = "http://127.0.0.1:7117";

/** The main checkout *is* the repo, so this path is the worktree's cwd and
 * therefore the exact string the scope sentence has to carry (`projects.ts`'s
 * `worktreeCwd`). */
const REPO = { id: "repo-left", name: "vingilot", path: "/tmp/vingilot-left" };

/** Written out rather than read off the product: a spec that built the
 * expectation the same way the product does would pass through any change to
 * either. This is the line the pane used to put in front of every message and
 * must not put there any more. */
const OLD_SCOPE_LINE = "worktree: /tmp/vingilot-left";
const QUESTION = "why is the build red";

/** What this pane calls the channel it opens: the team, then the project
 * directory, then the branch. Written out rather than derived for the same
 * reason as the line above — a spec that built the name the way the product
 * does would pass through any change to either.
 *
 * `vingilot-left` is `REPO.path`'s last segment and `main` is the primary
 * checkout's stand-in for a branch (`worktreeSummary`). */
const THREAD_NAME = "launch-team-vingilot-left-main";

/** The name an older build gave the same channel, and the one on the owner's
 * relay right now: a `wt-` prefix, the labels, and a six-character hash. */
const OLD_THREAD_NAME = "wt-main-launch-team-kbz5pz";

const PERSONAS = [
  { displayName: "Planner", id: "persona-planner", systemPrompt: "Plan it." },
  { displayName: "Builder", id: "persona-builder", systemPrompt: "Build it." },
];

const TEAM = {
  description: "Plans and builds.",
  id: "team-launch",
  name: "Launch Team",
  personaIds: ["persona-planner", "persona-builder"],
};

/** A managed agent this app owns that is in no channel of this spec's. It is
 * seeded so the mention assertions can tell the two candidate sources apart:
 * the deployed members must arrive as *members* of the thread, and this one
 * must arrive from the managed-agent list carrying "not in channel". */
const SPARE_AGENT = {
  name: "Sparebot",
  pubkey: "5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a",
};

/** The same kind of agent, but a member of an ordinary channel — the other end
 * of the comparison the mention test is built on. */
const REF_AGENT = {
  name: "Refbot",
  pubkey: "5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b",
};

async function mockCoordinator(page: Page) {
  await page.route(`${COORDINATOR_ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (method === "GET" && url.pathname === `/v1/workspaces/${WORKSPACE_ID}`) {
      return route.fulfill({
        json: {
          revision: 1,
          state: { repos: [REPO] },
          state_hash: "mock-state-hash",
        },
      });
    }
    if (
      method === "GET" &&
      url.pathname === `/v1/workspaces/${WORKSPACE_ID}/runs`
    ) {
      return route.fulfill({ json: { runs: [] } });
    }
    if (
      method === "GET" &&
      url.pathname === `/v1/workspaces/${WORKSPACE_ID}/worktrees`
    ) {
      return route.fulfill({ json: { worktrees: [] } });
    }
    return route.fulfill({
      json: { detail: `unmocked route: ${url.pathname}`, error: "not_found" },
      status: 404,
    });
  });
}

/** How `list_teams` answers.
 *
 * - `seeded`: whatever the mock bridge holds, which is its three built-in teams
 *   plus anything this spec seeded.
 * - `none`: an empty list. Its own mode rather than `installMockBridge(…, {
 *   teams: [] })`, because the bridge's built-ins are there either way — seeding
 *   nothing is not the same as configuring nothing.
 * - `unaskable`: the call throws, from the very first one. That is the state a
 *   pane reporting "no teams" would be inventing an answer in. */
type TeamsMode = "none" | "seeded" | "unaskable";

/** How `list_teams` answers, installed **before the app boots**.
 *
 * An init script rather than a `page.evaluate` after the fact, and that is the
 * whole reason it is separate from the stub below: the team list is fetched
 * during boot and cached with a 30s staleTime, so a throw installed once the
 * app is up would arrive as a *refresh* that failed against an answer already
 * in hand — which is not the state under test. This one must be the first
 * answer the app ever gets. It is deliberately the only thing patched here: the
 * boot path uses the bridge for everything else, and standing in front of it
 * costs the app its onboarding. */
async function stubTeams(page: Page, teams: TeamsMode) {
  await page.addInitScript(
    ({ teams }) => {
      if (teams === "seeded") return;
      type Invoke = (cmd: string, args?: unknown, opts?: unknown) => unknown;
      type Internals = { invoke: Invoke };

      // The bridge is installed by the app bundle (`mockIPC` in main.tsx), not
      // by an init script, so at this point there is nothing to patch yet —
      // and `mockIPC` assigns the holder before it assigns `invoke`. So the
      // hook is an accessor that wraps the FIRST `invoke` written to it and
      // then gets out of the way: a later stub (`stubBackend`) reads this
      // wrapper, chains onto it, and writes its own, which must be stored as
      // given or the two would call each other forever.
      const hook = (internals: Internals) => {
        let current: Invoke | undefined;
        let wrapped = false;
        Object.defineProperty(internals, "invoke", {
          configurable: true,
          get: () => current,
          set: (next: Invoke) => {
            if (wrapped) {
              current = next;
              return;
            }
            wrapped = true;
            current = (cmd, args, opts) => {
              if (String(cmd) === "list_teams") {
                return teams === "none"
                  ? Promise.resolve([])
                  : Promise.reject(
                      new Error("the team store could not be read"),
                    );
              }
              return next(cmd, args, opts);
            };
          },
        });
      };

      const holder = window as unknown as { __TAURI_INTERNALS__?: Internals };
      if (holder.__TAURI_INTERNALS__ !== undefined) {
        hook(holder.__TAURI_INTERNALS__);
        return;
      }
      let internals: Internals | undefined;
      Object.defineProperty(holder, "__TAURI_INTERNALS__", {
        configurable: true,
        get: () => internals,
        set: (value: Internals) => {
          internals = value;
          hook(value);
        },
      });
    },
    { teams },
  );
}

/** The home directory a worktree cwd derives from, the pty commands an xterm
 * needs, and a recorder on `sign_event` — which is where every message this app
 * publishes to the relay is signed, and therefore the one place a claim about
 * "what was sent" can be settled. */
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
    window.__SIGNED__ = [];
    window.__DEPLOYS__ = 0;
    internals.invoke = (cmd, args, opts) => {
      const name = String(cmd);
      if (name.startsWith("plugin:path|")) return Promise.resolve("/tmp/home/");
      if (name === "pty_backing") return Promise.resolve("tmux");
      if (name.startsWith("pty_")) return Promise.resolve(null);
      // Every managed agent this app mints goes through here, so this counter
      // is what a claim about "no new agent processes" can be settled against.
      if (name === "create_managed_agent") window.__DEPLOYS__ += 1;
      // The deploy's own first step, failing wholesale — which happens *after*
      // the channel exists and its pointer is written, and is therefore the
      // case a sentence saying "the thread could not be opened" would be
      // printed inside an open thread.
      if (window.__FAIL_DEPLOY__ === true && name === "list_managed_agents") {
        return Promise.reject(new Error("the agent store could not be read"));
      }
      if (name === "sign_event") window.__SIGNED__?.push(args);
      return passThrough(cmd, args, opts);
    };
  });
}

/** The hosted conversation: upstream's composer, inside this pane's slot for
 * it. Asserting on `message-composer` rather than on anything of the island's
 * is the point — it is the testid a copied component would not have. */
function hostedComposer(page: Page) {
  return page.getByTestId("team-thread").getByTestId("message-composer");
}

/** Open a thread with `TEAM` and wait until upstream's composer is standing. */
async function openThread(page: Page) {
  await choosePane(page, "team");
  await expect(page.getByTestId("team-choice")).toBeVisible();
  await page.getByTestId(`team-choice-${TEAM.id}`).click();
  await page.getByTestId("team-open").click();
  await expect(hostedComposer(page)).toBeVisible({ timeout: 15_000 });
}

async function openWorktree(
  page: Page,
  teams: TeamsMode = "seeded",
  managedAgents: {
    channelNames?: string[];
    name: string;
    pubkey: string;
  }[] = [],
) {
  await page.setViewportSize({ height: 900, width: 1700 });
  await installMockBridge(page, {
    managedAgents: managedAgents.map((agent) => ({
      ...agent,
      status: "stopped" as const,
    })),
    personas: PERSONAS,
    teams: [TEAM],
  });
  await stubTeams(page, teams);
  await mockCoordinator(page);
  await page.goto("/#/workspace");
  await expect(page.getByTestId("runs-screen")).toBeVisible();
  // The home-dir lookup runs once on RunsScreen's mount, so the stub has to be
  // in place before the screen that reads it mounts; leaving and coming back is
  // what re-runs it (workspace-ask.spec.ts makes the same trip). Both gotos are
  // hash-only, so the document — and the stub on it — survives.
  await stubBackend(page);
  await page.goto("/#/");
  await page.goto("/#/workspace");
  await page.getByTestId(`projects-nav-repo-${REPO.id}`).click();
  await expect(page.getByTestId("work-surface")).toBeVisible();
}

/** Put a pane in the right slot, waiting out the menu on both sides of the
 * click — Radix animates it, and a choice clicked mid-animation is a click on a
 * moving target. */
async function choosePane(page: Page, key: string) {
  const picker = page.getByTestId("pane-picker");
  await picker.click();
  await expect(picker).toHaveAttribute("data-state", "open");
  await waitForAnimations(page);
  await page.getByTestId(`pane-choice-${key}`).click();
  await expect(picker).toHaveAttribute("data-state", "closed");
  await waitForAnimations(page);
}

/** Everything the last kind:9 event was signed with. `null` while nothing has
 * been sent, which is itself an assertion several tests make. */
async function lastMessage(page: Page) {
  return page.evaluate(() => {
    const signed = (window.__SIGNED__ ?? []) as {
      kind?: number;
      content?: string;
      tags?: string[][];
    }[];
    const messages = signed.filter((event) => event.kind === 9);
    return messages[messages.length - 1] ?? null;
  });
}

/** The tag names of an event, in order. What "the same event a channel would
 * have sent" can actually be compared on: the pubkeys inside two different
 * channels' messages differ by construction, the structure must not. */
function tagShape(event: { tags?: string[][] } | null) {
  return (event?.tags ?? []).map((tag) => tag[0]);
}

/** The pubkey the deploy minted for a team member, read back out of the list
 * the app's own mention candidates are built from. Hardcoding one would assert
 * against a fixture instead of against what was deployed. */
async function deployedAgentPubkey(page: Page, name: string) {
  return page.evaluate(async (agentName) => {
    const internals = (
      window as unknown as {
        __TAURI_INTERNALS__: {
          invoke: (cmd: string, args?: unknown) => Promise<unknown>;
        };
      }
    ).__TAURI_INTERNALS__;
    const agents = (await internals.invoke("list_managed_agents")) as {
      name: string;
      pubkey: string;
    }[];
    return agents.find((agent) => agent.name === agentName)?.pubkey ?? null;
  }, name);
}

/** The channel this worktree's pointer names, read off the relay's own list.
 *
 * Both halves matter. The pointer is `teamThreadStore`'s and holds a channel
 * *id*, so reading it is how "the pointer still resolves" can be asserted
 * across a rename; the row comes from `get_channels`, which is the same list
 * the recovery path is handed, so the description asserted here is the one
 * recovery would actually get to read. */
async function threadChannel(page: Page) {
  return page.evaluate(async () => {
    const raw = window.localStorage.getItem("vingilot-team-thread.v1");
    const bindings = (raw === null ? {} : JSON.parse(raw)) as Record<
      string,
      { channelId: string | null }
    >;
    const channelId = Object.values(bindings)[0]?.channelId ?? null;
    if (channelId === null) return null;
    const internals = (
      window as unknown as {
        __TAURI_INTERNALS__: {
          invoke: (cmd: string, args?: unknown) => Promise<unknown>;
        };
      }
    ).__TAURI_INTERNALS__;
    const channels = (await internals.invoke("get_channels")) as {
      id: string;
      name: string;
      description: string;
    }[];
    return channels.find((channel) => channel.id === channelId) ?? null;
  });
}

/** Wait out the deploy. The channel — and therefore the composer — exists
 * before its members do, so typing `@` the moment the composer appears would
 * be asking for a candidate list that is still being written. */
async function waitForDeploy(page: Page) {
  await expect(page.getByTestId("team-deploying")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__DEPLOYS__)).toBe(2);
}

test.describe("talk to a team about this worktree", () => {
  test("the pane hosts the real conversation, and sends exactly what was typed", async ({
    page,
  }) => {
    await openWorktree(page);
    await choosePane(page, "team");

    // The choice is part of the pane, not a global setting.
    await expect(page.getByTestId("team-choice")).toBeVisible();
    await page.getByTestId(`team-choice-${TEAM.id}`).click();

    // Before anything is deployed: who, and what they will be told.
    await expect(page.getByTestId("team-members")).toContainText("Planner");
    await expect(page.getByTestId("team-members")).toContainText("Builder");
    const scope = page.getByTestId("team-scope");
    await expect(scope).toContainText(REPO.path);
    await expect(scope).toContainText("not the diff");
    await expect(scope).toContainText("not the plan");
    // The branch is not in the message and is not claimed to be kept from the
    // team either: it is in the name of the channel this pane makes, which the
    // sentence says rather than enumerating away.
    await expect(scope).toContainText("name of the channel");
    // The thing this pane has to say that ask-mode does not: the path is text,
    // not a directory the team is standing in.
    await expect(scope).toContainText("not started in this directory");
    // And the claim this task changed: nothing is put in front of a message.
    await expect(scope).toContainText("what you type is what is sent");

    await page.getByTestId("team-open").click();

    // **The conversation is upstream's.** These two testids belong to
    // `MessageComposer` and `MessageRow`; the island owns neither, and a pane
    // that reimplemented them would have to have copied the component to keep
    // this green.
    await expect(hostedComposer(page)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("team-composer")).toHaveCount(0);
    await expect(page.getByTestId("team-send")).toHaveCount(0);

    // Nothing has been sent by opening a thread.
    expect(await lastMessage(page)).toBeNull();

    await page
      .getByTestId("team-thread")
      .getByTestId("message-input")
      .fill(QUESTION);
    await page.getByTestId("team-thread").getByTestId("send-message").click();

    // What crossed the boundary: the words, and nothing in front of them. The
    // pane used to prepend a `worktree:` line here; the scope sentence above no
    // longer claims one, and this is the other half of that claim.
    await expect
      .poll(async () => (await lastMessage(page))?.content ?? null, {
        timeout: 15_000,
      })
      .toBe(QUESTION);
    expect((await lastMessage(page))?.content).not.toContain(OLD_SCOPE_LINE);

    // And it went to the relay as a channel message, addressed to the channel
    // this pane opened — not to a store of its own.
    const sent = await lastMessage(page);
    const channelTag = sent?.tags?.find((tag) => tag[0] === "h") ?? null;
    expect(channelTag).not.toBeNull();

    // It comes back in upstream's timeline, drawn by upstream's row.
    await expect(
      page.getByTestId("team-thread").getByTestId("message-row").last(),
    ).toContainText(QUESTION);

    // **The hosted surface measures its header onto the pane, not onto the
    // app.** The channel screen writes `--buzz-channel-content-top-padding` on
    // whatever its main inset is; left alone that is the app's `<main>`, and a
    // pane would be resizing the app's chrome from inside a column. The app
    // inset must still be carrying the untouched default.
    await expect
      .poll(() =>
        page.evaluate(() => {
          const read = (element: Element | null) =>
            element instanceof HTMLElement
              ? element.style.getPropertyValue(
                  "--buzz-channel-content-top-padding",
                )
              : null;
          return {
            app: read(document.querySelector("[data-buzz-glass-inset]")),
            pane: read(
              document.querySelector('[data-testid="team-thread-inset"]'),
            ),
          };
        }),
      )
      .toMatchObject({ app: "5.75rem", pane: /px$/ });
  });

  test("`@` offers the deployed team, from the two sources a channel uses", async ({
    page,
  }) => {
    await openWorktree(page, "seeded", [SPARE_AGENT]);
    await openThread(page);
    await waitForDeploy(page);

    const pane = page.getByTestId("team-thread");
    await pane.getByTestId("message-input").fill("@");
    const dropdown = pane.getByTestId("mention-autocomplete");
    await expect(dropdown).toBeVisible();

    for (const member of ["Planner", "Builder"]) {
      const row = dropdown.locator("button", { hasText: member });
      await expect(row).toBeVisible();
      await expect(row.getByTestId("mention-agent-icon")).toBeVisible();
      // **Source one: channel membership.** The deploy enrols each member with
      // role "bot", so upstream reads them as members of this channel. An agent
      // the deploy failed to enrol would still be offered — the managed-agent
      // list is the other source — and would carry this label. Its absence is
      // therefore what says the membership half worked, which a bare
      // "Planner is in the list" would not.
      await expect(row.getByText("not in channel")).toHaveCount(0);
    }

    // **Source two: the managed-agent list.** An agent of this app's that is in
    // no channel is offered as well, and says so. Both halves of a normal
    // channel's list are present, which is what makes this the same list.
    const spare = dropdown.locator("button", { hasText: SPARE_AGENT.name });
    await expect(spare).toBeVisible();
    await expect(spare.getByText("not in channel")).toBeVisible();

    // Selecting one puts the mention in the composer, as an agent mention.
    // Waiting for the list to be *only* Planner is not decoration: the
    // dropdown keeps rendering the previous query's rows until the debounce
    // lands, so an Enter sent before it does picks off the older list.
    await pane.getByTestId("message-input").fill("@Plan");
    await expect(dropdown.locator("button")).toHaveCount(1);
    await expect(dropdown.locator("button")).toContainText("Planner");
    await pane.getByTestId("message-input").press("Enter");
    await expect(pane.getByTestId("message-input")).toHaveText("@Planner ");
    await expect(
      pane
        .getByTestId("message-input")
        .locator(".agent-mention-highlight", { hasText: "Planner" }),
    ).toBeVisible();
  });

  test("a mention sent from the pane is tagged the way a channel tags one", async ({
    page,
  }) => {
    await openWorktree(page, "seeded", [
      { ...REF_AGENT, channelNames: ["general"] },
    ]);

    // The baseline first: the same gesture on the route this pane is meant to
    // be indistinguishable from. Both messages are read off `sign_event`, so
    // what is compared is what crossed the boundary, not what was rendered.
    await page.goto("/#/");
    await page.getByTestId("channel-general").click();
    await expect(page.getByTestId("chat-title")).toHaveText("general");
    // The mention goes last and nothing is typed after it. Typing straight
    // after the selection is what made this test lie: the selection inserts
    // `@Name ` as a ProseMirror transaction, and the first character typed
    // before the browser has settled that trailing space replaces it instead of
    // following it — `@Refbotwhy is the build red` leaves the name without a
    // word boundary, so `extractMentionPubkeys` finds nothing and the message
    // ships with no `p` tag. That is the exact symptom this test exists to
    // catch, produced by the test itself, roughly one run in five.
    await page
      .getByTestId("message-input")
      .fill(`${QUESTION} @${REF_AGENT.name}`);
    const routeDropdown = page
      .getByTestId("message-composer")
      .getByTestId("mention-autocomplete");
    await expect(routeDropdown.locator("button")).toHaveCount(1);
    await expect(routeDropdown.locator("button")).toContainText(REF_AGENT.name);
    await page.getByTestId("message-input").press("Enter");
    // The trailing space is the only proof the selection committed:
    // `.agent-mention-highlight` is a decoration the extension paints over any
    // text matching a known agent name, so it is already there for the raw
    // `@Refbot` that was typed. Send before the commit and the mention is never
    // registered, so the `p` tag never gets built.
    await expect
      .poll(async () => page.getByTestId("message-input").textContent(), {
        timeout: 5_000,
      })
      .toBe(`${QUESTION} @${REF_AGENT.name} `);
    await page.getByTestId("send-message").click();
    await expect
      .poll(async () => (await lastMessage(page))?.content ?? null, {
        timeout: 15_000,
      })
      .toContain(QUESTION);
    const fromChannel = await lastMessage(page);
    expect(fromChannel?.tags).toContainEqual(["p", REF_AGENT.pubkey]);

    // Now the same thing in the pane.
    await page.goto("/#/workspace");
    await page.getByTestId(`projects-nav-repo-${REPO.id}`).click();
    await expect(page.getByTestId("work-surface")).toBeVisible();
    await openThread(page);
    await waitForDeploy(page);

    const pane = page.getByTestId("team-thread");
    await pane.getByTestId("message-input").fill(`${QUESTION} @Plan`);
    const paneDropdown = pane.getByTestId("mention-autocomplete");
    await expect(paneDropdown.locator("button")).toHaveCount(1);
    await expect(paneDropdown.locator("button")).toContainText("Planner");
    await pane.getByTestId("message-input").press("Enter");
    await expect
      .poll(async () => pane.getByTestId("message-input").textContent(), {
        timeout: 5_000,
      })
      .toBe(`${QUESTION} @Planner `);
    await pane.getByTestId("send-message").click();
    await expect
      .poll(async () => (await lastMessage(page))?.content ?? null, {
        timeout: 15_000,
      })
      .toContain(QUESTION);
    const fromPane = await lastMessage(page);

    // **The claim the task is judged on.** `buzz-acp` subscribes with
    // `require_mention` (crates/buzz-acp/src/lib.rs, `SubscribeMode::Mentions`),
    // and what it matches on is a `p` tag naming the agent. A message without
    // one is a message the harness deliberately ignores, so this — not the chip
    // in the composer — is what "the team can hear him" means.
    const planner = await deployedAgentPubkey(page, "Planner");
    expect(planner).not.toBeNull();
    expect(fromPane?.tags).toContainEqual(["p", planner]);

    // And it is the same event shape, not merely an event with a `p` in it.
    expect(tagShape(fromPane)).toEqual(tagShape(fromChannel));
    expect(tagShape(fromPane)).toEqual(["h", "p"]);

    // The other member was not addressed: a mention is a mention, not a
    // broadcast to everything the deploy put in the channel.
    const builder = await deployedAgentPubkey(page, "Builder");
    expect(fromPane?.tags).not.toContainEqual(["p", builder]);
  });

  test("the channel is named for a human, and an older build's is renamed without losing it", async ({
    page,
  }) => {
    await openWorktree(page);
    await openThread(page);
    await waitForDeploy(page);

    // **What lands in his sidebar.** Team, project, branch — and nothing else:
    // no `wt-` in front of it and no hash on the end, because the list it is
    // going into had no name to collide with.
    const opened = await threadChannel(page);
    expect(opened?.name).toBe(THREAD_NAME);
    expect(opened?.name).not.toMatch(/^wt-/);
    expect(opened?.name).not.toMatch(/-[a-z0-9]{6}$/);

    // **And what the recovery path has left to match on.** The mark moved off
    // the name and into the description, which is where the worktree path
    // already was — asserted on the row `get_channels` returns, because that
    // is the list `findThreadChannel` reads and a mark the list did not carry
    // would be a recovery path that cannot work.
    expect(opened?.description).toContain(REPO.path);
    expect(opened?.description).toMatch(/\[vingilot-thread /);

    // Now put the channel back the way the build before this one left it: the
    // ugly name, and a description with no mark in it. This is the state of
    // #wt-main-welcome-team-kbz5pz on the owner's relay.
    const channelId = opened?.id ?? "";
    await page.evaluate(
      async ({ channelId, name }) => {
        const internals = (
          window as unknown as {
            __TAURI_INTERNALS__: {
              invoke: (cmd: string, args?: unknown) => Promise<unknown>;
            };
          }
        ).__TAURI_INTERNALS__;
        await internals.invoke("update_channel", {
          input: {
            channelId,
            description:
              "Worktree thread with Launch Team about /tmp/vingilot-left.",
            name,
          },
        });
        await window.__BUZZ_E2E_INVALIDATE_CHANNELS__?.();
      },
      { channelId, name: OLD_THREAD_NAME },
    );

    // On the first render that has it in hand, the pane asks for one edit that
    // gives it both halves back.
    await expect
      .poll(async () => (await threadChannel(page))?.name ?? null, {
        timeout: 15_000,
      })
      .toBe(THREAD_NAME);
    const repaired = await threadChannel(page);
    expect(repaired?.description).toMatch(/\[vingilot-thread /);
    // Appended to what was there, not written over it.
    expect(repaired?.description).toContain("Worktree thread with Launch Team");

    // **The pointer survived the rename** — it is the same channel id it was
    // before, and the pane is still standing in the conversation rather than
    // offering to open a new one.
    expect(repaired?.id).toBe(channelId);
    await expect(hostedComposer(page)).toBeVisible();
    await expect(page.getByTestId("team-trouble")).toHaveCount(0);
  });

  test("with no team configured it says so, and nothing is hosted", async ({
    page,
  }) => {
    await openWorktree(page, "none");
    await choosePane(page, "team");

    await expect(page.getByTestId("team-blocked")).toContainText(
      "No agent team is configured",
    );
    await expect(page.getByTestId("team-blocked")).toContainText(
      "Agents → Teams",
    );
    await expect(page.getByTestId("team-choice")).toBeHidden();
    await expect(page.getByTestId("team-thread")).toHaveCount(0);
    expect(await lastMessage(page)).toBeNull();
  });

  test("a deploy that fails does not call the thread it opened unopened", async ({
    page,
  }) => {
    await openWorktree(page);
    await page.evaluate(() => {
      window.__FAIL_DEPLOY__ = true;
    });
    await choosePane(page, "team");
    await page.getByTestId(`team-choice-${TEAM.id}`).click();
    await page.getByTestId("team-open").click();

    // The channel was made and this worktree's pointer written before the
    // members were deployed, so what is on screen is a working thread.
    await expect(hostedComposer(page)).toBeVisible({ timeout: 15_000 });
    const trouble = page.getByTestId("team-trouble");
    await expect(trouble).toContainText("the thread is open");
    await expect(trouble).toContainText("nobody may answer");
    await expect(trouble).toContainText("the agent store could not be read");
    // The sentence this test exists for: it used to say the opposite of the
    // composer sitting under it.
    await expect(trouble).not.toContainText("could not be opened");
    // And the failure really was before any member was minted.
    expect(await page.evaluate(() => window.__DEPLOYS__)).toBe(0);
  });

  test("changing team asks first, and the thread comes back without a second team", async ({
    page,
  }) => {
    await openWorktree(page);
    await openThread(page);
    const deployed = await page.evaluate(() => window.__DEPLOYS__);
    expect(deployed).toBeGreaterThan(0);

    // The control is in the pane's chrome, not beside a Send button, and one
    // click on it changes nothing — it asks, and names the channel it would let
    // go of.
    await page.getByTestId("team-change").click();
    const confirm = page.getByTestId("team-change-confirm");
    await expect(confirm).toContainText(`stops pointing at #${THREAD_NAME}`);
    await expect(confirm).toContainText("Nothing is deleted");
    await expect(confirm).toContainText("keep running");
    await expect(hostedComposer(page)).toBeVisible();

    // Declining leaves the thread exactly where it was.
    await page.getByTestId("team-change-no").click();
    await expect(confirm).toBeHidden();
    await expect(hostedComposer(page)).toBeVisible();

    // Accepting drops the pointer — and only the pointer.
    await page.getByTestId("team-change").click();
    await page.getByTestId("team-change-yes").click();
    await expect(page.getByTestId("team-choice")).toBeVisible();

    // The thread is still on the relay, so choosing the team again offers it
    // back rather than a second deploy.
    await page.getByTestId(`team-choice-${TEAM.id}`).click();
    await expect(page.getByTestId("team-existing")).toContainText(
      "already has a thread",
    );
    await page.getByTestId("team-adopt").click();
    await expect(hostedComposer(page)).toBeVisible();

    // Nothing was minted to get back into it.
    expect(await page.evaluate(() => window.__DEPLOYS__)).toBe(deployed);
  });

  test("a team list that could not be read is never reported as no teams", async ({
    page,
  }) => {
    await openWorktree(page, "unaskable");
    await choosePane(page, "team");

    const unsure = page.getByTestId("team-unsure");
    await expect(unsure).toContainText("could not ask");
    await expect(unsure).not.toContainText("No agent team is configured");
    // A refusal would have closed the pane. Not being told is not being
    // refused, so the choice is still offered — empty, and honest about why.
    await expect(page.getByTestId("team-blocked")).toBeHidden();
    await expect(page.getByTestId("team-choice")).toBeVisible();
  });
});

declare global {
  interface Window {
    /** Every event this app signed, in order — set by the stub above. The
     * kind:9 ones are the messages published to the relay. */
    __SIGNED__?: unknown[];
    /** How many managed agent processes have been minted since boot. */
    __DEPLOYS__: number;
    /** When true, the deploy's first call fails — an open whose channel was
     * made and whose members were not. */
    __FAIL_DEPLOY__?: boolean;
    /** Flush the channels query so a channel edited through the bridge is
     * visible to the app (declared by `e2eBridge.ts`). */
    __BUZZ_E2E_INVALIDATE_CHANNELS__?: () => Promise<void>;
  }
}
