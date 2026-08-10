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
//! away. The result is 1,760 bytes in the binary.

use tauri::image::Image;

/// Raw 8-bit alpha, row-major, no header. Regenerate with
/// `python3 vingilot/brand/derive-mark.py`.
const TRAY_ALPHA: &[u8] = include_bytes!("tray-mark.gray");

/// Menu-bar height in pixels. 44 is 22pt at 2x — the macOS menu bar's own
/// height, and the same budget upstream's 43px-tall bee uses. Below roughly
/// 32px the mark's sails stop separating, so this is a floor, not a preference.
const TRAY_HEIGHT: u32 = 44;

/// Width follows from the asset rather than being asserted separately, so a
/// re-derivation that changes the mark's proportions cannot stretch it.
const TRAY_WIDTH: u32 = (TRAY_ALPHA.len() / TRAY_HEIGHT as usize) as u32;

/// A half-written or wrong-height asset would otherwise reach `Image` as a
/// buffer whose length disagrees with its dimensions, and the failure would
/// surface as a garbled tray icon at runtime instead of a build error.
const _: () = assert!(
    TRAY_ALPHA.len() == (TRAY_WIDTH * TRAY_HEIGHT) as usize,
    "tray-mark.gray length is not a whole number of 44-pixel rows"
);

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
    /// from a correct file by size alone, so assert the ink instead: the
    /// committed asset covers about a fifth of its box.
    #[test]
    fn tray_mark_carries_a_legible_amount_of_ink() {
        let opaque = TRAY_ALPHA.iter().filter(|&&a| a > 128).count();
        let coverage = opaque as f32 / TRAY_ALPHA.len() as f32;
        assert!(
            (0.10..0.45).contains(&coverage),
            "tray mark covers {coverage:.3} of its box; expected roughly a fifth"
        );
    }

    /// The colour channels must stay zero. macOS ignores them for a template
    /// image, but Windows and Linux do not use template images at all — a
    /// non-zero colour here would ship a black-on-black tray icon there.
    #[test]
    fn tray_mark_leaves_colour_channels_black() {
        let icon = tray_mark_icon();
        let rgba = icon.rgba();
        assert!(rgba.chunks_exact(4).all(|px| px[..3] == [0, 0, 0]));
    }
}
