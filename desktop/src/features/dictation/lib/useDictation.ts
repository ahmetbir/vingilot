// The dictation session: mic lifecycle, the model-download offer, and the
// idle auto-stop — the one hook both fold targets (composer, Ask box) share
// (vingilot/docs/plans/2026-08-13-voice.md, Task 3).
//
// **On-device only.** Everything this hook drives is local: `getUserMedia` is
// the browser's own mic API, `setupAudioWorklet` feeds raw PCM to a Rust
// pipeline over Tauri IPC (never the network), and the only network call
// anywhere in this feature is `download_voice_models` — the same command
// `huddle`'s model manager already uses, invoked here only when the model
// genuinely isn't downloaded yet. Nothing here posts audio or transcript text
// anywhere but back into the caller's own draft.
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

/** How long to wait for the STT model download before giving up and
 * reporting an error instead of listening forever. ~100MB (recon: Parakeet
 * TDT-CTC 110M, int8) on a slow connection can take a while; this is
 * generous rather than tight. */
const MODEL_DOWNLOAD_TIMEOUT_MS = 180_000;
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
  /** Start (or, if already listening, no-op). Never auto-called. */
  start: () => void;
  /** Stop, if a session is running. Always safe to call — a no-op when
   * already idle. */
  stop: () => void;
}

interface ModelStatusResponse {
  stt: unknown;
}

function isSttReady(status: ModelStatusResponse): boolean {
  return status.stt === "ready";
}

/** Poll `get_model_status` until the STT model is ready, `shouldContinue`
 * turns false (the session was stopped, or superseded by a newer one), or the
 * download timeout elapses. */
async function waitForSttReady(
  shouldContinue: () => boolean,
): Promise<boolean> {
  const deadline = Date.now() + MODEL_DOWNLOAD_TIMEOUT_MS;
  while (shouldContinue() && Date.now() < deadline) {
    try {
      const status = await invokeTauri<ModelStatusResponse>("get_model_status");
      if (isSttReady(status)) return true;
    } catch {
      // Transient — keep polling until the deadline.
    }
    await new Promise((resolve) => setTimeout(resolve, MODEL_POLL_INTERVAL_MS));
  }
  // The loop above only exits without returning when `shouldContinue()` went
  // false (superseded/stopped) or the deadline passed — either way, not
  // ready.
  return false;
}

export interface UseDictationOptions {
  /** Called once per finished utterance, in arrival order. */
  onSegment: (text: string) => void;
}

export function useDictation({ onSegment }: UseDictationOptions): Dictation {
  const [status, setStatus] = React.useState<DictationStatus>("idle");
  const [error, setError] = React.useState<string | null>(null);
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
        try {
          await invokeTauri("download_voice_models");
        } catch {
          // The download itself failing to *start* is reported by the poll
          // below timing out — no separate error path needed.
        }
        const ready = await waitForSttReady(stillCurrent);
        if (!stillCurrent()) return;
        if (!ready) {
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

  return { error, start, status, stop };
}
