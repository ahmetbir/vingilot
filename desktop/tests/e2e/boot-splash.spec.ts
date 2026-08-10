import { expect, test } from "@playwright/test";
import { installMockBridge } from "../helpers/bridge";

// Cold-boot splash hold: on a real boot the community resolves in well under
// 100ms — before the hidden Tauri window ever puts a frame on screen — so the
// loading gate keeps the mark up as an overlay above the already mounted app
// for a minimum visible duration, then fades out. E2E runs skip the hold by
// default (it would slow every spec's boot and block pointer actionability);
// this spec opts back in via __BUZZ_E2E__.bootSplashHoldMs.
//
// The gate draws the fork's own mark rather than upstream's bee (Vingilot,
// vingilot/docs/plans/2026-08-10-ship-it.md); what that mark does on screen,
// and on both themes, is vingilot-boot-mark.spec.ts. What is asserted here is
// the splash's own contract, unchanged: something is drawn while it holds, the
// app boots underneath it, and it goes away afterwards.

test("boot splash overlay holds with the mark up, then dismisses", async ({
  page,
}) => {
  await installMockBridge(page);
  // Registered after installMockBridge so it runs after the bridge's init
  // script and can extend the config it assigns.
  await page.addInitScript(() => {
    const testWindow = window as Window & {
      __BUZZ_E2E__?: { bootSplashHoldMs?: number };
    };
    testWindow.__BUZZ_E2E__ = {
      ...(testWindow.__BUZZ_E2E__ ?? {}),
      bootSplashHoldMs: 1_500,
    };
  });
  await page.goto("/");

  const overlay = page.getByTestId("boot-splash-overlay");
  await expect(overlay).toBeVisible();

  // The mark is actually animating while the overlay holds — pure CSS, no JS
  // ticking a frame counter.
  const markState = await overlay
    .locator(".vingilot-mark-animation__ink")
    .evaluate((ink) => {
      const animation = ink.getAnimations()[0];
      return {
        name: getComputedStyle(ink).animationName,
        state: animation?.playState,
      };
    });
  expect(markState).toEqual({ name: "vingilot-sail", state: "running" });

  // The app mounts and loads beneath the overlay — boot is not delayed.
  await expect(page.getByTestId("home-inbox-list")).toBeVisible();

  // After the hold elapses the overlay fades out and unmounts.
  await expect(overlay).toHaveCount(0, { timeout: 6_000 });
  await expect(page.getByTestId("home-inbox-list")).toBeVisible();
});

test("boot splash overlay is skipped when the hold is zero (e2e default)", async ({
  page,
}) => {
  await installMockBridge(page);
  await page.goto("/");

  await expect(page.getByTestId("home-inbox-list")).toBeVisible();
  await expect(page.getByTestId("boot-splash-overlay")).toHaveCount(0);
});
