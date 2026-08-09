//! What a close request means for the workspace window
//! (vingilot/docs/plans/2026-08-09-keys-and-type.md, Task 1).
//!
//! **⌘W never reaches the webview on macOS.** Tauri installs its default
//! application menu whenever the builder sets none (tauri 2.11.5
//! src/app.rs:2243-2249), and `lib.rs` sets none — neither `.menu(…)` nor
//! `.enable_macos_default_menu(false)`. That menu carries `close_window` at ⌘W
//! twice, once under File and once under Window (tauri 2.11.5
//! src/menu/menu.rs:206-216 and 151-163). macOS resolves menu key equivalents
//! in `performKeyEquivalent:` before the webview sees the keydown, so no
//! frontend handler for ⌘W can ever run and `preventDefault()` can never
//! happen. What the menu item raises instead is `WindowEvent::CloseRequested`,
//! which arrives before anything closes — and that is the seam this module
//! decides on.
//!
//! **Why the default menu is kept rather than replaced.** The alternative was
//! a real app menu built from muda's predefined items, which would let ⌘W
//! arrive as an ordinary keydown the island resolves like every other chord.
//! Priced and declined, on two counts:
//!
//! - The same menu is where ⌘Q, ⌘C, ⌘X, ⌘V and ⌘A come from for a WKWebView.
//!   muda 0.19.3 src/items/predefined.rs:301-341 is the whole accelerator
//!   list — Copy ⌘C, Cut ⌘X, Paste ⌘V, Undo ⌘Z, Redo ⇧⌘Z, Select All ⌘A,
//!   Minimize ⌘M, Fullscreen ⌃⌘F, Hide ⌘H, Hide Others ⌥⌘H, Close Window ⌘W,
//!   Quit ⌘Q — and every predefined child carries its accelerator from
//!   construction (src/platform_impl/macos/mod.rs:374). Rebuilding that list by
//!   hand risks losing one of them, and the loss would be silent: the chord
//!   simply stops working inside a webview, with no error anywhere.
//! - It cannot be proved by a unit test. `muda::Menu::new` panics off the main
//!   thread (muda 0.19.3 src/platform_impl/macos/mod.rs:131-132) and cargo's
//!   harness runs tests on spawned threads, so no `cargo test` can construct
//!   the replacement menu, let alone read back its accelerators — muda exposes
//!   `text()` and `id()` on a predefined item and no accelerator getter at all
//!   (src/items/predefined.rs:186-198).
//!
//! Keeping the menu makes the claim structural rather than asserted: those
//! chords are tauri's and muda's, this fork adds nothing to that menu and takes
//! nothing away, and `lib_rs_leaves_the_default_macos_menu_alone` below fails
//! the build if that ever stops being true.
//!
//! **Nothing hides.** The close request used to hide the main window, which is
//! how the owner lost it: hiding leaves no thumbnail, no window in ⌘Tab and
//! nothing on screen — only the tray icon and the Dock icon, neither of which
//! reads as "your window is in here". Both ways back exist in code (the tray's
//! "Open Buzz" at tray_menu.rs:329-335 → tray_menu.rs:442 → `show_main_window`
//! at tray_menu.rs:216, and a Dock click at lib.rs's `RunEvent::Reopen` arm,
//! which tao does raise — app_delegate.rs:79 registers
//! `applicationShouldHandleReopen:hasVisibleWindows:` and :205-215 forwards it,
//! tauri-runtime-wry 2.11.4 src/lib.rs:4391-4394 turns it into `RunEvent`), and
//! he found neither. A way back that has to be looked for is not one. So this
//! window is never hidden: it either loses whatever is stacked over it, or it
//! minimizes into the Dock, where the thumbnail *is* the way back — and
//! `show_main_window` already unminimizes, so both of the paths above still
//! restore it.

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::State;

/// Emitted at the webview when a close request lands on a window that has
/// something stacked over it. Carries no payload: what is on top, and which
/// of it a close dismisses, is the frontend's model
/// (desktop/src/features/runs/lib/closeRequest.ts) — this side only knows that
/// something is there.
pub const CLOSE_REQUESTED_EVENT: &str = "vingilot://close-requested";

/// The window the app lives in. Any other window — a huddle, a future
/// inspector — closes the way its own close request asks it to.
const MAIN_WINDOW_LABEL: &str = "main";

/// Whether the webview currently has a surface that a close request should
/// dismiss instead of touching the window.
///
/// Held on the Rust side, and pushed here by the frontend on every change,
/// because the decision has to be made synchronously inside `CloseRequested`:
/// asking the webview and waiting for an answer would mean holding a native
/// close request open across an IPC round trip, and a screen that never
/// answers (a crashed webview, a route with no listener) would hang the
/// gesture rather than fall back.
///
/// The flag can be one keystroke stale in either direction. Stale-true costs a
/// ⌘W that does nothing; stale-false costs a minimize the Dock gives straight
/// back. Neither loses anything, which is what makes the trade acceptable.
#[derive(Debug, Default)]
pub struct WindowLayers {
    dismissible: AtomicBool,
}

impl WindowLayers {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn dismissible(&self) -> bool {
        self.dismissible.load(Ordering::SeqCst)
    }

    fn set_dismissible(&self, dismissible: bool) {
        self.dismissible.store(dismissible, Ordering::SeqCst);
    }
}

/// What to do with one close request.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CloseRequest {
    /// Keep the window exactly as it is and let the webview dismiss what is on
    /// top of it. This is ⌘W over the scratch shell, the palette, or a dialog.
    Dismiss,
    /// Nothing is stacked, so the request is about the window itself. Minimize
    /// it — see this module's header for why it is not hidden.
    Minimize,
    /// Not the app's window. Let it close.
    Close,
}

/// Resolves one `CloseRequested` into what should happen to the window.
///
/// Pure, so the rule is readable and testable without a window, a menu or a
/// running app — which matters here more than usual, since the gesture it
/// answers cannot be driven from a test at all.
pub fn resolve_close_request(label: &str, dismissible: bool) -> CloseRequest {
    if label != MAIN_WINDOW_LABEL {
        return CloseRequest::Close;
    }
    if dismissible {
        return CloseRequest::Dismiss;
    }
    CloseRequest::Minimize
}

/// Tells the backend whether a close request would have something to dismiss.
///
/// Called by the workspace on every change of what is stacked over it, and
/// with `false` when it unmounts — a screen that left the flag set behind it
/// would spend the owner's ⌘W on a surface that is no longer there.
#[tauri::command]
pub fn window_set_dismissible(layers: State<'_, WindowLayers>, dismissible: bool) {
    layers.set_dismissible(dismissible);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_workspace_window_with_something_on_top_loses_the_top_thing() {
        assert_eq!(
            resolve_close_request(MAIN_WINDOW_LABEL, true),
            CloseRequest::Dismiss
        );
    }

    #[test]
    fn the_workspace_window_with_nothing_on_top_minimizes_and_never_hides() {
        assert_eq!(
            resolve_close_request(MAIN_WINDOW_LABEL, false),
            CloseRequest::Minimize
        );
    }

    #[test]
    fn any_other_window_closes_whatever_is_stacked_in_the_main_one() {
        assert_eq!(resolve_close_request("huddle", false), CloseRequest::Close);
        assert_eq!(resolve_close_request("huddle", true), CloseRequest::Close);
        assert_eq!(resolve_close_request("", true), CloseRequest::Close);
    }

    #[test]
    fn the_flag_starts_false_so_a_window_nobody_claimed_still_answers_the_gesture() {
        let layers = WindowLayers::new();
        assert!(!layers.dismissible());
        layers.set_dismissible(true);
        assert!(layers.dismissible());
        layers.set_dismissible(false);
        assert!(!layers.dismissible());
    }

    /// Everything this module's header claims about ⌘Q, ⌘C, ⌘X, ⌘V and ⌘A
    /// rests on this app installing tauri's default macOS menu, which happens
    /// only while the builder sets no menu of its own (tauri 2.11.5
    /// src/app.rs:2243-2249). A `.menu(…)` or `.enable_macos_default_menu(false)`
    /// added to lib.rs would take those chords away from the webview with no
    /// error and no visible change anywhere else, so it is asserted rather
    /// than trusted. The tray builds a menu of its own; that one is
    /// `tray_menu.rs`'s and is not this file's business.
    #[test]
    fn lib_rs_leaves_the_default_macos_menu_alone() {
        const LIB_RS: &str = include_str!("../lib.rs");
        assert!(
            !LIB_RS.contains(".menu("),
            "lib.rs sets an application menu: ⌘Q/⌘C/⌘X/⌘V/⌘A now come from it \
             rather than from tauri's default, and every one of them has to be \
             put back by hand (see this module's header)"
        );
        assert!(
            !LIB_RS.contains("enable_macos_default_menu"),
            "lib.rs touches the default macOS menu: ⌘Q/⌘C/⌘X/⌘V/⌘A depend on \
             it being installed unchanged (see this module's header)"
        );
    }
}
