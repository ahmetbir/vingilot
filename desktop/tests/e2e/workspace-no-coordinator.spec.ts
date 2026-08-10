// The workspace on a machine with no control plane at all
// (vingilot/docs/plans/2026-08-10-coordinator-optional.md, Task 3).
//
// This is the case the owner actually hit, and the one no spec covered: he
// installed the .dmg on his work Mac, where there is no Postgres on 5435 and
// no `cargo run --bin vingilot-coordinator`, and could not add a project at
// all — *"proje ekleyemedim"*. Every other workspace spec in this directory
// mocks a coordinator that answers, so all of them passed while the product
// was unusable on any machine but the Mac mini. Nothing listens on 7117 here:
// every request to it is aborted at the transport, which is what a closed port
// does.
//
// **Four readings, and none of them is reachable from a unit test**, because
// each is about a state the whole screen has to hold at once rather than about
// a function's return value:
//
// - the workspace opens — the columns render, with no coordinator to render
//   them from;
// - a project can be added, which is the exact act that used to be a CAS write
//   into a workspace document that was not there;
// - it is still there after a reload, from the file rather than from React
//   state (the store below lives in the *test process*, so a reload cannot be
//   passed by anything the page kept);
// - and the banner says the never-configured sentence rather than the outage
//   one — asserted on `data-state`, per the plan, and then on the two clauses
//   that were the lie: the word "read-only" is nowhere on the screen, and the
//   sentence does not count seconds at him.
//
// A fifth reading rides along because the same absence would break it: the
// worktree column still lists, and its rows come from `git worktree list`
// (`worktree_list`) rather than from the coordinator's `/worktrees`. The
// non-main row asserted below can have no other origin — the coordinator's
// endpoint never answers here at all.
//
// **What is stubbed, and why that is still a real proof.** The bundle under
// test is the web build, so there is no Tauri host and no real git: the six
// commands the screen needs are answered by the wrapper below. That does not
// weaken the reading, because what is under test is not git — it is which
// *source* the screen asks and whether it can hold state with the control
// plane gone. The one stub that carries weight is the project file, and it is
// deliberately not held in the page: `projects_load`/`projects_save` cross into
// the test process through `page.exposeFunction`, so "survives a reload" means
// the same thing it means on his disk.

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

// Every path under this origin, not one workspace's: the other specs route
// per-endpoint because they answer; there is nothing here to answer with, and
// a request that slipped past a narrower pattern would reach a real port.
const COORDINATOR_ORIGIN = "http://127.0.0.1:7117";

const HOME = "/tmp/vingilot-e2e-home";
const PROJECT_PATH = `${HOME}/work/talon`;
/** `repoIdFor` (lib/repoChoice.ts): the last path segment, lowercased. */
const PROJECT_ID = "talon";
/** A worktree only git knows about — the coordinator has no row for it and,
 * here, no chance to invent one. */
const EXTRA_WORKTREE_PATH = `${HOME}/.vingilot/worktrees/talon-feature`;

/** `localBindingId` (lib/projects.ts), recomputed rather than imported: the
 * spec asserts on the id the app derives from a path, so deriving it the same
 * way from the test's own constant is what makes the assertion about the path
 * and not about a shared helper. */
function localBindingId(path: string): string {
  let hex = "";
  for (const byte of new TextEncoder().encode(path)) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return `local:${hex}`;
}

type StubWindow = Window & {
  __vgProjectsLoad: () => Promise<string | null>;
  __vgProjectsSave: (contents: string) => Promise<void>;
  __vgPickedPath: () => Promise<string | null>;
  __TAURI_INTERNALS__: {
    invoke: (cmd: string, args?: unknown, opts?: unknown) => unknown;
  };
};

/** The state that has to outlive a reload, held where the page cannot reach
 * it: this object is in the test process. `projects.json` starts absent, which
 * is what a machine that has never added a project looks like. */
interface Disk {
  projectsJson: string | null;
  picked: string | null;
}

/** Nothing is listening on 7117. Aborting rather than answering a 404 is the
 * point: a 404 is a control plane saying no, and this spec is about there not
 * being one — `coordinatorClient.ts` reads a fetch-level throw as
 * `unreachable`, which is the signal the banner is derived from. */
async function noCoordinator(page: Page) {
  await page.route(`${COORDINATOR_ORIGIN}/**`, (route) =>
    route.abort("connectionrefused"),
  );
}

/** The Tauri surface, installed as a property trap rather than by overwriting
 * `invoke` after boot.
 *
 * The bridge's `mockIPC` assigns `window.__TAURI_INTERNALS__.invoke` during
 * app boot and throws on every command it does not know — including all six
 * below. A stub installed *after* boot would therefore be too late for the
 * one call that matters most: `projects_load` runs on the first render, and a
 * rejection there is remembered for the session as "this machine has no local
 * store". So the accessor goes in at document start, keeps the bridge's
 * function as the fallback when it is assigned, and survives a reload because
 * an init script runs again on the next document — which is exactly what the
 * reload assertion needs. */
async function stubTauri(page: Page, disk: Disk) {
  await page.exposeFunction("__vgProjectsLoad", () => disk.projectsJson);
  await page.exposeFunction("__vgProjectsSave", (contents: string) => {
    disk.projectsJson = contents;
  });
  await page.exposeFunction("__vgPickedPath", () => disk.picked);

  await page.addInitScript(
    ({ extraWorktree, home, projectPath }) => {
      const w = window as unknown as StubWindow;
      let fallback:
        | ((cmd: string, args?: unknown, opts?: unknown) => unknown)
        | null = null;

      const invoke = (cmd: string, args?: unknown, opts?: unknown): unknown => {
        const name = String(cmd);
        const arg = (args ?? {}) as Record<string, unknown>;

        if (name === "projects_load") return w.__vgProjectsLoad();
        if (name === "projects_save")
          return w.__vgProjectsSave(String(arg.contents));
        if (name === "plugin:dialog|open") return w.__vgPickedPath();
        if (name === "repo_probe")
          return Promise.resolve({ kind: "repository" });
        if (name === "worktree_list") {
          // What `git worktree list --porcelain` says about this checkout.
          // Keyed on the repo it was asked about, so a listing answered for a
          // project nobody added would be visible as such rather than
          // appearing under whatever is on screen.
          if (String(arg.repo) !== projectPath) return Promise.resolve([]);
          return Promise.resolve([
            {
              branch: "main",
              detached: false,
              head: "1111111111111111111111111111111111111111",
              isMain: true,
              locked: false,
              path: projectPath,
              prunable: false,
            },
            {
              branch: "feature/keys",
              detached: false,
              head: "2222222222222222222222222222222222222222",
              isMain: false,
              locked: false,
              path: extraWorktree,
              prunable: false,
            },
          ]);
        }
        // The home dir the worktree root hangs off, and a terminal backend
        // that answers. Neither is what is under test; both have to answer or
        // the panes sit in their waiting state and say so, which would be a
        // second sentence on screen that this spec is not about.
        if (name.startsWith("plugin:path|")) return Promise.resolve(`${home}/`);
        if (name === "pty_backing") return Promise.resolve("tmux");
        if (name.startsWith("pty_")) return Promise.resolve(null);

        if (fallback === null)
          return Promise.reject(new Error(`no host for ${name}`));
        return fallback(cmd, args, opts);
      };

      const internals = (w.__TAURI_INTERNALS__ ??
        {}) as StubWindow["__TAURI_INTERNALS__"];
      w.__TAURI_INTERNALS__ = internals;
      Object.defineProperty(internals, "invoke", {
        configurable: true,
        get: () => invoke,
        set: (fn: (cmd: string, args?: unknown, opts?: unknown) => unknown) => {
          fallback = fn;
        },
      });
    },
    {
      extraWorktree: EXTRA_WORKTREE_PATH,
      home: HOME,
      projectPath: PROJECT_PATH,
    },
  );
}

async function openWorkspace(page: Page, disk: Disk) {
  // Wide enough that the three columns are all on screen at once — the
  // narrower default puts the worktree column's contents behind a rail, and
  // this spec asserts on rows in it.
  await page.setViewportSize({ height: 900, width: 1700 });
  await installMockBridge(page);
  await noCoordinator(page);
  await stubTauri(page, disk);
  await page.goto("/#/workspace");
  await expect(page.getByTestId("runs-screen")).toBeVisible();
}

const banner = (page: Page) => page.getByTestId("control-plane-banner");

test.describe("a workspace with no coordinator at all", () => {
  test("opens, holds a project across a reload, and lists worktrees from git", async ({
    page,
  }) => {
    const disk: Disk = { picked: PROJECT_PATH, projectsJson: null };
    await openWorkspace(page, disk);

    // A fresh machine: the list is empty and says so in the words a fresh
    // machine earns, not in the words an unreadable file earns.
    await expect(page.getByTestId("projects-nav")).toContainText(
      "no projects yet",
    );
    await expect(page.getByTestId("projects-nav-store-notice")).toHaveCount(0);

    // The act that was impossible on his work Mac.
    await page.getByTestId("projects-nav-add").click();
    await expect(
      page.getByTestId(`projects-nav-repo-${PROJECT_ID}`),
    ).toBeVisible();
    await expect(page.getByTestId("projects-nav-error")).toHaveCount(0);

    // It reached the file, not just the screen. Read from the test process,
    // which is the only place the page cannot have written to by accident.
    expect(disk.projectsJson).not.toBeNull();
    expect(JSON.parse(disk.projectsJson ?? "null")).toMatchObject({
      repos: [{ id: PROJECT_ID, path: PROJECT_PATH }],
    });

    // Nothing was imported and nothing is unreconciled: there is no
    // coordinator to have seeded from or to stand off against, and a notice
    // about one would be a sentence about a machine this is not.
    await expect(page.getByTestId("projects-nav-import-notice")).toHaveCount(0);
    await expect(
      page.getByTestId("projects-nav-coordinator-notice"),
    ).toHaveCount(0);

    // The reload. The picker is taken away first, so a project that somehow
    // reappeared by being re-added rather than by being read back would show
    // up as an empty list rather than pass.
    disk.picked = null;
    await page.reload();
    await expect(page.getByTestId("runs-screen")).toBeVisible();
    await expect(
      page.getByTestId(`projects-nav-repo-${PROJECT_ID}`),
    ).toBeVisible();

    // Worktrees come off the filesystem. The main checkout is synthetic and
    // would render from the repo alone; `local:` can only have come from
    // `worktree_list`, and the coordinator's own worktrees endpoint has not
    // answered once in this test.
    await page.getByTestId(`projects-nav-repo-${PROJECT_ID}`).click();
    await expect(page.getByTestId("worktree-column")).toBeVisible();
    await expect(
      page.getByTestId(`worktree-row-main:${PROJECT_ID}`),
    ).toBeVisible();
    await expect(
      page.getByTestId(`worktree-row-${localBindingId(EXTRA_WORKTREE_PATH)}`),
    ).toBeVisible();
  });

  test("the banner says nothing was ever there, not that something stopped", async ({
    page,
  }) => {
    const disk: Disk = { picked: PROJECT_PATH, projectsJson: null };
    await openWorkspace(page, disk);

    await expect(banner(page)).toHaveAttribute("data-state", "absent");

    // The three clauses that were false on his machine. "read-only" is
    // checked against the whole screen rather than the banner, because the
    // word had also reached the composer note and the status bar.
    await expect(page.locator("body")).not.toContainText("read-only", {
      ignoreCase: true,
    });
    await expect(banner(page)).not.toContainText("unreachable");
    await expect(banner(page)).not.toContainText(/next in \d+s/);

    // And what it says instead: the one thing that is unavailable, and that
    // there is nothing to wait for.
    await expect(banner(page)).toContainText("runs cannot start here");
    await expect(banner(page)).toContainText("nothing to wait for");

    // A note, not an alert: a machine that never had a control plane has
    // nothing to interrupt anyone about.
    await expect(banner(page)).toHaveAttribute("role", "status");

    // The status bar reads the same three-state fact in its own words. It is
    // only on screen inside a project, so the project is added first — which
    // also proves the banner does not gate the add.
    await page.getByTestId("projects-nav-add").click();
    await page.getByTestId(`projects-nav-repo-${PROJECT_ID}`).click();
    await expect(page.getByTestId("project-status-bar")).toContainText(
      "no control plane",
    );
  });
});
