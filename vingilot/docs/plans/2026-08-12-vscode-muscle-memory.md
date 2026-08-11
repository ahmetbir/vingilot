# VS Code muscle memory — the four gestures still missing

> **For agentic workers:** implement task-by-task. Steps use checkbox (`- [ ]`) syntax.
> **Branch:** off `main` after `finding-things` lands — every task here assumes the Files pane,
> the Search pane and the History pane from `2026-08-11-what-sent-him-to-vscode.md` exist.

**Goal:** he named the residue after a day of real work in the app:

> *"dosya görüntüleme, tree, cmd F, scratch md, belki şöyle cmd tab tarzı bir şey. vscode tarzı
> diff ve history eksikliği. genel olarak vscode alışkanlığı eksikliği."*

File viewing, tree, project search and history are in flight. What is left is the *hands* —
four gestures VS Code trained into him that this app answers with nothing.

---

## Task 1 — ⌘F: find in the thing I am looking at

Not ⌘⇧F (the project search, already built). ⌘F searches **the open pane**.

- [ ] In the Files viewer: a find bar (top-right of the pane, VS Code's spot), match count
      ("3/17"), Enter/⇧Enter to walk matches, Esc closes and returns focus to the viewer.
      Case-insensitive until the query has an uppercase letter (smart case — say so in a title).
      Highlight all matches, emphasize the current one. The match walk must scroll the viewer.
- [ ] In the terminal: xterm ships `@xterm/addon-search`. Read what the app already loads before
      adding it; if the addon is cheap, the same ⌘F in a terminal pane opens the same find bar and
      walks the scrollback. If it is not cheap, say what it costs and stop — the viewer is the
      must-have, the terminal is the nice-to-have.
- [ ] ⌘F must keep working in panes that have their own text inputs (notes, plan): there it falls
      through to the browser/editor default rather than being stolen.
- [ ] Tests: unit tests for the match model (smart case, count, wrap-around); a Playwright spec
      driving the viewer find bar end to end.

## Task 2 — VS Code-style diff: side by side

The screenshot he sent is VS Code's split diff. Ours is a unified patch. The one-column merge
bought the diff pane 243→435px; a 16-inch window now has room for split at full-screen diff view,
but not always in a side pane — so this is a **mode, chosen honestly**:

- [ ] A unified/split toggle on the diff pane (and the commit diff, which reuses the same
      renderer — one renderer, still). Split renders old/new columns with aligned hunks,
      VS Code's gutter colors (red strip = removed, green = added), intraline emphasis if the
      patch data already carries it — do not build a word-diff engine for this.
- [ ] **Width is a precondition, not a hope.** Split is offered only when the pane is wide enough
      for two readable columns (state the number and where it came from — `PATCH_MIN_PX` and the
      recorded pane arithmetic in `diffLayout.ts` are the prior art). Below it, the toggle says
      why it is disabled rather than disappearing.
- [ ] The choice is remembered (one flag, not per-file), and the default stays unified — split is
      the wide-screen luxury, unified is the one that always fits.
- [ ] Tests: the spec pins both modes at his 1728px width and the disabled-toggle sentence at a
      width where split cannot fit.

## Task 3 — ⌃Tab: the most-recently-used switcher

"⌘Tab tarzı bir şey" — **⌘Tab itself is macOS's app switcher and cannot be intercepted**, so the
binding is **⌃Tab**, which is exactly what VS Code uses for this gesture. The unit of switching
is a *place*: worktree + pane (+ file, when the pane is Files).

- [ ] Hold ⌃, press Tab: an overlay lists recent places, MRU order, most recent first. Another
      Tab steps down; ⇧Tab steps up; releasing ⌃ lands on the highlighted place. A tap of ⌃Tab
      (press+release) goes straight to the previous place — the alt-tab reflex.
- [ ] The MRU list is fed by real navigation (worktree selected, pane switched, file opened), not
      by polling; capped (say 12); survives nothing — it is a session reflex, not state worth
      persisting. Say so in the code.
- [ ] The overlay is drawn where ⌘K is drawn and obeys the same stacking rules — it must not
      repeat the palette-under-the-channel defect (`workspace-palette-over-thread.spec.ts` is the
      prior art).
- [ ] Tests: unit tests for the MRU model (dedupe, cap, tap-vs-hold); a Playwright spec for the
      overlay, the landing, and the stacking.

## Task 4 — Scratch markdown

The scratch terminal's sibling: one throwaway markdown buffer, one gesture away, for the thing he
is holding in his head *right now*.

- [ ] One global buffer (not per worktree — the scratch's whole point is that it follows him),
      autosaved to `~/.vingilot/scratch.md` with debounce, restored on open. Local file, never the
      relay: a work machine's scratch must not leave the machine.
- [ ] Reuse the document editor the notes/plan panes already use (`DocumentEditor.tsx`) — same
      editing surface, zero new editor code. Preview follows however the notes pane already does it.
- [ ] Opened the way the scratch terminal opens (read `useScratchTerminal`/its chord for the
      pattern) and closed the same way; the two scratches must feel like siblings, and ⌘K lists it.
- [ ] Tests: autosave/restore unit-tested against a temp path; a spec for open-type-close-reopen.

---

## Global Constraints

Same as `2026-08-11-one-column-and-loose-ends.md`: `rm -rf` forbidden; never launch the app; no
release builds; read-only against real repos; never `git add -A`; no commits by agents; island +
seams; rem tokens only; 1000-line ratchet; an empty read is "no answer"; every test proved able
to fail by the one designated mutation agent; gates run to real exit codes (`pnpm check`, not
`biome check src` — and never bare biome, the shell hook wraps it).

## Self-Review

**Riskiest:** Task 3's key handling. ⌃Tab inside a webview competes with the browser's own tab
handling and with xterm's keyboard grab when a terminal is focused; the design must say what
happens when the terminal has focus (probably: the overlay still wins, because switching places
is why the gesture exists) and prove it in the spec.

**Most likely to be got wrong quietly:** Task 2 shipping a second diff renderer. The commit diff,
the worktree diff and the split view are one renderer with two layouts, or the next patch feature
gets built twice and drifts.
