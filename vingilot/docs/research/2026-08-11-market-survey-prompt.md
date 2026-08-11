# Market survey prompt

Hand this to a research agent verbatim. It is written to be self-contained: the agent does not
need this repository, and must not be given it — the point is an outside read.

---

You are surveying the market for **agentic development environments**: tools that sit between a
developer and one or more AI coding agents and try to own the whole working session rather than
a single prompt. I am building one and I want to know what already exists, what those products
learned that I have not, and where the genuinely unclaimed ground is.

## What I am building, so you can compare against something concrete

A desktop application. Projects and git worktrees down one side; each worktree gets persistent
terminals (tmux-backed, they survive the app closing), a diff view, an agent conversation, notes
and a plan document. Multiple agents run in parallel, each in its own worktree, and the app
shows which ones need me. It has a team chat backed by a Nostr relay, so agents and people
share one message surface. It is a fork of an open-source app, single-user, running on my own
machines, with no cloud service behind it.

## Cover at least these, and add whatever else you find

**Agent harnesses / IDE-shaped:** Cursor, Windsurf, Zed's agent mode, GitHub Copilot Workspace,
JetBrains Junie, Amp (Sourcegraph), Cline, Roo Code, Aider, OpenHands, Devin (Cognition),
Factory, Warp 2.0, Antigravity.

**Orchestration and multi-agent surfaces:** Conductor, Crystal, Vibe Kanban, Terragon, Sculptor
(Imbue), Claude Code's own web/teams surfaces, Codex cloud, Jules (Google), Charlie, Tembo,
Sweep, Sourcegraph Batch Changes.

**Context and knowledge layers:** Spotify Xirp and Spotify Portal/Backstage, Unblocked, Cody's
context engine, Greptile, Sourcegraph's code search, Devin's DeepWiki, Continue.

**Terminal-shaped:** Warp, Wave Terminal, VelaTerm, nodeterm, tmux/zellij-based agent wrappers.

Include anything credible you find that I did not list, including single-developer projects
with real traction — those are often where the sharp ideas are.

## For each product, answer these and nothing else

1. **What is the unit of work?** A prompt, a file, a task, a session, a pull request, a
   repository, a fleet? This is the question that separates these products from each other, and
   most marketing pages will not answer it — infer it from the UI, the docs, the CLI verbs.
2. **How does it handle more than one thing at a time?** Tabs, worktrees, containers, cloud
   sandboxes, nothing? Where does parallel work physically run, and what happens to it when the
   app closes?
3. **What does it claim about context**, and by what mechanism — an index, embeddings, a
   knowledge graph, plain grep, a service catalogue, human-written docs? Say which, not "AI".
4. **What can the developer actually see?** Does it show what went into the model and what came
   back, token counts, cost? Or is the model call opaque?
5. **Where does state live** — local, their cloud, my cloud? What leaves the machine? Is there a
   usable fully-offline or self-hosted mode?
6. **What is the review surface?** How does a human read and accept what the agent did — diff,
   PR, checkpoints, nothing?
7. **Business model and status**: free, paid, seat-priced, usage-priced; beta, GA, abandoned.
   Note the last meaningful release date.
8. **One sentence: what is this product's actual bet?** Not its tagline — the thing it is
   wagering will matter.

## How to work

- **Prefer primary sources**: documentation, changelogs, source code, the CLI's `--help`, GitHub
  issues, release notes. A landing page tells you what a company wants to be true.
- **Marketing language is not a finding.** "Deeply understands your codebase" goes in the bin
  unless you can name the mechanism. If you cannot determine something, write *unknown* — an
  invented answer is worse than a gap, and I will act on this.
- **Separate what you verified from what you inferred.** Mark every claim one or the other.
- Where a product is open source, read enough of the code to answer questions 2, 3 and 5
  properly. That is where the real answers are.
- Note **when** you looked; several of these change monthly.

## What I want back

1. **A comparison table** — one row per product, the columns above. Terse cells.
2. **What is now table stakes** — the five or six things nearly all of them have. These are what
   a product is judged as broken for lacking, and I need the list to check myself against.
3. **The ideas worth stealing** — at most ten. For each: which product, what it does concretely,
   why it works, and what it costs to build. Ranked by value to a single-developer product with
   no cloud service. Be specific enough that I could start on Monday.
4. **The crowded ground** — where five products are already doing the same thing well enough
   that entering it is a waste of my time.
5. **The unclaimed ground** — real gaps, each with the reason nobody has filled it. "Nobody has
   done X" is not a finding until you can say whether that is because X is hard, X is worthless,
   or X only matters to a small group. Say which.
6. **Where my product is behind** — using the description above, the specific places where these
   products would beat it, most damaging first. Do not soften this; it is the part I am paying
   for.
7. **Three things I should not build**, with the reason.

Put the table first. Keep the prose tight — I would rather have a hard, short answer than a
survey.
