// What the terminal looks like it is, asserted against the running app.
//
// Everything here is a class, an attribute, a computed colour or a measured
// offset — never a screenshot. The surface's colours are theme tokens, so a
// pixel comparison would be a test of whichever theme the e2e build happened
// to boot in; what these assertions pin is that the terminal takes its colours
// *from* that theme rather than from xterm's own, and that the strip above it
// stays reachable and readable however many tabs are in it.
//
// The harness is `terminal-wheel.spec.ts`'s, for the same reason: only the IPC
// transport is replaced, by a recorder. The real `Terminal`, the real xterm,
// the real work surface and the real tab strip are what is under test.
//
// Two things here are deliberately *not* driven the obvious way, because the
// obvious way answers its own question. The tab that has to be scrolled into
// view is selected with ⌥⌘← rather than clicked: Playwright scrolls a click's
// target into view as part of its actionability checks, walking every
// scrollable ancestor, so a click satisfies the containment assertion with the
// component's effect deleted. And the palette is read out of the stylesheet
// xterm injects rather than off the cursor element, which only exists while the
// terminal holds focus and is animated between two colours while it blinks.

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
const COORDINATOR_ORIGIN = "http://127.0.0.1:7117";

/** xterm's own default foreground and cursor, straight out of
 * @xterm/xterm 5.5.0 `browser/services/ThemeService.ts` (`DEFAULT_FOREGROUND`
 * = `#ffffff`). This is what the terminal painted before it was given the
 * app's palette — and against a light theme, white on 94.9%-lightness. If this
 * value ever comes back out of the DOM, the palette has stopped being
 * applied. */
const XTERM_STOCK_FOREGROUND = "rgb(255, 255, 255)";

/** xterm's stock selection before it is composited: `DEFAULT_SELECTION` is
 * `rgba(255, 255, 255, 0.3)` (@xterm/xterm 5.5.0
 * `browser/services/ThemeService.ts`). What that ends up as on screen depends
 * on the background the terminal was handed, so it is composited below rather
 * than written down — but it is still the value the regression this file exists
 * for produced. The selection was probed as `bg-primary/30`, Tailwind compiles
 * a slash opacity to `color-mix(in oklab, …)`, Chromium computes that to
 * `oklab(…)`, and xterm's `css.toColor` reads hex and `rgb()`/`rgba()` only —
 * so it threw, `parseColor` swallowed it, and every selection in the app was
 * drawn in xterm's own white. Naming it is what stops that coming back. */
const XTERM_STOCK_SELECTION = "rgb(255, 255, 255)";

/** The alpha the terminal thins its accent by (`lib/terminalPalette.ts`'s
 * `SELECTION_ALPHA`), quantised the way xterm quantises it: `css.toColor`
 * stores alpha as a byte, so what actually composites is
 * `Math.round(255 * 0.3) / 255` and not 0.3. Off by that much, this expectation
 * would be wrong by one in a channel and the assertion would be a nuisance
 * rather than a guard. */
const SELECTION_ALPHA = Math.round(255 * 0.3) / 255;

/** The three channels of an `rgb(…)` reading. */
function channels(value: string): [number, number, number] {
  const match = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(value.trim());
  if (match === null) throw new Error(`not an rgb reading: ${value}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** What xterm paints `.xterm-selection div` with, given the surface it was
 * handed as `theme.background` and the accent the selection is made of.
 *
 * xterm composites the two itself — `_setTheme` sets `selectionBackgroundOpaque
 * = color.blend(background, selectionBackground)`, and `blend` is
 * `base + Math.round((over - base) * alpha)` per channel. Computed here rather
 * than written down, so the expectation follows whichever theme the e2e build
 * boots in and whatever a test has just switched it to. */
function xtermSelection(surface: string, accent: string): string {
  const [br, bg, bb] = channels(surface);
  const [ar, ag, ab] = channels(accent);
  const over = (base: number, top: number) =>
    base + Math.round((top - base) * SELECTION_ALPHA);
  return `rgb(${over(br, ar)}, ${over(bg, ag)}, ${over(bb, ab)})`;
}

const REPO = {
  id: "repo-chrome",
  name: "vingilot",
  path: "/tmp/vingilot-chrome",
};

interface ChromeProbe {
  session: string | null;
}

declare global {
  interface Window {
    __CHROME_PROBE__: ChromeProbe;
    __CHROME_FEED__: (data: string) => void;
  }
}

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
    if (url.pathname === `/v1/workspaces/${WORKSPACE_ID}/runs`) {
      return route.fulfill({ json: { runs: [] } });
    }
    if (url.pathname === `/v1/workspaces/${WORKSPACE_ID}/worktrees`) {
      return route.fulfill({ json: { worktrees: [] } });
    }
    return route.fulfill({
      json: { detail: `unmocked route: ${url.pathname}`, error: "not_found" },
      status: 404,
    });
  });
}

/** The pty half of the bridge, as a stub that answers and a way to push real
 * bytes at whichever terminal opened last. */
async function recordPty(page: Page) {
  await page.evaluate(() => {
    const internals = (
      window as unknown as {
        __TAURI_INTERNALS__: {
          invoke: (cmd: string, args?: unknown, opts?: unknown) => unknown;
        };
      }
    ).__TAURI_INTERNALS__;
    const passThrough = internals.invoke.bind(internals);

    const probe: ChromeProbe = { session: null };
    window.__CHROME_PROBE__ = probe;

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

    window.__CHROME_FEED__ = (data: string) => {
      if (probe.session === null) throw new Error("no session opened yet");
      emitChunk({ data, replay: false, seq: seq++, session: probe.session });
    };

    internals.invoke = (cmd, args, opts) => {
      const name = String(cmd);
      const payload = (args ?? {}) as Record<string, string>;
      if (name.startsWith("plugin:path|")) return Promise.resolve("/tmp/home/");
      if (name === "pty_backing") return Promise.resolve("tmux");
      if (name === "pty_open") {
        probe.session = payload.session;
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
      return passThrough(cmd, args, opts);
    };
  });
}

/** What the app resolves a Tailwind class to, asked of the running document.
 * The same question `Terminal.tsx`'s own probe asks, so neither side of an
 * assertion can drift from whichever theme the e2e build boots in. */
async function appColor(
  page: Page,
  className: string,
  property: "backgroundColor" | "color",
): Promise<string> {
  return page.evaluate(
    ([probeClass, probeProperty]) => {
      const probe = document.createElement("span");
      probe.className = probeClass;
      document.body.appendChild(probe);
      const value =
        window.getComputedStyle(probe)[
          probeProperty as "backgroundColor" | "color"
        ];
      probe.remove();
      return value;
    },
    [className, property],
  );
}

/** Whether tab `n` is inside the strip's scroller box — read, never reached
 * for. Nothing here clicks, hovers or focuses the tab, because every one of
 * those makes Playwright scroll it into view first and would answer its own
 * question. */
async function inScroller(page: Page, n: number): Promise<boolean | null> {
  return page.evaluate((ordinal) => {
    const box = document.querySelector('[data-testid="terminal-tab-scroller"]');
    const tab = document.querySelector(
      `[data-testid="terminal-tab-${ordinal}"]`,
    );
    if (box === null || tab === null) return null;
    const outer = box.getBoundingClientRect();
    const inner = tab.getBoundingClientRect();
    return inner.left >= outer.left - 1 && inner.right <= outer.right + 1;
  }, n);
}

interface PaintedPalette {
  background: string | null;
  cursor: string | null;
  cursorAccent: string | null;
  foreground: string | null;
  selection: string | null;
}

/** The palette the terminal is actually painted in, read back out of the
 * running app.
 *
 * The foreground is a computed style, because xterm's DOM renderer writes it
 * onto `.xterm-rows` and that element is always there. So is the background:
 * xterm writes the theme's background straight onto `.xterm-viewport`
 * (`browser/Viewport.ts`, `_handleThemeChange`), an element stretched over the
 * whole terminal — which is why a background nobody names is not "the pane
 * shows through" but a black rectangle. The other three are read out of the
 * stylesheet the same renderer injects, because the elements they style are
 * conditional and would make the reading a race: the cursor is only a block
 * while the terminal holds focus, it is under a CSS animation that swaps its
 * two colours twice a second while it blinks, and a selection rule styles
 * nothing at all until something is selected. The stylesheet is stated fact
 * either way — it is what those elements would be painted with.
 *
 * xterm re-serialises every colour it is handed (`css.toColor` →
 * `channels.toCss`, i.e. hex), so each value is normalised back through the
 * browser before it meets a probe's `rgb(…)`. */
async function paintedPalette(page: Page): Promise<PaintedPalette> {
  return page.evaluate(() => {
    // A colour the browser rejects leaves the sentinel in place, which is the
    // difference between "xterm wrote something this cannot read" and "xterm
    // wrote this colour".
    const SENTINEL = "rgb(1, 2, 3)";
    const normalize = (value: string | null): string | null => {
      if (value === null) return null;
      const span = document.createElement("span");
      span.style.color = SENTINEL;
      span.style.color = value;
      document.body.appendChild(span);
      const read = window.getComputedStyle(span).color;
      span.remove();
      return read === SENTINEL && value.trim() !== SENTINEL ? null : read;
    };

    const sheet =
      Array.from(document.querySelectorAll("style"))
        .map((style) => style.textContent ?? "")
        .find((text) => text.includes(".xterm-cursor.xterm-cursor-block {")) ??
      null;
    const declaration = (selector: string, property: string): string | null => {
      if (sheet === null) return null;
      const at = sheet.indexOf(selector);
      if (at === -1) return null;
      // Anchored on a `{` or `;` so that asking for `color` cannot be answered
      // by the `background-color` that precedes it in the same rule.
      const match = new RegExp(`[{;]\\s*${property}:\\s*([^;}]+)`).exec(
        sheet.slice(at),
      );
      return match === null ? null : match[1].trim();
    };

    const rows = document.querySelector(".xterm-rows");
    const viewport = document.querySelector(".xterm-viewport");
    return {
      background:
        viewport === null
          ? null
          : window.getComputedStyle(viewport).backgroundColor,
      cursor: normalize(
        declaration(".xterm-cursor.xterm-cursor-block {", "background-color"),
      ),
      cursorAccent: normalize(
        declaration(".xterm-cursor.xterm-cursor-block {", "color"),
      ),
      foreground: rows === null ? null : window.getComputedStyle(rows).color,
      selection: normalize(
        declaration(".xterm-selection div {", "background-color"),
      ),
    };
  });
}

async function openWorkspace(page: Page, width = 1700) {
  await page.setViewportSize({ height: 900, width });
  await installMockBridge(page);
  await mockCoordinator(page);
  await page.goto("/#/workspace");
  await expect(page.getByTestId("runs-screen")).toBeVisible();
  await recordPty(page);
  // The home-dir lookup runs on RunsScreen's mount, so the recorder has to be
  // in place before the screen that reads it mounts.
  await page.goto("/#/");
  await page.goto("/#/workspace");
  await page.getByTestId(`projects-nav-repo-${REPO.id}`).click();
  await expect(page.getByTestId("work-surface")).toBeVisible();
  await expect(page.locator(".xterm-screen").first()).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.__CHROME_PROBE__.session))
    .not.toBeNull();
}

test("the terminal paints in the app's foreground, cursor and selection, not xterm's stock white", async ({
  page,
}) => {
  await openWorkspace(page);

  // xterm's DOM renderer writes the theme's foreground onto `.xterm-rows`
  // through a stylesheet it injects itself (@xterm/xterm 5.5.0
  // browser/renderer/dom/DomRenderer.ts, `_injectCss`), so the computed colour
  // of that element *is* the theme the terminal was given. Asked of the
  // running app rather than assumed.
  const painted = await paintedPalette(page);
  expect(
    painted.foreground,
    "the terminal has no rows container to read a colour off",
  ).not.toBeNull();

  expect(
    painted.foreground,
    "the terminal is painted in xterm's stock white — the app's palette is not reaching it",
  ).not.toBe(XTERM_STOCK_FOREGROUND);
  // The app's own answer to the same question, from an element wearing the
  // class the rest of the app uses. Read at runtime so this cannot drift from
  // whichever theme the build boots in.
  expect(
    painted.foreground,
    "the terminal's foreground is not the app's foreground",
  ).toBe(await appColor(page, "text-foreground", "color"));

  // The other three slots the component decides, each of which had been able
  // to go missing without a single assertion noticing. `cursorAccent` in
  // particular: it is the character drawn *under* a block cursor, so losing it
  // does not merely change a colour, it blanks the cell the cursor is on.
  expect(painted.cursor, "the terminal's cursor is not the app's accent").toBe(
    await appColor(page, "text-primary", "color"),
  );
  const surface = await appColor(page, "bg-background", "backgroundColor");
  expect(
    painted.cursorAccent,
    "the character under a block cursor is not drawn in the pane's own surface colour",
  ).toBe(surface);
  // And the terminal's own ground. Left unnamed this is `#000000`, painted
  // across the whole pane — the failure is not a wrong shade, it is a black
  // rectangle punched through a light theme.
  expect(
    painted.background,
    "the terminal is not painted on the app's own surface",
  ).toBe(surface);

  // The selection, by what it is rather than by what it is not. `not stock` on
  // its own is satisfied by any wrong token — the app's foreground included,
  // which would make selected text invisible.
  expect(
    painted.selection,
    "the terminal has no selection colour to read at all",
  ).not.toBeNull();
  expect(
    painted.selection,
    "the selection is xterm's stock white — the app's accent is not reaching it",
  ).not.toBe(xtermSelection(surface, XTERM_STOCK_SELECTION));
  expect(
    painted.selection,
    "the selection is not the app's accent composited over the pane's surface",
  ).toBe(
    xtermSelection(
      surface,
      await appColor(page, "bg-primary", "backgroundColor"),
    ),
  );
});

test("the terminal's palette follows a theme change", async ({ page }) => {
  await openWorkspace(page);

  const before = await paintedPalette(page);
  expect(
    before.foreground,
    "the terminal has no colours to change",
  ).not.toBeNull();
  expect(
    before.selection,
    "the terminal has no selection colour",
  ).not.toBeNull();

  // A theme switch, performed the way `shared/theme/ThemeProvider.tsx`
  // performs one: the tokens are bare HSL triples written as inline custom
  // properties on the root element. A terminal that kept the palette it was
  // born with would be the one surface still wearing the old theme, and that
  // failure is silent — it looks like a theme, just the wrong one.
  //
  // `--primary` is yellow on purpose. It resolves to `rgb(255, 255, 0)`: an
  // opaque colour whose blue channel is 0, which is exactly the shape a
  // transparency test written as a pattern match on the end of the string
  // throws away (`lib/terminalPalette.ts`). A dropped slot is not a missing
  // colour, it is xterm's own default coming back.
  await page.evaluate(() => {
    const root = document.documentElement;
    root.style.setProperty("--foreground", "300 100% 50%");
    root.style.setProperty("--primary", "60 100% 50%");
    root.style.setProperty("--background", "120 100% 25%");
  });

  const foreground = await appColor(page, "text-foreground", "color");
  const cursor = await appColor(page, "text-primary", "color");
  const cursorAccent = await appColor(page, "bg-background", "backgroundColor");
  const accent = await appColor(page, "bg-primary", "backgroundColor");
  expect(
    cursor,
    "the accent this test relies on did not resolve to the colour it is about",
  ).toBe("rgb(255, 255, 0)");
  expect(foreground, "the theme did not actually change").not.toBe(
    before.foreground,
  );

  await expect
    .poll(async () => (await paintedPalette(page)).foreground)
    .toBe(foreground);

  const after = await paintedPalette(page);
  expect(after.cursor, "the cursor kept the old theme's accent").toBe(cursor);
  expect(
    after.cursorAccent,
    "the character under the cursor kept the old theme's surface",
  ).toBe(cursorAccent);
  expect(
    after.background,
    "the terminal's own ground kept the old theme's surface",
  ).toBe(cursorAccent);
  expect(after.selection, "the selection kept the old theme's colour").not.toBe(
    before.selection,
  );
  // Which colour, not merely a different one. This is the reading that tells
  // the accent apart from the foreground: `--foreground` is rewritten by this
  // test too, so a selection drawn in the wrong token also "changed", and in
  // the theme the build boots in the two tokens happen to be the same colour.
  // Here they are magenta and yellow.
  expect(
    after.selection,
    "the selection is not the new accent composited over the new surface",
  ).toBe(xtermSelection(cursorAccent, accent));
});

test("a zoom keystroke does not re-apply the palette, and a theme change does", async ({
  page,
}) => {
  await openWorkspace(page);

  // How many times a palette has actually reached xterm. Applying one that
  // changed nothing is otherwise invisible — the terminal looks identical —
  // so without this counter the only difference between the gate working and
  // the gate being deleted is a repaint no assertion can see.
  const generation = async () =>
    Number(
      await page
        .locator("[data-palette-generation]")
        .first()
        .getAttribute("data-palette-generation"),
    );
  const opened = await generation();
  expect(opened, "no palette has been applied at all").toBeGreaterThan(0);

  // Cmd +/- zooms by writing an inline `font-size` on the root element
  // (`app/useWebviewZoomShortcuts.ts`) — the same attribute a theme switch
  // writes, so it reaches the terminal's observer as a theme change would. It
  // moves no colour, and every mounted terminal in the app would otherwise
  // rebuild its palette and refresh every row on each keystroke.
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "17px";
  });
  // Two frames: a MutationObserver callback runs as a microtask at the end of
  // the task that wrote the attribute, which is long before the next frame — so
  // this is past the callback rather than an arbitrary wait.
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      }),
  );
  expect(
    await generation(),
    "a zoom keystroke re-applied a palette that had not changed",
  ).toBe(opened);

  // And the other direction, in the same test so neither half can rot: a write
  // that does move the colours has to get through.
  await page.evaluate(() => {
    const root = document.documentElement;
    root.style.setProperty("--foreground", "300 100% 50%");
    root.style.setProperty("--primary", "60 100% 50%");
  });
  await expect
    .poll(generation, {
      message: "a real theme change never reached the terminal",
    })
    .toBeGreaterThan(opened);
  expect(
    await generation(),
    "the palette was applied more than once for one theme change — the zoom write got through after all",
  ).toBe(opened + 1);
});

test("the active tab is marked, and marking it moves nothing", async ({
  page,
}) => {
  await openWorkspace(page);

  const first = page.getByTestId("terminal-tab-1");
  const firstRow = first.locator("..");
  await expect(firstRow).toHaveAttribute("data-active", "true");
  await expect(first).toHaveAttribute("aria-selected", "true");

  // The box before and after it stops being the active one. The ring that
  // marks the active tab is drawn on every tab and is merely transparent on
  // the others, so gaining or losing it must cost no pixel of the row — a
  // strip that re-flowed on every ⌥⌘→ would be the fidget this replaces.
  const boxBefore = await firstRow.boundingBox();
  await page.getByTestId("terminal-tab-new").click();
  const second = page.getByTestId("terminal-tab-2");
  await expect(second).toBeVisible();
  await expect(second.locator("..")).toHaveAttribute("data-active", "true");
  await expect(firstRow).toHaveAttribute("data-active", "false");
  await expect(first).toHaveAttribute("aria-selected", "false");

  const boxAfter = await firstRow.boundingBox();
  expect(boxBefore, "the first tab has no box to measure").not.toBeNull();
  expect(
    boxAfter?.width,
    "a tab changes width when it stops being the active one",
  ).toBeCloseTo(boxBefore?.width ?? -1, 1);
  expect(
    boxAfter?.height,
    "a tab changes height when it stops being the active one",
  ).toBeCloseTo(boxBefore?.height ?? -1, 1);
});

test("many tabs cannot push the new-tab button out of reach", async ({
  page,
}) => {
  // Narrow, so the strip overflows at a tab count this test can reach: the
  // left pane is floored at 80 columns (`paneModel.ts`), so a narrow window is
  // the only way to get a short strip.
  await openWorkspace(page, 1100);

  const scroller = page.getByTestId("terminal-tab-scroller");
  const plus = page.getByTestId("terminal-tab-new");

  // The button is outside the scroller. This is the whole fix: inside it, it
  // scrolls away with the tabs and the only affordance that makes a terminal
  // is off screen.
  const inside = await page.evaluate(() => {
    const box = document.querySelector('[data-testid="terminal-tab-scroller"]');
    const button = document.querySelector('[data-testid="terminal-tab-new"]');
    return box !== null && button !== null && box.contains(button);
  });
  expect(inside, "the new-tab button lives inside the scroller").toBe(false);

  const overflowing = () =>
    scroller.evaluate((el) => el.scrollWidth > el.clientWidth + 1);

  let opened = 1;
  while (opened < 30 && !(await overflowing())) {
    await plus.click();
    opened += 1;
    await expect(page.getByTestId(`terminal-tab-${opened}`)).toBeVisible();
  }
  expect(
    await overflowing(),
    "the strip never overflowed, so this test proves nothing about overflow",
  ).toBe(true);

  // Still clickable at its own coordinates — Playwright refuses a click on an
  // element another element covers or that is out of the viewport, so this is
  // the reachability claim rather than a repeat of the containment one.
  await expect(plus).toBeInViewport();
  await plus.click();
  await expect(page.getByTestId(`terminal-tab-${opened + 1}`)).toBeVisible();

  // And selecting a tab that is off screen brings it back into the scroller's
  // own box.
  //
  // **Driven by ⌥⌘←, not by a click.** A click cannot prove this: Playwright
  // runs `scrollRectIntoViewIfNeeded` on its target as part of the actionability
  // checks that precede every click, walking every scrollable ancestor —
  // including this scroller. The containment then holds whether or not the
  // component does anything at all, which is a test that passes with the effect
  // it is about deleted. The keyboard is also the case the effect exists for:
  // ⌥⌘←/→ steps through the ordinals whether or not they are on screen
  // (`TerminalTabStrip.tsx`), and nothing else is going to scroll them there.
  const active = opened + 1;
  await expect(
    page.getByTestId(`terminal-tab-${active}`).locator(".."),
  ).toHaveAttribute("data-active", "true");
  expect(
    await scroller.evaluate((el) => el.scrollLeft),
    "the strip is overflowing but never scrolled, so the active tab was already visible",
  ).toBeGreaterThan(0);

  // Back to the left edge by hand, which puts the active tab — the newest, at
  // the far right — outside the scroller's box with nothing having selected it.
  await scroller.evaluate((el) => {
    el.scrollLeft = 0;
  });
  expect(
    await inScroller(page, active),
    "the active tab is still on screen, so stepping off it proves nothing",
  ).toBe(false);

  const stepped = active - 1;
  await page.keyboard.press("ControlOrMeta+Alt+ArrowLeft");
  await expect(
    page.getByTestId(`terminal-tab-${stepped}`).locator(".."),
  ).toHaveAttribute("data-active", "true");
  await expect
    .poll(() => inScroller(page, stepped), {
      message:
        "the tab ⌥⌘← selected is off screen — selecting a tab does not show it",
    })
    .toBe(true);

  // And by the smallest movement that gets it there, on the scroller alone: the
  // tab is brought to the right edge, not centred and not scrolled past.
  const [moved, wanted] = await page.evaluate((n) => {
    const box = document.querySelector<HTMLElement>(
      '[data-testid="terminal-tab-scroller"]',
    );
    const tab = document
      .querySelector<HTMLElement>(`[data-testid="terminal-tab-${n}"]`)
      ?.closest<HTMLElement>("[data-active]");
    if (
      box === undefined ||
      box === null ||
      tab === undefined ||
      tab === null
    ) {
      return [null, null];
    }
    return [box.scrollLeft, tab.offsetLeft + tab.offsetWidth - box.clientWidth];
  }, stepped);
  expect(wanted, "the strip has no boxes to measure").not.toBeNull();
  expect(
    moved,
    "the scroller moved further than showing the selected tab needed",
  ).toBeCloseTo(wanted ?? -1, 0);
});

test("a terminal scrolled back offers a way to the newest output", async ({
  page,
}) => {
  await openWorkspace(page);

  // Enough output that there is a scrollback to be behind. This terminal is
  // not in tmux's mouse mode — under tmux there is nothing in this subtree to
  // scroll and the control correctly never appears (`terminalScrollback.ts`).
  await page.evaluate(() => {
    window.__CHROME_FEED__(
      Array.from({ length: 400 }, (_, i) => `line-${i + 1}\r\n`).join(""),
    );
  });

  const session = await page.evaluate(() => window.__CHROME_PROBE__.session);
  const jump = page.getByTestId(`terminal-jump-to-bottom-${session}`);

  // Wait for xterm to have taken *all* of the output, not merely some of it.
  // `write` is asynchronous and chunked: xterm parses under a time budget and
  // yields between chunks, so the buffer grows across several tasks. Both ends
  // of that matter here. Scrolling before the first chunk lands assigns 0 to a
  // `scrollTop` that is already 0, which fires no scroll event at all;
  // scrolling between chunks puts the view back at the bottom when the next
  // one arrives, which is what made this test pass one run in three. So the
  // condition is the buffer having *stopped* growing, read twice.
  await expect
    .poll(
      async () => {
        const first = await page.evaluate(() => {
          const viewport = document.querySelector(".xterm-viewport");
          return viewport === null ? 0 : viewport.scrollHeight;
        });
        await page.waitForTimeout(120);
        const second = await page.evaluate(() => {
          const viewport = document.querySelector(".xterm-viewport");
          return viewport === null ? 0 : viewport.scrollHeight;
        });
        return first > 0 && first === second;
      },
      { timeout: 10_000 },
    )
    .toBe(true);

  await expect
    .poll(() =>
      page.evaluate(() => {
        const viewport = document.querySelector(".xterm-viewport");
        return viewport === null
          ? 0
          : viewport.scrollHeight - viewport.clientHeight;
      }),
    )
    .toBeGreaterThan(0);

  // At the bottom there is nothing to offer, so there is no control at all.
  await expect(jump).toHaveCount(0);

  // Scroll the viewport xterm owns to the top. Assigning `scrollTop` fires the
  // scroll event xterm's own viewport listens on, which is the same path a
  // wheel takes when tmux is not holding the history.
  await page.evaluate(() => {
    const viewport = document.querySelector(".xterm-viewport");
    if (viewport === null) throw new Error("the terminal has no viewport");
    if (viewport.scrollTop === 0) {
      throw new Error("the terminal was not at the bottom to scroll up from");
    }
    viewport.scrollTop = 0;
  });

  await expect(jump).toBeVisible();
  const behind = Number(await jump.getAttribute("data-lines-behind"));
  expect(
    behind,
    "the control appeared but claims no distance, so it is not reading the buffer",
  ).toBeGreaterThan(0);
  // The count is the reading, not decoration: it has to be in what is drawn.
  await expect(jump).toContainText(String(behind));
  // And the act is named where there is room for it, not in the label.
  await expect(jump).toHaveAttribute(
    "aria-label",
    /jump to the newest output/i,
  );

  // Where the keyboard is before the click, so that "still there" afterwards
  // means something. xterm keeps focus on a helper textarea of its own; this is
  // what `term.focus()` does.
  await page.evaluate(() => {
    const textarea = document.querySelector<HTMLTextAreaElement>(
      ".xterm-helper-textarea",
    );
    if (textarea === null) throw new Error("the terminal has no textarea");
    textarea.focus();
  });
  expect(
    await page.evaluate(
      () => document.activeElement?.closest(".xterm") !== null,
    ),
    "the terminal did not take focus, so this proves nothing about keeping it",
  ).toBe(true);

  await jump.click();
  await expect(jump).toHaveCount(0);

  // And the shell still has the keyboard. A control that moves the view must
  // not take focus with it — otherwise the owner's next keystroke goes nowhere
  // and he has to click back into his own terminal to find out why.
  expect(
    await page.evaluate(
      () => document.activeElement?.closest(".xterm") !== null,
    ),
    "clicking jump-to-bottom took the keyboard away from the shell",
  ).toBe(true);
});

test("the persistence claim says which backing it is making", async ({
  page,
}) => {
  await openWorkspace(page);

  // The claim's subject, as an attribute rather than as prose — the sentence
  // is `terminalPersistence.ts`'s to word and this must not re-assert it.
  const persistence = page.getByTestId("terminal-persistence");
  await expect(persistence).toBeVisible();
  await expect(persistence).toHaveAttribute("data-backing", "tmux");
  // It is still one readable unit in the `·`-separated run, not a bare span.
  await expect(persistence).toHaveClass(/bg-muted/);
});
