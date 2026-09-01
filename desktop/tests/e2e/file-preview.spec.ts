// A file that has a rendering, LOOKED at — and the sandbox a worktree's page is
// looked at inside, proved by attacking it
// (owner ask: "html gosterme, dizayn gosterme, artifact gosterme vs hepsi
// olsun"; the posture itself is argued in
// `features/runs/lib/filePreview.ts`).
//
// `filePreview.test.mjs` says which files have a rendering, what the sandbox
// attribute is and what the policy forbids. All of that is pure and needs no
// browser, and none of it is repeated here.
//
// **What only a browser can say is that the posture is real.** A constant that
// spells `default-src 'none'` proves nothing about a frame; an attribute that
// says `sandbox=""` proves nothing about a page that wants out. So this file
// opens the real app, puts real files in front of it, and then attacks it:
//
// - a page **renders** — a genuine `<h1>` inside a genuine frame, not a string;
// - the frame is **opaque** — `contentDocument` is `null` from this side;
// - a page that tries to reach the parent DOM, `localStorage`, the Tauri bridge
//   and the network **reaches none of them**, and each failure is observed from
//   OUTSIDE the frame (no beacon message, no storage key, no bridge call, no
//   request) because a sandboxed frame cannot be read into;
// - and the same document, with scripts forcibly switched ON, still has every
//   one of those four attempts come back **blocked** — the belt tested with the
//   braces cut, so the CSP is not resting on `sandbox` alone;
// - a picture **decodes** — `naturalWidth` is the file's real width;
// - an `.svg` goes through the **image** path — a `data:` URL in an `<img>`, no
//   `<svg>` node anywhere in the app's DOM, and its embedded `<script>` inert;
// - each refusal is **its own sentence**, four different ones;
// - and previewing **does not open a second tab, rename one, or move a pty**.
//
// The bridge is stubbed the way `markdown-preview.spec.ts` documents: the trap
// assigns `invoke` at boot and answers exactly the commands the Files pane makes.

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";

const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
const COORDINATOR_ORIGIN = "http://127.0.0.1:7117";
const GIT_HOME = "/tmp/vingilot-preview-home";
const SHOTS = "test-results/file-preview";

/** His 16-inch MacBook Pro, the width every complaint in this island is made
 * about. */
const SIXTEEN_INCH = { height: 1117, width: 1728 };

/** The host nothing may reach. Port 59999 has no listener, so a request that
 * escaped would still fail — which is why the assertion is on the REQUEST
 * being made at all, observed by Playwright, and not on its response. */
const BEACON = "http://127.0.0.1:59999";

/** The key a page would plant in the app's own storage if it could. */
const PWNED = "vingilot-pwned";

/** The command a page would call over the Tauri bridge if it could reach it.
 * Nothing in the app invokes it, so one appearance in the trap's log is proof
 * of a break-out. */
const PWNED_COMMAND = "pwned_bridge_call";

const REPO = {
  id: "repo-preview",
  name: "vingilot",
  path: "/tmp/vingilot-preview",
};

const WORKTREE = {
  added: null,
  base_commit: "0".repeat(40),
  binding_id: "wt-preview",
  branch: "spike",
  commit_sha: null,
  lifecycle: "active",
  owner_run_id: "run-preview",
  owner_run_objective: null,
  owner_run_status: null,
  removed: null,
  repo_id: REPO.id,
  role: "task",
};

/** A design: a page whose whole point is its CSS. Inline `<style>` paints (the
 * one permission the policy grants); the web font and the tracking pixel do
 * not, which is what the sentence above the frame is there to explain. */
const DESIGN = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Vingilot mark</title>
    <link rel="stylesheet" href="${BEACON}/design.css" />
    <style>
      body { margin: 0; font-family: ui-sans-serif, system-ui, sans-serif; background: #f3f4f6; color: #1f2937; }
      .card { margin: 28px; padding: 24px 28px; border-radius: 14px; background: #ffffff; box-shadow: 0 1px 3px rgba(0,0,0,.16); }
      h1 { margin: 0 0 6px; font-size: 26px; letter-spacing: -0.01em; }
      p { margin: 0 0 18px; color: #4b5563; }
      .swatches { display: flex; gap: 10px; }
      .swatch { width: 68px; height: 68px; border-radius: 10px; }
      .a { background: #2a9d8f; } .b { background: #264653; } .c { background: #e9c46a; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Vingilot palette</h1>
      <p>Three colours and a card, drawn from this file alone.</p>
      <div class="swatches">
        <div class="swatch a"></div><div class="swatch b"></div><div class="swatch c"></div>
      </div>
    </div>
    <img alt="" src="${BEACON}/pixel.png" width="1" height="1" />
  </body>
</html>
`;

/** A page that wants out. Four reaches and a report.
 *
 * **It reports by `parent.postMessage`, the one channel no attribute revokes.**
 * That is deliberate: under the app's real posture the script never runs, so
 * the absence of this message is itself the proof; and with scripts switched on
 * the message is how the four verdicts get out of an opaque-origin frame. */
const ATTACK = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>attack</title></head>
  <body>
    <h1 id="attack-heading">this page tried</h1>
    <img alt="" src="${BEACON}/passive-pixel.png" width="1" height="1" />
    <script>
      (function () {
        var out = {};
        function attempt(name, fn) {
          try {
            var v = fn();
            out[name] = "reached:" + String(v).slice(0, 40);
          } catch (e) {
            out[name] = "blocked:" + ((e && e.name) || "error");
          }
        }
        attempt("parentDom", function () {
          return parent.document.body.childElementCount;
        });
        attempt("parentStorage", function () {
          parent.localStorage.setItem("${PWNED}", "1");
          return "set";
        });
        attempt("ownStorage", function () {
          localStorage.setItem("${PWNED}", "1");
          return "set";
        });
        attempt("bridge", function () {
          parent.__TAURI_INTERNALS__.invoke("${PWNED_COMMAND}", {});
          return "invoked";
        });
        function report() {
          parent.postMessage({ vingilotAttack: out }, "*");
        }
        try {
          fetch("${BEACON}/exfiltrate.json")
            .then(function () { out.network = "reached"; })
            .catch(function (e) { out.network = "blocked:" + ((e && e.name) || "error"); })
            .then(report);
        } catch (e) {
          out.network = "blocked:" + ((e && e.name) || "error");
          report();
        }
      })();
    </script>
  </body>
</html>
`;

/** A picture that is also a script vector: a visible mark, a `<script>` and an
 * `onload`. Through an `<img>` all three of the second kind go inert. */
const MARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="220" height="140" viewBox="0 0 220 140">
  <rect width="220" height="140" fill="#264653" />
  <circle cx="110" cy="70" r="46" fill="#2a9d8f" />
  <path d="M60 108 L110 24 L160 108 Z" fill="#e9c46a" opacity="0.85" />
  <script type="application/javascript">
    parent.postMessage({ vingilotAttack: { svg: "ran" } }, "*");
    parent.localStorage.setItem("${PWNED}", "1");
  </script>
  <image href="${BEACON}/svg-pixel.png" width="1" height="1" onload="parent.postMessage({ vingilotAttack: { svg: 'onload' } }, '*')" />
</svg>
`;

/** A real 240x160 PNG — a checker of the two brand greens. `naturalWidth` is
 * asserted against that 240, which is a claim only a decoded picture can meet. */
const SHOT_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAPAAAACgCAIAAAC9uXYyAAACYklEQVR42u3cMQ0AIAxFwaphQAgGEIYCvCKgI10glyDg0v9mou9V8tqYJY+H5+aFA/EI2mA8gjYYj6B5eATNI2gH4hG0wXgEbTAeQfPwCJpH0A7EI2iD8QjaYDyC5uERNI+gHYhH0AbjEbTBeATNwyNoHkE7EI+gDcYjaIPxFAXt0Dw/eQTNI2iD8QjaYDyC5uERNI+gHYhH0AbjEbTBeATNwyNoHkE7EI+gDcYjaIPxCJqHR9A8gnYgHkEbjEfQBuMRNA+PoHkE7UA8gjYYj6ANxlMVtEPz+DnJYDyCNhiPoHl4BM0jaAfiEbTBeARtMB5B8/AImkfQDsQjaIPxCNpgPILm4RE0j6AdiEfQBuMRtMF4BM3DI2geQTsQj6ANxiNog/EImocnB+3QPH5OMhiPoA3GI2geHkHzCNqBeARtMB5BG4xH0Dw8guYRtAPxCNpgPII2GI+geXgEzSNoB+IRtMF4BG0wHkHz8AiaR9AOxCNog/EI2mA8gubhyUE7NI+fkwzGI2iD8Qiah0fQPIJ2IB5BG4xH0AbjETQPj6B5BO1APII2GI+gDcYjaB4eQfMI2oF4BG0wHkEbjEfQPDyC5hG0A/EI2mA8gjYYj6B5eHLQDs3j5ySD8QjaYDyC5uERNI+gHYhH0AbjEbTBeATNwyNoHkE7EI+gDcYjaIPxCJqHR9A8gnYgHkEbjEfQBuMRNA+PoHkE7UA8gjYYj6ANxiNoHp4ctEPz+DnJYDyCNhiPoHl4BM0jaAfiEbTBeARtMB5B8/AImkfQDsQjaIPxCNpgPILm4RE0j6AdiOdRzwFweTAliAZXOAAAAABJRU5ErkJggg==";

/** The design, on disk, is the file the viewer reads; the picture arrives by
 * its own command. */
const FILES: Record<string, string> = {
  "attack.html": ATTACK,
  "design.html": DESIGN,
  "mark.svg": MARK_SVG,
};

/** What `file_bytes` answers, keyed by path. `broken.png` is deliberately not a
 * PNG: the read succeeds whole and the DECODER turns it down, which is the one
 * failure no read could have predicted and so has its own sentence. */
const BYTES: Record<string, string> = {
  "broken.png": "bm90LWEtcG5nLWF0LWFsbA==",
  "shot.png": SHOT_PNG_BASE64,
};

const TREE: Record<
  string,
  { name: string; kind: string; size: number | null }[]
> = {
  "": [
    { kind: "file", name: "attack.html", size: ATTACK.length },
    { kind: "file", name: "blob.bin", size: 4096 },
    { kind: "file", name: "broken.png", size: 24 },
    { kind: "file", name: "design.html", size: DESIGN.length },
    { kind: "file", name: "giant.txt", size: 4_194_304 },
    { kind: "file", name: "gone.md", size: 128 },
    { kind: "file", name: "mark.svg", size: MARK_SVG.length },
    { kind: "file", name: "shot.png", size: 667 },
  ],
};

type TrapWindow = Window & {
  __TAURI_INTERNALS__: {
    invoke: (cmd: string, args?: unknown, opts?: unknown) => unknown;
  };
  /** Every command the app asked the bridge for, in order. The bridge half of
   * the break-out assertion: `pwned_bridge_call` must never appear. */
  __VINGILOT_CALLS__: string[];
  /** Every `postMessage` this document received. A framed page's one
   * unrevokable channel, listened to precisely so its SILENCE can be asserted. */
  __VINGILOT_MSGS__: unknown[];
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
    ([home, tree, files, bytes]: [
      string,
      Record<string, { name: string; kind: string; size: number | null }[]>,
      Record<string, string>,
      Record<string, string>,
    ]) => {
      const w = window as unknown as TrapWindow;
      const calls: string[] = [];
      const msgs: unknown[] = [];
      w.__VINGILOT_CALLS__ = calls;
      w.__VINGILOT_MSGS__ = msgs;
      window.addEventListener("message", (event) => {
        msgs.push(event.data);
      });

      let fallback:
        | ((cmd: string, args?: unknown, opts?: unknown) => unknown)
        | null = null;
      const refuse = (error: unknown) => Promise.reject(error);

      const invoke = (cmd: string, args?: unknown, opts?: unknown): unknown => {
        const name = String(cmd);
        calls.push(name);
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
          // The three refusals a READ can make, each answered by the path that
          // names it, so the pane says four different sentences in four
          // different situations rather than one apologetic one.
          if (path === "blob.bin") return refuse({ kind: "binary", path });
          if (path === "giant.txt")
            return refuse({
              cap: 524_288,
              kind: "too-large",
              path,
              size: 4_194_304,
            });
          if (path === "gone.md") return refuse({ kind: "not-found", path });
          const text = files[path];
          if (text === undefined) {
            // A raster file: `file_read` is right to turn it away, and the
            // viewer is expected to ignore this answer and go through
            // `file_bytes` instead.
            return refuse({ kind: "binary", path });
          }
          return Promise.resolve({
            bytes: text.length,
            lines: text === "" ? 0 : text.replace(/\n$/, "").split("\n").length,
            path,
            text,
          });
        }
        if (name === "file_bytes") {
          const path = ((args ?? {}) as { path?: string }).path ?? "";
          const base64 = bytes[path];
          if (base64 === undefined)
            return refuse({
              detail: "No such file or directory (os error 2)",
              kind: "unreadable",
              path,
            });
          return Promise.resolve({
            base64,
            bytes: Math.ceil((base64.length * 3) / 4),
            cap: 4 * 1024 * 1024,
            path,
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
    [GIT_HOME, TREE, FILES, BYTES] as const,
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
  await expect(page.getByTestId("palette-row-pane:files")).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("palette")).toBeHidden();
  await expect(page.getByTestId("dock-files")).toBeVisible();
}

async function openFromTree(page: Page, path: string) {
  await page.getByTestId(`dock-files-row-${path}`).click();
}

/** One reach for the beacon host and what became of it. */
type Reach = { url: string; verdict: string };

/** Every reach the page made toward the beacon host, with its OUTCOME — which
 * is the assertion that matters and the one an earlier draft of this spec got
 * wrong.
 *
 * **A request being *seen* is not a request getting *out*.** Chromium reports a
 * load the policy refused the same way it reports one it sent: the request is
 * announced, and then it fails. So counting announcements would have called a
 * working sandbox a leak. What separates the two is the failure's own reason —
 * `ERR_BLOCKED_BY_CSP` means the policy stopped it inside the renderer and no
 * socket was ever opened; `ERR_CONNECTION_REFUSED` would mean it really left
 * and merely found nothing listening on port 59999. Only the first is a pass,
 * and a `response` of any kind is the loudest possible fail. */
function watchBeacon(page: Page): Reach[] {
  const reaches: Reach[] = [];
  page.on("requestfailed", (request) => {
    if (!request.url().startsWith(BEACON)) return;
    reaches.push({
      url: request.url(),
      verdict: request.failure()?.errorText ?? "failed with no reason given",
    });
  });
  page.on("response", (response) => {
    if (!response.url().startsWith(BEACON)) return;
    reaches.push({
      url: response.url(),
      verdict: `answered ${response.status()}`,
    });
  });
  return reaches;
}

/** Nothing left the machine, and each thing that tried was stopped by the
 * POLICY rather than by the absence of a listener.
 *
 * `"csp"` is the whole verdict Chromium gives a load its Content-Security-Policy
 * refused — the blocked-reason, surfaced by Playwright as the failure's own
 * text. `ERR_CONNECTION_REFUSED` (a request that really left and found port
 * 59999 empty) and `answered NNN` both fall outside this pattern, which is
 * exactly what makes the assertion worth making. */
function expectStoppedByPolicy(reaches: Reach[]) {
  for (const reach of reaches) {
    expect(reach.verdict, `${reach.url} was not stopped by the policy`).toMatch(
      /^csp$|BLOCKED_BY_CSP|BLOCKED_BY_CLIENT/i,
    );
  }
}

async function storedPwn(page: Page): Promise<string | null> {
  return await page.evaluate((key) => window.localStorage.getItem(key), PWNED);
}

async function bridgeCalls(page: Page): Promise<string[]> {
  return await page.evaluate(
    () => (window as unknown as TrapWindow).__VINGILOT_CALLS__ ?? [],
  );
}

/** Run one document in a throwaway frame of this spec's own making and wait for
 * the attack page's report, or `null` if its script never ran.
 *
 * **A frame this spec builds, deliberately — it is not the app's.** The app's
 * frame is asserted where it is drawn; this one exists to take that posture
 * apart a layer at a time, which is the only way to tell "denied" from "never
 * happened". It is removed again before this resolves, so nothing it did
 * outlives the check. */
async function probeAttack(
  page: Page,
  doc: string,
): Promise<Record<string, string> | null> {
  return await page.evaluate(async (document_: string) => {
    return await new Promise<Record<string, string> | null>((resolve) => {
      const probe = document.createElement("iframe");
      const done = (value: Record<string, string> | null) => {
        window.removeEventListener("message", onMessage);
        probe.remove();
        resolve(value);
      };
      const onMessage = (event: MessageEvent) => {
        const data = event.data as { vingilotAttack?: Record<string, string> };
        if (data && typeof data === "object" && data.vingilotAttack) {
          done(data.vingilotAttack);
        }
      };
      window.addEventListener("message", onMessage);
      probe.setAttribute("sandbox", "allow-scripts");
      probe.style.display = "none";
      probe.srcdoc = document_;
      document.body.appendChild(probe);
      setTimeout(() => done(null), 4000);
    });
  }, doc);
}

async function attackMessages(page: Page): Promise<unknown[]> {
  return await page.evaluate(() =>
    ((window as unknown as TrapWindow).__VINGILOT_MSGS__ ?? []).filter(
      (m) => typeof m === "object" && m !== null && "vingilotAttack" in m,
    ),
  );
}

test("a page from a worktree is looked at, inside a frame that says what it switched off", async ({
  page,
}) => {
  const beacon = watchBeacon(page);
  await openFilesWorkspace(page);
  await openFilesPane(page);
  await openFromTree(page, "design.html");

  // Source first, always: a page opens as the file it is, and the rendering is
  // something he asks for.
  await expect(page.getByTestId("files-viewer-code")).toBeVisible();
  await expect(page.getByTestId("files-viewer-html")).toHaveCount(0);

  const toggle = page.getByTestId("files-preview-toggle");
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  // The same word markdown already uses, with the noun that names THIS
  // rendering — one control, one label, three kinds of file.
  await expect(toggle).toHaveText("Preview");
  await expect(toggle).toHaveAttribute(
    "title",
    "Show this file as a sandboxed page",
  );

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("files-viewer-html")).toBeVisible();
  await expect(page.getByTestId("files-viewer-code")).toHaveCount(0);

  // **What is switched off, said where it is switched off.** A design whose web
  // font never arrives has to be explained rather than mysterious.
  const note = page.getByTestId("files-preview-sandbox-note");
  await expect(note).toBeVisible();
  await expect(note).toContainText("Sandboxed");
  await expect(note).toContainText("scripts");
  await expect(note).toContainText("network");

  const frame = page.getByTestId("files-viewer-html-frame");
  // The empty string is every restriction ON, and the one pair that is not a
  // sandbox at all is absent by construction.
  await expect(frame).toHaveAttribute("sandbox", "");
  const srcdoc = await frame.getAttribute("srcdoc");
  expect(srcdoc).toContain("Content-Security-Policy");
  expect(srcdoc).toContain("default-src 'none'");
  expect(srcdoc).toContain("Vingilot palette");

  // **It really rendered.** A genuine `<h1>` inside a genuine frame — not the
  // file's text painted as source, and not a string in an attribute.
  const inside = page.frameLocator('[data-testid="files-viewer-html-frame"]');
  await expect(inside.locator("h1")).toHaveText("Vingilot palette");
  await expect(inside.locator(".swatch")).toHaveCount(3);

  // **And nothing reached the app.** The frame is opaque from this side, so the
  // pane could not read into it even if it wanted to.
  const reachable = await frame.evaluate(
    (el) => (el as HTMLIFrameElement).contentDocument !== null,
  );
  expect(reachable).toBe(false);

  // The page's stylesheet and its tracking pixel are both remote, and both are
  // passive — no script involved, so `sandbox=""` has nothing to say about
  // them and `default-src 'none'` is the only thing standing there. Both are
  // genuinely tried, and both are refused by the policy rather than merely
  // failing to find a listener.
  expect(beacon.length).toBeGreaterThan(0);
  expectStoppedByPolicy(beacon);

  await waitForAnimations(page);
  await page.screenshot({ path: `${SHOTS}/01-page-rendered.png` });
});

test("a page that attacks the sandbox reaches nothing, and each reach is refused even with scripts on", async ({
  page,
}) => {
  const beacon = watchBeacon(page);
  await openFilesWorkspace(page);
  await openFilesPane(page);
  await openFromTree(page, "attack.html");
  await page.getByTestId("files-preview-toggle").click();

  const frame = page.getByTestId("files-viewer-html-frame");
  await expect(frame).toBeVisible();
  await expect(frame).toHaveAttribute("sandbox", "");

  // Give the page every chance: the frame is up, its parser has run, and its
  // passive loads would have been issued by now.
  await expect(page.getByTestId("files-preview-sandbox-note")).toBeVisible();
  await page.waitForTimeout(1200);

  // **The script never ran**, observed from outside: the one channel a framed
  // document always keeps is `parent.postMessage`, this document uses it to
  // report, and nothing arrived.
  expect(await attackMessages(page)).toEqual([]);
  // The parent's storage is untouched.
  expect(await storedPwn(page)).toBeNull();
  // The Tauri bridge was never reached.
  expect(await bridgeCalls(page)).not.toContain(PWNED_COMMAND);
  // The passive pixel was tried and the policy refused it; nothing left.
  expect(beacon.length).toBeGreaterThan(0);
  expectStoppedByPolicy(beacon);

  // **Now take the posture apart, one layer at a time.** Everything above is
  // an assertion about SILENCE — the script never ran, so nothing happened —
  // and silence is the weakest kind of evidence there is: a page that failed
  // to load at all would look identical. The two probes below fix that by
  // running the very document the app built, read off the real frame, in
  // frames this spec builds with one restriction removed at a time.
  const srcdoc = await frame.getAttribute("srcdoc");
  expect(srcdoc).not.toBeNull();

  // **Probe 1 — `sandbox` removed, policy intact.** `allow-scripts` is the one
  // permission the real frame withholds. The script STILL does not run, and it
  // still cannot: `script-src 'none'` refuses it independently. So the two
  // halves of the posture each stop this on their own, and neither is load-
  // bearing alone.
  expect(await probeAttack(page, srcdoc as string)).toBeNull();

  // **Probe 2 — `sandbox` removed AND the script permitted.** The one line of
  // the policy that stops execution is swapped out, so this time the script
  // really runs and can report. Everything else is untouched, and every one of
  // its five reaches still comes back blocked: the opaque origin refuses the
  // three that want the parent (its DOM, its storage, its Tauri bridge), its
  // own storage is refused for the same reason, and `connect-src 'none'`
  // refuses the one that wants the network.
  //
  // **This is the assertion the silence above cannot make.** It proves the
  // attack page is genuinely capable of all five reaches, and that the posture
  // — not a failure to load — is what denies each of them.
  const scripted = (srcdoc as string).replace(
    "script-src 'none'",
    "script-src 'unsafe-inline'",
  );
  expect(scripted).not.toBe(srcdoc);
  const report = await probeAttack(page, scripted);

  expect(report).not.toBeNull();
  const verdicts = report as Record<string, string>;
  // Each attempt, its own assertion — so a regression names which door opened.
  expect(verdicts.parentDom).toMatch(/^blocked:/);
  expect(verdicts.parentStorage).toMatch(/^blocked:/);
  expect(verdicts.ownStorage).toMatch(/^blocked:/);
  expect(verdicts.bridge).toMatch(/^blocked:/);
  expect(verdicts.network).toMatch(/^blocked:/);

  // And the live script still planted nothing, still called nothing, and its
  // `fetch` still never reached a socket.
  expect(await storedPwn(page)).toBeNull();
  expect(await bridgeCalls(page)).not.toContain(PWNED_COMMAND);
  expectStoppedByPolicy(beacon);
});

test("a picture is looked at, and an svg takes the picture's door rather than the DOM's", async ({
  page,
}) => {
  const beacon = watchBeacon(page);
  await openFilesWorkspace(page);
  await openFilesPane(page);

  // A raster file has no source form at all, so there is nothing to toggle
  // between and no toggle is drawn — absent rather than disabled.
  await openFromTree(page, "shot.png");
  const picture = page.getByTestId("files-viewer-image");
  await expect(picture).toBeVisible();
  await expect(page.getByTestId("files-preview-toggle")).toHaveCount(0);
  await expect(page.getByTestId("files-viewer-refusal")).toHaveCount(0);
  await expect(page.getByTestId("files-viewer-reading")).toHaveCount(0);
  expect(await picture.getAttribute("src")).toMatch(/^data:image\/png;base64,/);
  // **Decoded, not merely present.** 240 is the file's real width.
  await expect
    .poll(async () =>
      picture.evaluate((el) => (el as HTMLImageElement).naturalWidth),
    )
    .toBe(240);

  await waitForAnimations(page);
  await page.screenshot({ path: `${SHOTS}/02-picture-rendered.png` });

  // An `.svg` is text, so it keeps both halves and keeps its toggle. The
  // source half is `files-viewer-body` rather than `files-viewer-code`: Shiki
  // has no `svg` grammar, so the viewer's plain path draws it — which is
  // `viewerPlan`'s decision and none of this feature's business.
  await openFromTree(page, "mark.svg");
  await expect(page.getByTestId("files-viewer-body")).toBeVisible();
  const toggle = page.getByTestId("files-preview-toggle");
  await expect(toggle).toHaveAttribute("title", "Show this file as a picture");
  await toggle.click();

  const drawn = page.getByTestId("files-viewer-image");
  await expect(drawn).toBeVisible();
  expect(await drawn.getAttribute("src")).toMatch(
    /^data:image\/svg\+xml;charset=utf-8,/,
  );
  // **Never inlined.** No `<svg>` node exists anywhere in the app's document,
  // which is the whole security claim: an SVG in the DOM would run its script
  // with the app's own privileges; an SVG as an `<img>` source runs nothing.
  await expect(
    page.locator('[data-testid="files-viewer-picture"] svg'),
  ).toHaveCount(0);
  await expect
    .poll(async () =>
      drawn.evaluate((el) => (el as HTMLImageElement).naturalWidth),
    )
    .toBe(220);

  // Its `<script>`, its `onload` and its remote `<image>` are all inert — an
  // SVG that is an image document rather than a document runs nothing and
  // fetches nothing, which is the whole reason this file takes the picture's
  // door. Nothing reaches the beacon, and there is no `data:` URL leak either:
  // no message, no storage key.
  await page.waitForTimeout(600);
  expect(await attackMessages(page)).toEqual([]);
  expect(await storedPwn(page)).toBeNull();
  expect(beacon.filter((r) => r.verdict.startsWith("answered"))).toEqual([]);
});

test("each refusal is its own sentence, and none of them is a blank pane", async ({
  page,
}) => {
  await openFilesWorkspace(page);
  await openFilesPane(page);

  const said: string[] = [];

  // 1. A binary with no rendering: there is no text and no picture either.
  await openFromTree(page, "blob.bin");
  const binary = page.getByTestId("files-viewer-refusal");
  await expect(binary).toBeVisible();
  await expect(binary).toContainText("blob.bin");
  await expect(binary).toContainText("NUL byte");
  await expect(page.getByTestId("files-preview-toggle")).toHaveCount(0);
  said.push((await binary.innerText()).trim());

  await waitForAnimations(page);
  await page.screenshot({ path: `${SHOTS}/03-refusal-binary.png` });

  // 2. A file too large to render: the ceiling is stated with both numbers,
  // never a silent truncation.
  await openFromTree(page, "giant.txt");
  const large = page.getByTestId("files-viewer-refusal");
  await expect(large).toBeVisible();
  await expect(large).toContainText("giant.txt");
  await expect(large).toContainText("512 KiB");
  said.push((await large.innerText()).trim());

  // 3. A file that has gone away.
  await openFromTree(page, "gone.md");
  const gone = page.getByTestId("files-viewer-refusal");
  await expect(gone).toBeVisible();
  await expect(gone).toContainText("gone.md");
  await expect(gone).toContainText("any more");
  said.push((await gone.innerText()).trim());

  // 4. A picture that read whole and would not decode — a different failure
  // from all three above, so a different sentence, and it must not leave a
  // spinner behind.
  await openFromTree(page, "broken.png");
  const undecodable = page.getByTestId("files-preview-refusal");
  await expect(undecodable).toBeVisible();
  await expect(undecodable).toContainText("broken.png");
  await expect(undecodable).toContainText("image/png");
  await expect(page.getByTestId("files-viewer-reading")).toHaveCount(0);
  await expect(page.getByTestId("files-viewer-image")).toHaveCount(0);
  said.push((await undecodable.innerText()).trim());

  await waitForAnimations(page);
  await page.screenshot({ path: `${SHOTS}/04-refusal-undecodable.png` });

  // Four situations, four sentences — no shared apology standing in for any of
  // them, and not one of them empty.
  expect(new Set(said).size).toBe(4);
  for (const sentence of said) expect(sentence.length).toBeGreaterThan(20);
});

test("previewing is the same tab, under the same name, and moves no pty", async ({
  page,
}) => {
  await openFilesWorkspace(page);
  await openFilesPane(page);
  await openFromTree(page, "design.html");

  const tabs = page.locator('[data-testid^="view-tab-file:"]');
  await expect(tabs).toHaveCount(1);
  const before = (await tabs.first().innerText()).trim();

  const ptyBefore = (await bridgeCalls(page)).length;
  const toggle = page.getByTestId("files-preview-toggle");
  await toggle.click();
  await expect(page.getByTestId("files-viewer-html")).toBeVisible();

  // **One tab, still.** The rendering is the same file the other way round, so
  // it is the same tab — a second tab would make the strip lie about how many
  // things are open.
  await expect(tabs).toHaveCount(1);
  // **And the same name.** A reading tab's label is the truth about what it
  // shows (`viewTabs.ts`), and what it shows is still `design.html`.
  expect((await tabs.first().innerText()).trim()).toBe(before);

  await toggle.click();
  await expect(page.getByTestId("files-viewer-code")).toBeVisible();
  await expect(tabs).toHaveCount(1);
  expect((await tabs.first().innerText()).trim()).toBe(before);

  // **The terminal is not disturbed.** Nothing about looking at a file opens,
  // closes, writes to or resizes a pty.
  const moved = (await bridgeCalls(page))
    .slice(ptyBefore)
    .filter((cmd) => /^pty_(open|close|write|resize)$/.test(cmd));
  expect(moved).toEqual([]);
});
