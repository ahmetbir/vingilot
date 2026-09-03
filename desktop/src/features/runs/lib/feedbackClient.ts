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

/** The window as it is now, as a PNG data URL. */
export function feedbackSnapshot(): Promise<string> {
  return invokeTauri<string>("feedback_snapshot");
}

export function feedbackSend(
  text: string,
  context: Record<string, string>,
  screenshot: string | null,
): Promise<string> {
  return invokeTauri<string>("feedback_send", { context, screenshot, text });
}

export { reportContext } from "./feedbackContext";
