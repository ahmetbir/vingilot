//! The Vingilot mark, for the two native surfaces that need it as bytes.
//!
//! Two surfaces, two platforms. The menu-bar icon is macOS-only and lives in
//! [`tray`]; the Builderlab OAuth callback page is served on every platform the
//! app builds for, so [`mark_data_uri`] must exist on every one of them.
//!
//! That split is why this module is no longer gated to macOS as a whole. It was,
//! and `builderlab.rs` — which is not gated at all — called into it, so the
//! Linux build failed to find a module it could see in the source. The gate now
//! sits on the half that is genuinely macOS-only.

use std::sync::OnceLock;

use base64::Engine as _;

#[cfg(target_os = "macos")]
mod tray;

#[cfg(target_os = "macos")]
pub(crate) use tray::tray_mark_icon;

/// The same mark asset the frontend masks with, reached across the tree rather
/// than copied beside this file.
///
/// `vingilot/brand/derive-mark.py` writes each output straight to the one place
/// that consumes it, precisely so no second copy can drift from the derivation.
/// A duplicate here would be that second copy. The path is long; the alternative
/// is an asset that silently stops matching the app's own mark.
const MARK_PNG: &[u8] = include_bytes!("../../../src/features/vingilot-brand/mark.png");

/// The mark as a `data:` URI, for the one surface that is a web page this app
/// serves but does not bundle: the Builderlab OAuth callback, rendered in the
/// user's *browser* from a string in this binary. Nothing in that page can
/// fetch from the app, so the mark has to travel inside the HTML.
///
/// Encoded once and cached. The page is shown at most once per sign-in, so
/// paying ~61 KB of base64 on first use beats holding it in the binary twice.
pub(crate) fn mark_data_uri() -> &'static str {
    static ENCODED: OnceLock<String> = OnceLock::new();
    ENCODED.get_or_init(|| {
        format!(
            "data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(MARK_PNG)
        )
    })
}
