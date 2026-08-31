// The History panel (mockup `#dp-hist`): the `.histbar` Graph/Reflog segment
// over the mockup's own lane graph — `.grow2` rows with a `.gsvg` braid,
// `.chip2` ref chips, `.gmsg` subject and `.gmeta2` avatar / sha / age, under
// the scope line the mockup writes as "all branches · 42 commits".
//
// **P3 drew a column of dots here and said why.** The backend's format carried
// no `%P` and no `--all`, so there were no parents to braid and no second
// branch to braid them with. **P4.1 fixed the data instead of the drawing**:
// `vingilot_worktree::log` reports every commit's parents and can walk every
// ref, `commitGraph.ts` turns those parents into lanes, and this panel draws
// the picture the mockup drew — from git's own edges.
//
// **And P4.3 gave that picture a ceiling, because without one it ate the
// row.** Measured live in the dock at 376px: `--all` over this repository's
// newest 200 commits needs 24 lanes, the row's SVG is `shrink-0`, and the two
// together left the subject 0px wide with the sha and the age off the row —
// the owner's own complaint, *"su graph kismina bisi anlasilmiyo"*. The width
// is now spent in a stated order (`commitGraph.ts`: subject floor, fixed meta,
// lanes last), and when the lanes do not fit **the panel changes what it is
// reading rather than how it draws**: `git log --first-parent HEAD`, a chain
// that cannot fork, with the header saying "first-parent" instead of "all
// branches". Compressing 24 columns into two would have been a picture of
// something that is not this repository.
//
// **One component, two widths.** The same panel is the dock's card and the
// full-width tab beside the shells (`ViewTabSurface`), and the scope is
// decided from the box it finds itself in — so the dock stays a scannable list
// and the tab is where the braid gets room, which is P4.3's own ruling.
//
// **What the mockup still asks for and this build still cannot give**, stated
// rather than faked:
//
// - **The reflog.** No reflog reader exists anywhere in this app, on either
//   side of the bridge. The segment draws; its body is an honest refusal.
// - **Real avatars.** `.gav` is a photograph in the mockup. This app knows a
//   commit's author *name* (git's `%an`) and has no identity mapping from a
//   git ident to a Buzz profile — so the circle carries the initial and a hue
//   derived from the name, which is a rendering of data we have rather than a
//   face we do not.
// - **An exact total.** "42 commits" in the mockup is a repository-wide count;
//   the read here is bounded at one page (200), so the line says `200+` when
//   there is more rather than a number nobody counted.
//
// **A row opens its patch as a TAB, not inside this card** (P4.1 items 3-4).
// The dock is 300-540px wide; a patch is not. Clicking a commit asks the
// workspace for a view tab on the stage (`viewTabs.ts`).

import * as React from "react";

import {
  graphPixelWidth,
  graphWidth,
  type GraphScope,
  laneBudget,
  laneColor,
  laneX,
  layoutCommitGraph,
  META_PX,
  ROW_H,
  scopeLabel,
  subjectParts,
} from "@/features/runs/lib/commitGraph";
import {
  readAllRefsHistory,
  readTrunkHistory,
} from "@/features/runs/lib/historyClient";
import { type Commit, commitDate } from "@/features/runs/lib/historyModel";
import type { GraphRow } from "@/features/runs/lib/commitGraph";
import type { PaneAct } from "@/features/runs/lib/paneModel";
import { explainWorktreeError } from "@/features/runs/lib/worktreePlan";
import type { PaneProps } from "@/features/runs/ui/paneRegistry";

type LogState =
  | { status: "reading" }
  | { status: "answered"; commits: Commit[]; more: boolean }
  | { status: "refused"; note: string };

const READING: LogState = { status: "reading" };

type Segment = "graph" | "reflog";

export function DockHistoryPanel({ cwd, onPaneAct }: PaneProps) {
  if (cwd === null) return null;
  return <HistoryPanel cwd={cwd} key={cwd} onPaneAct={onPaneAct} />;
}

/** The mockup's `.gmeta2` age — "18m", "3d" — from the commit's own ISO
 * date. Coarse on purpose: an age is a reading aid, not a timestamp. */
export function commitAge(iso: string, now: number): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "";
  const minutes = Math.max(0, Math.floor((now - at) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 365) return `${days}d`;
  return `${Math.floor(days / 365)}y`;
}

/** `.gav`'s hue, derived from the author's own name.
 *
 * The mockup gives each avatar a hand-picked gradient. There is no photograph
 * and no identity map behind a git ident here, so the colour is a function of
 * the name: stable for one author across every commit and every launch, which
 * is the whole of what the mockup's colour does for a reader. It carries no
 * claim about who anybody is. */
export function authorHue(author: string): number {
  let hash = 0;
  for (const char of author) hash = (hash * 31 + char.charCodeAt(0)) % 360;
  return hash;
}

/** Whether HEAD is on this commit — `%D` writes it as `HEAD` alone (detached)
 * or `HEAD -> branch`. */
function isHead(commit: Commit): boolean {
  return commit.refs.some((ref) => ref === "HEAD" || ref.startsWith("HEAD "));
}

/** How many ref chips a row draws before the rest become a count.
 *
 * The mockup draws one. On a real repository a commit at the tip of a synced
 * branch carries `HEAD -> x`, `origin/x` and often a tag as well, and three
 * chips on a 376px row is the subject gone again — the defect P4.3 is about,
 * arriving by a second door. Two, then `+N` with the whole list in the row's
 * own title. */
const MAX_CHIPS = 2;

function commitsOf(state: LogState): Commit[] {
  return state.status === "answered" ? state.commits : [];
}

export function HistoryPanel({
  cwd,
  onPaneAct,
  /** True on the copy that IS the full-width tab: it does not offer to open a
   * tab, which would be a loop. The same rule `WorktreeDiffPanel` keeps for
   * its own door. */
  tabbed = false,
}: {
  cwd: string;
  onPaneAct: (act: PaneAct) => void;
  tabbed?: boolean;
}) {
  const [segment, setSegment] = React.useState<Segment>("graph");
  // Two readings, because the choice between them is made from a measurement
  // that arrives after the first one. `all` is the union of every ref — what a
  // branch graph is a picture of — and `trunk` is `--first-parent HEAD`, read
  // lazily and only if the union does not fit. Keeping both means the decision
  // is reversible: widening the pane (or opening this panel as a tab) puts the
  // braid back without a second round trip.
  const [all, setAll] = React.useState<LogState>(READING);
  const [trunk, setTrunk] = React.useState<LogState | null>(null);
  const [paging, setPaging] = React.useState(false);
  const [pageRefusal, setPageRefusal] = React.useState<string | null>(null);

  // This panel's own width, because how many lanes may be drawn is a question
  // in pixels (`laneBudget`) and no class name can express it. A layout effect
  // so the first paint is already the right layout; 0 until measured, which
  // `laneBudget` reads as the narrowest case.
  const boxRef = React.useRef<HTMLDivElement | null>(null);
  const [boxWidth, setBoxWidth] = React.useState(0);
  React.useLayoutEffect(() => {
    const box = boxRef.current;
    if (box === null) return;
    setBoxWidth(box.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect.width;
      if (measured !== undefined) setBoxWidth(measured);
    });
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  React.useEffect(() => {
    let alive = true;
    void readAllRefsHistory(cwd, 0).then((answered) => {
      if (!alive) return;
      setAll(
        answered.ok
          ? {
              commits: answered.value.commits,
              more: answered.value.more,
              status: "answered",
            }
          : {
              note: explainWorktreeError(answered.error).message,
              status: "refused",
            },
      );
    });
    return () => {
      alive = false;
    };
  }, [cwd]);

  // Recomputed only when the page grows: the walk is O(commits × lanes) and
  // this component re-renders on the workspace's 2s poll.
  const allCommits = commitsOf(all);
  const allGraph = React.useMemo(
    () => layoutCommitGraph(allCommits),
    [allCommits],
  );
  const budget = laneBudget(boxWidth);
  // **The whole of the ceiling, in one line.** The union is drawn when it fits
  // and only then; otherwise the panel is reading the trunk and says so.
  const scope: GraphScope =
    all.status === "answered" && graphWidth(allGraph) > budget
      ? "first-parent"
      : "all-branches";

  // **The trunk read, and the shape it must NOT have.** Written first with
  // `trunk` in the dependency array and a `trunk !== null` guard, this effect
  // was a loop that cancelled itself: it set `trunk` to READING as its first
  // act, which changed a dependency, which fired the cleanup that killed the
  // in-flight read's continuation, and the re-run then took the guard's early
  // return. The panel could never leave "reading this repository's history…".
  //
  // It passed every spec, because a mock that answers in a microtask beats the
  // re-render — and it hung in the owner's live app, where a Tauri round trip
  // does not. The fixture now costs 60ms for exactly this reason. The
  // dependencies are the two things that really change the question; nothing
  // this effect WRITES is one of them.
  React.useEffect(() => {
    if (scope !== "first-parent") return;
    let alive = true;
    setTrunk(READING);
    void readTrunkHistory(cwd, null).then((answered) => {
      if (!alive) return;
      setTrunk(
        answered.ok
          ? {
              commits: answered.value.commits,
              more: answered.value.more,
              status: "answered",
            }
          : {
              note: explainWorktreeError(answered.error).message,
              status: "refused",
            },
      );
    });
    return () => {
      alive = false;
    };
  }, [cwd, scope]);

  const log: LogState = scope === "all-branches" ? all : (trunk ?? READING);
  const commits = commitsOf(log);
  const trunkGraph = React.useMemo(
    () => layoutCommitGraph(commits, { firstParentOnly: true }),
    [commits],
  );
  const graph = scope === "all-branches" ? allGraph : trunkGraph;
  const lanes = graphWidth(graph);

  // The union pages by offset — the number of rows already on screen — because
  // a union of refs has no single tip to continue from. The trunk has one, so
  // it pages by cursor and cannot slide a row the owner has read into the next
  // page. The backend's own header argues both out.
  const older = async () => {
    if (log.status !== "answered" || !log.more || paging) return;
    setPaging(true);
    const answered =
      scope === "all-branches"
        ? await readAllRefsHistory(cwd, log.commits.length)
        : await readTrunkHistory(
            cwd,
            log.commits[log.commits.length - 1]?.hash ?? null,
          );
    setPaging(false);
    if (!answered.ok) {
      // A refused page costs the page and not the history already on screen:
      // git's own words go beside the control that asked, never in place of
      // the list. Cleared by the page that succeeds — a banner pinned over a
      // control that has since worked is a lie with a long half-life.
      setPageRefusal(explainWorktreeError(answered.error).message);
      return;
    }
    setPageRefusal(null);
    const grow = (current: LogState): LogState =>
      current.status === "answered"
        ? {
            commits: [...current.commits, ...answered.value.commits],
            more: answered.value.more,
            status: "answered",
          }
        : current;
    if (scope === "all-branches") setAll(grow);
    else setTrunk((current) => (current === null ? current : grow(current)));
  };

  const openCommit = React.useCallback(
    (commit: Commit) => {
      onPaneAct({
        type: "open-view",
        view: { hash: commit.hash, kind: "commit", short: commit.short },
        worktree: cwd,
      });
    },
    [cwd, onPaneAct],
  );

  const now = Date.now();

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      data-testid="dock-history"
      ref={boxRef}
    >
      {/* The mockup's `.histbar`: the segment, and the scope line. */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-3.5 py-2.5">
        <div className="flex gap-0.5 rounded-[7px] bg-foreground/5 p-0.5">
          {(["graph", "reflog"] as const).map((name) => (
            <button
              aria-pressed={segment === name}
              className={`rounded-[5px] px-2.5 py-1 text-2xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
                segment === name
                  ? "bg-foreground/[.12] text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              data-testid={`dock-history-segment-${name}`}
              key={name}
              onClick={() => setSegment(name)}
              type="button"
            >
              {name === "graph" ? "Graph" : "Reflog"}
            </button>
          ))}
        </div>
        {tabbed ? null : (
          // **One word, not four, and not a glyph.** Two measurements decided
          // this. "Open in tab" beside the segment left the scope line 60px
          // short at the dock's own 374px and it rendered as "first-parent ·
          // 200+ com" with the rest off the card — this round's own defect,
          // arriving in the header instead of the row. Replacing it with the
          // `⧉` glyph fixed the width and failed the floor: measured from the
          // screenshot, a 1px-stroke glyph at 11px never reaches its own
          // colour and read 2.93:1 against the card. A word has stems, and
          // "Tab" measures with the muted text beside it. The `aria-label`
          // carries the whole sentence.
          <button
            aria-label="Open this history in a tab"
            className="shrink-0 rounded-md px-1 py-0.5 text-2xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
            data-testid="dock-history-open-tab"
            onClick={() =>
              onPaneAct({
                type: "open-view",
                view: { kind: "history" },
                worktree: cwd,
              })
            }
            title="Read this history in a tab beside the shells, where the graph has room for every branch"
            type="button"
          >
            Tab
          </button>
        )}
        {/* The mockup's `.hbranch`, and **it says which reading is on screen**:
         * "all branches" when the union fits, "first-parent" when it does not.
         * The count is the page's, with a `+` where there is more — never a
         * repository total nobody counted.
         *
         * `/70` rather than the mockup's `--mut`: measured on this card's own
         * ground the muted seed gives this 11px MONO line 4.22:1, under the
         * 4.5:1 floor — a thinner stroke than the sans text beside it at the
         * same token, which is exactly how a legal colour becomes an illegal
         * one. The same conscious WCAG-over-mockup deviation P0 and P1 made. */}
        <span
          className="ml-auto min-w-0 truncate font-mono text-2xs text-foreground/70"
          data-scope={scope}
          data-testid="dock-history-scope"
          title={
            scope === "all-branches"
              ? "every ref in this repository, as git reports them"
              : `this pane can draw ${budget} lanes and every branch needs more, so this is HEAD's first-parent chain — open History in a tab for the whole graph`
          }
        >
          {log.status === "answered"
            ? `${scopeLabel(scope)} · ${log.commits.length}${log.more ? "+" : ""} commits`
            : scopeLabel(scope)}
        </span>
      </div>

      {segment === "reflog" ? (
        // `/70`, not `muted`: the same center-notice pattern as `DockShell`'s
        // `DockNotice`, measured on the float's `bg-popover` ground and
        // given the same margin.
        <p
          className="flex flex-1 items-center justify-center px-6 py-4 text-center text-sm text-foreground/70"
          data-testid="dock-history-reflog-empty"
        >
          No reflog reader in this build yet — the graph is read live from every
          ref; the reflog needs a backend read that has not been written.
        </p>
      ) : (
        <div
          className="min-h-0 flex-1 overflow-y-auto py-1.5"
          data-testid="dock-history-graph"
        >
          {log.status === "reading" ? (
            <p
              className="px-4 py-1 text-xs text-foreground/70"
              data-testid="dock-history-reading"
            >
              reading this repository&apos;s history…
            </p>
          ) : log.status === "refused" ? (
            <p
              className="px-4 py-1 text-xs text-destructive"
              data-testid="dock-history-refused"
            >
              {log.note}
            </p>
          ) : log.commits.length === 0 ? (
            // The one sentence this panel is entitled to say about an empty
            // answer, and only here: `worktree_log` reports "this repository
            // has been init'ed and never committed" as an ANSWER, not as a
            // failure, so an empty page really does mean no commits. An empty
            // page from any other cause is a refusal above, never this.
            <p
              className="px-4 py-1 text-xs text-foreground/70"
              data-testid="dock-history-empty"
            >
              no commits yet — nothing has been committed in this repository.
            </p>
          ) : (
            <>
              {log.commits.map((commit, at) => (
                <CommitRow
                  commit={commit}
                  key={commit.hash}
                  lanes={lanes}
                  now={now}
                  onOpen={() => openCommit(commit)}
                  row={graph[at]}
                />
              ))}
              {log.more ? (
                <div className="flex flex-col gap-1 px-3.5 py-1.5">
                  <p
                    className="text-2xs text-foreground/70"
                    data-testid="dock-history-older-note"
                  >
                    {`${log.commits.length} commits shown — there are older ones.`}
                  </p>
                  {pageRefusal === null ? null : (
                    <p
                      className="text-2xs text-destructive"
                      data-testid="dock-history-older-refused"
                    >
                      {pageRefusal}
                    </p>
                  )}
                  <button
                    className="self-start rounded border border-border/60 px-1.5 py-0.5 text-2xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
                    data-testid="dock-history-older"
                    disabled={paging}
                    onClick={() => void older()}
                    type="button"
                  >
                    {paging ? "Reading…" : "Older"}
                  </button>
                </div>
              ) : null}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** The mockup's `.gsvg` for one row: the lines that cross it, the lines that
 * end or begin at its dot, and the dot.
 *
 * Every stroke here is an edge git reported (`commitGraph.ts`) — nothing is
 * drawn because it would look better joined up, and nothing is squeezed to
 * fit: the panel above has already made sure the reading on screen needs no
 * more columns than this box has. */
function LaneGraph({
  head,
  lanes,
  row,
}: {
  head: boolean;
  lanes: number;
  row: GraphRow;
}) {
  const width = graphPixelWidth(lanes);
  const x = laneX(row.lane);
  const mid = ROW_H / 2;
  return (
    <svg aria-hidden="true" className="shrink-0" height={ROW_H} width={width}>
      {row.through.map((lane) => (
        <path
          d={`M${laneX(lane)} 0 V${ROW_H}`}
          fill="none"
          key={`t${lane}`}
          stroke={laneColor(lane)}
          strokeWidth="1.5"
        />
      ))}
      {row.joins.map((lane) => (
        // A lane that was waiting for this commit, curving in from above and
        // ending here — the mockup's own merge stroke.
        <path
          d={`M${laneX(lane)} 0 C ${laneX(lane)} ${mid * 0.75}, ${x} ${mid * 0.4}, ${x} ${mid}`}
          fill="none"
          key={`j${lane}`}
          stroke={laneColor(lane)}
          strokeWidth="1.5"
        />
      ))}
      {row.forks.map((lane) => (
        // A second parent, going off into its own lane below.
        <path
          d={`M${x} ${mid} C ${x} ${mid * 1.4}, ${laneX(lane)} ${mid * 1.25}, ${laneX(lane)} ${ROW_H}`}
          fill="none"
          key={`f${lane}`}
          stroke={laneColor(lane)}
          strokeWidth="1.5"
        />
      ))}
      {row.up ? (
        <path
          d={`M${x} 0 V${mid}`}
          fill="none"
          stroke={laneColor(row.lane)}
          strokeWidth="1.5"
        />
      ) : null}
      {row.down ? (
        <path
          d={`M${x} ${mid} V${ROW_H}`}
          fill="none"
          stroke={laneColor(row.lane)}
          strokeWidth="1.5"
        />
      ) : null}
      {/* The mockup's own dot: hollow on the commit HEAD is at, filled on the
       * rest — the one place in the drawing that is about *where you are*
       * rather than about topology. */}
      <circle
        cx={x}
        cy={mid}
        fill={head ? "var(--vingilot-term, #101014)" : laneColor(row.lane)}
        r="3.4"
        stroke={laneColor(row.lane)}
        strokeWidth={head ? "1.8" : "0"}
      />
    </svg>
  );
}

/** One `.grow2` row, 38px tall: the bounded lane gutter, the SUBJECT as the
 * row's primary text, and sha / author / age as small meta on the right. */
function CommitRow({
  commit,
  lanes,
  now,
  onOpen,
  row,
}: {
  commit: Commit;
  lanes: number;
  now: number;
  onOpen: () => void;
  row: GraphRow | undefined;
}) {
  const head = isHead(commit);
  const hue = authorHue(commit.author);
  const chips = commit.refs.slice(0, MAX_CHIPS);
  const hidden = commit.refs.length - chips.length;
  // The subject under the same lead/name discipline the file rows keep: the
  // repeated conventional-commit prefix dims, what happened stays bright.
  const { lead, name } = subjectParts(commit.subject);
  return (
    // `role="option"`: a row is a *selection*, not an act — `HistoryPane`'s own
    // rule, and the reason `workspace-history.fixtures.ts`'s `controlNames()`
    // excludes it. A commit's own subject is git's data and may contain any
    // word in the language ("Revert…", "commit the fix…"); without this role
    // the mutating-verb scan reads the row's own title as a control offering
    // an act it does not offer.
    <button
      className="flex w-full items-center gap-1 py-0 pl-2 pr-3.5 text-left transition-colors hover:bg-foreground/[.04] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
      data-testid={`dock-history-commit-${commit.hash}`}
      onClick={onOpen}
      role="option"
      style={{ height: ROW_H }}
      title={`${commit.refs.length === 0 ? "" : `${commit.refs.join(", ")} — `}${commit.subject} — open this commit's patch in a tab`}
      type="button"
    >
      {row === undefined ? null : (
        <LaneGraph head={head} lanes={lanes} row={row} />
      )}
      {/* The mockup's `.gmsg`, and the row's point. `min-w-0 flex-1` against
       * the `shrink-0` graph and meta: this is the box the width is spent ON,
       * and the two beside it are what it is spent against. */}
      <span
        className="flex min-w-0 flex-1 items-baseline gap-1.5 text-xs"
        data-testid={`dock-history-subject-${commit.hash}`}
      >
        {chips.map((ref) => (
          // `.chip2` for the ref HEAD is on, `.chip2.mn2` for every other
          // branch — the mockup's own pair, and a real distinction: reading
          // every ref is what puts a second branch's name on screen.
          // **A chip gives way before the subject does.** The mockup's is
          // "HEAD · surface-cards"; this repository's is
          // `HEAD -> vingilot/finding-things`, and drawn `shrink-0` it took the
          // whole 376px row and left the subject nothing — the P4.3 defect
          // arriving by a third door. Capped at 45% and truncated, with the
          // whole ref list in the row's own title.
          <span
            className={`min-w-0 max-w-[45%] truncate rounded-[5px] px-1.5 font-mono text-2xs font-semibold ${
              ref === "HEAD" || ref.startsWith("HEAD ")
                ? "bg-[var(--vingilot-accent-soft)] text-[var(--vingilot-accent-text)]"
                : "bg-[rgba(127,178,201,.16)] text-[#b6d5e2]"
            }`}
            data-testid={`dock-history-ref-${ref}`}
            key={ref}
          >
            {ref}
          </span>
        ))}
        {hidden > 0 ? (
          <span
            className="shrink-0 rounded-[5px] bg-foreground/10 px-1 font-mono text-2xs text-foreground/70"
            data-testid={`dock-history-more-refs-${commit.hash}`}
          >
            {`+${hidden}`}
          </span>
        ) : null}
        {lead === "" ? null : (
          <span className="shrink-0 text-muted-foreground">{lead}</span>
        )}
        <span className="min-w-0 truncate text-foreground/85">{name}</span>
      </span>
      <span
        className="flex shrink-0 items-center gap-2 text-2xs text-muted-foreground"
        style={{ minWidth: 0, width: META_PX }}
      >
        <span
          aria-hidden="true"
          className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-2xs font-bold text-white"
          style={{
            background: `linear-gradient(140deg, hsl(${hue} 45% 42%), hsl(${hue} 45% 22%))`,
          }}
          title={commit.author}
        >
          {commit.author.slice(0, 1).toUpperCase()}
        </span>
        <span className="font-mono">{commit.short}</span>
        {/* The mockup's `.gmeta2` shows an age, which is a reading aid; the
         * author's own clock is still one hover away rather than lost —
         * `commitDate` slices `%aI` rather than re-zoning it into the
         * reader's, so 02:18 at +03:00 stays 02:18. */}
        <span className="ml-auto" title={commitDate(commit.date)}>
          {commitAge(commit.date, now)}
        </span>
      </span>
    </button>
  );
}
