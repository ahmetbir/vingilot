//! Standalone dictation pipeline — mic-to-draft speech recognition outside
//! any huddle (vingilot/docs/plans/2026-08-13-voice.md, Task 3).
//!
//! **On-device only.** Recognition performs no network I/O: it reuses
//! `huddle::stt::SttPipeline` (sherpa-onnx, running locally) verbatim and
//! reads its already-downloaded model files from disk. The one network call in
//! this module is `download_dictation_model`, which fetches model *weights*
//! from a pinned URL and writes them to `~/.buzz/models/` — audio and
//! transcript text never leave the machine, and there is no code path from a
//! recorded sample or a produced string to any socket.
//!
//! ## Which model, and why not the huddle's
//!
//! The huddle transcribes with Parakeet TDT-CTC 110M, which is **English
//! only**. Dictation loads the multilingual Whisper model managed by
//! `huddle::models::whisper` instead (that file's header has the full
//! reasoning): the owner dictates in Turkish, and on this surface an
//! English-only model is not a slightly worse transcript, it is a wrong one.
//! Nothing here falls back to the huddle's model when Whisper is missing —
//! silently returning English-only results for Turkish speech would be worse
//! than saying the model is not ready.
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

use tauri::{Emitter, State};

use crate::app_state::AppState;
use crate::huddle::{
    models::{whisper, ModelStatus},
    stt::{SttLanguage, SttPipeline},
};

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

/// The language hint handed to the multilingual model, read at session start.
///
/// **Auto by default**, and that default is the point: the owner mixes Turkish
/// and English inside a single sentence, and Whisper detects the language of
/// every flushed utterance on its own. A fixed hint is a preference for people
/// who know they will speak one language for a whole session and want to spend
/// no decoder budget on detection; whether it measurably improves accuracy has
/// not been benchmarked here, so it is offered, not defaulted to.
///
/// A process-global next to the pipeline it configures, for the same reason
/// the pipeline is one: there is one dictation session app-wide, so there is
/// one language for it. Not persisted across launches yet — see
/// `set_dictation_language`.
static DICTATION_LANGUAGE: Mutex<SttLanguage> = Mutex::new(SttLanguage::Auto);

fn dictation_language() -> SttLanguage {
    *DICTATION_LANGUAGE.lock().unwrap_or_else(|e| e.into_inner())
}

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
/// multilingual model hasn't finished downloading yet, so the frontend can
/// offer `download_dictation_model` instead of failing silently. The sentence
/// is matched by the frontend, so it is deliberately unchanged from when this
/// surface used the huddle's model.
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

    if !whisper::is_ready() {
        return Err("STT model not ready".to_string());
    }
    let model_dir = whisper::model_dir().ok_or("STT model directory not found")?;
    let language = dictation_language();

    // `ptt_active`/`manual_mic_unmuted` are both `None`: the whole point of
    // the composer's mic button is "listen continuously while pressed", which
    // is exactly plain VAD-driven segmentation with neither gate attached.
    //
    // `human_floor` and `output_device` arrived with the upstream sync, which
    // replaced the old `tts_active` flag this call used to pass. Both are about
    // a huddle — one arbitrates who holds the floor among several speakers, the
    // other names the route agent speech is playing out of so the mic can tell
    // it apart from a person. A dictation session has neither: nobody else is
    // in it and nothing is being spoken back. So it gets a floor of its own,
    // shared with no one, and no output device to duck against.
    let constructed = tokio::task::spawn_blocking(move || {
        SttPipeline::new_with_language(
            model_dir,
            language,
            None,
            None,
            crate::huddle::human_floor::HumanFloor::new(),
            None,
        )
    })
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

// ── Model: honest states, and the one network call ────────────────────────────

/// Everything the mic button needs to say something true before it can record.
///
/// Carries the byte count as well as the state so the surface can offer a real
/// number instead of a rounded guess that drifts when [`whisper`]'s pinned
/// release moves — see `total_download_bytes`'s comment on that.
#[derive(Clone, serde::Serialize)]
pub struct DictationModelInfo {
    /// Absent, downloading (with percent), ready, or failed — the four states,
    /// each of which the button renders as its own sentence.
    pub status: ModelStatus,
    /// Exact bytes the download costs, summed from the pinned artifact sizes.
    pub download_bytes: u64,
    /// The language hint a session started now would use.
    pub language: SttLanguage,
}

/// Report the dictation model's download state.
///
/// A separate command from `huddle::get_model_status` because it reports a
/// separate model: the huddle's English Parakeet being `Ready` says nothing
/// about whether this surface can transcribe Turkish. Pointing the mic at the
/// huddle's status is precisely the bug this command exists to prevent — it
/// would leave the button claiming readiness while `start_dictation` refuses.
#[tauri::command]
pub fn get_dictation_model_status() -> Result<DictationModelInfo, String> {
    Ok(DictationModelInfo {
        // `whisper::status` reports an error rather than `NotDownloaded` when
        // the manager itself is missing, so this never says "not downloaded"
        // for a condition downloading cannot fix.
        status: whisper::status(),
        download_bytes: whisper::total_download_bytes(),
        language: dictation_language(),
    })
}

/// Start fetching the multilingual dictation model in the background.
///
/// **This is the only network call in this module**, and it moves model
/// weights in one direction: from a pinned URL onto this disk. No audio and no
/// transcript is in scope here — see the module header, and the
/// `nothing_in_the_capture_path_can_reach_the_network` test below, which
/// enforces that rather than trusting the sentence.
///
/// Returns immediately; poll `get_dictation_model_status` for progress. Safe
/// to call repeatedly — a download already in flight or already finished is a
/// no-op.
#[tauri::command]
pub async fn download_dictation_model(state: State<'_, AppState>) -> Result<(), String> {
    let model = whisper::global()
        .ok_or("model manager unavailable (home directory could not be resolved)")?;
    model.start_download(state.http_client.clone());
    Ok(())
}

/// Set the language hint for the next dictation session.
///
/// **Takes effect on the next `start_dictation`, not the current session** —
/// the hint is baked into the recognizer when it is constructed, and rebuilding
/// it mid-utterance would drop audio the owner already spoke. Callers that want
/// it applied now should stop and start.
///
/// Not persisted across launches: every launch starts at
/// [`SttLanguage::Auto`], which is the setting that handles the sentence that
/// switches languages halfway through. Persisting a *fixed* language would make
/// the wrong answer sticky, so that wiring is deliberately not here yet.
#[tauri::command]
pub fn set_dictation_language(language: SttLanguage) -> Result<(), String> {
    let mut current = DICTATION_LANGUAGE.lock().map_err(|e| e.to_string())?;
    *current = language;
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
    use super::{dictation_language, SttLanguage, DICTATION_LANGUAGE, DICTATION_STATE};

    #[test]
    fn global_slot_starts_with_no_pipeline() {
        let dictation = DICTATION_STATE.lock().unwrap();
        assert!(dictation.pipeline.is_none());
    }

    #[test]
    fn the_default_language_is_auto_detect() {
        // The owner mixes Turkish and English inside one sentence. Auto is the
        // only setting that survives that, so it is what a fresh process has
        // before anyone touches a preference.
        assert_eq!(*DICTATION_LANGUAGE.lock().unwrap(), SttLanguage::Auto);
        assert_eq!(dictation_language(), SttLanguage::Auto);
    }

    /// This module's header promises that audio and transcripts never leave the
    /// machine. That promise is worth exactly as much as its enforcement, so
    /// this reads the module's own source and checks it.
    ///
    /// The check is deliberately structural rather than behavioural: proving
    /// "no packet was sent" at runtime would need a network sandbox the test
    /// suite doesn't have, whereas "no code outside the model download can
    /// reach a socket" is decidable by looking, and it is the property that
    /// would actually be violated by a careless edit.
    #[test]
    fn nothing_in_the_capture_path_can_reach_the_network() {
        const SOURCE: &str = include_str!("dictation.rs");

        // Scan the shipping module only. Everything from `#[cfg(test)]` on is
        // this test, which names every forbidden token in the list below and
        // is compiled out of the binary anyway.
        let shipping = SOURCE
            .split_once("#[cfg(test)]")
            .map(|(before, _)| before)
            .expect("this test module marks the end of the shipping code");

        // Comments cannot leak anything. Stripping them means a doc sentence
        // that *names* the network — this module has several — is never
        // mistaken for code that reaches it.
        let code: String = shipping
            .lines()
            .filter(|line| !line.trim_start().starts_with("//"))
            .collect::<Vec<_>>()
            .join("\n");

        // The one sanctioned touch: handing the shared HTTP client to the model
        // manager so it can fetch weights. Locate its function body; everything
        // outside is the capture path.
        const SANCTIONED: &str = "pub async fn download_dictation_model";
        let start = code
            .find(SANCTIONED)
            .expect("the model download command should exist in this module");
        // Functions here are top-level, so the body ends at the first closing
        // brace in column zero after the signature.
        let end = start
            + code[start..]
                .find("\n}")
                .expect("the model download command should be a closed block")
            + 2;

        for token in [
            "http_client",
            "reqwest",
            "TcpStream",
            "UdpSocket",
            "http://",
            "https://",
            "ws://",
            "wss://",
            // The huddle posts transcripts to the relay as kind:9 events. That
            // path must never appear here: a dictation draft is not a message,
            // and the whole reason this module exists separately is that it
            // must not become one.
            "RelayClient",
            "publish",
            "send_event",
            "build_event",
        ] {
            let leaks: Vec<usize> = code
                .match_indices(token)
                .map(|(index, _)| index)
                .filter(|index| !(start..end).contains(index))
                .collect();
            assert!(
                leaks.is_empty(),
                "`{token}` appears in the dictation capture path (byte offsets {leaks:?}); \
                 audio and transcripts must stay on this machine — if this is a \
                 legitimate new network call, it does not belong in this module"
            );
        }
    }
}
