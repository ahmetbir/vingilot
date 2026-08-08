// The Notes pane, proved against a real render
// (vingilot/docs/plans/2026-08-08-palette-and-documents.md, Task 3).
//
// `autosave.test.mjs` says when a write happens and what the owner is told
// about it; `documents.test.mjs` and `documentStore.test.mjs` say what is kept
// and where. What only a browser can say is the part the plan names as most
// likely to be got wrong quietly:
//
// - that **the editor really is unmounted** by the gestures the owner uses —
//   ⌥⌘B takes the right side away, the picker swaps the pane — and that the
//   keystrokes still inside the debounce when that happens are written anyway.
//   The unit test can only prove the machine flushes when told to; this proves
//   the component tells it, which is the half that was missing when this bug
//   shipped in other apps.
// - that a note **survives the page going away with the write still pending**.
//   The unmount flush cannot cover that one: quitting the app unmounts
//   nothing, so the only thing that can write is the window-level flush, and
//   whether it is really registered on the window is not something a unit test
//   can see. The edit and the teardown are dispatched inside one task here, so
//   the debounce provably has not fired — the test is not racing a timer.
// - that a note **survives a reload**, which is the whole claim of "a project
//   keeps its notes".
// - that the pane says where the note is kept, and never says "saved" before
//   the write.
//
// The unmount is done with the chord rather than the picker on purpose: the
// picker is a Radix menu with animations on both sides of the click, and the
// wait for them would run past the 600ms debounce, so the test would pass
// because the note had already been written — proving nothing. The chord is
// one keypress, well inside the window. The assertion on "unsaved" before it
// is what keeps that honest: if the debounce had already fired, that
// expectation is what fails.

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";

const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
const COORDINATOR_ORIGIN = "http://127.0.0.1:7117";

const REPO = {
  id: "repo-notes",
  name: "vingilot",
  path: "/tmp/vingilot-notes",
};
const OTHER = { id: "repo-other", name: "buzz", path: "/tmp/buzz-other" };

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

/** The home directory a worktree cwd derives from, plus the pty commands an
 * xterm asks for. Notes need neither — that is one of the things under test —
 * but the work surface around them does. */
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
    internals.invoke = (cmd, args, opts) => {
      const name = String(cmd);
      if (name.startsWith("plugin:path|")) return Promise.resolve("/tmp/home/");
      if (name === "pty_backing") return Promise.resolve("tmux");
      if (name.startsWith("pty_")) return Promise.resolve(null);
      return passThrough(cmd, args, opts);
    };
  });
}

async function openProject(page: Page, repoId: string) {
  await page.getByTestId(`projects-nav-repo-${repoId}`).click();
  await expect(page.getByTestId("work-surface")).toBeVisible();
}

async function openWorkspace(page: Page) {
  await page.setViewportSize({ height: 900, width: 1700 });
  await installMockBridge(page);
  await mockCoordinator(page);
  await page.goto("/#/workspace");
  await expect(page.getByTestId("runs-screen")).toBeVisible();
  // The home-dir lookup runs once on RunsScreen's mount, so the stub has to be
  // in place before the screen that reads it mounts; leaving and coming back
  // is what re-runs it (workspace-ask.spec.ts makes the same trip).
  await stubBackend(page);
  await page.goto("/#/");
  await page.goto("/#/workspace");
  await openProject(page, REPO.id);
}

async function choosePane(page: Page, key: string) {
  const picker = page.getByTestId("pane-picker");
  await picker.click();
  await expect(picker).toHaveAttribute("data-state", "open");
  await waitForAnimations(page);
  await page.getByTestId(`pane-choice-${key}`).click();
  await expect(picker).toHaveAttribute("data-state", "closed");
  await waitForAnimations(page);
}

/** Type into a document editor and tear the page down in the same breath.
 *
 * The edit is dispatched the way the browser dispatches one — the native value
 * setter, then an `input` event — so React's own handler runs and the autosave
 * timer is armed. The reload is queued on a 0ms timer from inside that same
 * task, so **no 600ms debounce can possibly have fired in between**: this is a
 * page ending with the owner's keystrokes still pending, with nothing raced
 * and no sleep. Nothing unmounts on the way out, which is exactly the case
 * quitting the app is.
 *
 * Returns nothing: what is asserted afterwards is what came back out of
 * storage on the other side of the reload. */
async function typeAndTearDown(page: Page, testId: string, text: string) {
  await page.evaluate(
    ({ testId, text }) => {
      const editor = document.querySelector(`[data-testid="${testId}"]`);
      if (!(editor instanceof HTMLTextAreaElement)) {
        throw new Error(`no textarea at ${testId}`);
      }
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setter?.call(editor, text);
      editor.dispatchEvent(new Event("input", { bubbles: true }));
      setTimeout(() => {
        window.location.reload();
      }, 0);
    },
    { testId, text },
  );
  await page.waitForLoadState("load");
}

/** ⌥⌘B — the right pane's box goes, and with it the editor inside it. One
 * keypress, so it lands well inside the autosave's window. */
async function hideRightPane(page: Page) {
  await page.keyboard.press("Alt+ControlOrMeta+b");
  await expect(page.getByTestId("pane-right-rail")).toBeVisible();
}

async function showRightPane(page: Page) {
  await page.getByTestId("pane-right-expand").click();
  await expect(page.getByTestId("pane-right")).toBeVisible();
}

test.describe("a project keeps its notes", () => {
  test("a note interrupted mid-debounce is written, not lost", async ({
    page,
  }) => {
    await openWorkspace(page);
    await choosePane(page, "notes");

    const editor = page.getByTestId("notes-editor");
    await expect(editor).toBeVisible();
    await editor.fill("the sentence I watched myself type");

    // Still inside the debounce: the pane says so, in as many words. If this
    // has already flipped to "saved" the rest of the test proves nothing, so
    // this expectation is the guard on the guard.
    await expect(page.getByTestId("notes-state")).toContainText("unsaved");

    // The editor's life ends here, with the write still pending.
    await hideRightPane(page);
    await showRightPane(page);

    await expect(page.getByTestId("notes-editor")).toHaveValue(
      "the sentence I watched myself type",
    );
    await expect(page.getByTestId("notes-state")).toHaveText("saved");
  });

  test("a note survives a reload, and belongs to its own project", async ({
    page,
  }) => {
    await openWorkspace(page);
    await choosePane(page, "notes");
    await page.getByTestId("notes-editor").fill("rebase before the demo");
    await expect(page.getByTestId("notes-state")).toHaveText("saved");

    // Another project is another document — not a shared scratchpad with the
    // first project's page in it.
    await openProject(page, OTHER.id);
    await choosePane(page, "notes");
    await expect(page.getByTestId("notes-editor")).toHaveValue("");
    await page.getByTestId("notes-editor").fill("ask about the relay");
    await expect(page.getByTestId("notes-state")).toHaveText("saved");

    // A restart throws away every module the editor ran through, so what is on
    // screen afterwards came out of storage.
    await page.reload();
    await expect(page.getByTestId("runs-screen")).toBeVisible();
    await stubBackend(page);
    await page.goto("/#/");
    await page.goto("/#/workspace");
    await openProject(page, REPO.id);
    await choosePane(page, "notes");
    await expect(page.getByTestId("notes-editor")).toHaveValue(
      "rebase before the demo",
    );
    await expect(page.getByTestId("notes-state")).toHaveText("saved");
    await openProject(page, OTHER.id);
    await expect(page.getByTestId("notes-editor")).toHaveValue(
      "ask about the relay",
    );
  });

  test("a note still inside the debounce survives the page going away", async ({
    page,
  }) => {
    await openWorkspace(page);
    await choosePane(page, "notes");
    await expect(page.getByTestId("notes-editor")).toBeVisible();

    // Nothing unmounts here — the page simply ends, which is what quitting the
    // app does to it. Only a window-level flush can have written this.
    await typeAndTearDown(
      page,
      "notes-editor",
      "the sentence the quit must not eat",
    );

    await expect(page.getByTestId("runs-screen")).toBeVisible();
    await stubBackend(page);
    await page.goto("/#/");
    await page.goto("/#/workspace");
    await openProject(page, REPO.id);
    await choosePane(page, "notes");
    await expect(page.getByTestId("notes-editor")).toHaveValue(
      "the sentence the quit must not eat",
    );
  });

  test("the pane says where the note is kept", async ({ page }) => {
    await openWorkspace(page);
    await choosePane(page, "notes");
    const scope = page.getByTestId("notes-scope");
    // The claim is about this project's path and about this machine — not
    // about the project directory, and not about a server.
    await expect(scope).toContainText(REPO.path);
    await expect(scope).toContainText("kept in this app on this machine");
    await expect(scope).toContainText("not in the project");
  });

  test("Notes is reachable from the palette, like every other pane", async ({
    page,
  }) => {
    await openWorkspace(page);
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByTestId("palette")).toBeVisible();
    await page.getByTestId("palette-input").fill("notes");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("palette")).toBeHidden();
    await expect(page.getByTestId("notes-editor")).toBeVisible();
  });
});
