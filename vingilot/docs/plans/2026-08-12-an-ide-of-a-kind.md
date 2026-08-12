# An IDE of a kind — the ladder, as work

> **For agentic workers:** implement task-by-task. Steps use checkbox (`- [ ]`) syntax.
> **Decided in:** `vingilot/docs/adr/ADR-005-what-kind-of-ide.md`. Read it first; it is the test
> every sub-decision here is held against.
> **Order in the queue:** after `2026-08-12-polish-the-right-side.md` and the muscle-memory plan.

## Task 1 — The escape hatch, both directions

The cheapest trust in the plan.

- [x] **Out:** "Open in editor" wherever a file is shown — Files viewer header, search hit,
      diff file row, source-control (status) row — opening Cursor/VS Code/Zed at file:line.
      `vingilot_editor` probes `cursor`, `code`, `zed` on PATH *and* in the well-known install
      locations (`tmux.rs`'s rule: a Finder-launched app has no login shell's PATH), caches the
      answer for the app run, and launches with an **arg vector** — never a shell string. The
      webview names only a validated editor id (`vingilot_scratch`'s closed-route model); the
      file goes through `vingilot_files::inside`. The choice is remembered in
      `lib/editors.ts` (diff-mode's storage shape) and is asked exactly once when several are
      installed. **`open -a` is not a fallback**: it cannot carry a line, and file:line is the
      whole rung — no editor found is `vingilot_editor::no_editor`'s sentence.
- [x] **Chord: none, and the check is why.** ⇧⌘O is upstream's (`AppShell.tsx`, `key === "o"
      && event.shiftKey`). ⌥⌘O passes the documentary half of the claimant check — not in
      muda's table, not an ⌥-variant AppKit synthesizes (that rule is Window-menu items; ⌘O is
      not one), held by no map in this island — but the empirical half cannot be run without
      launching the app, and ⌘W and ⌥⌘M were both lost to claimants a *reading* could not see.
      The gesture is also per-row: a window-level key would have to guess which of four
      surfaces is its subject. So: buttons on the four surfaces, plus a ⌘K row. Argued in
      `ui/OpenInEditor.tsx`'s header.
- [x] **In:** a `vingilot` CLI shim (`vingilot_shim`), five lines of `#!/bin/sh` in
      `~/.vingilot/bin`, prepended to **our** terminals' PATH by `vingilot_pty`'s spawn env.
      ⌘K *"Install vingilot command…"* symlinks it into `/usr/local/bin` after he asks, and
      prints the `ln -s` line when the directory refuses — nothing here runs `sudo`.
      `vingilot <file>[:line]` lands in the Files viewer; `vingilot .` resolves against known
      projects and worktrees (`lib/openTarget.ts`, pure). One honest gap: the OS folder picker
      takes no starting path, so an unknown directory gets the sentence naming it *and* the
      add-project dialog, rather than a pre-filled one.
- [x] Tests: `lib/openTarget.test.mjs` (resolution) and `lib/editors.test.mjs` (the pick) are
      pure; `vingilot_editor`'s cargo tests cover every refusal; `vingilot_shim`'s
      `recorder_tests.rs` runs the **shipped script** under `/bin/sh` with `VINGILOT_OPEN`
      pointed at a recorder; `tests/e2e/workspace-open-in-editor.spec.ts` reads the button, the
      ask-once menu, the disabled no-editor control and the door in.

### How the shim reaches the app — the choice, and what was rejected

**Chosen: `buzz://open?arg=…&cwd=…`, handed to `/usr/bin/open`.** Least new surface by a wide
margin, because it adds none: the `buzz://` scheme is already registered by the bundle,
`deep_link.rs` already parses and dispatches those URLs, and macOS already routes them to the
running instance (launching it first when it is down, which is what a terminal command should
do anyway). The seam in `deep_link.rs` is one arm; the parameters, the resolution and the
payload live in `vingilot_shim`.

Rejected:

- **A 127.0.0.1 HTTP listener** (the media proxy already binds one). Needs a new inbound
  socket, a port the shim can discover (a port file, with its staleness problem) and a token —
  a loopback port is reachable by every process on the machine, so "show this file" becomes an
  unauthenticated local RPC unless defended. Three mechanisms and a trust boundary, for a
  message the OS carries for free.
- **A new `vingilot://` scheme.** A second registration in `Info.plist` and `tauri.conf.json`,
  a second scheme for macOS to arbitrate between two installed builds, and a rename to do
  twice when the fork's rebrand lands.
- **A unix socket or a drop file under `~/.vingilot`.** The same discovery and staleness
  problems as the port, plus a lifecycle (who removes the socket after a crash) and a watcher
  in the app — and it cannot start the app, which `open` does.

The one cost: `open` returns to the shim before the app answers, so a refusal cannot be printed
in the terminal. That is why the refusal is a sentence *in the app* (`escape-hatch-notice`).

## Task 2 — One palette engine, three doors

- [x] Extract the workspace palette's engine (input, ranking, keyboard loop, row rendering) so
      it can host multiple *sources* — it already half-does this (`paletteSources.ts`).
- [x] **⌘K = go**, one behaviour app-wide: channels (upstream's switcher entries), projects,
      worktrees, recent files. This replaces the route-split where ⌘K means upstream's dialog in
      chat and ours in the workspace — the owner named it: *"cmd k buzz kısmında farklı deck
      kısmında farklı çalışıyor."* Hosting upstream's channel list as a source, not rewriting
      their dialog (ADR-001 discipline; seams entry for the swap point).
- [x] **⌘P = files** in the selected worktree (the Files pane's listing is the source),
      **⌘⇧P = commands** (today's actions). Prefix grammar inside any door: `>` commands,
      `#` channels — VS Code's own.
- [x] The cheatsheet and the palette teach the grammar (one hint row, not a tutorial).
- [x] Tests: source-merging and prefix routing unit-tested; a spec per door; the chat-side ⌘K
      spec updated deliberately (its old assertion described the split this removes).

## Task 3 — Light editing in the viewer

- [ ] CodeMirror 6 in the Files viewer behind an explicit edit toggle (`e` / a pencil affordance
      — reading stays the default and stays instant). Same Shiki-adjacent look: reuse the theme
      tokens, not a second color scheme.
- [ ] Save writes through a new bounded Rust command (`file_write`: refuses over-cap, binary,
      and paths outside the worktree — same refusal-sentence style as `file_read`). Dirty state
      is visible; ⌘S saves; closing with unsaved changes asks.
- [ ] **The scope sentence is part of the feature:** no format-on-save, no completions, no
      multi-file operations. One file, opened, fixed, saved. The plan's test for creep: if a
      change needs a second file open for editing, it is the escape hatch's job.
- [ ] Tests: the write command's refusals (cargo, against a temp repo); an e2e: open → edit →
      save → the diff pane sees the change (the loop that proves the surfaces compose).

## Task 4 — LSP in service of reading (gated: design first)

- [ ] A design note before any code: which servers (rust-analyzer, tsserver/vtsls, gopls —
      detected, never installed by us), lifecycle per worktree, cost when several worktrees are
      open, and what happens when the server is absent (an honest sentence, not a spinner).
- [ ] First and only first: **hover + go-to-definition in the diff and the viewer**, and a
      diagnostics list per worktree. Nothing that writes. Completions are refused by ADR-005.
- [ ] This task does not start until Tasks 1–3 shipped and the owner re-approves — it is the
      expensive rung and the ladder is the point.

---

## Global Constraints

The standing set: `rm -rf` forbidden; never launch the app; no release builds; agents never
commit; island + seams; stock rem tokens (`pnpm check:px-text`); 1000-line ratchet; an empty
read is "no answer"; a test must be able to fail (one designated mutation agent); gates to real
exit codes; never bare `biome`; no commit stamps inside 08:00–18:00 Europe/Istanbul.

## Self-Review

**Riskiest:** Task 2's chat-side ⌘K. It is the first deliberate replacement of an upstream
gesture app-wide; done as a rewrite it breaks ADR-001, done as hosting it needs one careful seam.
The mitigation is written into the task: upstream's channel list is a *source*, their dialog is
not rewritten.

**Most likely to be got wrong quietly:** Task 3 growing an editor. The one-sentence scope is in
the task so that a verifier can hold a diff against it; any completion popup, any second pane of
editable text, is a finding regardless of how useful it looks.
