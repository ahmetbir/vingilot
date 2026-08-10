//! The Vingilot mark as a macOS menu-bar template image.
//!
//! The Dock icon and the menu-bar icon are different problems. The Dock icon is
//! a rounded plate with its own background; dropping that plate into the menu
//! bar puts a dark tile among monochrome glyphs. macOS solves this with
//! *template images*: it reads the alpha channel, discards the colour, and
//! tints the result for the current menu bar. Upstream's `tray_bee_icon` does
//! exactly that, rasterising the bee from the same geometry `BuzzMark` draws.
//!
//! The Vingilot mark has no vector form to rasterise — it starts as the owner's
//! painting — so the alpha plane is derived offline by
//! `vingilot/brand/derive-mark.py` and embedded here. Only alpha is stored:
//! colour channels would be three quarters of the bytes and macOS throws them
//! away. The result is 40 wide by 44 tall — 1,760 bytes in the binary.

use std::sync::OnceLock;

use base64::Engine as _;
use tauri::image::Image;

/// Raw 8-bit alpha, row-major, no header. Regenerate with
/// `python3 vingilot/brand/derive-mark.py`.
const TRAY_ALPHA: &[u8] = include_bytes!("tray-mark.gray");

/// Menu-bar height in pixels. 44 is 22pt at 2x — the macOS menu bar's own
/// height, and the same budget upstream's 43px-tall bee uses. Below roughly
/// 32px the mark's sails stop separating, so this is a floor, not a preference.
const TRAY_HEIGHT: u32 = 44;

/// Width follows from the asset rather than being asserted separately, so a
/// re-derivation that changes the mark's proportions cannot stretch it. The
/// committed asset is 1,760 bytes, so this is 40.
const TRAY_WIDTH: u32 = (TRAY_ALPHA.len() / TRAY_HEIGHT as usize) as u32;

/// A half-written or wrong-height asset would otherwise reach `Image` as a
/// buffer whose length disagrees with its dimensions, and the failure would
/// surface as a garbled tray icon at runtime instead of a build error.
const _: () = assert!(
    TRAY_ALPHA.len() == (TRAY_WIDTH * TRAY_HEIGHT) as usize,
    "tray-mark.gray length is not a whole number of 44-pixel columns"
);

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

/// The mark as an RGBA image whose colour channels are zero, ready for
/// `TrayIconBuilder::icon` with `icon_as_template(true)`.
pub(crate) fn tray_mark_icon() -> Image<'static> {
    let mut rgba = vec![0u8; TRAY_ALPHA.len() * 4];
    for (pixel, &alpha) in TRAY_ALPHA.iter().enumerate() {
        rgba[pixel * 4 + 3] = alpha;
    }
    Image::new_owned(rgba, TRAY_WIDTH, TRAY_HEIGHT)
}

#[cfg(test)]
mod tests {
    use super::{tray_mark_icon, TRAY_ALPHA, TRAY_HEIGHT, TRAY_WIDTH};

    #[test]
    fn tray_mark_is_a_portrait_menu_bar_image() {
        let icon = tray_mark_icon();
        assert_eq!(icon.height(), TRAY_HEIGHT);
        assert_eq!(icon.width(), TRAY_WIDTH);
        assert_eq!(icon.rgba().len(), (TRAY_WIDTH * TRAY_HEIGHT * 4) as usize);
    }

    /// A mark that is mostly transparent is invisible in the menu bar, and a
    /// mark that is mostly opaque is a solid block. Both are indistinguishable
    /// from a correct file by size alone, so assert the ink instead: measured
    /// on the committed asset, 0.302 of its pixels are more than half opaque.
    /// The band is wide because it guards the two failures that are worth
    /// catching — a nearly empty file and a solid block — not the third
    /// decimal of a re-derivation.
    #[test]
    fn tray_mark_carries_a_legible_amount_of_ink() {
        let opaque = TRAY_ALPHA.iter().filter(|&&a| a > 128).count();
        let coverage = opaque as f32 / TRAY_ALPHA.len() as f32;
        assert!(
            (0.10..0.45).contains(&coverage),
            "tray mark covers {coverage:.3} of its box; expected roughly 0.3"
        );
    }

    /// The colour channels must stay zero. macOS reads only alpha from a
    /// template image, so a wrong colour here changes nothing on the surface
    /// this module ships to — which is exactly why it needs a test. The asset
    /// on disk holds alpha alone and the RGB planes are synthesized above; the
    /// day this image is drawn untemplated (`icon_as_template(false)`, a window
    /// or notification icon) a leaked synthesis paints the mark in whatever
    /// colour got in.
    #[test]
    fn tray_mark_leaves_colour_channels_black() {
        let icon = tray_mark_icon();
        let rgba = icon.rgba();
        assert!(rgba.chunks_exact(4).all(|px| px[..3] == [0, 0, 0]));
    }
}
