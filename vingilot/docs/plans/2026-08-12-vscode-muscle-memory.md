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

## Task 0 — Bring the viewer to life

He opened a 726-line file and got plain text with an apology. His words: *"biraz hayata ihtiyacı
var. highlighting. şuan çok cansız."*

The cause is inherited, not chosen: the viewer reuses `SyntaxHighlightedCode` from
`shared/ui/markdown/CodeBlock.tsx`, whose `MAX_HIGHLIGHT_LINES = 150` was sized for a **chat
message**, and whose `codeToTokens` runs synchronously on the main thread. `fileViewer.ts`'s
header lays out all three costs honestly — the fix is to stop paying them, not to re-document them.

- [ ] **Highlight asynchronously, off the render path.** Render the file as plain text
      immediately (the pane must never wait on a tokeniser), then tokenise in the background and
      swap spans in when ready. Chunked (`requestIdleCallback` or a worker — measure, then pick,
      and write the measurement down), so a 5,000-line file never blocks the terminal beside it.
      The 150-line ceiling dies with the synchronous path; the ceiling that remains is the
      backend's 512 KiB read cap and a stated tokenise budget, not a chat-message constant.
- [ ] **Do not fork the highlighter.** One Shiki singleton, one grammar cache, still shared with
      markdown. What changes is *when* it is asked, not *what* is asked. If `CodeBlock.tsx` needs
      an export or an async variant, that is one small upstream touch with a seams entry — better
      than a second highlighter.
- [ ] The plain-text fallback sentence survives for the cases that remain (binary, over the read
      cap, unknown grammar) — but a file the viewer *chose* not to highlight must no longer exist.
- [ ] While in there: the viewer's copy says "to keep the terminal responsive" — it is a file
      viewer, not a terminal; fix the sentence.
- [ ] Tests: the swap (plain → highlighted) asserted; a large-file fixture proving the render
      commits before tokenising finishes; the remaining fallback sentences pinned.

## Task 1 — ⌘F: find in the thing I am looking at

Not ⌘⇧F (the project search, already built). ⌘F searches **the open pane**.

- [x] In the Files viewer: a find bar (top-right of the pane, VS Code's spot), match count
      ("3/17"), Enter/⇧Enter to walk matches, Esc closes and returns focus to the viewer.
      Case-insensitive until the query has an uppercase letter (smart case — say so in a title).
      Highlight all matches, emphasize the current one. The match walk must scroll the viewer.
      **Built: `lib/findInFile.ts` (the match model, over `file.text` and never over Task 0's
      rendered spans), `lib/findKeys.ts` (the chord and the bar's three keys), `lib/useFindInFile.ts`
      (the state and the ⌘F boundary), `ui/FindBar.tsx`, and the amber in `ui/FilesPane.tsx`'s
      `Painted`. Smart case reads `query !== query.toLowerCase()` rather than `/[A-Z]/`, so it works
      in Turkish; the case fold is per code point so `İ` cannot shift an offset. Esc returns focus
      to the viewer's scrolling body, which became focusable for exactly that.**
- [x] In the terminal: xterm ships `@xterm/addon-search`. Read what the app already loads before
      adding it; if the addon is cheap, the same ⌘F in a terminal pane opens the same find bar and
      walks the scrollback. If it is not cheap, say what it costs and stop — the viewer is the
      must-have, the terminal is the nice-to-have. **Measured 2026-08-12, and stopped here. See
      "What the terminal find costs" below.**
- [x] ⌘F must keep working in panes that have their own text inputs (notes, plan): there it falls
      through to the browser/editor default rather than being stolen. **The boundary is
      `lib/useFindInFile.ts`'s `ownsChord`, argued in `lib/findKeys.ts`'s header: a capture-phase
      window listener that claims ⌘F only when the Files pane has a file open AND the keydown's
      target is inside that pane's root (or nothing is focused at all). Everything else — the notes
      and plan panes, the team thread's hosted composer, the palette's field, xterm's own textarea —
      keeps the chord because none of them is inside `pane-files`.**
- [x] Tests: unit tests for the match model (smart case, count, wrap-around); a Playwright spec
      driving the viewer find bar end to end. **`lib/findInFile.test.mjs`, `lib/findKeys.test.mjs`,
      `desktop/tests/e2e/workspace-find.spec.ts`.**

### What the terminal find costs (measured 2026-08-12)

Asked and answered, so the nice-to-have is deferred on numbers rather than on a feeling.

**What the app loads today.** `desktop/package.json` names exactly two xterm packages —
`@xterm/xterm@^5.5.0` and `@xterm/addon-fit@^0.10.0` — and `pnpm-lock.yaml` resolves exactly
those two and nothing else (`grep xterm pnpm-lock.yaml`: six lines, four of them the same two
packages). `node_modules/@xterm/` holds `addon-fit` and `xterm`. So **`@xterm/addon-search` is
not installed and is not in the lockfile**: it is a new dependency, not an unlock of one already
paid for.

**What the package weighs.** `@xterm/addon-search@0.15.0` is the version that fits: it declares
`peerDependencies: { "@xterm/xterm": "^5.0.0" }`, which the installed 5.5.0 satisfies, and its
shipped bundle (`lib/addon-search.js`) is **12,067 bytes** — genuinely small. The current
`0.16.0` is the trap: it declares **no** peer range at all and ships **no `files` field**, so its
tarball is 838,673 bytes unpacked (src and source maps included) and its `lib/addon-search.js`
alone is 78,826 bytes. `0.17.0` is beta-only (299 betas and no release).

**So the bundle is not the cost. The cost is where the change lands.** Adding it edits
`desktop/package.json` and regenerates `pnpm-lock.yaml` — both upstream paths, both already
seamed, and both seam entries name the current dependency set in their `reason`, so the touch is
two file edits plus two prose updates. That needs an install (network, lockfile churn, a
`node_modules` write) on a machine where the owner's `tauri dev` is running, which is not a thing
to do unilaterally for a nice-to-have. Beside that:

- the terminal find is a **different find**: xterm's `SearchAddon` owns its own match set, its own
  decorations and its own "current match" inside the canvas, so the bar could be shared but the
  model could not — `findInFile.ts` searches a string the app already has, and there is no
  equivalent string for a live PTY;
- and it competes for the same chord from inside xterm's keyboard grab, which is the one place the
  boundary above deliberately does *not* claim ⌘F today.

**Recommendation:** a follow-up task of its own, pinned to `@xterm/addon-search@0.15.0` for the
peer range, with the two seam reasons updated in the same change. The viewer is the must-have and
it is done.

## Task 2 — VS Code-style diff: side by side

The screenshot he sent is VS Code's split diff. Ours is a unified patch. The one-column merge
bought the diff pane 243→435px; a 16-inch window now has room for split at full-screen diff view,
but not always in a side pane — so this is a **mode, chosen honestly**:

- [x] A unified/split toggle on the diff pane (and the commit diff, which reuses the same
      renderer — one renderer, still). Split renders old/new columns with aligned hunks,
      VS Code's gutter colors (red strip = removed, green = added), intraline emphasis if the
      patch data already carries it — do not build a word-diff engine for this.
      **Built: `mode` is a prop of `ui/PatchView.tsx` and both layouts live in that one file —
      the self-review's "second diff renderer" was the thing to avoid, so the Diff pane, a
      commit's per-file patches and a source-control file's patch all got split at once.
      `lib/splitDiff.ts` is the row model, over the same `diffView` classification the unified
      rendering reads. The strip is a *border* colour (`border-status-added` /
      `border-status-deleted`), so it is the theme's own diff token rather than a second green.
      No word-diff: a unified patch carries no intraline data and no row claims any — said out
      loud in `splitDiff.ts`'s header. The layout is a CSS grid, because a grid is the only one
      of the three candidates that keeps the sides aligned when a half-width cell wraps AND
      never clips a long line; the two rejected alternatives are argued in `SplitBody`.**
- [x] **Width is a precondition, not a hope.** Split is offered only when the pane is wide enough
      for two readable columns (state the number and where it came from — `PATCH_MIN_PX` and the
      recorded pane arithmetic in `diffLayout.ts` are the prior art). Below it, the toggle says
      why it is disabled rather than disappearing.
      **`SPLIT_MIN_PX` = 695px, derived in `diffLayout.ts` and not chosen: `PATCH_MIN_COLUMNS`'s
      60 is a floor against *horizontal scrolling* and a split column wraps instead, so the 60 is
      not the number to double. `SPLIT_MIN_COLUMNS` is **38** — the median length of the 28,634
      non-blank lines of `desktop/src/features/runs/**` (p75 73, p90 78, which is biome's print
      width) — twice, plus two `w-12` gutters, two `pr-2`s, the 1px divider and the scroller's
      `px-4`. At 1728×1117 that refuses the 435px side pane and allows the 871px patch ⇧⌥⌘B
      gives, which is this task's opening sentence as arithmetic. Asked through the placement
      *with the split floor*, which is what makes the offer monotonic — asked through the unified
      one, growing the pane from 641 to 642px would have taken split away. Refused, the toggle is
      `disabled` with `splitRefusal`'s sentence on its own line of the header and the derivation
      in its `title`.**
- [x] The choice is remembered (one flag, not per-file), and the default stays unified — split is
      the wide-screen luxury, unified is the one that always fits.
      **`lib/diffMode.ts` — one module singleton, `localStorage`-mirrored under
      `vingilot-diff-mode.v1`, read by both panes through `lib/useDiffMode.ts`. Not per file, so
      the layout does not change under him on every `Enter` of a forty-file worktree. A pane too
      narrow *declines* the choice rather than clearing it (`effectiveDiffMode`), so ⇧⌥⌘B back out
      returns split without choosing it twice.**
- [x] Tests: the spec pins both modes at his 1728px width and the disabled-toggle sentence at a
      width where split cannot fit.
      **`lib/splitDiff.test.mjs` (13, the alignment model — uneven blocks pair per block and the
      leftover side is a gap), `lib/diffMode.test.mjs` (5), seven more in `lib/diffLayout.test.mjs`
      (the precondition from both sides, monotonicity over 1…3000px, the refusal's words, and
      that the unified numbers did not move when the floor became a parameter). Three tests added
      to `tests/e2e/workspace-diff-fits.spec.ts` — the toggle on screen and unavailable with its
      sentence at his own width, the two columns drawn and *aligned* (the addition on the same row
      as the first deletion, three resolved colours, halves to within a pixel, nothing clipped),
      and the flag declined-then-honoured across two ⇧⌥⌘B presses — and one to
      `tests/e2e/workspace-history.spec.ts`, where the fixture's block is uneven the other way so
      the gap falls on the left.**

## Task 3 — ⌃Tab: the most-recently-used switcher

"⌘Tab tarzı bir şey" — **⌘Tab itself is macOS's app switcher and cannot be intercepted**, so the
binding is **⌃Tab**, which is exactly what VS Code uses for this gesture. The unit of switching
is a *place*: worktree + pane (+ file, when the pane is Files).

- [x] Hold ⌃, press Tab: an overlay lists recent places, MRU order, most recent first. Another
      Tab steps down; ⇧Tab steps up; releasing ⌃ lands on the highlighted place. A tap of ⌃Tab
      (press+release) goes straight to the previous place — the alt-tab reflex.
      **Built: `lib/placeMru.ts` (the MRU as a pure reducer), `lib/placeKeys.ts` (the chord;
      rejects ⌘ via `metaKey` and ⌥ via `altKey` rather than `primaryModifier` — on non-mac the
      primary modifier IS ⌃, so the old reading left the chord dead there, and the same bug
      lived in `resolvePlaceListKey`, where Esc arrives with ⌃ held), `lib/usePlaceSwitcher.ts`
      (hold-vs-tap semantics on keyup), `ui/PlaceSwitcher.tsx`. This section was ticked by the
      coordinator from the audit-fix reports — the implementer's own turn predates this note.**
- [x] The MRU list is fed by real navigation (worktree selected, pane switched, file opened), not
      by polling; capped (say 12); survives nothing — it is a session reflex, not state worth
      persisting. Say so in the code.
      **Fed where navigation actually happens in `RunsScreen`; a Files pane with no file open now
      reports its emptiness (`PaneAct`'s `file-opened` carries `string | null`) rather than
      wearing the previous file's name — the stale path also produced a phantom MRU entry that
      put the wrong row under a back-tap, proved and fixed in the audit round. Cap 12, not
      persisted, both said in `placeMru.ts`.**
- [x] The overlay is drawn where ⌘K is drawn and obeys the same stacking rules — it must not
      repeat the palette-under-the-channel defect (`workspace-palette-over-thread.spec.ts` is the
      prior art).
- [x] Tests: unit tests for the MRU model (dedupe, cap, tap-vs-hold); a Playwright spec for the
      overlay, the landing, and the stacking.
      **`lib/placeMru.test.mjs`, `lib/placeKeys.test.mjs`, `tests/e2e/workspace-places.spec.ts`
      (overlay over an open team thread, walk and land, tap returns). The self-review's named
      risk — ⌃Tab against xterm's keyboard grab with a terminal focused — is handled in
      `terminalKeys.ts` but was not separately proven in the spec; noted as an open edge.**

## Task 4 — Scratch markdown

The scratch terminal's sibling: one throwaway markdown buffer, one gesture away, for the thing he
is holding in his head *right now*.

- [x] One global buffer (not per worktree — the scratch's whole point is that it follows him),
      autosaved to `~/.vingilot/scratch.md` with debounce, restored on open. Local file, never the
      relay: a work machine's scratch must not leave the machine.
      **Built: `src-tauri/src/vingilot_scratch/mod.rs` (`scratch_read`/`scratch_write` — the path is
      not a parameter in either direction, which is the whole of the path safety: the read takes
      nothing and the write takes only the text, so `vingilot_files::inside` has no route to guard.
      Bounds modelled on `vingilot_files/read.rs`: `metadata` before the open, the read itself
      stopping one byte past a 256 KiB ceiling *derived* from `MAX_DOCUMENT_CHARS`, a write that
      refuses rather than truncates, and a temp-plus-rename so an interrupted save leaves the
      previous buffer whole), `lib/scratchClient.ts` (the only two calls that ever see the text),
      `lib/scratchMarkdown.ts` (the path and the copy), `lib/scratchAutosave.ts` (the debounce over
      an asynchronous write: `SaveState`/`DEBOUNCE_MS`/`CEILING_MS` imported from `autosave.ts`
      rather than copied, one write at a time, `saved` said from the answer and never from the
      asking), `lib/useScratchMarkdown.ts` (a module singleton, not React state — so the overlay
      closing, the route change and the community remount cannot lose a buffer with a debounce still
      armed). Never the relay, argued in three headers: nothing in the module opens a socket, and
      the spec asserts a canary in the typed text reaches no `fetch` body, no WebSocket frame and no
      other `invoke`.**
- [x] Reuse the document editor the notes/plan panes already use (`DocumentEditor.tsx`) — same
      editing surface, zero new editor code. Preview follows however the notes pane already does it.
      **Built: `ui/ScratchMarkdown.tsx` renders `DocumentEditor` with `testId="scratch-md"` and
      nothing else — same textarea, same character cap, same three save-state sentences, same
      preview. The two lines that are this buffer's rather than a document's are its `placeholder`
      and its `scope`, both in `scratchMarkdown.ts`. A refused read draws a sentence and *no*
      editor, because a keystroke accepted there would arm an autosave over a file this build could
      not open.**
- [x] Opened the way the scratch terminal opens (read `useScratchTerminal`/its chord for the
      pattern) and closed the same way; the two scratches must feel like siblings, and ⌘K lists it.
      **Built: `lib/scratchMarkdownKeys.ts`. The chord is ⌥⌘M — the scratch shell's ⌥⌘T with the
      letter of its own thing, on the same modifier prefix, one key to the left on the same row and
      the same hand shape; the four-claimant check (muda's predefined menu table, `AppShell.tsx`'s
      window handler, the app's other global maps, this island's own maps) is re-run for M in that
      module's header, and ⌘M *is* the menu's minimize while ⌥⌘M is nobody's. Same overlay frame,
      same scrim, same header-and-footer shape, same container-scoped capture listener and the same
      `shield` vocabulary as `ScratchTerminal.tsx`; the one deliberate difference is Escape, which
      closes here because a terminal owns Escape and a textarea does not. ⌘K lists it directly under
      "Scratch terminal" (`paletteSources.ts`), and the cheatsheet generates its row from the map
      (`cheatsheet.ts`).**
- [x] Tests: autosave/restore unit-tested against a temp path; a spec for open-type-close-reopen.
      **`lib/scratchAutosave.test.mjs` (10 tests over an injected clock and a write the test answers
      by hand), `lib/scratchMarkdownKeys.test.mjs` (10), `vingilot_scratch/mod.rs`'s own 13 cargo
      tests against `TempDir` homes — the one path, the ceiling in both directions, and the four
      refusals — and `tests/e2e/workspace-scratch-markdown.spec.ts` (6 readings: open-type-close-
      reopen with real keystrokes, the buffer surviving a page reload which is the only way to say
      the *file* was read, one buffer on the landing view and after opening a project, the privacy
      canary, the palette door and its printed promise, and a refused read drawing a sentence with
      no editor over it).**

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
