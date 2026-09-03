// The webview's side of the feedback drop (`src-tauri/src/vingilot_feedback`).
//
// The key is typed here once and handed straight to the Rust side; nothing in
// this module ever reads it back, and `feedbackStatus` answers only whether
// one is there. The capture is taken BEFORE the dialog opens, by whoever
// opens it, so the dialog is not in its own screenshot.

import { invokeTauri } from "@/shared/api/tauri";

export interface FeedbackStatus {
  url: string | null;
  configured: boolean;
}

export function feedbackStatus(): Promise<FeedbackStatus> {
  return invokeTauri<FeedbackStatus>("feedback_status");
}

export function feedbackConfigure(
  url: string,
  key: string,
): Promise<FeedbackStatus> {
  return invokeTauri<FeedbackStatus>("feedback_configure", { key, url });
}

export type CaptureMode = "window" | "region";

/** The window as it is now — or, with `region`, whatever he drags out with
 * macOS's crosshair — as a PNG data URL. Rejects with "cancelled" when the
 * crosshair is dismissed. */
export function feedbackSnapshot(
  mode: CaptureMode = "window",
): Promise<string> {
  return invokeTauri<string>("feedback_snapshot", { mode });
}

/** The first image on a paste, as a data URL — so a picture taken anywhere
 * else can be the report's picture ("disardan ss yapistirmama izin ver"). */
export function pastedImage(data: DataTransfer | null): Promise<string | null> {
  const file = Array.from(data?.items ?? [])
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .find((f): f is File => f !== null);
  if (file === undefined) return Promise.resolve(null);
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve(typeof reader.result === "string" ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

export function feedbackSend(
  text: string,
  context: Record<string, string>,
  screenshot: string | null,
): Promise<string> {
  return invokeTauri<string>("feedback_send", { context, screenshot, text });
}

export { reportContext } from "./feedbackContext";
