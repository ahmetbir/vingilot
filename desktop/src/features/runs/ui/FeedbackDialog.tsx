// The owner's feedback, from wherever he is in the app (2026-09-03, "cmd k ya
// ya da yukari bir yere bi buton koyalim. screen shot ile birlikte feedback
// gonderebileyim").
//
// **The capture comes first.** Whoever opens this takes the window's picture
// before the dialog is on screen, so what he sends is what he was looking at
// — not a dialog over it. "Retake" closes, waits for the fade, captures, and
// reopens, for the same reason.
//
// **Two forms, one dialog.** Until a URL and a key are on this machine the
// dialog is the place to enter them; after that it is the report. The key is
// handed to the Rust side and never read back — `feedbackStatus` says only
// whether one is there — and nothing here can remove it ("deauth etme beni"):
// the way to a new key is to enter one.
//
// Mounted once at the root (`app/routes/root.tsx`) and opened through
// `feedbackRequest.ts`'s mailbox by the palette row and the top-chrome button.

import { getVersion } from "@tauri-apps/api/app";
import * as React from "react";

import {
  type CaptureMode,
  type FeedbackStatus,
  feedbackConfigure,
  feedbackSend,
  feedbackSnapshot,
  feedbackStatus,
  pastedImage,
  reportContext,
} from "@/features/runs/lib/feedbackClient";
import {
  subscribeFeedbackRequest,
  takeFeedbackRequest,
} from "@/features/runs/lib/feedbackRequest";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Textarea } from "@/shared/ui/textarea";

/** Long enough for Radix's close animation; the capture must not include the
 * dialog mid-fade. */
const RETAKE_SETTLE_MS = 260;

async function versionOrUnknown(): Promise<string> {
  try {
    return await getVersion();
  } catch {
    return "unknown";
  }
}

export function FeedbackDialog() {
  const [open, setOpen] = React.useState(false);
  const [status, setStatus] = React.useState<FeedbackStatus | null>(null);
  const [editing, setEditing] = React.useState(false);
  const [shot, setShot] = React.useState<string | null>(null);
  const [attach, setAttach] = React.useState(true);
  const [text, setText] = React.useState("");
  const [url, setUrl] = React.useState("");
  const [key, setKey] = React.useState("");
  const [busy, setBusy] = React.useState<"capture" | "save" | "send" | null>(
    null,
  );
  const [error, setError] = React.useState<string | null>(null);
  const [sentId, setSentId] = React.useState<string | null>(null);

  const capture = React.useCallback(async (mode: CaptureMode) => {
    setBusy("capture");
    try {
      setShot(await feedbackSnapshot(mode));
      setAttach(true);
    } catch (cause) {
      // Escape in the crosshair keeps what was there; anything else is a
      // report without a picture, not no report.
      if (String(cause).includes("cancelled")) return;
      if (mode === "window") setShot(null);
      setError(`No screenshot: ${String(cause)}`);
    } finally {
      setBusy(null);
    }
  }, []);

  const openFresh = React.useCallback(async () => {
    setError(null);
    setSentId(null);
    setEditing(false);
    await capture("window");
    setOpen(true);
    try {
      const current = await feedbackStatus();
      setStatus(current);
      setUrl(current.url ?? "");
    } catch (cause) {
      setStatus({ configured: false, url: null });
      setError(String(cause));
    }
  }, [capture]);

  React.useEffect(() => {
    const check = () => {
      if (takeFeedbackRequest()) void openFresh();
    };
    check();
    return subscribeFeedbackRequest(check);
  }, [openFresh]);

  const retake = async (mode: CaptureMode) => {
    setOpen(false);
    await new Promise((resolve) => setTimeout(resolve, RETAKE_SETTLE_MS));
    await capture(mode);
    setOpen(true);
  };

  const onPaste = async (event: React.ClipboardEvent) => {
    const image = await pastedImage(event.clipboardData);
    if (image === null) return;
    event.preventDefault();
    setShot(image);
    setAttach(true);
    setError(null);
  };

  const save = async () => {
    setBusy("save");
    setError(null);
    try {
      setStatus(await feedbackConfigure(url, key));
      setKey("");
      setEditing(false);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(null);
    }
  };

  const send = async () => {
    setBusy("send");
    setError(null);
    try {
      const context = reportContext(window, await versionOrUnknown());
      const id = await feedbackSend(text, context, attach ? shot : null);
      setSentId(id);
      setText("");
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(null);
    }
  };

  const connecting = status !== null && (!status.configured || editing);
  const canSend =
    busy === null && (text.trim() !== "" || (attach && shot !== null));

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogContent
        className="sm:max-w-xl"
        data-testid="feedback-dialog"
        onPaste={(event) => void onPaste(event)}
      >
        <DialogHeader>
          <DialogTitle>
            {connecting ? "Where feedback goes" : "Send feedback"}
          </DialogTitle>
          <DialogDescription>
            {connecting
              ? "The drop's URL and the key from the box. Kept on this machine, in the keyring; entering a new pair is the only way to change them."
              : "A note and, if you leave it attached, this window as it was a moment ago."}
          </DialogDescription>
        </DialogHeader>

        {status === null ? null : connecting ? (
          <div className="flex flex-col gap-3">
            <Input
              aria-label="Feedback URL"
              autoComplete="off"
              data-testid="feedback-url"
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://…/feedback"
              value={url}
            />
            <Input
              aria-label="Feedback key"
              autoComplete="off"
              data-testid="feedback-key"
              onChange={(event) => setKey(event.target.value)}
              placeholder="the whole line from the box"
              spellCheck={false}
              type="password"
              value={key}
            />
          </div>
        ) : sentId !== null ? (
          <p className="text-sm" data-testid="feedback-sent">
            Sent — report <span className="font-mono">{sentId}</span>.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            <Textarea
              aria-label="Feedback"
              data-testid="feedback-text"
              onChange={(event) => setText(event.target.value)}
              placeholder="What happened, or what should. ⌘V pastes a picture taken anywhere."
              rows={5}
              value={text}
            />
            {shot === null ? null : (
              <img
                alt="The window as it was when this opened"
                className={
                  attach
                    ? "max-h-48 w-full rounded border border-border object-contain"
                    : "max-h-48 w-full rounded border border-border object-contain opacity-30"
                }
                data-testid="feedback-shot"
                src={shot}
              />
            )}
            <div className="flex items-center justify-between gap-3 text-sm">
              <label className="flex items-center gap-2">
                <input
                  checked={attach && shot !== null}
                  data-testid="feedback-attach"
                  disabled={shot === null}
                  onChange={(event) => setAttach(event.target.checked)}
                  type="checkbox"
                />
                Attach the screenshot
              </label>
              <div className="flex items-center gap-3">
                <Button
                  data-testid="feedback-select-region"
                  disabled={busy !== null}
                  onClick={() => void retake("region")}
                  size="sm"
                  title="A crosshair: drag a rectangle, Space for a window, Escape keeps this one"
                  variant="ghost"
                >
                  Select a region
                </Button>
                <Button
                  data-testid="feedback-retake"
                  disabled={busy !== null}
                  onClick={() => void retake("window")}
                  size="sm"
                  variant="ghost"
                >
                  Retake window
                </Button>
                <Button
                  data-testid="feedback-change"
                  onClick={() => setEditing(true)}
                  size="sm"
                  variant="ghost"
                >
                  Change where it goes
                </Button>
              </div>
            </div>
          </div>
        )}

        {error === null ? null : (
          <p className="text-destructive text-sm" data-testid="feedback-error">
            {error}
          </p>
        )}

        <DialogFooter>
          {connecting ? (
            <>
              {status?.configured ? (
                <Button
                  onClick={() => setEditing(false)}
                  type="button"
                  variant="ghost"
                >
                  Back
                </Button>
              ) : null}
              <Button
                data-testid="feedback-connect"
                disabled={
                  busy !== null || url.trim() === "" || key.trim() === ""
                }
                onClick={() => void save()}
                type="button"
              >
                {busy === "save" ? "Saving…" : "Save"}
              </Button>
            </>
          ) : sentId !== null ? (
            <Button
              data-testid="feedback-done"
              onClick={() => setOpen(false)}
              type="button"
            >
              Done
            </Button>
          ) : (
            <Button
              data-testid="feedback-send"
              disabled={!canSend}
              onClick={() => void send()}
              type="button"
            >
              {busy === "send" ? "Sending…" : "Send"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
