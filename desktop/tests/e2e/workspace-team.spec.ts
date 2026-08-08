// Talking to a Buzz agent team about a worktree, proved against a real render
// (vingilot/docs/plans/2026-08-08-scratch-and-team-thread.md, Task 2).
//
// `teamThread.test.mjs` says what each sentence reads as and what a message is
// made of; `teamThreadStore.test.mjs` says what is kept and what is refused.
// What only a browser can say is the claim the task is judged on:
//
// - that **the scope on screen is the scope that is sent**. The sentence quotes
//   one line and the message carries it, and this spec asserts both against a
//   *literal* string rather than against the constant the renderer read — so a
//   change to either side turns it red. What crossed the boundary is read off
//   `sign_event`, which is where every relay message this app publishes is
//   signed;
// - that the conversation goes **to the relay**: the message is signed as a
//   kind:9 channel event addressed to a channel that did not exist before the
//   thread was opened, not written into any store of this pane's own;
// - that **"could not ask" is not "no"** — with `list_teams` throwing, the pane
//   says it could not ask and stays open, rather than reporting a machine with
//   no teams on it;
// - that with no team configured the pane says so, in its own sentence, and
//   offers nothing to type into.
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
 * therefore the exact string the scope has to carry (`projects.ts`'s
 * `worktreeCwd`). */
const REPO = { id: "repo-left", name: "vingilot", path: "/tmp/vingilot-left" };

/** Written out rather than composed from `SCOPE_PREFIX`: a spec that built the
 * expectation the same way the product does would pass through any change to
 * either. */
const SCOPE_LINE = "worktree: /tmp/vingilot-left";
const QUESTION = "why is the build red";

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
      if (name === "sign_event") {
        window.__SIGNED__?.push(args);
        // A relay hiccup, made to order. Signing is the first step of the
        // publish, so refusing it here is a send that fails before anything
        // leaves — which is exactly the case where the composer used to be
        // emptied anyway.
        const kind = (args as { kind?: number } | undefined)?.kind;
        if (window.__FAIL_SENDS__ === true && kind === 9) {
          return Promise.reject(new Error("the relay refused this message"));
        }
      }
      return passThrough(cmd, args, opts);
    };
  });
}

/** Open a thread with `TEAM` and wait until there is something to type into. */
async function openThread(page: Page) {
  await choosePane(page, "team");
  await expect(page.getByTestId("team-choice")).toBeVisible();
  await page.getByTestId(`team-choice-${TEAM.id}`).click();
  await page.getByTestId("team-open").click();
  await expect(page.getByTestId("team-composer")).toBeVisible({
    timeout: 15_000,
  });
}

async function openWorktree(page: Page, teams: TeamsMode = "seeded") {
  await page.setViewportSize({ height: 900, width: 1700 });
  await installMockBridge(page, { personas: PERSONAS, teams: [TEAM] });
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

test.describe("talk to a team about this worktree", () => {
  test("the scope on screen is the line the relay is actually sent", async ({
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
    await expect(scope).toContainText(SCOPE_LINE);
    await expect(scope).toContainText("not the diff");
    await expect(scope).toContainText("not the plan");
    // The branch is not in the message and is not claimed to be kept from the
    // team either: it is in the name of the channel this pane makes, which the
    // sentence now says rather than enumerating away.
    await expect(scope).toContainText("name of the channel");
    // The thing this pane has to say that ask-mode does not: the path is text,
    // not a directory the team is standing in.
    await expect(scope).toContainText("not started in this directory");

    await page.getByTestId("team-open").click();
    await expect(page.getByTestId("team-composer")).toBeVisible({
      timeout: 15_000,
    });
    // Nothing has been sent by opening a thread.
    expect(await lastMessage(page)).toBeNull();

    await page.getByTestId("team-composer").fill(QUESTION);
    await page.getByTestId("team-send").click();

    // What crossed the boundary, against the literal the scope claims.
    await expect
      .poll(async () => (await lastMessage(page))?.content ?? null, {
        timeout: 15_000,
      })
      .toBe(`${SCOPE_LINE}\n\n${QUESTION}`);

    // And it went to the relay as a channel message, addressed to the channel
    // this pane opened — not to a store of its own.
    const sent = await lastMessage(page);
    const channelTag = sent?.tags?.find((tag) => tag[0] === "h") ?? null;
    expect(channelTag).not.toBeNull();

    // The thread shows what was said without repeating the scope in the bubble.
    const thread = page.getByTestId("team-thread");
    await expect(thread).toContainText(QUESTION);
    await expect(thread).not.toContainText(SCOPE_LINE);
  });

  test("with no team configured it says so, and there is nothing to type into", async ({
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
    await expect(page.getByTestId("team-composer")).toBeHidden();
    expect(await lastMessage(page)).toBeNull();
  });

  test("a send that fails keeps every character he typed", async ({ page }) => {
    await openWorktree(page);
    await openThread(page);

    await page.evaluate(() => {
      window.__FAIL_SENDS__ = true;
    });
    const composer = page.getByTestId("team-composer");
    await composer.fill(QUESTION);
    await page.getByTestId("team-send").click();

    // It says the send failed, in the words of whatever refused it, and says
    // where the text is rather than leaving him to find out.
    const trouble = page.getByTestId("team-trouble");
    await expect(trouble).toContainText("did not go");
    await expect(trouble).toContainText("still in the composer");
    await expect(trouble).toContainText("the relay refused this message");

    // And the paragraph is still there, to the character.
    await expect(composer).toHaveValue(QUESTION);

    // The retry is a second click, not a retype.
    await page.evaluate(() => {
      window.__FAIL_SENDS__ = false;
    });
    await page.getByTestId("team-send").click();
    await expect
      .poll(async () => (await lastMessage(page))?.content ?? null, {
        timeout: 15_000,
      })
      .toBe(`${SCOPE_LINE}\n\n${QUESTION}`);
    // Accepted, and only now is the composer empty.
    await expect(composer).toHaveValue("");
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
    await expect(page.getByTestId("team-composer")).toBeVisible({
      timeout: 15_000,
    });
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

  test("a half-written message survives the pane being torn down and rebuilt", async ({
    page,
  }) => {
    await openWorktree(page);
    await openThread(page);

    const half = "the parser regressed when we";
    await page.getByTestId("team-composer").fill(half);

    // Out of the React heap and into storage on the keystroke — which is what a
    // relay reinit needs, since it remounts the whole community subtree
    // (`<AppReady key={communityKey}>`) and every `useState` under it.
    expect(
      await page.evaluate(() =>
        window.localStorage.getItem("vingilot-team-draft.v1"),
      ),
    ).toContain(half);

    // A real teardown: putting another pane in the slot unmounts this one and
    // everything it held, and coming back builds a fresh hook. Route navigation
    // is *not* enough here — the workspace screen survives it, so a spec that
    // used it would pass with the draft still sitting in React state, which is
    // the bug.
    await choosePane(page, "notes");
    await expect(page.getByTestId("team-composer")).toBeHidden();
    await choosePane(page, "team");

    await expect(page.getByTestId("team-composer")).toHaveValue(half);
    // And nothing was sent by any of it.
    expect(await lastMessage(page)).toBeNull();
  });

  test("changing team asks first, and the thread comes back without a second team", async ({
    page,
  }) => {
    await openWorktree(page);
    await openThread(page);
    const deployed = await page.evaluate(() => window.__DEPLOYS__);
    expect(deployed).toBeGreaterThan(0);

    // The control is not beside Send any more, and one click on it changes
    // nothing — it asks, and names the channel it would let go of.
    await page.getByTestId("team-change").click();
    const confirm = page.getByTestId("team-change-confirm");
    await expect(confirm).toContainText("stops pointing at #wt-");
    await expect(confirm).toContainText("Nothing is deleted");
    await expect(confirm).toContainText("keep running");
    await expect(page.getByTestId("team-composer")).toBeVisible();

    // Declining leaves the thread exactly where it was.
    await page.getByTestId("team-change-no").click();
    await expect(confirm).toBeHidden();
    await expect(page.getByTestId("team-composer")).toBeVisible();

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
    await expect(page.getByTestId("team-composer")).toBeVisible();

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
    /** When true, signing a kind:9 fails — a send that does not leave. */
    __FAIL_SENDS__?: boolean;
    /** When true, the deploy's first call fails — an open whose channel was
     * made and whose members were not. */
    __FAIL_DEPLOY__?: boolean;
  }
}
