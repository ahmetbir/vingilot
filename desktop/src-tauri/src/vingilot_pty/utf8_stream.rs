//! Decoding a pty's byte stream into text, one read at a time.
//!
//! A pty read returns whatever bytes were available, which can end in the
//! middle of a multi-byte character. Decoding each read on its own turns that
//! character into U+FFFD on screen even though the next read completes it, so
//! the trailing fragment has to be carried across reads instead.
//!
//! Genuinely invalid bytes are a different case and must not be carried: a
//! shell printing a binary file would otherwise stall the stream waiting for
//! a continuation that never comes. Those are replaced and the stream moves
//! on.

/// Split `bytes` into the text it fully contains and the trailing fragment of
/// an as-yet-incomplete character. The caller prepends that fragment to the
/// next read.
///
/// The remainder is never more than three bytes — the longest prefix of a
/// UTF-8 character that is not yet a character.
pub(crate) fn decode_stream(bytes: &[u8]) -> (String, Vec<u8>) {
    match std::str::from_utf8(bytes) {
        Ok(text) => (text.to_string(), Vec::new()),
        Err(error) => {
            let valid_up_to = error.valid_up_to();
            match error.error_len() {
                // Truncated at the end of the read: hold the fragment back.
                None => (
                    String::from_utf8_lossy(&bytes[..valid_up_to]).into_owned(),
                    bytes[valid_up_to..].to_vec(),
                ),
                // Not truncated — actually invalid. Replace it and keep
                // going, rather than waiting for bytes that will never make
                // it valid.
                Some(_) => (String::from_utf8_lossy(bytes).into_owned(), Vec::new()),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_ascii_decodes_whole_with_nothing_held_back() {
        let (text, rest) = decode_stream(b"$ cargo test\r\n");
        assert_eq!(text, "$ cargo test\r\n");
        assert!(rest.is_empty());
    }

    #[test]
    fn an_empty_read_decodes_to_nothing() {
        let (text, rest) = decode_stream(b"");
        assert_eq!(text, "");
        assert!(rest.is_empty());
    }

    #[test]
    fn a_whole_multi_byte_character_is_not_held_back() {
        let (text, rest) = decode_stream("✓ ünïcode".as_bytes());
        assert_eq!(text, "✓ ünïcode");
        assert!(rest.is_empty());
    }

    #[test]
    fn a_character_truncated_by_the_read_boundary_is_held_for_the_next_read() {
        let check = "✓".as_bytes();
        let (text, rest) = decode_stream(&[b"ok ", &check[..2]].concat());
        assert_eq!(text, "ok ");
        assert_eq!(rest, check[..2].to_vec());
    }

    #[test]
    fn the_held_fragment_rejoins_its_character_on_the_next_read() {
        // The whole point: the split character renders once, correctly,
        // rather than as a replacement character followed by nothing.
        let check = "✓".as_bytes();
        let (first, carry) = decode_stream(&check[..1]);
        assert_eq!(first, "");
        let (second, rest) = decode_stream(&[carry, check[1..].to_vec()].concat());
        assert_eq!(second, "✓");
        assert!(rest.is_empty());
    }

    #[test]
    fn a_held_fragment_is_never_longer_than_a_character_prefix() {
        // The longest incomplete prefix in UTF-8 is three bytes of a
        // four-byte character.
        let emoji = "🚀".as_bytes();
        let (_, rest) = decode_stream(&emoji[..3]);
        assert_eq!(rest.len(), 3);
    }

    #[test]
    fn invalid_bytes_are_replaced_rather_than_stalling_the_stream() {
        let (text, rest) = decode_stream(&[b'a', 0xff, b'b']);
        assert!(text.contains('a') && text.contains('b'));
        assert!(text.contains('\u{FFFD}'));
        assert!(
            rest.is_empty(),
            "invalid bytes must not be carried into the next read"
        );
    }
}
