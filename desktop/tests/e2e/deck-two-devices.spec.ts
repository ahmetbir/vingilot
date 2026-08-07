// Deck's two-device split, end to end (vingilot/docs/plans/2026-08-04-deck-phase-3.md,
// Task 4): the pin *set* is Workspace state (shared across devices via the
// coordinator's CAS protocol), the pin *arrangement* is device-local
// (localStorage, keyed by workspace + device id). Two browser contexts stand
// in for two devices — genuinely separate localStorage, same mocked
// coordinator backing the same workspace — so a pin placed on one device
// renders unplaced-but-present on the other, never reordering the first
// device's own arrangement.
//
// The coordinator itself is mocked here (page.route) rather than run for
// real — this spec proves the split's client-side contract (deckLayout.ts +
// deckPins.ts + DeckPane/PinnedCard), not the coordinator's CAS semantics
// (that's deckSync.test.mjs's job). The second test below mocks a losing CAS
// write the same way: the mutations route answers the first POST with a real
// 409 and, in the same handler, mutates the backing GET state to the
// winner's — standing in for an out-of-band write landing at the same
// revision — so DeckConflict renders off the exact `deckSync` result shape
// the real coordinator would produce, not a hand-built prop.

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";

// Matches RunsScreen.tsx's hardcoded dev workspace id (no workspace picker
// yet — see that file's comment).
const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
const COORDINATOR_ORIGIN = "http://127.0.0.1:7117";

// Mirrors the storage-key format deckLayout.ts derives internally
// (`DEVICE_ID_KEY`, `LAYOUT_KEY_PREFIX`) — duplicated here rather than
// imported so this spec seeds localStorage exactly the way a real second
// device would (through the public key shape), not by reaching into the
// module's internals.
const DEVICE_ID_STORAGE_KEY = "buzz-deck-device-id.v1";
const LAYOUT_KEY_PREFIX = "buzz-deck-layout.v1";

const PINS = [
  { id: "run-a", kind: "run", pinnedAt: "2026-08-01T10:00:00.000Z" },
  { id: "run-b", kind: "run", pinnedAt: "2026-08-01T10:05:00.000Z" },
];

const RUNS = [
  {
    id: "run-a",
    parent_run_id: null,
    objective: "Ship the deck pin toggle",
    mode: "delegated",
    status: "completed",
    wall_limit_secs: null,
    wall_started_at: null,
    tokens_observed: 0,
    tokens_observed_at: null,
    created_at: "2026-08-01T09:00:00.000Z",
    updated_at: "2026-08-01T09:30:00.000Z",
  },
  {
    id: "run-b",
    parent_run_id: null,
    objective: "Write coordinator CAS tests",
    mode: "delegated",
    status: "completed",
    wall_limit_secs: null,
    wall_started_at: null,
    tokens_observed: 0,
    tokens_observed_at: null,
    created_at: "2026-08-01T09:05:00.000Z",
    updated_at: "2026-08-01T09:35:00.000Z",
  },
];

const SHOT_DIR = "test-results/screenshots";

/** Seeds this browser context's localStorage with a fixed device id and
 * layout order — standing in for "this device already arranged its pinned
 * cards". Must run before `installMockBridge` (its own `addInitScript`
 * seeds localStorage too, and React reads state on mount — see
 * AGENTS.md's "addInitScript before bridge" rule). */
async function seedDeviceLayout(page: Page, deviceId: string, order: string[]) {
  await page.addInitScript(
    ({ deviceIdKey, deviceId: id, layoutKey, order: seededOrder }) => {
      window.localStorage.setItem(deviceIdKey, id);
      window.localStorage.setItem(layoutKey, JSON.stringify(seededOrder));
    },
    {
      deviceIdKey: DEVICE_ID_STORAGE_KEY,
      deviceId,
      layoutKey: `${LAYOUT_KEY_PREFIX}:${WORKSPACE_ID}:${deviceId}`,
      order,
    },
  );
}

/** Mocks the three coordinator reads DeckPane/RunsScreen issue against a
 * fixed pin set + run list — both "devices" share this same backing state,
 * only their local layout differs. */
async function mockCoordinator(page: Page) {
  await page.route(`${COORDINATOR_ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();

    if (method === "GET" && url.pathname === `/v1/workspaces/${WORKSPACE_ID}`) {
      return route.fulfill({
        json: {
          revision: 1,
          state_hash: "mock-state-hash",
          state: { deck: { pins: PINS } },
        },
      });
    }
    if (
      method === "GET" &&
      url.pathname === `/v1/workspaces/${WORKSPACE_ID}/runs`
    ) {
      return route.fulfill({ json: { runs: RUNS } });
    }
    if (
      method === "GET" &&
      /^\/v1\/runs\/[^/]+\/evidence$/.test(url.pathname)
    ) {
      // No commit/diff evidence seeded — PinnedCard renders without the
      // artifact row, which is the documented "no data, no row" behavior.
      return route.fulfill({ json: { evidence: [] } });
    }
    return route.fulfill({
      status: 404,
      json: { error: "not_found", detail: `unmocked route: ${url.pathname}` },
    });
  });
}

async function pinnedCardTestIds(page: Page): Promise<string[]> {
  return page
    .getByTestId("deck-pinned")
    .locator('[data-testid^="pinned-card-"]')
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-testid")),
    ) as Promise<string[]>;
}

test.describe("Deck: two devices, one pin set, two arrangements", () => {
  test("device B sees A's pin as an unplaced arrival; A's arrangement is untouched", async ({
    browser,
  }) => {
    const contextA = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    const contextB = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    try {
      // --- Device A: both cards already placed, in order [a, b] ---
      await seedDeviceLayout(pageA, "device-a", ["run-a", "run-b"]);
      await installMockBridge(pageA);
      await mockCoordinator(pageA);
      await pageA.goto("/#/workspace");

      await expect(pageA.getByTestId("runs-screen")).toBeVisible();
      await expect(pageA.getByTestId("deck-pinned")).toBeVisible();
      await expect(pageA.getByTestId("pinned-card-run-a")).toBeVisible();
      await expect(pageA.getByTestId("pinned-card-run-b")).toBeVisible();

      const idsOnA = await pinnedCardTestIds(pageA);
      expect(idsOnA).toEqual(["pinned-card-run-a", "pinned-card-run-b"]);
      // Fully placed: neither card offers "Place".
      await expect(pageA.getByTestId("place-run-a")).toHaveCount(0);
      await expect(pageA.getByTestId("place-run-b")).toHaveCount(0);

      await waitForAnimations(pageA);
      await pageA.screenshot({ path: `${SHOT_DIR}/deck-pinned.png` });

      // --- Device B: a different device id, only "b" placed locally ---
      await seedDeviceLayout(pageB, "device-b", ["run-b"]);
      await installMockBridge(pageB);
      await mockCoordinator(pageB);
      await pageB.goto("/#/workspace");

      await expect(pageB.getByTestId("runs-screen")).toBeVisible();
      await expect(pageB.getByTestId("deck-pinned")).toBeVisible();
      await expect(pageB.getByTestId("pinned-card-run-b")).toBeVisible();
      await expect(pageB.getByTestId("pinned-card-run-a")).toBeVisible();

      // "b" is placed (no Place action); "a" arrived unplaced (dashed +
      // caption + Place action) — the design's arriving-card affordance.
      await expect(pageB.getByTestId("place-run-b")).toHaveCount(0);
      await expect(pageB.getByTestId("place-run-a")).toBeVisible();
      await expect(
        pageB
          .getByTestId("pinned-card-run-a")
          .getByText("pinned on another device — place it where you like"),
      ).toBeVisible();

      const idsOnB = await pinnedCardTestIds(pageB);
      // DOM order is placed-then-unplaced: "b" (this device's placement),
      // then "a" (arrived, appended).
      expect(idsOnB).toEqual(["pinned-card-run-b", "pinned-card-run-a"]);

      await waitForAnimations(pageB);
      await pageB.screenshot({ path: `${SHOT_DIR}/deck-unplaced-arrival.png` });

      // --- The pin *set* is identical; only the *order* differs ---
      expect([...idsOnA].sort()).toEqual([...idsOnB].sort());
      expect(idsOnA).not.toEqual(idsOnB);

      // --- A's arrangement is untouched after B rendered (no shared state
      // leaked back) ---
      const idsOnAAfter = await pinnedCardTestIds(pageA);
      expect(idsOnAAfter).toEqual(["pinned-card-run-a", "pinned-card-run-b"]);
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });

  test("a write that loses the CAS race renders an honest conflict, never a silent overwrite", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    const page = await context.newPage();

    try {
      await seedDeviceLayout(page, "device-conflict", ["run-a", "run-b"]);
      await installMockBridge(page);

      // Backing state the mocked coordinator's GET answers with. The first
      // mutation POST bumps it to the "winner's" state in the same handler
      // that returns the 409 — an out-of-band write (a second device, or a
      // bare `curl`) landing at the same revision this UI read, exactly what
      // the plan's live-pass narrative describes, made deterministic and
      // reproducible instead of ad hoc.
      let revision = 1;
      let pins = PINS;
      // Someone else unpinned nothing and pinned a third run first — a real
      // added/removed diff for DeckConflict to show, not an empty one.
      const winnerPins = [
        ...PINS,
        { id: "run-c", kind: "run", pinnedAt: "2026-08-01T10:10:00.000Z" },
      ];
      let mutationAttempts = 0;

      await page.route(`${COORDINATOR_ORIGIN}/**`, async (route) => {
        const url = new URL(route.request().url());
        const method = route.request().method();

        if (
          method === "GET" &&
          url.pathname === `/v1/workspaces/${WORKSPACE_ID}`
        ) {
          return route.fulfill({
            json: {
              revision,
              state_hash: `mock-state-hash-${revision}`,
              state: { deck: { pins } },
            },
          });
        }
        if (
          method === "POST" &&
          url.pathname === `/v1/workspaces/${WORKSPACE_ID}/mutations`
        ) {
          mutationAttempts += 1;
          if (mutationAttempts === 1) {
            revision = 2;
            pins = winnerPins;
            return route.fulfill({
              status: 409,
              json: {
                error: "conflict",
                detail: "expected_revision mismatch",
              },
            });
          }
          revision += 1;
          return route.fulfill({
            json: {
              accepted: true,
              revision,
              state_hash: `mock-state-hash-${revision}`,
            },
          });
        }
        if (
          method === "GET" &&
          url.pathname === `/v1/workspaces/${WORKSPACE_ID}/runs`
        ) {
          return route.fulfill({ json: { runs: RUNS } });
        }
        if (
          method === "GET" &&
          /^\/v1\/runs\/[^/]+\/evidence$/.test(url.pathname)
        ) {
          return route.fulfill({ json: { evidence: [] } });
        }
        return route.fulfill({
          status: 404,
          json: {
            error: "not_found",
            detail: `unmocked route: ${url.pathname}`,
          },
        });
      });

      await page.goto("/#/workspace");
      await expect(page.getByTestId("runs-screen")).toBeVisible();
      await expect(page.getByTestId("deck-pinned")).toBeVisible();

      // Unpin run-a from its PINNED card — the write that's about to lose
      // the race. Scoped to deck-pinned: the same "pin-run-a" testid also
      // exists on the RunList row and the RECENT lane's chip (plan's UI
      // contract: every card/row gets one), so an unscoped locator would be
      // ambiguous.
      await page.getByTestId("deck-pinned").getByTestId("pin-run-a").click();

      const conflict = page.getByTestId("deck-conflict");
      await expect(conflict).toBeVisible();
      expect(mutationAttempts).toBe(1);
      await expect(
        conflict.getByText(
          "your pin didn't apply — rev 2 changed the pinned set first",
        ),
      ).toBeVisible();
      // mine = pins minus run-a = [run-b]; theirs = winnerPins = [run-a,
      // run-b, run-c] — a real added-there diff (run-c has no matching run
      // in RUNS, so it renders by id, exercising the same fallback a
      // tombstoned pin's label would).
      await expect(conflict.getByText(/added there:.*run-c/)).toBeVisible();
      await expect(conflict.getByText(/removed there:/)).toHaveCount(0);
      await expect(
        conflict.getByRole("button", { name: "Keep theirs" }),
      ).toBeVisible();
      await expect(
        conflict.getByRole("button", { name: "Re-apply mine on top" }),
      ).toBeVisible();

      await waitForAnimations(page);
      await page.screenshot({ path: `${SHOT_DIR}/deck-conflict.png` });
    } finally {
      await context.close();
    }
  });
});
