// ⌃Tab, proved against a real render
// (vingilot/docs/plans/2026-08-12-vscode-muscle-memory.md, Task 3).
//
// > *"belki şöyle cmd tab tarzı bir şey"*
//
// `placeMru.test.mjs` owns the list — dedupe, the cap, the wrap, and that a tap
// and a hold are the same reducer. `placeKeys.test.mjs` owns what the chord
// means and everything it refuses. None of that needs a browser.
//
// **Five readings only a browser can give, each a real failure mode:**
//
// 1. **The trail is built by NAVIGATION, and the browser is the only place the
//    navigation exists.** A worktree row clicked, a pane chosen, a file opened
//    in the tree: three different code paths in three different components, and
//    the model cannot see any of them. Asserted as the rows the overlay draws,
//    in the order it draws them.
// 2. **The chord ARRIVES.** A claimant check is a reading of source, and ⌘W was
//    lost for want of a press. So ⌃⇥ is pressed — with `page.keyboard.down`,
//    because the whole gesture is *holding* a modifier and `press()` would
//    release it before the overlay could exist.
// 3. **The overlay is drawn where ⌘K is drawn, over a hosted channel surface.**
//    The same reading `workspace-palette-over-thread.spec.ts` takes of ⌘K,
//    taken again because this is a *second* overlay in the same box: the defect
//    it was written for (a pane's `z-40` chrome outranking a `z-30` overlay) is
//    a property of the box, not of the palette. Read twice on purpose — the
//    hit-test sweep, and the two overlays' resolved z-index compared directly.
//    The sweep alone passes for the wrong reason today (the pane is a stacking
//    context and this overlay is later in the tree, so even a wrong z comes out
//    on top), which is exactly the vacancy this file is meant to avoid.
// 4. **A focused terminal does not eat it.** @xterm/xterm 5.5.0 resolves ⌃⇥ to
//    a literal tab it writes to the pty and then cancels the event
//    (`common/input/Keyboard.ts` case 9 ignores `ctrlKey` entirely). Nothing in
//    a unit test can see a window-capture listener beating a listener on
//    xterm's own textarea.
// 5. **A pane that came back empty is drawn as empty.** The Files pane is
//    remounted by a pane switch as well as by a worktree switch and comes back
//    with nothing in its viewer, so the workspace's copy of its last report has
//    to expire. `placeMru.test.mjs` owns the reducer that expires it; only a
//    browser can show that the two remounts really are remounts and that the
//    report which ends the wait is really made.
// 6. **The palette keeps the keyboard while it is up, and gives it back.** This
//    listener is bound for the life of the screen and the palette's when the
//    palette opens, so on registration order alone this one runs first; that it
//    stands down is a decision, and one nothing outside a browser can read.
//
// The commands are stubbed through the property trap `workspace-find.spec.ts`
// documents: the bridge assigns `invoke` during boot and the home-directory
// lookup runs on the first render, so an override installed after boot is too
// late. Everything this spec does not answer for falls through to the mock
// bridge, which is what lets one harness serve the Files pane and a real hosted
// channel in the Team pane.

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";

const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
const COORDINATOR_ORIGIN = "http://127.0.0.1:7117";

/** The 16-inch MacBook Pro's own logical resolution — the machine every
 * complaint in this plan was made about. */
const SIXTEEN_INCH = { height: 1117, width: 1728 };

const GIT_HOME = "/tmp/vingilot-places-home";
const REPO = {
  id: "repo-places",
  name: "vingilot",
  path: "/tmp/vingilot-places",
};

/** Two worktrees, because a *place* is worktree + pane and a switcher proved
 * over one checkout would prove only half of it. Both are task worktrees so
 * both carry a branch name, which is what the overlay's row prints. */
const WORKTREES = ["spike", "polish"].map((branch) => ({
  added: null,
  base_commit: "0".repeat(40),
  binding_id: `wt-${branch}`,
  branch,
  commit_sha: null,
  lifecycle: "active",
  owner_run_id: `run-${branch}`,
  owner_run_objective: null,
  owner_run_status: null,
  removed: null,
  repo_id: REPO.id,
  role: "task",
}));

const TREE: Record<
  string,
  { name: string; kind: string; size: number | null }[]
> = {
  "": [{ kind: "directory", name: "src", size: null }],
  src: [
    { kind: "file", name: "main.rs", size: 32 },
    { kind: "file", name: "lib.rs", size: 32 },
  ],
};

const FILES: Record<string, string> = {
  "src/lib.rs": "pub fn two() -> u8 { 2 }\n",
  "src/main.rs": 'fn main() { println!("one"); }\n',
};

const PERSONAS = [
  { displayName: "Planner", id: "persona-planner", systemPrompt: "Plan it." },
];

const TEAM = {
  description: "Plans it.",
  id: "team-places",
  name: "Places Team",
  personaIds: ["persona-planner"],
};

type TrapWindow = Window & {
  __TAURI_INTERNALS__: {
    invoke: (cmd: string, args?: unknown, opts?: unknown) => unknown;
  };
};

async function openWorkspace(page: Page) {
  await page.setViewportSize(SIXTEEN_INCH);
  await installMockBridge(page, { personas: PERSONAS, teams: [TEAM] });
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
    if (url.pathname === `/v1/workspaces/${WORKSPACE_ID}/worktrees`) {
      return route.fulfill({ json: { worktrees: WORKTREES } });
    }
    if (url.pathname === `/v1/workspaces/${WORKSPACE_ID}/runs`) {
      return route.fulfill({ json: { runs: [] } });
    }
    return route.fulfill({
      json: { detail: `unmocked route: ${url.pathname}`, error: "not_found" },
      status: 404,
    });
  });

  await page.addInitScript(
    ([home, tree, files]: [
      string,
      Record<string, { name: string; kind: string; size: number | null }[]>,
      Record<string, string>,
    ]) => {
      const w = window as unknown as TrapWindow;
      let fallback:
        | ((cmd: string, args?: unknown, opts?: unknown) => unknown)
        | null = null;

      const invoke = (cmd: string, args?: unknown, opts?: unknown): unknown => {
        const name = String(cmd);
        if (name.startsWith("plugin:path|")) return Promise.resolve(`${home}/`);
        if (name === "worktree_tree") {
          const dir = ((args ?? {}) as { dir?: string }).dir ?? "";
          const entries = tree[dir];
          if (entries === undefined) {
            return Promise.reject({ kind: "not-found", path: dir });
          }
          return Promise.resolve({
            dir,
            entries,
            limit: 2000,
            truncated: false,
          });
        }
        if (name === "file_read") {
          const path = ((args ?? {}) as { path?: string }).path ?? "";
          const text = files[path];
          if (text === undefined) {
            return Promise.reject({
              detail: "No such file or directory (os error 2)",
              kind: "unreadable",
              path,
            });
          }
          return Promise.resolve({
            bytes: text.length,
            lines: text.replace(/\n$/, "").split("\n").length,
            path,
            text,
          });
        }
        if (name === "worktree_diff") {
          return Promise.resolve({
            additions: 0,
            base: "HEAD",
            deletions: 0,
            files: [],
            limits: {
              maxFiles: 400,
              maxPatchBytes: 262_144,
              maxPatchLines: 2000,
              maxUntracked: 100,
            },
            omittedFiles: 0,
            omittedUntracked: 0,
          });
        }
        if (name === "worktree_stats") {
          const paths = ((args ?? {}) as { paths?: string[] }).paths ?? [];
          return Promise.resolve(
            paths.map((path) => ({
              additions: 0,
              changedFiles: 0,
              deletions: 0,
              dirty: false,
              path,
              unreadable: false,
              untracked: 0,
            })),
          );
        }
        if (name === "worktree_list") return Promise.resolve([]);
        if (name === "pty_backing") return Promise.resolve("tmux");
        if (name.startsWith("pty_")) return Promise.resolve(null);
        if (fallback === null)
          return Promise.reject(new Error(`no host for ${name}`));
        return fallback(cmd, args, opts);
      };

      const internals = (w.__TAURI_INTERNALS__ ??
        {}) as TrapWindow["__TAURI_INTERNALS__"];
      w.__TAURI_INTERNALS__ = internals;
      Object.defineProperty(internals, "invoke", {
        configurable: true,
        get: () => invoke,
        set: (fn: (cmd: string, args?: unknown, opts?: unknown) => unknown) => {
          fallback = fn;
        },
      });
    },
    [GIT_HOME, TREE, FILES] as const,
  );

  await page.goto("/#/workspace");
  await expect(page.getByTestId("runs-screen")).toBeVisible();
  await page.getByTestId(`projects-nav-repo-${REPO.id}`).click();
  await expect(page.getByTestId("work-surface")).toBeVisible();
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

/** What pane the dock is showing, read the way `dock.spec.ts` reads it. */
async function expectDockTab(page: Page, tab: string) {
  await expect(page.getByTestId("dock")).toHaveAttribute(
    "data-dock-selection",
    tab,
  );
}

async function selectWorktree(page: Page, branch: string) {
  // Since P1.1 the Projects tree renders directly — no "Worktrees" accordion
  // to open first (owner veto 4; `sidebar-deck-accordion.spec.ts` is the
  // living idiom).
  await page.getByTestId(`worktree-row-wt-${branch}`).click();
}

/** Open a file from the dock's Files tree — the only one since P4.1, and the
 * click that opens the reading as a tab on the stage. The pane must already be
 * in the slot: this is the third of the three navigations that feed the
 * trail. */
async function openFileFromTree(page: Page, name: string) {
  await expect(page.getByTestId("dock-files")).toBeVisible();
  await expect(page.getByTestId("dock-files-tree")).toBeVisible();
  const dir = page.getByTestId("dock-files-row-src");
  if ((await page.getByTestId(`dock-files-row-src/${name}`).count()) === 0) {
    await dir.click();
  }
  await page.getByTestId(`dock-files-row-src/${name}`).click();
  await expect(page.getByTestId("files-viewer-path")).toHaveText(`src/${name}`);
}

/** Every row the overlay is drawing, as "<worktree> · <pane>[ · <file>]", with
 * the row a release would land on marked `>`.
 *
 * Read off the row's three named parts rather than off its `textContent`: the
 * parts are laid out with a flex gap and no separator characters, so the raw
 * text runs the worktree into the pane ("polishFiles") and a reading built on
 * that would be a reading of the CSS. */
async function overlayRows(page: Page) {
  return page.getByTestId("place-switcher").evaluate((panel) =>
    Array.from(panel.querySelectorAll("li")).map((row, at) => {
      const part = (name: string) =>
        row.querySelector(`[data-testid="place-row-${at}-${name}"]`)
          ?.textContent?.length
          ? (row.querySelector(`[data-testid="place-row-${at}-${name}"]`)
              ?.textContent ?? "")
          : null;
      const file = part("file");
      return [
        row.dataset.active === "true" ? ">" : " ",
        part("where"),
        "·",
        part("pane"),
        ...(file === null ? [] : ["·", file]),
      ].join(" ");
    }),
  );
}

/** Walk the trail with ⌃ held down. `steps` presses of ⇥ (or ⇧⇥ when
 * `back`), leaving the modifier down so the caller can read the overlay before
 * committing. */
async function holdAndStep(page: Page, steps: number, back = false) {
  await page.keyboard.down("Control");
  for (let n = 0; n < steps; n += 1) {
    if (back) {
      await page.keyboard.down("Shift");
      await page.keyboard.press("Tab");
      await page.keyboard.up("Shift");
    } else {
      await page.keyboard.press("Tab");
    }
  }
}

/** The trail this spec is read against, walked by hand.
 *
 * Six places come out of it, and the two that are not gestures in this function
 * are the interesting ones: entering the project auto-selects the repo's own
 * checkout (`main`) and each worktree opens on its own default arrangement, so
 * `main · Diff` and `polish · Diff` are recorded without anything here choosing
 * them. That is what "fed by real navigation" means, and it is asserted rather
 * than trimmed — a trail that held only the places a test remembered to make
 * would be a trail the model wrote, not one the app did.
 *
 * Newest first, the list is:
 *
 *   0  polish · Files                  (where he is standing)
 *   1  polish · Diff
 *   2  spike  · Files · src/main.rs
 *   3  spike  · Files                  (the pane before the file was opened)
 *   4  spike  · Diff
 *   5  main   · Diff                   (the checkout the project opened on)
 */
async function buildTrail(page: Page) {
  await selectWorktree(page, "spike");
  await choosePane(page, "diff");
  await expectDockTab(page, "diff");
  await choosePane(page, "files");
  await openFileFromTree(page, "main.rs");
  await selectWorktree(page, "polish");
  // The pane arrangement is per worktree, so `polish` arrives on its own default
  // (Diff) — that is row 1 — and choosing Files here is what makes rows 0 and 2
  // differ in the worktree as well as in the file.
  await choosePane(page, "files");
  await expect(page.getByTestId("dock-files")).toBeVisible();
}

/** What `buildTrail` produces, as `overlayRows` reads it, with the cursor on
 * `at`. Written out once so every test below is asserting the same trail. */
function trailRows(at: number) {
  return [
    "polish · Files",
    "polish · Diff",
    "spike · Files · src/main.rs",
    "spike · Files",
    "spike · Diff",
    "main · Diff",
  ].map((row, n) => `${n === at ? ">" : " "} ${row}`);
}

test("⌃Tab holds up the places he actually walked, and letting go lands on one", async ({
  page,
}) => {
  await openWorkspace(page);
  await buildTrail(page);

  // Nothing before the chord: the overlay is the gesture, not a panel that is
  // always there.
  await expect(page.getByTestId("place-switcher")).toHaveCount(0);

  await holdAndStep(page, 1);
  const overlay = page.getByTestId("place-switcher");
  await expect(overlay).toBeVisible();

  // **The trail, read as the rows it draws.** Newest first, every one of them
  // put there by a navigation and none of them by this test's imagination — see
  // `buildTrail`. The cursor is on row 1 after a single ⇥ and never on row 0,
  // because row 0 is here.
  expect(await overlayRows(page)).toEqual(trailRows(1));

  // ⇥ walks down and ⇧⇥ comes back, and the walk is the same trail.
  await page.keyboard.press("Tab");
  expect(await overlayRows(page)).toEqual(trailRows(2));
  await page.keyboard.down("Shift");
  await page.keyboard.press("Tab");
  await page.keyboard.up("Shift");
  expect(await overlayRows(page)).toEqual(trailRows(1));
  // Down to the place that carries all three fields.
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("place-row-2")).toHaveAttribute(
    "data-active",
    "true",
  );

  // **Letting go lands**, on all three fields of the place: the worktree, the
  // pane, and the file that worktree's Files pane had open.
  await page.keyboard.up("Control");
  await expect(overlay).toHaveCount(0);
  await expect(page.getByTestId("dock-files")).toBeVisible();
  await expect(page.getByTestId("files-viewer-path")).toHaveText("src/main.rs");
  // Which worktree he is standing in, read off the one surface that names it on
  // every screen and every tab (`ProjectStatusBar`) rather than off a row's
  // background, which would be an assertion about a paint choice.
  await expect(page.getByTestId("project-status-bar")).toContainText("spike");
});

// RETIRED WITH ITS SUBJECT (P4.1): this proved that the workspace's copy of the
// Files pane's report EXPIRED when the pane was remounted — a pane switch away
// and back used to give an empty viewer, and a workspace still holding
// "src/main.rs" would have drawn a phantom row 0. There is no report any more:
// a file is a tab beside the shells, it survives every pane switch on purpose
// ("terminalin oldugu kisimda yeni tab gibi acilmali"), and the workspace
// derives "what is open" from the tab that is showing rather than being told.
// The failure this guarded — a place naming a file the surface is not showing —
// cannot be spelled, because the thing that names it IS the surface.
// `sidebar-deck-accordion.spec.ts`'s "the reading survives a pane switch" is
// the positive half of the same claim.

test("a tap goes straight to the previous place, and a second tap comes back", async ({
  page,
}) => {
  // The alt-tab reflex. Not a second rule in the model — a tap is one step and a
  // landing — but it is the one the hands know, and it is where the dedupe earns
  // its keep: after landing, the place he *left* has to have moved to index 1,
  // or the second tap would carry on down the list instead of coming back.
  await openWorkspace(page);
  await buildTrail(page);

  // Press and release with nothing in between: straight to `polish · Diff`.
  await page.keyboard.down("Control");
  await page.keyboard.press("Tab");
  await page.keyboard.up("Control");
  await expectDockTab(page, "diff");
  await expect(page.getByTestId("project-status-bar")).toContainText("polish");

  // And back. Same key, same tap — the list reordered under it.
  await page.keyboard.down("Control");
  await page.keyboard.press("Tab");
  await page.keyboard.up("Control");
  await expectDockTab(page, "files");
  await expect(page.getByTestId("project-status-bar")).toContainText("polish");

  // **Six rows, not eight.** Two landings on places that were already in the
  // trail added no rows to it — they moved, which is the whole of why a tap
  // toggles rather than walking away.
  await holdAndStep(page, 1);
  await expect(page.getByTestId("place-switcher").locator("li")).toHaveCount(6);
  expect(await overlayRows(page)).toEqual(trailRows(1));

  // Esc calls it off, with ⌃ still down — and nothing moved.
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("place-switcher")).toHaveCount(0);
  await page.keyboard.up("Control");
  await expectDockTab(page, "files");
  await expect(page.getByTestId("project-status-bar")).toContainText("polish");
});

test("nothing in the team thread is painted over the switcher", async ({
  page,
}) => {
  // The stacking reading, taken again for a *second* overlay in the same box.
  // `workspace-palette-over-thread.spec.ts` proved it for ⌘K; the property it
  // proved belongs to the box (a pane is a stacking context, so a number inside
  // a pane is a number about the pane) and a new surface that got its own z
  // wrong would fail in no other spec.
  await openWorkspace(page);
  await selectWorktree(page, "spike");
  await choosePane(page, "diff");
  await selectWorktree(page, "polish");
  await choosePane(page, "team");
  await expect(page.getByTestId("team-choice")).toBeVisible();
  await page.getByTestId(`team-choice-${TEAM.id}`).click();
  await page.getByTestId("team-open").click();
  await expect(
    page.getByTestId("team-thread").getByTestId("message-composer"),
  ).toBeVisible({ timeout: 20_000 });

  // The z-40 layers this is about are really there — asserted so that a channel
  // surface which stopped drawing them would make this spec say so rather than
  // pass by vacancy.
  const chrome = await page.evaluate(() => {
    // The dock is the right slot's frame since P3 (`DockShell.tsx` carries
    // the same `isolate` stacking-context discipline `PaneFrame` did).
    const pane = document.querySelector('[data-testid="dock"]');
    if (pane === null) return [];
    return Array.from(pane.querySelectorAll("*"))
      .filter((element) => {
        const z = Number(getComputedStyle(element).zIndex);
        return Number.isFinite(z) && z >= 40;
      })
      .map((element) => (element as HTMLElement).dataset?.testid ?? "unnamed");
  });
  expect(chrome).toContain("channel-composer-overlay");

  // **Drawn where ⌘K is drawn, read as a number rather than as a resemblance.**
  // The sweep below is the reading that matters, but on its own it can pass for
  // the wrong reason: the pane is a stacking context and this overlay is later
  // in the tree, so a switcher with the *wrong* z still comes out on top today
  // and would only fail the day a pane escaped its context — which is the day
  // nobody is looking. So the two overlays' resolved z-index are compared
  // directly. That is the claim `PlaceSwitcher.tsx`'s header actually makes, and
  // it is the one that fails the moment this surface stops sharing the
  // palette's level.
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByTestId("palette")).toBeVisible();
  const paletteZ = await page.evaluate(
    () =>
      getComputedStyle(
        document.querySelector('[data-testid="palette"]')
          ?.parentElement as HTMLElement,
      ).zIndex,
  );
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("palette")).toHaveCount(0);

  await holdAndStep(page, 1);
  await expect(page.getByTestId("place-switcher")).toBeVisible();
  await waitForAnimations(page);
  const switcherZ = await page.evaluate(
    () =>
      getComputedStyle(
        document.querySelector('[data-testid="place-switcher"]')
          ?.parentElement as HTMLElement,
      ).zIndex,
  );
  expect(switcherZ).toBe(paletteZ);
  expect(switcherZ).not.toBe("auto");

  // Over the pane's entire box, the switcher is the top layer.
  const inFront = await page.evaluate(() => {
    const panel = document.querySelector('[data-testid="place-switcher"]');
    const overlay = panel?.parentElement;
    const pane = document.querySelector('[data-testid="dock"]');
    if (overlay === null || overlay === undefined) return ["no switcher"];
    if (pane === null) return ["no right pane"];
    const box = pane.getBoundingClientRect();
    const found: string[] = [];
    const step = 12;
    for (let y = box.top + 2; y < box.bottom - 2; y += step) {
      for (let x = box.left + 2; x < box.right - 2; x += step) {
        const stack = document.elementsFromPoint(x, y);
        const at = stack.findIndex(
          (element) => element === overlay || overlay.contains(element),
        );
        if (at <= 0) continue;
        for (let i = 0; i < at; i += 1) {
          const element = stack[i] as HTMLElement;
          const name = `${element.tagName.toLowerCase()}${
            element.dataset?.testid === undefined
              ? ""
              : `[${element.dataset.testid}]`
          } z=${getComputedStyle(element).zIndex}`;
          if (!found.includes(name)) found.push(name);
        }
      }
    }
    return found;
  });
  expect(inFront).toEqual([]);
  await page.keyboard.up("Control");
});

test("the palette keeps the keyboard, and the chord comes back when it closes", async ({
  page,
}) => {
  // The other half of taking a chord in the capture phase, and the half that
  // fails silently. This listener is bound for the life of the screen and the
  // palette's is bound when the palette opens, so on registration order alone
  // this one runs first — it does not take the key, because the host tells it
  // something is stacked.
  await openWorkspace(page);
  await buildTrail(page);

  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByTestId("palette")).toBeVisible();
  await holdAndStep(page, 1);
  await expect(page.getByTestId("place-switcher")).toHaveCount(0);
  await expect(page.getByTestId("palette")).toBeVisible();
  await page.keyboard.up("Control");

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("palette")).toHaveCount(0);
  await holdAndStep(page, 1);
  await expect(page.getByTestId("place-switcher")).toBeVisible();
  await page.keyboard.up("Control");
});

test("a focused terminal does not swallow it", async ({ page }) => {
  // xterm resolves ⌃⇥ to a literal tab it writes to the pty and then cancels
  // the event, on a listener registered on its own textarea. A window-capture
  // listener runs before any listener on any element — this is the reading that
  // says so, and there is no unit test that could take it.
  await openWorkspace(page);
  await buildTrail(page);

  // Focus onto xterm's own helper textarea. With the pty commands stubbed the
  // terminal mounts but never paints, so the element cannot be *clicked* — it is
  // focused directly, which is the same state a click would have produced and
  // the only one this fixture can reach.
  //
  // The *laid-out* one, specifically. Every visited worktree keeps its terminal
  // mounted (hidden, never torn down — that is what makes a worktree switch
  // cheap), so the first `.xterm-helper-textarea` in the document belongs to a
  // `display: none` subtree and cannot take focus at all.
  const focused = await page.evaluate(() => {
    const area = Array.from(
      document.querySelectorAll<HTMLTextAreaElement>(".xterm-helper-textarea"),
    ).find((candidate) => candidate.offsetParent !== null);
    if (area === undefined) return false;
    area.focus();
    return document.activeElement === area;
  });
  expect(
    focused,
    "xterm's textarea did not take focus, so this proves nothing about the grab",
  ).toBe(true);

  await holdAndStep(page, 1);
  await expect(page.getByTestId("place-switcher")).toBeVisible();
  expect(await overlayRows(page)).toEqual(trailRows(1));
  // And it commits from there too: the release is heard on `window`, which is
  // the same claim as the keydown and the one that would leave the overlay
  // stuck up if xterm's textarea were the only listener.
  await page.keyboard.up("Control");
  await expect(page.getByTestId("place-switcher")).toHaveCount(0);
  await expectDockTab(page, "diff");
});
