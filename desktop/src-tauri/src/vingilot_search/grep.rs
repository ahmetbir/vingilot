//! What `git grep` is asked, and what its answer means — the pure half of the
//! search, with no subprocess anywhere in it.
//!
//! **The argument vector is built here so a test can read it.** Never a shell
//! string: the pattern is the owner's own typing, and a `;` or a backtick in a
//! search box that reached a shell would be a command he did not run. It goes
//! after `-e`, which is also what keeps a pattern beginning with `-` from being
//! read as an option — a search for `--force` is a search, not a flag.
//!
//! **The answer is parsed from `-z`'s NUL-separated fields.** With `-n
//! --column -z`, git prints one record per matching line, `\n`-terminated:
//!
//! ```text
//! <path>NUL<line>NUL<column>NUL<the whole matching line>
//! ```
//!
//! `-z` matters for the path, not for tidiness: without it the separator is
//! `:`, and every path containing a colon — or a matching line beginning with a
//! digit — parses into the wrong three things with nothing failing.
//!
//! **Three bounds live here and each is its own function**, because a bound
//! whose test cannot call it directly is a bound the next refactor removes for
//! free — the lesson `vingilot_files::tree::capped` records:
//!
//! | Bound | Value | Function |
//! |---|---|---|
//! | Hits returned | 2,000 | [`parse`], reported as `capped` |
//! | Characters of one matching line | 400, windowed on the match | [`clip`] |
//! | git's byte column → a char offset | — | [`char_column`] |
//!
//! The byte budget on git's own output is the fourth, and it is `mod.rs`'s
//! because it is a property of the pipe rather than of the text.

use serde::Serialize;

/// The most hits this command will hand back.
///
/// **2,000, and the number travels with the answer.** Far past the point a
/// person reads a result list, far below the point the DOM struggles — and a
/// search that silently truncated would be a search that lies about what is in
/// the repository, which is the one thing Task 2 names as unacceptable. When
/// this bites, the pane says so in a sentence built from the count it really
/// got.
pub const MAX_HITS: usize = 2_000;

/// The most characters of one matching line that cross the IPC.
///
/// A minified bundle is one line of three megabytes, and `git grep` prints the
/// whole matching line. Four hundred characters is more than a person reads of
/// a single result and small enough that two thousand of them are a list rather
/// than a document.
const CLIP_CHARS: usize = 400;

/// How much of the line before the match is kept when a line is clipped. The
/// window is placed on the *match*, not on the start of the line: a hit at
/// column 12,000 of a bundle would otherwise be clipped away entirely and the
/// row would show three hundred characters of something else.
const CLIP_LEAD: usize = 80;

/// One matching line.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    /// Worktree-relative, exactly what `vingilot_files::read::file_read` takes —
    /// which is the whole point of the two modules agreeing about what a path
    /// is. A result is a door, and the door opens on that command.
    pub path: String,
    /// 1-based, as git counts and as a person reads.
    pub line: u32,
    /// **A 0-based CHARACTER offset into `text`, not git's byte column.** The
    /// conversion is done here because this is the side that still has the
    /// bytes; a frontend handed a byte column would have to re-derive the
    /// encoding of a line it received as a string, and would get every line
    /// with a non-ASCII character before the match wrong.
    pub column: usize,
    /// The matching line. Never more than [`CLIP_CHARS`] characters — see
    /// [`clip`], and `clipped` says when that happened.
    pub text: String,
    pub clipped: bool,
}

/// Everything one search answered, with the bounds it answered under.
///
/// **An `Ok` with no hits is git saying there are none.** That is the whole
/// reason a refusal is an `Err` here rather than an empty list: an empty read is
/// "no answer", never "nothing there", and the pane may only say "no matches"
/// about a value it actually received.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchAnswer {
    /// Echoed back, because the answer arrives asynchronously and the field may
    /// have moved on: a pane that rendered whichever search landed last would
    /// show one query's results under another's name.
    pub pattern: String,
    pub regex: bool,
    pub hits: Vec<SearchHit>,
    /// There were more matches than are here. Set by the hit cap, and also by
    /// the byte budget in `mod.rs` — from the owner's side they are one fact,
    /// and the sentence he is shown counts what he really got rather than
    /// claiming the limit.
    pub capped: bool,
    pub limit: usize,
}

/// The vector `git` is run with, built in one place so a test can assert what
/// is — and is not — in it.
///
/// - `--no-color` because `color.ui = always` in the owner's own config would
///   otherwise put ANSI escapes inside every `text` this returns, and a result
///   row is a string in a webview, not a terminal.
/// - `-I` skips binary files, the same judgement `file_read` makes with its NUL
///   sniff, so the two surfaces agree about which files have text in them.
/// - `--untracked --exclude-standard`: a file an agent has just written is the
///   most interesting thing in a worktree, and an ignored one is noise. The
///   same two flags `vingilot_files::tree` and `vingilot_worktree::diff` use,
///   so all three surfaces answer from one set of ignore rules.
/// - `-F` literal by default, `-E` for the regex toggle, and never both.
///   Literal is the default because most of what he types is a symbol name, and
///   a name containing `.` or `(` searched as a regex quietly matches more than
///   he asked for.
/// - `-e <pattern>` then `--`, so a pattern that begins with a dash is a
///   pattern and a pattern is never read as a ref.
pub fn search_args(pattern: &str, regex: bool) -> Vec<&str> {
    vec![
        "grep",
        "--no-color",
        "-n",
        "--column",
        "-I",
        "-z",
        "--untracked",
        "--exclude-standard",
        if regex { "-E" } else { "-F" },
        "-e",
        pattern,
        "--",
    ]
}

/// git's 1-based byte column, as a 0-based character offset.
///
/// Its own function because it is the one piece of arithmetic in this file that
/// is wrong in a way nothing else would notice: on a line of ASCII the byte and
/// the character agree, so every fixture anybody would write by hand passes
/// whichever it is. A line with an em dash before the match does not.
///
/// Counted over the raw bytes rather than over the decoded string, because the
/// decode is lossy: an undecodable byte becomes a three-byte replacement
/// character, which would move every offset after it.
fn char_column(raw: &[u8], one_based: usize) -> usize {
    if one_based <= 1 {
        return 0;
    }
    let cut = (one_based - 1).min(raw.len());
    String::from_utf8_lossy(&raw[..cut]).chars().count()
}

/// Keep at most `max` characters of a line, windowed on the match, and say
/// whether anything was dropped.
///
/// **Its own function so the window can be proved rather than assumed**, the
/// same split `vingilot_files::tree::capped` and `read::bounded` use: the only
/// fixture that reaches this through a real search is a repository with a
/// minified bundle in it, which is not a temp repo anybody should build — so it
/// would be a bound with no test, which is a bound the next refactor deletes
/// for free.
///
/// The returned column is the match's place in the *window*, so a caller that
/// emphasises from it does not need to know clipping happened.
fn clip(text: &str, column: usize, max: usize) -> (String, usize, bool) {
    let chars: Vec<char> = text.chars().collect();
    if chars.len() <= max {
        return (text.to_string(), column, false);
    }
    // Never past the point where the window would run off the end — a match in
    // the last twenty characters of a three-megabyte line still gets a full
    // window, it is just not centred on it.
    let start = column
        .saturating_sub(CLIP_LEAD)
        .min(chars.len().saturating_sub(max));
    let window: String = chars[start..(start + max).min(chars.len())]
        .iter()
        .collect();
    (window, column.saturating_sub(start), true)
}

/// One `-z` record, or `None` for one this function does not understand.
///
/// **Skipped rather than guessed at.** A path containing a literal newline is
/// legal on every platform this ships to and would split one record into two
/// halves that are not records; inventing a hit out of either would put a row on
/// screen naming a file and a line that do not go together. One dropped row is
/// the honest cost of a filename nobody should have made.
fn one_hit(record: &[u8]) -> Option<SearchHit> {
    let mut fields = record.splitn(4, |byte| *byte == 0);
    let path = fields.next()?;
    let line = fields.next()?;
    let column = fields.next()?;
    let raw = fields.next()?;
    let line: u32 = std::str::from_utf8(line).ok()?.parse().ok()?;
    let column: usize = std::str::from_utf8(column).ok()?.parse().ok()?;
    // A CRLF checkout: the carriage return is part of the line git printed and
    // not part of the line he is reading, and left in it renders as a stray
    // glyph at the end of every row.
    let raw = match raw.split_last() {
        Some((b'\r', rest)) => rest,
        _ => raw,
    };
    let text = String::from_utf8_lossy(raw).into_owned();
    let (text, column, clipped) = clip(&text, char_column(raw, column), CLIP_CHARS);
    Some(SearchHit {
        clipped,
        column,
        line,
        path: String::from_utf8_lossy(path).into_owned(),
        text,
    })
}

/// Every hit in git's output, up to `limit`, and whether there were more.
///
/// `capped` is only true when a **valid** further record was found, so a
/// trailing malformed line cannot put a "there are more" sentence under a
/// complete list.
pub fn parse(stdout: &[u8], limit: usize) -> (Vec<SearchHit>, bool) {
    let mut hits: Vec<SearchHit> = Vec::new();
    for record in stdout.split(|byte| *byte == b'\n') {
        if record.is_empty() {
            continue;
        }
        let Some(hit) = one_hit(record) else {
            continue;
        };
        if hits.len() >= limit {
            return (hits, true);
        }
        hits.push(hit);
    }
    (hits, false)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(path: &str, line: u32, column: usize, text: &str) -> Vec<u8> {
        format!("{path}\0{line}\0{column}\0{text}\n").into_bytes()
    }

    #[test]
    fn the_pattern_is_an_argument_and_never_part_of_a_string() {
        // The whole security claim of this module, expressed as a shape: the
        // pattern is one element of a vector, after `-e`. Nothing here
        // concatenates, quotes or escapes anything, because nothing here builds
        // a string for a shell to read.
        let args = search_args("; rm -rf /", false);
        let at = args
            .iter()
            .position(|arg| *arg == "-e")
            .expect("-e is there");
        assert_eq!(args[at + 1], "; rm -rf /");
        assert_eq!(args.last(), Some(&"--"));
    }

    #[test]
    fn a_pattern_beginning_with_a_dash_is_a_pattern() {
        // `-e` is what makes this true, and it is the reason the pattern is not
        // simply appended: a search for `--force` would otherwise be git being
        // handed an option it does not have.
        let args = search_args("--force", false);
        let at = args
            .iter()
            .position(|arg| *arg == "-e")
            .expect("-e is there");
        assert_eq!(args[at + 1], "--force");
    }

    #[test]
    fn literal_is_the_default_and_the_toggle_is_the_only_way_to_a_regex() {
        let literal = search_args("a.b", false);
        assert!(literal.contains(&"-F"));
        assert!(!literal.contains(&"-E"));

        let regex = search_args("a.b", true);
        assert!(regex.contains(&"-E"));
        assert!(!regex.contains(&"-F"));
    }

    #[test]
    fn the_vector_carries_the_flags_the_answer_depends_on() {
        // Each of these is a promise made in the module header, and each is one
        // deletion away from being quietly untrue: without `-z` the parser
        // reads paths wrong, without `--no-color` a `color.ui = always` config
        // puts escape codes in every row, without `-I` a binary file's bytes
        // reach the webview, and without the two ignore flags this surface
        // disagrees with the Files pane about what is in the checkout.
        let args = search_args("x", false);
        for flag in [
            "--no-color",
            "-n",
            "--column",
            "-I",
            "-z",
            "--untracked",
            "--exclude-standard",
        ] {
            assert!(args.contains(&flag), "{flag} is not in {args:?}");
        }
    }

    #[test]
    fn the_vector_never_carries_a_flag_that_writes_or_leaves_the_checkout() {
        // This module reads one checkout. A future edit reaching for either
        // fails here.
        let args = search_args("x", true);
        for flag in [
            "--no-index",
            "--no-exclude-standard",
            "-O",
            "--open-files-in-pager",
        ] {
            assert!(!args.contains(&flag), "{flag} must not be in {args:?}");
        }
    }

    #[test]
    fn a_record_is_a_path_a_line_a_column_and_the_line_itself() {
        let (hits, capped) = parse(&record("src/main.rs", 12, 5, "let x = 1;"), MAX_HITS);
        assert!(!capped);
        assert_eq!(
            hits,
            vec![SearchHit {
                clipped: false,
                // git's 1-based 5 is the 0-based 4th character.
                column: 4,
                line: 12,
                path: "src/main.rs".to_string(),
                text: "let x = 1;".to_string(),
            }]
        );
    }

    #[test]
    fn a_path_with_a_colon_in_it_still_parses() {
        // The reason `-z` is passed at all: with git's default `:` separator
        // this record is a path of "weird", a line of "12", and a column of
        // "name.rs" — three wrong things and no error anywhere.
        let (hits, _) = parse(&record("weird:name.rs", 12, 1, "x"), MAX_HITS);
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].path, "weird:name.rs");
        assert_eq!(hits[0].line, 12);
    }

    #[test]
    fn a_record_this_parser_does_not_understand_is_skipped_not_guessed_at() {
        let mut payload = b"not-a-record\n".to_vec();
        payload.extend(record("a.rs", 1, 1, "hit"));
        // A record whose line field is not a number: `b.rs` NUL `notanumber`
        // NUL `1` NUL `text`. Written with `\x00` rather than `\0` because
        // `\01` reads as an octal escape to anyone (and to clippy) and this
        // record's whole point is being read exactly as written.
        payload.extend(b"b.rs\x00notanumber\x001\x00text\n");
        let (hits, capped) = parse(&payload, MAX_HITS);
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].path, "a.rs");
        assert!(!capped);
    }

    #[test]
    fn the_column_counts_characters_and_not_bytes() {
        // The case every ASCII fixture passes either way. "— " is three bytes
        // and one character, so git's byte column 6 is the 0-based character 3.
        let (hits, _) = parse(&record("a.rs", 1, 6, "— hi"), MAX_HITS);
        assert_eq!(hits[0].column, 3);
        // And the same line asked about its first column is still the start.
        let (hits, _) = parse(&record("a.rs", 1, 1, "— hi"), MAX_HITS);
        assert_eq!(hits[0].column, 0);
    }

    #[test]
    fn a_carriage_return_is_not_part_of_the_line_he_is_reading() {
        let (hits, _) = parse(&record("a.rs", 1, 1, "let x = 1;\r"), MAX_HITS);
        assert_eq!(hits[0].text, "let x = 1;");
    }

    #[test]
    fn the_cap_keeps_the_first_hits_and_says_that_there_are_more() {
        // "A search that silently truncates is a search that lies about what is
        // in the repo" — the plan's own sentence, and the half of it that a
        // real search cannot reach without a repository of two thousand
        // matches. Three records and a limit of two say the same thing.
        let mut payload = record("a.rs", 1, 1, "one");
        payload.extend(record("b.rs", 2, 1, "two"));
        payload.extend(record("c.rs", 3, 1, "three"));

        let (hits, capped) = parse(&payload, 2);
        assert!(capped, "three hits past a limit of two is capped");
        assert_eq!(hits.len(), 2);
        assert_eq!(hits[1].path, "b.rs");

        // Exactly the limit is not capped — the boundary in the direction that
        // would otherwise put a false "there are more" under every full list.
        let (all, capped) = parse(&payload, 3);
        assert!(!capped);
        assert_eq!(all.len(), 3);

        let (none, capped) = parse(b"", 2);
        assert!(!capped);
        assert!(none.is_empty());
    }

    #[test]
    fn a_trailing_unreadable_record_does_not_claim_there_are_more() {
        let mut payload = record("a.rs", 1, 1, "one");
        payload.extend(record("b.rs", 2, 1, "two"));
        payload.extend(b"garbage\n");
        let (hits, capped) = parse(&payload, 2);
        assert_eq!(hits.len(), 2);
        assert!(!capped, "a record nobody could read is not a further match");
    }

    #[test]
    fn a_line_short_enough_is_left_exactly_as_it_is() {
        let (text, column, clipped) = clip("let x = 1;", 4, CLIP_CHARS);
        assert_eq!(text, "let x = 1;");
        assert_eq!(column, 4);
        assert!(!clipped);
    }

    #[test]
    fn a_long_line_is_windowed_on_the_match_rather_than_on_its_start() {
        // A minified bundle. Clipping from the start would drop the match and
        // leave a row showing four hundred characters of something else — the
        // failure this window exists for.
        let line: String = "a".repeat(5_000);
        let (text, column, clipped) = clip(&line, 3_000, CLIP_CHARS);
        assert!(clipped);
        assert_eq!(text.chars().count(), CLIP_CHARS);
        // The match keeps its lead-in and is inside the window it was clipped
        // around, which is the whole claim.
        assert_eq!(column, CLIP_LEAD);
        assert!(column < CLIP_CHARS);
    }

    #[test]
    fn a_match_near_the_end_of_a_long_line_is_still_inside_the_window() {
        // The boundary the naive `column - CLIP_LEAD` gets wrong: the window
        // would run off the end, and a column past the text it names is a
        // caller emphasising nothing.
        let line: String = "b".repeat(1_000);
        let (text, column, clipped) = clip(&line, 995, CLIP_CHARS);
        assert!(clipped);
        assert_eq!(text.chars().count(), CLIP_CHARS);
        assert!(
            column < text.chars().count(),
            "the match at {column} is outside a window of {}",
            text.chars().count()
        );
    }

    #[test]
    fn a_clipped_line_is_reported_as_clipped_through_the_parser_too() {
        let long: String = "z".repeat(CLIP_CHARS + 10);
        let (hits, _) = parse(&record("big.js", 1, 1, &long), MAX_HITS);
        assert!(hits[0].clipped);
        assert_eq!(hits[0].text.chars().count(), CLIP_CHARS);
    }
}
