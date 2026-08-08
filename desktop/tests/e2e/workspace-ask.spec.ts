// Ask, as a mode of the palette, proved against a real render
// (vingilot/docs/plans/2026-08-08-palette-and-documents.md, Task 2).
//
// `askMode.test.mjs` says what the prefix means and what each refusal reads
// as; `askThread.test.mjs` and `askStore.test.mjs` say what is kept and where.
// What only a browser can say is the part the task is judged on:
//
// - that **the scope is on screen before the question is asked**, carrying the
//   directory that is actually sent and nothing else — asserted against the
//   rendered text, not against the constant the renderer read;
// - that with **no agent configured** the mode says so and Enter does not take
//   the question anyway;
// - that a question and its answer **land somewhere the owner can go back to**,
//   including after a reload, rather than in a toast;
// - that the pane's Run button and the palette's Enter are **one guard**, which
//   is only visible while a turn is actually out — so the stub can hold one
//   open, which is the state the real adapter is in for tens of seconds.
//
// The agent is stubbed at the Tauri boundary the same way the terminal is in
// workspace-no-overlays.spec.ts: the mock bridge throws for `agent_probe` and
// `agent_run` (they are the fork's commands, not upstream's), which is itself
// one of the states under test — a build that cannot ask whether an agent
// exists must refuse rather than accept a question into a void.

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";

const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
const COORDINATOR_ORIGIN = "http://127.0.0.1:7117";

/** The main checkout *is* the repo, so this path is the worktree's cwd and
 * therefore the exact string the ask scope has to show (`projects.ts`'s
 * `worktreeCwd`). */
const REPO = { id: "repo-left", name: "vingilot", path: "/tmp/vingilot-left" };

const ANSWER = "the lockfile is stale; run cargo update.";

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

/** The home directory a worktree cwd derives from, the pty commands an xterm
 * needs, and an ACP agent that either exists or does not. Everything else
 * falls through to the mock bridge.
 *
 * `hold` makes `agent_run` a turn that is still out: it resolves only when the
 * test calls `__FINISH_TURN__`. A real adapter takes tens of seconds, and
 * every question about *two* turns at once is a question about that window —
 * one that a stub resolving in the same tick closes before it can be asked. */
async function stubBackend(
  page: Page,
  agent: "ready" | "not-configured",
  hold = false,
) {
  await page.evaluate(
    ({ agent, answer, hold }) => {
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
        if (name.startsWith("plugin:path|"))
          return Promise.resolve("/tmp/home/");
        if (name === "pty_backing") return Promise.resolve("tmux");
        if (name.startsWith("pty_")) return Promise.resolve(null);
        if (name === "agent_probe") {
          return Promise.resolve(
            agent === "ready"
              ? {
                  command: { args: [], program: "acp-demo" },
                  kind: "ready",
                  resolved: "/opt/homebrew/bin/acp-demo",
                }
              : {
                  kind: "not-configured",
                  variables: [
                    "VINGILOT_ACP_AGENT_COMMAND",
                    "BUZZ_ACP_AGENT_COMMAND",
                  ],
                },
          );
        }
        if (name === "agent_run") {
          // What the adapter was started with, recorded where the test can
          // read it: the assertion about scope is about what crossed this
          // boundary, not about what the palette printed.
          (window as unknown as { __ASK_SENT__?: unknown }).__ASK_SENT__ = args;
          const turn = {
            dropped: 0,
            sessionId: "session-1",
            stderr: "",
            stopReason: "end_turn",
            trace: [
              { kind: "thought", text: "reading Cargo.lock" },
              { kind: "message", text: answer },
            ],
          };
          if (!hold) return Promise.resolve(turn);
          return new Promise((resolve) => {
            (
              window as unknown as { __FINISH_TURN__?: () => void }
            ).__FINISH_TURN__ = () => resolve(turn);
          });
        }
        return passThrough(cmd, args, opts);
      };
    },
    { agent, answer: ANSWER, hold },
  );
}

/** The workspace with one project open and its main checkout selected — the
 * state an ask needs, because a question is asked inside a directory. */
async function openWorktree(
  page: Page,
  agent: "ready" | "not-configured",
  hold = false,
) {
  await page.setViewportSize({ height: 900, width: 1700 });
  await installMockBridge(page);
  await mockCoordinator(page);
  await page.goto("/#/workspace");
  await expect(page.getByTestId("runs-screen")).toBeVisible();
  // The home-dir lookup runs once on RunsScreen's mount, so the stub has to be
  // in place before the screen that reads it mounts; leaving and coming back
  // is what re-runs it (workspace-no-overlays.spec.ts makes the same trip).
  await stubBackend(page, agent, hold);
  await page.goto("/#/");
  await page.goto("/#/workspace");
  await page.getByTestId(`projects-nav-repo-${REPO.id}`).click();
  await expect(page.getByTestId("work-surface")).toBeVisible();
}

async function openPalette(page: Page) {
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByTestId("palette")).toBeVisible();
}

/** Put a pane in the right slot, waiting out the menu on both sides of the
 * click — the same dance workspace-no-overlays.spec.ts does, and for the same
 * reason: Radix animates it, and a choice clicked mid-animation is a click on
 * a moving target. */
async function choosePane(page: Page, key: string) {
  const picker = page.getByTestId("pane-picker");
  await picker.click();
  await expect(picker).toHaveAttribute("data-state", "open");
  await waitForAnimations(page);
  await page.getByTestId(`pane-choice-${key}`).click();
  await expect(picker).toHaveAttribute("data-state", "closed");
  await waitForAnimations(page);
}

test.describe("ask about this project without leaving it", () => {
  test("the mode states what the question is asked with, before it is asked", async ({
    page,
  }) => {
    await openWorktree(page, "ready");
    await openPalette(page);

    // A filter, still — `?` only means ask as the first character.
    await page.getByTestId("palette-input").fill("prune");
    await expect(page.getByTestId("palette-ask")).toBeHidden();
    await expect(page.getByTestId("palette-list")).toBeVisible();

    // The prefix alone: the mode is on, and the scope is already stated with
    // nothing typed.
    await page.getByTestId("palette-input").fill("?");
    await expect(page.getByTestId("palette-ask")).toBeVisible();
    await expect(page.getByTestId("palette-list")).toBeHidden();
    await expect(page.getByTestId("palette-ask-sent")).toHaveText(REPO.path);
    const note = page.getByTestId("palette-ask-note");
    await expect(note).toContainText("not the diff");
    await expect(note).toContainText("not the branch");
    await expect(note).toContainText("reads whatever it opens there itself");
    // Nothing has been asked yet, so it says so rather than offering Enter.
    await expect(page.getByTestId("palette-ask-blocked")).toHaveText(
      "type a question.",
    );

    await page.getByTestId("palette-input").fill("? why is the build red");
    await expect(page.getByTestId("palette-ask-ready")).toBeVisible();
    await expect(page.getByTestId("palette-ask-blocked")).toBeHidden();
    // Still the one path, with a question typed against it.
    await expect(page.getByTestId("palette-ask-sent")).toHaveText(REPO.path);
  });

  test("the question and its answer land in a conversation that survives a reload", async ({
    page,
  }) => {
    await openWorktree(page, "ready");
    await openPalette(page);
    await page.getByTestId("palette-input").fill("? why is the build red");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("palette")).toBeHidden();

    // Asking switches the right pane to the one the answer lands in, so the
    // owner watches it arrive rather than going to find it.
    const thread = page.getByTestId("ask-thread");
    await expect(thread).toBeVisible();
    await expect(thread).toContainText("why is the build red");
    await expect(thread).toContainText(ANSWER);
    // The thread carries the directory each question was asked in, which is
    // the whole of what was sent with it.
    await expect(thread).toContainText(`asked in ${REPO.path}`);

    // And what actually crossed the Tauri boundary is that path and that
    // question — the scope on screen is a claim about this call.
    expect(await page.evaluate(() => window.__ASK_SENT__)).toEqual({
      cwd: REPO.path,
      prompt: "why is the build red",
    });

    // A conversation, not a toast: it is there after the app restarts. The
    // reload throws away every module the ask ran through, so what is on
    // screen after it came out of storage.
    await page.reload();
    await expect(page.getByTestId("runs-screen")).toBeVisible();
    await stubBackend(page, "ready");
    await page.goto("/#/");
    await page.goto("/#/workspace");
    await page.getByTestId(`projects-nav-repo-${REPO.id}`).click();
    // Opened by hand rather than left to the pane arrangement's own memory:
    // what is under test is that the conversation is still there, not which
    // pane the workspace comes back to.
    await choosePane(page, "agent");
    await expect(page.getByTestId("ask-thread")).toContainText(ANSWER);
    await expect(page.getByTestId("ask-thread")).toContainText(
      "why is the build red",
    );
    await expect(page.getByTestId("ask-thread")).toContainText(
      `asked in ${REPO.path}`,
    );
  });

  test("with no agent configured it says so, and refuses the question", async ({
    page,
  }) => {
    await openWorktree(page, "not-configured");
    await openPalette(page);
    await page.getByTestId("palette-input").fill("? why is the build red");

    const blocked = page.getByTestId("palette-ask-blocked");
    await expect(blocked).toContainText("no ACP agent is configured");
    // The refusal names what to set, because the owner's next move is to set
    // it — this is the probe's own sentence, not a second copy of it.
    await expect(blocked).toContainText("VINGILOT_ACP_AGENT_COMMAND");
    await expect(page.getByTestId("palette-ask-ready")).toBeHidden();

    // Enter takes it nowhere and says nothing happened by staying open.
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("palette")).toBeVisible();
    await expect(blocked).toBeVisible();
    await expect(
      await page.evaluate(() => window.localStorage.getItem("vingilot-ask.v1")),
    ).toBeNull();
  });

  test("a turn started in the pane is the same turn the palette refuses", async ({
    page,
  }) => {
    // The one thing no unit test can say: the pane's Run button and the
    // palette's Enter are the same guard. They were not — the pane held its
    // own `running`, so the palette started a second adapter in this same
    // worktree, which on a hosted adapter is a second login and a second
    // billed turn.
    await openWorktree(page, "ready", true);
    await choosePane(page, "agent");
    await page.getByTestId("agent-prompt").fill("rename the parser module");
    await page.getByTestId("agent-run").click();
    await expect(page.getByTestId("agent-run")).toHaveText("running…");

    // A turn started here is kept where a question asked from the palette is.
    await expect(page.getByTestId("ask-thread")).toContainText(
      "rename the parser module",
    );

    await openPalette(page);
    await page.getByTestId("palette-input").fill("? why is the build red");
    await expect(page.getByTestId("palette-ask-blocked")).toContainText(
      "one adapter runs at a time",
    );
    await expect(page.getByTestId("palette-ask-ready")).toBeHidden();

    // Enter takes it nowhere, and — the part that matters — no second
    // adapter was started: the last thing to cross the boundary is still the
    // pane's prompt.
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("palette")).toBeVisible();
    expect(await page.evaluate(() => window.__ASK_SENT__)).toEqual({
      cwd: REPO.path,
      prompt: "rename the parser module",
    });

    // And once the held turn comes back, the door opens again.
    await page.evaluate(() => window.__FINISH_TURN__?.());
    await expect(page.getByTestId("ask-thread")).toContainText(ANSWER);
    await expect(page.getByTestId("palette-ask-ready")).toBeVisible();
  });
});

declare global {
  interface Window {
    /** Set by the `agent_run` stub above: the arguments the adapter was
     * actually started with. */
    __ASK_SENT__?: unknown;
    /** Set by the same stub when it is holding a turn open: calling it is the
     * adapter finally answering. */
    __FINISH_TURN__?: () => void;
  }
}
