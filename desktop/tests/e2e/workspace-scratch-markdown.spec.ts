// The scratch markdown buffer, proved against a real render
// (vingilot/docs/plans/2026-08-12-vscode-muscle-memory.md, Task 4).
//
// The pure halves are proved without a browser and deliberately kept there:
// `src/features/runs/lib/scratchAutosave.test.mjs` owns when a write happens and
// what the owner is told between asking and being answered;
// `scratchMarkdownKeys.test.mjs` owns what ⇧⌘M means and which chords an open
// buffer shields; and `src-tauri/src/vingilot_scratch/mod.rs`'s own cargo tests own
// the bytes on disk — the one path, the ceiling in both directions, and the four
// refusals.
//
// What only a browser can say is the part Task 4 actually asks for: **what he
// typed is still there when he comes back.** That claim spans a chord, a module
// singleton, a debounce, an IPC round trip and a file, and every unit test above
// stops at one of those boundaries. Six readings of that shape:
//
// 1. **Open, type, close, reopen** — the plan's own sentence, in the same page.
//    What survives here is the overlay closing, which is where React state would
//    have lost it.
// 2. **The buffer comes back after a reload**, which is the *file* being read: the
//    module singleton is gone with the document, so the only place the text can
//    come from is `scratch_read`. This is "restored on open".
// 3. **One buffer, not one per worktree** — typed on the landing view, still there
//    after opening a project. The model has no key at all, so the only way this
//    can fail is in the wiring, which is here.
// 4. **Nothing carries the text off this machine.** The privacy claim in
//    `scratchMarkdown.ts`'s header, read as a canary: no `fetch`, no WebSocket
//    frame and no `invoke` other than `scratch_write` may ever hold it. The
//    relay is a WebSocket in this app, so a spy on the IPC alone would have
//    proved half of it.
// 5. **The palette is the other door**, and the row says where the buffer is kept
//    and how far it goes — a promise made in words has to be on screen.
// 6. **A file that cannot be read is a sentence and no editor**, which is the one
//    failure that would otherwise destroy his work: an editor drawn over a
//    refused read arms an autosave that writes over a file this build could not
//    open.
//
// **The file is `localStorage` here, and that is the only fake.** No `~` is
// touched by a spec, so `scratch_read`/`scratch_write` are answered out of a
// browser store that survives a reload the way a file survives a restart. What
// the real commands do with the real path is proved by cargo, against temp
// directories, in the module itself.

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

/** Matches RunsScreen.tsx's hardcoded dev workspace id. */
const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
const COORDINATOR_ORIGIN = "http://127.0.0.1:7117";

/** One project, and it is deliberately not opened by most of these tests: this
 * buffer needs no project, no worktree and no checkout, so the landing view is
 * where the claim is strongest. */
const REPO = {
  id: "repo-scratch",
  name: "vingilot",
  path: "/tmp/vingilot-scratch",
};

/** Where the stub keeps the buffer's bytes, standing in for
 * `~/.vingilot/scratch.md`. Survives a reload, which is the property that makes
 * reading 2 a reading about a file rather than about a variable. */
const FILE_KEY = "vingilot-e2e-scratch-file";

/** Set to make `scratch_read` refuse, with this sentence. Read at call time, so
 * a test can turn it on before the first open. */
const REFUSAL_KEY = "vingilot-e2e-scratch-refusal";

/** The refusal reading 6 drives. Shaped like `vingilot_scratch`'s own: a whole
 * sentence, naming the file and promising nothing was written over it. */
const REFUSAL =
  "/tmp/home/.vingilot/scratch.md is not UTF-8 text. This buffer rewrites the whole file as you type, so opening it would replace those bytes with something else — it is left exactly as it is instead.";

/** What he types. The canary is in it so reading 4 can ask a question no
 * assertion about a command name can: did this string leave the machine by any
 * route at all. */
const CANARY = "SCRATCH-CANARY-7f3a";
const TYPED = `- [ ] ${CANARY} the divider still eats the wheel`;

/** The buffer's path as the owner would type it (`scratchMarkdown.ts`'s
 * `SCRATCH_MARKDOWN_PATH`). Written out rather than imported: a spec that
 * composed the expectation the same way the product does would pass through any
 * change to either side of it. */
const PATH = "~/.vingilot/scratch.md";

type ScratchStubWindow = Window & {
  __TAURI_INTERNALS__: {
    invoke: (cmd: string, args?: unknown, opts?: unknown) => unknown;
  };
  /** Every command name asked this run whose arguments hold the canary. Reset by
   * a reload, which is what makes reading 2's "this run" meaningful. */
  __CARRIED__?: string[];
  /** Every `fetch` URL and WebSocket frame this run whose body holds the
   * canary. Anything in either is reading 4 failing. */
  __LEAKED__?: string[];
  /** `scratch_read` calls this run, so reading 2 can say the text came from the
   * file rather than from something the page kept. */
  __READS__?: number;
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
    if (url.pathname === `/v1/workspaces/${WORKSPACE_ID}/worktrees`) {
      return route.fulfill({ json: { worktrees: [] } });
    }
    if (url.pathname === `/v1/workspaces/${WORKSPACE_ID}/runs`) {
      return route.fulfill({ json: { runs: [] } });
    }
    return route.fulfill({
      json: { detail: `unmocked route: ${url.pathname}`, error: "not_found" },
      status: 404,
    });
  });
}

/** The two scratch commands, the home-directory lookup, the pty commands an
 * xterm needs — and the canary spies.
 *
 * Installed as a property trap at document start rather than by overwriting
 * `invoke` after boot, for the reason `workspace-one-column.spec.ts` spells out:
 * the bridge assigns `invoke` during boot and throws on every command it does
 * not know, and the home-dir lookup runs on the first render. Here it is also
 * what makes a reload a real restart — the stub is back before the app is, so
 * `scratch_read` is answered on the first render of the second run. */
async function stubScratchBackend(page: Page) {
  await page.addInitScript(
    ({
      canary,
      fileKey,
      refusalKey,
    }: {
      canary: string;
      fileKey: string;
      refusalKey: string;
    }) => {
      const w = window as unknown as ScratchStubWindow;
      w.__CARRIED__ = [];
      w.__LEAKED__ = [];
      w.__READS__ = 0;

      const holdsCanary = (value: unknown): boolean => {
        if (typeof value === "string") return value.includes(canary);
        try {
          return JSON.stringify(value ?? null)?.includes(canary) === true;
        } catch {
          return false;
        }
      };

      // The relay is a WebSocket and the HTTP surface is `fetch`; both are
      // watched, because "never sent anywhere" is a claim about every route out
      // of this page and not only about the IPC.
      const send = WebSocket.prototype.send;
      WebSocket.prototype.send = function patched(
        this: WebSocket,
        data: Parameters<WebSocket["send"]>[0],
      ) {
        if (holdsCanary(data)) w.__LEAKED__?.push(`websocket ${this.url}`);
        return send.call(this, data);
      };
      const fetched = window.fetch.bind(window);
      window.fetch = (input, init) => {
        if (holdsCanary(init?.body)) {
          w.__LEAKED__?.push(`fetch ${String(input)}`);
        }
        return fetched(input, init);
      };

      let fallback:
        | ((cmd: string, args?: unknown, opts?: unknown) => unknown)
        | null = null;

      const invoke = (cmd: string, args?: unknown, opts?: unknown): unknown => {
        const name = String(cmd);
        if (holdsCanary(args)) w.__CARRIED__?.push(name);
        if (name === "scratch_read") {
          w.__READS__ = (w.__READS__ ?? 0) + 1;
          const refusal = window.localStorage.getItem(refusalKey);
          if (refusal !== null) return Promise.reject(refusal);
          return Promise.resolve(window.localStorage.getItem(fileKey));
        }
        if (name === "scratch_write") {
          const text = ((args ?? {}) as { text?: string }).text ?? "";
          window.localStorage.setItem(fileKey, text);
          return Promise.resolve(null);
        }
        if (name.startsWith("plugin:path|"))
          return Promise.resolve("/tmp/home/");
        if (name === "worktree_list") return Promise.resolve([]);
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
        if (name === "pty_backing") return Promise.resolve("tmux");
        if (name.startsWith("pty_")) return Promise.resolve(null);
        if (fallback === null) {
          return Promise.reject(new Error(`no host for ${name}`));
        }
        return fallback(cmd, args, opts);
      };

      const internals = (w.__TAURI_INTERNALS__ ??
        {}) as ScratchStubWindow["__TAURI_INTERNALS__"];
      w.__TAURI_INTERNALS__ = internals;
      Object.defineProperty(internals, "invoke", {
        configurable: true,
        get: () => invoke,
        set: (fn: (cmd: string, args?: unknown, opts?: unknown) => unknown) => {
          fallback = fn;
        },
      });
    },
    { canary: CANARY, fileKey: FILE_KEY, refusalKey: REFUSAL_KEY },
  );
}

/** The workspace, on the landing view — no project chosen, which is the state
 * this buffer has to be reachable from. */
async function openWorkspace(page: Page, { refuse = false } = {}) {
  await page.setViewportSize({ height: 900, width: 1700 });
  await installMockBridge(page);
  await mockCoordinator(page);
  await stubScratchBackend(page);
  if (refuse) {
    await page.addInitScript(
      ({ key, sentence }: { key: string; sentence: string }) => {
        window.localStorage.setItem(key, sentence);
      },
      { key: REFUSAL_KEY, sentence: REFUSAL },
    );
  }
  await page.goto("/#/workspace");
  await expect(page.getByTestId("runs-screen")).toBeVisible();
}

const editor = (page: Page) => page.getByTestId("scratch-md-editor");
const overlay = (page: Page) => page.getByTestId("scratch-markdown");

/** What the stub's file holds — `null` for a machine nothing has been scratched
 * on, which is the answer the backend's `Ok(None)` becomes and is not the same
 * as an empty buffer. */
async function fileHolds(page: Page) {
  return page.evaluate((key) => window.localStorage.getItem(key), FILE_KEY);
}

/** Put text in the buffer and wait for the debounce to land, asserted as the
 * state line rather than as a sleep.
 *
 * `fill` rather than keystrokes everywhere except the first reading, which types:
 * one input event is all the autosave machine distinguishes, and paying for 45
 * renders in five tests to re-prove what one proves is time nobody gets back. */
async function fillAndSave(page: Page, text: string) {
  await editor(page).fill(text);
  await expect(page.getByTestId("scratch-md-state")).toContainText("unsaved");
  await expect(page.getByTestId("scratch-md-state")).toHaveText("saved");
}

test.describe("a markdown buffer one gesture away, that keeps what you put in it", () => {
  test("the chord opens it, and what he types survives closing and reopening", async ({
    page,
  }) => {
    await openWorkspace(page);
    expect(await fileHolds(page)).toBeNull();

    await page.keyboard.press("ControlOrMeta+Shift+m");
    await expect(overlay(page)).toBeVisible();
    // The keyboard goes into the buffer he just opened: a scratch he has to
    // click into is a scratch he stops using.
    await expect(editor(page)).toBeFocused();

    // Real keystrokes rather than a `fill`, once, here: the promise is *written a
    // moment after you stop typing*, and typing is the input this whole feature
    // is a debounce over.
    await editor(page).pressSequentially(TYPED);
    await expect(page.getByTestId("scratch-md-state")).toContainText("unsaved");
    await expect(page.getByTestId("scratch-md-state")).toHaveText("saved");
    expect(await fileHolds(page)).toBe(TYPED);

    // Escape closes — the one behaviour the two scratches do not share, and the
    // reason is in `scratchMarkdownKeys.ts`.
    await page.keyboard.press("Escape");
    await expect(overlay(page)).toBeHidden();

    await page.keyboard.press("ControlOrMeta+Shift+m");
    await expect(overlay(page)).toBeVisible();
    await expect(editor(page)).toHaveValue(TYPED);
    await expect(page.getByTestId("scratch-md-state")).toHaveText("saved");
  });

  test("it comes back after a restart, read from the file", async ({
    page,
  }) => {
    await openWorkspace(page);
    await page.keyboard.press("ControlOrMeta+Shift+m");
    await fillAndSave(page, TYPED);

    // The whole page goes, which is what takes the module singleton with it —
    // so the text can only come back from `scratch_read`.
    await page.reload();
    await expect(page.getByTestId("runs-screen")).toBeVisible();
    expect(
      await page.evaluate(() => (window as ScratchStubWindow).__READS__ ?? 0),
    ).toBe(0);

    await page.keyboard.press("ControlOrMeta+Shift+m");
    await expect(overlay(page)).toBeVisible();
    await expect(editor(page)).toHaveValue(TYPED);
    expect(
      await page.evaluate(() => (window as ScratchStubWindow).__READS__ ?? 0),
    ).toBe(1);
    // Nothing was written on the way in: a restore that rewrote the file would
    // be a restore that could lose it.
    expect(await fileHolds(page)).toBe(TYPED);
  });

  test("there is one of it, wherever he is", async ({ page }) => {
    // Task 4's own reason for a global buffer: he is in the middle of one
    // worktree, remembers a thing about another, and writes it down. A buffer
    // keyed by worktree would have put that note in the one place he will not be
    // when he needs it.
    await openWorkspace(page);
    await page.keyboard.press("ControlOrMeta+Shift+m");
    await fillAndSave(page, TYPED);
    await page.keyboard.press("Escape");
    await expect(overlay(page)).toBeHidden();

    await page.getByTestId(`projects-nav-repo-${REPO.id}`).click();
    await expect(page.getByTestId("work-surface")).toBeVisible();

    await page.keyboard.press("ControlOrMeta+Shift+m");
    await expect(overlay(page)).toBeVisible();
    await expect(editor(page)).toHaveValue(TYPED);
  });

  test("nothing carries the text off this machine", async ({ page }) => {
    await openWorkspace(page);
    await page.keyboard.press("ControlOrMeta+Shift+m");
    await fillAndSave(page, TYPED);
    await page.keyboard.press("Escape");
    // Give anything that publishes on a close, a navigation or an idle tick its
    // chance to do so before the question is asked.
    await page.getByTestId(`projects-nav-repo-${REPO.id}`).click();
    await expect(page.getByTestId("work-surface")).toBeVisible();

    // The only command that ever sees this text is the one that writes the file.
    // Asked as the set of names rather than as the list, because how *many*
    // writes the debounce and the ceiling produced is `scratchAutosave`'s
    // question and it is answered without a browser; what is this spec's is
    // whether anything else was ever handed the text.
    expect(
      await page.evaluate(() => [
        ...new Set((window as ScratchStubWindow).__CARRIED__ ?? []),
      ]),
    ).toEqual(["scratch_write"]);
    // And no other route out of the page saw it at all.
    expect(
      await page.evaluate(() => (window as ScratchStubWindow).__LEAKED__ ?? []),
    ).toEqual([]);
  });

  test("the palette is the other door, and it says where the buffer is kept", async ({
    page,
  }) => {
    await openWorkspace(page);
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByTestId("palette")).toBeVisible();
    await page.getByTestId("palette-input").fill("scratch markdown");

    // The row, with the chord printed on it — a gesture nobody can find is a
    // gesture that does not exist.
    const row = page.getByTestId("palette-row-action:scratch-markdown");
    await expect(row).toBeVisible();
    await expect(row).toContainText("⇧⌘M");
    await expect(row).toContainText("never sent anywhere");

    await page.keyboard.press("Enter");
    await expect(page.getByTestId("palette")).toBeHidden();
    await expect(overlay(page)).toBeVisible();

    // What the surface says about itself: the file, so he can open it in his own
    // editor, and how far it goes, which is the half a footer usually drops.
    await expect(page.getByTestId("scratch-markdown-path")).toHaveText(PATH);
    const boundary = page.getByTestId("scratch-markdown-boundary");
    await expect(boundary).toContainText(PATH);
    await expect(boundary).toContainText("never sent anywhere");
    // And the editor names the same path in its own scope line, since a real
    // file in his home directory is exactly the kind of thing that looks like it
    // might sync.
    await expect(page.getByTestId("scratch-md-scope")).toContainText(PATH);
  });

  test("a file that cannot be read is a sentence, and no editor over it", async ({
    page,
  }) => {
    // The failure that would destroy his work: an editor drawn over a refused
    // read arms an autosave that rewrites a file this build could not open.
    await openWorkspace(page, { refuse: true });
    await page.keyboard.press("ControlOrMeta+Shift+m");
    await expect(overlay(page)).toBeVisible();

    await expect(page.getByTestId("scratch-markdown-refusal")).toHaveText(
      REFUSAL,
    );
    await expect(editor(page)).toHaveCount(0);
    expect(await fileHolds(page)).toBeNull();
  });
});
