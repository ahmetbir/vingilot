// **One palette, three doors, everywhere** — proved against a real document
// (vingilot/docs/plans/2026-08-12-an-ide-of-a-kind.md, Task 2; ADR-005's last
// paragraph).
//
// The owner's report: *"cmd k buzz kısmında farklı deck kısmında farklı
// çalışıyor."* The pure halves are proved without a browser and deliberately
// kept there: `lib/paletteDoors.test.mjs` owns the prefix grammar and which
// sources a mode asks, `lib/paletteKeys.test.mjs` owns what each chord means,
// `lib/paletteClaim.test.mjs` owns which host is bound, `lib/paletteWorld.test.mjs`
// owns the snapshot a chat route reads, and `lib/worktreeFiles.test.mjs` owns
// the bounded walk behind ⌘P.
//
// What only a browser can say:
//
// 1. **⌘K on a chat route reaches THIS palette**, with channels and projects in
//    one list — the whole of the bug, and a claim about two window handlers
//    competing for one chord that no unit test can see.
// 2. **⌘P opens the files door on the workspace and falls through on a chat
//    route.** The fall-through is the half a key map cannot prove: a map that
//    resolves is not a listener that defers, and `preventDefault` on a chord
//    with nothing behind it is exactly how ⌘W was lost.
// 3. **`>` and `#` switch the list under the same field** — the grammar
//    reaching the rendered rows rather than only the function.
// 4. **The hint row teaches the doors it is not standing in** — and only the
//    ones this screen can actually answer for, which is the same narrowing that
//    decides which chords it answers to.
// 5. **The composer keeps the ⌘K it uses and gives back the one it does not.**
//    A window capture listener runs before the element-level handler upstream
//    binds, so which of the two answers a keystroke is a fact about a live
//    selection in a real ProseMirror document (`lib/composerClaim.ts`) — the
//    kind of claim a key map cannot make and a reading of upstream's source
//    cannot settle.
//
// Runs at the same 1700×900 the palette's own spec uses, for the reason stated
// there. Lives at the upstream-owned `desktop/tests/e2e/` path for the same
// reason the other fork specs do: that is where `playwright.config.ts`'s
// `testDir` points.

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
const COORDINATOR_ORIGIN = "http://127.0.0.1:7117";

const REPOS = [
  { id: "repo-left", name: "vingilot", path: "/tmp/vingilot-left" },
  { id: "repo-right", name: "buzzard", path: "/tmp/vingilot-right" },
];

const SPLITTABLE = { height: 900, width: 1700 } as const;

async function mockCoordinator(page: Page) {
  await page.route(`${COORDINATOR_ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === `/v1/workspaces/${WORKSPACE_ID}`) {
      return route.fulfill({
        json: {
          revision: 1,
          state: { repos: REPOS },
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

/** The snapshot the workspace publishes, seeded so a chat route has projects to
 * offer without having visited /workspace first — which is the cold start the
 * persistence exists for (`lib/paletteWorld.ts`). `addInitScript` runs before
 * the bridge for the reason the repo's own guide gives: React reads storage on
 * mount and the bridge is what triggers mount. */
async function seedWorld(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "vingilot-palette-world.v1",
      JSON.stringify({
        projects: [
          { id: "repo-left", name: "vingilot", path: "/tmp/vingilot-left" },
        ],
        recentFiles: [
          { line: 12, path: "src/main.rs", worktree: "/tmp/vingilot-left" },
        ],
        worktrees: [
          {
            bindingId: "main:repo-left",
            detail: "the project's checkout",
            label: "main",
          },
        ],
      }),
    );
  });
}

/** A channel screen with the snapshot seeded — the "buzz kısmı" of the owner's
 * report, and the half of the app the palette had nothing to say on before this
 * task. */
async function openChat(page: Page) {
  await page.setViewportSize(SPLITTABLE);
  await seedWorld(page);
  await installMockBridge(page);
  await mockCoordinator(page);
  await page.goto("/#/channels/general");
  await expect(page.getByTestId("open-search")).toBeVisible();
}

/** The same chat screen, reached the way `messaging.spec.ts` reaches one —
 * from the sidebar rather than by URL — because that is the path that mounts a
 * live composer to type into, which is what the two tests below are about. */
async function openChatComposer(page: Page) {
  await page.setViewportSize(SPLITTABLE);
  await installMockBridge(page);
  await mockCoordinator(page);
  await page.goto("/");
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");
  await expect(page.getByTestId("message-input")).toBeVisible();
}

async function openWorkspace(page: Page) {
  await page.setViewportSize(SPLITTABLE);
  await installMockBridge(page);
  await mockCoordinator(page);
  await page.goto("/#/workspace");
  await expect(page.getByTestId("runs-screen")).toBeVisible();
}

/** A checkout the files door can actually read. `owner_run_id` is what
 * `worktreeCwd` derives the directory from, so it cannot be null — the stub
 * below answers `worktree_tree` for exactly the path that produces. Same
 * arrangement `workspace-files.spec.ts` uses, and for its reason: the bridge
 * assigns `invoke` during boot, so the override has to be a property trap
 * installed before it. */
const GIT_HOME = "/tmp/vingilot-doors-home";
const FILE_REPO = {
  id: "repo-doors",
  name: "vingilot",
  path: "/tmp/vingilot-doors",
};
const FILE_WORKTREE = {
  added: null,
  base_commit: "0".repeat(40),
  binding_id: "wt-doors",
  branch: "spike",
  commit_sha: null,
  lifecycle: "active",
  owner_run_id: "run-doors",
  owner_run_objective: null,
  owner_run_status: null,
  removed: null,
  repo_id: "repo-doors",
  role: "task",
};

/** One directory level per key, the shape `worktree_tree` answers with. The
 * nested file is the one the door has to DEEPEN to reach — the root's listing
 * alone does not contain it, which is what makes the lazy walk visible. */
const TREE: Record<
  string,
  { name: string; kind: string; size: number | null }[]
> = {
  "": [
    { kind: "directory", name: "src", size: null },
    { kind: "file", name: "README.md", size: 12 },
  ],
  src: [{ kind: "file", name: "greet.ts", size: 40 }],
};

type TrapWindow = Window & {
  __TAURI_INTERNALS__: {
    invoke: (cmd: string, args?: unknown, opts?: unknown) => unknown;
  };
};

async function openWorktreeWorkspace(page: Page) {
  await page.setViewportSize(SPLITTABLE);
  await installMockBridge(page);
  await page.route(`${COORDINATOR_ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === `/v1/workspaces/${WORKSPACE_ID}`) {
      return route.fulfill({
        json: {
          revision: 1,
          state: { repos: [FILE_REPO] },
          state_hash: "mock-state-hash",
        },
      });
    }
    if (url.pathname.endsWith("/worktrees")) {
      return route.fulfill({ json: { worktrees: [FILE_WORKTREE] } });
    }
    if (url.pathname.endsWith("/runs")) {
      return route.fulfill({ json: { runs: [] } });
    }
    return route.fulfill({
      json: { detail: `unmocked route: ${url.pathname}`, error: "not_found" },
      status: 404,
    });
  });

  await page.addInitScript(
    ([home, tree]: [
      string,
      Record<string, { name: string; kind: string; size: number | null }[]>,
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
        if (name === "worktree_list") return Promise.resolve([]);
        if (name === "worktree_stats") return Promise.resolve([]);
        if (name === "pty_backing") return Promise.resolve("tmux");
        if (name.startsWith("pty_")) return Promise.resolve(null);
        if (fallback === null) {
          return Promise.reject(new Error(`no host for ${name}`));
        }
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
    [GIT_HOME, TREE] as const,
  );

  await page.goto("/#/workspace");
  await expect(page.getByTestId("runs-screen")).toBeVisible();
  await page.getByTestId(`projects-nav-repo-${FILE_REPO.id}`).click();
  await expect(page.getByTestId("work-surface")).toBeVisible();
  await page.getByTestId(`worktree-row-${FILE_WORKTREE.binding_id}`).click();
}

function rows(page: Page) {
  return page.getByTestId("palette-list").getByRole("button");
}

test.describe("one palette, three doors", () => {
  test("primary+K on a chat route lists channels AND projects, in one list", async ({
    page,
  }) => {
    // The bug, in one assertion: the two halves of the product answering one
    // chord together instead of one each.
    await openChat(page);

    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByTestId("palette")).toBeVisible();
    // Upstream's dialog stayed shut — the claim rests on a capture listener
    // running before their bubble one, which only a document can settle.
    await expect(page.getByTestId("search-results")).toBeHidden();

    await expect(
      page.getByTestId("palette-row-project:repo-left"),
    ).toBeVisible();
    await expect(
      page.getByTestId("palette-list").locator('[data-kind="channel"]').first(),
    ).toBeVisible();
  });

  test("a channel row goes to the channel, the way their switcher would have", async ({
    page,
  }) => {
    await openChat(page);

    await page.keyboard.press("ControlOrMeta+k");
    await page.getByTestId("palette-input").fill("#random");
    const channel = rows(page).first();
    await expect(channel).toHaveAttribute("data-kind", "channel");
    await channel.click();

    await expect(page.getByTestId("palette")).toBeHidden();
    await expect.poll(() => page.url()).toContain("/channels/");
  });

  test("# and > switch the list under the same field", async ({ page }) => {
    await openWorkspace(page);
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByTestId("palette")).toBeVisible();

    // The front door has projects in it.
    await expect(
      page.getByTestId("palette-row-project:repo-left"),
    ).toBeVisible();

    // `>` — commands only. The projects go, the actions stay.
    await page.getByTestId("palette-input").fill(">");
    await expect(
      page.getByTestId("palette-row-action:add-project"),
    ).toBeVisible();
    await expect(
      page.getByTestId("palette-row-project:repo-left"),
    ).toBeHidden();

    // `#` — channels only. Now the actions go too.
    await page.getByTestId("palette-input").fill("#");
    await expect(
      page.getByTestId("palette-row-action:add-project"),
    ).toBeHidden();

    // And deleting the character puts the front door back, which is the only
    // way out of a mode — the same gesture that chose it.
    await page.getByTestId("palette-input").fill("");
    await expect(
      page.getByTestId("palette-row-project:repo-left"),
    ).toBeVisible();
  });

  test("primary+P opens the files door in a worktree, and deepens on the query", async ({
    page,
  }) => {
    await openWorktreeWorkspace(page);

    await page.keyboard.press("ControlOrMeta+p");
    await expect(page.getByTestId("palette")).toBeVisible();
    // The field says which list is under it — the only thing on screen that
    // does, because the surface is identical in every mode on purpose.
    await expect(page.getByTestId("palette-input")).toHaveAttribute(
      "placeholder",
      "Open a file in this worktree…",
    );
    // Not the front door: no project rows here.
    await expect(
      page.getByTestId("palette-row-project:repo-doors"),
    ).toBeHidden();
    // The root's own listing arrived in the one call opening the door costs.
    await expect(rows(page).first()).toBeVisible();
    await expect(page.getByTestId("palette-list")).toContainText("README.md");
    // And `src/greet.ts` is NOT in it yet — it is a level down, which is what
    // makes the lazy walk visible rather than assumed.
    await expect(page.getByTestId("palette-list")).not.toContainText(
      "greet.ts",
    );

    // Typing is what deepens it.
    await page.getByTestId("palette-input").fill("greet");
    await expect(page.getByTestId("palette-list")).toContainText("greet.ts");

    // The same chord puts it away; ⌘K from an open files door is a change of
    // list, not a second surface.
    await page.keyboard.press("ControlOrMeta+p");
    await expect(page.getByTestId("palette")).toBeHidden();
    await page.keyboard.press("ControlOrMeta+p");
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByTestId("palette")).toBeVisible();
    await expect(
      page.getByTestId("palette-row-project:repo-doors"),
    ).toBeVisible();
  });

  test("primary+P falls through on a chat route rather than opening an empty box", async ({
    page,
  }) => {
    // A chord this app answers with an empty box is a chord the owner learns
    // not to press. Nothing is prevented and nothing is stopped, so the palette
    // simply does not appear.
    await openChat(page);

    await page.keyboard.press("ControlOrMeta+p");
    await expect(page.getByTestId("palette")).toBeHidden();

    // And the door that IS ours there still opens, so what was proved is
    // deference and not a dead listener.
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByTestId("palette")).toBeVisible();
  });

  test("shift+primary+P is the commands door", async ({ page }) => {
    await openWorkspace(page);
    await page.keyboard.press("ControlOrMeta+Shift+p");
    await expect(page.getByTestId("palette")).toBeVisible();
    await expect(
      page.getByTestId("palette-row-action:add-project"),
    ).toBeVisible();
    await expect(
      page.getByTestId("palette-row-project:repo-left"),
    ).toBeHidden();
  });

  test("primary+P falls through on a workspace with no checkout under it", async ({
    page,
  }) => {
    // The rule is the sources, not the route: a door whose sources are all
    // absent is not this app's chord anywhere. Here that is /workspace on the
    // landing view, where no worktree is selected.
    await openWorkspace(page);
    await page.keyboard.press("ControlOrMeta+p");
    await expect(page.getByTestId("palette")).toBeHidden();
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByTestId("palette")).toBeVisible();
  });

  test("a bare caret in the composer still means go", async ({ page }) => {
    // The state the owner is in most of the time on a chat route: the composer
    // is focused and he has typed nothing worth linking. Upstream's own
    // handler falls through here by design ("a bare caret still falls through
    // to the app-wide quick-search binding"), and what the binding is now is
    // this palette (`lib/composerClaim.ts`).
    await openChatComposer(page);
    await page.getByTestId("message-input").click();
    await page.keyboard.type("hello");

    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByTestId("palette")).toBeVisible();
    // Neither of the two surfaces that used to answer this chord did.
    await expect(page.getByTestId("search-results")).toBeHidden();
    await expect(page.getByRole("dialog")).toBeHidden();
  });

  test("a selection in the composer keeps upstream's link editor", async ({
    page,
  }) => {
    // The claimant `paletteKeys.ts`'s original check named and scoped away, and
    // the scope expired when ⌘K went app-wide. A window capture listener that
    // stopped propagation would have taken this chord unconditionally and left
    // the link editor unreachable from the keyboard — the gesture removed in
    // silence that hosting rather than rewriting exists to prevent.
    await openChatComposer(page);
    await page.getByTestId("message-input").click();
    await page.keyboard.type("hello");
    // Selected with a real mouse gesture rather than ⇧←: a synthesized arrow
    // moves the DOM selection without ProseMirror's own state following it, so
    // the editor still reads a collapsed caret and declines the chord — which
    // makes the keyboard route prove the opposite of what it looks like it
    // proves. A triple-click is a selection both halves agree about.
    await page.getByTestId("message-input").click({ clickCount: 3 });

    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByText("Add link")).toBeVisible();
    await expect(page.getByTestId("palette")).toBeHidden();
  });

  test("the hint row teaches only the doors this screen actually has", async ({
    page,
  }) => {
    // On a chat route ⌘P falls through and `>` resolves to a mode with no
    // sources behind it, so a row offering either would teach the owner to
    // press a key that answers with an empty box.
    await openChat(page);
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByTestId("palette-hints")).toBeVisible();
    await expect(page.getByTestId("palette-hint-channels")).toBeVisible();
    await expect(page.getByTestId("palette-hint-files")).toBeHidden();
    await expect(page.getByTestId("palette-hint-commands")).toBeHidden();
  });

  test("the hint row teaches the doors you are not standing in", async ({
    page,
  }) => {
    await openWorktreeWorkspace(page);
    await page.keyboard.press("ControlOrMeta+k");
    const hints = page.getByTestId("palette-hints");
    await expect(hints).toBeVisible();
    // Standing in `go`, so `go` is not offered and the other three are.
    await expect(page.getByTestId("palette-hint-anywhere")).toBeHidden();
    await expect(page.getByTestId("palette-hint-files")).toBeVisible();
    await expect(page.getByTestId("palette-hint-commands")).toBeVisible();
    // The keys are drawn in the same boxes the rows draw their chords in.
    await expect(hints.locator("kbd").first()).toBeVisible();

    // Move to the files door and the row moves with it.
    await page.keyboard.press("ControlOrMeta+p");
    await expect(page.getByTestId("palette-hint-files")).toBeHidden();
    await expect(page.getByTestId("palette-hint-anywhere")).toBeVisible();
  });
});
