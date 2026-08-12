//! The shim, run for real, against a recorder rather than against the app.
//!
//! **This is the only test that proves the shipped bytes work.** Everything
//! else in this module tests Rust that decides what the shim *means*;
//! `SHIM_SCRIPT` is a string constant, and a string constant with a typo in its
//! `od` pipeline compiles, installs, and fails silently on the owner's machine
//! at the moment he first trusts it. So it is executed here by the same
//! `/bin/sh` that will run it, with `VINGILOT_OPEN` (the seam documented at
//! `SHIM_SCRIPT`) pointing at a script that writes its one argument to a file
//! and exits — the app is never launched, no window opens, and nothing outside
//! the test's own temp directory is touched.
//!
//! The assertions go through `Url`'s own parser rather than through string
//! comparison on the percent-encoding: what has to be true is that *the app*
//! reads back the bytes the owner typed, and the app reads them with this
//! parser. A test that pinned the exact `%73%72%63` spelling would fail the day
//! the encoder legitimately got better at leaving unreserved bytes alone.

use std::fs;
use std::path::Path;
use std::process::Command;

use tempfile::TempDir;
use url::Url;

use super::{install_into, SHIM_NAME};

fn tempdir() -> TempDir {
    match TempDir::new() {
        Ok(dir) => dir,
        Err(error) => panic!("could not create a temp dir: {error}"),
    }
}

/// A stand-in for `/usr/bin/open` that records the URL it was handed.
fn recorder(dir: &Path) -> std::path::PathBuf {
    let path = dir.join("record-open");
    if let Err(error) = fs::write(
        &path,
        "#!/bin/sh\nprintf '%s' \"$1\" > \"$VINGILOT_RECORD\"\n",
    ) {
        panic!("could not write the recorder: {error}");
    }
    if let Err(error) = fs::set_permissions(
        &path,
        <fs::Permissions as std::os::unix::fs::PermissionsExt>::from_mode(0o755),
    ) {
        panic!("could not make the recorder executable: {error}");
    }
    path
}

/// Run the installed shim from `cwd` with `args`, and give back the URL it
/// asked the OS to open.
fn run(home: &Path, cwd: &Path, args: &[&str]) -> Url {
    let shim = match install_into(home) {
        Ok(path) => path,
        Err(error) => panic!("install refused: {error}"),
    };
    assert_eq!(
        shim.file_name().and_then(|name| name.to_str()),
        Some(SHIM_NAME)
    );
    let record = home.join("recorded-url");
    let open = recorder(home);

    let status = Command::new(&shim)
        .args(args)
        .current_dir(cwd)
        .env("VINGILOT_OPEN", &open)
        .env("VINGILOT_RECORD", &record)
        .status();
    match status {
        Ok(status) if status.success() => {}
        other => panic!("the shim did not run cleanly: {other:?}"),
    }

    let raw = match fs::read_to_string(&record) {
        Ok(raw) => raw,
        Err(error) => panic!("the recorder wrote nothing: {error}"),
    };
    match Url::parse(&raw) {
        Ok(url) => url,
        Err(error) => panic!("the shim produced {raw:?}, which is not a URL: {error}"),
    }
}

/// The one query parameter, decoded — which is the form `deep_link.rs` reads.
fn param(url: &Url, name: &str) -> String {
    url.query_pairs()
        .find(|(key, _)| key == name)
        .map(|(_, value)| value.into_owned())
        .unwrap_or_else(|| panic!("{url} has no {name}"))
}

/// What a shell standing in `dir` reports as `$PWD`.
///
/// **Not `dir` itself.** On macOS a temp directory is under `/var/folders/…`
/// and `/var` is a symlink to `/private/var`, so the shell's `getcwd` answers
/// with the resolved path while the test holds the unresolved one. Comparing
/// the two directly is a test that fails for a reason that has nothing to do
/// with the shim.
fn as_the_shell_sees_it(dir: &Path) -> String {
    match fs::canonicalize(dir) {
        Ok(path) => path.to_string_lossy().into_owned(),
        Err(error) => panic!("could not resolve {}: {error}", dir.display()),
    }
}

#[test]
fn the_shim_asks_the_os_to_open_a_buzz_link_this_app_already_handles() {
    let home = tempdir();
    let cwd = tempdir();
    let url = run(home.path(), cwd.path(), &["src/main.rs:412"]);

    assert_eq!(url.scheme(), "buzz");
    assert_eq!(url.host_str(), Some("open"));
    assert_eq!(param(&url, "arg"), "src/main.rs:412");
    // The cwd is the shim's whole contribution to resolution: the app cannot
    // know which directory the terminal was standing in.
    assert_eq!(param(&url, "cwd"), as_the_shell_sees_it(cwd.path()));
}

#[test]
fn a_bare_vingilot_is_the_current_directory() {
    let home = tempdir();
    let cwd = tempdir();
    // The two spellings the help text promises are the same thing.
    for args in [vec![], vec!["."]] {
        let url = run(home.path(), cwd.path(), &args);
        assert_eq!(param(&url, "arg"), ".", "for {args:?}");
    }
}

#[test]
fn a_path_the_url_grammar_would_eat_survives_byte_for_byte() {
    // The reason the encoder is a byte dump and not a character loop. Each of
    // these ends the query, ends the URL, or changes its meaning if it reaches
    // the URL unencoded — and every one of them is legal in a macOS filename.
    let home = tempdir();
    let cwd = tempdir();
    for arg in [
        "a file with spaces.rs",
        "tools/build&deploy.sh",
        "notes#draft.md",
        "query?.sql",
        "yüzde100/şema.sql",
        "a'quote\"and`tick.txt",
        "percent%20literal.txt",
    ] {
        let url = run(home.path(), cwd.path(), &[arg]);
        assert_eq!(param(&url, "arg"), arg, "{arg} did not survive the shim");
    }
}

#[test]
fn a_directory_whose_name_would_break_the_url_survives_too() {
    // The cwd goes through the same encoder and is the parameter a relative
    // path is resolved against, so it is the one whose corruption would be
    // silent — the app would look in a directory one character different.
    let home = tempdir();
    let outer = tempdir();
    let cwd = outer.path().join("re & search #1");
    if let Err(error) = fs::create_dir(&cwd) {
        panic!("could not create {}: {error}", cwd.display());
    }
    let url = run(home.path(), &cwd, &["main.rs"]);
    assert_eq!(param(&url, "cwd"), as_the_shell_sees_it(&cwd));
}
