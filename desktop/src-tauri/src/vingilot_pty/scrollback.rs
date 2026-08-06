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
//!
//! **It is not made redundant by tmux, and it never competes with tmux's own
//! redraw.** The two cannot coincide: tmux redraws on *attach*, which happens
//! only on `pty_open`'s spawn branch, and a session on that branch was
//! registered a moment earlier with an empty ring — the replay it emits
//! carries a mark and no screen. The ring is replayed only on the *reattach*
//! branch, which is reached only while a `PtySession` is already registered,
//! which means the tmux client never detached and tmux will not redraw
//! anything. Skipping the ring for tmux-backed sessions would therefore not
//! remove duplicated work; it would restore the blank pane, for every remount
//! that keeps its session — leaving a project and coming back, a `cwd`
//! change, a development remount.

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
/// It is deliberately not "as much as the shell would keep". Persistence
/// across an app restart is tmux's job, and a ring that tried to be a full
/// scrollback store would be reimplementing tmux badly. This one covers the
/// gap tmux does not: a view remounting onto a session whose tmux client
/// never detached, and so is never going to be redrawn for it.
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
    ///
    /// The re-opening below runs only for a push that actually evicted. A
    /// standing rule instead of a per-eviction one would trim a line off
    /// every push and eat the ring a line at a time.
    pub(crate) fn push(&mut self, bytes: &[u8]) {
        if self.cap == 0 {
            return;
        }

        let mut evicted = false;

        // A single write larger than the ring keeps only its tail — the same
        // bytes that would have survived had it arrived in pieces.
        let tail = if bytes.len() > self.cap {
            evicted = true;
            &bytes[bytes.len() - self.cap..]
        } else {
            bytes
        };

        self.buf.extend(tail);
        while self.buf.len() > self.cap {
            self.buf.pop_front();
            evicted = true;
        }

        if evicted {
            self.open_on_a_line_boundary();
            self.drop_orphaned_continuation_bytes();
        }
    }

    /// The retained span, decoded for the webview.
    pub(crate) fn replay(&self) -> String {
        let (front, back) = self.buf.as_slices();
        let mut bytes = Vec::with_capacity(front.len() + back.len());
        bytes.extend_from_slice(front);
        bytes.extend_from_slice(back);
        String::from_utf8_lossy(&bytes).into_owned()
    }

    /// Resume the retained span just after a newline, so the replay cannot
    /// open in the middle of an escape sequence.
    ///
    /// Eviction cuts at a byte offset the terminal knows nothing about, and
    /// what it cuts through is usually not text — a pty stream, especially
    /// tmux's, is mostly escape sequences. Half of one is not a smaller
    /// version of itself: the tail of `ESC [ 2 J` replays as the literal text
    /// "J" instead of clearing anything, and a truncated mode-set leaves the
    /// terminal in a mode every byte after it assumes it left. xterm discards
    /// a sequence whose start it saw and whose end it did not; nothing
    /// protects the other half.
    ///
    /// A newline is the one byte that cannot appear among a CSI sequence's
    /// parameters or its final byte, so resuming after one guarantees the
    /// replay opens outside any sequence. The cost is at most one partial
    /// line. A span holding no newline at all — one very long line — has no
    /// boundary to find, and is left as it falls rather than dropped whole.
    fn open_on_a_line_boundary(&mut self) {
        let Some(newline) = self.buf.iter().position(|&byte| byte == b'\n') else {
            return;
        };
        self.buf.drain(..=newline);
    }

    /// Eviction can also land inside a multi-byte character, leaving the
    /// buffer starting on continuation bytes (`0b10xx_xxxx`) that would
    /// decode to a leading replacement character. Drop them.
    ///
    /// Still needed after the line-boundary trim above, which finds nothing
    /// to do in a span with no newline in it.
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
    fn a_replay_never_opens_inside_an_escape_sequence() {
        // Cutting `ESC [ 2 J` in half does not clear a smaller screen — its
        // tail replays as the literal text "J". Resuming after a newline is
        // what stops that reaching the pane.
        let mut sb = Scrollback::with_capacity(14);
        sb.push(b"\x1b[2Jalpha\r\nbeta\r\n");
        assert_eq!(sb.replay(), "beta\r\n");
    }

    #[test]
    fn a_span_that_never_evicted_keeps_its_very_first_line() {
        // The trim is a repair for an arbitrary cut. With no cut there is
        // nothing to repair, and the first line the shell printed is real.
        let mut sb = Scrollback::default();
        sb.push(b"first\r\nsecond\r\n");
        assert_eq!(sb.replay(), "first\r\nsecond\r\n");
    }

    #[test]
    fn a_push_that_evicted_nothing_does_not_cost_a_line() {
        // Applying the trim on every push rather than on every eviction would
        // eat the ring one line at a time.
        let mut sb = Scrollback::with_capacity(64);
        sb.push(b"aaa\r\n");
        sb.push(b"bbb\r\n");
        sb.push(b"ccc\r\n");
        assert_eq!(sb.replay(), "aaa\r\nbbb\r\nccc\r\n");
    }

    #[test]
    fn a_span_with_no_line_boundary_at_all_is_left_as_it_falls() {
        // One very long line: there is nowhere to resume from, and replaying
        // an imperfect span beats replaying nothing.
        let mut sb = Scrollback::with_capacity(4);
        sb.push(b"abcdefghij");
        assert_eq!(sb.replay(), "ghij");
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
