// The scratch shell, proved against a real render
// (vingilot/docs/plans/2026-08-08-scratch-and-team-thread.md, Tasks 1 and 3).
//
// `scratchTerminal.test.mjs` says what opening, closing and the shielded keys
// *mean*. What only a browser can say is what the assembled app does with that
// model, and this spec is the three claims of that shape:
//
// 1. **Where the keyboard ends up** when the overlay closes — no pure model can
//    hold it, because the element it has to give the keyboard back to is an
//    element in a live document.
// 2. **That the header's path is the path the shell was really opened in**, and
//    that the sentence under it names the doors that end the shell. The model
//    knows the cwd it was given; only a render can say the owner is shown the
//    one that crossed the boundary to `pty_open`.
// 3. **That it leaves nothing behind** — no tab in the worktree's strip, no
//    line in the saved layout, no tmux session, and no pty left running when
//    the shell goes away, whichever door it goes away through.
//
// The keyboard claim first: **closing the scratch shell does not leave a
// keyboard owner on `<body>`**, from either door it can be opened through. Both
// doors matter separately, because the element focus must come back to is a
// different one in each and they are captured at different moments:
//
// - the chord (⌥⌘T) opens it with focus wherever the owner left it, so what has
//   to come back is that element;
// - ⌘K opens it from a palette that is itself taking focus back to where *it*
//   found it as it closes, which happens in the same commit the overlay mounts
//   in. A capture taken before that restore records the palette's own field —
//   an element that is already gone by the time it would be focused.
//
// Both tests end on a control outside the overlay, asserted by test id rather
// than by "not body", so a fix that parked focus somewhere arbitrary would not
// pass them either.

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

// Matches RunsScreen.tsx's hardcoded dev workspace id.
const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
const COORDINATOR_ORIGIN = "http://127.0.0.1:7117";

/** The main checkout *is* the repo, so this path is the worktree's cwd — which
 * is what makes the scratch openable at all (`scratchBlocked`). */
const REPO = { id: "repo-left", name: "vingilot", path: "/tmp/vingilot-left" };

/** Somewhere else to go. Its only job is to be a second worktree: leaving is
 * one of the doors `SCRATCH_PERSISTENCE` claims ends the shell, and a claim
 * about leaving needs somewhere to leave to. */
const OTHER = {
  id: "repo-right",
  name: "palantir",
  path: "/tmp/vingilot-right",
};

/** Written out rather than read off `REPO.path`: a spec that composed the
 * expectation the same way the product does would pass through any change to
 * either side of it. */
const CWD = "/tmp/vingilot-left";

/** The control focus is taken from and has to come back to. It is in the
 * projects nav, outside the overlay and outside the work surface, so nothing
 * the scratch does to the panes can move it. */
const ANCHOR = `projects-nav-repo-${REPO.id}`;

/** The saved layout, verbatim (`terminalTabStore.ts`'s `LAYOUT_KEY`). Compared
 * as the raw string, so a scratch that got itself written into any corner of it
 * — a tab, an ordinal, an active marker — shows up as a difference. */
const LAYOUT_KEY = "vingilot-terminal-tabs.v1";

async function mockCoordinator(page: Page) {
  await page.route(`${COORDINATOR_ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (method === "GET" && url.pathname === `/v1/workspaces/${WORKSPACE_ID}`) {
      return route.fulfill({
        json: {
          revision: 1,
          state: { repos: [REPO, OTHER] },
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

/** The home directory a worktree cwd derives from, the pty commands an xterm
 * needs, and a recorder on the two of them that decide a shell's whole life.
 *
 * No pty is real here — what the backend does with a plan is
 * `vingilot_pty`'s tests' and the live tmux tests' — but `pty_open` and
 * `pty_close` are the boundary this app's side of the bargain is visible at, so
 * they are where a claim about *which directory* and *nothing left running* can
 * be settled. `pty_backing` answers `tmux` deliberately: the machine having
 * tmux on it is exactly the state in which a scratch shell must still ask for
 * the direct spawn. */
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
    window.__OPENED__ = [];
    window.__CLOSED__ = [];
    internals.invoke = (cmd, args, opts) => {
      const name = String(cmd);
      if (name.startsWith("plugin:path|")) return Promise.resolve("/tmp/home/");
      if (name === "pty_backing") return Promise.resolve("tmux");
      if (name === "pty_open") {
        window.__OPENED__?.push(
          args as { session: string; cwd: string; ephemeral: boolean },
        );
      }
      if (name === "pty_close") {
        window.__CLOSED__?.push(String((args as { session: string }).session));
      }
      if (name.startsWith("pty_")) return Promise.resolve(null);
      return passThrough(cmd, args, opts);
    };
  });
}

/** How `pty_open` was called for the scratch shell — `null` while no scratch
 * has ever been opened, which several assertions here depend on being able to
 * tell apart from "opened, with the wrong plan". A scratch session id is the
 * one with no `#` in it (`scratchTerminal.ts`), which is also the property that
 * makes it uncollidable with a tab's. */
async function scratchOpen(page: Page) {
  return page.evaluate(() => {
    const opens = window.__OPENED__ ?? [];
    const scratches = opens.filter((open) => !open.session.includes("#"));
    return scratches[scratches.length - 1] ?? null;
  });
}

/** Whether the pty behind a session id has been told to end. */
async function wasClosed(page: Page, session: string) {
  return page.evaluate((id) => (window.__CLOSED__ ?? []).includes(id), session);
}

/** The saved layout as the exact string on disk, or `null` when nothing has
 * been written yet — which is itself a passing answer for a worktree whose tabs
 * nobody touched. */
async function savedLayout(page: Page) {
  return page.evaluate((key) => window.localStorage.getItem(key), LAYOUT_KEY);
}

async function openWorktree(page: Page) {
  await page.setViewportSize({ height: 900, width: 1700 });
  await installMockBridge(page);
  await mockCoordinator(page);
  await page.goto("/#/workspace");
  await expect(page.getByTestId("runs-screen")).toBeVisible();
  // The home-dir lookup runs once on RunsScreen's mount, so the stub has to be
  // in place before the screen that reads it mounts; leaving and coming back is
  // what re-runs it (workspace-team.spec.ts makes the same trip). Both gotos
  // are hash-only, so the document — and the stub on it — survives.
  await stubBackend(page);
  await page.goto("/#/");
  await page.goto("/#/workspace");
  await page.getByTestId(ANCHOR).click();
  await expect(page.getByTestId("work-surface")).toBeVisible();
  // Put the keyboard on it deliberately rather than relying on the click:
  // opening a project mounts the work surface, and a terminal that mounts
  // takes focus of its own accord. What both tests need is a known control
  // holding the keyboard at the moment the scratch is opened.
  await page.getByTestId(ANCHOR).focus();
  await expect(page.getByTestId(ANCHOR)).toBeFocused();
}

/** Where the keyboard actually is, as a test id rather than as a tag name —
 * `<body>` is the failure this spec exists for, and naming the element it
 * should be on instead is what makes the assertion able to fail for the right
 * reason. */
async function focusedTestId(page: Page) {
  return page.evaluate(
    () => document.activeElement?.getAttribute("data-testid") ?? null,
  );
}

test.describe("a terminal you can throw away, and get the keyboard back from", () => {
  test("the chord opens it and closing gives the keyboard back", async ({
    page,
  }) => {
    await openWorktree(page);

    await page.keyboard.press("ControlOrMeta+Alt+t");
    await expect(page.getByTestId("scratch-terminal")).toBeVisible();
    // The shell has the keyboard while it is open — that is the whole point of
    // the overlay, and it is also what takes focus off the anchor.
    expect(await focusedTestId(page)).not.toBe(ANCHOR);

    await page.getByTestId("scratch-close").click();
    await expect(page.getByTestId("scratch-terminal")).toBeHidden();
    expect(await focusedTestId(page)).toBe(ANCHOR);
  });

  test("the palette opens it and the chord closing gives the keyboard back", async ({
    page,
  }) => {
    await openWorktree(page);

    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByTestId("palette")).toBeVisible();
    // "scratch" alone stopped being an address when the markdown buffer
    // arrived (2026-08-12): two rows match it and Enter takes the top one,
    // whichever the ranking puts there. The shell is asked for by name.
    await page.getByTestId("palette-input").fill("scratch terminal");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("palette")).toBeHidden();
    await expect(page.getByTestId("scratch-terminal")).toBeVisible();

    // The same chord both ways (`resolveScratchKey`), so this also proves the
    // overlay's own listener is what answered it.
    await page.keyboard.press("ControlOrMeta+Alt+t");
    await expect(page.getByTestId("scratch-terminal")).toBeHidden();
    expect(await focusedTestId(page)).toBe(ANCHOR);
  });
});

test.describe("a terminal you can throw away, and what it says about itself", () => {
  test("the header names the directory the shell was really opened in, and the footer names the doors out", async ({
    page,
  }) => {
    await openWorktree(page);
    await page.keyboard.press("ControlOrMeta+Alt+t");
    await expect(page.getByTestId("scratch-terminal")).toBeVisible();

    // What the owner is shown …
    await expect(page.getByTestId("scratch-cwd")).toHaveText(CWD);
    // … and what actually crossed the boundary. The two being the same string
    // is the whole of "it says which": a header that named the worktree while
    // the shell started somewhere else would be worse than no header.
    const opened = await scratchOpen(page);
    expect(opened?.cwd).toBe(CWD);

    // And the plan it was opened with, on a machine that has tmux: the direct
    // spawn, which is what makes "no tmux session behind it" true rather than
    // a cleanup that has to work every time.
    expect(opened?.ephemeral).toBe(true);

    // The footer's sentence, against the doors it has to name. A shell that
    // ends when he walks away has to say so before he walks away — asserted as
    // the words on screen, since the tooltip is not what gets read.
    const boundary = page.getByTestId("scratch-boundary");
    await expect(boundary).toContainText("nothing is kept");
    await expect(boundary).toContainText("closing it or leaving ends it");
    // The cost of that, which is the half a lifetime sentence usually drops.
    await expect(boundary).toContainText("what it is running");
  });

  test("it leaves no tab, no line in the saved layout, and no shell running", async ({
    page,
  }) => {
    await openWorktree(page);

    const tabs = page.getByTestId(/^terminal-tab-\d+$/);
    const tabsBefore = await tabs.count();
    const layoutBefore = await savedLayout(page);

    await page.keyboard.press("ControlOrMeta+Alt+t");
    await expect(page.getByTestId("scratch-terminal")).toBeVisible();
    const session = (await scratchOpen(page))?.session ?? null;
    expect(session).not.toBeNull();

    // While it is open it is still not one of the worktree's terminals: the
    // strip it would have appeared in is right there behind the scrim.
    expect(await tabs.count()).toBe(tabsBefore);

    await page.getByTestId("scratch-close").click();
    await expect(page.getByTestId("scratch-terminal")).toBeHidden();

    // Nothing in the strip, and nothing in what a restart would read back.
    expect(await tabs.count()).toBe(tabsBefore);
    expect(await savedLayout(page)).toBe(layoutBefore);
    expect(await savedLayout(page)).not.toContain("vingilot-scratch");

    // And the shell itself really ended. Closing the overlay without closing
    // the pty is the residue that looks exactly like working, until the app has
    // run for a day.
    expect(await wasClosed(page, session ?? "")).toBe(true);
  });

  test("going to another project ends it, exactly as the footer says", async ({
    page,
  }) => {
    await openWorktree(page);
    await page.keyboard.press("ControlOrMeta+Alt+t");
    await expect(page.getByTestId("scratch-terminal")).toBeVisible();
    const session = (await scratchOpen(page))?.session ?? null;
    expect(session).not.toBeNull();

    await page.getByTestId(`projects-nav-repo-${OTHER.id}`).click();

    // Gone from the screen — a shell whose header named a checkout the owner
    // has left would be a shell lying about where it is …
    await expect(page.getByTestId("scratch-terminal")).toBeHidden();
    // … and gone from the machine, which is the half that is invisible and is
    // the one the footer's "or leaving" is a promise about.
    await expect.poll(async () => wasClosed(page, session ?? "")).toBe(true);
  });
});

declare global {
  interface Window {
    /** Every `pty_open` this app asked for, in order — set by the stub above.
     * `session` is what tells a scratch from a tab, `cwd` and `ephemeral` are
     * the two things a scratch's open has to get right. */
    __OPENED__?: { session: string; cwd: string; ephemeral: boolean }[];
    /** Every session id whose pty was told to end. */
    __CLOSED__?: string[];
  }
}
