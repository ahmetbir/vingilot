import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

// Composer dictation (vingilot/docs/plans/2026-08-13-voice.md, Task 3):
// the mic button, the fold into the draft, and the three auto-stops.
//
// **Nothing here drives real audio or real sherpa.** `start_dictation` /
// `stop_dictation` / `push_dictation_audio_pcm` are mocked no-ops
// (`e2eBridge.ts`); a fake `getUserMedia` (below, the same shape
// `huddle-transcription.spec.ts` uses for the huddle mic) satisfies the
// browser-side capture so `useDictation`'s mic-acquisition path runs for
// real, and a spec drives the "finished utterance" side by calling the
// generic `__BUZZ_E2E_EMIT_TAURI_EVENT__` helper with `"dictation-transcript"`
// — exactly the event Rust would emit, per `dictation.rs`'s module header.
//
// This is deliberately a spec about FINAL segments only: the recon behind
// this task found no partial/interim transcript exists (the recognizer is
// non-streaming), so there is no "replace the partial" case to prove here —
// only "each finished segment appends".

async function installFakeDictationMicrophone(page: Page) {
  await page.addInitScript(() => {
    const mediaDevices = navigator.mediaDevices ?? ({} as MediaDevices);
    if (!navigator.mediaDevices) {
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: mediaDevices,
      });
    }
    Object.defineProperty(mediaDevices, "getUserMedia", {
      configurable: true,
      value: async () => {
        const context = new AudioContext({ sampleRate: 48_000 });
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const destination = context.createMediaStreamDestination();
        gain.gain.value = 0;
        oscillator.connect(gain);
        gain.connect(destination);
        oscillator.start();
        return destination.stream;
      },
    });
  });
}

async function emitTranscript(page: Page, text: string) {
  await page.evaluate((segmentText) => {
    (
      window as Window & {
        __BUZZ_E2E_EMIT_TAURI_EVENT__?: (
          event: string,
          payload: unknown,
        ) => void;
      }
    ).__BUZZ_E2E_EMIT_TAURI_EVENT__?.("dictation-transcript", {
      text: segmentText,
    });
  }, text);
}

async function openGeneral(page: Page) {
  await page.goto("/");
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");
}

test("mic button starts and stops a dictation session", async ({ page }) => {
  await installFakeDictationMicrophone(page);
  await installMockBridge(page);
  await openGeneral(page);

  const micButton = page.getByTestId("dictation-mic-button");
  await expect(micButton).toBeVisible();
  await expect(micButton).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("dictation-listening-indicator")).toHaveCount(
    0,
  );

  await micButton.click();
  await expect(micButton).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("dictation-listening-indicator")).toBeVisible();

  await micButton.click();
  await expect(micButton).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("dictation-listening-indicator")).toHaveCount(
    0,
  );
});

test("finished utterances append to the draft, each with one space between them", async ({
  page,
}) => {
  await installFakeDictationMicrophone(page);
  await installMockBridge(page);
  await openGeneral(page);

  await page.getByTestId("dictation-mic-button").click();
  await expect(page.getByTestId("dictation-listening-indicator")).toBeVisible();

  // `toHaveText`/`toContainText` normalize whitespace, which would hide a
  // fold bug that inserted a double space — read the exact text instead.
  const input = page.getByTestId("message-input");
  await emitTranscript(page, "hello there");
  await expect.poll(() => input.innerText()).toBe("hello there");

  await emitTranscript(page, "how are you");
  await expect.poll(() => input.innerText()).toBe("hello there how are you");

  // A blank/no-decode flush (real VAD can flush with nothing to say) changes
  // nothing — no stray space, no empty append.
  await emitTranscript(page, "   ");
  await expect.poll(() => input.innerText()).toBe("hello there how are you");
});

test("Esc stops an active dictation session", async ({ page }) => {
  await installFakeDictationMicrophone(page);
  await installMockBridge(page);
  await openGeneral(page);

  await page.getByTestId("dictation-mic-button").click();
  await expect(page.getByTestId("dictation-listening-indicator")).toBeVisible();

  await page.getByTestId("message-input").click();
  await page.keyboard.press("Escape");

  await expect(page.getByTestId("dictation-listening-indicator")).toHaveCount(
    0,
  );
  await expect(page.getByTestId("dictation-mic-button")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
});

test("sending the message stops dictation — dictation never sends on its own", async ({
  page,
}) => {
  await installFakeDictationMicrophone(page);
  await installMockBridge(page);
  await openGeneral(page);

  await page.getByTestId("dictation-mic-button").click();
  await emitTranscript(page, "message dictated aloud");
  const input = page.getByTestId("message-input");
  await expect.poll(() => input.innerText()).toBe("message dictated aloud");

  // Dictation writes into the draft only — Enter is still the owner's send.
  await expect(page.getByTestId("send-message")).toBeEnabled();
  await page.getByTestId("send-message").click();

  await expect(page.getByTestId("dictation-listening-indicator")).toHaveCount(
    0,
  );
  await expect(page.getByTestId("dictation-mic-button")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
});

test("an absent speech model offers the download flow instead of failing silently", async ({
  page,
}) => {
  await installFakeDictationMicrophone(page);
  await installMockBridge(page, {
    dictationSttModelStatus: "not_downloaded",
  });
  await openGeneral(page);

  const micButton = page.getByTestId("dictation-mic-button");
  await micButton.click();

  // Never a silent failure: the button ends up listening once the (mocked,
  // instant) download completes — proving `start_dictation`'s "STT model not
  // ready" error routed into `download_dictation_model` + a retry rather than
  // just failing. The model here is the multilingual dictation one, not the
  // huddle's English Parakeet; `download_voice_models` deliberately no longer
  // affects it.
  await expect(micButton).toHaveAttribute(
    "data-dictation-status",
    "listening",
    {
      timeout: 10_000,
    },
  );
  await expect(page.getByTestId("dictation-error")).toHaveCount(0);
});
