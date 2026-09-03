// OSC 52 — "put this on the clipboard", as a program inside the terminal says
// it (2026-09-03, the owner's "cmd c calismiyor").
//
// **Why the terminal could not copy.** The tmux backing runs with `mouse on`
// (`tmux.rs`, `mouse_on_args`), so a click-drag is reported to tmux rather
// than drawn as a browser selection, and tmux's own drag-end copies the text
// into ITS buffer and — with `set-clipboard on`, which the owner's
// ~/.tmux.conf sets — announces it to the terminal as an OSC 52 sequence.
// xterm.js has no handler for that sequence unless one is registered. So the
// bytes arrived, carried the selection, and were dropped: the drag looked like
// it selected, ⌘C found no browser selection, and nothing reached the
// pasteboard. The same path is how Claude Code, vim and tmux's `y` all copy.
//
// **Reads are refused by construction.** OSC 52 has a query form (`?`) that
// asks the terminal to SEND the clipboard back to the program. Answering it
// would hand whatever the owner last copied — a token, a password — to any
// process in any pane. `osc52Text` returns `null` for it, and the caller
// answers nothing.
//
// Pure so it can be tested without a terminal: the handler in `Terminal.tsx`
// is one line over this.

/** The text an OSC 52 payload asks to place on the clipboard, or `null` when
 * the payload is a read (`?`), names no data, or is not base64.
 *
 * `data` is what xterm hands an OSC handler: everything after `52;` and before
 * the terminator — `Pc ; Pd`, where `Pc` is a selection list (`c` for
 * clipboard, `p` for primary, empty for the default) and `Pd` the base64.
 * The selection is ignored on purpose: this app has one pasteboard. */
export function osc52Text(data: string): string | null {
  const at = data.indexOf(";");
  const payload = at === -1 ? data : data.slice(at + 1);
  if (payload === "" || payload === "?") return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(payload)) return null;
  let bytes: string;
  try {
    bytes = atob(payload);
  } catch {
    return null;
  }
  // `atob` yields a byte string; the program encoded UTF-8, so decode it as
  // such rather than treating each byte as a character.
  const buf = Uint8Array.from(bytes, (c) => c.charCodeAt(0));
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return null;
  }
}
