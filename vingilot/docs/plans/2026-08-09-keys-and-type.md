# The keys you can find, and type you can read

> **For agentic workers:** implement task-by-task. Steps use checkbox (`- [ ]`) syntax.
> **Branch:** `vingilot/keys-and-type` off `vingilot/team-thread`.

**Goal:** Four things the owner hit on 2026-08-09, after using the workspace for real:

> *"kısayol cheatsheeti için kısayol lazım :d cheetsheeti de yap kısayolda. scratch terminali
> kapatırken cmd w denedim komple tüm buzz windowu gitti geri de getiremedim mecbur quit attım.
> henüz team'i denemedim. ama yeni yaptığın her yerde bi font sıkıntısı var. bazıları kücücük
> bazıları büyük. ayrıca cmd k daha göze hitap etmeli ve okuması kolay olmalı."*

---

## Task 1 — ⌘W must not cost him the window (do this first)

**What happened, mechanically.** ⌘W is `close_window` in Tauri's *default* macOS menu, which
this app never replaces. The island deliberately declined the chord (`terminalKeys.ts`) and
bound ⇧⌘W instead, on the reasoning that taking it means replacing a menu that also carries
⌘Q/⌘C/⌘V/⌘A. So over an open scratch terminal, ⌘W reached the menu. The window did not close:
`lib.rs:918-933` intercepts `CloseRequested`, calls `prevent_close()` and **hides** it.

Two separate failures, and both need answering:

- [ ] **⌘W over the scratch should close the scratch.** Weigh the options and say which you
      chose and why — do not re-derive the old "prohibitive" conclusion without pricing it:
      (a) the existing `CloseRequested` interception already runs before anything is hidden, and
      could ask the frontend to dismiss what is on top instead; (b) a real app menu built from
      `muda`'s predefined items, which is bounded work rather than the loss of copy/paste the
      old comment implies. Whichever you pick, **⌘Q, ⌘C, ⌘V, ⌘A and ⌘X must still work** — prove
      it, do not assert it.
- [ ] **A hidden window must have a visible way back.** The tray's "Open Buzz" and a Dock click
      (`RunEvent::Reopen`) both exist in the code — **he found neither, and quit the app.**
      First establish whether they actually work on this build (if `Reopen` never fires, that is
      its own bug). Then make the way back discoverable, or stop hiding on close for this
      product. Hiding a window with no apparent way back is a trap regardless of which code
      path put it there.
- [ ] Tests: the key resolution, and whatever proves the menu items still work.

## Task 2 — One type scale, applied everywhere new

**His words: some tiny, some huge.** The rules exist (`CLAUDE.md`: stock rem tokens,
`text-2xs`/`text-3xs` for meta, `pnpm check:px-text` gates arbitrary literals) and the gate
passes, so this is not literals — it is **inconsistent token choice** across surfaces written
days apart.

- [ ] Inventory first: every text size token in `features/runs/**`, grouped by what it labels
      (pane header, body, meta, code, status bar, palette row…). Report the inventory before
      changing anything — the disagreement has to be visible before it can be settled.
- [ ] Decide one scale for the workspace and write it down: which token a pane header takes, a
      row label, a secondary line, a timestamp, a keyboard hint. **Then apply it everywhere**,
      including the surfaces that are already "fine", so the rule holds rather than the diff
      being minimised.
- [ ] The terminal is exempt and must stay exempt — its type is xterm's, not the app's.
- [ ] Record the scale in `workbench.md` so the next pane inherits it instead of guessing.

## Task 3 — ⌘K should be a pleasure to read

The palette works and looks like a list of strings. It is the surface he reaches for most.

- [ ] Rows: a clear primary line and a quiet secondary one, aligned so the eye can scan a
      column rather than re-find it per row. Group headings that stay readable at a glance.
- [ ] The chord each row carries should be legible as a chord (⌘⇧K rendered as keys), not as
      text buried in a sentence.
- [ ] The kind of a row — project, worktree, pane, action — should be apparent without reading
      it. Icons are the obvious answer; whatever you choose, it must survive both themes.
- [ ] Selection, hover and the blocked state must be tellable apart at a glance, and blocked
      must still read as *why*, not just as dimmer.
- [ ] Match the app's existing dialog/menu idiom rather than inventing a second one — read
      upstream's own command surfaces first and say what you followed.
- [ ] It must stay fast to type into: no animation that delays the first keystroke.

## Task 4 — The cheatsheet, and a key for it

- [ ] Every shortcut this workspace binds, on one surface, grouped by what it acts on
      (workspace, columns, panes, terminal, palette). Generated from the key modules where
      possible — a hand-written list is a list that goes stale.
- [ ] Its own chord. `⌘/` is the convention for exactly this and is unclaimed here, but
      **check every claimant before taking it** (the whole app plus the default macOS menu, per
      Task 1's findings) and report what you checked.
- [ ] Reachable from the palette too — it is an action like any other.
- [ ] **It must include the chords that are not the island's**, including ⌘W's real behaviour
      after Task 1, because the point is to answer "what does this key do here".

---

## Global Constraints

- **`rm -rf` forbidden**, any path, including generated scripts and test teardown.
- **Resource budget:** ~123 GiB free. Never a release build; never two heavy builds at once;
  `df -h /System/Volumes/Data` before a build and **stop below 20 GiB**; reclaim only with
  `cargo clean`.
- **The owner uses this app for real work while it is built.** His 9 live tmux sessions are on
  the default socket: never `kill-server`, never a tmux command that changes anything there,
  never quit or relaunch his app.
- **Nothing outside this repo.**
- Never `git add -A` — the tree carries pre-existing untracked design-sync files that are not
  ours. Never amend or rebase. Never kill a process you did not start.
- Trailers `Signed-off-by` then `Co-authored-by`; `git commit -F`, never `-s`.
- Island-first; any other path needs a `seams.yaml` entry with a real reason. **Task 1 will
  touch `lib.rs` and possibly a menu — that seam already exists; extend its reason.**
- **An empty read is "no answer", never "nothing there."**
- **A test must be able to fail** — prove each new test red by breaking what it guards. Two
  tests on this project shipped asserting a defect as correct.
- **Run the suites your change touches.** Two gates went red on the last branch because a fix
  updated a unit test and never ran the spec that covered the same behaviour.

## Self-Review

**Riskiest:** Task 1's menu. Replacing the macOS default menu is how an app loses copy and
paste, and the loss would be silent — the chords simply stop working, in a webview, with no
error. Whatever is chosen has to be proven by using the chords, not by reading the menu code.

**Most likely to be got wrong quietly:** Task 2. A type sweep that only touches what looks
wrong leaves the scale undocumented and the next pane re-guesses it, which is how this
happened. The inventory and the written-down scale are the deliverable; the diff is a
consequence.
