//! Removing terminal *queries* from the bytes a session retains for replay.
//!
//! **A replay may repeat what was shown; it may never repeat a question.**
//! Output is idempotent — painting the same screen twice paints the same
//! screen. A query is not: `ESC[c` asks the terminal who it is, and the
//! terminal answers by *typing* `ESC[?1;2c` back down the pty. When that
//! query is replayed to a freshly attached view, xterm answers it as
//! faithfully as it did the first time, but the program that asked exited
//! long ago, so the answer lands at an idle shell prompt as input. The owner
//! saw exactly that: `1;2c0;276;0c` — a DA1 reply and a DA2 reply — typed at
//! his command line by nobody.
//!
//! So the ring holds only replayable bytes, by construction: queries are
//! stripped on the way *in* (`scrollback.rs`), never on the way out. Live
//! output is untouched — the program that asked is still there, still
//! waiting, and starving it of its answer would hang it.
//!
//! **What counts as a sequence.** A real `ESC` byte (0x1b) in the stream is a
//! control introducer, to xterm and to this filter alike; there is no third
//! reading of it available to either. So "text that merely resembles a query"
//! means text with no introducer in it — `^[[c` written in caret notation,
//! or the letters `ESC[c` in a here-doc — and that text is passed through
//! byte for byte. A here-doc that emits a *real* 0x1b is not a resemblance:
//! xterm answers it live, and replaying it would make xterm answer it again.
//!
//! The 8-bit C1 forms (0x9b CSI, 0x9d OSC, 0x90 DCS) are deliberately not
//! recognised. What is recorded has already been decoded as UTF-8
//! (`utf8_stream.rs`, `session.rs::record_output`), where those bytes can
//! only ever be the tail of a multi-byte character — treating one as an
//! introducer would eat the character around it.
//!
//! **Sequences split across pushes are the whole difficulty.** A pty read
//! boundary falls wherever the kernel put it, so `ESC[6n` arrives as `ESC[6`
//! then `n` often enough to matter and never in a test that pushes whole
//! strings. The parser state and the undecided bytes therefore live in the
//! filter, across calls, and a sequence contributes nothing to the ring until
//! its last byte has been seen and read.

use std::borrow::Cow;

const ESC: u8 = 0x1b;
const BEL: u8 = 0x07;
/// ENQ: "identify yourself", answered with the terminal's answerback string.
const ENQ: u8 = 0x05;
const CAN: u8 = 0x18;
const SUB: u8 = 0x1a;

/// Bytes held for an undecided CSI before it is ruled malformed.
///
/// A real CSI is a handful of bytes; nothing legitimate approaches this. The
/// cap is what stops a stream of `0x20..=0x3f` from growing the pending
/// buffer without bound — the ring is bounded, and the thing in front of it
/// must be too.
const MAX_CSI: usize = 64;

/// Bytes held for an undecided string sequence before it is ruled replayable.
///
/// Only OSC is undecided for long: whether it is a query is a property of its
/// *last* parameter, so its payload has to be held. A window title is short;
/// anything past this is not a query and is let through rather than retained
/// in two places at once.
const MAX_STRING: usize = 4096;

/// Bytes held for a DCS introducer before the string is ruled replayable.
/// The introducer ends at its first byte in `0x40..=0x7e`, which for every
/// DCS that exists is within a few bytes of `ESC P`.
const MAX_DCS_INTRODUCER: usize = 32;

/// The XTWINOPS parameters that make the terminal answer (report window
/// state, position, pixel and cell geometry, text-area and screen size, icon
/// label, window title). The rest of the `t` family moves, resizes, and
/// raises windows — not questions, so not this filter's business.
const WINDOW_REPORTS: &[u16] = &[11, 13, 14, 15, 16, 18, 19, 20, 21];

/// What has been decided about the string sequence being read.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Verdict {
    /// Not yet knowable from what has arrived.
    Undecided,
    /// Replayable: its bytes have already been passed through, and the rest
    /// stream past without being held.
    Keep,
    /// A query: its bytes are discarded as they arrive.
    Drop,
}

/// Which string sequence is being read — they differ in how they end and in
/// how their verdict is reached.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum StringKind {
    /// `ESC ]` — ends at BEL or ST; a query is one whose last parameter is
    /// exactly `?`, which is only knowable at the end.
    Osc,
    /// `ESC P` — ends at ST; a query is knowable from its introducer.
    Dcs,
    /// `ESC X`, `ESC ^`, `ESC _` — ends at ST, never solicits a reply from
    /// anything this app renders with.
    Opaque,
}

enum State {
    /// Outside any sequence.
    Text,
    /// `ESC` seen; the next byte says what this is.
    Escape,
    /// `ESC` and an intermediate (`ESC ( B` and friends); one more byte
    /// completes it, and all of it is kept.
    EscapeIntermediate,
    /// Inside `ESC [ …`, held until the final byte decides.
    Csi,
    /// Inside a string sequence.
    Str {
        kind: StringKind,
        verdict: Verdict,
        /// An `ESC` was seen inside the payload: `\` makes it ST.
        escaped: bool,
    },
}

/// Whether a byte was dealt with or must be re-read in the state the last one
/// left behind.
#[derive(Eq, PartialEq)]
enum Step {
    Consumed,
    Redispatch,
}

/// A stateful stripper: bytes in, replayable bytes out, parser state retained
/// between calls so a sequence may straddle any number of them.
pub(crate) struct QueryFilter {
    state: State,
    /// The bytes of the sequence being read, held back until its verdict is
    /// known. Never grows past the caps above.
    pending: Vec<u8>,
}

impl Default for QueryFilter {
    fn default() -> Self {
        Self {
            state: State::Text,
            pending: Vec::new(),
        }
    }
}

impl QueryFilter {
    /// The replayable part of `bytes`.
    ///
    /// Borrowed unchanged for the overwhelmingly common chunk that contains
    /// no introducer at all, which is most of what a shell prints.
    pub(crate) fn retain<'a>(&mut self, bytes: &'a [u8]) -> Cow<'a, [u8]> {
        if matches!(self.state, State::Text)
            && !bytes.iter().any(|&byte| byte == ESC || byte == ENQ)
        {
            return Cow::Borrowed(bytes);
        }
        let mut out = Vec::with_capacity(bytes.len());
        for &byte in bytes {
            // At most one re-read: a byte is handed back only by a state that
            // hands over to `Text` or `Escape`, and neither hands anything
            // back itself.
            if self.step(byte, &mut out) == Step::Redispatch {
                self.step(byte, &mut out);
            }
        }
        Cow::Owned(out)
    }

    fn step(&mut self, byte: u8, out: &mut Vec<u8>) -> Step {
        match self.state {
            State::Text => self.in_text(byte, out),
            State::Escape => self.in_escape(byte, out),
            State::EscapeIntermediate => {
                self.pending.push(byte);
                self.flush(out);
                self.state = State::Text;
                Step::Consumed
            }
            State::Csi => self.in_csi(byte, out),
            State::Str {
                kind,
                verdict,
                escaped,
            } => self.in_string(kind, verdict, escaped, byte, out),
        }
    }

    fn in_text(&mut self, byte: u8, out: &mut Vec<u8>) -> Step {
        match byte {
            ESC => {
                self.pending.push(ESC);
                self.state = State::Escape;
            }
            // The one query with no introducer at all.
            ENQ => {}
            _ => out.push(byte),
        }
        Step::Consumed
    }

    fn in_escape(&mut self, byte: u8, out: &mut Vec<u8>) -> Step {
        match byte {
            b'[' => {
                self.pending.push(byte);
                self.state = State::Csi;
            }
            b']' => self.start_string(byte, StringKind::Osc, Verdict::Undecided, out),
            b'P' => self.start_string(byte, StringKind::Dcs, Verdict::Undecided, out),
            b'X' | b'^' | b'_' => self.start_string(byte, StringKind::Opaque, Verdict::Keep, out),
            // DECID — the obsolete spelling of DA1, and answered like one.
            b'Z' => {
                self.discard();
                self.state = State::Text;
            }
            // A second ESC restarts the sequence; the first introduced
            // nothing and is not output.
            ESC => {
                self.discard();
                self.pending.push(ESC);
            }
            // Charset designators and their kin: one more byte, all kept.
            0x20..=0x2f => {
                self.pending.push(byte);
                self.state = State::EscapeIntermediate;
            }
            // The two bytes that cancel a sequence outright, here and in
            // every state below. Neither renders anything, so what was held
            // goes and the cancel itself is not carried over.
            CAN | SUB => {
                self.discard();
                self.state = State::Text;
            }
            // A two-byte escape, `ESC 7` / `ESC =` / `ESC c` and the rest.
            // None of them ask anything.
            _ => {
                self.pending.push(byte);
                self.flush(out);
                self.state = State::Text;
            }
        }
        Step::Consumed
    }

    fn start_string(&mut self, byte: u8, kind: StringKind, verdict: Verdict, out: &mut Vec<u8>) {
        self.pending.push(byte);
        if verdict == Verdict::Keep {
            self.flush(out);
        }
        self.state = State::Str {
            kind,
            verdict,
            escaped: false,
        };
    }

    fn in_csi(&mut self, byte: u8, out: &mut Vec<u8>) -> Step {
        if self.pending.len() >= MAX_CSI {
            self.discard();
            self.state = State::Text;
            return Step::Redispatch;
        }
        match byte {
            // Private prefix, parameters, intermediates.
            0x20..=0x3f => {
                self.pending.push(byte);
                Step::Consumed
            }
            0x40..=0x7e => {
                self.pending.push(byte);
                if csi_asks(&self.pending) {
                    self.discard();
                } else {
                    self.flush(out);
                }
                self.state = State::Text;
                Step::Consumed
            }
            CAN | SUB => {
                self.discard();
                self.state = State::Text;
                Step::Consumed
            }
            // Nothing else can continue a CSI. What is held is the
            // introducer plus parameter bytes — never display output — so it
            // is dropped rather than emitted as the mojibake half a sequence
            // renders as, and the byte that ended it is re-read as itself.
            _ => {
                self.discard();
                self.state = State::Text;
                Step::Redispatch
            }
        }
    }

    fn in_string(
        &mut self,
        kind: StringKind,
        verdict: Verdict,
        escaped: bool,
        byte: u8,
        out: &mut Vec<u8>,
    ) -> Step {
        if escaped {
            self.set_escaped(false);
            if byte == b'\\' {
                self.finish_string(kind, verdict, &[ESC, b'\\'], out);
                return Step::Consumed;
            }
            // An ESC that is not ST abandons the string and introduces
            // whatever follows it, which is what xterm does with one too.
            self.discard();
            self.pending.push(ESC);
            self.state = State::Escape;
            return Step::Redispatch;
        }
        match byte {
            ESC => {
                self.set_escaped(true);
                Step::Consumed
            }
            BEL if kind == StringKind::Osc => {
                self.finish_string(kind, verdict, &[BEL], out);
                Step::Consumed
            }
            CAN | SUB => {
                self.discard();
                self.state = State::Text;
                Step::Consumed
            }
            _ => {
                self.string_payload(kind, verdict, byte, out);
                Step::Consumed
            }
        }
    }

    fn string_payload(&mut self, kind: StringKind, verdict: Verdict, byte: u8, out: &mut Vec<u8>) {
        match verdict {
            Verdict::Keep => {
                out.push(byte);
                return;
            }
            Verdict::Drop => return,
            Verdict::Undecided => {}
        }
        self.pending.push(byte);
        match kind {
            StringKind::Dcs => {
                if (0x40..=0x7e).contains(&byte) {
                    // The introducer just ended, which is everything the
                    // verdict depends on.
                    if dcs_asks(&self.pending) {
                        self.discard();
                        self.set_verdict(Verdict::Drop);
                    } else {
                        self.flush(out);
                        self.set_verdict(Verdict::Keep);
                    }
                } else if self.pending.len() > MAX_DCS_INTRODUCER {
                    self.flush(out);
                    self.set_verdict(Verdict::Keep);
                }
            }
            StringKind::Osc => {
                if self.pending.len() > MAX_STRING {
                    self.flush(out);
                    self.set_verdict(Verdict::Keep);
                }
            }
            StringKind::Opaque => {}
        }
    }

    fn finish_string(
        &mut self,
        kind: StringKind,
        verdict: Verdict,
        terminator: &[u8],
        out: &mut Vec<u8>,
    ) {
        let asks = match verdict {
            Verdict::Drop => true,
            Verdict::Keep => false,
            // Only an OSC is still undecided at its terminator; a DCS whose
            // introducer never completed is malformed, not a question.
            Verdict::Undecided => kind == StringKind::Osc && osc_asks(&self.pending),
        };
        if asks {
            self.discard();
        } else {
            self.flush(out);
            out.extend_from_slice(terminator);
        }
        self.state = State::Text;
    }

    fn set_verdict(&mut self, next: Verdict) {
        if let State::Str { verdict, .. } = &mut self.state {
            *verdict = next;
        }
    }

    fn set_escaped(&mut self, next: bool) {
        if let State::Str { escaped, .. } = &mut self.state {
            *escaped = next;
        }
    }

    fn flush(&mut self, out: &mut Vec<u8>) {
        out.extend(self.pending.drain(..));
    }

    fn discard(&mut self) {
        self.pending.clear();
    }
}

/// Does this CSI make the terminal answer?
///
/// `seq` is the whole sequence, `ESC [` through its final byte. Everything
/// between splits into an optional private prefix (`< = > ?`), parameters
/// (`0-9 ; :`), and intermediates (`0x20..=0x2f`) — and the answer turns on
/// all three, not on the final byte alone. `ESC[>0q` asks the terminal's
/// version; `ESC[0q` sets an LED. `ESC[?6n` asks where the cursor is;
/// `ESC[>6n` sets a keyboard resource.
fn csi_asks(seq: &[u8]) -> bool {
    if seq.len() < 3 {
        return false;
    }
    let Some((final_byte, body)) = seq[2..].split_last() else {
        return false;
    };
    let (prefix, body) = match body.first() {
        Some(&byte) if matches!(byte, b'<' | b'=' | b'>' | b'?') => (Some(byte), &body[1..]),
        _ => (None, body),
    };
    let params_end = body
        .iter()
        .position(|byte| !matches!(byte, b'0'..=b'9' | b';' | b':'))
        .unwrap_or(body.len());
    let (params, intermediates) = body.split_at(params_end);

    match *final_byte {
        // DA1 / DA2 / DA3 — "what are you?". The reply to the first two is
        // what the owner found typed at his prompt.
        b'c' if intermediates.is_empty() && matches!(prefix, None | Some(b'?' | b'>' | b'=')) => {
            true
        }
        // DSR and DECXCPR — terminal status, cursor position. `ESC[>…n` is
        // xterm's modifier-resource reset and answers nothing.
        b'n' if intermediates.is_empty() && matches!(prefix, None | Some(b'?')) => true,
        // XTVERSION. Without the `>` this is DECLL, which sets LEDs.
        b'q' if intermediates.is_empty() && prefix == Some(b'>') => true,
        // DECRQM, both spellings. Without the `$` this is DECSTR/DECSCL,
        // which reset and set rather than ask.
        b'p' if intermediates == b"$" && matches!(prefix, None | Some(b'?')) => true,
        // DECREQTPARM. `ESC[…*x` is DECSACE and answers nothing.
        b'x' if intermediates.is_empty() && prefix.is_none() => true,
        // The kitty keyboard protocol's flag query. Its other prefixes push,
        // pop and set flags.
        b'u' if intermediates.is_empty() && prefix == Some(b'?') => true,
        // XTSMGRAPHICS reads back a graphics limit.
        b'S' if intermediates.is_empty() && prefix == Some(b'?') => true,
        // XTWINOPS: reporting parameters only — the rest move and resize.
        b't' if intermediates.is_empty() && prefix.is_none() => {
            first_param(params).is_some_and(|param| WINDOW_REPORTS.contains(&param))
        }
        _ => false,
    }
}

/// The first parameter of a CSI, when it has one this filter can read.
/// Out-of-range values answer `None` rather than wrapping into a parameter
/// that means something else.
fn first_param(params: &[u8]) -> Option<u16> {
    let first = params.split(|&byte| byte == b';' || byte == b':').next()?;
    std::str::from_utf8(first).ok()?.parse::<u16>().ok()
}

/// Does this OSC make the terminal answer?
///
/// `payload` is `ESC ]` and everything up to the terminator. Every OSC query
/// xterm defines — the palette (`4`), the foreground, background, cursor and
/// pointer colours (`10`–`19`), the clipboard (`52`) — asks by making its
/// last parameter exactly `?`, and nothing that sets a value ever ends that
/// way. So the rule is the shape, not a list of numbers to fall behind on: a
/// window title of `where?` keeps its question mark and is retained, because
/// `where?` is not `?`.
fn osc_asks(payload: &[u8]) -> bool {
    match payload[2..].rsplit(|&byte| byte == b';').next() {
        Some(last) => last == b"?",
        None => false,
    }
}

/// Does this DCS make the terminal answer?
///
/// `introducer` is `ESC P` through the introducer's final byte. DECRQSS
/// (`ESC P $ q`), XTGETTCAP (`ESC P + q`) and XTGETXRES (`ESC P + Q`) are the
/// asking ones and are the only DCS forms carrying a `$` or `+` intermediate.
/// Sixel images and DECUDK definitions carry neither, and a sixel is pure
/// output — dropping one would lose a picture the owner was shown.
fn dcs_asks(introducer: &[u8]) -> bool {
    introducer[2..]
        .iter()
        .any(|&byte| byte == b'$' || byte == b'+')
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Push a whole stream through one filter, as a single read would.
    fn retained(bytes: &[u8]) -> Vec<u8> {
        QueryFilter::default().retain(bytes).into_owned()
    }

    /// Push a stream through one filter in the given pieces, as a pty that
    /// happened to split its reads there would.
    fn retained_in_pieces(pieces: &[&[u8]]) -> Vec<u8> {
        let mut filter = QueryFilter::default();
        let mut out = Vec::new();
        for piece in pieces {
            out.extend_from_slice(&filter.retain(piece));
        }
        out
    }

    /// Every way of cutting `bytes` into two, and then into three. A stripper
    /// that only works on whole sequences passes every whole-sequence test
    /// and fails in production, where the read boundary falls wherever the
    /// kernel put it.
    fn every_split(bytes: &[u8]) -> Vec<Vec<Vec<u8>>> {
        let mut splits = Vec::new();
        for first in 0..=bytes.len() {
            splits.push(vec![bytes[..first].to_vec(), bytes[first..].to_vec()]);
            for second in first..=bytes.len() {
                splits.push(vec![
                    bytes[..first].to_vec(),
                    bytes[first..second].to_vec(),
                    bytes[second..].to_vec(),
                ]);
            }
        }
        splits
    }

    fn assert_same_however_it_arrives(bytes: &[u8], expected: &[u8]) {
        assert_eq!(retained(bytes), expected, "whole");
        for split in every_split(bytes) {
            let pieces: Vec<&[u8]> = split.iter().map(|piece| piece.as_slice()).collect();
            assert_eq!(
                retained_in_pieces(&pieces),
                expected,
                "split as {:?}",
                split
                    .iter()
                    .map(|piece| String::from_utf8_lossy(piece).into_owned())
                    .collect::<Vec<_>>()
            );
        }
    }

    #[test]
    fn ordinary_output_passes_through_untouched() {
        assert_eq!(
            retained(b"$ cargo test\r\nok\r\n"),
            b"$ cargo test\r\nok\r\n"
        );
    }

    #[test]
    fn output_with_no_introducer_is_not_copied_at_all() {
        let mut filter = QueryFilter::default();
        assert!(matches!(filter.retain(b"plain output"), Cow::Borrowed(_)));
    }

    #[test]
    fn a_sequence_that_only_paints_is_replayable() {
        // The overwhelming majority of a pty stream. Stripping any of this
        // would replay a screen that never existed.
        for painting in [
            &b"\x1b[2J"[..],
            b"\x1b[1;31m",
            b"\x1b[?1049h",
            b"\x1b[?25l",
            b"\x1b[10;20H",
            b"\x1b[K",
            b"\x1b]0;a window title\x07",
            b"\x1b]2;buzz\x1b\\",
            b"\x1b7",
            b"\x1b(B",
            b"\x1b[!p",
            b"\x1b[>4;2m",
        ] {
            assert_eq!(
                retained(painting),
                painting,
                "stripped something that only paints: {:?}",
                String::from_utf8_lossy(painting)
            );
        }
    }

    #[test]
    fn the_two_replies_the_owner_found_typed_at_his_prompt_are_stripped() {
        // DA1 and DA2. Their answers are `ESC[?1;2c` and `ESC[>0;276;0c`,
        // which is `1;2c0;276;0c` once the terminal has eaten the control
        // bytes — the exact string he saw.
        assert_same_however_it_arrives(b"before\x1b[cafter", b"beforeafter");
        assert_same_however_it_arrives(b"before\x1b[>cafter", b"beforeafter");
        assert_same_however_it_arrives(b"before\x1b[0cafter", b"beforeafter");
        assert_same_however_it_arrives(b"before\x1b[>0cafter", b"beforeafter");
    }

    #[test]
    fn every_query_this_filter_knows_is_stripped_however_it_is_split() {
        for query in [
            // DA1, DA2, DA3.
            &b"\x1b[c"[..],
            b"\x1b[0c",
            b"\x1b[>c",
            b"\x1b[>0c",
            b"\x1b[=c",
            b"\x1b[=0c",
            // DECID, DA1's older spelling.
            b"\x1bZ",
            // DSR: status, cursor position, and the DEC-private forms.
            b"\x1b[5n",
            b"\x1b[6n",
            b"\x1b[?6n",
            b"\x1b[?15n",
            b"\x1b[?26n",
            // XTVERSION.
            b"\x1b[>0q",
            b"\x1b[>q",
            // DECRQM, both spellings.
            b"\x1b[?2026$p",
            b"\x1b[4$p",
            // DECREQTPARM.
            b"\x1b[0x",
            b"\x1b[1x",
            // The kitty keyboard flag query.
            b"\x1b[?u",
            // XTSMGRAPHICS.
            b"\x1b[?1;1;0S",
            // XTWINOPS reports.
            b"\x1b[14t",
            b"\x1b[18t",
            b"\x1b[21t",
            // OSC colour and palette queries, BEL- and ST-terminated.
            b"\x1b]10;?\x07",
            b"\x1b]11;?\x1b\\",
            b"\x1b]12;?\x07",
            b"\x1b]4;1;?\x07",
            // OSC 52: this one answers with the clipboard.
            b"\x1b]52;c;?\x07",
            // DECRQSS, XTGETTCAP, XTGETXRES.
            b"\x1bP$qm\x1b\\",
            b"\x1bP+q544e\x1b\\",
            b"\x1bP+Q544e\x1b\\",
            // ENQ, the query with no introducer.
            b"\x05",
        ] {
            let mut framed = b"before".to_vec();
            framed.extend_from_slice(query);
            framed.extend_from_slice(b"after");
            assert_same_however_it_arrives(&framed, b"beforeafter");
        }
    }

    #[test]
    fn the_text_around_a_query_survives_byte_for_byte() {
        assert_same_however_it_arrives(
            b"$ vim\r\n\x1b[6n\x1b[1;1H\x1b[cnormal mode\r\n",
            b"$ vim\r\n\x1b[1;1Hnormal mode\r\n",
        );
    }

    #[test]
    fn several_queries_in_one_burst_all_go() {
        // How a terminal-capability probe actually arrives: one write, every
        // question at once.
        assert_same_however_it_arrives(
            b"\x1b[c\x1b[>c\x1b[>0q\x1b]11;?\x07\x1b[5n\x1b[6nprompt$ ",
            b"prompt$ ",
        );
    }

    #[test]
    fn a_query_split_across_two_pushes_is_still_stripped() {
        // Pinned separately from the exhaustive split above because this is
        // the case the happy path hides: `ESC[6` and `n` are each harmless
        // alone.
        assert_eq!(retained_in_pieces(&[b"a\x1b[6", b"n b"]), b"a b");
        assert_eq!(retained_in_pieces(&[b"a\x1b", b"[cb"]), b"ab");
        assert_eq!(retained_in_pieces(&[b"a\x1b]11;", b"?\x07b"]), b"ab");
    }

    #[test]
    fn a_query_split_across_three_pushes_is_still_stripped() {
        assert_eq!(retained_in_pieces(&[b"a\x1b", b"[>0", b"q b"]), b"a b");
        assert_eq!(retained_in_pieces(&[b"a\x1bP", b"$q", b"m\x1b\\b"]), b"ab");
    }

    #[test]
    fn a_query_split_one_byte_at_a_time_is_still_stripped() {
        let stream = b"a\x1b]4;1;?\x07b\x1b[>0cc";
        let pieces: Vec<&[u8]> = stream.chunks(1).collect();
        assert_eq!(retained_in_pieces(&pieces), b"abc");
    }

    #[test]
    fn text_that_only_spells_a_query_is_left_alone() {
        // The stated rule: a real 0x1b is an introducer to xterm and to this
        // filter alike, so the only thing that can "resemble" a query is text
        // with no introducer in it. Both of these are what a shell echoes
        // when the owner types the sequence out rather than emitting it.
        assert_same_however_it_arrives(b"printf 'ESC[c'\r\n", b"printf 'ESC[c'\r\n");
        assert_same_however_it_arrives(b"^[[c is a DA1\r\n", b"^[[c is a DA1\r\n");
        assert_same_however_it_arrives(
            b"cat <<'EOF'\r\n\\e[6n\r\nEOF\r\n",
            b"cat <<'EOF'\r\n\\e[6n\r\nEOF\r\n",
        );
    }

    #[test]
    fn an_osc_whose_text_merely_ends_in_a_question_mark_is_kept() {
        // `?` as the whole last parameter is the query; `where?` is a title.
        assert_same_however_it_arrives(b"\x1b]0;where?\x07", b"\x1b]0;where?\x07");
        assert_same_however_it_arrives(b"\x1b]0;?really\x07", b"\x1b]0;?really\x07");
    }

    #[test]
    fn a_sequence_one_byte_away_from_a_query_is_kept() {
        // Each of these differs from a query above by its prefix or its
        // intermediate alone, and each sets something rather than asking.
        for painting in [
            // xterm's modifier-resource reset, not DSR.
            &b"\x1b[>4n"[..],
            // DECLL, not XTVERSION.
            b"\x1b[0q",
            // DECSCUSR, not XTVERSION.
            b"\x1b[2 q",
            // DECSTR, not DECRQM.
            b"\x1b[!p",
            // DECSACE, not DECREQTPARM.
            b"\x1b[2*x",
            // Push and pop the window title — no answer.
            b"\x1b[22;0t",
            b"\x1b[23;0t",
            // Set the palette rather than read it.
            b"\x1b]4;1;rgb:00/00/00\x07",
        ] {
            assert_same_however_it_arrives(painting, painting);
        }
    }

    #[test]
    fn a_sixel_image_is_output_and_survives() {
        // A DCS with no `$`/`+` intermediate is a picture, not a question.
        // Dropping one would lose something the owner was shown.
        let sixel = b"\x1bP0;0;8q#0;2;0;0;0#1~~@@vv@@~~@@~~$\x1b\\";
        assert_same_however_it_arrives(sixel, sixel);
    }

    #[test]
    fn an_opaque_string_sequence_is_carried_through() {
        // APC/PM/SOS payloads are not this filter's business, and their
        // payload must not be re-parsed as if it were ground-state text.
        assert_same_however_it_arrives(b"\x1b_Gi=1\x1b\\x", b"\x1b_Gi=1\x1b\\x");
        assert_same_however_it_arrives(b"\x1b^note\x1b\\x", b"\x1b^note\x1b\\x");
    }

    #[test]
    fn a_partial_sequence_at_the_end_of_a_stream_contributes_nothing_yet() {
        // It is not knowable yet whether these are questions, and half a
        // sequence renders as garbage. The next read decides them.
        assert_eq!(retained(b"text\x1b[6"), b"text");
        assert_eq!(retained(b"text\x1b]11;"), b"text");
        assert_eq!(
            retained_in_pieces(&[b"text\x1b[1", b";31mred"]),
            b"text\x1b[1;31mred"
        );
    }

    #[test]
    fn a_csi_broken_by_a_byte_that_cannot_continue_it_loses_only_the_fragment() {
        // The line break is real output and must survive; `ESC[1` painted
        // nothing and cannot be completed.
        assert_same_however_it_arrives(b"a\x1b[1\r\nb", b"a\r\nb");
    }

    #[test]
    fn a_cancelled_sequence_takes_nothing_with_it() {
        assert_same_however_it_arrives(b"a\x1b[6\x18nb", b"anb");
        assert_same_however_it_arrives(b"a\x1b]11;?\x1ab", b"ab");
    }

    #[test]
    fn a_query_interrupted_by_a_new_sequence_does_not_shield_the_second_one() {
        // The abandoned `ESC]11;` is gone; the DA1 that interrupted it is
        // still a question.
        assert_same_however_it_arrives(b"a\x1b]11;\x1b[cb", b"ab");
    }

    #[test]
    fn a_run_of_introducers_settles_on_the_last_one() {
        assert_same_however_it_arrives(b"a\x1b\x1b\x1b[cb", b"ab");
    }

    #[test]
    fn a_csi_that_never_ends_cannot_grow_without_bound() {
        // The filter sits in front of a bounded ring, so it has to be
        // bounded too — otherwise a stream of parameter bytes with no final
        // byte is an unbounded buffer with a bounded one behind it.
        let mut filter = QueryFilter::default();
        let mut out = Vec::new();
        out.extend_from_slice(&filter.retain(b"\x1b["));
        for _ in 0..1000 {
            out.extend_from_slice(&filter.retain(b"123456789;"));
        }
        assert!(
            filter.pending.len() <= MAX_CSI,
            "pending grew to {}",
            filter.pending.len()
        );
    }

    #[test]
    fn an_osc_that_never_ends_stops_being_held_and_starts_flowing() {
        // Long past any real title, so it is not a query; retaining it in
        // the pending buffer as well as the ring would be holding it twice.
        let mut filter = QueryFilter::default();
        let mut out = Vec::new();
        out.extend_from_slice(&filter.retain(b"\x1b]0;"));
        for _ in 0..1000 {
            out.extend_from_slice(&filter.retain(&[b'x'; 64]));
        }
        assert!(
            filter.pending.len() <= MAX_STRING + 1,
            "pending grew to {}",
            filter.pending.len()
        );
        assert!(out.len() > MAX_STRING, "the payload never started flowing");
    }

    #[test]
    fn a_dcs_that_never_reaches_a_final_byte_stops_being_held() {
        let mut filter = QueryFilter::default();
        let mut out = Vec::new();
        out.extend_from_slice(&filter.retain(b"\x1bP"));
        for _ in 0..1000 {
            out.extend_from_slice(&filter.retain(b";1;2;3"));
        }
        assert!(
            filter.pending.len() <= MAX_DCS_INTRODUCER + 1,
            "pending grew to {}",
            filter.pending.len()
        );
    }

    #[test]
    fn a_stream_of_queries_retains_nothing_at_all() {
        let mut filter = QueryFilter::default();
        let mut out = Vec::new();
        for _ in 0..1000 {
            out.extend_from_slice(&filter.retain(b"\x1b[c\x1b[>c\x1b[6n"));
        }
        assert!(out.is_empty(), "retained {} bytes of questions", out.len());
        assert!(filter.pending.is_empty());
    }

    #[test]
    fn multi_byte_text_is_never_mistaken_for_a_control_byte() {
        // 0x9b is the 8-bit CSI, and also the second byte of "›". The stream
        // reaching this filter is decoded UTF-8, so the character is what it
        // is and must survive whole.
        assert_same_however_it_arrives("› ünïcode ✓".as_bytes(), "› ünïcode ✓".as_bytes());
    }

    #[test]
    fn a_character_split_across_pushes_still_survives() {
        let bytes = "✓".as_bytes();
        assert_eq!(retained_in_pieces(&[&bytes[..1], &bytes[1..]]), bytes);
    }
}
