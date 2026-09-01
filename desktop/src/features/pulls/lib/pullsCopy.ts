// **One sentence per refusal, and the next thing to do where that is knowable**
// (vingilot/docs/plans/2026-08-29-redesign.md, P5).
//
// `vingilot_pulls` classifies nine ways a read can end without a list, and the
// whole reason it classifies them is so this file can be written. A pane that
// collapsed them into "could not load pull requests" would have thrown away
// the island's work and left the owner guessing between "install `gh`", "run
// `gh auth login`", "this checkout has no GitHub remote" and "GitHub is down".
//
// Rules the copy keeps:
//
// - **Say what happened, then what he can do about it.** The `hint` is the
//   second half and it is `null` when this build genuinely does not know one.
//   An invented next step is a fabrication like any other.
// - **Quote the machine, never paraphrase it.** `git-failed`, `request-failed`
//   and `timed-out` carry git's or `gh`'s own words in `detail`; the sentence
//   frames them and does not rewrite them.
// - **Never a token.** The island guarantees no remote URL reaches the webview
//   (`remote.rs`'s header — userinfo is stripped at the parse and refusals
//   carry remote *names*). Nothing here reconstructs one, and nothing here
//   prints a URL that came from a config.
// - **These are not the diff tab's words.** GitHub review state belongs to
//   this feature; the local review agent's note belongs to
//   `features/runs/ui/DiffReviewThread.tsx`. Neither borrows the other's
//   vocabulary.

import type { Pull, PullsRefusal } from "@/features/pulls/lib/pullsAnswer";

/** What a refusal puts on screen: the fact, and the next move when there is
 * one. */
export interface RefusalCopy {
  /** What happened, in one sentence. */
  headline: string;
  /** What the owner can do about it, or `null` when nothing is knowable. */
  hint: string | null;
}

/** The list, in English, for a refusal from either command. */
export function refusalCopy(refusal: PullsRefusal): RefusalCopy {
  switch (refusal.kind) {
    case "not-a-repo":
      return {
        headline: `${refusal.path} is not a git working tree.`,
        hint:
          refusal.enclosing === null
            ? "Select a checkout in the Deck and its repository's pull requests appear here."
            : `The nearest checkout above it is ${refusal.enclosing} — open that one instead.`,
      };
    case "git-missing":
      return {
        headline: "There is no git on this machine that answers.",
        hint: "Vingilot reads a worktree's remotes with git before it asks GitHub anything. Install git and this list fills in.",
      };
    case "git-failed":
      return {
        headline: "git refused to read this worktree's remotes.",
        hint: refusal.detail === "" ? null : `git said: ${refusal.detail}`,
      };
    case "no-github-remote":
      return {
        headline: "This checkout has no remote on github.com.",
        hint:
          refusal.remotes.length === 0
            ? "It has no remotes at all — a local-only repository, which has no pull requests to show."
            : `Its remotes are ${refusal.remotes.join(", ")}, and none of them points at github.com.`,
      };
    case "gh-missing":
      return {
        headline: "The GitHub CLI is not installed.",
        hint: "Vingilot reads pull requests with gh. Install it (brew install gh), then sign in with gh auth login.",
      };
    case "gh-unauthenticated":
      return {
        headline: `gh is not signed in to ${refusal.host || "github.com"}.`,
        hint: `Run gh auth login --hostname ${refusal.host || "github.com"} in a terminal, then reopen this list. Vingilot never holds the token itself.`,
      };
    case "request-failed":
      return {
        headline: `GitHub did not answer for ${refusal.repo || "this repository"}.`,
        hint: refusal.detail === "" ? null : `gh said: ${refusal.detail}`,
      };
    case "timed-out":
      return {
        headline: `gh did not answer within ${refusal.seconds} seconds and was stopped.`,
        hint:
          refusal.command === ""
            ? null
            : `The call that hung was: ${refusal.command}`,
      };
    case "call-failed":
      return {
        headline: "Vingilot could not ask for this repository's pull requests.",
        hint: refusal.detail === "" ? null : refusal.detail,
      };
  }
}

/** `owner/name`. */
export function slugText(repo: { owner: string; name: string }): string {
  return `${repo.owner}/${repo.name}`;
}

/** The pane's subtitle under the "Pull requests" title, in the mockup's
 * `.vhead .s` slot ("buzz · 3 open"). Only ever counts what is on screen —
 * `more` is said in words rather than folded into a number that would then be
 * a guess. */
export function listSummary(
  repo: { owner: string; name: string },
  count: number,
  more: boolean,
  cap: number,
): string {
  if (more) return `${repo.name} · first ${cap} open`;
  if (count === 0) return `${repo.name} · none open`;
  return `${repo.name} · ${count} open`;
}

/** How a pull request's own state is named on its row and in its detail — the
 * island's `state`/`draft`, GitHub's spelling, mapped to this app's words. A
 * state this build has never seen is passed through lowercased rather than
 * guessed at. */
export function stateLabel(pull: Pull): string {
  if (pull.draft) return "Draft";
  switch (pull.state.toUpperCase()) {
    case "OPEN":
      return "Open";
    case "MERGED":
      return "Merged";
    case "CLOSED":
      return "Closed";
    default:
      return pull.state === "" ? "Unknown" : pull.state.toLowerCase();
  }
}

/** GitHub's review decision in this app's words, or `null` when nobody has
 * been asked — in which case the row says nothing rather than "no reviews",
 * which would be a claim about GitHub this field does not make. */
export function reviewLabel(pull: Pull): string | null {
  switch (pull.reviewDecision) {
    case "APPROVED":
      return "Approved";
    case "CHANGES_REQUESTED":
      return "Changes requested";
    case "REVIEW_REQUIRED":
      return "Review required";
    case null:
      return null;
    default:
      return pull.reviewDecision.toLowerCase().replaceAll("_", " ");
  }
}

/** `MERGEABLE`/`CONFLICTING`/`UNKNOWN`. Only `CONFLICTING` is worth a word on
 * a row: the other two are the ordinary case and a non-answer. */
export function conflictLabel(pull: Pull): string | null {
  return pull.mergeable === "CONFLICTING" ? "Conflicts" : null;
}

/** How long ago, in the app's short form. An unparseable or absent timestamp
 * answers `null` and the row omits the clause — the island passes `gh`'s
 * string through untouched, so a `gh` that changed its format costs a phrase
 * rather than a wrong date. */
export function agoText(iso: string, now: number = Date.now()): string | null {
  if (iso === "") return null;
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return null;
  const seconds = Math.round((now - at) / 1000);
  if (seconds < 0) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

/** The row's meta line, mockup `.prmeta`'s text half: "#412 · Bosun opened 18m
 * ago". Every clause is dropped rather than filled in when its field is
 * empty — a pull request whose author is a deleted account says "opened 3d
 * ago" and does not invent a name. */
export function metaText(pull: Pull, now: number = Date.now()): string {
  const parts = [`#${pull.number}`];
  const ago = agoText(pull.createdAt, now);
  if (pull.author === null) {
    if (ago !== null) parts.push(`opened ${ago}`);
  } else {
    const who = pull.authorIsBot ? `${pull.author} (bot)` : pull.author;
    parts.push(ago === null ? who : `${who} opened ${ago}`);
  }
  return parts.join(" · ");
}
