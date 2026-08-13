// POSIX shell escaping for a filesystem path dropped onto a terminal
// (vingilot/seams/drag-and-drop.yaml). Pure, so the one thing a path insert
// must never do — let the shell re-interpret a byte of the name — is provable
// without a terminal.
//
// **Single-quote wrapping, and that is the whole rule.** Inside `'…'` every
// byte is literal to every POSIX shell: no `$`, no backtick, no `~`, no glob,
// no word split on the space. The one byte a single-quoted string cannot hold
// is a single quote itself, so each `'` is written by *leaving* the quotes,
// emitting an escaped quote, and going back in — the canonical `'\''`. A name
// that is one quote becomes `''\'''`, which is empty-string ++ quote ++
// empty-string, and a shell reads it as exactly one character.
//
// Unicode, ampersands, semicolons, newlines and every other metacharacter need
// no special case: they are bytes, and bytes inside single quotes are
// themselves. Only the quote is special, because only the quote ends the
// quoting.
//
// **The empty string is `''`, not the empty output.** A path that escaped to
// nothing would vanish into the words around it and change which arguments the
// shell saw; `''` is one empty argument, which is what an empty string is.

/** One path, wrapped so a shell reads it as a single literal argument. */
export function shellEscapePath(path: string): string {
  if (path.length === 0) return "''";
  return `'${path.replaceAll("'", "'\\''")}'`;
}

/** Several paths, each escaped, joined by the one byte that separates arguments
 * — a single space. No trailing space and no newline: what to do with the run
 * of arguments (a space after, never a newline) is the caller's call, because
 * a newline here would submit the line to the shell, and this function's whole
 * point is that a drop inserts and never runs. */
export function shellEscapePaths(paths: readonly string[]): string {
  return paths.map(shellEscapePath).join(" ");
}
