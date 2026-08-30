// The dictation transcript fan-out (vingilot/docs/plans/2026-08-13-voice.md,
// Task 3 verifier finding): `dictation.rs` has exactly one process-global
// pipeline (that module's header) and forwards each finished utterance as a
// plain `app.emit("dictation-transcript", …)` — broadcast to every listener,
// not routed to whichever surface started the session. Every mounted
// `useDictation` instance registers its own listener (`useDictation.ts`), so
// without a guard a transcript meant for one surface folds into all of them.
//
// **The exact co-mount the verifier reproduced it against**: the ⌘K palette
// (`CommandPalette.tsx`) calls `useDictation` unconditionally at the top of
// the component — its `if (!open) return null` early return comes AFTER that
// call, so the hook (and its `dictation-transcript` listener) is live whether
// or not the palette is open, for as long as `RunsScreen` has it mounted
// (`RunsScreen.tsx`'s unconditional `<CommandPalette palette={palette} />`).
// A channel pane's dock composer (`ChannelPane.tsx` → `MessageComposer`
// `layoutMode="dock"`) is a second, independent `useDictation` instance in
// the same tree. Starting dictation in the composer and then opening the
// palette puts two live listeners in the page at once; emitting one
// transcript must fold into the composer (the instance that actually called
// `start()`) and leave the palette's ask query untouched.
//
// Removing `useDictation.ts`'s ownership guard (`if
// (!ownsBackendSessionRef.current) return;` — a ref set the moment `start()`
// confirms the backend, NOT the laggier `status`, which trails the backend by
// one beat and broke the stop-on-send spec when tried) turns this red: the
// palette's idle instance folds the segment onto its query anyway, and
// `palette-input` reads the leaked text instead of staying empty.

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
const COORDINATOR_ORIGIN = "http://127.0.0.1:7117";
const REPO = {
  id: "repo-dictation-leak",
  name: "vingilot",
  path: "/tmp/vingilot-dictation-leak",
};

const PERSONAS = [
  { displayName: "Planner", id: "persona-planner", systemPrompt: "Plan it." },
];

const TEAM = {
  description: "Plans things.",
  id: "team-launch",
  name: "Launch Team",
  personaIds: ["persona-planner"],
};

async function mockCoordinator(page: Page) {
  await page.route(`${COORDINATOR_ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === `/v1/workspaces/${WORKSPACE_ID}`) {
      return route.fulfill({
        json: {
          revision: 1,
          state: { repos: [REPO] },
          state_hash: "mock-state-hash",
        },
      });
    }
    if (url.pathname.endsWith("/runs")) {
      return route.fulfill({ json: { runs: [] } });
    }
    if (url.pathname.endsWith("/worktrees")) {
      return route.fulfill({ json: { worktrees: [] } });
    }
    return route.fulfill({
      json: { detail: `unmocked route: ${url.pathname}`, error: "not_found" },
      status: 404,
    });
  });
}

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
}

/** Same fake mic as `composer-dictation.spec.ts` — real mic-acquisition path,
 * no real audio. */
async function installFakeDictationMicrophone(page: Page) {
  await page.addInitScript(() => {
    const mediaDevices = navigator.mediaDevices ?? ({} as MediaDevices);
    if (!navigator.mediaDevices) {
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: mediaDevices,
      });
    }
    Object.defineProperty(mediaDevices, "getUserMedia", {
      configurable: true,
      value: async () => {
        const context = new AudioContext({ sampleRate: 48_000 });
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const destination = context.createMediaStreamDestination();
        gain.gain.value = 0;
        oscillator.connect(gain);
        gain.connect(destination);
        oscillator.start();
        return destination.stream;
      },
    });
  });
}

async function emitTranscript(page: Page, text: string) {
  await page.evaluate((segmentText) => {
    (
      window as Window & {
        __BUZZ_E2E_EMIT_TAURI_EVENT__?: (
          event: string,
          payload: unknown,
        ) => void;
      }
    ).__BUZZ_E2E_EMIT_TAURI_EVENT__?.("dictation-transcript", {
      text: segmentText,
    });
  }, text);
}

/** The work surface with a team thread open in the right pane — the same
 * hosted-channel-pane setup `workspace-palette-over-thread.spec.ts` uses, so
 * its dock composer (`channel-composer-overlay`) is on screen next to the
 * ⌘K palette. */
async function openTeamThread(page: Page) {
  // Wide enough for the workspace's two-pane layout (terminal + dock) —
  // narrower defaults collapse to a single-column terminal-only layout with
  // no dock, the same width `workspace-ask.spec.ts` uses.
  await page.setViewportSize({ height: 900, width: 1700 });
  await installFakeDictationMicrophone(page);
  await installMockBridge(page, { personas: PERSONAS, teams: [TEAM] });
  await mockCoordinator(page);
  await page.goto("/#/workspace");
  await expect(page.getByTestId("runs-screen")).toBeVisible();
  await stubBackend(page);
  await page.goto("/#/");
  await page.goto("/#/workspace");
  await page.getByTestId(`projects-nav-repo-${REPO.id}`).click();
  await expect(page.getByTestId("work-surface")).toBeVisible();

  await choosePane(page, "team");
  await expect(page.getByTestId("team-choice")).toBeVisible();
  await page.getByTestId(`team-choice-${TEAM.id}`).click();
  await page.getByTestId("team-open").click();
  await expect(
    page.getByTestId("team-thread").getByTestId("message-composer"),
  ).toBeVisible({ timeout: 20_000 });
}

test("a transcript folds only into the composer that started listening, never into an idle ⌘K palette", async ({
  page,
}) => {
  await openTeamThread(page);

  const composer = page.getByTestId("team-thread");
  const composerMic = composer.getByTestId("dictation-mic-button");
  await composerMic.click();
  await expect(
    composer.getByTestId("dictation-listening-indicator"),
  ).toBeVisible();

  // The palette's own `useDictation` instance is mounted the moment
  // `RunsScreen` renders (this file's header) — opening it here is only so
  // its query is on screen to assert against, not what makes it "live".
  await page.keyboard.press("Meta+k");
  await expect(page.getByTestId("palette")).toBeVisible();
  const paletteInput = page.getByTestId("palette-input");
  await expect(paletteInput).toHaveValue("");

  await emitTranscript(page, "leaky segment");

  const composerInput = composer.getByTestId("message-input");
  await expect.poll(() => composerInput.innerText()).toBe("leaky segment");
  // The bug this guards against: the palette's idle instance folding the
  // same event onto its own query.
  await expect(paletteInput).toHaveValue("");
});
