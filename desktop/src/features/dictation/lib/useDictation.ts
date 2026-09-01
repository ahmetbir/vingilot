// The dictation session: mic lifecycle, the model-download offer, and the
// idle auto-stop — the one hook both fold targets (composer, Ask box) share
// (vingilot/docs/plans/2026-08-13-voice.md, Task 3).
//
// **On-device only.** Everything this hook drives is local: `getUserMedia` is
// the browser's own mic API, `setupAudioWorklet` feeds raw PCM to a Rust
// pipeline over Tauri IPC (never the network), and the only network call
// anywhere in this feature is `download_dictation_model`, which pulls model
// weights onto this disk and sends nothing. Nothing here posts audio or
// transcript text anywhere but back into the caller's own draft.
//
// **The dictation model is not the huddle's model.** This hook deliberately
// does not call `download_voice_models` / `get_model_status`: those manage the
// huddle's English-only Parakeet, which cannot transcribe a word of Turkish.
// Asking Parakeet whether it is ready would let the mic report itself ready
// and then fail on every utterance. `dictation.rs` explains the split.
//
// **No partial transcript.** `dictation-transcript` events are one finished
// utterance each (`dictation.rs`'s module header, `dictationFold.ts`'s
// header) — this hook hands each one to `onSegment` exactly once, in order,
// and does no buffering or replacement of its own.
//
// **The idle auto-stop is timed from the last real segment, not from raw
// audio.** The recon behind this task found no "silence" signal exposed to
// the frontend — VAD lives entirely inside the Rust worker and its only
// observable effect is "a finished utterance arrives". Timing out from
// *time since the last `dictation-transcript` event* (or since `start()`, if
// none has arrived yet) composes on that real signal instead of inventing a
// second, parallel silence detector over the raw mic stream.

import * as React from "react";
import { listen } from "@tauri-apps/api/event";

import { invokeTauri } from "@/shared/api/tauri";
import {
  setupAudioWorklet,
  type AudioWorkletHandle,
} from "@/features/huddle/lib/audioWorklet";

/** How long with no finished utterance before the session auto-stops.
 * Generous on purpose — a thinking pause mid-sentence is normal speech, and
 * an auto-stop that fires while the owner is still composing their thought
 * would be worse than one that waits too long. */
const IDLE_TIMEOUT_MS = 20_000;

/** How often the idle timer is checked. Not the timeout itself — a coarse
 * poll is enough for a UX-scale timeout and keeps this a plain interval
 * rather than a `setTimeout` that needs rescheduling on every segment. */
const IDLE_CHECK_INTERVAL_MS = 1_000;

/** How long to wait for the dictation model download before giving up and
 * reporting an error instead of listening forever.
 *
 * The multilingual model is 358 MiB (375,485,327 bytes — the exact figure is
 * pinned in `models_whisper.rs` and reported by `download_bytes` below), which
 * is more than three times the huddle's English model this timeout was
 * originally sized for. Fifteen minutes covers a ~0.4 MB/s connection; a tight
 * timeout here does not fail faster, it just reports a download that is still
 * healthy as broken. */
const MODEL_DOWNLOAD_TIMEOUT_MS = 900_000;
const MODEL_POLL_INTERVAL_MS = 1_000;

export type DictationStatus =
  | "idle"
  | "downloading-model"
  | "listening"
  | "error";

export interface Dictation {
  status: DictationStatus;
  /** Set only when `status === "error"`. */
  error: string | null;
  /** Download progress 0–100 while `status === "downloading-model"`, or
   * `null` when no percentage is known yet (the manager reports one only once
   * a response with a `Content-Length` is streaming). `null` means "no number
   * to show", never "0%" — a progress bar pinned at zero for a download that
   * is actually moving is the dishonest state this distinction avoids. */
  modelProgress: number | null;
  /** Start (or, if already listening, no-op). Never auto-called. */
  start: () => void;
  /** Stop, if a session is running. Always safe to call — a no-op when
   * already idle. */
  stop: () => void;
}

/** Mirrors `ModelStatus` in `huddle/models.rs`. serde renames to snake_case
 * and writes unit variants as bare strings, data variants as a one-key
 * object. */
export type ModelStatus =
  | "not_downloaded"
  | "ready"
  | { downloading: { progress_percent: number } }
  | { error: string };

/** Mirrors `DictationModelInfo` in `dictation.rs`. */
interface DictationModelInfo {
  status: ModelStatus;
  /** Exact bytes the download costs — pinned in Rust, never guessed here. */
  download_bytes: number;
  language: string;
}

/** What waiting on the model concluded. Four arms because the model really
 * has four fates, and collapsing "the download reported an error" into "it
 * didn't finish in time" is how a mic ends up silently doing nothing. */
type ModelWait =
  | { kind: "ready" }
  | { kind: "failed"; message: string }
  | { kind: "timeout" }
  | { kind: "abandoned" };

/** Poll `get_dictation_model_status` until the multilingual model is ready,
 * the download reports a failure, the session is superseded, or the download
 * timeout elapses. Reports progress percent as it goes so the surface can say
 * how far along it is rather than spinning indefinitely. */
async function waitForDictationModel(
  shouldContinue: () => boolean,
  onProgress: (percent: number | null) => void,
): Promise<ModelWait> {
  const deadline = Date.now() + MODEL_DOWNLOAD_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (!shouldContinue()) return { kind: "abandoned" };
    try {
      const { status } = await invokeTauri<DictationModelInfo>(
        "get_dictation_model_status",
      );
      if (status === "ready") return { kind: "ready" };
      // A reported error is terminal: the manager has already given up, so
      // polling on would just burn the timeout before saying the same thing
      // less usefully.
      if (typeof status === "object" && "error" in status) {
        return { kind: "failed", message: status.error };
      }
      onProgress(
        typeof status === "object" && "downloading" in status
          ? status.downloading.progress_percent
          : null,
      );
    } catch {
      // Transient — keep polling until the deadline.
    }
    await new Promise((resolve) => setTimeout(resolve, MODEL_POLL_INTERVAL_MS));
  }
  return { kind: "timeout" };
}

export interface UseDictationOptions {
  /** Called once per finished utterance, in arrival order. */
  onSegment: (text: string) => void;
}

export function useDictation({ onSegment }: UseDictationOptions): Dictation {
  const [status, setStatus] = React.useState<DictationStatus>("idle");
  const [error, setError] = React.useState<string | null>(null);
  const [modelProgress, setModelProgress] = React.useState<number | null>(null);
  const onSegmentRef = React.useRef(onSegment);
  onSegmentRef.current = onSegment;
  // True once THIS instance's `start()` has confirmed the backend pipeline
  // is actually running, until `stop()` (or a definitive local teardown)
  // clears it. Read inside the transcript listener below to decide whether
  // this instance owns the running session — see that effect's comment on
  // why this, and not `status`, is the gate.
  const ownsBackendSessionRef = React.useRef(false);
  const workletRef = React.useRef<AudioWorkletHandle | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  // Bumped on every start()/stop() so an in-flight async start (mic prompt,
  // model download) can tell it's been superseded and unwind instead of
  // clobbering a newer session's state.
  const sessionRef = React.useRef(0);
  const lastActivityRef = React.useRef(0);

  const teardownMedia = React.useCallback(() => {
    workletRef.current?.stop();
    workletRef.current = null;
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
  }, []);

  const stop = React.useCallback(() => {
    sessionRef.current += 1;
    ownsBackendSessionRef.current = false;
    teardownMedia();
    setStatus("idle");
    setError(null);
    void invokeTauri("stop_dictation").catch(() => {
      // Best-effort — the mic is already torn down locally either way.
    });
  }, [teardownMedia]);

  const start = React.useCallback(() => {
    if (status === "listening" || status === "downloading-model") return;
    const session = ++sessionRef.current;
    const stillCurrent = () => sessionRef.current === session;
    setError(null);

    void (async () => {
      try {
        await invokeTauri("start_dictation");
      } catch (startError) {
        const message =
          startError instanceof Error ? startError.message : String(startError);
        if (message !== "STT model not ready") {
          if (stillCurrent()) {
            setStatus("error");
            setError(message);
          }
          return;
        }
        if (!stillCurrent()) return;
        setStatus("downloading-model");
        setModelProgress(null);
        try {
          await invokeTauri("download_dictation_model");
        } catch (downloadError) {
          // Refusing to *start* is a real, immediately-knowable failure (no
          // home directory, say). Reporting it now beats polling for fifteen
          // minutes to conclude the same thing.
          if (!stillCurrent()) return;
          setStatus("error");
          setError(
            downloadError instanceof Error
              ? downloadError.message
              : String(downloadError),
          );
          return;
        }
        const waited = await waitForDictationModel(
          stillCurrent,
          setModelProgress,
        );
        if (!stillCurrent()) return;
        if (waited.kind === "abandoned") return;
        if (waited.kind === "failed") {
          setStatus("error");
          setError(`The speech model download failed: ${waited.message}`);
          return;
        }
        if (waited.kind === "timeout") {
          setStatus("error");
          setError(
            "The speech model didn't finish downloading. Try again in a moment.",
          );
          return;
        }
        try {
          await invokeTauri("start_dictation");
        } catch (retryError) {
          if (!stillCurrent()) return;
          setStatus("error");
          setError(
            retryError instanceof Error
              ? retryError.message
              : String(retryError),
          );
          return;
        }
      }

      if (!stillCurrent()) {
        // Stopped while the backend pipeline was starting — undo it.
        void invokeTauri("stop_dictation").catch(() => {});
        return;
      }

      // The backend pipeline is confirmed running for this session — mic
      // acquisition and worklet setup below are local-only steps that can't
      // fail the backend, so a transcript arriving in the beat before
      // `setStatus("listening")` (below) is still genuinely this instance's.
      ownsBackendSessionRef.current = true;

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
        if (!stillCurrent()) {
          for (const track of stream.getTracks()) track.stop();
          void invokeTauri("stop_dictation").catch(() => {});
          return;
        }
        const track = stream.getAudioTracks()[0];
        if (!track) throw new Error("no microphone track available");
        streamRef.current = stream;
        workletRef.current = await setupAudioWorklet(
          track,
          "voice_activity",
          true,
          "push_dictation_audio_pcm",
        );
        lastActivityRef.current = Date.now();
        setStatus("listening");
      } catch (micError) {
        void invokeTauri("stop_dictation").catch(() => {});
        if (!stillCurrent()) return;
        ownsBackendSessionRef.current = false;
        teardownMedia();
        setStatus("error");
        setError(
          micError instanceof Error
            ? micError.message
            : "Microphone access failed.",
        );
      }
    })();
  }, [status, teardownMedia]);

  // Each finished utterance both folds into the caller's draft and resets
  // the idle clock — see this file's header on why the clock rides on this
  // event rather than a raw-audio timer.
  //
  // **Ownership guard.** `dictation.rs` has exactly one process-global
  // pipeline (that module's header), and its `dictation-transcript` event is
  // a plain `app.emit` — broadcast to every listener, not routed to whichever
  // surface started the session. Every mounted `useDictation` instance (the
  // composer's dock, the ⌘K palette's Ask box, and any other consumer added
  // later) registers its own listener here, so without a guard a transcript
  // meant for one surface folds into all of them simultaneously.
  //
  // Gating on `status === "listening"` looked like the obvious guard but is
  // wrong by one beat: `start()` confirms the backend pipeline is running
  // (the `start_dictation` call above resolves) before it acquires the mic
  // and sets up the AudioWorklet — several awaits, and therefore several
  // ticks, before `setStatus("listening")` finally runs. A transcript that
  // arrives in that beat is still genuinely this instance's (the backend
  // session it owns is already running), but `status` would still read
  // "idle" and the event would be dropped instead of folded — a real
  // composer-dictation.spec.ts case turns red on exactly this window: send
  // right after the mic click, before "listening" ever renders.
  // `ownsBackendSessionRef` is set the moment `start()` confirms that same
  // backend success (mirroring every other post-await write in `start()`,
  // guarded by the same `stillCurrent()` check) and cleared by `stop()` or a
  // definitive local teardown, so it tracks backend ownership directly
  // instead of through the one-beat-late UI state.
  React.useEffect(() => {
    let unlisten: (() => void) | null = null;
    let disposed = false;
    listen<{ text: string }>("dictation-transcript", (event) => {
      if (!ownsBackendSessionRef.current) return;
      lastActivityRef.current = Date.now();
      onSegmentRef.current(event.payload.text);
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  // Idle auto-stop, while listening only.
  React.useEffect(() => {
    if (status !== "listening") return;
    const id = window.setInterval(() => {
      if (Date.now() - lastActivityRef.current >= IDLE_TIMEOUT_MS) {
        stop();
      }
    }, IDLE_CHECK_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [status, stop]);

  // Never leave the mic open behind an unmounted surface.
  React.useEffect(() => () => stop(), [stop]);

  return { error, modelProgress, start, status, stop };
}
