import { expect, test } from "@playwright/test";

import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";
import { seedActiveIdentity } from "../helpers/onboarding";

/**
 * The sea backdrop on the first-community screen.
 *
 * These two tests exist because the backdrop's whole design is a pair of
 * promises that are invisible in a screenshot: that the still paints before the
 * clip does (so a slow disk never shows a black rectangle), and that a user who
 * has asked for reduced motion gets no video element at all rather than a
 * hidden one that decodes anyway. Both are asserted on the DOM, not on pixels.
 */

const BLANK_TYLER_IDENTITY = {
  ...TEST_IDENTITIES.tyler,
  username: "",
};

/** The `poster` attribute is exactly this path, so it can be anchored. */
const POSTER_ATTR = /\/onboarding\/sea-backdrop-poster\.jpg$/;
/**
 * The computed `background-image` is the scrim gradient *and* the picture
 * (`linear-gradient(...), url("...jpg")`), so this one must not be anchored.
 */
const POSTER_IN_CSS = /\/onboarding\/sea-backdrop-poster\.jpg/;

/**
 * Land on WelcomeSetup: an identity that has finished machine onboarding but
 * has no community yet. Same recipe upstream's onboarding.spec.ts uses to reach
 * this screen.
 */
async function gotoWelcomeSetup(page: import("@playwright/test").Page) {
  await seedActiveIdentity(page, BLANK_TYLER_IDENTITY);
  await page.addInitScript((pubkey) => {
    window.localStorage.setItem(
      `buzz-machine-onboarding-complete.v2:${pubkey}`,
      "true",
    );
  }, BLANK_TYLER_IDENTITY.pubkey);
  await installMockBridge(page, undefined, {
    relayWsUrl: "ws://localhost:3000",
    skipOnboardingSeed: true,
    skipCommunitySeed: true,
  });
  await page.goto("/");
  await expect(page.getByTestId("community-choice-join")).toBeVisible();
}

test("welcome screen plays the sea with its poster declared", async ({
  page,
}) => {
  await gotoWelcomeSetup(page);

  const video = page.getByTestId("onboarding-sea-video");
  await expect(video).toBeAttached();

  // The poster is the contract that something is painted before the clip
  // decodes. It is also the loop's own first frame, so the start is seamless.
  await expect(video).toHaveAttribute("poster", POSTER_ATTR);

  // Autoplay in a webview only works muted + inline; without these the sea
  // would silently never start.
  await expect(video).toHaveJSProperty("muted", true);
  await expect(video).toHaveJSProperty("loop", true);
  await expect(video).toHaveJSProperty("autoplay", true);
  await expect(video).toHaveAttribute("playsinline", "");
});

/**
 * Reduced motion is emulated with `page.emulateMedia`, deliberately, and not
 * with `test.use({ reducedMotion: "reduce" })`.
 *
 * The `test.use` form is the documented one and it silently does nothing in
 * this repo's setup: probed on Playwright 1.60.0 against the `smoke` project,
 * `matchMedia("(prefers-reduced-motion: reduce)").matches` still came back
 * `false` inside the page, so the test passed a video it should have rejected.
 * `page.emulateMedia` reports `true` and is called before `goto` so the very
 * first React render already sees it — which is the only render that matters
 * here, since the component decides then whether to create a video at all.
 */
test.describe("reduced motion", () => {
  test("welcome screen serves the still image and creates no video", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await gotoWelcomeSetup(page);

    // Not "hidden" — absent. A hidden video is still a decoding video, so the
    // element must never be created.
    await expect(page.getByTestId("onboarding-sea-video")).toHaveCount(0);
    await expect(page.getByTestId("onboarding-sea-backdrop")).toHaveCount(0);
    await expect(page.locator("video")).toHaveCount(0);

    // The shell's own background carries the same frame, so the screen is still
    // the sea rather than a flat colour.
    await expect(
      page.locator(".buzz-onboarding-neutral-theme.buzz-startup-shell"),
    ).toHaveCSS("background-image", POSTER_IN_CSS);
  });
});
