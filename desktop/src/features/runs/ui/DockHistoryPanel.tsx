// The dock's History tab (mockup `#dp-hist`): the `.histbar` Graph/Reflog
// segment over the mockup's own lane graph — `.grow2` rows with a `.gsvg`
// braid, `.chip2` ref chips, `.gmeta2` avatar / sha / age, and the
// "all branches · N commits" scope line.
//
// **P3 drew a column of dots here and said why.** The backend's format
// carried no `%P` and no `--all`, so there were no parents to braid and no
// second branch to braid them with; drawing lanes over a linear list would
// have been an invented topology, and the header said "HEAD · N commits"
// rather than the mockup's claim. **P4.1 fixed the data instead of the
// drawing**: `vingilot_worktree::log` reports every commit's parents and can
// walk every ref, `commitGraph.ts` turns those parents into lanes, and this
// panel now draws the picture the mockup drew — from git's own edges.
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
// workspace for a view tab on the stage (`viewTabs.ts`), which is also the
// honest answer to P3.1's geometry ruling.

import * as React from "react";

import {
  graphPixelWidth,
  graphWidth,
  laneColor,
  laneX,
  layoutCommitGraph,
  ROW_H,
} from "@/features/runs/lib/commitGraph";
import { readAllRefsHistory } from "@/features/runs/lib/historyClient";
import { type Commit, commitDate } from "@/features/runs/lib/historyModel";
import type { GraphRow } from "@/features/runs/lib/commitGraph";
import { explainWorktreeError } from "@/features/runs/lib/worktreePlan";
import type { PaneProps } from "@/features/runs/ui/paneRegistry";

type LogState =
  | { status: "reading" }
  | { status: "answered"; commits: Commit[]; more: boolean }
  | { status: "refused"; note: string };

type Segment = "graph" | "reflog";

export function DockHistoryPanel({ cwd, onPaneAct }: PaneProps) {
  if (cwd === null) return null;
  return <HistoryBody cwd={cwd} key={cwd} onPaneAct={onPaneAct} />;
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

function HistoryBody({
  cwd,
  onPaneAct,
}: {
  cwd: string;
  onPaneAct: PaneProps["onPaneAct"];
}) {
  const [segment, setSegment] = React.useState<Segment>("graph");
  const [log, setLog] = React.useState<LogState>({ status: "reading" });
  const [paging, setPaging] = React.useState(false);
  const [pageRefusal, setPageRefusal] = React.useState<string | null>(null);

  React.useEffect(() => {
    let alive = true;
    void readAllRefsHistory(cwd, 0).then((answered) => {
      if (!alive) return;
      setLog(
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

  // The union scope pages by offset — the number of rows already on screen —
  // because a union of refs has no single tip to continue from. The backend's
  // own header argues that out and states what it costs.
  const older = async () => {
    if (log.status !== "answered" || !log.more || paging) return;
    setPaging(true);
    const answered = await readAllRefsHistory(cwd, log.commits.length);
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
    setLog((current) =>
      current.status === "answered"
        ? {
            commits: [...current.commits, ...answered.value.commits],
            more: answered.value.more,
            status: "answered",
          }
        : current,
    );
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

  const commits = log.status === "answered" ? log.commits : [];
  // Recomputed only when the page grows: the walk is O(commits × lanes) and
  // this component re-renders on the workspace's 2s poll.
  const graph = React.useMemo(() => layoutCommitGraph(commits), [commits]);
  const lanes = graphWidth(graph);
  const now = Date.now();

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="dock-history">
      {/* The mockup's `.histbar`: the segment, and the scope line. */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-3.5 py-2.5">
        <div className="flex gap-0.5 rounded-[7px] bg-foreground/5 p-0.5">
          {(["graph", "reflog"] as const).map((name) => (
            <button
              aria-pressed={segment === name}
              className={`rounded-[5px] px-3 py-1 text-2xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
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
        {/* The mockup's `.hbranch`, and it may say "all branches" now: the read
         * behind it really is `git log --all`. The count is the page's, with a
         * `+` where there is more — never a repository total nobody counted. */}
        {/* `/70` rather than the mockup's `--mut`: measured on this card's own
         * ground the muted seed gives this 11px MONO line 4.22:1, under the
         * 4.5:1 floor — a thinner stroke than the sans text beside it at the
         * same token, which is exactly how a legal colour becomes an illegal
         * one. The same conscious WCAG-over-mockup deviation P0 and P1 made,
         * and the same register `DockShell`'s own notice uses. */}
        <span
          className="ml-auto font-mono text-2xs text-foreground/70"
          data-testid="dock-history-scope"
        >
          {log.status === "answered"
            ? `all branches · ${log.commits.length}${log.more ? "+" : ""} commits`
            : "all branches"}
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
 * drawn because it would look better joined up. */
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

/** One `.grow2` row: the lane graph, the message with its ref chips, and
 * sha / author / age on the right. */
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
      title={`${commit.subject} — open this commit's patch in a tab`}
      type="button"
    >
      {row === undefined ? null : (
        <LaneGraph head={head} lanes={lanes} row={row} />
      )}
      <span className="min-w-0 flex-1 truncate text-xs text-foreground/85">
        {commit.refs.map((ref) => (
          // `.chip2` for the ref HEAD is on, `.chip2.mn2` for every other
          // branch — the mockup's own pair, and now a real distinction:
          // reading every ref is what puts a second branch's name on screen.
          <span
            className={`mr-1.5 rounded-[5px] px-1.5 font-mono text-2xs font-semibold ${
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
        {commit.subject}
      </span>
      <span className="flex shrink-0 items-center gap-2 text-2xs text-muted-foreground">
        <span
          aria-hidden="true"
          className="flex h-4 w-4 items-center justify-center rounded-full text-2xs font-bold text-white"
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
        <span title={commitDate(commit.date)}>
          {commitAge(commit.date, now)}
        </span>
      </span>
    </button>
  );
}
