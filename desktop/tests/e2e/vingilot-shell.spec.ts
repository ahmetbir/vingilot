import { expect, test, type Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

/**
 * The P1 shell (vingilot redesign, 2026-08-29 plan): the 44px top bar, the
 * Appearance tray, the sidebar's new anatomy, the resize clamp, and the
 * shell-owned chords. Everything asserted here is a claim the unit tests
 * cannot make — painted geometry, real keydown routing through three
 * claimants, localStorage round-trips through a reload.
 */

const TOP_BAR_HEIGHT = 44;
const SIDEBAR_MIN = 196;
const SIDEBAR_MAX = 340;
const SIDEBAR_DEFAULT = 244;

const WORLD_KEY = "vingilot-palette-world.v1";
const SEEDED_WORLD = {
  projects: [{ id: "repo-vingilot", name: "vingilot", path: "/w/vingilot" }],
  worktrees: [
    {
      bindingId: "bind-p1",
      label: "finding-things",
      detail: "vingilot — finding-things",
    },
  ],
  recentFiles: [],
};

async function spoofMac(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "platform", { get: () => "MacIntel" });
  });
}

async function openApp(page: Page) {
  await installMockBridge(page);
  await page.goto("/");
  await expect(page.getByTestId("app-sidebar")).toBeVisible();
}

async function openChannel(page: Page, name = "general") {
  await page.getByTestId(`channel-${name}`).click();
  await expect(page.getByTestId("chat-title")).toHaveText(name);
}

function sidebarRail(page: Page) {
  return page.locator('[data-sidebar="rail"]');
}

async function dragSidebarRail(page: Page, deltaX: number) {
  const rail = sidebarRail(page);
  await expect(rail).toBeVisible();
  const box = await rail.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + deltaX, startY, { steps: 8 });
  await page.mouse.up();
}

async function sidebarWidth(page: Page) {
  return page.getByTestId("app-sidebar").evaluate((element) => {
    return Math.round(element.getBoundingClientRect().width);
  });
}

test("top bar: 44px drag region with the mockup's controls, clear of the traffic lights", async ({
  page,
}) => {
  await spoofMac(page);
  await openApp(page);

  const bar = page.getByTestId("app-top-chrome");
  await expect(bar).toBeVisible();
  // The whole strip stays the window's drag handle (JSX renders the bare
  // attribute as "true").
  await expect(bar).toHaveAttribute("data-tauri-drag-region", "true");
  const barBox = await bar.boundingBox();
  expect(barBox).not.toBeNull();
  expect(barBox?.height ?? 0).toBe(TOP_BAR_HEIGHT);
  expect(barBox?.y ?? -1).toBe(0);

  // Left cluster: the toggle and the two history buttons keep their testids,
  // and on macOS the row starts past the native traffic lights (80px inset
  // without a community rail).
  const toggle = page.getByRole("button", { name: "Toggle Sidebar" });
  await expect(toggle).toBeVisible();
  const toggleBox = await toggle.boundingBox();
  expect(toggleBox?.x ?? 0).toBeGreaterThanOrEqual(80);
  await expect(page.getByTestId("global-back")).toBeVisible();
  await expect(page.getByTestId("global-forward")).toBeVisible();

  // The search pill is centered on the window, not flexed between the sides.
  const pill = page.getByTestId("top-search-pill");
  await expect(pill).toBeVisible();
  await expect(pill).toContainText("Search everything");
  await expect(pill).toContainText("⌘K");
  const pillBox = await pill.boundingBox();
  const viewport = page.viewportSize();
  expect(pillBox).not.toBeNull();
  expect(viewport).not.toBeNull();
  if (!pillBox || !viewport) return;
  const pillCenter = pillBox.x + pillBox.width / 2;
  expect(Math.abs(pillCenter - viewport.width / 2)).toBeLessThanOrEqual(1);

  // Right cluster.
  await expect(page.getByTestId("top-chrome-history")).toBeVisible();
  await expect(page.getByTestId("top-chrome-copy-link")).toBeVisible();
  await expect(page.getByTestId("top-chrome-appearance")).toBeVisible();

  // Copy-link is honest about its target: disabled where no channel is, armed
  // on a channel view.
  await expect(page.getByTestId("top-chrome-copy-link")).toBeDisabled();
  await openChannel(page);
  await expect(page.getByTestId("top-chrome-copy-link")).toBeEnabled();
});

test("the search pill and the History button open the one palette", async ({
  page,
}) => {
  await openApp(page);

  await page.getByTestId("top-search-pill").click();
  await expect(page.getByTestId("shell-palette")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("shell-palette")).toBeHidden();

  // History v1 = the palette's Recent/Go section.
  await page.getByTestId("top-chrome-history").click();
  await expect(page.getByTestId("shell-palette")).toBeVisible();
  await page.keyboard.press("Escape");
});

test("⌘K fires exactly one palette", async ({ page }) => {
  await openApp(page);
  await openChannel(page);

  await page.keyboard.press("Meta+k");
  // The fork's palette answered (capture phase + preventDefault) …
  await expect(page.getByTestId("shell-palette")).toBeVisible();
  // … and upstream's search dialog honored defaultPrevented and stayed shut.
  await expect(page.getByTestId("search-dialog-input")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("shell-palette")).toBeHidden();
});

test("⌘B is the shell's single sidebar toggle, and the composer's Bold outranks it", async ({
  page,
}) => {
  await openApp(page);
  await openChannel(page);

  // Expanded ⟺ the resize rail is interactive (it hides when collapsed).
  await expect(sidebarRail(page)).toBeVisible();

  // The channel view autofocuses the composer, whose Bold rightly owns ⌘B —
  // park focus on the timeline chrome first to test the shell's claim.
  await page.getByTestId("chat-title").click();
  await page.keyboard.press("Meta+b");
  await expect(sidebarRail(page)).toBeHidden();
  await page.keyboard.press("Meta+b");
  await expect(sidebarRail(page)).toBeVisible();

  // With the caret in the composer, TipTap claims ⌘B for Bold
  // (preventDefault) and the shell leaves the sidebar alone.
  await page.getByTestId("message-input").click();
  await page.keyboard.type("bold claim");
  await page.keyboard.press("Meta+a");
  await page.keyboard.press("Meta+b");
  await expect(sidebarRail(page)).toBeVisible();
  await expect(page.getByTestId("message-input").locator("strong")).toHaveText(
    "bold claim",
  );
});

test("⌥⌘B is claimed but idle outside the workspace", async ({ page }) => {
  await openApp(page);
  await openChannel(page);

  // Zen has no dock to hide until P3: the chord must neither toggle the
  // sidebar nor fall through to anything else.
  await page.keyboard.press("Alt+Meta+b");
  await expect(sidebarRail(page)).toBeVisible();
  await expect(page.getByTestId("shell-palette")).toBeHidden();
});

test("the sidebar resize clamps at the mockup's 196–340", async ({ page }) => {
  await openApp(page);

  expect(await sidebarWidth(page)).toBe(SIDEBAR_DEFAULT);

  await dragSidebarRail(page, -400);
  await expect.poll(() => sidebarWidth(page)).toBe(SIDEBAR_MIN);

  await dragSidebarRail(page, 600);
  await expect.poll(() => sidebarWidth(page)).toBe(SIDEBAR_MAX);
});

test("the Appearance tray switches wash and accent live, and the crew choice persists", async ({
  page,
}) => {
  await openApp(page);

  await page.getByTestId("top-chrome-appearance").click();
  const tray = page.getByTestId("vingilot-appearance-tray");
  await expect(tray).toBeVisible();

  // Wash: the root attribute flips, the gradient tokens follow through the
  // stylesheet, and the choice lands in its own storage key.
  await page.getByTestId("vingilot-wash-slate").click();
  await expect(page.locator(":root")).toHaveAttribute(
    "data-vingilot-wash",
    "slate",
  );
  const gradientTop = await page.evaluate(() =>
    getComputedStyle(document.documentElement)
      .getPropertyValue("--buzz-gradient-dark-top")
      .trim(),
  );
  expect(gradientTop).toBe("#2a3240");
  expect(await page.evaluate(() => localStorage.getItem("vingilot-wash"))).toBe(
    "slate",
  );

  // Accent: same pipeline, second key.
  await page.getByTestId("vingilot-accent-teal").click();
  await expect(page.locator(":root")).toHaveAttribute(
    "data-vingilot-accent",
    "teal",
  );
  expect(
    await page.evaluate(() => localStorage.getItem("vingilot-accent")),
  ).toBe("teal");

  // Crew panel: stored now, read by P3's dock later — and the tray says so.
  await expect(tray).toContainText("Arrives with the dock");
  await page.getByTestId("vingilot-crew-drawer").click();
  await expect(page.getByTestId("vingilot-crew-drawer")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(
    await page.evaluate(() => localStorage.getItem("vingilot-crew-position")),
  ).toBe("drawer");

  await page.reload();
  await expect(page.getByTestId("app-sidebar")).toBeVisible();
  await expect(page.locator(":root")).toHaveAttribute(
    "data-vingilot-wash",
    "slate",
  );
  await page.getByTestId("top-chrome-appearance").click();
  await expect(page.getByTestId("vingilot-crew-drawer")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("nav rows keep the mockup's order and the me-footer carries the relay dot", async ({
  page,
}) => {
  await openApp(page);

  // Inbox → Agents → Pull requests → Deck, top to bottom.
  const inbox = page
    .getByTestId("sidebar-primary-menu")
    .getByRole("button", { name: "Inbox" });
  const agents = page.getByTestId("open-agents-view");
  const pullRequests = page.getByTestId("open-projects-view");
  const deck = page.getByTestId("open-workspace-view");
  await expect(inbox).toBeVisible();
  await expect(agents).toBeVisible();
  await expect(pullRequests).toBeVisible();
  await expect(pullRequests).toContainText("Pull requests");
  await expect(deck).toBeVisible();
  const rows = await Promise.all(
    [inbox, agents, pullRequests, deck].map((row) => row.boundingBox()),
  );
  for (let i = 1; i < rows.length; i += 1) {
    expect(rows[i - 1]?.y ?? 0).toBeLessThan(rows[i]?.y ?? 0);
  }

  // The me-footer's relay dot reads the shared connection state — the mock
  // bridge connects, so it reports green.
  const dot = page.getByTestId("sidebar-connection-dot");
  await expect(dot).toBeVisible();
  await expect(dot).toHaveAttribute("data-connection", "connected");
});

test("the Projects section renders the workspace's last snapshot with attention marks", async ({
  page,
}) => {
  await page.addInitScript(
    ({ key, world }) => {
      window.localStorage.setItem(key, JSON.stringify(world));
    },
    { key: WORLD_KEY, world: SEEDED_WORLD },
  );
  await openApp(page);

  const section = page.getByTestId("sidebar-projects-section");
  await expect(section).toBeVisible();
  await expect(page.getByTestId("sidebar-project-repo-vingilot")).toContainText(
    "vingilot",
  );
  const worktree = page.getByTestId("sidebar-worktree-bind-p1");
  await expect(worktree).toContainText("finding-things");
  // The dot renders in AttentionDot's vocabulary (a real state or "none"),
  // never a guessed one.
  await expect(worktree.locator("[data-attention]")).toHaveCount(1);

  // Selecting a row lands on /workspace, where the live list decides.
  await page.getByTestId("sidebar-project-repo-vingilot").click();
  await expect.poll(() => page.url()).toContain("workspace");
});
