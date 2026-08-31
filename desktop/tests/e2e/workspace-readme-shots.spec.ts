// The three workspace pictures the README shows, produced here rather than
// taken off a machine.
//
// The README's problem was that every screenshot in it was upstream's chat, so
// a reader had no way to see the thing this fork adds. The fix cannot be a
// photograph of the owner's screen: that would put his paths, his repositories
// and his keys in a public README, and it would rot the moment the layout
// moved. So the pictures are rendered from state this file seeds, over the
// mock bridge, by the same harness every other workspace spec uses.
//
// **This is a spec, not a screenshot script.** Each capture is gated on
// assertions that the seeded state actually reached the screen — the board's
// rows, the patch text in the Diff pane, the agents' own sentences in the
// thread, and the shell output in the terminal beside both. That gate is the
// point: an empty pane, a spinner, or a terminal that never took its bytes all
// render as a perfectly valid PNG, and only an assertion on the rendered text
// tells those apart from the picture that was wanted. A shot whose subject is
// not on screen turns this red instead of being committed.
//
// **Nothing here is real.** The projects, branches, patches and the exchange
// between the two agents are invented for this file. They are written to read
// like a morning's work — a token refresh that races under load, the test that
// catches it, the fix, and the review question after it — because a README
// full of `foo`/`bar` says nothing about what the screen is for.
//
// `worktree_diff` and the pty are stubbed for the same reason the other specs
// stub them: what is under test is what the panes draw, and a real git or a
// real shell would make the picture a property of the machine that ran it.

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";
import {
  COORDINATOR_ORIGIN,
  DIFF_FILES,
  PERSONAS,
  REPOS,
  runs,
  SUBJECT,
  TEAM,
  TERMINAL_DIFF,
  TERMINAL_TEAM,
  TRANSCRIPT,
  WORKSPACE_ID,
  WORKTREES,
} from "./workspace-readme-shots.fixtures";

/** Where the PNGs land. Under `test-results/` rather than straight into the
 * repo: a spec that wrote into `vingilot/docs/` would dirty the working tree
 * every time the suite ran. Copying them across is a deliberate act. */
const SHOTS = "test-results/readme-shots";

/** The window the pictures are taken in, and it is wider than it looks like it
 * needs to be for a reason worth writing down.
 *
 * The clamp ranks the terminal's 80 columns above everything else
 * (`paneModel.ts`), so on a narrow surface the right pane gets whatever is
 * left after 752px — and "whatever is left" was 215px at 1700, which is enough
 * to list four changed file names and not enough to show a single line of the
 * patch beside them. The pane was correct, the assertions were green, and the
 * picture was of a sidebar. A shot of the Diff pane has to be taken on a
 * surface that can seat the terminal's floor **and** a readable patch, and
 * that is what this width is: two panes of roughly 770 each, which is the
 * terminal's floor on one side and a file list plus a readable patch column
 * on the other.
 *
 * Below about 1400 the same clamp gives up on the split entirely and
 * `effectiveSolo` renders the terminal alone with the right pane on its rail —
 * also correct, also the wrong picture. */
const WINDOW = { height: 980, width: 2300 } as const;

/** How the surface is divided in the two arrangements. Seeded rather than
 * dragged: the divider is a pointer gesture whose landing pixel depends on
 * where the surface happens to start, and the arrangement is a fact about the
 * picture, not about the mouse. The clamp still has the last word — this is
 * what the owner may ask for, and 80 columns is what he is held to. */
const PANE_RATIO = 0.5;

// P3.1: the dock is a fixed 300–540px card now (`dockModel.ts`, birebir to
// the mockup's own clamp), not a ratio of the window — `expectReadablePane`
// used to assert a minimum width (700px) no window could get it under, and
// no window can get it OVER now either, because the dock stopped answering
// to the window at all. What survives is the claim the width number was
// standing in for: nothing in the pane is laid out wider than the pane. See
// `expectReadablePane`, below.

// ---------------------------------------------------------------------------
// Standing the app up
// ---------------------------------------------------------------------------

interface Probe {
  session: string | null;
}

declare global {
  interface Window {
    __SHOT_PROBE__: Probe;
    __SHOT_FEED__: (data: string) => void;
  }
}

/** The theme these pictures are taken in.
 *
 * Deliberate, and the one presentation decision this file makes. The stock
 * theme is upstream's honey-gradient `buzz`, which is what every screenshot
 * already in the README is taken in — so a workspace shot in it reads as
 * another picture of upstream. A dark editor theme is also simply the truthful
 * setting for the two arrangements below, both of which are mostly a terminal
 * and a patch. It is a theme the app ships and the owner can pick from the
 * theme list, not a stylesheet invented here. */
const THEME = "github-dark-dimmed";

/** What the community is called in these pictures.
 *
 * The mock bridge seeds one named "E2E Test" (helpers/bridge.ts), which is the
 * right name for a test fixture and the wrong one for a README: it tells a
 * reader they are looking at a harness rather than at a workspace. Registered
 * after `installMockBridge` so it overwrites that seed rather than being
 * overwritten by it — init scripts run in registration order. */
const COMMUNITY_NAME = "Atlas";

/** Who the viewer is in these pictures. Generic on purpose and matching the
 * invented home directory the projects sit under (`/home/dev/code/...`): the
 * repository is public, so the person at the keyboard in a README screenshot
 * has to be nobody in particular. */
const OWNER_NAME = "dev";

/** Seed the split the two arrangements are drawn in, keyed by the worktree
 * whose arrangement it is — the same key `paneStore.ts` writes. */
async function seedPaneRatio(page: Page) {
  await page.addInitScript(
    ({ key, ratio, worktree: id }) => {
      window.localStorage.setItem(key, JSON.stringify({ [id]: { ratio } }));
    },
    { key: "vingilot-panes.v1", ratio: PANE_RATIO, worktree: SUBJECT },
  );
}

/** Seed the active theme **before** the bridge installs: `ThemeProvider` reads
 * it on first mount, and the bridge is what triggers mount. */
async function seedTheme(page: Page) {
  await page.addInitScript(
    (theme) => window.localStorage.setItem("buzz-theme", theme),
    THEME,
  );
}

/** Rename the seeded community in place, keeping every other field the bridge
 * wrote — the id, the relay URL and the pubkey are load-bearing (the strict
 * onboarding voucher matches on the last of them), and rewriting the record
 * wholesale here would be re-implementing the fixture rather than editing it. */
async function seedCommunityName(page: Page) {
  await page.addInitScript((name) => {
    const raw = window.localStorage.getItem("buzz-communities");
    if (raw === null) return;
    const communities = JSON.parse(raw) as { name: string }[];
    if (communities[0] === undefined) return;
    communities[0].name = name;
    window.localStorage.setItem(
      "buzz-communities",
      JSON.stringify(communities),
    );
  }, COMMUNITY_NAME);
}

/** The coordinator these pictures read their projects, runs and worktrees
 * from: an HTTP double at the origin `coordinatorClient.ts` talks to, answering
 * the three GETs the workspace opens with and 404ing everything else by name,
 * so a route this file forgot shows up as a missing answer rather than as an
 * empty pane. */
async function mockCoordinator(page: Page) {
  await page.route(`${COORDINATOR_ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();

    if (method === "GET" && url.pathname === `/v1/workspaces/${WORKSPACE_ID}`) {
      return route.fulfill({
        json: {
          revision: 1,
          state: { repos: REPOS },
          state_hash: "mock-state-hash",
        },
      });
    }
    if (
      method === "GET" &&
      url.pathname === `/v1/workspaces/${WORKSPACE_ID}/runs`
    ) {
      return route.fulfill({ json: { runs: runs() } });
    }
    if (
      method === "GET" &&
      url.pathname === `/v1/workspaces/${WORKSPACE_ID}/worktrees`
    ) {
      return route.fulfill({ json: { worktrees: WORKTREES } });
    }
    return route.fulfill({
      json: { detail: `unmocked route: ${url.pathname}`, error: "not_found" },
      status: 404,
    });
  });
}

/** The two things that have to be true before the app's first render, and the
 * whole reason this is separate from `stubBackend`.
 *
 * The first is `projects_load`. The local project file is read on
 * `RunsScreen`'s first render, and a rejection there is *reported* — the
 * projects column prints a paragraph saying this machine's project list could
 * not be read and that nothing will be written to it. Which is correct
 * behaviour against a bridge that mocks no such command, and a paragraph of
 * mock-harness error text in the middle of a README picture. `null` is the
 * honest answer for the workspace these pictures show: no local project file
 * yet, every project coming from the coordinator.
 *
 * The second is the viewer's own name. The mock identity's display name is the
 * literal string `npub1mock...` (e2eBridge.ts), which is the right name for a
 * fixture and, in a published README, a picture with the word *mock* printed
 * in it twice — in the sidebar and over every message the owner sent. So the
 * first command the app issues is preceded by `update_profile`, the same
 * command the profile settings screen sends, which renames the identity in the
 * mock relay itself: the sidebar, the message authors and the member lists all
 * read that one record, so they agree without any of them being patched. It
 * has to land before the app's first `get_profile`, and this wrapper is the
 * only place that can be guaranteed. */
async function stubBeforeBoot(page: Page, owner: string) {
  await page.addInitScript((ownerName: string) => {
    type Invoke = (cmd: string, args?: unknown, opts?: unknown) => unknown;
    type Internals = { invoke: Invoke };

    // The bridge is installed by the app bundle (`mockIPC` in main.tsx), not
    // by an init script, so there is nothing to patch at this point — and
    // `mockIPC` assigns the holder before it assigns `invoke`. So the hook is
    // an accessor that wraps the FIRST `invoke` written to it and then gets
    // out of the way: `stubBackend` reads this wrapper, chains onto it, and
    // writes its own, which must be stored as given or the two would call each
    // other forever. (The same trap `workspace-team.spec.ts` uses.)
    const hook = (internals: Internals) => {
      let current: Invoke | undefined;
      let wrapped = false;
      let named = false;
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
            const name = String(cmd);
            if (name === "projects_load") return Promise.resolve(null);
            if (name === "projects_save") return Promise.resolve(null);
            if (!named) {
              // Set before the await, so a second command arriving while the
              // rename is in flight queues behind it rather than sending a
              // rename of its own.
              named = true;
              return Promise.resolve(
                next("update_profile", { displayName: ownerName }),
              ).then(() => next(cmd, args, opts));
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
  }, owner);
}

/** The Tauri surfaces these pictures need: a home directory to derive worktree
 * cwds from, a pty that answers and can be fed real bytes on the app's own
 * event channel, and a `worktree_diff` whose answer this file owns. */
async function stubBackend(page: Page) {
  await page.evaluate(
    ({ files }) => {
      const internals = (
        window as unknown as {
          __TAURI_INTERNALS__: {
            invoke: (cmd: string, args?: unknown, opts?: unknown) => unknown;
          };
        }
      ).__TAURI_INTERNALS__;
      const passThrough = internals.invoke.bind(internals);

      const probe: Probe = { session: null };
      window.__SHOT_PROBE__ = probe;

      let seq = 1;
      const emitChunk = (payload: {
        data: string;
        replay: boolean;
        seq: number;
        session: string;
      }) => {
        void passThrough("plugin:event|emit", {
          event: "vingilot://pty",
          payload,
        });
      };

      window.__SHOT_FEED__ = (data: string) => {
        if (probe.session === null) throw new Error("no session opened yet");
        emitChunk({ data, replay: false, seq: seq++, session: probe.session });
      };

      const diff = {
        additions: files.reduce((sum, file) => sum + file.additions, 0),
        base: "HEAD",
        deletions: files.reduce((sum, file) => sum + file.deletions, 0),
        files: files.map((file) => ({
          ...file,
          binary: false,
          oldPath: null,
          truncated: false,
        })),
        limits: {
          maxFiles: 400,
          maxPatchBytes: 262_144,
          maxPatchLines: 2_000,
          maxUntracked: 100,
        },
        omittedFiles: 0,
        omittedUntracked: 0,
      };

      internals.invoke = (cmd, args, opts) => {
        const name = String(cmd);
        const payload = (args ?? {}) as Record<string, string>;
        if (name.startsWith("plugin:path|")) {
          return Promise.resolve("/home/dev/");
        }
        if (name === "pty_backing") return Promise.resolve("tmux");
        if (name === "pty_open") {
          probe.session = payload.session;
          // What the backend does from inside `pty_open` on the spawn branch:
          // one replay, empty, mark 0 (vingilot_pty/mod.rs).
          queueMicrotask(() =>
            emitChunk({
              data: "",
              replay: true,
              seq: 0,
              session: payload.session,
            }),
          );
          return Promise.resolve(null);
        }
        if (name.startsWith("pty_")) return Promise.resolve(null);
        if (name === "worktree_diff") return Promise.resolve(diff);
        return passThrough(cmd, args, opts);
      };
    },
    { files: DIFF_FILES },
  );
}

/** The workspace, on the subject worktree, with the terminal fed. */
async function openSubject(page: Page, terminal: string[] | null) {
  await page.setViewportSize(WINDOW);
  await seedTheme(page);
  await seedPaneRatio(page);
  await installMockBridge(page, { personas: PERSONAS, teams: [TEAM] });
  await seedCommunityName(page);
  await stubBeforeBoot(page, OWNER_NAME);
  await mockCoordinator(page);
  await page.goto("/#/workspace");
  await expect(page.getByTestId("runs-screen")).toBeVisible();

  // The home-dir lookup runs once, on RunsScreen's mount, and nothing that
  // needs a cwd works without it — so the stub has to be in place before the
  // screen that reads it mounts. Both gotos are hash-only, so the document and
  // the stub on it survive the trip.
  await stubBackend(page);
  await page.goto("/#/");
  await page.goto("/#/workspace");

  await dismissImportNotice(page);
  await page.getByTestId("projects-nav-repo-repo-atlas").click();
  await expect(page.getByTestId("work-surface")).toBeVisible();
  await page.getByTestId(`worktree-row-${SUBJECT}`).click();

  if (terminal !== null) await feedTerminal(page, terminal);
}

/** The pane on the right renders without clipping its own furniture — not
 * "wide", which the dock (P3.1 note above) no longer promises at any window
 * size, but honest: nothing inside it is laid out wider than the box it is
 * in. `workspace-diff-fits.spec.ts`'s own overflow reading, reused here for
 * the same reason it exists there.
 *
 * Every other assertion in this file is on text, and text is in the DOM at any
 * width — including the width at which a column is laid out past the edge of
 * the window. This is the one assertion that would have caught that, and it
 * is here because it did not exist the first time and the picture came out of
 * a run that was entirely green. */
async function expectReadablePane(page: Page, testId: string) {
  const overflow = await page.evaluate((id) => {
    const pane = document.querySelector(`[data-testid="${id}"]`);
    if (pane === null) return ["no pane"];
    const limit = pane.getBoundingClientRect().width;
    const scrolled = (element: Element) => {
      let node: Element | null = element.parentElement;
      while (node !== null && node !== pane) {
        const overflowX = getComputedStyle(node).overflowX;
        if (overflowX === "auto" || overflowX === "scroll") return true;
        node = node.parentElement;
      }
      return false;
    };
    return Array.from(pane.querySelectorAll("*"))
      .filter(
        (el) => el.getBoundingClientRect().width > limit + 1 && !scrolled(el),
      )
      .map(
        (el) =>
          `${el.tagName.toLowerCase()} ${Math.round(el.getBoundingClientRect().width)} > ${Math.round(limit)}`,
      );
  }, testId);
  expect(overflow).toEqual([]);
}

/** Read and dismiss the one-time notice the projects column shows the first
 * time it copies the coordinator's projects into the local store.
 *
 * It is correct, it is worth reading once, and it is the size of the column it
 * sits in — so it would be the largest single block of text in a picture whose
 * subject is somewhere else entirely. Dismissed the way the owner dismisses
 * it, by its own button, rather than suppressed. */
async function dismissImportNotice(page: Page) {
  const dismiss = page.getByTestId("projects-nav-import-notice-dismiss");
  await expect(dismiss).toBeVisible();
  await dismiss.click();
  await expect(page.getByTestId("projects-nav-import-notice")).toHaveCount(0);
}

/** Write lines into whatever session the terminal opened, once it has opened
 * one. The open waits on a measurement (`terminalFit.ts`), so the session id
 * does not exist at the moment the row is clicked. */
async function feedTerminal(page: Page, lines: string[]) {
  await expect
    .poll(() => page.evaluate(() => window.__SHOT_PROBE__?.session ?? null))
    .not.toBeNull();
  await page.evaluate(
    (data) => window.__SHOT_FEED__(data),
    `${lines.join("\r\n")}`,
  );
}

/** Put a pane on the dock: the four with a fixed tab (files/diff/history, and
 * team under its "crew" tab) light their tab directly (`dock.spec.ts`'s
 * idiom); anything else has no tab and is chosen from the palette — the
 * dock's only door onto it (`dockModel.ts`). */
async function choosePane(page: Page, key: string) {
  const tab = key === "team" ? "crew" : key;
  if (
    tab === "crew" ||
    tab === "diff" ||
    tab === "files" ||
    tab === "history"
  ) {
    await page.getByTestId(`dock-tab-${tab}`).click();
    return;
  }
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByTestId("palette")).toBeVisible();
  await page.getByTestId("palette-input").fill(key);
  await page.getByTestId(`palette-row-pane:${key}`).click();
  await expect(page.getByTestId("palette")).toHaveCount(0);
  await waitForAnimations(page);
}

/** The channel this worktree's thread pointer names, read off the relay's own
 * list — the name is derived by the product from the team, the project
 * directory and the branch, so reading it back is the only way to address it
 * without re-deriving it here and asserting a spec against itself. */
async function threadChannelName(page: Page): Promise<string> {
  const name = await page.evaluate(async () => {
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
    const result = (await internals.invoke("get_channels")) as {
      channels: { id: string; name: string }[] | null;
    };
    return (
      result.channels?.find((channel) => channel.id === channelId)?.name ?? null
    );
  });
  if (name === null) throw new Error("no thread channel was opened");
  return name;
}

/** The pubkey the deploy minted for a team member, read back out of the list
 * the app's own mention candidates are built from. */
async function memberPubkey(page: Page, name: string): Promise<string> {
  const pubkey = await page.evaluate(async (agentName) => {
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
  if (pubkey === null) throw new Error(`${name} was never deployed`);
  return pubkey;
}

/** Messages are dropped on the floor without a live subscription, so this is
 * the wait that separates "the thread is open" from "the thread is listening". */
async function waitForLiveSubscription(page: Page, channelName: string) {
  await expect
    .poll(() =>
      page.evaluate(
        (name) =>
          window.__BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?.({
            channelName: name,
          }) ?? false,
        channelName,
      ),
    )
    .toBe(true);
}

/** Read the thread to the end, which is what puts the unread pill away.
 *
 * The pill floats over the top of the timeline and, in a pane this size, lands
 * across the header cards underneath it — real UI, transient, and in a still
 * picture indistinguishable from a rendering fault. It does not time out.
 * `MessageTimeline` retires it on one of two gestures: a jump to the oldest
 * unread, or reaching the bottom — and reaching means *becoming* at the
 * bottom, so a timeline that was already there when the messages landed keeps
 * its pill indefinitely. The jump is the cheaper call and the wrong one for a
 * picture: it leaves the newest message half under the composer and the jumped
 * to row lit with the target highlight. So this scrolls up and comes back,
 * which retires the pill, ends on the newest message, and highlights nothing.
 *
 * Both steps are asserted, because both are silent when they do not happen:
 * the wheel is a no-op on a timeline that does not overflow, and a picture of
 * an undismissed pill is a perfectly valid PNG. */
async function readToTheEnd(page: Page) {
  const pill = page.getByTestId("message-unread-pill");
  await expect(pill).toBeVisible();

  const thread = page.getByTestId("team-thread");
  await thread.hover();
  await page.mouse.wheel(0, -600);

  const toLatest = page.getByTestId("message-scroll-to-latest");
  await expect(toLatest).toBeVisible();
  await toLatest.click();
  await expect(toLatest).toHaveCount(0);
  await expect(pill).toHaveCount(0);

  // And take the cursor back off the timeline. The wheel above needs a pointer
  // over the pane, and a pointer over a message row reveals that row's action
  // bar — four reaction buttons and a menu, drawn over the message under the
  // mouse. It is CSS-only (`group-hover/message`), so Playwright still calls it
  // visible and no locator assertion would catch it; the opacity is the only
  // witness there is.
  await page.mouse.move(0, 0);
  await expect
    .poll(() =>
      page.evaluate(() =>
        Array.from(
          document.querySelectorAll('[data-testid^="message-action-bar-"]'),
        ).every((bar) => window.getComputedStyle(bar).opacity === "0"),
      ),
    )
    .toBe(true);
}

// ---------------------------------------------------------------------------
// The pictures
// ---------------------------------------------------------------------------

test.describe("the pictures the README shows", () => {
  test("the landing board: every worktree in the workspace, strongest signal first", async ({
    page,
  }) => {
    await page.setViewportSize(WINDOW);
    await seedTheme(page);
    await installMockBridge(page);
    await seedCommunityName(page);
    await stubBeforeBoot(page, OWNER_NAME);
    await mockCoordinator(page);
    await page.goto("/#/workspace");
    await expect(page.getByTestId("runs-screen")).toBeVisible();
    await expect(page.getByTestId("deck-pane")).toBeVisible();

    // The projects column says what it knows and nothing about a store it
    // could not read — the paragraph the unmocked `projects_load` produces is
    // correct behaviour and the wrong thing to photograph.
    await expect(page.getByTestId("runs-screen")).not.toContainText(
      "could not be read",
    );
    await dismissImportNotice(page);

    // The gate. Nine rows means the six seeded worktrees and the checkout each
    // project gets, so a board drawn from an empty or half-loaded workspace
    // cannot be photographed here.
    const rows = page.getByTestId("triage-board").getByRole("button");
    await expect(rows).toHaveCount(9);
    await expect(page.getByTestId("triage-headline")).toContainText(
      "2 worktrees need you",
    );
    await expect(page.getByTestId(`triage-row-${SUBJECT}`)).toContainText(
      "fix/token-refresh-race",
    );
    await expect(page.getByTestId("triage-row-wt-ledger-parse")).toContainText(
      "perf/statement-parse",
    );
    // The rename landed: nothing on screen still calls the viewer a mock.
    await expect(page.getByTestId("runs-screen")).not.toContainText(
      "npub1mock",
    );
    await expect(page.getByTestId("app-sidebar")).toContainText(OWNER_NAME);

    await waitForAnimations(page);
    await page.screenshot({ path: `${SHOTS}/workspace-board.png` });
  });

  test("terminal and diff: the shell that ran the test, and the patch that fixed it", async ({
    page,
  }) => {
    await openSubject(page, TERMINAL_DIFF);
    await choosePane(page, "diff");
    await expect(page.getByTestId("pane-diff")).toBeVisible();

    // P3.1: the dock's default width is under `LIST_LEAVES_BELOW_PX`
    // (`workspace-diff-fits.spec.ts` — birebir to the mockup's own clamp), so
    // the list is a drawer here, not a column beside the patch the way the
    // old ratio pane could stand it. The gate this test owes the seeded
    // fixture — that "4 files changed" is real data, not an empty pane that
    // happens to render — is read through that drawer, the same "one gesture
    // away" affordance `workspace-diff-fits.spec.ts` proves for exactly this
    // width; the drawer is closed again before the picture, which is of the
    // patch, not of the list.
    const diff = page.getByTestId("pane-diff");
    await diff.getByTestId("worktree-diff-list-toggle").click();
    const files = page.getByTestId("worktree-diff-files");
    await expect(files).toContainText("internal/auth/refresh.go");
    await expect(files).toContainText("internal/auth/refresh_test.go");
    await diff.getByTestId("worktree-diff-list-toggle").click();
    await expect(files).toHaveCount(0);

    // The fix itself, in the patch on the right — the first file's, which is
    // the one the pane opens on and therefore the one in the picture.
    await expect(diff).toContainText("s.group.Do(subject, refresh)");
    await expectReadablePane(page, "pane-diff");
    const terminal = page.getByTestId("pane-left");
    await expect(terminal).toContainText("TestRefreshConcurrent");
    await expect(terminal).toContainText("4.812s");

    await waitForAnimations(page);
    await page.screenshot({ path: `${SHOTS}/workspace-terminal-diff.png` });
  });

  test("terminal and team: the agents working on this branch, in the pane beside it", async ({
    page,
  }) => {
    await openSubject(page, TERMINAL_TEAM);
    await choosePane(page, "team");

    await expect(page.getByTestId("team-choice")).toBeVisible();
    await page.getByTestId(`team-choice-${TEAM.id}`).click();
    await page.getByTestId("team-open").click();
    await expect(
      page.getByTestId("team-thread").getByTestId("message-composer"),
    ).toBeVisible({ timeout: 30_000 });

    // The exchange, put on the relay the way any other message reaches it.
    const channelName = await threadChannelName(page);
    await waitForLiveSubscription(page, channelName);
    const authors: Record<string, string> = {
      Builder: await memberPubkey(page, "Builder"),
      Planner: await memberPubkey(page, "Planner"),
    };
    const start = Math.floor(Date.now() / 1000) - 9 * 60;
    for (const [index, line] of TRANSCRIPT.entries()) {
      await page.evaluate(
        (message) => {
          window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
            channelName: message.channelName,
            content: message.content,
            createdAt: message.createdAt,
            pubkey: message.pubkey,
          });
        },
        {
          channelName,
          content: line.text,
          createdAt: start + index * 95,
          pubkey: line.author === null ? undefined : authors[line.author],
        },
      );
    }

    // The gate: both agents' own sentences on screen, and the terminal beside
    // them holding this arrangement's bytes rather than the other one's.
    const thread = page.getByTestId("team-thread");
    await expect(thread).toContainText("Planner");
    await expect(thread).toContainText("Builder");
    await expect(thread).toContainText("Key a singleflight.Group by subject");
    await expect(thread).toContainText("Do deletes the key when the call");
    await expect(thread).not.toContainText("npub1mock");
    // The overflow read below measures laid-out boxes, not text — settle the
    // message list's own arrival animation first, or an in-flight reflow
    // reads as a false overflow (seen once in the full-suite run, never in
    // isolation).
    await waitForAnimations(page);
    await expectReadablePane(page, "pane-team");

    await readToTheEnd(page);
    const terminal = page.getByTestId("pane-left");
    await expect(terminal).toContainText("single-flight the refresh");
    await expect(terminal).toContainText("test-race");

    await waitForAnimations(page);
    await page.screenshot({ path: `${SHOTS}/workspace-terminal-team.png` });
  });
});
