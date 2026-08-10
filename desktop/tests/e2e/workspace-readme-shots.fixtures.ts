// What the README's workspace pictures show. The spec beside this file is how
// they are taken; this is the morning's work they are a picture of.
//
// Split out of the spec for two reasons. The first is the file ratchet — the
// spec reached 1000 lines and the rule is to split rather than raise. The
// second is that the two halves change for different reasons: the mechanics
// move when the app's panes or the harness move, and this file moves when the
// story in the pictures is no longer the story worth telling.
//
// **Nothing here is real.** The projects, branches, patches and the exchange
// between the two agents are invented. They are written to read like a
// morning's work — a token refresh that races under load, the test that
// catches it, the fix, and the review question after it — because a README
// full of `foo`/`bar` says nothing about what the screen is for. No path,
// repository, host or key here belongs to anyone.
//
// Not registered in `playwright.config.ts`: every `testMatch` entry is a
// literal spec basename, so a module sitting beside them is imported and never
// collected as a test.

/** Matches RunsScreen.tsx's hardcoded dev workspace id. */
export const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
export const COORDINATOR_ORIGIN = "http://127.0.0.1:7117";

export const REPOS = [
  { id: "repo-atlas", name: "atlas-api", path: "/home/dev/code/atlas-api" },
  { id: "repo-harbor", name: "harbor-web", path: "/home/dev/code/harbor-web" },
  { id: "repo-ledger", name: "ledger-cli", path: "/home/dev/code/ledger-cli" },
];

/** The worktree the two arrangements are taken in: the branch the whole
 * invented story is about. */
export const SUBJECT = "wt-atlas-refresh";

/** One row of the coordinator's worktree read model, with the fields these
 * pictures do not read filled in once here rather than at every call site. */
function worktree(fields: {
  binding_id: string;
  branch: string;
  owner_run_id: string;
  owner_run_status: string;
  repo_id: string;
}) {
  return {
    added: null,
    base_commit: "4c1f0a2",
    commit_sha: null,
    lifecycle: "ready",
    owner_run_objective: "seeded",
    removed: null,
    role: "task",
    ...fields,
  };
}

// Six worktrees across the three projects, in every state the coordinator can
// put a row in. The four `main:` checkouts the model seeds for each project
// arrive on top of these, so the board draws nine rows in all.
export const WORKTREES = [
  worktree({
    binding_id: SUBJECT,
    branch: "fix/token-refresh-race",
    owner_run_id: "run-atlas-refresh",
    owner_run_status: "blocked",
    repo_id: "repo-atlas",
  }),
  worktree({
    binding_id: "wt-atlas-ratelimit",
    branch: "feat/rate-limit-headers",
    owner_run_id: "run-atlas-ratelimit",
    owner_run_status: "running",
    repo_id: "repo-atlas",
  }),
  worktree({
    binding_id: "wt-atlas-otel",
    branch: "chore/bump-otel",
    owner_run_id: "run-atlas-otel",
    owner_run_status: "completed",
    repo_id: "repo-atlas",
  }),
  worktree({
    binding_id: "wt-harbor-views",
    branch: "feat/saved-views",
    owner_run_id: "run-harbor-views",
    owner_run_status: "running",
    repo_id: "repo-harbor",
  }),
  worktree({
    binding_id: "wt-harbor-header",
    branch: "fix/sticky-table-header",
    owner_run_id: "run-harbor-header",
    owner_run_status: "paused",
    repo_id: "repo-harbor",
  }),
  worktree({
    binding_id: "wt-ledger-parse",
    branch: "perf/statement-parse",
    owner_run_id: "run-ledger-parse",
    owner_run_status: "completed",
    repo_id: "repo-ledger",
  }),
];

/** What each run was for, and how long ago the coordinator last touched it.
 * The ages on the board are that timestamp, so they are minutes rather than a
 * fixed date — a README picture with a stale calendar date in it ages badly. */
const RUN_SEEDS = [
  {
    agoMins: 4,
    id: "run-atlas-refresh",
    objective: "Fix the token refresh race under load",
    status: "blocked",
  },
  {
    agoMins: 11,
    id: "run-atlas-ratelimit",
    objective: "Emit RateLimit-* headers on every 429",
    status: "running",
  },
  {
    agoMins: 96,
    id: "run-atlas-otel",
    objective: "Move to opentelemetry-go 1.31",
    status: "completed",
  },
  {
    agoMins: 22,
    id: "run-harbor-views",
    objective: "Saved views on the incidents table",
    status: "running",
  },
  {
    agoMins: 47,
    id: "run-harbor-header",
    objective: "Table header stops sticking at 200 rows",
    status: "paused",
  },
  {
    agoMins: 184,
    id: "run-ledger-parse",
    objective: "Statement parse under 200ms for 50k rows",
    status: "completed",
  },
];

export function runs() {
  const now = Date.now();
  return RUN_SEEDS.map((seed) => {
    const at = new Date(now - seed.agoMins * 60_000).toISOString();
    return {
      created_at: at,
      id: seed.id,
      mode: "delegated",
      objective: seed.objective,
      parent_run_id: null,
      status: seed.status,
      tokens_observed: 0,
      tokens_observed_at: null,
      updated_at: at,
      wall_limit_secs: null,
      wall_started_at: null,
    };
  });
}

// ---------------------------------------------------------------------------
// The diff the right pane shows
// ---------------------------------------------------------------------------

/** The answer `worktree_diff` gives for the subject worktree: the fix the
 * invented story is about, in the shape `lib/worktreeDiff.ts` reads. The patch
 * bodies are real Go — a picture of a diff pane is only worth showing if the
 * diff in it is one somebody could have written. */
export const DIFF_FILES = [
  {
    additions: 19,
    change: "modified",
    deletions: 10,
    patch: [
      "@@ -3,7 +3,9 @@ package auth",
      " import (",
      ' \t"context"',
      ' \t"sync"',
      ' \t"time"',
      "+",
      '+\t"golang.org/x/sync/singleflight"',
      " )",
      "@@ -41,16 +43,25 @@ func (s *TokenStore) Refresh(",
      "-\ttok, ok := s.lookup(subject)",
      "-\tif ok && !tok.expired(time.Now()) {",
      "-\t\treturn tok, nil",
      "-\t}",
      "-\tfresh, err := s.fetch(ctx, subject)",
      "-\tif err != nil {",
      "-\t\treturn Token{}, err",
      "-\t}",
      "-\ts.put(subject, fresh)",
      "-\treturn fresh, nil",
      "+\tif tok, ok := s.live(subject); ok {",
      "+\t\treturn tok, nil",
      "+\t}",
      "+",
      "+\t// One network refresh per subject, however",
      "+\t// many callers arrive at once: the old code",
      "+\t// dropped the read lock before taking the",
      "+\t// write lock, so everyone who landed in",
      "+\t// that window fetched a token of their own.",
      "+\trefresh := func() (any, error) {",
      "+\t\tfresh, err := s.fetch(ctx, subject)",
      "+\t\tif err != nil {",
      "+\t\t\treturn nil, err",
      "+\t\t}",
      "+\t\ts.put(subject, fresh)",
      "+\t\treturn fresh, nil",
      "+\t}",
      "+\tv, err, _ := s.group.Do(subject, refresh)",
      "+\tif err != nil {",
      "+\t\treturn Token{}, err",
      "+\t}",
      "+\treturn v.(Token), nil",
      " }",
    ].join("\n"),
    path: "internal/auth/refresh.go",
  },
  {
    additions: 22,
    change: "added",
    deletions: 0,
    patch: [
      "@@ -0,0 +1,22 @@",
      "+func TestRefreshConcurrent(t *testing.T) {",
      "+\tvar calls atomic.Int64",
      "+\tstore := NewTokenStore(fetchFunc(func() Token {",
      "+\t\tcalls.Add(1)",
      "+\t\treturn freshToken()",
      "+\t}))",
      "+",
      "+\tvar wg sync.WaitGroup",
      "+\tfor range 64 {",
      "+\t\twg.Add(1)",
      "+\t\tgo func() {",
      "+\t\t\tdefer wg.Done()",
      '+\t\t\t_, err := store.Refresh(ctx, "alice")',
      "+\t\t\tif err != nil {",
      "+\t\t\t\tt.Error(err)",
      "+\t\t\t}",
      "+\t\t}()",
      "+\t}",
      "+\twg.Wait()",
      "+",
      "+\t// Do drops the key when it returns, so a",
      "+\t// group keyed by anything but the subject",
      "+\t// fails here too.",
      "+\tif got := calls.Load(); got != 1 {",
      '+\t\tt.Fatalf("%d refreshes, want 1", got)',
      "+\t}",
      "+}",
    ].join("\n"),
    path: "internal/auth/refresh_test.go",
  },
  {
    additions: 4,
    change: "modified",
    deletions: 1,
    patch: [
      "@@ -12,9 +12,12 @@ type TokenStore struct {",
      " \tmu     sync.RWMutex",
      " \ttokens map[string]Token",
      " \tfetch  Fetcher",
      "+\t// Keyed by subject, not by request: two",
      "+\t// callers after the same subject share one",
      "+\t// flight, two subjects never block.",
      "+\tgroup  singleflight.Group",
      " }",
    ].join("\n"),
    path: "internal/auth/store.go",
  },
  {
    additions: 1,
    change: "modified",
    deletions: 0,
    patch: [
      "@@ -8,6 +8,7 @@ require (",
      " \tgithub.com/go-chi/chi/v5 v5.1.0",
      "+\tgolang.org/x/sync v0.8.0",
      " )",
    ].join("\n"),
    path: "go.mod",
  },
];

// ---------------------------------------------------------------------------
// The shell the left pane shows
// ---------------------------------------------------------------------------

/** ANSI, spelled rather than typed. A literal escape byte in a source file is
 * invisible in every diff, every review and every grep it ever appears in, and
 * these strings are nothing but escape bytes and prose. */
const ESC = "\u001b";
const OFF = `${ESC}[0m`;
const CYAN = `${ESC}[36m`;
const GREEN = `${ESC}[32m`;
const RED = `${ESC}[31m`;
const YELLOW = `${ESC}[33m`;

/** A prompt line the way a shell in a worktree draws one: the project, the
 * branch, then the `$`. Written out rather than assembled from the seed so the
 * picture and the story cannot drift apart. */
const PROMPT = `${CYAN}atlas-api${OFF} ${YELLOW}fix/token-refresh-race${OFF} $ `;

/** What the terminal holds in the diff arrangement: the failing run that
 * started all this, then the fix landing green. `-race` is what a Go developer
 * would actually have typed at a report like this one. */
export const TERMINAL_DIFF = [
  `${PROMPT}go test ./internal/auth -race`,
  `${RED}--- FAIL: TestRefreshConcurrent (0.31s)${OFF}`,
  "    refresh_test.go:88: 3 refreshes reached the network, want 1",
  `${RED}FAIL${OFF}\texample.com/atlas/internal/auth\t0.402s`,
  "",
  `${PROMPT}go get golang.org/x/sync`,
  "go: added golang.org/x/sync v0.8.0",
  "",
  `${PROMPT}go test ./internal/auth -race -count=5`,
  `${GREEN}ok${OFF}  \texample.com/atlas/internal/auth\t4.812s`,
  "",
  `${PROMPT}go test ./... -race`,
  `${GREEN}ok${OFF}  \texample.com/atlas/internal/auth\t4.902s`,
  `${GREEN}ok${OFF}  \texample.com/atlas/internal/httpapi\t1.118s`,
  `${GREEN}ok${OFF}  \texample.com/atlas/internal/ratelimit\t0.771s`,
  "?   \texample.com/atlas/cmd/atlasd\t[no test files]",
  "",
  `${PROMPT}git diff --stat`,
  " internal/auth/refresh.go      | 29 ++++++++++++++-------",
  " internal/auth/refresh_test.go | 26 ++++++++++++++++++",
  " internal/auth/store.go        |  5 ++++-",
  " go.mod                        |  1 +",
  " 4 files changed, 50 insertions(+), 11 deletions(-)",
  PROMPT,
];

/** What the terminal holds in the team arrangement: the same worktree a few
 * minutes earlier, at the point the question in the thread beside it was
 * asked. Deliberately different bytes from the run above — two pictures of the
 * same pane showing the same screen would be two pictures of nothing. */
export const TERMINAL_TEAM = [
  `${PROMPT}git log --oneline -4`,
  `${YELLOW}9f2ad41${OFF} single-flight the refresh, keyed by subject`,
  `${YELLOW}4c1f0a2${OFF} test: 64 goroutines through TokenStore.Refresh`,
  `${YELLOW}1b7e0c9${OFF} auth: pull the expiry check out of the handler`,
  `${YELLOW}0a3d5e8${OFF} chore: go 1.24`,
  "",
  `${PROMPT}go vet ./internal/auth`,
  `${PROMPT}golangci-lint run ./internal/...`,
  "0 issues.",
  "",
  `${PROMPT}git push -u origin fix/token-refresh-race`,
  "remote: Create a pull request by visiting",
  "remote:   https://example.com/atlas/pull/new/fix/token-refresh-race",
  " * [new branch]  fix/token-refresh-race -> fix/token-refresh-race",
  "",
  `${PROMPT}gh pr checks --watch`,
  `${GREEN}\u2713${OFF} build      1m12s`,
  `${GREEN}\u2713${OFF} test-race  3m48s`,
  `${GREEN}\u2713${OFF} lint       0m31s`,
  "All checks were successful.",
  PROMPT,
];

// ---------------------------------------------------------------------------
// The team, and what it said
// ---------------------------------------------------------------------------

export const PERSONAS = [
  {
    displayName: "Planner",
    id: "persona-planner",
    systemPrompt: "Read the code before proposing a change.",
  },
  {
    displayName: "Builder",
    id: "persona-builder",
    systemPrompt: "Small commits, and a test that fails first.",
  },
];

export const TEAM = {
  description: "Reads the branch, proposes, builds.",
  id: "team-refresh",
  name: "Backend Crew",
  personaIds: ["persona-planner", "persona-builder"],
};

/** The exchange the thread pane shows, oldest first. `null` is the owner. */
export const TRANSCRIPT: { author: string | null; text: string }[] = [
  {
    author: null,
    text: "Auth test goes red about one run in five. Two goroutines land in TokenStore.Refresh at the same time and both fetch. Where does the lock go?",
  },
  {
    author: "Planner",
    text: "Not a global mutex — that handler is on every request. The window is between the expiry read and the write: Refresh drops the read lock, fetches, then takes the write lock, so everyone who arrives in between fetches too. Key a singleflight.Group by subject and the map lock stays where it is.",
  },
  {
    author: "Builder",
    text: "Pushed to fix/token-refresh-race. singleflight.Group keyed by subject, plus a test that fires 64 goroutines at Refresh and asserts exactly one round trip. go test -race green over 5 runs.",
  },
  {
    author: null,
    text: "Reading the diff now. Does the key stay in the group after a subject is gone?",
  },
  {
    author: "Builder",
    text: "No — Do deletes the key when the call returns, so the map is empty again between bursts. I said so in a comment on the test, because it read like a leak the first time I looked at it.",
  },
];
