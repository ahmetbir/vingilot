// This repository, read with git at test time, in the shapes
// `vingilot_worktree` answers in.
//
// **Why a fixture that shells out instead of a fixture that is typed in.**
// P4.3 and P4.4 are both about what happens at REAL scale. A two-commit
// fixture has one lane and proves nothing about a lane column with no ceiling;
// a six-line hand-written patch has no `diff --git` preamble, no rename, no
// enclosing-function header and nothing worth highlighting. Every earlier
// round's evidence was a fixture that could not have shown the defect, so the
// evidence for these two is the thing the defect was found on: this
// repository's own history (200 commits over every ref, two dozen concurrent
// branches) and this app's own source.
//
// **What is asserted from it, and what is not.** A spec that pinned a subject,
// a hash or a lane count would be red on the next commit. So the assertions
// over this data are the invariants only real scale can exercise — the graph
// fits its box, the subject has room, the patch carries no plumbing — and
// everything shaped like "the newest commit is X" stays in the hand-written
// fixtures where it belongs. The screenshots are the other half: they are the
// evidence, and they are of the real thing.
//
// Read once at module load, in the Playwright process (Node), and handed to
// the page through `addInitScript`.

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

/** The checkout these reads are made in: this repository. */
export const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

/** The backend's own page size, so the page this fixture carries is the page
 * the app would really have been given (`log.rs`'s `MAX_COMMITS`). */
const PAGE = 200;

/** How much of a commit this fixture carries. The backend caps a patch at
 * 2,000 lines and 256 KB per file; a screenshot needs neither, and a 20-file
 * commit's full text through `addInitScript` is seconds of nothing. Six files
 * and 400 lines each is past anything a screenshot shows and still real. */
const MAX_FILES = 6;
const MAX_PATCH_LINES = 400;

function git(args: string[]): string {
  return execFileSync("git", ["-C", REPO_ROOT, ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

export interface RealCommit {
  hash: string;
  short: string;
  author: string;
  date: string;
  refs: string[];
  parents: string[];
  subject: string;
}

/** `log.rs`'s own record format, parsed the way `log.rs` parses it — NUL
 * between commits, newline between fields. */
function parseLog(text: string): RealCommit[] {
  const out: RealCommit[] = [];
  for (const record of text.split("\0")) {
    if (record.trim() === "") continue;
    const fields = record.split("\n");
    if (fields.length < 7) continue;
    const [hash, short, author, date, refs, parents] = fields;
    out.push({
      author,
      date,
      hash,
      parents: parents.split(/\s+/).filter(Boolean),
      refs: refs
        .split(", ")
        .map((name) => name.trim())
        .filter(Boolean),
      short,
      subject: fields.slice(6).join("\n"),
    });
  }
  return out;
}

const FORMAT = "--format=%H%n%h%n%an%n%aI%n%D%n%P%n%s";

/** Every ref, newest first — what a branch graph is a picture of, and the read
 * whose lane count is the whole of P4.3. */
export const ALL_REFS: RealCommit[] = parseLog(
  git([
    "log",
    "-z",
    "--no-color",
    FORMAT,
    `--max-count=${PAGE}`,
    "--all",
    "--",
  ]),
);

/** HEAD's own trunk — `--first-parent`, the bounded fallback. */
export const TRUNK: RealCommit[] = parseLog(
  git([
    "log",
    "-z",
    "--no-color",
    FORMAT,
    `--max-count=${PAGE}`,
    "--first-parent",
    "HEAD",
    "--",
  ]),
);

/** The newest commit that changed TypeScript under the workspace feature —
 * located rather than pinned, so this stays a real code diff as the branch
 * moves. */
function newestCodeCommit(): string {
  const found = git([
    "log",
    "-1",
    "--format=%H",
    "--",
    "desktop/src/features/runs",
  ]).trim();
  return found === "" ? git(["rev-parse", "HEAD"]).trim() : found;
}

export const CODE_COMMIT = newestCodeCommit();

export interface RealDiffFile {
  path: string;
  oldPath: string | null;
  change: string;
  additions: number;
  deletions: number;
  binary: boolean;
  patch: string;
  truncated: boolean;
}

/** One commit's changed files, in `worktree_diff`'s answer shape. */
function filesOf(commit: string): RealDiffFile[] {
  const numstat = git([
    "show",
    "--numstat",
    "--no-color",
    "--format=",
    commit,
    "--",
  ]);
  const files: RealDiffFile[] = [];
  for (const line of numstat.split("\n")) {
    if (line.trim() === "") continue;
    const [added, removed, file] = line.split("\t");
    if (file === undefined) continue;
    if (files.length >= MAX_FILES) break;
    const binary = added === "-" && removed === "-";
    const raw = binary
      ? ""
      : git([
          "diff",
          "--no-color",
          "--no-ext-diff",
          "--unified=3",
          `${commit}~1`,
          commit,
          "--",
          file,
        ]);
    const lines = raw.split("\n");
    const truncated = lines.length > MAX_PATCH_LINES;
    files.push({
      additions: binary ? 0 : Number(added),
      binary,
      change: "modified",
      deletions: binary ? 0 : Number(removed),
      oldPath: null,
      patch: truncated ? lines.slice(0, MAX_PATCH_LINES).join("\n") : raw,
      path: file,
      truncated,
    });
  }
  return files;
}

function totals(files: RealDiffFile[]) {
  return files.reduce(
    (sum, file) => ({
      additions: sum.additions + file.additions,
      deletions: sum.deletions + file.deletions,
    }),
    { additions: 0, deletions: 0 },
  );
}

const CODE_FILES = filesOf(CODE_COMMIT);

export const REAL_DIFF = {
  ...totals(CODE_FILES),
  base: `${CODE_COMMIT.slice(0, 7)}~1`,
  files: CODE_FILES,
  limits: {
    maxFiles: 400,
    maxPatchBytes: 262_144,
    maxPatchLines: 2000,
    maxUntracked: 100,
  },
  omittedFiles: 0,
  omittedUntracked: 0,
};

/** A file in this commit whose patch has **all three kinds of line** — a
 * context line, an addition and a deletion.
 *
 * A newly added file's patch is nothing but `+` rows, which cannot answer the
 * question P4.4 is really about: whether an added line's code starts at the
 * same x as a context line's. So the alignment reading needs a modified file,
 * and it is located rather than pinned. */
export const REAL_MIXED_PATH =
  CODE_FILES.find(
    (file) =>
      !file.binary &&
      /^@@/m.test(file.patch) &&
      /^ \S/m.test(file.patch) &&
      /^\+[^+]/m.test(file.patch) &&
      /^-[^-]/m.test(file.patch),
  )?.path ?? "";

/** A path in this repository that really is TypeScript with real syntax in it
 * — what "Shiki coloured the diff" is asserted against. */
export const REAL_TS_PATH =
  CODE_FILES.find(
    (file) => file.path.includes("features/runs") && file.path.endsWith(".ts"),
  )?.path ??
  CODE_FILES.find((file) => file.path.endsWith(".ts"))?.path ??
  CODE_FILES[0]?.path ??
  "";

/** `worktree_tree`'s answer for a directory of this repository, so the tree
 * and the file viewer are drawing this app's own files. */
export function realTree(dir: string): {
  dir: string;
  entries: { name: string; kind: string; size: number | null }[];
  limit: number;
  truncated: boolean;
} {
  // `<mode> <type> <hash>\t<path>`, git's own one-line-per-entry listing.
  const listing = git(["ls-tree", "HEAD", dir === "" ? "./" : `${dir}/`]);
  const entries: { name: string; kind: string; size: number | null }[] = [];
  for (const line of listing.split("\n")) {
    const found = /^\d+ (\w+) \w+\t(.*)$/.exec(line);
    if (found === null) continue;
    const full = found[2];
    entries.push({
      kind: found[1] === "tree" ? "directory" : "file",
      name: full.slice(full.lastIndexOf("/") + 1),
      size: null,
    });
  }
  return { dir, entries, limit: 2000, truncated: false };
}

/** A real file's text, in `file_read`'s answer shape. */
export function realFile(file: string): {
  path: string;
  text: string;
  bytes: number;
  lines: number;
} {
  const text = git(["show", `HEAD:${file}`]);
  return {
    bytes: text.length,
    lines: text.split("\n").length,
    path: file,
    text,
  };
}

// ---------------------------------------------------------------------------
// The workspace, standing in this repository
// ---------------------------------------------------------------------------
//
// The bridge trap is `view-tabs.spec.ts`'s (and `status-bar.spec.ts`'s) own
// idiom: the mock bridge assigns `invoke` at boot, which is after any init
// script, so the property trap captures it as `fallback` rather than being
// overwritten by it. What is different here is only the data behind it.

export const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
export const COORDINATOR_ORIGIN = "http://127.0.0.1:7117";
/** The 16-inch MacBook Pro's default logical resolution — his own machine, and
 * the width every measurement in these specs is taken at. */
export const SIXTEEN_INCH = { height: 1117, width: 1728 };

export const REPO = {
  id: "repo-real",
  name: "vingilot",
  path: REPO_ROOT,
};

export const WORKTREE = {
  added: null,
  base_commit: "0".repeat(40),
  binding_id: "wt-real",
  branch: "vingilot/finding-things",
  commit_sha: null,
  lifecycle: "active",
  owner_run_id: "run-real",
  owner_run_objective: null,
  owner_run_status: null,
  removed: null,
  repo_id: REPO.id,
  role: "task",
};

/** The directories the tree fixture answers for. Anything else is a
 * `not-found`, which is what the real backend says about a path that is not
 * there — the tree simply does not expand it. */
const TREE_DIRS = [
  "",
  "desktop",
  "desktop/src",
  "desktop/src/features",
  "desktop/src/features/runs",
  "desktop/src/features/runs/lib",
  "desktop/src/features/runs/ui",
];

/** Every file the viewer may be asked for: the ones in the diff, plus the
 * whole of the `lib` directory the tree can walk into. */
function readableFiles(): Record<string, ReturnType<typeof realFile>> {
  const out: Record<string, ReturnType<typeof realFile>> = {};
  for (const file of REAL_DIFF.files) {
    if (file.binary) continue;
    try {
      out[file.path] = realFile(file.path);
    } catch {
      // A file the commit deleted has no `HEAD:` blob. Not an error here: the
      // viewer would refuse it too.
    }
  }
  return out;
}

export async function installRealRepo(page: Page) {
  const trees: Record<string, ReturnType<typeof realTree>> = {};
  for (const dir of TREE_DIRS) trees[dir] = realTree(dir);
  await page.addInitScript(
    ([home, tree, files, all, trunk, diff, commit]: [
      string,
      Record<string, unknown>,
      Record<string, unknown>,
      unknown[],
      unknown[],
      unknown,
      string,
    ]) => {
      const w = window as unknown as {
        __TAURI_INTERNALS__: {
          invoke: (cmd: string, args?: unknown, opts?: unknown) => unknown;
        };
      };
      let fallback:
        | ((cmd: string, args?: unknown, opts?: unknown) => unknown)
        | null = null;

      const invoke = (cmd: string, args?: unknown, opts?: unknown): unknown => {
        const name = String(cmd);
        const payload = (args ?? {}) as Record<string, unknown>;
        if (name.startsWith("plugin:path|")) return Promise.resolve(`${home}/`);
        if (name === "hook_liveness")
          return Promise.resolve({ byBinding: {}, unattributed: null });
        if (name === "worktree_stats") return Promise.resolve([]);
        if (name === "worktree_list") return Promise.resolve([]);
        if (name === "pty_backing") return Promise.resolve("tmux");
        if (name === "pty_copy_mode") return Promise.resolve(false);
        if (name.startsWith("pty_")) return Promise.resolve(null);
        if (name === "worktree_tree") {
          const dir = String(payload.dir ?? "");
          const answer = tree[dir];
          if (answer === undefined) {
            return Promise.reject({ kind: "not-found", path: dir });
          }
          return Promise.resolve(answer);
        }
        if (name === "file_read") {
          const at = String(payload.path ?? "");
          const answer = files[at];
          if (answer === undefined) {
            return Promise.reject({ kind: "not-found", path: at });
          }
          return Promise.resolve(answer);
        }
        if (name === "worktree_log") {
          // **A read costs time, and this fixture makes it cost some.** A mock
          // that answers in a microtask hides every ordering bug between a
          // fetch and the React commit that follows it — measured: the dock's
          // first-parent read had a self-cancelling effect that hung the panel
          // on "reading…" forever in the owner's live app and passed here,
          // because the answer beat the re-render. 60ms is a plausible Tauri
          // IPC round trip and is what makes this fixture able to fail.
          // The two scopes the panel really asks for, answered with the two
          // readings this repository really has. `firstParent` is the flag
          // P4.3 added; `all` is P4.1's.
          const page_ =
            payload.firstParent === true
              ? trunk
              : payload.all === true
                ? all
                : trunk;
          return new Promise((resolve) => {
            setTimeout(
              () =>
                resolve({
                  commits: page_,
                  cursor: null,
                  limit: 200,
                  more: true,
                }),
              60,
            );
          });
        }
        if (name === "worktree_diff") return Promise.resolve(diff);
        if (name === "commit_diff") {
          return Promise.resolve({
            commit: (all as { hash: string }[]).find(
              (entry) => entry.hash === String(payload.commit ?? ""),
            ) ?? { hash: commit },
            diff,
            merge: false,
            parent: `${commit}~1`,
          });
        }
        if (fallback === null) {
          return Promise.reject(new Error(`no host for ${name}`));
        }
        return fallback(cmd, args, opts);
      };

      const internals = (w.__TAURI_INTERNALS__ ?? {}) as {
        invoke: (cmd: string, args?: unknown, opts?: unknown) => unknown;
      };
      w.__TAURI_INTERNALS__ = internals;
      Object.defineProperty(internals, "invoke", {
        configurable: true,
        get: () => invoke,
        set: (fn: (cmd: string, args?: unknown, opts?: unknown) => unknown) => {
          fallback = fn;
        },
      });
    },
    [
      REPO_ROOT,
      trees,
      readableFiles(),
      ALL_REFS,
      TRUNK,
      REAL_DIFF,
      CODE_COMMIT,
    ] as const,
  );
}

export async function openRealWorkspace(page: Page) {
  await page.setViewportSize(SIXTEEN_INCH);
  await installRealRepo(page);
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

  await page.goto("/#/workspace");
  await expect(page.getByTestId("runs-screen")).toBeVisible();
  await page.getByTestId(`projects-nav-repo-${REPO.id}`).click();
  await expect(page.getByTestId("work-surface")).toBeVisible();
  await page.getByTestId(`worktree-row-${WORKTREE.binding_id}`).click();
  await expect(page.getByTestId("terminal-tab-strip")).toBeVisible();
}

/** The dock's own tab strip — each panel has its own testid. */
const DOCK_PANEL = {
  checks: "dock-checks",
  diff: "pane-diff",
  files: "dock-files",
  history: "dock-history",
} as const;

export async function openDockTab(
  page: Page,
  tab: keyof typeof DOCK_PANEL,
): Promise<void> {
  await page.getByTestId(`dock-tab-${tab}`).click();
  await expect(
    page.getByTestId("dock").getByTestId(DOCK_PANEL[tab]),
  ).toBeVisible();
}
