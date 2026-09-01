//! Offline contract tests for the dictation model manager.
//!
//! **Nothing here touches the network.** These assert the *manager's* pinned
//! contract — that the constants agree with each other, that the licence
//! travels with the bytes, that URLs are pinned to an immutable revision — not
//! that a 358 MB download succeeds. Reaching for the real files would make the
//! suite slow, flaky and dependent on someone else's uptime, and would prove
//! nothing about the code in this repo that these assertions don't.

use super::{
    artifact_url, expected_size, total_download_bytes, EXPECTED_FILES, LICENSE_FILE_NAME,
    LICENSE_TEXT, MAX_FILE_BYTES, MODEL_DIR_NAME, WHISPER,
};

#[test]
fn every_downloaded_artifact_is_required_before_the_model_counts_as_ready() {
    for artifact in WHISPER.artifacts {
        assert!(
            EXPECTED_FILES.contains(&artifact.local),
            "{} is downloaded but not required for readiness",
            artifact.local
        );
    }
}

#[test]
fn the_licence_sidecar_is_part_of_readiness() {
    // The upstream repo ships no licence file. If the sidecar were not in the
    // readiness list, a directory of weights with no attribution would count
    // as a finished install.
    assert!(EXPECTED_FILES.contains(&LICENSE_FILE_NAME));
}

#[test]
fn readiness_requires_exactly_the_artifacts_plus_the_sidecar() {
    assert_eq!(EXPECTED_FILES.len(), WHISPER.artifacts.len() + 1);
}

#[test]
fn each_artifact_pins_a_hash_and_a_size() {
    for artifact in WHISPER.artifacts {
        assert_eq!(
            artifact.sha256.len(),
            64,
            "{} sha256 is not a 64-char hex digest",
            artifact.local
        );
        assert!(
            artifact.sha256.chars().all(|c| c.is_ascii_hexdigit()),
            "{} sha256 is not hex",
            artifact.local
        );
        assert!(artifact.size_bytes > 0, "{} has no size", artifact.local);
    }
}

#[test]
fn the_size_ceiling_admits_every_artifact_and_nothing_absurd() {
    let largest = WHISPER
        .artifacts
        .iter()
        .map(|artifact| artifact.size_bytes)
        .max()
        .expect("release has artifacts");
    assert!(
        MAX_FILE_BYTES >= largest,
        "ceiling {MAX_FILE_BYTES} rejects the largest pinned artifact ({largest})"
    );
    // Both sides are constants, so this is settled at compile time rather than
    // when the test runs — a ceiling raised past a gigabyte fails the build.
    const { assert!(MAX_FILE_BYTES < 1024 * 1024 * 1024) };
}

#[test]
fn expected_sizes_cover_the_artifacts_but_not_the_sidecar() {
    for artifact in WHISPER.artifacts {
        assert_eq!(expected_size(artifact.local), Some(artifact.size_bytes));
    }
    // We write the sidecar ourselves; pinning its length would turn a comment
    // fix into a forced re-download of the whole model.
    assert_eq!(expected_size(LICENSE_FILE_NAME), None);
}

#[test]
fn the_advertised_download_size_is_the_sum_of_the_pinned_sizes() {
    assert_eq!(total_download_bytes(), 375_485_327);
    let summed: u64 = WHISPER
        .artifacts
        .iter()
        .map(|artifact| artifact.size_bytes)
        .sum();
    assert_eq!(total_download_bytes(), summed);
}

#[test]
fn urls_are_https_and_pinned_to_an_immutable_revision() {
    assert_eq!(
        WHISPER.revision.len(),
        40,
        "revision is not a full commit sha"
    );
    for artifact in WHISPER.artifacts {
        let url = artifact_url(artifact);
        assert!(url.starts_with("https://"), "{url} is not https");
        assert!(
            url.contains(&format!("/resolve/{}/", WHISPER.revision)),
            "{url} is not pinned to the pinned revision"
        );
        assert!(
            !url.contains("/resolve/main/"),
            "{url} follows a moving branch"
        );
        assert!(url.ends_with(artifact.remote));
    }
}

#[test]
fn the_licence_is_whispers_own_and_not_parakeets() {
    // Parakeet is NVIDIA's under CC-BY-4.0 and its notice lives next to
    // Parakeet's bytes. Copying that text here would be a false attribution.
    assert!(LICENSE_TEXT.contains("MIT License"));
    assert!(LICENSE_TEXT.contains("Copyright (c) 2022 OpenAI"));
    assert!(!LICENSE_TEXT.contains("CC-BY"));
    assert!(!LICENSE_TEXT.to_lowercase().contains("nvidia"));
    assert!(!LICENSE_TEXT.to_lowercase().contains("parakeet"));
}

#[test]
fn the_licence_carries_the_full_mit_grant_not_just_a_link() {
    // MIT requires the permission notice itself to travel with the copies.
    assert!(LICENSE_TEXT.contains("Permission is hereby granted, free of charge"));
    assert!(LICENSE_TEXT.contains(
        "The above copyright notice and this permission notice shall be included in all"
    ));
    assert!(LICENSE_TEXT.contains("WITHOUT WARRANTY OF ANY KIND"));
}

#[test]
fn the_licence_also_credits_the_onnx_conversion() {
    // The bytes actually downloaded are k2-fsa's export, Apache-2.0 — naming
    // only OpenAI would under-credit whoever did the conversion.
    assert!(LICENSE_TEXT.contains("sherpa-onnx"));
    assert!(LICENSE_TEXT.contains("Apache"));
    assert!(LICENSE_TEXT.contains(WHISPER.repo));
}

#[test]
fn the_install_directory_names_the_checkpoint_it_holds() {
    // A future move of WHISPER must change the directory too, so a stale
    // install of a different size can never masquerade as this one.
    assert!(MODEL_DIR_NAME.contains(WHISPER.size));
    assert!(MODEL_DIR_NAME.contains("whisper"));
}

#[test]
fn installed_filenames_drop_the_size_prefix_so_the_pipeline_stays_size_agnostic() {
    for artifact in WHISPER.artifacts {
        assert!(
            artifact.remote.starts_with(WHISPER.size),
            "{} does not look like an upstream {} filename",
            artifact.remote,
            WHISPER.size
        );
        assert!(
            !artifact.local.contains(WHISPER.size),
            "{} leaks the checkpoint size into the model directory",
            artifact.local
        );
    }
}

#[test]
fn an_empty_directory_is_never_ready() {
    let dir = std::env::temp_dir().join(format!(
        "buzz-whisper-contract-{}-{:?}",
        std::process::id(),
        std::thread::current().id()
    ));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("create temp dir");

    let slot = super::ModelSlot::new(MODEL_DIR_NAME, EXPECTED_FILES, super::MODEL_VERSION)
        .with_expected_sizes(expected_size);
    assert!(!slot.is_ready(&dir));
    assert!(slot.dir_if_ready(&dir).is_none());

    // Even with the files present, a wrong-sized artifact is not ready — the
    // pinned sizes are load-bearing, not decorative.
    let model_dir = dir.join(MODEL_DIR_NAME);
    std::fs::create_dir_all(&model_dir).expect("create model dir");
    for name in EXPECTED_FILES {
        std::fs::write(model_dir.join(name), b"not the real bytes").expect("write stub");
    }
    std::fs::write(model_dir.join(".buzz-model-manifest"), super::MODEL_VERSION)
        .expect("write manifest");
    assert!(
        !slot.is_ready(&dir),
        "stub files passed the pinned-size check"
    );

    let _ = std::fs::remove_dir_all(&dir);
}
