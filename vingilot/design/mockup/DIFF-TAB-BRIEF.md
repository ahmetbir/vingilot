# Diff tab — implement from mockup

Read these three files from the design mockup and implement the **diff tab** exactly:

- `mockup/Vingilot.html` — the `<div class="dv" id="tb-diff">` block (markup + content structure)
- `mockup/vingilot.css` — every rule from `.dv` down to `.dvfoot`
- `mockup/vingilot.js` — the `data-term` tab switch, `.fch` card collapse, `[data-dvm]` unified/split toggle

Open the mockup in a browser and click the `e8d628e · diff` tab in the terminal strip to see the target.

## What it is

A commit/worktree diff that opens as a **tab in the terminal strip**, alongside `claude`, `zsh`, `dev`, `scratch`. It is a real UI surface — NOT terminal text, NOT `git diff` piped into the pty. Same window, same tab bar, different renderer.

## Structure, top to bottom

**1. Commit header** (`.dvh`)
- Commit subject as a 15px/600 heading, `letter-spacing:-.01em` — reads like a title, not a log line
- Meta row: author avatar (20px circle) · `Bosun` bold · relative time · sha chip (`.shac`, mono 10.5px, bordered) · branch chip (`.brchip`, blue-tinted mono) · file count
- Right side: `+214` / `−38` mono, then `.barmini` — GitHub's 5-block change-ratio bar (green blocks = share added, red = removed, rest neutral)

**2. Toolbar** (`.dvbar`)
- Unified / Split segmented control (`.dvseg`, `data-dvm`)
- Ghost buttons: Ignore whitespace (persisted, accent-colored when on), Wrap, Expand all
- Right: `Next change` + `J` keycap, `Review…` (opens the existing reviewer popover)

**3. File cards** (`.fcard`, one per file, in `.dvscroll`)
- Each file is its own rounded elevated card — `border-radius:11px`, `#17171a`, hairline border, soft shadow. **`flex:none`** so cards keep intrinsic height and the scroller scrolls.
- Header (`.fch`): chevron · language logo badge (`.flogo`, Swift = `#F05138`) · dimmed directory + **bold filename** (mono 12px) · status label (`added`/`renamed`) · `+9 −4` · mini ratio bar · copy-path and open-in-editor icon buttons
- Click header → collapse (`.closed`). Icon buttons must not trigger collapse.

**4. Diff body**
- `line-height:22px` — generous, not terminal-tight
- **Two gutter columns** (old line no. / new line no.), 44px each, then a **separate 16px sign column** (`+`/`−`) — the sign is never part of the code text, so copy-paste stays clean
- Row tint + `inset 2px 0 0` left edge instead of full-bleed green/red blocks: add `rgba(63,185,80,.07)` / del `rgba(217,138,124,.07)`
- **Word-level highlight** (`.wd`) on the changed tokens inside a line — rounded, stronger tint of the row color
- Syntax highlighting: keywords `#c6a0f6`, strings `#a9d9a0`, types `#9fc6d6`, numbers = accent, functions `#e6cf9a`, comments 30% white italic
- Hunk headers (`.hunkbar`): blue-tinted bar, mono `@@ −41,9 +41,11 @@` + plain-text enclosing-symbol context + `Expand context` on the right
- Line hover reveals a `+` button (`.addbtn`, accent square, left of the sign column) to comment on that line

**5. Inline review thread** (`.rvw`) — the Vingilot-specific part
- An agent's review comment renders **inside the diff**, directly under the line it targets: agent avatar, `Lookout requested changes on line 42`, `changes requested` pill, the comment body with mono code refs, then `Apply suggestion` (primary) / `Reply` / `Resolve`
- This is the thing GitHub-in-a-browser can't do: the agent's objection sits in the code, and Apply hands it back to the agent that wrote the patch

**6. Footer** (`.dvfoot`) — file/line tally · unresolved comment count · `J`/`K` next change, `⌥⏎` comment keycaps

## Behavior to wire

- Tab switch: `data-term` swaps which body is visible (`#tb-claude` / `#tb-scratch` / `#tb-diff`) and moves `.on`
- Tab is openable from: History pane row click, Diff pane file click, a PR's file list, and ⌘K
- Card collapse state per file; Unified/Split; Ignore whitespace and Wrap persist per user
- `J`/`K` jump between changed hunks; `⌥⏎` starts a comment on the focused line
- Real syntax highlighting via the app's existing highlighter (Shiki/TextMate grammar), not hand-tagged spans — the mockup fakes it with `.kw`/`.str`/`.ty` classes
- Word-level diff from a real intra-line differ (`diff-match-patch` or equivalent)
- Virtualize rows for large diffs; the mockup renders a handful

## Non-negotiables

- Never render the diff as pty output or reuse terminal typography
- Sign column stays separate from source text
- Cards `flex:none` inside the scroller (otherwise cards squash and clip — this bit the mockup)
- Colors come from the design tokens already in the app (`--accent`, `--ink`, `--mut`, `--bor`); the greens/reds above are the only diff-specific additions

---

## Owner clarification (2026-08-31, on delivering this brief)

> "buradaki change request filan localdeki review agenti ile olan ama ona dikkat.
> upstreamle alakasi yok. orasi pull requests kisminda olacak"

The inline review thread in §5 is the **local review agent's** — the crew member
the status bar's Review popover dispatched (P4's `useReviewDispatch`), commenting
on the owner's own uncommitted or committed work in this worktree. It has
**nothing to do with GitHub pull requests**: those live in the Pull requests
section (P5, `gh`-backed). Do not model this thread as a PR review, do not fetch
it from `gh`, and do not let the two vocabularies merge.
