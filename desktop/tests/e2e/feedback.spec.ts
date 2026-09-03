// The feedback dialog, end to end over a mock bridge (2026-09-03): the
// top-chrome button and the ⌘K row both open it; the first opening asks for
// the drop's URL and key and hands them to the Rust side; after that a note
// and the capture go out as one `feedback_send`, and the id comes back.

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

interface FeedbackProbe {
  configured: { url: string; key: string } | null;
  sends: Array<{
    text: string;
    context: Record<string, string>;
    hasShot: boolean;
  }>;
  snapshots: number;
}

declare global {
  interface Window {
    __FEEDBACK_PROBE__: FeedbackProbe;
  }
}

/** A 1×1 PNG, so the dialog has a real image to show and to send. */
const PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

async function trapFeedback(page: Page, alreadyConfigured: boolean) {
  await page.addInitScript(
    ([png, preset]: [string, boolean]) => {
      let fallback:
        | ((cmd: string, args?: unknown, opts?: unknown) => unknown)
        | null = null;
      const probe: FeedbackProbe = {
        configured: preset
          ? { key: "preset", url: "https://x.dev/feedback" }
          : null,
        sends: [],
        snapshots: 0,
      };
      window.__FEEDBACK_PROBE__ = probe;
      const invoke = (cmd: string, args?: unknown, opts?: unknown): unknown => {
        const name = String(cmd);
        const payload = (args ?? {}) as Record<string, unknown>;
        if (name === "feedback_status") {
          return Promise.resolve({
            configured: probe.configured !== null,
            url: probe.configured?.url ?? null,
          });
        }
        if (name === "feedback_configure") {
          probe.configured = {
            key: String(payload.key),
            url: String(payload.url),
          };
          return Promise.resolve({
            configured: true,
            url: probe.configured.url,
          });
        }
        if (name === "feedback_snapshot") {
          probe.snapshots += 1;
          return Promise.resolve(png);
        }
        if (name === "feedback_send") {
          probe.sends.push({
            context: payload.context as Record<string, string>,
            hasShot: typeof payload.screenshot === "string",
            text: String(payload.text),
          });
          return Promise.resolve("20260903193000-00");
        }
        if (name === "plugin:app|version") return Promise.resolve("0.5.11");
        if (fallback === null)
          return Promise.reject(new Error(`no host for ${name}`));
        return fallback(cmd, args, opts);
      };
      const w = window as unknown as {
        __TAURI_INTERNALS__?: Record<string, unknown>;
      };
      const internals = (w.__TAURI_INTERNALS__ ?? {}) as Record<
        string,
        unknown
      >;
      w.__TAURI_INTERNALS__ = internals;
      Object.defineProperty(internals, "invoke", {
        configurable: true,
        get: () => invoke,
        set: (fn: (cmd: string, args?: unknown, opts?: unknown) => unknown) => {
          fallback = fn;
        },
      });
    },
    [PNG_DATA_URL, alreadyConfigured] as const,
  );
}

async function openApp(page: Page, alreadyConfigured: boolean) {
  await page.setViewportSize({ height: 900, width: 1400 });
  await trapFeedback(page, alreadyConfigured);
  await installMockBridge(page);
  await page.goto("/#/");
  await expect(page.getByTestId("app-top-chrome")).toBeVisible();
}

test("the first opening asks where feedback goes, then the report goes out with the capture", async ({
  page,
}) => {
  await openApp(page, false);
  await page.getByTestId("top-chrome-feedback").click();
  const dialog = page.getByTestId("feedback-dialog");
  await expect(dialog).toBeVisible();
  // The capture was taken before the dialog was up.
  expect(await page.evaluate(() => window.__FEEDBACK_PROBE__.snapshots)).toBe(
    1,
  );

  await expect(page.getByTestId("feedback-url")).toBeVisible();
  await page
    .getByTestId("feedback-url")
    .fill("https://buzz.example.dev/feedback/");
  await page
    .getByTestId("feedback-key")
    .fill("0123456789abcdef0123456789abcdef0123456789abcdef");
  await page.getByTestId("feedback-connect").click();
  const configured = await page.evaluate(
    () => window.__FEEDBACK_PROBE__.configured,
  );
  expect(configured).toEqual({
    key: "0123456789abcdef0123456789abcdef0123456789abcdef",
    url: "https://buzz.example.dev/feedback/",
  });

  // Now the report form, with the picture attached by default.
  await expect(page.getByTestId("feedback-text")).toBeVisible();
  await expect(page.getByTestId("feedback-shot")).toBeVisible();
  await expect(page.getByTestId("feedback-attach")).toBeChecked();
  await page
    .getByTestId("feedback-text")
    .fill("tab isimleri worktree degisince gidiyor");
  await page.getByTestId("feedback-send").click();
  await expect(page.getByTestId("feedback-sent")).toContainText(
    "20260903193000-00",
  );

  const sends = await page.evaluate(() => window.__FEEDBACK_PROBE__.sends);
  expect(sends).toHaveLength(1);
  expect(sends[0].text).toBe("tab isimleri worktree degisince gidiyor");
  expect(sends[0].hasShot).toBe(true);
  expect(sends[0].context.route).toBe("#/");
  expect(sends[0].context.version).toBe("0.5.11");
  expect(sends[0].context.viewport).toBe("1400x900");

  await page.getByTestId("feedback-done").click();
  await expect(dialog).toBeHidden();
});

test("once configured, ⌘K's row opens straight onto the report, and unticking drops the picture", async ({
  page,
}) => {
  await openApp(page, true);
  await page.keyboard.press("ControlOrMeta+k");
  const field = page.getByTestId("palette-input");
  await expect(field).toBeVisible();
  await field.fill("send feedback");
  await page.keyboard.press("Enter");

  await expect(page.getByTestId("feedback-text")).toBeVisible();
  await expect(page.getByTestId("feedback-url")).toHaveCount(0);
  await page.getByTestId("feedback-attach").uncheck();
  await page.getByTestId("feedback-text").fill("sadece not");
  await page.getByTestId("feedback-send").click();
  await expect(page.getByTestId("feedback-sent")).toBeVisible();
  const sends = await page.evaluate(() => window.__FEEDBACK_PROBE__.sends);
  expect(sends).toEqual([
    expect.objectContaining({ hasShot: false, text: "sadece not" }),
  ]);
});
