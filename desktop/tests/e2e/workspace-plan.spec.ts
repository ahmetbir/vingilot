// The Plan pane and the worktree it opens, proved against a real render
// (vingilot/docs/plans/2026-08-08-palette-and-documents.md, Task 4).
//
// **What git does is proved in Rust, over real repositories**
// (`vingilot_worktree/brief.rs`'s tests): that a refused creation writes no
// file, that a `PLAN.md` already on the base branch is never written over,
// that a name which is a path cannot reach outside the worktree. None of that
// can be asserted from a browser, and none of it is asserted here.
//
// What only a browser can say is the half in front of it, and it is the half
// the plan is judged on:
//
// - that the plan is **its own document**, not the notes with a flag — two
//   panes, two texts, neither reachable from the other;
// - that the branch name is **offered and editable**, and that what crosses
//   the Tauri boundary is what was in the field, together with the plan the
//   owner can see and the filename the pane names;
// - that a **refusal is words on screen and a dialog still open** — nothing
//   selected, nothing claimed;
// - that a worktree which was created **whose brief was refused** is reported
//   as both of those things, because that is the one outcome where a dialog
//   that closed would be a lie.
//
// The backend is stubbed at the Tauri boundary the same way the agent is in
// workspace-ask.spec.ts. The stub records its arguments, so the assertion
// about what was sent is about what crossed the boundary rather than about
// what the dialog printed.

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";

const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
const COORDINATOR_ORIGIN = "http://127.0.0.1:7117";

const REPO = { id: "repo-plan", name: "vingilot", path: "/tmp/vingilot-plan" };

/** Where `worktreePathFor` puts a branch, given the stubbed home directory. */
const WORKTREE_ROOT = "/tmp/home/.vingilot/worktrees";

/** What `worktree_add_with_brief` is told to answer. */
type Answer = "created" | "branch-exists" | "brief-refused";

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

/** The home directory a worktree path derives from, the pty commands an xterm
 * asks for, and the two worktree commands this feature uses.
 *
 * `worktree_list` answers from a list the stub keeps, so a creation the test
 * makes shows up in the column afterwards exactly as git's re-listing would
 * put it there. */
async function stubBackend(page: Page, answer: Answer) {
  await page.evaluate(
    ({ answer, root }) => {
      const internals = (
        window as unknown as {
          __TAURI_INTERNALS__: {
            invoke: (cmd: string, args?: unknown, opts?: unknown) => unknown;
          };
        }
      ).__TAURI_INTERNALS__;
      const scope = window as unknown as {
        __PLAN_SENT__?: Record<string, unknown>;
        __WORKTREES__?: unknown[];
      };
      scope.__WORKTREES__ = [];
      const passThrough = internals.invoke.bind(internals);
      internals.invoke = (cmd, args, opts) => {
        const name = String(cmd);
        if (name.startsWith("plugin:path|"))
          return Promise.resolve("/tmp/home/");
        if (name === "pty_backing") return Promise.resolve("tmux");
        if (name.startsWith("pty_")) return Promise.resolve(null);
        if (name === "worktree_list") {
          return Promise.resolve(scope.__WORKTREES__ ?? []);
        }
        if (name === "worktree_stats") return Promise.resolve([]);
        if (name === "worktree_add_with_brief") {
          const sent = args as Record<string, string>;
          scope.__PLAN_SENT__ = sent;
          if (answer === "branch-exists") {
            return Promise.reject({
              branch: sent.branch,
              kind: "branch-exists",
            });
          }
          const path = `${root}/repo-plan/${sent.branch}`;
          const worktree = {
            branch: sent.branch,
            detached: false,
            head: "abc123",
            isMain: false,
            locked: false,
            path,
            prunable: false,
          };
          scope.__WORKTREES__ = [...(scope.__WORKTREES__ ?? []), worktree];
          if (answer === "brief-refused") {
            return Promise.resolve({
              brief: null,
              briefRefusal: { kind: "brief-exists", path: `${path}/PLAN.md` },
              worktree,
            });
          }
          return Promise.resolve({
            brief: `${path}/PLAN.md`,
            briefRefusal: null,
            worktree,
          });
        }
        return passThrough(cmd, args, opts);
      };
    },
    { answer, root: WORKTREE_ROOT },
  );
}

async function openWorkspace(page: Page, answer: Answer = "created") {
  await page.setViewportSize({ height: 900, width: 1700 });
  await installMockBridge(page);
  await mockCoordinator(page);
  await page.goto("/#/workspace");
  await expect(page.getByTestId("runs-screen")).toBeVisible();
  // The home-dir lookup runs once on RunsScreen's mount, so the stub has to be
  // in place before the screen that reads it mounts; leaving and coming back
  // is what re-runs it (workspace-notes.spec.ts makes the same trip).
  await stubBackend(page, answer);
  await page.goto("/#/");
  await page.goto("/#/workspace");
  await page.getByTestId(`projects-nav-repo-${REPO.id}`).click();
  await expect(page.getByTestId("work-surface")).toBeVisible();
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

/** A plan in the pane, saved. The dialog reads storage, so "saved" is the
 * state that has to be reached before it is opened — not a wait for time. */
async function writePlan(page: Page, text: string) {
  await choosePane(page, "plan");
  await page.getByTestId("plan-editor").fill(text);
  await expect(page.getByTestId("plan-state")).toHaveText("saved");
}

async function openDialog(page: Page) {
  await page.getByTestId("plan-to-worktree").click();
  await expect(page.getByTestId("plan-worktree-dialog")).toBeVisible();
  await waitForAnimations(page);
}

test.describe("a plan becomes a worktree", () => {
  test("the plan is its own document, not the notes with a flag", async ({
    page,
  }) => {
    await openWorkspace(page);
    await writePlan(page, "# Carry the brief\n\nwhat the work is\n");

    await choosePane(page, "notes");
    await expect(page.getByTestId("notes-editor")).toHaveValue("");
    await page.getByTestId("notes-editor").fill("something else entirely");
    await expect(page.getByTestId("notes-state")).toHaveText("saved");

    await choosePane(page, "plan");
    await expect(page.getByTestId("plan-editor")).toHaveValue(
      "# Carry the brief\n\nwhat the work is\n",
    );
  });

  test("the branch is offered from the title, edited, and it is the edit that is sent", async ({
    page,
  }) => {
    await openWorkspace(page);
    await writePlan(page, "# Keep the 80th column\n\nthe terminal's floor.\n");
    await openDialog(page);

    const branch = page.getByTestId("plan-worktree-branch");
    await expect(branch).toHaveValue("keep-the-80th-column");
    await expect(page.getByTestId("plan-worktree-derivation")).toContainText(
      "Keep the 80th column",
    );
    // The directory is shown before it exists, and the brief with it.
    await expect(page.getByTestId("plan-worktree-landing")).toContainText(
      `${WORKTREE_ROOT}/${REPO.id}/keep-the-80th-column/PLAN.md`,
    );

    // Offered, not taken: what git is asked for is what is in the field.
    await branch.fill("terminal-floor");
    await page.getByTestId("plan-worktree-create").click();
    await expect(page.getByTestId("plan-worktree-dialog")).toBeHidden();

    const sent = await page.evaluate(
      () =>
        (window as unknown as { __PLAN_SENT__?: Record<string, unknown> })
          .__PLAN_SENT__,
    );
    expect(sent).toMatchObject({
      base: "HEAD",
      branch: "terminal-floor",
      name: "PLAN.md",
      repo: REPO.path,
      text: "# Keep the 80th column\n\nthe terminal's floor.\n",
    });
    expect(sent?.path).toBe(`${WORKTREE_ROOT}/${REPO.id}/terminal-floor`);

    // And the workspace is standing in it: one new row, and it is the one
    // selected — the point of the act is to be *in* the worktree afterwards.
    const row = page.locator('[data-testid^="worktree-row-local:"]');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("terminal-floor");
    // Selected, not merely listed: the status bar names where the owner is.
    await expect(page.getByTestId("project-status-bar")).toContainText(
      "terminal-floor",
    );
  });

  test("a branch that already exists is reported, and nothing is claimed", async ({
    page,
  }) => {
    await openWorkspace(page, "branch-exists");
    await writePlan(page, "# Taken already\n");
    await openDialog(page);
    await page.getByTestId("plan-worktree-create").click();

    const refusal = page.getByTestId("plan-worktree-refusal");
    await expect(refusal).toContainText("already exists");
    await expect(refusal).toContainText("nothing was changed");
    // Still open, on the fields that produced it, so the name can be changed
    // where it was typed.
    await expect(page.getByTestId("plan-worktree-dialog")).toBeVisible();
    await expect(page.getByTestId("plan-worktree-branch")).toHaveValue(
      "taken-already",
    );
    // No row for it. Asserted on the rows rather than on the column's text:
    // the column renders the same refusal, which quotes the branch name, so a
    // text assertion there would be reading the refusal as a worktree.
    await expect(
      page.locator('[data-testid^="worktree-row-local:"]'),
    ).toHaveCount(0);
  });

  test("a worktree whose brief was refused is reported as both", async ({
    page,
  }) => {
    await openWorkspace(page, "brief-refused");
    await writePlan(page, "# Already briefed\n\nthe base branch has one.\n");
    await openDialog(page);
    await page.getByTestId("plan-worktree-create").click();

    // Closing here would report a success the owner did not get; the worktree
    // is real and the plan is still only in the pane.
    const partial = page.getByTestId("plan-worktree-partial");
    await expect(partial).toContainText("was created on already-briefed");
    await expect(partial).toContainText("the plan was not copied into it");
    await expect(partial).toContainText("Nothing was removed");
    await expect(page.getByTestId("plan-worktree-dialog")).toBeVisible();
    // Re-pressing it would now fail on a branch that exists, so it cannot be.
    await expect(page.getByTestId("plan-worktree-create")).toBeDisabled();
  });

  test("an empty plan refuses the act rather than opening an empty worktree", async ({
    page,
  }) => {
    await openWorkspace(page);
    await choosePane(page, "plan");
    await expect(page.getByTestId("plan-act")).toContainText(
      "this project's plan is empty",
    );
    await expect(page.getByTestId("plan-to-worktree")).toBeDisabled();
  });

  test("the same act is reachable from the palette", async ({ page }) => {
    await openWorkspace(page);
    await writePlan(page, "# From the palette\n");

    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByTestId("palette")).toBeVisible();
    await page.getByTestId("palette-input").fill("turn this plan");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("palette")).toBeHidden();

    // The same dialog, reading the same plan — not a second surface with a
    // name derived somewhere else.
    await expect(page.getByTestId("plan-worktree-dialog")).toBeVisible();
    await expect(page.getByTestId("plan-worktree-branch")).toHaveValue(
      "from-the-palette",
    );
  });
});
