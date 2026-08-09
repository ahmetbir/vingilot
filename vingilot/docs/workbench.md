# The workspace — the Vingilot surface inside Buzz desktop

Per ADR-001's 2026-08-03 Reversal, Vingilot's UI lives **inside the Buzz
desktop app**, not in a sibling application. The former standalone Workbench
(`vingilot/workbench`) is deleted; its logic modules and tests were ported
into the island and its history remains on the `vingilot/workbench-shell`
branch.

Since workspace-v1 (2026-08-07) **Projects is the front door and Runs is one
pane among several** — a tab then, a choice in the right pane's picker now.
The sidebar item reads *Projects*; upstream's own relay-hosted repo
screen was relabelled *Repos*, which is literally what it lists (ADR-001,
naming decision). Nothing was deleted on either side.

---

## The workspace, in one screen

Three columns, left to right (`ui/RunsScreen.tsx`):

| column | what it holds | what it is for |
|---|---|---|
| **Projects** (`ProjectsNav`) | the local checkouts the owner has added, plus a project-less landing view | pick what you are working on. `+ Add project` opens the native folder picker; the choice is validated as a git repository *before* any workspace state is written. **Removing a project forgets the path — it never touches the directory on disk.** |
| **Worktrees** (`WorktreeColumn`) | that project's worktrees: its own checkout plus every `git worktree` | pick where you are working. New worktrees are `git worktree add`; closing one is `git worktree remove`, never a recursive delete. If git refuses because the tree is dirty, what is dirty is shown and nothing happens — that refusal is the feature. |
| **Work surface** (`WorkSurface`) | the terminal on the left, a divider, and a pane on the right chosen from that pane's own header (`PanePicker`, out of `ui/paneRegistry.tsx`): **Diff**, **Agent**, **Team**, **Evidence**, **Runs**, **Notes**, **Plan**, or a second **Terminal** — with the **scratch shell** drawn over all of it when it is open | do the work. The terminal is fixed to the left because in iTerm the terminal *is* the work surface, not a drawer — and because a terminal that changed slots would change parents, which is a new xterm and a replayed session. Either side can have the whole surface. |

A persistent `ProjectStatusBar` names where the owner is and what is backing
the terminals.

## Key map

Worktree and terminal chords (`lib/terminalKeys.ts`, `resolveKey`):

| chord | does |
|---|---|
| `⌘1`…`⌘9` | switch to the Nth worktree — iTerm tab muscle memory |
| `` ⌘` `` | focus the terminal |
| `Esc` | leave the terminal |
| `⌘T` | new terminal tab in this worktree |
| `⇧⌘W` | close the terminal tab |
| `⌥⌘←` / `⌥⌘→` | move between this worktree's terminal tabs |
| `⇧⌥⌘←` / `⇧⌥⌘→` | move the tab itself |
| `⌥⌘T` | open the scratch shell — and, pressed again, close it |

Columns and panes (`lib/columnKeys.ts`, `lib/paneKeys.ts`):

| chord | does |
|---|---|
| `⌘B` | show or hide upstream's sidebar |
| `⇧⌘B` | show or hide the worktree column |
| `⌥⌘B` | give the terminal the whole surface, and back |
| `⇧⌥⌘B` | give the right pane the whole surface, and back |

The palette (`lib/paletteKeys.ts`), on `/workspace` only:

| chord | does |
|---|---|
| `⌘K` | open the palette — and, pressed again, put it away |
| `↑` / `↓` | move the cursor, wrapping rather than falling off either end |
| `↵` | run the row under the cursor, or ask the question |
| `⇥` | straight back to the field: there is nothing here to tab *to*, and a Tab that left would put focus on controls the scrim is drawn over |
| `Esc` | close it, from wherever focus went — including a blocked row, which stays clickable on purpose |

**`⌘W` is deliberately not bound.** It never reaches this app on macOS: Tauri
installs its default application menu, whose Window submenu holds
`close_window` at `⌘W`, and macOS resolves menu key equivalents before the
webview sees the event. Binding it here would close the owner's *window*
while looking like it closed a tab. Taking it back would mean replacing the
whole default menu — where `⌘Q`, `⌘C`, `⌘V` and `⌘A` also live for a
WKWebView. One extra modifier is the cheaper trade.

Auto-repeat is not a second press: a leaned-on `⌘T` would otherwise leave
dozens of live shells, removable one click at a time.

Diff panel (`lib/diffKeys.ts`): `j` / `k` move the cursor through the changed
files, `Enter` opens the one under it. A cursor is not a selection — opening
every file you pass over would mean rendering 300 patches to reach the one you
wanted. `Enter` on a focused control (a tab button, a file row, a link)
belongs to that control, not to this list; `j`/`k` do not, because every file
row is itself a button.

## The type scale

The owner read the workspace after using it and said *"her yerde bi font
sıkıntısı var — bazıları kücücük bazıları büyük"*. Nothing here was breaking a
rule: every size was a legal rem token and `pnpm check:px-text` was green. What
disagreed was **which** token, across panes written days apart — a pane header
was `text-lg` on one surface and `text-xs` on another, a row's second line was
`text-3xs` here and `text-xs` there. So the scale is written down, and the next
pane inherits it instead of re-guessing.

**Six roles, four sizes.** Nothing in `features/runs/**` uses a size outside
this table.

| role | what it is | token |
|---|---|---|
| **Title** | the name of the surface you are looking at — a column header, a pane's own heading, the pane-header strip's label and picker, a run's objective at the top of its detail | `text-sm` |
| **Body** | anything the workspace says as a statement — an empty state, a refusal, a note, an agent's answer, a thread message — and every field the owner types into | `text-sm` |
| **Row** | the primary line of a list row: a project, a worktree, a run, a palette row, a changed file, a menu item | `text-sm` |
| **Control** | the label on a button, a tab, a form field, a disclosure | `text-xs` |
| **Meta** | the quiet second line under a row, and anything that names or counts rather than states — a timestamp, a path, a count, a chip, a keyboard hint, the whole status bar | `text-2xs` |
| **Eyebrow** | the uppercase heading over a list or a bar | `text-3xs uppercase tracking-[0.14em]` |

Three riders, each of which settles a case that came up while applying it:

- **Body and Row and Title are the same size on purpose.** They are all things
  you read; only weight and colour separate them. The scale is about size —
  weight, colour and case stay each surface's own.
- **A line is Body if it makes a statement and Meta if it names, counts or
  times something.** "control plane unreachable — pin toggles disabled" is
  Body. "+340 −22", "as of 14:02", `~/src/vingilot` are Meta. A line
  subordinate to the line directly above it is Meta whatever it says.
- **Monospace takes its role's size, except output the app produced.** A patch,
  an agent trace, an evidence row and a stderr dump are `text-xs` — they are
  scanned in columns, not read in lines. A path, a branch name or a refusal's
  file list is Meta (`text-2xs`); the Notes/Plan editor is a field the owner
  writes prose into, so it is Body (`text-sm`).

**The Eyebrow's styling belongs to the Eyebrow alone.** `uppercase` plus
`tracking-[0.14em]` at any other size is the drift this section exists to stop,
and it is checked (`lib/typeScale.test.mjs`) in both directions: an eyebrow at
another size, and an 8px line that is not an eyebrow. Two `dismiss` links wore
the eyebrow's styling as controls and now use the app's plain underlined-link
idiom instead. The chip idiom — `text-2xs uppercase tracking-wide` inside a
rounded border, as on `acp`/`int`, a run's status and STOP — is a separate,
self-consistent thing and is left alone.

**The terminal is exempt, and only the terminal.** xterm renders its own font
at its own size inside `ui/Terminal.tsx`'s host element; a Tailwind size there
would resize the cell grid and hand tmux a new column count for a session the
owner never touched. The chrome *around* it — the tab strip, the scratch
shell's header and footer, the "waiting for this worktree's checkout…" notice —
is workspace type and takes the table above.

`pnpm check:px-text` still gates arbitrary literals app-wide; this scale is the
narrower rule that gates *token choice* inside the island.

## The terminal, and exactly what it does not promise

A real PTY per tab, running **the owner's own login shell** in the worktree's
directory (`desktop/src-tauri/src/vingilot_pty/`).

- **No isolation.** The shell has whatever the owner has: their `$PATH`, their
  keys, their whole filesystem. This is the same risk class as typing into
  Terminal.app (ADR-003's V1 trust model). Nothing here sandboxes anything,
  and no UI copy may imply otherwise — a worktree chip says only where the
  shell *starts*.
- **Persistence is tmux's, and it is bounded.** Where tmux is installed, each
  tab runs under `tmux new-session -A -D -s vingilot_<derived>`, so the shell
  survives quitting the app. It does **not** survive a reboot, a
  `tmux kill-server`, or a crash — the session lives exactly as long as the
  tmux *server*, which is not this app's child. The status bar says
  "persistent (tmux) — survive quitting the app, not a reboot".
- **Without tmux there is no persistence at all.** The shell is a child of
  this app and dies with it. The status bar then says "this session only —
  they end when the app quits". It never implies more than is true.
- **Reattach replays a bounded screen**, not a full scrollback: 256 KiB per
  session, oldest bytes dropped first (`scrollback.rs`). That is roughly 25
  screenfuls — enough that a remount lands on real history. Keeping more is
  tmux's job, and a ring that tried to be a scrollback store would be
  reimplementing tmux badly.
- **A tab's shell is killed when the owner closes the tab or its worktree
  leaves the workspace** — never on a re-render, a project switch, or a tab
  change. `pty_close` also ends the tmux session, because nothing will
  reattach to it.

Proven, not asserted: `vingilot_pty/live.rs` opens sessions against a real
PTY in `cargo test` and checks that the shell's own `pwd` is the worktree,
that a reattach replays what the view missed, that a tmux session outlives
the client attached to it, and that closing a terminal leaves neither a
running shell nor a zombie.

## The scratch shell — a terminal you can throw away

`⌥⌘T`, or `⌘K → scratch shell`. It opens **over** the work surface, runs one
thing, and leaves nothing behind (`lib/scratchTerminal.ts`,
`ui/ScratchTerminal.tsx`). There is exactly one at a time, and both doors reach
the same one: a second `⌥⌘T` on the worktree it is already open on closes it
rather than costing the owner whatever is running in it.

It is drawn over the surface rather than laid out in it, and that is not a
styling preference. Under tmux the sole attached client's size *is* the
session's size, so a layout that squeezed the persistent terminals to make room
would reflow every live shell in the strip and re-wrap its scrollback — the
exact failure `terminalFit.ts` exists to prevent, arriving from a new direction.
Nothing here unmounts, remeasures or resizes a terminal that is not its own, and
nothing bumps a `focusToken`.

**What it does not do**, said in the same breath as what it does:

- **Nothing is kept.** No tmux session, no tab in the strip, no line in the
  saved layout, no id a restart could find. Persistence is the defect here, not
  the missing feature: a scratch terminal that survived anything would be a
  terminal tab, and the workspace already has those.
- **No isolation**, exactly as for the terminal tabs above. It is the owner's
  login shell with the owner's `$PATH`, keys and filesystem. The header names
  the directory it starts in and that is all a directory means here.
- **It ends when you leave, and it does not ask.** Closing it, going to another
  worktree or project, leaving the workspace screen, and quitting the app all
  end it — and whatever it is running ends with it, unasked: a tail, a build, a
  long test run. The alternative was a confirmation before killing a live shell.
  This is the other choice and it is the honest one for a terminal whose whole
  point is being thrown away — a scratch shell that stops to ask permission is a
  tab with extra steps — so the cost is said **up front**, in the footer under
  the shell and in the palette row that opens it, rather than in a warning at
  the moment it is too late to matter.

The footer carries that sentence verbatim from `lib/terminalPersistence.ts`,
beside the status bar's persistence line it must not be confused with. Both
sentences live in one file for that reason: the way this drifts is one being
rewritten without the other in view, and the status bar's old wording
("terminals: persistent…") was a sentence a scratch shell could hide inside. So
the worktree copy now names its subject and the scratch copy says what it is
*not* covered by.

**How "leaves nothing behind" is actually secured**, rather than promised:

| residue | how it is avoided |
|---|---|
| a tmux session | asked for the direct spawn at `pty_open` (`Lifetime::Ephemeral`), so there is no session to strand — not by killing one afterwards |
| the saved layout | never enters `TabLayout` at all: a scratch is one nullable value held beside it |
| the worktree's strip | follows from the above — `applyTabCommand`/`closeTab`, and so `⇧⌘W` and the tab bar, have no name for this session |
| colliding with a tab's shell | a tab's session id is `` `${bindingId}#${n}` `` and always contains a `#`; a scratch id contains none. That is the whole proof, for every binding id the coordinator could ever produce |

Proven, not asserted: `lib/scratchTerminal.test.mjs` for the model,
`vingilot_pty`'s live tests for a shell that leaves no tmux session behind, and
`desktop/tests/e2e/workspace-scratch.spec.ts` over a real bundle for the three
things only a live document can settle — that closing it puts the keyboard back
on the control it was taken from (from both doors, which capture at different
moments in one commit), that the path in the header is the path that crossed the
boundary to `pty_open` and the plan asked for is the ephemeral one, and that
opening and closing one adds no tab, leaves the saved layout byte-identical, and
really closes the pty — including when the owner walks away to another project,
which is the half of the promise that is invisible on screen.

## The diff viewer, and where it stops

Working tree versus a base ref — "what have I changed", including untracked
files, which `git diff` alone would never mention. It is git's own output:
`--numstat`/`--name-status` for the list and counts, a per-file `git diff` for
each patch, `--no-index` against `/dev/null` for untracked ones. Nothing is
reconstructed or inferred, and **nothing here writes** — no `add`, no
`add -N`, no stash, no index touch of any kind.

Every limit is reported on screen, next to the numbers it applies to:

| limit | value | what happens past it |
|---|---|---|
| files listed | 400 | the amber banner names how many more changed |
| untracked files listed | 100 | same, counted separately |
| patch lines per file | 2 000 | "patch cut off", with the real limits named |
| patch bytes per file | 256 KiB | same — for the file that is 40 lines and 8 MB |

The byte cap is applied **at the pipe, not to the answer**: a patch is read up
to the cap and git is then cut off, so an agent's 191 MB `run.log` in a
worktree costs the cap, not 404 MB of resident memory. The whole read runs off
the thread the webview talks on, because one read is up to ~500 `git`
subprocesses and the terminal in the next tab has to keep taking keystrokes.

A file the read could not produce is a **refusal**, never an empty patch: an
empty patch beside `+3 −1` renders as "no textual change to show", which is a
statement about the owner's work that no failed subprocess is entitled to
make. Binary files say they are binary rather than rendering nothing.

The panel reads when it opens, when the base changes, and when *Read* is
pressed. It is never polled — a `git diff` over a real worktree every two
seconds is a permanent load on the machine to answer a question nobody asked
twice.

## The Agent tab, and the difference between wiring and judgement

A worktree can be handed to an **ACP agent** for one turn: a prompt, the
agent's own transcript, and then the Diff tab to read what it changed. ACP is
the protocol this repo already speaks to agents with (`crates/buzz-acp`) —
JSON-RPC 2.0 as newline-delimited JSON over a subprocess's stdio, with
`initialize`, `session/new` carrying the working directory, and
`session/prompt`. Any adapter that speaks it works here: `claude-agent-acp`,
`codex-acp`, `goose`.

**Which agent, and how it is found.** `VINGILOT_ACP_AGENT_COMMAND` first, then
`BUZZ_ACP_AGENT_COMMAND` — the harness's own variable, so a machine already set
up for `buzz-acp` needs no second setting. Arguments come from the *same*
namespace as the command that won (`*_ACP_AGENT_ARGS`, comma-separated), never
mixed across the two. **There is no default agent**: with neither variable set
the panel says so and names both, rather than picking one and failing to spawn
a binary the owner never asked for. The lookup is `PATH` first, then
`/opt/homebrew/bin` and `/usr/local/bin`, because an app launched from Finder
does not inherit a login shell's `PATH`.

**The boundary, said plainly.** The agent runs as a child of this app, with the
owner's account, environment, and credentials, and its working directory is the
worktree. **A worktree is a collision boundary, not a security boundary**
(ADR-003) — it keeps one agent's work off another branch; it does not hold the
agent inside it. Permission requests are answered `allow_once` and every grant
is written into the transcript, so the run is auditable rather than quietly
permissive. Nothing in this feature's copy may read as isolated, sandboxed, or
contained, and `agentTurn.test.mjs` fails the build if it starts to.

**Every wait is bounded**: 60 s for the handshake, 300 s of silence during a
turn, 30 min absolute. A turn that is given up on leaves what the agent already
changed exactly where it is — the panel says so, because the diff is the only
thing that knows.

**What is proven, and what is not.** `vingilot_agent/live.rs` drives the
shipping code — the turn, `git worktree add`, and the diff read — against a real
git repository: the agent edits a file in *its* worktree, the diff surface
reports `+2 −0` on that file, the project's own checkout is untouched, the
permission handed back is the option id the agent minted, a silent agent is
given up on, and a dying one reports what it wrote on the way out. It was also
run once against a throwaway repository outside the tree, which is the form the
owner asked for.

**The agent in those tests is a stub** — forty lines of `/bin/sh` that speak
ACP correctly and decide nothing. No ACP adapter was installed on the machine
this was written on (`claude-agent-acp`, `codex-acp`, `goose`: none; the
installed `codex` CLI has no ACP mode), and nothing was installed to make one
appear. So this proves the **wiring**, end to end, and says nothing about any
real agent's judgement. Those are two different claims and are not merged here.

## The palette — one key to go anywhere and do anything

`⌘K` opens a palette centred over the work surface (`ui/CommandPalette.tsx`,
`lib/usePalette.ts`). It is the workspace's verb surface, not a search box:
everything the workspace can do is reachable from it, so a new action gets
discoverability without needing a button somewhere.

**`⌘K` was already bound in this app, and this map takes it on `/workspace`.**
What was found before claiming it (`lib/paletteKeys.ts` carries the whole
check):

- **Tauri's default macOS menu**, which this app installs by setting none,
  claims `⌘C/X/V`, `⌘Z`, `⇧⌘Z`, `⌘Y`, `⌘A`, `⌘M`, `⌘W`, `⌘Q`, `⌘H`, `⌥⌘H`,
  `⌃⌘F` and Alt+F4 — and nothing else. `K` is not in it, so unlike `⌘W` this
  chord does reach the webview.
- **Upstream's own `⌘K`** is the community search dialog (the sidebar's
  "Search everything ⌘K"), bound at window level on every screen but
  `/settings`. It searches relay messages, so on `/workspace` it opened a
  message search over a workspace it knows nothing about.
- **Upstream's composer** claims `⌘K` at element level for the link editor —
  on the channel screens, never on `/workspace`.

So the island takes it **only on `/workspace`**, through upstream's own
deference path: AppShell's handler returns early on `event.defaultPrevented`,
which is exactly the case it documents. Nothing is taken away — every other
screen keeps upstream's search on `⌘K`, and the sidebar's "Search everything"
button still opens it on `/workspace` too. Extending upstream's dialog instead
would have meant teaching a relay search about worktrees in three upstream
files; a third key would have pointed the owner's muscle memory at the wrong
surface on the one screen this fork exists for.

**Four sources, each a pure function from query to candidates**
(`lib/paletteSources.ts`):

| source | rows |
|---|---|
| **projects** | every project in the workspace, plus **Deck** (the project-less landing view) |
| **worktrees** | the open project's worktrees, labelled with the role and the run that owns them |
| **panes** | every pane in the registry — "show the Diff pane beside the terminal" |
| **actions** | New worktree…, Turn this plan into a worktree…, New terminal tab, **Scratch shell**, Add project…, Remove *&lt;project&gt;*…, Prune missing worktrees…, and the four layout toggles — each labelled by what it will do next ("Hide the sidebar" / "Show the sidebar") and carrying its own chord |

The scratch row's detail leads with the lifetime — "a shell that ends when you
close it or leave this worktree — keeps nothing: no tab, no tmux session" —
because a row that led with what it *keeps not* would have the owner reading to
the end of the line to find out what he is about to lose.

**One scorer over the union, not one per source** (`lib/paletteModel.ts`).
Nothing in the sort reads a row's `kind`; the five match tiers are 150 points
apart and every penalty is capped, so a substring match can never out-score a
prefix match by being shorter. A palette that ranked within each source and
then concatenated would put the fourth-best project above the perfect action,
and the owner would learn to read the whole list — which is the list he opened
the palette to avoid.

**An action that cannot run is ranked down, never dropped.** Prune with
nothing prunable, "Remove project" on the landing view, a pane with no worktree
under it: all still listed, still findable by name, each carrying the sentence
saying why it will not happen. Hiding them would answer "there is no such
command", which is a different and false statement. Enter and a click on such a
row both do nothing and leave the palette open, because the reason is already
on screen.

**An empty query is the workspace, not an empty box**: what was run recently
comes first (up to 8, kept in `localStorage` under `vingilot-palette.v1` and
surviving a restart), then every source in order.

**While it is open, the chords underneath it do not reach the workspace** —
`⇧⌘B` behind an open palette used to rearrange the columns under it, including
when focus had gone to a blocked row.

## Ask — a mode of the palette, and exactly what it sends

Typing `?` as the **first** character switches the palette from *find* to
*ask*: the text becomes a question about the directory the owner is in
(`lib/askMode.ts`). A `?` anywhere else in a query is just a character in a
filter. `?` rather than `/ask` because this surface's promise is one key and no
ceremony, and because nothing in this workspace is named starting with `?`, so
no row becomes unfindable.

**What is sent with a question is one path.** The panel prints it before the
question is asked, verbatim, and it is a constant in the model so no UI can
drift into implying more:

> **asked with**
> `/path/to/the/worktree`
> …and nothing else — not the diff, not the branch, not the file on screen,
> not a description of the project. The agent is started in that directory and
> reads whatever it opens there itself.

That is the literal call: `agentClient.runAgent` takes a `cwd` and a prompt.
Whether the agent then reads anything in that directory is the agent's own
doing, through its own tools. This is the difference between *a model that was
handed a directory path* and *a model that knows the codebase*, and the UI has
to say which.

**The answer lands in a conversation, not a toast** (`lib/askThread.ts`,
`lib/askStore.ts`). One record per turn — a palette question and a prompt typed
into the Agent pane's box are the same thing, because they are the same adapter
run in the same directory. It is kept per directory in `localStorage`
(`vingilot-ask.v1`): 8 directories, 20 exchanges each, answers cut at 4 000
characters with a marker saying the rest was not kept. Each row carries the
`cwd` it was asked with, so a thread read months later says what *that*
question was sent with rather than what the surface would send today. The
question is written the moment it is asked; the fact that a turn is running is
not, so a row with no answer after a restart reads as "no answer came back"
rather than as an ask still in flight.

**Why not a Buzz channel.** Upstream's chat is the only message store in this
app and it is a relay: every message is a Nostr event signed with the owner's
key and published to a community. Three things follow, each deciding it on its
own — the workspace runs against a local coordinator and needs no community, so
an ask would be unaskable until the owner joined one; the question carries a
path on this machine, and a channel publishes that path to a server; and the
answer comes from a local adapter that holds no key, so landing it in a channel
would mean signing an agent's words with the owner's identity — a forged author
in a signed, hash-chained log. Upstream's *deployed* agents post under their own
pubkeys for exactly this reason (see *Two agent surfaces* below, which is the
same argument read from the other end). The seam that would change this is an
identity for the local agent plus a channel to post into.

**One turn at a time, and a second question is refused in words.** The Agent
pane's Run button and the palette's Enter claim the same mark (`pendingAsk`),
so they cannot disagree — they did, and the palette started a second adapter
process behind the pane's back, which on a hosted adapter is a second login and
a second billed turn. The refusal is shown *before* Enter, and names where the
running turn is, because the guard is one adapter for the whole app rather than
one per directory.

Everything the ask mode can refuse, in the order it is checked:

| when | what it says |
|---|---|
| no worktree open | no worktree is open, so there is no directory to ask in |
| the directory is still being resolved | still working out where this worktree is on disk |
| the agent probe is still running | still asking this machine whether an ACP agent is configured |
| no agent configured | the probe's own sentence, naming `VINGILOT_ACP_AGENT_COMMAND` / `BUZZ_ACP_AGENT_COMMAND` |
| the probe could not answer | this build could not ask, so a question typed here would have nowhere to go |
| a turn is already running | here, or in the other directory it names — "one adapter runs at a time" |
| nothing typed after the `?` | type a question |

**A question storage will not keep is still the conversation.** A refused write
keeps the whole thread in memory and the pane says that is where it is; the
next write storage does take carries the rows it refused earlier, so a quota
that frees up recovers the conversation whole.

## The team thread — talking to a Buzz agent team about one worktree

A pane on the registry (`lib/teamThread.ts`, `lib/teamThreadStore.ts`,
`lib/useTeamThread.ts`, `ui/TeamThreadPane.tsx`). Choose a team, open a thread,
and the conversation is a **Buzz channel on the relay** — upstream's own
messaging, not a fourth store in this island. Choosing the team is part of the
pane rather than a global setting, because the question "which team is this
worktree's" is per worktree.

**What is sent is one line.** The pane prints it before a word is typed, and the
sentence and the message are the same string (`SCOPE_PREFIX`) so a scope claim
cannot be assembled separately from the send:

> Each message goes to the relay with one line in front of it —
> `worktree: /path/to/the/worktree` — and nothing else: not the diff, not the
> plan, not the run's transcript. The branch is not in the message either, but
> it is in the name of the channel this thread lives in, and this path is in
> that channel's description, where everyone in it can read them. The team's
> agents **are not started in this directory** and may not be able to open it at
> all; the path is text in your message, and they read whatever they can reach
> themselves.

The last clause is what this pane has to say that ask-mode does not. Ask-mode
runs a local adapter *in* the directory; a team member is a managed agent
somewhere else entirely, and a path in a message is a string it may have no way
to resolve. The branch clause is there because the pane's own channel naming
puts the branch on the relay: enumerating it as "not sent" would have been true
of the message and false of the thread.

**Availability is answered honestly, and "could not ask" is never rendered as
"no".** Three questions, each asked live rather than once, because all three
change while the owner is looking at them:

| state | what it says |
|---|---|
| no community joined | this conversation is held on the relay, so with none there is nowhere for it to be |
| the team list could not be read | *could not ask* which teams are configured — no answer rather than an answer of none, and the pane stays open |
| no team configured | says so, names `Agents → Teams`, and offers nothing to type into |
| the relay's state is unknown | says the question could not be put; the thread stays open and a send that cannot leave will say so itself |
| the relay is unreachable | the pane can neither show the thread nor take a message; the channel and everything in it are on the relay, and a half-written message is kept on this machine |

**Opening a thread has two halves, and a failure says which one it reached.**
The channel is created and this worktree's pointer written *first*; the members
are deployed *after*. A deploy that fails therefore leaves a working thread, so
the trouble sentence says "the thread is open, but its members could not be
deployed into it — the channel is there and you can send in it, and nobody may
answer". It used to say "the thread could not be opened" for both halves, which
printed a flat contradiction above a live composer.

**What it keeps is a pointer, never a message.** `teamThreadStore.ts` holds
which channel a worktree's thread is, and the draft store holds what is
half-typed (on the keystroke, out of the React heap, so a relay reinit that
remounts the whole community subtree does not eat it). Every message lives on
the relay. Changing team asks first and names the channel it would stop pointing
at; nothing is deleted, the members keep running, and choosing that team again
adopts the existing thread rather than deploying a second one.

### Two agent surfaces, and why that is the design rather than an untidiness

Ask-mode keeps its conversation locally; the team thread puts its conversation
on the relay. That difference is **a consequence of who is speaking**, and
anyone who "tidies" the two stores together will forge an author.

> **The plan's premise was wrong and the survey corrected it.** The plan
> (`docs/plans/2026-08-08-scratch-and-team-thread.md`) said *"a Buzz agent team
> does have its own identity."* It does not. A team is a local JSON record —
> `{id, name, description, instructions, personaIds[]}` (`managed_agents/teams.rs`)
> — with no key of its own, mirrored to the relay as a kind:30176 addressable
> event **signed with the owner's keys** (`commands/teams.rs`). A persona is a
> definition and has no key either.

What does hold a key is each **managed agent instance**, minted at deploy time
with `Keys::generate()` (`commands/agents.rs`). Deploying a team is a fan-out
into one such agent per persona. So the true form of the argument is:

> **The members of a team each post under their own pubkey; the team as such
> never posts.**

That is weaker than what the plan assumed and it is still enough, because the
thing being ruled out is *forged authorship*, not anonymity. The local ACP
adapter holds **no key at all**, so landing its answers in a channel would sign
an agent's words with the owner's identity in a hash-chained log — which is why
ask-mode is local. A deployed team member signs its own, so the relay is exactly
where that conversation belongs — which is why this pane is not local. Nothing
about the pane's design depended on a team having a key; the only thing that had
to be true is that the words in the channel are not attributed to the owner.

Proven over a real bundle in `desktop/tests/e2e/workspace-team.spec.ts`: that
the scope on screen is the literal line the signed kind:9 event carries (read
off `sign_event`, which is where every relay message this app publishes is
signed), that it goes to a channel by `h` tag rather than into any store of the
pane's own, that a `list_teams` which *throws* reads as "could not ask" rather
than as "no teams", that a failed send keeps every character, that a failed
deploy does not call its own thread unopened, and that changing team asks first
and comes back without a second deploy.

## The two documents a project carries — Notes and Plan

One substrate, two panes (`lib/documents.ts`, `lib/documentStore.ts`,
`lib/autosave.ts`, `lib/useDocument.ts`). A document is markdown, per project,
per kind; **Notes** is a note, **Plan** is a brief that can be turned into a
worktree. They are separate documents, not one document with a flag.

**Where they live: `localStorage`, under `vingilot-documents.v1`** — 24
documents, 40 000 characters each, oldest save evicted first. What that was
weighed against, and why each alternative lost:

- *The coordinator's workspace state*, where `repos` and `deck.pins` live, is
  CAS-versioned and could detect a conflicting write. But **the coordinator can
  be down** — this screen renders a `reachable` flag precisely because it often
  is — and a note pane that will not keep a note because a local service is not
  running is not a note pane. It is also one blob read-modify-written, so an
  autosave every few seconds would bump the revision under whoever is writing
  pins, and it buys no sync: the coordinator is a process on 127.0.0.1.
- *A file on disk* would show up in the owner's `git status` inside the
  project, and outside it would need a new Rust command and a directory this
  app decided to own without being asked. Writing a plan into a worktree is an
  explicit act with a name (below), not where the document lives while it is
  being typed.

**Autosave, with the numbers said out loud.** The write happens 600 ms after
the last keystroke, **or** 1 500 ms after the first unwritten one, whichever
comes first — a trailing debounce alone never fires while someone is typing
steadily, so a long paragraph would be a long unwritten one. The pane shows
`saved`, `unsaved`, or `not saved`; the third is deliberately not folded into
the second, because telling the owner "unsaved" about a document that cannot be
saved at all would have him wait for a write that is never coming. **A write
that did not happen is never reported as saved.**

**Every ending flushes what is pending** — the pane being swapped, `⌥⌘B`
taking the right side away, the project changing, the screen closing (all one
unmount), plus the window's own `pagehide` and `beforeunload`. **A `⌘Q` is not
one of them, and that is not hedging:** this app intercepts the main window's
close and merely hides the window, and the real exit stops the Rust side and
ends the process without navigating the webview, so no unload event is promised
there. The honest worst case at a quit is *whatever was typed since the last
write*, and the 1 500 ms ceiling is that bound. Measured in the shipping e2e
bundle under Chromium: either window event alone covers a reload, and with both
removed a note still inside the debounce is lost. **Not measured in the
shipping WKWebView** — that is a different engine and no claim is made for it.

**Two windows on the same project: last write wins, whole document.** There is
no merge and no cross-window notification, and the store deliberately does not
listen for `storage` events — a second window's write arriving into an editor
mid-sentence would replace what the owner is typing, which is a worse failure
than the one it fixes. Each window reads the document when its pane mounts and
writes all of it when its own autosave fires, so paragraphs typed in the other
window between those two moments are gone, not merged. The exposure is exactly
"both windows have the same project's pane open and both are being typed into",
and the losing window still shows its own text until it is remounted.

Both panes say on screen where their document is kept, and neither implies more
than is true: Notes says *"kept in this app on this machine — not in the
project, and not on a server"*, and Plan says the same with the one thing that
is different about it — *"it reaches a checkout only when you open a worktree
from it."*

## A plan becomes a worktree

The act the owner asked for: **turn this plan into a worktree**
(`lib/planBrief.ts`, `ui/PlanWorktreeDialog.tsx`,
`src-tauri/src/vingilot_worktree/brief.rs`). Two doors — the Plan pane's button
and the palette's *Turn this plan into a worktree…* — and **one dialog**, which
is what reads the plan, so a palette row cannot act on a plan the owner has
edited since the row was drawn.

**The branch name is offered, never taken.** It is derived from the plan's
title into an editable field, and what git is asked for is whatever is in that
field when the button is pressed. Non-ASCII letters survive — git refs are
UTF-8 and `dokümanlar` is a perfectly good branch name — while the *directory*
under `~/.vingilot/worktrees/<project id>/` is reduced to ASCII separately,
because that is a fact about paths, not about refs. Legality is git's answer,
not this app's: a second copy of `check-ref-format` here would eventually
disagree with git.

**What crosses the Tauri boundary** is the repo path, the branch in the field,
the base — `HEAD` by default, in a field of its own, because branching from
where the project already is, is what is meant nine times in ten — the worktree
path, the filename `PLAN.md`, and **the plan as
it is on screen** — with a final newline added and nothing else, no header, no
timestamp, no "generated by". The document is read live rather than out of
storage, which is a debounce behind: the pane's button and the dialog once
disagreed about the same plan, so a plan rewritten and acted on straight away
briefed the worktree with the text the owner had already replaced, and a plan
typed from nothing was offered by the pane and called empty by the dialog.

`PLAN.md`, at the root, in capitals: whoever opens the checkout next — the
owner in a shell, an agent handed the directory — has to find it without being
told where to look, and root capitals is what every repository already uses for
a document about the whole checkout. Not the plan's title (a name that varies
cannot be found by convention), and not a dotfile (a hidden file is one nobody
reads).

**The order is the guarantee.** `git worktree add` first, and the brief only
into the path git came back with — so a refused creation leaves no file
anywhere, and the path written to is never one this app chose. The file is
opened `create_new`, so "there was already a `PLAN.md` here" is the
filesystem's answer rather than a check that could lose a race.

Every refusal it can give:

| refusal | what the owner is told |
|---|---|
| the plan is empty | the act is blocked before the dialog will act: "this project's plan is empty, and the worktree would carry an empty `PLAN.md`. Write what the work is first." |
| no project open | the palette row is listed but blocked: "no project is open, so there is none for this to act on." |
| the branch name is not a legal ref | `git will not accept "…" as a branch name.` — git's verdict, not a local rule |
| the branch exists | `the branch "…" already exists. Pick another name — nothing was changed.` |
| something is already at the path | it was left exactly as it is; move it yourself or use a different name |
| the base names no commit | `"HEAD" names no commit in this repository.` |
| the project is no longer a git repository | `… is not a git repository any more — nothing was changed.` |
| no git on this machine | `no git on this machine that answers git --version.` |
| **the worktree was made but the brief was not** | both facts, together: the worktree exists on its branch, the file it would have written was already there and was left alone, the plan is still in the Plan pane, and **nothing was removed**. The dialog stays open and Create is disabled, because re-pressing it would now fail on a branch that exists |
| the filename is not a filename | `"…" is not a filename, so nothing was written.` — `..`, `docs/PLAN.md` and a leading dot are all refused before anything is opened |

A worktree that was created is reported as created even when its brief was not.
Failing the whole call would mean a refusal that describes a worktree which
exists, on a branch that exists, and the only way to make that description true
again is to remove them. **Nothing in this island removes anything to tidy up
after itself.**

**What is proved where, for all four of these surfaces.** The pure models carry
`.test.mjs` files beside them and run in `pnpm test`. What only a running app
can say is in six Playwright specs over the real `pnpm build:e2e` bundle —
`workspace-palette`, `workspace-ask`, `workspace-notes`, `workspace-plan`,
`workspace-columns`, `workspace-no-overlays` (the last two belong to the pane
host underneath) — which assert against what is rendered and, where a boundary
is involved, against **the arguments that crossed it**: the palette's key claim and its deference to upstream, the pane
it switches to, an action that really runs, the scope line before a question is
asked, the second question refused in words, a note surviving a reload and a
note surviving the page ending mid-debounce, and the branch and plan text that
`worktree_add_with_brief` was actually called with.

What git does is proved in Rust instead, against **real repositories** the
tests create and throw away (`vingilot_worktree/brief.rs`, over a `TempDir`
under `TMPDIR` — never a repository the owner is working in): that the plan
lands in the worktree it opened and not in the project, that a `PLAN.md`
already on the base branch is never written over, that a refused creation
writes no file anywhere, that a name which is a path cannot reach outside the
worktree, and that a briefed worktree is still one `git worktree remove` will
close — after refusing while the brief is uncommitted, like any other untracked
file.

## What this workspace deliberately does not do

- **No editor.** VS Code's real value in the owner's screenshots is *reading a
  diff*, which the Diff pane covers. A text editor is a much larger commitment
  and he did not ask for one.
- **The Agent pane's real ACP backing is not built, on purpose.** The pane
  speaks ACP to whatever `VINGILOT_ACP_AGENT_COMMAND` / `BUZZ_ACP_AGENT_COMMAND`
  names, and **no adapter is installed on this machine** — `claude-agent-acp`,
  `codex-acp` and `goose` are all absent, and the installed `codex` CLI has no
  ACP mode. Installing one lives outside this repo and is the owner's call, so
  nothing was installed and nothing is defaulted: with neither variable set the
  pane says so and names both. Everything proved about the agent, and about
  ask-mode, is therefore **wiring** — the turn, the transcript, the guard, the
  diff that follows — proved against a stub that speaks ACP and decides
  nothing. No claim about any real agent's judgement is made anywhere here.
- **No Xcode.** A native iOS toolchain is not reproducible here, and a bad
  imitation of one is worse than alt-tabbing to the real thing.
- **No notes vault.** There is a Notes pane now, and it is one note per
  project — not Obsidian. No vault, no linking, no search across notes, no
  files on disk: a document the project carries, kept in this app on this
  machine. A notes *product* is still not this app's business.
- **No `rm -rf`, anywhere, for any path.** Worktrees are removed with
  `git worktree remove`, which refuses a dirty tree. Named files go with
  `rm <file>`, empty directories with `rmdir`. This binds generated code and
  agent prompts too — anything that appears to need a recursive force-delete
  is a stop-and-ask.
- **No agent runs by default.** Running a real coding agent as a Run's command
  is configuration (`VINGILOT_CMD`), not code — and deliberately not wired up:
  see the note under *Work products* below. The Agent pane and the palette's
  ask mode are the other two doors, and both are configuration too: with no
  `*_ACP_AGENT_COMMAND` set, nothing spawns and both say so.
- **No agent judgement is claimed.** The proof used a stub that speaks ACP and
  decides nothing, because no adapter was installed — see the bullet above and
  *The Agent tab* further up.
- **The scratch shell keeps nothing, and is not going to.** No persistence, no
  isolation, no second one, no confirmation before it ends. Each of those is a
  decision rather than a gap: persistence would make it a terminal tab,
  isolation is outside V1's trust model for every shell in this app, and a
  confirmation would make the throwaway thing the ceremonious one. What has to
  outlive a keystroke belongs in one of the worktree's terminal tabs.
- **The team thread does not put a team in the worktree.** Its members are
  managed agents running wherever they run; the message carries a *path*, and
  whether anything on the other end can open it is not this pane's claim to
  make. There is no file access, no diff, no transcript and no plan in what is
  sent, and the pane enumerates that on screen rather than in this document
  alone.
- **Neither surface reads the other.** The ask thread is local because its
  speaker has no key; the team thread is on the relay because its speakers have
  their own. They are not two implementations of one thing waiting to be merged
  — see *Two agent surfaces* above before touching either store.

## Where things live

- **Island (fork-owned, additive):** `desktop/src/features/runs/**`
  - `lib/` — coordinator client, polling, run model, budget/legalNext,
    provision spec, reachability, projects/worktrees, the terminal tab model
    and key maps, the diff model, the agent turn model, the pane model and
    layout, the palette (`paletteKeys`, `paletteModel`, `paletteSources`,
    `paletteStore`, `usePalette`), ask mode and its thread
    (`askMode`, `askThread`, `askStore`, `askRunner`), the document
    substrate (`documents`, `documentStore`, `autosave`, `useDocument`,
    `planBrief`), the scratch shell (`scratchTerminal`,
    `terminalPersistence`), and the team thread (`teamThread`,
    `teamThreadStore`, `teamDraftStore`, `useTeamThread`). All pure modules
    carry their `.test.mjs` next to them; desktop's own `pnpm test` glob runs
    them.
  - `ui/` — `RunsScreen` (the three columns), `ProjectsNav`, `WorktreeColumn`,
    `WorkSurface` and the pane host (`PaneFrame`, `PaneDivider`, `PanePicker`,
    `paneRegistry`), `Terminal`, `TerminalTabStrip`, `WorktreeDiffPanel`,
    `AgentPanel`, `CommandPalette`, `DocumentEditor`, `NotesPane`, `PlanPane`,
    `ScratchTerminal`, `TeamThreadPane`, `PlanWorktreeDialog`,
    `NewWorktreeDialog`, `ProjectStatusBar`, plus the pre-existing `RunList`,
    `DeckPane`, `RunDetail`, `BudgetBar`, `StopAllButton` (hold-to-engage),
    `UnreachableBanner`, `RunsLoadingFallback`.
- **Island (fork-owned, Rust):** `desktop/src-tauri/src/vingilot_pty/**` (the
  PTY sessions, their scrollback, tmux backing, and the live proof),
  `vingilot_repo/**` (read-only probe of a picked directory),
  `vingilot_worktree/**` (worktree add/list/remove, the diff read, and
  `brief.rs` — a worktree opened with the plan that asked for it),
  `vingilot_agent/**` (the ACP client over an agent subprocess, which agent to
  run, the transcript, and the end-to-end proof).
- **Touch-points (declared in `vingilot/seams.yaml`):** the sidebar nav entry,
  the `/workspace` route registration, and the command registry in
  `src-tauri/src/lib.rs`. Kept to a few lines each — these are the files
  upstream merges can conflict on.
- **Coordinator:** unchanged except a localhost-allowlist CORS layer so the
  webview can call `http://127.0.0.1:7117` directly.

## Run it

```bash
docker compose up -d                     # postgres/redis/minio (vingilot-isolated stack)
./vingilot/scripts/coordinator-run.sh    # control plane on 127.0.0.1:7117
just dev                                 # Buzz desktop — "Projects" in the sidebar
```

The workspace polls the coordinator; killing the coordinator surfaces the
persistent unreachable banner (read-only, `as of <t>` stamps, disabled
composer with the reason inline) and recovers on its own when it returns.

## Honest notes

- The dev bearer token is a constant in webview code (`lib/coordinatorClient.ts`)
  — acceptable for a localhost-only control plane in V1; the follow-up is a
  Tauri-side proxy holding the token in the keychain.
- Wall-clock budgets are enforced (solid meter — the reconciler pauses the
  run); token counts are observed only (dashed `≈`, absent entirely when no
  data exists). Illegal transitions are absent from the DOM, not disabled.
- **⌘K is the island's on `/workspace` and upstream's everywhere else.** It was
  upstream's on every screen until this branch; the claim is scoped to the one
  screen and made through upstream's own `defaultPrevented` deference path, and
  the sidebar's "Search everything" button still opens upstream's dialog from
  the workspace. (This line used to read "no global ⌘K in the Runs screen —
  Buzz owns that shortcut for search". It does not any more.)
- **Six `localStorage` keys are this island's, all origin-scoped and all
  local:** `vingilot-columns.v1` (which columns are collapsed),
  `vingilot-panes.v1` (the pane arrangement), `vingilot-terminal-tabs.v1` (the
  terminal tabs), `vingilot-palette.v1` (the palette's recents),
  `vingilot-ask.v1` (the ask conversation), `vingilot-documents.v1` (Notes and
  Plan). Each is versioned so a shape change
  takes a new key rather than a migration — an older build reading a newer
  library finds nothing rather than something it half-understands. None of them
  is backed up, synced, or reachable from another machine, and the panes say
  so.

## Deferred

Chat adapter tie-in (Runs ↔ channels), attaching a terminal to a *Run's* own
process rather than to a worktree, side-by-side diff rendering, Tauri-proxied
coordinator auth, per-mode token budget enforcement (needs the
executor/broker — see `coordinator.md`'s deferred gaps).

Delivered since this list was written: the per-worktree PTY surface with
multiple tabs and tmux-backed persistence, worktree create/remove from the UI,
adding and removing projects through the folder picker, and worktree diff
review.

## Executor

The executor (`vingilot-executor`, `vingilot/coordinator/executor/`) is the
broker's first incarnation (ADR-003): it claims a `ready` delegated Run over
the coordinator's HTTP API, provisions a real `git worktree`, runs the Run's
command inside it, streams stdout/stderr as evidence rows, and drives the Run
to `completed`/`failed` honestly — a nonzero exit is a `failed` Run with the
exit code recorded, never a retry-until-green.

Every side-effecting step (worktree creation, running the command) is
preceded by a `validate-op` fencing check against the write-granted
binding's epoch (ADR-003 §Fencing). A denial — most commonly a stale epoch
from a concurrent re-acquisition — aborts `execute_run` immediately via
`ExecError::Fenced`, appends an `error` evidence row naming exactly what was
denied, and the run **never transitions past its current state on that
path** (no explicit `failed` transition is fired for a fencing denial itself
— the run simply stops progressing; the coordinator's reconciler
subsequently observes the lapsed/lost lease and moves it to `paused` with
reason `"lease lost"`, which is what live-tested fencing evidence looks like
in the Runs screen).

### Run it

```bash
docker compose up -d                        # postgres/redis/minio
./vingilot/scripts/coordinator-run.sh        # control plane on 127.0.0.1:7117
./vingilot/scripts/executor-run.sh <workspace-id>   # worker: polls every 3s,
                                              # claims oldest ready delegated run
```

`executor-run.sh` env: `VINGILOT_REPOS` (`repo_id=path` map, default
`buzz=<this checkout>`), `VINGILOT_WORKTREE_ROOT` (default
`~/.vingilot/worktrees`), `VINGILOT_CMD` (overrides the default `echo
executing: {objective}` command body). A single Run can also be driven
directly: `cargo run -p vingilot-executor -- execute --run <id>`.

### Live-tested loop (2026-08-03)

Against the dev workspace (`00000000-0000-0000-0000-000000000001`, the id
`RunsScreen` hardcodes): created a delegated Run with objective `"prove the
loop"` via `POST /v1/runs` + `POST /v1/runs/{id}/provision` (one write
binding on `repo_id: "buzz"`), started the worker, and watched it claim →
`git worktree add` → run the default echo command → `completed`, with real
evidence rows (the exact `git worktree add` command + its output, the
command + its output, an `outcome: completed` note) — captured in
`desktop/test-results/screenshots/executor-evidence.png` (Runs screen,
completed run selected, Evidence pane visible with live data from the
running coordinator, not mock data).

Fencing: reproduced by provisioning a second Run and, the instant it was
`ready`, flooding `POST /v1/bindings/{id}/lease` (an unconditional
re-acquire, per `binding.rs`'s doc comment: "always bumps the binding's
epoch regardless of who calls it") from an out-of-band client concurrently
with the worker's own claim — a race, not deterministic on the first try;
worktree_bindings epoch is a single contended row, capped at ~3–3.5k
acquisitions/sec by Postgres's per-row lock serialization, so multiple
attempts were needed before a bump landed between the worker's own
`acquire_lease` and its next `validate-op` call. The denied attempt shows up
exactly as `binding.rs` promises: an `error` evidence row — `"validate-op
denied before git worktree add: denied: stale epoch: binding <id> is at
epoch <N>, presented <N-8>"` — and the run never reaches `completed`; the
background reconciler later paused it (`running → paused`, reason `"lease
lost"`). Captured in
`desktop/test-results/screenshots/executor-fencing-denial.png`.

### Deferred (executor-specific)

Interactive/PTY execution mode, ACP harness launch (the command template —
`ExecutorConfig.command_template`, `{objective}` substituted — is the seam
where `claude -p` slots in later), per-mode token caps, worktree retirement
(worktrees are kept as the Run's artifact; cleanup is later UI work),
multi-run concurrency (the worker claims and runs exactly one Run at a
time), and an explicit `failed` transition on a fencing denial itself (today
the reconciler's `paused`/"lease lost" is the observable signal instead).

## Work products — what a Run changed

After the command exits, the executor captures the Run's work product (fenced,
like every other side effect):

1. `git status --porcelain` in the task worktree → a `note` evidence row.
2. If dirty: `git add -A && git commit` **inside that worktree, on the Run's own
   branch** → a `commit` evidence row carrying the real sha. This is the single
   place `add -A` is correct — the worktree exists solely for this Run and the
   commit *is* the artifact. The standing "never `git add -A`" rule applies to
   this repository and is unaffected.
3. `git diff HEAD~1 --stat` → `note`; the diff itself → a `diff` evidence row,
   capped at 48 KiB (the coordinator's per-row evidence ceiling is 64 KiB) with
   a truncation marker naming the real untruncated byte count.

A capture failure becomes `error` evidence; the Run's outcome still reflects the
command's exit code — capture is reporting, not verification.

RunDetail renders `kind=diff` through a pure `diffView` model: additions in the
ok colour, deletions in the stop colour, `@@` hunks emphasised, meta lines plain.
Commit rows appear in the Evidence timeline with a `⎘` prefix.

**Running a real coding agent as the command** is configuration, not code —
`VINGILOT_CMD` runs anything, so a headless harness slots straight in. That is
deliberately NOT wired up by default: an autonomous agent loop with approvals
disabled, inside a worktree ADR-003 declares is a collision boundary and not a
security boundary, is the owner's call to make explicitly — not a default.

## Deck — membership syncs, layout does not

Deck is the Runs screen's home pane (`ui/DeckPane.tsx`), not a separate
route or a second Deck identity. It splits what a pin *is* from where it
*sits*, because those two facts have different owners:

- **What's pinned (the set) syncs.** The pin set lives in Workspace state
  under `deck.pins` — `{ id, kind, pinnedAt }[]` — written through the
  coordinator's existing CAS mutation endpoint
  (`POST /v1/workspaces/{id}/mutations`) with `expected_revision` set to the
  revision the write was computed against. This is deliberately the *first*
  UI-driven exercise of ADR-002's mutation protocol; until Deck, only Rust
  tests wrote through it. `lib/deckSync.ts` is the orchestrator: read the
  current revision → compute the next `pins` array → write with that
  revision. It never retries a 409 on its own.
- **Where it sits (the layout) does not.** Order is `localStorage`, keyed by
  workspace id **and** a per-device id (`lib/deckLayout.ts`'s `layoutKey`).
  A laptop cannot scramble a monitor's arrangement, because the two devices
  never share a layout key — there is no server round-trip for order at all,
  so there is nothing to race. `deviceId()` is generated once and persisted
  locally; it never leaves the device (it is not part of any request body
  `deckSync` sends).

### Arrival on another device

When a pin appears in the synced set but this device's local `order` has
never seen its id — pinned elsewhere — `applyLayout` puts it in `unplaced`
rather than guessing a position. `DeckPane` renders unplaced cards with a
dashed border and the caption "pinned on another device — place it where you
like." Placing one (move-left/move-right or the `Place` action) inserts its
id into this device's `order` and persists it locally; it has no effect on
any other device's arrangement or on the synced set.

### Conflict resolution

A pin write races another device's write at the same revision → the
coordinator returns 409. `deckSync` surfaces this as
`{ conflict: true, revision, stateHash }` instead of retrying — nothing is
silently overwritten. The UI re-reads the winning state via a follow-up
`GET`, computes `pinsDiff(mine, theirs)`, and shows the conflict banner
(`data-testid="deck-conflict"`): "your pin didn't apply — `<device/rev>`
changed the pinned set first," with the added/removed ids listed. The owner
picks: **Keep theirs** (adopt the winning set, done) or **Re-apply mine on
top** (re-read the current revision and issue a fresh CAS write naming that
revision — a rebase, not a blind retry, per ADR-002).

### Tombstones

A pinned id whose Run no longer exists in the API (deleted, or from a
workspace this device can no longer see) renders a tombstone card — "no
longer available — unpin" — never a blank slot and never a crash. Unpinning
a tombstone is a normal CAS write removing that id from `deck.pins`.

### Reachability

While the coordinator is unreachable, pin toggles disable with the inline
reason inline, matching the rest of the Runs screen's honest-degradation
pattern — no fake queueing of a pin action that cannot actually be sent.

### Deferred

Drag-and-drop (ordering today is move-left/move-right buttons plus
keyboard — testable, no new dependency); `pr`/`surface` pin kinds (the
`Pin`/`PinKind` model already parses them; no UI renders them yet); multiple
Deck identities; Deck as a route independent of the Runs screen; interactive
surface actions (the design's action protocol — its own replay-safety work,
later).
