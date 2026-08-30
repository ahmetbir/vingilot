// The dock's History tab (redesign P3, mockup `#dp-hist`): the `.histbar`
// Graph/Reflog segment over commit rows, drawn from the reads this app
// really has.
//
// **Linear rows with dots, not the mockup's SVG lanes — said, not fudged.**
// The mockup's `.gsvg` braids two branch lanes; the backend's `worktree_log`
// carries no parent hashes (`%H%n%h%n%an%n%aI%n%D%n%s` — no `%P`) and no
// `--all`, so it is HEAD's own linear history and a lane drawing over it
// would be an invented topology. The mockup itself draws single-lane rows as
// plain dots, so that is what linear history honestly is here: one dot per
// commit, the accent dot on the row HEAD points at, ref chips (`.chip2`),
// sha / author / age on the right (`.gmeta2`). The header says what the
// list is — "HEAD · N commits" — never the mockup's "all branches", which
// this read cannot claim.
//
// **Reflog: the segment draws; the body is honest.** No reflog reader exists
// anywhere in this app (recon grepped both sides), so the second segment
// renders its designed empty state rather than sample rows.
//
// **A row opens its patch** — the same `commit_diff` read and the same
// shared `Patch` box the History pane renders, full-panel with the back
// affordance `Patch` already carries. Superseded answers are dropped on a
// counter, `HistoryPane.tsx`'s own discipline.

import * as React from "react";

import { patchWrapsAt, splitFitsAt } from "@/features/runs/lib/diffLayout";
import { effectiveDiffMode } from "@/features/runs/lib/diffMode";
import { readCommitDiff, readHistory } from "@/features/runs/lib/historyClient";
import type { Commit, StatusEntry } from "@/features/runs/lib/historyModel";
import {
  missingPatchNote,
  STATUS_BASE,
  statusPatch,
} from "@/features/runs/lib/historyModel";
import {
  type HistoryRequest,
  historyShouldLand,
  pendingHistoryPatch,
  subscribeHistoryTarget,
  takeHistoryPatch,
} from "@/features/runs/lib/historyTarget";
import { useDiffMode } from "@/features/runs/lib/useDiffMode";
import { gitWorktreeDiff } from "@/features/runs/lib/worktreeClient";
import { explainWorktreeError } from "@/features/runs/lib/worktreePlan";
import { Patch, type PatchState } from "@/features/runs/ui/HistoryPatch";
import type { PaneProps } from "@/features/runs/ui/paneRegistry";

type LogState =
  | { status: "reading" }
  | {
      status: "answered";
      commits: Commit[];
      more: boolean;
      cursor: string | null;
    }
  | { status: "refused"; note: string };

type Segment = "graph" | "reflog";

export function DockHistoryPanel({ cwd }: PaneProps) {
  if (cwd === null) return null;
  return <HistoryBody cwd={cwd} key={cwd} />;
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

function isHead(commit: Commit): boolean {
  return commit.refs.some((ref) => ref === "HEAD" || ref.startsWith("HEAD "));
}

function HistoryBody({ cwd }: { cwd: string }) {
  const [segment, setSegment] = React.useState<Segment>("graph");
  const [log, setLog] = React.useState<LogState>({ status: "reading" });
  const [patch, setPatch] = React.useState<PatchState>({ status: "none" });
  const [paging, setPaging] = React.useState(false);

  // Superseded answers are dropped — one counter over both readers, the
  // History pane's own rule.
  const readCount = React.useRef(0);

  React.useEffect(() => {
    let alive = true;
    void readHistory(cwd, null).then((answered) => {
      if (!alive) return;
      setLog(
        answered.ok
          ? {
              commits: answered.value.commits,
              cursor: answered.value.cursor,
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

  const older = async () => {
    if (log.status !== "answered" || log.cursor === null || paging) return;
    setPaging(true);
    const answered = await readHistory(cwd, log.cursor);
    setPaging(false);
    if (!answered.ok) return;
    setLog((current) =>
      current.status === "answered"
        ? {
            commits: [...current.commits, ...answered.value.commits],
            cursor: answered.value.cursor,
            more: answered.value.more,
            status: "answered",
          }
        : current,
    );
  };

  const openCommit = React.useCallback(
    async (hash: string) => {
      const mine = readCount.current + 1;
      readCount.current = mine;
      setPatch({ status: "reading" });
      const answered = await readCommitDiff(cwd, hash);
      if (readCount.current !== mine) return;
      setPatch(
        answered.ok
          ? { answer: answered.value, status: "commit" }
          : {
              note: explainWorktreeError(answered.error).message,
              status: "refused",
            },
      );
    },
    [cwd],
  );

  // A status row's patch is a slice of ONE `worktree_diff` read, cached per
  // status generation — `HistoryPane.tsx`'s exact discipline, kept so the
  // sidebar's Reread retires this cache too and a refusal is never cached.
  const headDiff = React.useRef<{
    generation: number;
    read: Awaited<ReturnType<typeof gitWorktreeDiff>>;
  } | null>(null);
  const openStatusFile = React.useCallback(
    async (entry: StatusEntry, generation: number) => {
      const mine = readCount.current + 1;
      readCount.current = mine;
      setPatch({ status: "reading" });
      const cached =
        headDiff.current !== null && headDiff.current.generation === generation
          ? headDiff.current.read
          : null;
      const read = cached ?? (await gitWorktreeDiff(cwd, STATUS_BASE));
      if (readCount.current !== mine) return;
      if (!read.ok) {
        setPatch({
          note: explainWorktreeError(read.error).message,
          status: "refused",
        });
        return;
      }
      headDiff.current = { generation, read };
      const found = statusPatch(read.value, entry);
      setPatch(
        found === null
          ? { note: missingPatchNote(entry), status: "refused" }
          : { file: found, status: "file" },
      );
    },
    [cwd],
  );

  // The door from the sidebar's History list (`historyTarget.ts`) —
  // pending-then-subscribe, the same sequence the retired `HistoryPane` kept:
  // the sidebar files the target and THEN brings this panel forward.
  const land = React.useCallback(
    (request: HistoryRequest) => {
      if (request.pick.kind === "commit") {
        void openCommit(request.pick.commit.hash);
        return;
      }
      void openStatusFile(request.pick.entry, request.pick.statusGeneration);
    },
    [openCommit, openStatusFile],
  );
  React.useEffect(() => {
    const pending = pendingHistoryPatch();
    if (pending !== null && historyShouldLand(pending, cwd)) {
      takeHistoryPatch();
      land(pending);
    }
    return subscribeHistoryTarget((request) => {
      if (!historyShouldLand(request, cwd)) return;
      takeHistoryPatch();
      land(request);
    });
  }, [cwd, land]);

  // The patch box's width machinery, shared with the History pane.
  const paneRef = React.useRef<HTMLDivElement | null>(null);
  const [paneWidth, setPaneWidth] = React.useState(0);
  React.useLayoutEffect(() => {
    const pane = paneRef.current;
    if (pane === null) return;
    setPaneWidth(pane.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect.width;
      if (measured !== undefined) setPaneWidth(measured);
    });
    observer.observe(pane);
    return () => observer.disconnect();
  }, []);
  const mode = effectiveDiffMode(useDiffMode(), splitFitsAt(paneWidth));

  const now = Date.now();
  const showingPatch = patch.status !== "none";

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      data-testid="dock-history"
      ref={paneRef}
    >
      {/* The mockup's `.histbar`: the segment, and the honest scope label. */}
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
        <span className="ml-auto font-mono text-2xs text-muted-foreground">
          {log.status === "answered"
            ? `HEAD · ${log.commits.length}${log.more ? "+" : ""} commits`
            : "HEAD"}
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
          No reflog reader in this build yet — the graph is HEAD&apos;s own
          history, read live; the reflog needs a backend read that has not been
          written.
        </p>
      ) : showingPatch ? (
        <Patch
          mode={mode}
          onBack={() => setPatch({ status: "none" })}
          paneWidth={paneWidth}
          state={patch}
          wraps={patchWrapsAt(paneWidth)}
        />
      ) : (
        <div
          className="min-h-0 flex-1 overflow-y-auto py-1.5"
          data-testid="dock-history-graph"
        >
          {log.status === "reading" ? (
            <p className="px-4 py-1 text-xs text-muted-foreground">
              reading this worktree&apos;s history…
            </p>
          ) : log.status === "refused" ? (
            <p
              className="px-4 py-1 text-xs text-destructive"
              data-testid="dock-history-refused"
            >
              {log.note}
            </p>
          ) : (
            <>
              {log.commits.map((commit) => (
                <CommitRow
                  commit={commit}
                  key={commit.hash}
                  now={now}
                  onOpen={() => void openCommit(commit.hash)}
                />
              ))}
              {log.more ? (
                <button
                  className="mx-3.5 my-1.5 rounded border border-border/60 px-1.5 py-0.5 text-2xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  data-testid="dock-history-older"
                  disabled={paging}
                  onClick={() => void older()}
                  type="button"
                >
                  {paging ? "Reading…" : "Older"}
                </button>
              ) : null}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** One `.grow2` row: dot, message with ref chips, sha/author/age right. */
function CommitRow({
  commit,
  now,
  onOpen,
}: {
  commit: Commit;
  now: number;
  onOpen: () => void;
}) {
  const head = isHead(commit);
  return (
    // `role="option"`: a row is a *selection*, not an act — `HistoryPane`'s own
    // rule, and the reason `workspace-history.fixtures.ts`'s `controlNames()`
    // excludes it. A commit's own subject is git's data and may contain any
    // word in the language ("Revert…", "commit the fix…"); without this role
    // the mutating-verb scan reads the row's own title as a control offering
    // an act it does not offer.
    <button
      className="flex h-[38px] w-full items-center gap-2 px-3.5 text-left transition-colors hover:bg-foreground/[.04] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
      data-testid={`dock-history-commit-${commit.hash}`}
      onClick={onOpen}
      role="option"
      title={`${commit.subject} — open this commit's patch`}
      type="button"
    >
      <span aria-hidden="true" className="flex w-3 shrink-0 justify-center">
        <span
          className={`h-[7px] w-[7px] rounded-full ${
            head
              ? "bg-[var(--vingilot-accent)] shadow-[0_0_6px_var(--vingilot-accent)]"
              : "border border-muted-foreground/70 bg-transparent"
          }`}
        />
      </span>
      <span className="min-w-0 flex-1 truncate text-xs text-foreground/85">
        {commit.refs.map((ref) => (
          <span
            className="mr-1.5 rounded-[5px] bg-[var(--vingilot-accent-soft)] px-1.5 font-mono text-2xs font-semibold text-[var(--vingilot-accent-text)]"
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
          className="flex h-4 w-4 items-center justify-center rounded-full bg-foreground/10 text-2xs font-bold"
          title={commit.author}
        >
          {commit.author.slice(0, 1).toUpperCase()}
        </span>
        <span className="font-mono">{commit.short}</span>
        <span>{commitAge(commit.date, now)}</span>
      </span>
    </button>
  );
}
