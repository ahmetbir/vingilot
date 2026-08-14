//! Standalone dictation pipeline — mic-to-draft speech recognition outside
//! any huddle (vingilot/docs/plans/2026-08-13-voice.md, Task 3).
//!
//! **On-device only.** This module performs no network I/O of its own: it
//! reuses `huddle::stt::SttPipeline` (sherpa-onnx, running locally) verbatim
//! and reads its already-downloaded model files from disk. The only network
//! call anywhere near this feature is the existing `download_voice_models`
//! command (`huddle::mod`), invoked by the frontend when the model is
//! missing — nothing in this module fetches or sends audio or text off the
//! machine.
//!
//! Mental model, deliberately smaller than the huddle's:
//!
//! ```text
//! composer mic button / Ask-box mic button
//!   → start_dictation (Tauri cmd)
//!   → SttPipeline::new (reused from huddle::stt, unmodified)
//!   → AudioWorklet (webview) → push_dictation_audio_pcm → SttPipeline::push_audio
//!   → text_rx (tokio mpsc<String>) → forwarded as a "dictation-transcript"
//!     Tauri EVENT — never a relay POST. The huddle path
//!     (`huddle::pipeline::spawn_transcription_task`) posts a kind:9 relay
//!     message on purpose (it IS the huddle transcript); a dictation draft
//!     must never leave the machine, let alone leak into a channel other
//!     members can read.
//! ```
//!
//! There is only ever one dictation session app-wide, not one per composer —
//! that is why this is a single `Mutex`-guarded slot rather than a map. The
//! message composer and the Ask box both start/stop the same session; only
//! one of them is ever listening at a time in practice (starting a second
//! while one runs is a no-op — see `start_dictation`).
//!
//! **No partial/interim transcript exists.** `SttPipeline`'s recognizer
//! (`sherpa_onnx::OfflineRecognizer`) is non-streaming and only ever emits one
//! final string per VAD-flushed utterance (see `huddle::stt`'s own header).
//! `dictation-transcript` reflects that honestly: every event it carries is a
//! finished segment to append, never a partial to replace.

use std::sync::{atomic::AtomicBool, Arc, Mutex};

use tauri::Emitter;

use crate::huddle::{models, stt::SttPipeline};

/// Maximum IPC audio batch size. Mirrors `huddle::mod`'s private constant of
/// the same name and value — both bound the same AudioWorklet batch shape
/// (100ms @ 48kHz f32 mono ≈ 19KB), and one `usize` is not worth a module
/// dependency to share.
const MAX_AUDIO_BATCH_BYTES: usize = 100 * 1024;

/// Holds the single running dictation pipeline, if any.
struct DictationState {
    pipeline: Option<Arc<SttPipeline>>,
}

/// Process-global slot for the single, huddle-independent dictation session —
/// mirrors `huddle::models`' `GLOBAL_MODEL_MANAGER` singleton rather than
/// growing `AppState`, which is already at the desktop file-size ratchet's
/// ceiling (`vingilot_command_table.rs`'s header is the earlier split against
/// the same ceiling, on `lib.rs`). Unlike that singleton this needs no lazy
/// `OnceLock`: `Mutex::new` is itself `const`, and `DictationState`'s only
/// field is a plain `None`, so a bare `static` initializes for free.
static DICTATION_STATE: Mutex<DictationState> = Mutex::new(DictationState { pipeline: None });

/// One finished utterance, delivered to the frontend as a Tauri event named
/// `dictation-transcript`. See this module's header: there is no partial
/// variant, so there is no `is_final` field to be honest about.
#[derive(Clone, serde::Serialize)]
struct DictationTranscript {
    text: String,
}

/// Start the dictation pipeline.
///
/// NOT idempotent, deliberately: a second `start_dictation` while a session
/// is running is refused with its own sentence. The pipeline is
/// process-global, and an idempotent `Ok` told the second surface it owned
/// the session — two owners folding every transcript is the fan-out leak in
/// miniature. A dead worker still restarts transparently.
///
/// Returns `Err("STT model not ready")` — the same sentinel
/// `huddle::start_stt_pipeline` uses for the same condition — when the
/// Parakeet model hasn't finished downloading yet, so the frontend can offer
/// the existing `download_voice_models` flow instead of failing silently.
#[tauri::command]
pub async fn start_dictation(app: tauri::AppHandle) -> Result<(), String> {
    {
        let mut dictation = DICTATION_STATE.lock().map_err(|e| e.to_string())?;
        if let Some(existing) = dictation.pipeline.as_ref() {
            if !existing.is_finished() {
                // A refusal, not an idempotent Ok: the pipeline is process-global,
                // and a second surface that gets Ok back believes it owns the
                // session — both then fold every transcript, which is the
                // fan-out leak with two owners instead of many. The sentence is
                // matched by the frontend; the first surface keeps the mic.
                return Err("dictation is already running in another composer".to_string());
            }
            dictation.pipeline = None; // Dead worker — fall through and restart.
        }
    }

    if !models::is_stt_ready() {
        return Err("STT model not ready".to_string());
    }
    let model_dir = models::stt_model_dir().ok_or("STT model directory not found")?;

    // No TTS in dictation, ever — this flag exists only because
    // `SttPipeline::new` takes one; nothing in this module ever sets it.
    // `ptt_active`/`manual_mic_unmuted` are both `None`: the whole point of
    // the composer's mic button is "listen continuously while pressed", which
    // is exactly plain VAD-driven segmentation with neither gate attached.
    let tts_active = Arc::new(AtomicBool::new(false));
    let constructed =
        tokio::task::spawn_blocking(move || SttPipeline::new(model_dir, tts_active, None, None))
            .await
            .map_err(|e| format!("dictation pipeline task join failed: {e}"))??;
    let (pipeline, mut text_rx) = constructed;
    let pipeline = Arc::new(pipeline);

    {
        let mut dictation = DICTATION_STATE.lock().map_err(|e| e.to_string())?;
        dictation.pipeline = Some(Arc::clone(&pipeline));
    }

    // Forward every finished utterance as a Tauri event. Ends naturally when
    // `stop_dictation` drops the pipeline: dropping it drops `audio_tx`,
    // which unblocks the worker thread's `recv_timeout` loop; the worker then
    // drops `text_tx` on exit, and `text_rx.recv()` returns `None` here.
    tauri::async_runtime::spawn(async move {
        while let Some(text) = text_rx.recv().await {
            let _ = app.emit("dictation-transcript", DictationTranscript { text });
        }
    });

    Ok(())
}

/// Stop the dictation pipeline, if one is running.
///
/// A no-op (not an error) when none is — the composer's Esc/toggle-off path
/// calls this unconditionally and must not have to check state first.
#[tauri::command]
pub fn stop_dictation() -> Result<(), String> {
    let old = {
        let mut dictation = DICTATION_STATE.lock().map_err(|e| e.to_string())?;
        dictation.pipeline.take()
    };
    if let Some(ref pipeline) = old {
        pipeline.shutdown();
    }
    drop(old); // Drop::drop joins the worker thread here, outside the lock.
    Ok(())
}

/// Receive raw PCM audio bytes from the dictation AudioWorklet and feed the
/// pipeline.
///
/// Same wire shape as `huddle::push_audio_pcm` (raw f32 LE samples, 48kHz
/// mono) but reads the standalone dictation slot instead of a huddle's — kept
/// as a separate command on purpose (see this module's header) rather than
/// threading a mode flag through the huddle command, which would couple this
/// feature to `HuddleState` for no reason.
///
/// If no dictation pipeline is active, the bytes are silently discarded —
/// the same fail-open-but-inert behavior `push_audio_pcm` has.
#[tauri::command]
pub fn push_dictation_audio_pcm(request: tauri::ipc::Request<'_>) -> Result<(), String> {
    match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => {
            if bytes.len() > MAX_AUDIO_BATCH_BYTES {
                return Err(format!(
                    "audio batch too large: {} bytes (max {})",
                    bytes.len(),
                    MAX_AUDIO_BATCH_BYTES
                ));
            }
            if let Ok(dictation) = DICTATION_STATE.lock() {
                if let Some(ref pipeline) = dictation.pipeline {
                    pipeline.push_audio(bytes.to_vec())?;
                }
            }
            Ok(())
        }
        _ => Err("expected raw binary body".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::DICTATION_STATE;

    #[test]
    fn global_slot_starts_with_no_pipeline() {
        let dictation = DICTATION_STATE.lock().unwrap();
        assert!(dictation.pipeline.is_none());
    }
}
