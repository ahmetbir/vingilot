// The lane graph the mockup's History panel draws (`.gsvg`,
// Vingilot.html:281-287), as data — one row of geometry per commit, computed
// from the parent hashes `worktree_log` now reports (redesign P4.1, item 5).
//
// **This module exists because P3 refused to draw one.** The backend's format
// carried no `%P` and no `--all`, so the lanes in the mockup had no source and
// the panel honestly drew a column of dots instead. The fix was the data, not
// the drawing: `vingilot_worktree::log` reports `parents` and can walk every
// ref, and what is left is arithmetic over those parents. Nothing here invents
// an edge — every line drawn is a parent git reported.
//
// **The walk, in one paragraph.** Commits arrive newest first. A *lane* is a
// column, and at any point in the walk each open lane is waiting for one
// particular commit (the hash some already-drawn child named as a parent). For
// each commit: find the lane waiting for it — that is its column, and the line
// into the row from above; a commit no lane is waiting for is a branch tip and
// takes the leftmost free column with no line above it. Then the commit hands
// its lane on to its first parent (or closes it, at a root), and every further
// parent — a merge — is either joined to the lane already waiting for it or
// given a new one, drawn as a curve out of this row.
//
// **What it cannot know, stated.** The page is bounded (200 commits), so a
// parent below the last row is a hash nothing on screen will ever match: its
// lane is left open at the bottom of the last row, which is exactly what the
// mockup's own bottom edge shows and is the truth — the history continues.
// Lanes are also *columns and not branches*: git records parents, not which
// branch a commit was made on, so a lane is only ever "the line from this
// commit to its child", which is all the mockup's picture claims either.

/** What this module needs of a commit: the pair of hashes that make an edge.
 * Deliberately narrower than `historyModel.ts`'s `Commit` so the layout can be
 * tested from four lines of fixture. */
export interface GraphCommit {
  hash: string;
  parents: readonly string[];
}

/** One drawn row. Every field is a fact about lines, not about branches. */
export interface GraphRow {
  /** The column this commit's dot sits in. */
  lane: number;
  /** Lanes carrying a straight line through this row, past the dot. Never
   * includes `lane` or a lane in `joins` — those lines end or begin here. */
  through: readonly number[];
  /** Other lanes that were also waiting for this commit — a second child, or
   * the far side of a merge's diamond. Each draws a curve from the top of the
   * row into the dot and then closes, which is exactly the shape the mockup's
   * own merge row draws (`M30 0 C 30 14, 12 8, 12 19`). */
  joins: readonly number[];
  /** A child of this commit is drawn above, so the dot has a line upward. */
  up: boolean;
  /** The first parent continues in this same lane, so the dot has a line
   * downward. False at a root commit, and at the bottom of a page only when
   * the commit really has no parent. */
  down: boolean;
  /** Lanes a merge parent goes off into, drawn as a curve out of this dot.
   * Empty for every ordinary commit. */
  forks: readonly number[];
  /** How many columns this row needs — one past the rightmost lane it uses,
   * counting the through-lines and the forks. */
  width: number;
}

/** The leftmost column with nothing waiting in it, extending the row of lanes
 * if they are all busy. */
function freeLane(open: (string | null)[]): number {
  const at = open.indexOf(null);
  if (at !== -1) return at;
  open.push(null);
  return open.length - 1;
}

/** Lay out one page of history.
 *
 * The input is the page in the order it is drawn — newest first, which is the
 * order `worktree_log` answers in. A different order would produce a different
 * picture, and there is deliberately no sort here: this module draws what it
 * was handed rather than deciding what a history is.
 *
 * The result is index-aligned with `commits`, so a caller renders row `i`
 * beside commit `i` with no lookup and no key to keep in step. */
export function layoutCommitGraph(commits: readonly GraphCommit[]): GraphRow[] {
  // lane -> the hash that lane is waiting for, or `null` for a free column.
  const open: (string | null)[] = [];
  const rows: GraphRow[] = [];

  for (const commit of commits) {
    const waiting = open.indexOf(commit.hash);
    const up = waiting !== -1;
    const lane = up ? waiting : freeLane(open);
    if (!up) open[lane] = commit.hash;

    // Every OTHER lane waiting for this same commit ends here. Two lanes wait
    // for one hash whenever a commit has two children on screen — the far side
    // of every merge's diamond — and drawing them as two columns that simply
    // stop would leave the merge unattached to the branch it merged.
    const joins: number[] = [];
    for (const [at, hash] of open.entries()) {
      if (at !== lane && hash === commit.hash) joins.push(at);
    }
    for (const at of joins) open[at] = null;

    // Everything still open crosses this row. Read BEFORE the parents are
    // filed, so a lane a merge opens below is a curve rather than a line that
    // was never there above.
    const through: number[] = [];
    for (const [at, hash] of open.entries()) {
      if (at !== lane && hash !== null) through.push(at);
    }

    const [first, ...rest] = commit.parents;
    // The lane is handed to the first parent, or closed at a root. Handed on
    // even when another lane is already waiting for that parent: the two
    // converge at the parent's own row, where they are its `joins`. Merging
    // them here instead would move a junction the owner can see up the page to
    // a row where nothing happened.
    open[lane] = first ?? null;
    const forks: number[] = [];
    for (const parent of rest) {
      const joined = open.indexOf(parent);
      if (joined !== -1) {
        // A merge parent some lane is already carrying: the curve lands in
        // that lane rather than opening a second column for one commit.
        forks.push(joined);
        continue;
      }
      const fresh = freeLane(open);
      open[fresh] = parent;
      forks.push(fresh);
    }

    let width = lane + 1;
    for (const at of through) width = Math.max(width, at + 1);
    for (const at of joins) width = Math.max(width, at + 1);
    for (const at of forks) width = Math.max(width, at + 1);
    rows.push({
      down: first !== undefined,
      forks,
      joins,
      lane,
      through,
      up,
      width,
    });
  }

  return rows;
}

/** How wide the whole drawing is — the widest row, so every row's SVG is the
 * same box and the commit subjects line up down the panel. At least one lane,
 * because an empty page still has a column to not draw anything in. */
export function graphWidth(rows: readonly GraphRow[]): number {
  let widest = 1;
  for (const row of rows) widest = Math.max(widest, row.width);
  return widest;
}

/** The mockup's own geometry (`.grow2` is 38px tall; its `.gsvg` puts lane 0
 * at x=12 and lane 1 at x=30, with the dot at cy=19). Exported so the drawing
 * and any test of it read the same three numbers. */
export const LANE_X0 = 12;
export const LANE_DX = 18;
export const ROW_H = 38;

export function laneX(lane: number): number {
  return LANE_X0 + lane * LANE_DX;
}

/** The SVG box for a graph `lanes` columns wide — the last lane's x plus the
 * same margin the first one has. */
export function graphPixelWidth(lanes: number): number {
  return laneX(Math.max(0, lanes - 1)) + LANE_X0;
}

/** The colour a lane's line is drawn in.
 *
 * The mockup uses exactly two — `#7fb2c9` for the trunk and the theme accent
 * for the branch beside it — and this is that pair with three more added in
 * the same register for repositories with more lanes on screen at once. They
 * cycle: a sixth concurrent lane wears the first colour again, which is the
 * behaviour of every graph the owner already uses and is honest in a way that
 * running out of colours and drawing grey would not be. A lane's colour means
 * "this line is not that line" and nothing more — it is not a branch identity,
 * because git does not record one. */
const LANE_COLORS = [
  "#7fb2c9",
  "var(--vingilot-accent)",
  "#c9a67f",
  "#8fc98f",
  "#b78fc9",
] as const;

export function laneColor(lane: number): string {
  return LANE_COLORS[lane % LANE_COLORS.length];
}
