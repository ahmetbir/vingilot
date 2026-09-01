// **What `vingilot_pulls` answers, as the webview reads it**
// (desktop/src-tauri/src/vingilot_pulls/mod.rs; vingilot/seams/redesign-p5.yaml).
//
// The island answers one tagged union for both of its commands. Nine
// discriminants reach a component here — the island's eight refusals plus its
// answer — and this module is the only place that turns an `unknown` off the
// IPC wire into one of them.
//
// **Every field is checked, and a shape that does not check out becomes a
// refusal rather than a list.** The island is trusted to be honest; it is not
// trusted to be the version this build was compiled against. A `gh` payload
// that grew a field, an island rebuilt while the webview stayed up, a command
// that is not registered at all — each of those arrives here as an `unknown`
// that does not match, and the one thing this module must never do is coerce
// it into a `PullList` with an empty `pulls` array. That would read on screen
// as "this repository has no open pull requests", which is a fabricated
// answer to a question nobody managed to ask. It becomes `call-failed`
// instead, which has its own sentence.
//
// `call-failed` is the one discriminant the island does not have: it is the
// webview's own, for a call that never reached a verdict — the IPC rejected,
// or its answer did not parse. Kept inside the same union so a component
// switches once, over nine kinds, and the type checker keeps the switch
// exhaustive.

/** `owner/name`, GitHub's own shape. */
export interface RepoSlug {
  owner: string;
  name: string;
}

/** One pull request, exactly the fields `vingilot_pulls::payload::Pull`
 * serialises — no more, and nothing derived. A component that wants something
 * not on this list (a check run, a comment count, a reviewer) has no source
 * for it and must not draw it. */
export interface Pull {
  number: number;
  title: string;
  url: string;
  /** `OPEN`, `CLOSED` or `MERGED`, as GitHub spells it. */
  state: string;
  draft: boolean;
  /** `null` for a pull request whose author no longer has an account. */
  author: string | null;
  authorIsBot: boolean;
  headRef: string;
  baseRef: string;
  createdAt: string;
  updatedAt: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  /** GitHub's review decision — `APPROVED`, `CHANGES_REQUESTED`,
   * `REVIEW_REQUIRED` — or `null` when nobody has been asked.
   *
   * **This is the GitHub vocabulary and it lives only here.** The diff tab's
   * inline thread (`features/runs/ui/DiffReviewThread.tsx`) is the *local*
   * review agent commenting on the owner's own work in a worktree; its header
   * argues at length why it must not borrow these words. The rule holds in
   * both directions: nothing in this feature may describe a local agent's
   * note, and nothing there may say "changes requested". */
  reviewDecision: string | null;
  /** `MERGEABLE`, `CONFLICTING`, `UNKNOWN` — or `null`. */
  mergeable: string | null;
  labels: string[];
}

export interface PullList {
  repo: RepoSlug;
  /** The git remote the repository was resolved from — a name, never a URL. */
  remote: string;
  /** Open pull requests, newest first. May be empty, and an empty one is a
   * true answer about a repository with nothing open. */
  pulls: Pull[];
  /** The cap the island applied. Read rather than hardcoded, so the "first N
   * of more" sentence can never disagree with the island. */
  cap: number;
  more: boolean;
}

export interface PullDetail {
  repo: RepoSlug;
  remote: string;
  pull: Pull;
  body: string;
  bodyTruncated: boolean;
}

/** Every way the read can end without a list. Each carries what its sentence
 * needs and nothing else. */
export type PullsRefusal =
  | { kind: "not-a-repo"; path: string; enclosing: string | null }
  | { kind: "git-missing" }
  | { kind: "git-failed"; detail: string }
  | { kind: "no-github-remote"; path: string; remotes: string[] }
  | { kind: "gh-missing" }
  | { kind: "gh-unauthenticated"; host: string }
  | { kind: "request-failed"; repo: string; detail: string }
  | { kind: "timed-out"; command: string; seconds: number }
  /** The webview's own: the call never reached a verdict. */
  | { kind: "call-failed"; detail: string };

export type PullsAnswer<T> = ({ kind: "answer" } & T) | PullsRefusal;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** A string that is present and non-empty, or `null`. The island already
 * normalises `gh`'s empty strings to `null`; this keeps the promise even if a
 * future one stops. */
function optionalStr(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function readSlug(value: unknown): RepoSlug | null {
  const held = record(value);
  if (held === null) return null;
  const owner = optionalStr(held.owner);
  const name = optionalStr(held.name);
  if (owner === null || name === null) return null;
  return { name, owner };
}

/** One pull request. `number` is the identity — a row without it cannot be
 * opened, so it is the one field whose absence drops the entry rather than
 * defaulting. */
function readPull(value: unknown): Pull | null {
  const held = record(value);
  if (held === null) return null;
  if (typeof held.number !== "number" || !Number.isFinite(held.number)) {
    return null;
  }
  return {
    additions: num(held.additions),
    author: optionalStr(held.author),
    authorIsBot: held.authorIsBot === true,
    baseRef: str(held.baseRef),
    changedFiles: num(held.changedFiles),
    createdAt: str(held.createdAt),
    deletions: num(held.deletions),
    draft: held.draft === true,
    headRef: str(held.headRef),
    labels: strings(held.labels),
    mergeable: optionalStr(held.mergeable),
    number: held.number,
    reviewDecision: optionalStr(held.reviewDecision),
    state: str(held.state),
    title: str(held.title),
    updatedAt: str(held.updatedAt),
    url: str(held.url),
  };
}

/** The eight refusals, or `null` when this is not one of them. */
function readRefusal(
  kind: string,
  held: Record<string, unknown>,
): PullsRefusal | null {
  switch (kind) {
    case "not-a-repo":
      return {
        enclosing: optionalStr(held.enclosing),
        kind: "not-a-repo",
        path: str(held.path),
      };
    case "git-missing":
      return { kind: "git-missing" };
    case "git-failed":
      return { detail: str(held.detail), kind: "git-failed" };
    case "no-github-remote":
      return {
        kind: "no-github-remote",
        path: str(held.path),
        remotes: strings(held.remotes),
      };
    case "gh-missing":
      return { kind: "gh-missing" };
    case "gh-unauthenticated":
      return { host: str(held.host), kind: "gh-unauthenticated" };
    case "request-failed":
      return {
        detail: str(held.detail),
        kind: "request-failed",
        repo: str(held.repo),
      };
    case "timed-out":
      return {
        command: str(held.command),
        kind: "timed-out",
        seconds: num(held.seconds),
      };
    default:
      return null;
  }
}

/** The webview's own refusal, with the reason attached. */
export function callFailed(detail: string): PullsRefusal {
  return { detail, kind: "call-failed" };
}

/** Shared front half: everything that is not `kind: "answer"`. Returns a
 * refusal for any shape this build does not recognise — never a default
 * answer. */
function readNonAnswer(value: unknown): PullsRefusal | Record<string, unknown> {
  const held = record(value);
  if (held === null)
    return callFailed("the reader answered something that is not an object.");
  const kind = str(held.kind);
  if (kind === "") return callFailed("the reader's answer carried no kind.");
  if (kind === "answer") return held;
  return (
    readRefusal(kind, held) ??
    callFailed(`the reader answered an unknown kind, "${kind}".`)
  );
}

/** `pulls_list`'s answer. */
export function readListAnswer(value: unknown): PullsAnswer<PullList> {
  const head = readNonAnswer(value);
  if (
    "kind" in head &&
    typeof head.kind === "string" &&
    head.kind !== "answer"
  ) {
    return head as PullsRefusal;
  }
  const held = head as Record<string, unknown>;
  const repo = readSlug(held.repo);
  if (repo === null) {
    return callFailed("the list came back without the repository it is of.");
  }
  if (!Array.isArray(held.pulls)) {
    return callFailed("the list came back without its pull requests.");
  }
  const pulls = held.pulls
    .map(readPull)
    .filter((pull): pull is Pull => pull !== null);
  return {
    cap: num(held.cap),
    kind: "answer",
    more: held.more === true,
    pulls,
    remote: str(held.remote),
    repo,
  };
}

/** `pulls_view`'s answer. */
export function readDetailAnswer(value: unknown): PullsAnswer<PullDetail> {
  const head = readNonAnswer(value);
  if (
    "kind" in head &&
    typeof head.kind === "string" &&
    head.kind !== "answer"
  ) {
    return head as PullsRefusal;
  }
  const held = head as Record<string, unknown>;
  const repo = readSlug(held.repo);
  const pull = readPull(held.pull);
  if (repo === null || pull === null) {
    return callFailed("the pull request came back without its own fields.");
  }
  return {
    body: str(held.body),
    bodyTruncated: held.bodyTruncated === true,
    kind: "answer",
    pull,
    remote: str(held.remote),
    repo,
  };
}
