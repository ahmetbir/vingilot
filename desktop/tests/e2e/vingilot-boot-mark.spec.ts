import { expect, test, type Locator, type Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

/**
 * The cold-boot gate's mark, read in the built bundle.
 *
 * Everything asserted here is a claim about what the browser actually did with
 * the shipped asset, because every one of them is invisible to a unit test and
 * three of them were the plan's named risks:
 *
 *  - that the loop MOVES. The mechanism is a sprite sheet under a mask, stepped
 *    by a transform animation; a mask that will not animate, a timing function
 *    that failed to parse, or a frame count that disagrees with the sheet all
 *    render a mark that simply sits there — or slides through half-frames —
 *    with nothing failing anywhere. Only rendered pixels tell those apart, so
 *    the animation is paused, driven to exact times, and the frames compared.
 *  - that the mark takes the THEME's colour. It is keyed out of white-on-black
 *    artwork, so a white bitmap looks perfect on the dark theme it is developed
 *    against and vanishes on the light one. Read as painted pixels, not as a
 *    class name: what is asserted is which ink the mark came out in.
 *  - that the gate never shows an empty box, and never shows a solid one. An
 *    unresolved mask does not paint nothing, it paints everything — so the
 *    sheet is aborted mid-boot and the mark still has to be a ship.
 */

const HOLD_MS = 8_000;
const THEME_STORAGE_KEY = "buzz-theme";
const SAIL_DURATION_MS = 2_333;
const FRAME_MS = SAIL_DURATION_MS / 28;

/** Boot the app with the splash held open, so the gate is on screen to read. */
async function openBootGate(page: Page, theme?: "light" | "dark") {
  if (theme) {
    await page.addInitScript(
      ({ key, value }) => {
        window.localStorage.setItem(key, value);
      },
      { key: THEME_STORAGE_KEY, value: theme },
    );
  }
  await installMockBridge(page);
  // Registered after installMockBridge so it runs after the bridge's init
  // script and can extend the config it assigns.
  await page.addInitScript((holdMs) => {
    const testWindow = window as Window & {
      __BUZZ_E2E__?: { bootSplashHoldMs?: number };
    };
    testWindow.__BUZZ_E2E__ = {
      ...(testWindow.__BUZZ_E2E__ ?? {}),
      bootSplashHoldMs: holdMs,
    };
  }, HOLD_MS);
  await page.goto("/");
  await expect(page.getByTestId("boot-splash-overlay")).toBeVisible();
  return page.getByTestId("vingilot-mark-animation");
}

type Patch = { red: number; green: number; blue: number };

const luminance = ({ red, green, blue }: Patch) =>
  0.2126 * red + 0.7152 * green + 0.0722 * blue;

/**
 * What the browser painted for the mark, read out of a screenshot of the
 * element itself.
 *
 * Decoded by the page rather than by the test: the browser has an image decoder
 * and Node does not, and what is wanted here is exactly what the browser
 * painted. The middle of the cell is the mast and sails; the corner is outside
 * every frame's ink, which is what the derivation's gutter guarantees.
 *
 * `brightest`/`darkest` are the extremes over the whole element, and they exist
 * because the middle patch is NOT a reading of the ink. The mark is antialiased
 * artwork at partial mask coverage, so every patch of it is a blend of ink and
 * the grainient behind it — measured, the middle comes out near mid-grey on
 * both themes (156 dark, 148 light) even though the ink itself is near-white on
 * one and near-navy on the other. A test that compares blends compares the
 * background's symmetry, not the mark's colour. The extremes do reach the ink:
 * on the dark theme the ink is the lightest thing in the box, on the light theme
 * the darkest.
 */
async function patches(mark: Locator): Promise<{
  middle: Patch;
  corner: Patch;
  brightest: number;
  darkest: number;
}> {
  const shot = (await mark.screenshot()).toString("base64");
  return mark.page().evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("no 2d context");
    }
    context.drawImage(image, 0, 0);
    const average = (x: number, y: number, size: number) => {
      const { data } = context.getImageData(x, y, size, size);
      let red = 0;
      let green = 0;
      let blue = 0;
      for (let i = 0; i < data.length; i += 4) {
        red += data[i];
        green += data[i + 1];
        blue += data[i + 2];
      }
      const count = data.length / 4;
      return { red: red / count, green: green / count, blue: blue / count };
    };
    const { data } = context.getImageData(0, 0, image.width, image.height);
    let brightest = 0;
    let darkest = 255;
    for (let i = 0; i < data.length; i += 4) {
      const value =
        0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      brightest = Math.max(brightest, value);
      darkest = Math.min(darkest, value);
    }
    const size = 12;
    return {
      middle: average(
        Math.round(image.width / 2 - size / 2),
        Math.round(image.height / 2 - size / 2),
        size,
      ),
      corner: average(0, 0, size),
      brightest,
      darkest,
    };
  }, shot);
}

/**
 * A mask either shapes the fill or it does not, and neither failure is blank:
 * an unresolved mask paints the whole box in `currentColor`, and a mark that
 * never arrived paints none of it. Both make the middle and the corner the
 * same colour; only a drawn ship makes them different.
 */
async function expectAShipIsDrawn(mark: Locator) {
  const { middle, corner } = await patches(mark);
  expect(Math.abs(luminance(middle) - luminance(corner))).toBeGreaterThan(40);
}

/** Pause the mark's animation and hold it at one exact point in the loop. */
async function seek(mark: Locator, timeMs: number) {
  await mark.locator(".vingilot-mark-animation__ink").evaluate((ink, time) => {
    const animation = ink.getAnimations()[0];
    animation.pause();
    animation.currentTime = time;
    return animation.ready;
  }, timeMs);
}

async function transformAt(mark: Locator, timeMs: number) {
  await seek(mark, timeMs);
  return mark
    .locator(".vingilot-mark-animation__ink")
    .evaluate((ink) => getComputedStyle(ink).transform);
}

test("the boot gate's mark is sailing, and the frames really change", async ({
  page,
}) => {
  const mark = await openBootGate(page);
  await expect(mark).toHaveAttribute("data-state", "sailing");

  const ink = mark.locator(".vingilot-mark-animation__ink");
  const running = await ink.evaluate((element) => {
    const animation = element.getAnimations()[0];
    return {
      name: getComputedStyle(element).animationName,
      state: animation?.playState,
      timing: getComputedStyle(element).animationTimingFunction,
    };
  });
  expect(running).toEqual({
    name: "vingilot-sail",
    state: "running",
    timing: "steps(28, jump-none)",
  });

  // The pixels, at two points in the loop that are different frames of the clip.
  await seek(mark, 0);
  const first = await mark.screenshot();
  await seek(mark, SAIL_DURATION_MS / 2);
  const halfway = await mark.screenshot();
  expect(first.equals(halfway)).toBe(false);

  // And it is a step, not a slide: everything inside one frame's slot is the
  // same picture, and the next slot is a different one. A timing function that
  // failed to parse would interpolate, and make all three differ.
  const early = await transformAt(mark, FRAME_MS * 0.1);
  const late = await transformAt(mark, FRAME_MS * 0.9);
  const next = await transformAt(mark, FRAME_MS * 1.5);
  expect(early).toBe(late);
  expect(next).not.toBe(early);
});

test("the mark is painted in the theme's ink, on both themes", async ({
  page,
  context,
}) => {
  const darkMark = await openBootGate(page, "dark");
  await expectAShipIsDrawn(darkMark);
  const dark = await patches(darkMark);

  const lightPage = await context.newPage();
  const lightMark = await openBootGate(lightPage, "light");
  await expectAShipIsDrawn(lightMark);
  const light = await patches(lightMark);

  // One asset, two themes. The ship reads against its ground in opposite
  // directions — lighter than the grainient on the dark theme, darker on the
  // light one — which is the assertion a white bitmap fails outright, because
  // white is lighter than both backgrounds.
  expect(luminance(dark.middle)).toBeGreaterThan(luminance(dark.corner));
  expect(luminance(light.middle)).toBeLessThan(luminance(light.corner));

  // And the ink is a different colour, not merely a different contrast: the
  // lightest pixel the dark theme paints is far lighter than the darkest pixel
  // the light theme paints (measured ~239 against ~80). Read at the extremes
  // rather than at the middle for the reason `patches` documents — a blended
  // patch lands near mid-grey on both themes and would report a difference of 8.
  expect(dark.brightest - light.darkest).toBeGreaterThan(100);
});

test("a sheet that never arrives leaves a still mark, not an empty box", async ({
  page,
}) => {
  await page.route("**/mark-animation*.png", (route) => route.abort());

  const mark = await openBootGate(page);
  await expect(mark).toHaveAttribute("data-state", "poster");
  await expect(mark).toBeVisible();

  // The poster is inlined in the bundle, so there is still a ship on screen
  // rather than the solid rectangle an unresolved mask paints.
  await expectAShipIsDrawn(mark);
  const animations = await mark
    .locator(".vingilot-mark-animation__ink")
    .evaluate((ink) => ink.getAnimations().length);
  expect(animations).toBe(0);
});

/**
 * Reduced motion is emulated with an explicit `page.emulateMedia` rather than
 * the `test.use({ reducedMotion: "reduce" })` fixture, because in this config
 * the fixture form does not reach the page: measured under Playwright 1.60 in
 * the smoke project, `matchMedia("(prefers-reduced-motion: reduce)")` inside a
 * `test.use` describe block reports false and the mark keeps sailing, while the
 * explicit call reports true. That failure is silent in the dangerous
 * direction — a test asserting "the animation stopped" against a page that was
 * never asked to reduce motion would report the product broken; one asserting
 * the reverse would pass while proving nothing. So the media query is asserted
 * from inside the page first, and the assertion about the mark comes second.
 */
test("holds the mark still when the system asks for reduced motion", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const mark = await openBootGate(page);
  expect(
    await page.evaluate(
      () => matchMedia("(prefers-reduced-motion: reduce)").matches,
    ),
  ).toBe(true);
  await expect(mark).toHaveAttribute("data-state", "sailing");

  const animations = await mark
    .locator(".vingilot-mark-animation__ink")
    .evaluate((ink) => ink.getAnimations().length);
  expect(animations).toBe(0);
  await expectAShipIsDrawn(mark);
});
