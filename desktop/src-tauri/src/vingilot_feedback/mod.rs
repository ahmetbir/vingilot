//! The owner's feedback, from inside the app to the drop on his own box
//! (2026-09-03: "surekli kullanmaya basladim ve feedback girmem lazim sana").
//!
//! Three commands and a rule. `feedback_configure` takes the URL and the key
//! he read off the box and keeps them in the app's secret store — the same
//! OS keyring the identity keys live in — and **nothing here ever deletes
//! them** ("deauth etme beni"): the only way out is to enter a new pair.
//! `feedback_snapshot` captures the window as it is, before any dialog is
//! over it. `feedback_send` posts text, context and the capture with the
//! bearer, from this process, so the key is entered once in the webview and
//! never read back into it.
//!
//! **The capture is `screencapture`, not a webview render.** What he wants to
//! show is usually the terminal, and that is a canvas the DOM cannot serialise
//! faithfully. The region is the window's own frame, in points; macOS asks
//! for Screen Recording the first time and, refused, hands back the wallpaper
//! rather than an error — which is why the dialog shows the shot before it
//! is sent.
//!
//! Bounded (CLAUDE.md, review rule 4): one request, 30 seconds, and the
//! service itself caps the body.

use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Command;

use base64::Engine;
use serde::{Deserialize, Serialize};

use crate::secret_store::SecretStore;

const URL_KEY: &str = "vingilot.feedback.url";
const BEARER_KEY: &str = "vingilot.feedback.key";

/// Shorter than this is not a key the drop would have generated (it makes
/// 64 hex characters), and is far more likely a paste that missed.
const MIN_KEY_LEN: usize = 32;

fn store() -> &'static SecretStore {
    SecretStore::shared(crate::app_state::keyring_service())
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct FeedbackStatus {
    /// The drop's base URL, or `None` before he has entered one.
    pub url: Option<String>,
    /// Both halves present. The key itself never leaves this side.
    pub configured: bool,
}

/// What is sent, as the drop reads it (`vingilot/feedback/main.go`).
#[derive(Debug, Serialize, PartialEq, Eq)]
struct Body<'a> {
    text: &'a str,
    context: &'a HashMap<String, String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    screenshot_png_base64: Option<&'a str>,
}

/// One base URL: `https`, no trailing slash, no query. The service's route is
/// appended here, so what he types is the address and nothing more.
fn normalize_url(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim().trim_end_matches('/');
    if !trimmed.starts_with("https://") {
        return Err("the feedback URL must start with https://".to_string());
    }
    if trimmed.len() <= "https://".len() || trimmed.contains(['?', '#', ' ']) {
        return Err("that is not a URL the feedback drop would answer at".to_string());
    }
    Ok(trimmed.to_string())
}

fn check_key(raw: &str) -> Result<String, String> {
    let key = raw.trim().to_string();
    if key.len() < MIN_KEY_LEN || !key.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err(format!(
            "the key should be the whole line from the box — at least {MIN_KEY_LEN} letters and digits"
        ));
    }
    Ok(key)
}

fn body_json(
    text: &str,
    context: &HashMap<String, String>,
    screenshot: Option<&str>,
) -> serde_json::Value {
    serde_json::to_value(Body {
        text,
        context,
        screenshot_png_base64: screenshot,
    })
    .unwrap_or(serde_json::Value::Null)
}

/// The window's frame in screen points, as `screencapture -R` wants it.
fn frame_in_points(x: i32, y: i32, width: u32, height: u32, scale: f64) -> String {
    let scale = if scale > 0.0 { scale } else { 1.0 };
    format!(
        "{},{},{},{}",
        (f64::from(x) / scale).round(),
        (f64::from(y) / scale).round(),
        (f64::from(width) / scale).round(),
        (f64::from(height) / scale).round()
    )
}

fn capture_region(region: &str) -> Result<Vec<u8>, String> {
    let path: PathBuf = std::env::temp_dir().join(format!(
        "vingilot-feedback-{}-{}.png",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    ));
    let status = Command::new("/usr/sbin/screencapture")
        .args(["-x", "-t", "png", "-R", region])
        .arg(&path)
        .status()
        .map_err(|e| format!("screencapture did not run: {e}"))?;
    let bytes = std::fs::read(&path);
    let _ = std::fs::remove_file(&path);
    if !status.success() {
        return Err(format!("screencapture exited with {status}"));
    }
    bytes.map_err(|e| format!("the capture was not written: {e}"))
}

#[tauri::command]
pub async fn feedback_status() -> Result<FeedbackStatus, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let url = store().load(URL_KEY)?;
        let key = store().load(BEARER_KEY)?;
        Ok(FeedbackStatus {
            configured: url.is_some() && key.is_some(),
            url,
        })
    })
    .await
    .map_err(|e| format!("the feedback worker did not run: {e}"))?
}

#[tauri::command]
pub async fn feedback_configure(url: String, key: String) -> Result<FeedbackStatus, String> {
    let url = normalize_url(&url)?;
    let key = check_key(&key)?;
    tauri::async_runtime::spawn_blocking(move || {
        store().store(URL_KEY, &url)?;
        store().store(BEARER_KEY, &key)?;
        Ok(FeedbackStatus {
            url: Some(url),
            configured: true,
        })
    })
    .await
    .map_err(|e| format!("the feedback worker did not run: {e}"))?
}

/// The window as it is right now, as a PNG data URL.
#[tauri::command]
pub async fn feedback_snapshot(window: tauri::Window) -> Result<String, String> {
    let pos = window
        .outer_position()
        .map_err(|e| format!("window position: {e}"))?;
    let size = window
        .outer_size()
        .map_err(|e| format!("window size: {e}"))?;
    let scale = window.scale_factor().map_err(|e| format!("scale: {e}"))?;
    let region = frame_in_points(pos.x, pos.y, size.width, size.height, scale);
    tauri::async_runtime::spawn_blocking(move || {
        let png = capture_region(&region)?;
        Ok(format!(
            "data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(png)
        ))
    })
    .await
    .map_err(|e| format!("the capture worker did not run: {e}"))?
}

#[derive(Deserialize)]
struct Made {
    id: String,
}

/// Post one report. Returns the drop's id for it.
#[tauri::command]
pub async fn feedback_send(
    text: String,
    context: HashMap<String, String>,
    screenshot: Option<String>,
) -> Result<String, String> {
    let (url, key) = tauri::async_runtime::spawn_blocking(|| {
        let url = store().load(URL_KEY)?;
        let key = store().load(BEARER_KEY)?;
        match (url, key) {
            (Some(url), Some(key)) => Ok((url, key)),
            _ => Err("the feedback drop is not set up yet".to_string()),
        }
    })
    .await
    .map_err(|e| format!("the feedback worker did not run: {e}"))??;

    let shot = screenshot
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty());
    let body = body_json(&text, &context, shot);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("http client: {e}"))?;
    let response = client
        .post(format!("{url}/v1/feedback"))
        .bearer_auth(key)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("the drop did not answer: {e}"))?;
    let status = response.status();
    if status == reqwest::StatusCode::UNAUTHORIZED {
        return Err("the drop refused the key — enter it again from the box".to_string());
    }
    if !status.is_success() {
        let detail = response.text().await.unwrap_or_default();
        return Err(format!("the drop answered {status}: {}", detail.trim()));
    }
    let made: Made = response
        .json()
        .await
        .map_err(|e| format!("the drop's answer was not what it promises: {e}"))?;
    Ok(made.id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_url_is_https_with_nothing_trailing() {
        assert_eq!(
            normalize_url(" https://buzz.ahmetbirinci.dev/feedback/ ").unwrap(),
            "https://buzz.ahmetbirinci.dev/feedback"
        );
        assert!(normalize_url("http://buzz.ahmetbirinci.dev/feedback").is_err());
        assert!(normalize_url("https://").is_err());
        assert!(normalize_url("https://x.dev/feedback?x=1").is_err());
    }

    #[test]
    fn a_key_is_the_whole_line_from_the_box() {
        let hex = "0123456789abcdef".repeat(4);
        assert_eq!(check_key(&format!(" {hex}\n")).unwrap(), hex);
        assert!(check_key("short").is_err());
        assert!(check_key(&"a b".repeat(20)).is_err());
    }

    #[test]
    fn the_body_is_what_the_drop_reads() {
        let mut ctx = HashMap::new();
        ctx.insert("route".to_string(), "#/workspace".to_string());
        let with = body_json("tab isimleri", &ctx, Some("data:image/png;base64,AAAA"));
        assert_eq!(with["text"], "tab isimleri");
        assert_eq!(with["context"]["route"], "#/workspace");
        assert_eq!(with["screenshot_png_base64"], "data:image/png;base64,AAAA");
        let without = body_json("x", &ctx, None);
        assert!(without.get("screenshot_png_base64").is_none());
    }

    #[test]
    fn the_frame_is_points_not_pixels() {
        // A Retina window at physical (200, 100) sized 2400×1600 is at
        // (100, 50) sized 1200×800 in the points screencapture wants.
        assert_eq!(
            frame_in_points(200, 100, 2400, 1600, 2.0),
            "100,50,1200,800"
        );
        // A negative origin is a second display to the left; it stays negative.
        assert_eq!(
            frame_in_points(-1440, 0, 1440, 900, 1.0),
            "-1440,0,1440,900"
        );
        // A zero scale is a broken reading, not a division.
        assert_eq!(frame_in_points(10, 10, 10, 10, 0.0), "10,10,10,10");
    }
}
