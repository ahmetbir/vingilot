//! A bounded, oldest-first scrollback ring for one PTY session.
//!
//! It exists for exactly one moment: a fresh `XTerm` attaching to a session
//! that is already running. `pty_open` refuses to spawn a second shell for a
//! live session (correctly), but without a record of what the screen held,
//! the newly attached view renders blank until the shell happens to emit
//! again — which, at an idle prompt, is never.
//!
//! Raw bytes, not `String`: a pty read can end mid-character, so decoding is
//! deferred to `replay()` where the whole retained span is available.

use std::collections::VecDeque;

/// Bytes retained per session.
///
/// Sized against what it is for. A dense 200×50 screen of text is roughly
/// 10 KiB, so this holds ~25 screenfuls — enough that reattaching lands on a
/// screen with real history above it, not just the last prompt. The ceiling
/// is the other half: the whole span crosses to the webview as one Tauri
/// event, and it is held per open worktree, so a dozen live terminals cost
/// ~3 MiB of resident memory and no single replay stalls the IPC channel.
///
/// It is deliberately not "as much as the shell would keep". Task 2 of
/// vingilot/docs/plans/2026-08-07-workspace-v1.md moves persistence to tmux,
/// which redraws the visible screen on attach; this buffer is the fallback
/// for when tmux is absent, and a fallback that tried to be a full
/// scrollback store would be reimplementing tmux badly.
const DEFAULT_SCROLLBACK_BYTES: usize = 256 * 1024;

/// A fixed-capacity byte ring. Writes past capacity evict from the front, so
/// what survives is always the most recent output.
pub(crate) struct Scrollback {
    buf: VecDeque<u8>,
    cap: usize,
}

impl Default for Scrollback {
    fn default() -> Self {
        Self::with_capacity(DEFAULT_SCROLLBACK_BYTES)
    }
}

impl Scrollback {
    pub(crate) fn with_capacity(cap: usize) -> Self {
        Self {
            buf: VecDeque::new(),
            cap,
        }
    }

    /// Append output, evicting the oldest bytes to stay within capacity.
    pub(crate) fn push(&mut self, bytes: &[u8]) {
        if self.cap == 0 {
            return;
        }

        // A single write larger than the ring keeps only its tail — the same
        // bytes that would have survived had it arrived in pieces.
        let tail = if bytes.len() > self.cap {
            &bytes[bytes.len() - self.cap..]
        } else {
            bytes
        };

        self.buf.extend(tail);
        while self.buf.len() > self.cap {
            self.buf.pop_front();
        }
        self.drop_orphaned_continuation_bytes();
    }

    /// The retained span, decoded for the webview.
    pub(crate) fn replay(&self) -> String {
        let (front, back) = self.buf.as_slices();
        let mut bytes = Vec::with_capacity(front.len() + back.len());
        bytes.extend_from_slice(front);
        bytes.extend_from_slice(back);
        String::from_utf8_lossy(&bytes).into_owned()
    }

    /// Eviction can land inside a multi-byte character, leaving the buffer
    /// starting on continuation bytes (`0b10xx_xxxx`) that would decode to a
    /// leading replacement character. Drop them.
    ///
    /// An ANSI escape sequence cut the same way is left as it falls: there
    /// is no cheap way to find a sequence's start from its middle, and
    /// xterm discards an incomplete sequence rather than printing it.
    fn drop_orphaned_continuation_bytes(&mut self) {
        while let Some(&first) = self.buf.front() {
            if first & 0b1100_0000 == 0b1000_0000 {
                self.buf.pop_front();
            } else {
                break;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_empty_buffer_replays_nothing() {
        assert_eq!(Scrollback::default().replay(), "");
    }

    #[test]
    fn it_replays_what_was_written() {
        let mut sb = Scrollback::default();
        sb.push(b"$ cargo test\r\n");
        sb.push(b"ok\r\n");
        assert_eq!(sb.replay(), "$ cargo test\r\nok\r\n");
    }

    #[test]
    fn it_is_bounded_by_its_capacity() {
        let mut sb = Scrollback::with_capacity(8);
        for _ in 0..100 {
            sb.push(b"0123456789");
        }
        assert_eq!(sb.replay().len(), 8);
    }

    #[test]
    fn it_drops_oldest_first() {
        let mut sb = Scrollback::with_capacity(4);
        sb.push(b"abcd");
        sb.push(b"ef");
        assert_eq!(sb.replay(), "cdef");
    }

    #[test]
    fn a_write_larger_than_the_ring_keeps_only_its_tail() {
        let mut sb = Scrollback::with_capacity(4);
        sb.push(b"abcdefghij");
        assert_eq!(sb.replay(), "ghij");
    }

    #[test]
    fn a_zero_capacity_ring_retains_nothing_and_does_not_panic() {
        let mut sb = Scrollback::with_capacity(0);
        sb.push(b"anything at all");
        assert_eq!(sb.replay(), "");
    }

    #[test]
    fn eviction_never_leaves_a_partial_character_at_the_front() {
        // "é" is two bytes; evicting into the middle of it must drop the
        // orphaned continuation byte rather than replay a leading U+FFFD.
        let mut sb = Scrollback::with_capacity(3);
        sb.push("aé".as_bytes());
        sb.push(b"zz");
        let replayed = sb.replay();
        assert!(
            !replayed.contains('\u{FFFD}'),
            "replay opened mid-character: {replayed:?}"
        );
        assert_eq!(replayed, "zz");
    }

    #[test]
    fn multi_byte_output_that_fits_survives_intact() {
        let mut sb = Scrollback::default();
        sb.push("✓ ünïcode ✗".as_bytes());
        assert_eq!(sb.replay(), "✓ ünïcode ✗");
    }

    #[test]
    fn a_write_split_across_reads_rejoins_in_the_replay() {
        // A pty read boundary can fall inside a character; the buffer holds
        // bytes precisely so the halves rejoin before decoding.
        let bytes = "✓".as_bytes();
        let mut sb = Scrollback::default();
        sb.push(&bytes[..1]);
        sb.push(&bytes[1..]);
        assert_eq!(sb.replay(), "✓");
    }
}
