// The Files viewer's markdown preview, proved against a real render
// (owner ask: "markdown preview"; recon 2026-08-13).
//
// `fileViewer.test.mjs` says which files offer a preview and which do not —
// `.md` yes, `.mdx` and `.rs` no, and a `.md` over the tokenise budget still
// yes. That is pure and needs no browser.
//
// **What only a browser can say is that the toggle reaches the screen and swaps
// the body.** Three things, each a real way this could be added wrong:
//
// - The toggle is **offered for a `.md` and absent for everything else** — a
//   control wired to `preview` alone rather than to `previewableAsMarkdown`
//   would draw on a `.rs` and do nothing.
// - Toggling **replaces the source body with rendered prose** — the `data-line`
//   source spans go, a real `<h1>` and `<ul>` appear, drawn by the app's own
//   chat `Markdown`. A toggle that only flipped `aria-pressed` without swapping
//   the body passes every unit test there is; this is the assertion that
//   separates a live toggle from a decorative one, and it is the one stubbed to
//   a no-op for the RED proof.
// - **`interactive={false}` keeps the webview safe** — an external link renders
//   as text, not an `<a href>` that would navigate the shell.
//
// The bridge is stubbed the way `workspace-files.spec.ts` documents: the trap
// assigns `invoke` at boot and answers exactly the commands the Files pane makes.

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
const COORDINATOR_ORIGIN = "http://127.0.0.1:7117";
const GIT_HOME = "/tmp/vingilot-mdprev-home";

/** His 16-inch MacBook Pro, the width every complaint in this island is made
 * about (see `workspace-files.spec.ts` for the arithmetic that makes the tree a
 * drawer at 435px). */
const SIXTEEN_INCH = { height: 1117, width: 1728 };

const REPO = {
  id: "repo-mdprev",
  name: "vingilot",
  path: "/tmp/vingilot-mdprev",
};

const WORKTREE = {
  added: null,
  base_commit: "0".repeat(40),
  binding_id: "wt-mdprev",
  branch: "spike",
  commit_sha: null,
  lifecycle: "active",
  owner_run_id: "run-mdprev",
  owner_run_objective: null,
  owner_run_status: null,
  removed: null,
  repo_id: REPO.id,
  role: "task",
};

/** A markdown file with a heading, a list and an external link — each a shape
 * the preview must produce a real DOM node for, and the link a shape it must
 * NOT turn into a navigating anchor. */
const README = `# Vingilot Preview Heading

A paragraph of prose in the buffer.

- first item
- second item

[an external link](https://example.com/never-navigated)
`;

/** A file the toggle must NOT appear for: no prose form. */
const GREET = `export function greet(name: string): string {
  return \`hello \${name}\`;
}
`;

const TREE: Record<
  string,
  { name: string; kind: string; size: number | null }[]
> = {
  "": [
    { kind: "file", name: "README.md", size: README.length },
    { kind: "file", name: "greet.ts", size: GREET.length },
  ],
};

const FILES: Record<string, string> = {
  "README.md": README,
  "greet.ts": GREET,
};

type TrapWindow = Window & {
  __TAURI_INTERNALS__: {
    invoke: (cmd: string, args?: unknown, opts?: unknown) => unknown;
  };
};

async function openFilesWorkspace(page: Page) {
  await page.setViewportSize(SIXTEEN_INCH);
  await installMockBridge(page);
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
      return route.fulfill({ json: { worktrees: [WORKTREE] } });
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
      const refuse = (error: unknown) => Promise.reject(error);

      const invoke = (cmd: string, args?: unknown, opts?: unknown): unknown => {
        const name = String(cmd);
        if (name.startsWith("plugin:path|")) return Promise.resolve(`${home}/`);
        if (name === "worktree_tree") {
          const dir = ((args ?? {}) as { dir?: string }).dir ?? "";
          const entries = tree[dir];
          if (entries === undefined)
            return refuse({ kind: "not-found", path: dir });
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
            return refuse({
              detail: "No such file or directory (os error 2)",
              kind: "unreadable",
              path,
            });
          }
          return Promise.resolve({
            bytes: text.length,
            lines: text === "" ? 0 : text.replace(/\n$/, "").split("\n").length,
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
  await page.getByTestId(`worktree-row-${WORKTREE.binding_id}`).click();
}

async function openFilesPane(page: Page) {
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByTestId("palette")).toBeVisible();
  await page.getByTestId("palette-input").fill("files");
  const row = page.getByTestId("palette-row-pane:files");
  await expect(row).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("palette")).toBeHidden();
  await expect(page.getByTestId("pane-files")).toBeVisible();
}

/** Open a file from the tree and put the tree away — the whole gesture at his
 * width, where the tree is a drawer over the viewer. */
async function openFromTree(page: Page, path: string) {
  await page.getByTestId(`files-row-${path}`).click();
  const toggle = page.getByTestId("files-tree-toggle");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await toggle.click();
  await expect(page.getByTestId("files-tree-drawer")).toHaveCount(0);
}

test("a markdown file toggles between source and rendered preview", async ({
  page,
}) => {
  await openFilesWorkspace(page);
  await openFilesPane(page);
  await openFromTree(page, "README.md");

  // Default is source: the highlighted body is up, with `data-line` spans, and
  // no rendered prose container.
  const code = page.getByTestId("files-viewer-code");
  await expect(code).toBeVisible();
  await expect(
    page.locator('[data-testid="files-viewer-body"] [data-line]').first(),
  ).toBeVisible();
  await expect(page.getByTestId("files-viewer-preview")).toHaveCount(0);

  // The toggle is offered, and not yet pressed.
  const toggle = page.getByTestId("files-preview-toggle");
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");

  // Toggle to preview: the source body is gone, a real rendered container is up,
  // and it carries a genuine <h1> and <ul> — nodes only the markdown pipeline
  // produces, not spans of source text.
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  const preview = page.getByTestId("files-viewer-preview");
  await expect(preview).toBeVisible();
  await expect(preview.locator("h1")).toHaveText("Vingilot Preview Heading");
  await expect(preview.locator("ul li")).toHaveCount(2);
  await expect(preview.locator("ul li").first()).toHaveText("first item");

  // The source spans are genuinely gone, not merely hidden behind the preview.
  await expect(page.getByTestId("files-viewer-code")).toHaveCount(0);
  await expect(page.locator("[data-line]")).toHaveCount(0);

  // `interactive={false}`: the external link is inert text, never a navigating
  // anchor into the webview.
  await expect(
    preview.locator('a[href="https://example.com/never-navigated"]'),
  ).toHaveCount(0);
  await expect(preview).toContainText("an external link");

  // Toggle back: the source body returns, the preview is gone.
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("files-viewer-code")).toBeVisible();
  await expect(page.getByTestId("files-viewer-preview")).toHaveCount(0);
});

test("a non-markdown file offers no preview toggle", async ({ page }) => {
  // The gate is `previewableAsMarkdown`, not the pane's `preview` bit: a `.ts`
  // has no prose form, so the control is absent rather than disabled.
  await openFilesWorkspace(page);
  await openFilesPane(page);
  await openFromTree(page, "greet.ts");

  await expect(page.getByTestId("files-viewer-code")).toBeVisible();
  await expect(page.getByTestId("files-preview-toggle")).toHaveCount(0);
});
