// **The Pull requests pane, driven** — redesign P5
// (`vingilot/docs/plans/2026-08-29-redesign.md`; the surface is
// `src/features/pulls/ui/PullsPane.tsx`, the island is
// `src-tauri/src/vingilot_pulls/`).
//
// **The seam is the IPC, and it is the only seam.** `vingilot_pulls` shells out
// to `git` and then to `gh`, against github.com, with this machine's own login.
// A spec that let that run would be reading the owner's real pull requests: slow,
// flaky, dependent on a session, and — for the eight refusals, which are most of
// what this feature *is* — impossible to produce on demand. So `pulls_list` and
// `pulls_view` answer from a fixture (`src/testing/e2eBridgePulls.ts`) and
// everything above them is the real thing: the real router, the real sidebar,
// the real `pullsAnswer.ts` parser, the real sentences. No network is mocked and
// no account is touched.
//
// **The fixture is the island's own wire shape.** Every seeded answer is the
// JSON `mod.rs` serialises, so `readListAnswer`/`readDetailAnswer` parse it the
// same way they parse the real thing. A friendlier shape would be testing a
// parser that does not exist.
//
// What is claimed, in order:
//
//   §1 the list follows the workspace's selected checkout — driven through the
//      real Deck, so what is under test is `RunsScreen` → `worktreeFocus` →
//      the pane, not a value this spec wrote into localStorage.
//   §2 a row opens its detail and the back row returns to the list.
//   §3 an empty answer is drawn honestly empty — the one wrong answer this
//      feature must never give is "no pull requests" for a read that failed.
//   §4 `more`/`cap` are read off the answer, never hardcoded.
//   §5 all nine refusals, each with its own distinct sentence.
//   §6 in flight says it is in flight.
//   §7 the text sizes are rem tokens, measured against their real ground.

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";

const SHOTS =
  "/private/tmp/claude-501/-Users-ahmetyusufbirinci/9a20f9f6-1102-43cb-8495-976fd565d0ea/scratchpad/p5-shots";

/** `shared/lib/worktreeFocus.ts`'s key. Written here only in the tests that are
 * not about the publisher; §1 makes the workspace write it. */
const FOCUS_KEY = "vingilot-worktree-focus.v1";

const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
const COORDINATOR_ORIGIN = "http://127.0.0.1:7117";
const HOME = "/tmp/vingilot-pulls-home";

/** The 16-inch MacBook Pro's default logical resolution — the owner's machine. */
const SIXTEEN_INCH = { height: 1117, width: 1728 };

const REPO_A = {
  id: "repo-pulls-a",
  name: "vingilot",
  path: "/tmp/vingilot-pulls-a",
};
const REPO_B = {
  id: "repo-pulls-b",
  name: "buzz",
  path: "/tmp/vingilot-pulls-b",
};

/** A coordinator worktree. `role: "primary"` is what makes `worktreeCwd`
 * answer the repository's own path, which is the path the pane then asks
 * `pulls_list` about — so the fixture's paths and the mock's keys are the same
 * two strings, with no derivation in between. */
function worktreeOf(repoId: string, bindingId: string, branch: string) {
  return {
    added: null,
    base_commit: "0".repeat(40),
    binding_id: bindingId,
    branch,
    commit_sha: null,
    lifecycle: "active",
    owner_run_id: null,
    owner_run_objective: null,
    owner_run_status: null,
    removed: null,
    repo_id: repoId,
    role: "primary",
  };
}

const WT_A = worktreeOf(REPO_A.id, "wt-pulls-a", "finding-things");
const WT_B = worktreeOf(REPO_B.id, "wt-pulls-b", "main");

type Json = Record<string, unknown>;

/** An ISO timestamp `hours` in the past, so `agoText` renders a fixed phrase
 * instead of a number that drifts with the calendar. */
function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 3_600_000).toISOString();
}

/** One pull request, every field `payload::Pull` serialises. */
function pullOf(over: Json = {}): Json {
  return {
    additions: 128,
    author: "ahmetbir",
    authorIsBot: false,
    baseRef: "main",
    changedFiles: 6,
    createdAt: hoursAgo(3),
    deletions: 14,
    draft: false,
    headRef: "vingilot/finding-things",
    labels: ["redesign"],
    mergeable: "MERGEABLE",
    number: 412,
    reviewDecision: null,
    state: "OPEN",
    title: "Draw the pull requests pane",
    updatedAt: hoursAgo(1),
    url: "https://github.com/ahmetbir/vingilot/pull/412",
    ...over,
  };
}

function listOf(
  owner: string,
  name: string,
  pulls: Json[],
  over: Json = {},
): Json {
  return {
    cap: 30,
    kind: "answer",
    more: false,
    pulls,
    remote: "origin",
    repo: { name, owner },
    ...over,
  };
}

function detailOf(pull: Json, body: string, bodyTruncated = false): Json {
  return {
    body,
    bodyTruncated,
    kind: "answer",
    pull,
    remote: "origin",
    repo: { name: "vingilot", owner: "ahmetbir" },
  };
}

const PULL_412 = pullOf({
  labels: ["redesign", "P5"],
  reviewDecision: "CHANGES_REQUESTED",
});
const PULL_407 = pullOf({
  additions: 9,
  author: "dependabot",
  authorIsBot: true,
  changedFiles: 1,
  createdAt: hoursAgo(30),
  deletions: 9,
  draft: true,
  headRef: "bump/tauri",
  labels: [],
  mergeable: "CONFLICTING",
  number: 407,
  title: "Bump tauri from 2.1.1 to 2.2.0",
  url: "https://github.com/ahmetbir/vingilot/pull/407",
});
const PULL_BUZZ = pullOf({
  author: "tyler",
  baseRef: "main",
  headRef: "relay/huddle-audio",
  labels: ["relay"],
  number: 1204,
  title: "Huddle audio over the relay",
  url: "https://github.com/block/buzz/pull/1204",
});

const BODY = [
  "## Summary",
  "",
  "The sidebar's Pull requests row now draws the repository's real open pull",
  "requests, read with gh through vingilot_pulls.",
].join("\n");

type TrapWindow = Window & {
  __TAURI_INTERNALS__: {
    invoke: (cmd: string, args?: unknown, opts?: unknown) => unknown;
  };
};

/** The workspace's own commands, answered flat. `view-tabs.spec.ts`'s idiom:
 * the bridge assigns `invoke` at boot, *after* every init script, so the
 * property trap captures it as `fallback` rather than being overwritten by it.
 * Only the calls the mock bridge has no case for are intercepted; everything
 * else — including `pulls_list` and `pulls_view` — goes to the bridge. */
async function installWorkspaceTrap(page: Page) {
  await page.addInitScript((home: string) => {
    const w = window as unknown as TrapWindow;
    let fallback:
      | ((cmd: string, args?: unknown, opts?: unknown) => unknown)
      | null = null;

    const invoke = (cmd: string, args?: unknown, opts?: unknown): unknown => {
      const name = String(cmd);
      if (name.startsWith("plugin:path|")) return Promise.resolve(`${home}/`);
      if (name === "hook_liveness")
        return Promise.resolve({ byBinding: {}, unattributed: null });
      if (name === "worktree_stats") return Promise.resolve([]);
      if (name === "worktree_list") return Promise.resolve([]);
      if (name === "pty_backing") return Promise.resolve("tmux");
      if (name === "pty_copy_mode") return Promise.resolve(false);
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
  }, HOME);
}

async function installCoordinator(page: Page) {
  await page.route(`${COORDINATOR_ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === `/v1/workspaces/${WORKSPACE_ID}`) {
      return route.fulfill({
        json: {
          revision: 1,
          state: { repos: [REPO_A, REPO_B] },
          state_hash: "mock-state-hash",
        },
      });
    }
    if (url.pathname === `/v1/workspaces/${WORKSPACE_ID}/worktrees`) {
      return route.fulfill({ json: { worktrees: [WT_A, WT_B] } });
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

/** Seed the published focus directly. Used by every test that is *not* §1:
 * those are about what the pane draws for a given checkout, and driving the
 * whole Deck to reach each of nine refusals would be nine minutes of terminal
 * boot to assert one sentence. §1 is where the publisher itself is proved. */
async function seedFocus(page: Page, path: string, repoName: string) {
  await page.addInitScript(
    ([key, value]: readonly [string, string]) => {
      window.localStorage.setItem(key, value);
    },
    [
      FOCUS_KEY,
      JSON.stringify({ label: "finding-things", path, repoName }),
    ] as const,
  );
}

/** The pane on `/projects`, for a checkout the workspace never opened in this
 * test. `addInitScript` before `installMockBridge`, per the harness rule. */
async function openPane(
  page: Page,
  pulls: {
    delayMs?: number;
    error?: string;
    list?: Record<string, unknown>;
    view?: Record<string, unknown>;
  },
  path = REPO_A.path,
) {
  await page.setViewportSize(SIXTEEN_INCH);
  await seedFocus(page, path, "vingilot");
  await installMockBridge(page, { pulls });
  await page.goto("/#/projects");
  await expect(page.getByTestId("pulls-pane")).toBeVisible();
}

test.describe("the Pull requests pane", () => {
  // §1 — the pane follows the workspace, and the workspace is the real one.
  test("the list follows the checkout the workspace has selected", async ({
    page,
  }) => {
    await page.setViewportSize(SIXTEEN_INCH);
    await installWorkspaceTrap(page);
    await installMockBridge(page, {
      pulls: {
        list: {
          [REPO_A.path]: listOf("ahmetbir", "vingilot", [PULL_412, PULL_407]),
          [REPO_B.path]: listOf("block", "buzz", [PULL_BUZZ]),
        },
      },
    });
    await installCoordinator(page);

    await page.goto("/#/workspace");
    await expect(page.getByTestId("runs-screen")).toBeVisible();
    await page.getByTestId(`projects-nav-repo-${REPO_A.id}`).click();
    await page.getByTestId(`worktree-row-${WT_A.binding_id}`).click();

    // The workspace published; the pane — mounted only now, on another route,
    // with `RunsScreen` unmounted behind it — reads what it published.
    await page.getByTestId("open-projects-view").click();
    const pane = page.getByTestId("pulls-pane");
    await expect(pane).toHaveAttribute("data-worktree", REPO_A.path);
    await expect(page.getByTestId("pulls-summary")).toHaveText(
      "vingilot · 2 open",
    );
    await expect(page.getByTestId("pull-row")).toHaveCount(2);
    await expect(page.getByTestId("pull-row-title").first()).toHaveText(
      "Draw the pull requests pane",
    );

    // Switching checkout moves the list to that repository.
    await page.getByTestId("open-workspace-view").click();
    await expect(page.getByTestId("runs-screen")).toBeVisible();
    await page.getByTestId(`projects-nav-repo-${REPO_B.id}`).click();
    await page.getByTestId(`worktree-row-${WT_B.binding_id}`).click();
    await page.getByTestId("open-projects-view").click();

    await expect(pane).toHaveAttribute("data-worktree", REPO_B.path);
    await expect(page.getByTestId("pulls-summary")).toHaveText("buzz · 1 open");
    await expect(page.getByTestId("pull-row")).toHaveCount(1);
    await expect(page.getByTestId("pull-row-title")).toHaveText(
      "Huddle audio over the relay",
    );
  });

  // §2 — the row, its detail, and the way back.
  test("a row opens its detail and the back row returns to the list", async ({
    page,
  }) => {
    await openPane(page, {
      list: {
        [REPO_A.path]: listOf("ahmetbir", "vingilot", [PULL_412, PULL_407]),
      },
      view: {
        [`${REPO_A.path}#412`]: detailOf(PULL_412, BODY, true),
      },
    });

    const rows = page.getByTestId("pull-row");
    await expect(rows).toHaveCount(2);
    // The mockup's `.prmeta` — the author, and how long ago, both off the
    // answer.
    await expect(page.getByTestId("pull-row-meta").first()).toHaveText(
      "#412 · ahmetbir opened 3h ago",
    );
    // A bot author is named as one, a draft is drawn as a draft, and a
    // conflicting merge state gets the one word it is worth.
    await expect(page.getByTestId("pull-row-meta").nth(1)).toContainText(
      "dependabot (bot)",
    );
    await expect(page.getByTestId("pull-row-state").nth(1)).toHaveText("Draft");
    await expect(page.getByTestId("pull-row-conflict")).toHaveText("Conflicts");
    await waitForAnimations(page);
    await page
      .getByTestId("pulls-pane")
      .screenshot({ path: `${SHOTS}/01-list.png` });

    await rows.first().click();
    const detail = page.getByTestId("pull-detail");
    await expect(detail).toBeVisible();
    await expect(page.getByTestId("pull-detail-title")).toHaveText(
      "Draw the pull requests pane #412",
    );
    await expect(page.getByTestId("pull-detail-state")).toHaveText("Open");
    await expect(page.getByTestId("pull-detail-merge")).toContainText(
      "wants to merge into",
    );
    await expect(page.getByTestId("pull-detail-review")).toHaveText(
      "Changes requested",
    );
    await expect(page.getByTestId("pull-detail-body")).toContainText(
      "read with gh through vingilot_pulls",
    );
    // `bodyTruncated` is the island telling on itself, and it is drawn.
    await expect(page.getByTestId("pull-detail-truncated")).toBeVisible();
    // Nothing `pulls_view` does not fetch is on screen: no Commits card, no
    // Checks card, no reviewer rail.
    await expect(page.getByTestId("pull-row")).toHaveCount(0);
    await waitForAnimations(page);
    await page
      .getByTestId("pulls-pane")
      .screenshot({ path: `${SHOTS}/02-detail.png` });

    // The mockup's `data-act="pr-back"`.
    const back = page.getByTestId("pull-detail-back");
    await expect(back).toHaveAttribute("data-act", "pr-back");
    await back.click();
    await expect(page.getByTestId("pulls-list")).toBeVisible();
    await expect(page.getByTestId("pull-row")).toHaveCount(2);
    await expect(detail).toHaveCount(0);
  });

  // §3 — the empty answer, which this fork's own repository really gives.
  test("an empty answer is drawn honestly empty", async ({ page }) => {
    await openPane(page, {
      list: { [REPO_A.path]: listOf("ahmetbir", "vingilot", []) },
    });

    await expect(page.getByTestId("pulls-empty")).toHaveText(
      "ahmetbir/vingilot has no open pull requests.",
    );
    await expect(page.getByTestId("pulls-summary")).toHaveText(
      "vingilot · none open",
    );
    // Empty means empty: no placeholder row, and no spinner still spinning.
    await expect(page.getByTestId("pull-row")).toHaveCount(0);
    await expect(page.getByTestId("pulls-loading")).toHaveCount(0);
    await expect(page.getByTestId("pulls-refusal")).toHaveCount(0);
  });

  // §4 — "the first N of more" is the island's own N.
  test("the cap and the more flag are read off the answer", async ({
    page,
  }) => {
    const four = [412, 407, 401, 399].map((number) => pullOf({ number }));
    await openPane(page, {
      list: {
        [REPO_A.path]: listOf("ahmetbir", "vingilot", four, {
          cap: 4,
          more: true,
        }),
      },
    });

    await expect(page.getByTestId("pull-row")).toHaveCount(4);
    await expect(page.getByTestId("pulls-more")).toHaveText(
      "The first 4. ahmetbir/vingilot has more open than fit here.",
    );
    await expect(page.getByTestId("pulls-summary")).toHaveText(
      "vingilot · first 4 open",
    );
  });

  // §6 — the wait says it is a wait. (Ordered before §5 so the refusal table
  // below reads as one block.)
  test("a read still out says so rather than showing an empty list", async ({
    page,
  }) => {
    await openPane(page, {
      delayMs: 1_500,
      list: { [REPO_A.path]: listOf("ahmetbir", "vingilot", [PULL_412]) },
    });

    await expect(page.getByTestId("pulls-loading")).toHaveText(
      "Reading this repository's open pull requests from GitHub…",
    );
    await expect(page.getByTestId("pulls-summary")).toHaveText(
      "vingilot · reading…",
    );
    // The claim that matters: while the read is out, the pane never says the
    // repository has none.
    await expect(page.getByTestId("pulls-empty")).toHaveCount(0);
    await expect(page.getByTestId("pulls-list")).toBeVisible({
      timeout: 10_000,
    });
  });

  // §7 — the sizes, measured. Every readable string in this pane must be a rem
  // token (`check:px-text`'s rule), and a rem token is only worth anything if
  // it lands on its documented ground: text-sm 14px, text-2xs 11px, text-badge
  // 10px, at the app's default root size.
  test("the pane's text lands on its rem tokens", async ({ page }) => {
    await openPane(page, {
      list: {
        [REPO_A.path]: listOf("ahmetbir", "vingilot", [PULL_412], {
          cap: 1,
          more: true,
        }),
      },
    });

    const sizeOf = (testId: string) =>
      page
        .getByTestId(testId)
        .first()
        .evaluate((el) => getComputedStyle(el).fontSize);

    expect(await sizeOf("pull-row-title")).toBe("14px");
    expect(await sizeOf("pull-row-meta")).toBe("11px");
    expect(await sizeOf("pulls-summary")).toBe("11px");
    expect(await sizeOf("pulls-more")).toBe("10px");
  });
});

// §5 — nine kinds, nine sentences. The whole reason `vingilot_pulls` classifies
// a failure instead of returning one error string is so each of these can be a
// different thing to read; a pane that collapsed them would have thrown the
// island's work away.
const REFUSALS: {
  answer: Json;
  headline: string;
  hint: string | null;
  kind: string;
}[] = [
  {
    answer: {
      enclosing: "/tmp/vingilot-pulls-a",
      kind: "not-a-repo",
      path: "/tmp/vingilot-pulls-a/docs/adr",
    },
    headline: "/tmp/vingilot-pulls-a/docs/adr is not a git working tree.",
    hint: "The nearest checkout above it is /tmp/vingilot-pulls-a — open that one instead.",
    kind: "not-a-repo",
  },
  {
    answer: { kind: "git-missing" },
    headline: "There is no git on this machine that answers.",
    hint: "Vingilot reads a worktree's remotes with git before it asks GitHub anything. Install git and this list fills in.",
    kind: "git-missing",
  },
  {
    answer: {
      detail: "fatal: detected dubious ownership in repository",
      kind: "git-failed",
    },
    headline: "git refused to read this worktree's remotes.",
    hint: "git said: fatal: detected dubious ownership in repository",
    kind: "git-failed",
  },
  {
    answer: {
      kind: "no-github-remote",
      path: "/tmp/vingilot-pulls-a",
      remotes: ["origin", "gitea"],
    },
    headline: "This checkout has no remote on github.com.",
    hint: "Its remotes are origin, gitea, and none of them points at github.com.",
    kind: "no-github-remote",
  },
  {
    answer: { kind: "gh-missing" },
    headline: "The GitHub CLI is not installed.",
    hint: "Vingilot reads pull requests with gh. Install it (brew install gh), then sign in with gh auth login.",
    kind: "gh-missing",
  },
  {
    answer: { host: "github.example.com", kind: "gh-unauthenticated" },
    headline: "gh is not signed in to github.example.com.",
    hint: "Run gh auth login --hostname github.example.com in a terminal, then reopen this list. Vingilot never holds the token itself.",
    kind: "gh-unauthenticated",
  },
  {
    answer: {
      detail: "HTTP 502: Bad gateway (https://api.github.com/graphql)",
      kind: "request-failed",
      repo: "ahmetbir/vingilot",
    },
    headline: "GitHub did not answer for ahmetbir/vingilot.",
    hint: "gh said: HTTP 502: Bad gateway (https://api.github.com/graphql)",
    kind: "request-failed",
  },
  {
    answer: {
      command: "gh pr list --json number,title",
      kind: "timed-out",
      seconds: 20,
    },
    headline: "gh did not answer within 20 seconds and was stopped.",
    hint: "The call that hung was: gh pr list --json number,title",
    kind: "timed-out",
  },
  {
    // The webview's own kind, and the only one not produced by the island: the
    // IPC itself rejected. Seeded as a bridge error rather than as an answer,
    // because that is the only way it ever occurs.
    answer: {},
    headline: "Vingilot could not ask for this repository's pull requests.",
    hint: "pulls_list is not a registered command",
    kind: "call-failed",
  },
];

test.describe("every refusal renders its own sentence", () => {
  test.beforeAll(() => {
    // The claim this table exists to make: nine kinds, nine *different* things
    // to read. Asserted over the expectations themselves, so a copy edit that
    // collapsed two of them fails here rather than passing nine tests.
    expect(new Set(REFUSALS.map((one) => one.headline)).size).toBe(9);
    expect(new Set(REFUSALS.map((one) => one.kind)).size).toBe(9);
  });

  for (const refusal of REFUSALS) {
    test(refusal.kind, async ({ page }) => {
      await openPane(
        page,
        refusal.kind === "call-failed"
          ? { error: "pulls_list is not a registered command" }
          : { list: { [REPO_A.path]: refusal.answer } },
      );

      const notice = page.getByTestId("pulls-refusal");
      await expect(notice).toBeVisible();
      await expect(notice).toHaveAttribute("data-refusal", refusal.kind);
      await expect(page.getByTestId("pulls-refusal-headline")).toHaveText(
        refusal.headline,
      );
      if (refusal.hint === null) {
        await expect(page.getByTestId("pulls-refusal-hint")).toHaveCount(0);
      } else {
        await expect(page.getByTestId("pulls-refusal-hint")).toHaveText(
          refusal.hint,
        );
      }
      // A refusal is never an empty list and never a spinner.
      await expect(page.getByTestId("pulls-empty")).toHaveCount(0);
      await expect(page.getByTestId("pulls-list")).toHaveCount(0);
      await expect(page.getByTestId("pulls-loading")).toHaveCount(0);
      // The head carries no count for a read that produced none.
      await expect(page.getByTestId("pulls-summary")).toHaveCount(0);

      if (
        refusal.kind === "gh-unauthenticated" ||
        refusal.kind === "not-a-repo" ||
        refusal.kind === "timed-out"
      ) {
        await waitForAnimations(page);
        await page
          .getByTestId("pulls-pane")
          .screenshot({ path: `${SHOTS}/03-refusal-${refusal.kind}.png` });
      }
    });
  }
});
