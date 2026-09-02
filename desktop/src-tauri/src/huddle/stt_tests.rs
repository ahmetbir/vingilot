use std::sync::{atomic::AtomicBool, mpsc, Arc, Barrier};

use super::{
    has_enough_voiced_audio, run_stt_receive_loop, vad_flush_allowed, HumanFloor, SttAudioInput,
    SttAudioOrigin, SttLoopInput, VadEndpoint, VadFrameAction, MIN_VOICED_FRAMES,
    SILENCE_FLUSH_FRAMES, VAD_FRAME_SAMPLES, VAD_ONSET_FRAMES, VAD_PRE_ROLL_FRAMES,
};

#[derive(Clone, Copy)]
enum WorkerExit {
    Shutdown,
    SenderDisconnect,
}

fn assert_worker_exit_releases_floor(exit: WorkerExit) {
    let human_floor = HumanFloor::new();
    let shutdown = Arc::new(AtomicBool::new(false));
    let (audio_tx, audio_rx) = mpsc::channel();
    let acquired = Arc::new(Barrier::new(2));
    let worker_floor = human_floor.clone();
    let worker_shutdown = Arc::clone(&shutdown);
    let worker_acquired = Arc::clone(&acquired);
    let worker = std::thread::spawn(move || {
        run_stt_receive_loop(
            audio_rx,
            &worker_shutdown,
            worker_floor.clone(),
            |input, local_barge_in_state| {
                if matches!(input, SttLoopInput::Batch(_)) && !worker_floor.is_blocked() {
                    local_barge_in_state.acquire(&worker_floor, true, false);
                    worker_acquired.wait();
                }
            },
        );
    });

    audio_tx
        .send(SttAudioInput {
            pcm_bytes: Vec::new(),
            origin: SttAudioOrigin::Local,
        })
        .expect("worker receiver is open");
    acquired.wait();
    assert!(human_floor.is_blocked());
    match exit {
        WorkerExit::Shutdown => {
            shutdown.store(true, std::sync::atomic::Ordering::Release);
        }
        WorkerExit::SenderDisconnect => drop(audio_tx),
    }
    worker.join().expect("worker exits cleanly");

    let replacement_epoch = human_floor.epoch();
    assert!(
        human_floor.permits(replacement_epoch),
        "fresh TTS authorization must proceed after worker exit"
    );
    assert!(human_floor.enter_local(true, false));
}

#[test]
fn worker_shutdown_releases_local_floor_for_replacement() {
    assert_worker_exit_releases_floor(WorkerExit::Shutdown);
}

#[test]
fn worker_channel_disconnect_releases_local_floor_for_replacement() {
    assert_worker_exit_releases_floor(WorkerExit::SenderDisconnect);
}

fn frame(value: f32) -> Vec<f32> {
    vec![value; VAD_FRAME_SAMPLES]
}

#[test]
fn short_vad_blips_do_not_reach_the_recognizer() {
    assert!(!has_enough_voiced_audio(1));
    assert!(!has_enough_voiced_audio(MIN_VOICED_FRAMES - 1));
    assert!(has_enough_voiced_audio(MIN_VOICED_FRAMES));
}

#[test]
fn confirmed_onset_prepends_pre_roll_once() {
    let mut endpoint = VadEndpoint::new();
    for value in 0..VAD_PRE_ROLL_FRAMES - VAD_ONSET_FRAMES {
        assert_eq!(
            endpoint.process_frame(frame(value as f32), 0.0, true, true, SILENCE_FLUSH_FRAMES),
            VadFrameAction::None
        );
    }
    for value in 0..VAD_ONSET_FRAMES {
        let action = endpoint.process_frame(
            frame(100.0 + value as f32),
            0.9,
            true,
            true,
            SILENCE_FLUSH_FRAMES,
        );
        if value + 1 == VAD_ONSET_FRAMES {
            assert_eq!(action, VadFrameAction::ConfirmedOnset);
        } else {
            assert_eq!(action, VadFrameAction::None);
        }
    }

    assert_eq!(
        endpoint.speech_buf.len(),
        VAD_PRE_ROLL_FRAMES * VAD_FRAME_SAMPLES
    );
    assert_eq!(endpoint.speech_buf[0], 0.0);
    assert_eq!(endpoint.speech_buf[VAD_FRAME_SAMPLES], 1.0);
    assert_eq!(endpoint.pre_roll.len(), 0);
    endpoint.process_frame(frame(200.0), 0.9, true, true, SILENCE_FLUSH_FRAMES);
    assert_eq!(
        endpoint.speech_buf.len(),
        (VAD_PRE_ROLL_FRAMES + 1) * VAD_FRAME_SAMPLES
    );
}

#[test]
fn onset_requires_consecutive_high_frames() {
    let mut endpoint = VadEndpoint::new();
    for probability in [0.9, 0.9, 0.2, 0.9, 0.9] {
        assert_eq!(
            endpoint.process_frame(frame(1.0), probability, true, true, SILENCE_FLUSH_FRAMES),
            VadFrameAction::None
        );
    }
    assert_eq!(
        endpoint.process_frame(frame(1.0), 0.9, true, true, SILENCE_FLUSH_FRAMES),
        VadFrameAction::ConfirmedOnset
    );
}

#[test]
fn offset_hysteresis_preserves_borderline_speech() {
    let mut endpoint = VadEndpoint::new();
    for _ in 0..VAD_ONSET_FRAMES {
        endpoint.process_frame(frame(1.0), 0.9, true, true, SILENCE_FLUSH_FRAMES);
    }
    assert_eq!(
        endpoint.process_frame(frame(2.0), 0.4, true, true, SILENCE_FLUSH_FRAMES),
        VadFrameAction::Speech
    );
    assert_eq!(endpoint.silence_frames, 0);
}

#[test]
fn below_offset_threshold_starts_silence() {
    let mut endpoint = VadEndpoint::new();
    for _ in 0..VAD_ONSET_FRAMES {
        endpoint.process_frame(frame(1.0), 0.9, true, true, SILENCE_FLUSH_FRAMES);
    }
    assert_eq!(
        endpoint.process_frame(frame(0.0), 0.3, true, true, SILENCE_FLUSH_FRAMES),
        VadFrameAction::FirstSilence
    );
    assert_eq!(endpoint.silence_frames, 1);
}

#[test]
fn short_segment_reaches_the_visible_drop_path() {
    let mut endpoint = VadEndpoint::new();
    for _ in 0..VAD_ONSET_FRAMES {
        endpoint.process_frame(frame(1.0), 0.9, true, true, SILENCE_FLUSH_FRAMES);
    }
    let mut action = VadFrameAction::None;
    for _ in 0..SILENCE_FLUSH_FRAMES {
        action = endpoint.process_frame(frame(0.0), 0.0, true, true, SILENCE_FLUSH_FRAMES);
    }
    assert_eq!(action, VadFrameAction::Flush);
    assert!(!has_enough_voiced_audio(endpoint.voiced_frames));
    assert!(!endpoint.speech_buf.is_empty());
}

#[test]
fn silence_flush_retains_only_hangover_audio() {
    let mut endpoint = VadEndpoint::new();
    for _ in 0..VAD_ONSET_FRAMES {
        endpoint.process_frame(frame(1.0), 0.9, true, true, SILENCE_FLUSH_FRAMES);
    }
    let speech_len = endpoint.speech_buf.len();
    for index in 1..=SILENCE_FLUSH_FRAMES {
        let action = endpoint.process_frame(frame(0.0), 0.0, true, true, SILENCE_FLUSH_FRAMES);
        if index == SILENCE_FLUSH_FRAMES {
            assert_eq!(action, VadFrameAction::Flush);
        }
    }
    assert_eq!(
        endpoint.speech_buf.len(),
        speech_len + 6 * VAD_FRAME_SAMPLES
    );
}

#[test]
fn flush_boundary_never_double_includes_audio() {
    const SEGMENT_N_MARKER: f32 = 777.0;
    let mut endpoint = VadEndpoint::new();
    for _ in 0..VAD_ONSET_FRAMES {
        endpoint.process_frame(
            frame(SEGMENT_N_MARKER),
            0.9,
            true,
            true,
            SILENCE_FLUSH_FRAMES,
        );
    }
    for _ in 0..SILENCE_FLUSH_FRAMES {
        endpoint.process_frame(
            frame(SEGMENT_N_MARKER),
            0.0,
            true,
            true,
            SILENCE_FLUSH_FRAMES,
        );
    }
    endpoint.reset_segment();

    for _ in 0..VAD_ONSET_FRAMES {
        endpoint.process_frame(frame(2.0), 0.9, true, true, SILENCE_FLUSH_FRAMES);
    }
    let leaked = endpoint
        .speech_buf
        .iter()
        .filter(|sample| **sample == SEGMENT_N_MARKER)
        .count();
    assert_eq!(leaked, 0, "segment N audio leaked into segment N+1");
}

#[test]
fn reset_prevents_pre_roll_from_leaking_between_segments() {
    const SEGMENT_N_MARKER: f32 = 777.0;
    let mut endpoint = VadEndpoint::new();
    endpoint.pre_roll.push_back(frame(SEGMENT_N_MARKER));
    endpoint.reset_segment();
    for _ in 0..VAD_ONSET_FRAMES {
        endpoint.process_frame(frame(2.0), 0.9, true, true, SILENCE_FLUSH_FRAMES);
    }
    let leaked = endpoint
        .speech_buf
        .iter()
        .filter(|sample| **sample == SEGMENT_N_MARKER)
        .count();
    assert_eq!(leaked, 0, "segment N pre-roll leaked into segment N+1");
}

#[test]
fn held_push_to_talk_never_silence_flushes() {
    // Pure VAD mode: silence always ends the utterance.
    assert!(vad_flush_allowed(false, false, false));
    // Shortcut configured, nothing transmitting: nothing to flush anyway,
    // but the pause path stays closed.
    assert!(!vad_flush_allowed(true, false, false));
    // Shortcut held: "I am not done talking" — never flush on silence,
    // regardless of the manual mic state.
    assert!(!vad_flush_allowed(true, false, true));
    assert!(!vad_flush_allowed(true, true, true));
    // Manually open mic with the shortcut up: normal VAD behavior.
    assert!(vad_flush_allowed(true, true, false));
}

// ── The fork's own, moved here by the upstream sync ──────────────────────────
//
// These were inline in stt.rs; upstream moved its tests out to this file, so
// keeping both left two `mod tests` in one module. They belong here, which is
// also where the ratchet counts test bulk separately from the code it covers.
// `has_enough_voiced_audio` is already imported at the top of this file by
// upstream's own tests; only the names the fork's tests add are pulled in
// here.
use super::{detect_family, SttFamily, SttLanguage};

/// Build a throwaway directory holding the given (empty) filenames. The
/// family check is a layout check, so empty files are exactly right — no
/// model bytes, no network, no ONNX runtime.
fn model_dir_with(names: &[&str]) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "buzz-stt-family-{}-{:?}-{}",
        std::process::id(),
        std::thread::current().id(),
        names.join("+")
    ));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("create temp model dir");
    for name in names {
        std::fs::write(dir.join(name), b"").expect("write stub file");
    }
    dir
}

#[test]
fn a_single_ctc_head_is_the_english_huddle_model() {
    let dir = model_dir_with(&["model.int8.onnx", "tokens.txt"]);
    assert!(matches!(
        detect_family(&dir),
        Some(SttFamily::NemoCtc { .. })
    ));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn an_encoder_decoder_pair_is_the_multilingual_dictation_model() {
    let dir = model_dir_with(&["encoder.int8.onnx", "decoder.int8.onnx", "tokens.txt"]);
    assert!(matches!(
        detect_family(&dir),
        Some(SttFamily::Whisper { .. })
    ));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_half_installed_directory_is_no_model_at_all() {
    // Whisper without its decoder must not be mistaken for a CTC model,
    // and a model with no tokens table is not usable either. Both cases
    // have to reach the "model not found" branch that drains and exits
    // cleanly, rather than being handed to sherpa-onnx half-configured.
    for names in [
        &["encoder.int8.onnx", "tokens.txt"][..],
        &["decoder.int8.onnx", "tokens.txt"][..],
        &["model.int8.onnx"][..],
        &[][..],
    ] {
        let dir = model_dir_with(names);
        assert!(
            detect_family(&dir).is_none(),
            "{names:?} was accepted as a complete model"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}

#[test]
fn auto_is_the_default_language_and_means_no_hint_at_all() {
    assert_eq!(SttLanguage::default(), SttLanguage::Auto);
    assert_eq!(SttLanguage::Auto.whisper_code(), None);
}

#[test]
fn the_language_hints_are_whispers_own_codes() {
    assert_eq!(SttLanguage::Turkish.whisper_code(), Some("tr"));
    assert_eq!(SttLanguage::English.whisper_code(), Some("en"));
}
