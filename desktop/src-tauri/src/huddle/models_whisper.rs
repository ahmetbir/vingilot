//! The **multilingual** dictation model: OpenAI Whisper `small`, int8, in the
//! sherpa-onnx ONNX packaging — downloaded on demand into
//! `~/.buzz/models/whisper-small-multilingual/`.
//!
//! ## Why this exists next to the English model, not instead of it
//!
//! Two surfaces run the same `huddle::stt::SttPipeline` and each picks its own
//! model, because they are not the same problem:
//!
//! * **Huddle transcription** keeps NVIDIA Parakeet TDT-CTC 110M (English).
//!   Its CTC blank-token decoding cannot hallucinate text out of silence or a
//!   cut-off chunk, which is exactly the failure mode that matters when a
//!   whole room's open microphones are being transcribed into a channel other
//!   members read. See `models.rs`'s `STT_DOWNLOAD_URL` doc comment — that
//!   trade-off is deliberate and this module does not touch it.
//! * **Dictation** (`crate::dictation`) uses the model in this file. It is
//!   one person, deliberately holding a mic to fill their own draft, and the
//!   owner speaks Turkish. Parakeet is English-only, so on that surface the
//!   English model is not "slightly worse" — it is the wrong model. Whisper
//!   is an encoder-decoder and *can* hallucinate on silence; the dictation
//!   pipeline's VAD gate (`MIN_VOICED_FRAMES` in `huddle::stt`) is the
//!   existing mitigation, and a hallucinated word in a draft the owner is
//!   looking at is a typo to delete, not a message other people already read.
//!
//! ## Discipline
//!
//! Same contract as every other model in `models.rs`: pinned URLs (repo +
//! immutable revision), pinned SHA-256 and byte size per file, a size ceiling
//! enforced while streaming, an expected-files list, a version manifest, an
//! atomic install, and the licence sidecar written next to the bytes so the
//! attribution travels if the directory is copied.
//!
//! Unlike the Parakeet slot this downloads individual files rather than a
//! tarball, following the Pocket TTS path in `models.rs`. The sherpa-onnx
//! GitHub release tarball also carries the fp32 encoder/decoder (~1 GB extra)
//! that we would immediately throw away; the HuggingFace repo lets us fetch
//! only the int8 pair, and its Git-LFS metadata publishes the SHA-256 of each
//! file, so the hashes below were read rather than guessed.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

// `super` is `huddle::models` — this file is that module's `#[path]` child, the
// same shape `models_voice_upgrade.rs` uses. That is what lets the download
// reuse the manager's private machinery (`ModelSlot`'s atomic install, the
// streaming size guard, the hash helper) instead of copying it.
use super::{download_file, fetch_url, fresh_temp_dir, sha256_file, ModelSlot, ModelStatus};

// ── The one constant that is easy to move ─────────────────────────────────────

/// One file in the release: what it is called upstream, what we install it as,
/// and the two numbers that make the download verifiable.
///
/// `local` deliberately drops the upstream size prefix (`small-encoder…` →
/// `encoder.int8.onnx`) so that `huddle::stt` never learns which Whisper size
/// is on disk — the same trick `models.rs` plays when it installs the Pocket
/// reference voice as `reference_sample.wav`. Changing [`WHISPER`] below to a
/// different size therefore does not ripple into the pipeline.
#[derive(Clone, Copy, Debug)]
pub struct WhisperArtifact {
    /// Filename in the upstream HuggingFace repo.
    pub remote: &'static str,
    /// Filename we install it under, inside the model directory.
    pub local: &'static str,
    /// SHA-256 of the file contents, lowercase hex.
    pub sha256: &'static str,
    /// Exact byte size. Both are checked after download, before install.
    pub size_bytes: u64,
}

/// A pinned sherpa-onnx Whisper packaging.
#[derive(Clone, Copy, Debug)]
pub struct WhisperRelease {
    /// Whisper checkpoint size — `"tiny"`, `"base"`, `"small"`, `"medium"`.
    pub size: &'static str,
    /// HuggingFace repo id holding the sherpa-onnx ONNX export.
    pub repo: &'static str,
    /// Immutable commit the files are fetched from.
    pub revision: &'static str,
    /// Encoder, decoder and token table, in download order.
    pub artifacts: &'static [WhisperArtifact],
}

/// **Whisper `small`, multilingual, int8 — 375,485,327 bytes (358.1 MiB).**
///
/// Sizes and SHA-256 hashes below were read on 2026-09-01 from the
/// HuggingFace file metadata for this exact revision (the Git-LFS `oid` of a
/// HuggingFace LFS file *is* its SHA-256); `small-tokens.txt` is not an LFS
/// file, so its hash was computed with `shasum -a 256` on the downloaded file.
/// They are not estimates. To re-derive them:
///
/// ```text
/// curl -s https://huggingface.co/api/models/<repo>/tree/main   # size + lfs.oid
/// ```
///
/// ### Why `small` and not something smaller
///
/// Whisper is the only family sherpa-onnx packages that covers Turkish at all
/// (SenseVoice is zh/en/ja/ko/yue, Canary is four European languages, Parakeet
/// is English) — `"tr": "turkish"` is in Whisper's own language table
/// (`openai/whisper`, `whisper/tokenizer.py`). Within Whisper, quality on
/// non-English languages scales steeply with checkpoint size, and the same
/// int8 export at the smaller sizes costs little disk by comparison:
///
/// | size   | params | encoder+decoder+tokens, int8 |
/// |--------|--------|------------------------------|
/// | tiny   |  39 M  |   103,609,903 B  ( 98.8 MiB) |
/// | base   |  74 M  |   160,609,290 B  (153.2 MiB) |
/// | small  | 244 M  |   375,485,327 B  (358.1 MiB) |
/// | medium | 769 M  |   946,072,270 B  (902.2 MiB) |
///
/// `small` is the pick: it is the smallest checkpoint that is commonly used
/// for Turkish rather than as a demo, and `medium` is a ~2.5× bigger download
/// and a ~3× slower decode on the single ONNX thread this pipeline runs
/// (`STT_NUM_THREADS` in `huddle::stt`), which on a dictation surface is felt
/// directly as lag between finishing a sentence and seeing it.
///
/// **Not measured here:** nobody has run Turkish audio through tiny/base/small
/// on this machine and compared word error rates, so this file states no WER
/// number. If `small` turns out to be more model than the owner needs, moving
/// down is editing this one constant — swap `size`, `repo`, `revision` and the
/// three artifacts (re-read from the command above), then bump
/// [`MODEL_VERSION`] so existing installs re-download.
const WHISPER: WhisperRelease = WhisperRelease {
    size: "small",
    repo: "csukuangfj/sherpa-onnx-whisper-small",
    revision: "8f3c18b358db4d1f2fc1eae49d75cd20989e4309",
    artifacts: &[
        WhisperArtifact {
            remote: "small-encoder.int8.onnx",
            local: "encoder.int8.onnx",
            sha256: "4cbe7b22fa9026b843b60a68640c747de05bafb1a11b57edc0e66c232d9f33a9",
            size_bytes: 112_442_483,
        },
        WhisperArtifact {
            remote: "small-decoder.int8.onnx",
            local: "decoder.int8.onnx",
            sha256: "acad50b5c782696e91b55914cc5ab4f756f1532f76e22aa6fc615f39fb69a8ee",
            size_bytes: 262_226_114,
        },
        WhisperArtifact {
            remote: "small-tokens.txt",
            local: "tokens.txt",
            sha256: "b34b360dbb493e781e479794586d661700670d65564001f23024971d1f2fa126",
            size_bytes: 816_730,
        },
    ],
};

/// Total bytes the download costs, for anything that wants to say so out loud.
/// Kept as a function rather than a constant so it can never drift from
/// [`WHISPER`] — a stale "≈100 MB" sentence in a tooltip is exactly the kind
/// of small lie this module is trying not to tell.
pub fn total_download_bytes() -> u64 {
    WHISPER
        .artifacts
        .iter()
        .map(|artifact| artifact.size_bytes)
        .sum()
}

// ── On-disk layout ────────────────────────────────────────────────────────────

/// Final directory name under `~/.buzz/models/`. Carries the size so a future
/// change of [`WHISPER`] is visible on disk instead of silently reusing a
/// directory full of different weights.
const MODEL_DIR_NAME: &str = "whisper-small-multilingual";

/// Manifest version. Bump whenever [`WHISPER`] changes.
const MODEL_VERSION: &str = "1";

/// Attribution sidecar written next to the model bytes.
const LICENSE_FILE_NAME: &str = "MODEL_LICENSE.txt";

/// Everything that must be on disk for the model to count as ready — the three
/// downloaded files plus the licence sidecar. The sidecar is in the readiness
/// list on purpose (same as Parakeet's): the upstream repo ships no licence
/// file, so if the attribution is missing the install is not finished.
const EXPECTED_FILES: &[&str] = &[
    "encoder.int8.onnx",
    "decoder.int8.onnx",
    "tokens.txt",
    LICENSE_FILE_NAME,
];

/// Streaming size ceiling per file, checked against `Content-Length` and again
/// on every chunk. Comfortably above the largest pinned artifact (the 262 MB
/// decoder) and comfortably below anything that would fill a disk. Move it if
/// [`WHISPER`] moves up a size.
const MAX_FILE_BYTES: u64 = 320 * 1024 * 1024;

/// MIT §"The above copyright notice and this permission notice shall be
/// included in all copies or substantial portions of the Software" — so the
/// full licence text travels with the weights, not just a pointer to it.
///
/// This is **not** the Parakeet notice: Parakeet is NVIDIA's, CC-BY-4.0, and
/// its attribution belongs only next to Parakeet's bytes. Whisper's weights
/// and code are OpenAI's under MIT; the ONNX conversion that is actually
/// downloaded here is k2-fsa's work under Apache-2.0. Both are named.
const LICENSE_TEXT: &str = "\
OpenAI Whisper small (multilingual speech recognition)
Copyright (c) 2022 OpenAI

Original model: https://huggingface.co/openai/whisper-small
Model weights and code are licensed under the MIT License, reproduced in full
below (https://github.com/openai/whisper/blob/main/LICENSE).

The files in this directory are the ONNX export of that model, with int8
quantization, produced and redistributed by the sherpa-onnx project
(https://github.com/k2-fsa/sherpa-onnx), which is licensed under the Apache
License, Version 2.0 (http://www.apache.org/licenses/LICENSE-2.0). Buzz
downloads that conversion unmodified from
https://huggingface.co/csukuangfj/sherpa-onnx-whisper-small and only renames
the files (dropping the `small-` prefix).

--------------------------------------------------------------------------------

MIT License

Copyright (c) 2022 OpenAI

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the \"Software\"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
";

/// Pinned download URL for one artifact. `resolve/<revision>` — never
/// `resolve/main`, so the bytes cannot change under the pinned hashes.
fn artifact_url(artifact: &WhisperArtifact) -> String {
    format!(
        "https://huggingface.co/{}/resolve/{}/{}",
        WHISPER.repo, WHISPER.revision, artifact.remote
    )
}

/// Byte size a locally installed file must have. `None` for the sidecar — we
/// write that one, and pinning its length would turn a comment fix into a
/// forced 358 MB re-download.
fn expected_size(filename: &str) -> Option<u64> {
    WHISPER
        .artifacts
        .iter()
        .find(|artifact| artifact.local == filename)
        .map(|artifact| artifact.size_bytes)
}

// ── Manager ───────────────────────────────────────────────────────────────────

/// Download/readiness manager for the dictation model.
///
/// A separate manager from `models::ModelManager` rather than a third slot on
/// it: the huddle's two models are downloaded together at app launch, this one
/// is fetched only when someone actually presses the mic, and 358 MB is not a
/// cost to pay for a feature the user may never open. Keeping it separate also
/// keeps the huddle's status shape unchanged.
pub struct DictationModel {
    models_dir: PathBuf,
    slot: ModelSlot,
}

impl DictationModel {
    /// Rooted at `~/.buzz/models/`. `None` if the home directory is unknown.
    fn new() -> Option<Self> {
        let models_dir = dirs::home_dir()?.join(".buzz").join("models");
        let model = Self {
            slot: ModelSlot::new(MODEL_DIR_NAME, EXPECTED_FILES, MODEL_VERSION)
                .with_expected_sizes(expected_size),
            models_dir,
        };
        model.slot.recover_interrupted_install(&model.models_dir);
        Some(model)
    }

    /// Path to the model directory, or `None` if it is not fully installed.
    pub fn model_dir(&self) -> Option<PathBuf> {
        self.slot.dir_if_ready(&self.models_dir)
    }

    /// `true` when every expected file is present at its pinned size and the
    /// manifest version matches.
    pub fn is_ready(&self) -> bool {
        self.slot.is_ready(&self.models_dir)
    }

    /// Absent, downloading (with percent), ready, or failed — the four states
    /// the dictation button has to be able to say out loud.
    pub fn status(&self) -> ModelStatus {
        self.slot.status()
    }

    /// Start a background download. No-op if already ready or in flight.
    pub fn start_download(&self, http_client: reqwest::Client) {
        let models_dir = self.models_dir.clone();
        let slot = self.slot.clone();
        self.slot.start_download(
            &self.models_dir,
            http_client,
            "dictation whisper",
            move |client| async move { download(&models_dir, &slot, client).await },
        );
    }
}

/// Fetch every artifact into a temp directory, verify size **and** hash, write
/// the licence sidecar, then hand the directory to `ModelSlot`'s atomic
/// install. A free function rather than a method so the download task owns
/// clones of exactly what it needs and nothing else.
async fn download(
    models_dir: &Path,
    slot: &ModelSlot,
    http_client: reqwest::Client,
) -> Result<(), String> {
    tokio::fs::create_dir_all(models_dir)
        .await
        .map_err(|e| format!("create models dir: {e}"))?;

    let temp_dir = models_dir.join(format!("{MODEL_DIR_NAME}.tmp"));
    fresh_temp_dir(&temp_dir).await?;

    let total_files = WHISPER.artifacts.len() as u32;
    for (index, artifact) in WHISPER.artifacts.iter().enumerate() {
        let url = artifact_url(artifact);
        eprintln!(
            "buzz-desktop: downloading dictation model (whisper {}, file {}/{total_files}, \
             {} bytes total) {url}",
            WHISPER.size,
            index + 1,
            total_download_bytes()
        );

        let response = fetch_url(&http_client, &url, artifact.local)
            .await
            .inspect_err(|_| {
                let _ = std::fs::remove_dir_all(&temp_dir);
            })?;

        let dest = temp_dir.join(artifact.local);
        let progress_slot = slot.clone();
        let file_index = index as u32;
        let bytes = download_file(
            response,
            &dest,
            MAX_FILE_BYTES,
            artifact.local,
            |downloaded, content_length| {
                if let Some(total) = content_length.filter(|total| *total > 0) {
                    let file_fraction = downloaded as f64 / total as f64;
                    let base = (file_index as f64 / total_files as f64) * 89.0;
                    let span = 89.0 / total_files as f64;
                    progress_slot.set_status(ModelStatus::Downloading {
                        progress_percent: (base + span * file_fraction).min(89.0) as u8,
                    });
                }
            },
        )
        .await
        .inspect_err(|_| {
            let _ = std::fs::remove_dir_all(&temp_dir);
        })?;

        if bytes != artifact.size_bytes {
            let _ = tokio::fs::remove_dir_all(&temp_dir).await;
            return Err(format!(
                "dictation model {} size check failed: expected {} bytes, got {bytes}",
                artifact.local, artifact.size_bytes
            ));
        }
        let actual = sha256_file(&dest).await?;
        if actual != artifact.sha256 {
            let _ = tokio::fs::remove_dir_all(&temp_dir).await;
            return Err(format!(
                "dictation model {} integrity check failed: expected {}, got {actual}",
                artifact.local, artifact.sha256
            ));
        }

        // Keep progress honest even for a response with no Content-Length.
        slot.set_status(ModelStatus::Downloading {
            progress_percent: (((index as u32 + 1) * 89) / total_files).min(89) as u8,
        });
    }

    // Written before the atomic install so the attribution lands in the final
    // directory as part of the same rename — never a window where the weights
    // exist without their licence.
    tokio::fs::write(temp_dir.join(LICENSE_FILE_NAME), LICENSE_TEXT)
        .await
        .map_err(|e| format!("write dictation model license sidecar: {e}"))?;

    slot.set_status(ModelStatus::Downloading {
        progress_percent: 90,
    });

    if let Err(e) = slot.verify_and_install(models_dir, &temp_dir, None).await {
        let _ = tokio::fs::remove_dir_all(&temp_dir).await;
        return Err(e);
    }

    eprintln!(
        "buzz-desktop: dictation model ready at {}",
        models_dir.join(MODEL_DIR_NAME).display()
    );
    Ok(())
}

// ── Process-global singleton ──────────────────────────────────────────────────

static GLOBAL_DICTATION_MODEL: OnceLock<Option<DictationModel>> = OnceLock::new();

/// The process-global dictation model manager, mirroring
/// `models::global_model_manager`.
pub fn global() -> Option<&'static DictationModel> {
    GLOBAL_DICTATION_MODEL
        .get_or_init(DictationModel::new)
        .as_ref()
}

/// Path to the installed dictation model directory, or `None`.
pub fn model_dir() -> Option<PathBuf> {
    global()?.model_dir()
}

/// `true` if the dictation model is fully installed.
pub fn is_ready() -> bool {
    global().map(|m| m.is_ready()).unwrap_or(false)
}

/// Current download status. Reports an error rather than a silent
/// `NotDownloaded` when the manager itself is unavailable, so the mic button
/// never shows "not downloaded" for a condition no download can fix.
pub fn status() -> ModelStatus {
    match global() {
        Some(model) => model.status(),
        None => ModelStatus::Error(
            "model manager unavailable (home directory could not be resolved)".to_string(),
        ),
    }
}

#[cfg(test)]
#[path = "models_whisper_tests.rs"]
mod tests;
