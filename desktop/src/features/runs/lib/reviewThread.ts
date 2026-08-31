// The LOCAL review agent's notes, placed inside the diff on the lines they are
// about (DIFF-TAB-BRIEF §5, and the owner's clarification of 2026-08-31).
//
// > "buradaki change request filan localdeki review agenti ile olan ama ona
// > dikkat. upstreamle alakasi yok. orasi pull requests kisminda olacak"
//
// **What this is, said in one line: the crew member P4's Review popover
// dispatched, answering in this worktree's team thread.** `useReviewDispatch`
// sends "review the diff against HEAD on this worktree" into that channel
// (thread berth) or into an owner-only DM (Mate). The reviewer replies there,
// under its own key — `teamThread.ts`'s whole argument is that a deployed team
// member signs its own messages. This module reads those replies and decides
// which of them belongs against which line of the diff on screen.
//
// **It has nothing to do with GitHub.** Nothing here imports `gh`, no field
// carries a PR number, and the vocabulary is deliberately not a PR's: a note
// here is a *note*, never an "approval" or a "requested change", because those
// are states a pull request has and this thread does not. Pull requests are P5
// and are a different section of the app.
//
// **The anchor is read, never invented.** A note is drawn inside the diff only
// when the reviewer's own message names a place in it — `path:line`, the form
// every compiler, linter and stack trace in the world prints and the form this
// app already speaks (`vingilot_shim::resolve_open`, `viewTitle`). A message
// with no such anchor is a message in a thread, and it stays in the thread: it
// is not hoisted onto a line somebody guessed. That is why this file can be
// honest about having no fixture — with no anchored reply in the channel, the
// diff draws no threads at all, which is the true rendering of "the reviewer
// has not said anything about a line yet".
//
// Pure: no React, no Tauri, no storage. The live wiring is
// `lib/useReviewNotes.ts`.

/** The minimal shape this module needs from a relay message — kept narrow so
 * this file takes no dependency on `shared/api/types`, exactly as
 * `reviewDispatch.ts` keeps `ReviewAgentRecord` narrow. */
export interface ReviewMessage {
  id: string;
  pubkey: string;
  content: string;
  /** Seconds since the epoch, as the relay reports it. */
  created_at: number;
}

/** Who may leave a note inside the diff: the crew this workspace really has,
 * by key. `reviewDispatch.ts`'s `ReviewReviewer` satisfies this. */
export interface ReviewAuthor {
  pubkey: string;
  name: string;
}

/** One note, anchored to a line of one file. */
export interface ReviewNote {
  /** The relay event's own id — the identity the resolve store keys by, so a
   * note stays resolved across a re-read of the channel. */
  id: string;
  author: string;
  /** Worktree-relative, and always a path the diff on screen really lists. */
  path: string;
  /** 1-based, in the NEW side of the file — the side the reader is looking at.
   * A note about a removed line is anchored to the line it was removed at. */
  line: number;
  /** What the reviewer said, with the anchor left in: the note reads as the
   * sentence it was written as, and stripping the reference would be this
   * module editing an agent's words. */
  body: string;
  created_at: number;
}

/** `src/main.rs:42`, `desktop/src/App.tsx:7`, and the same inside backticks or
 * parentheses. The path half is deliberately greedy about path characters and
 * nothing else — a bare `12:30` in prose has no `/` and no extension and does
 * not match a file, which is what `resolve` below checks. */
const ANCHOR = /([A-Za-z0-9._\-/]+\.[A-Za-z0-9]+):(\d+)/g;

/** The diff's own path that `named` refers to, or `null`.
 *
 * Three readings, narrowest first: the exact path, a path the diff lists as a
 * suffix (`runs/lib/diffTab.ts` for `desktop/src/features/runs/lib/diffTab.ts`),
 * and a bare basename. **A suffix or basename that matches more than one file
 * is refused**, because a note landed on the wrong `mod.rs` is worse than a
 * note left in the thread. */
function resolve(named: string, paths: readonly string[]): string | null {
  if (paths.includes(named)) return named;
  const suffix = paths.filter(
    (path) => path.endsWith(`/${named}`) || path === named,
  );
  if (suffix.length === 1) return suffix[0];
  if (suffix.length > 1) return null;
  const base = paths.filter(
    (path) => path.slice(path.lastIndexOf("/") + 1) === named,
  );
  return base.length === 1 ? base[0] : null;
}

/** The notes the diff on screen can place, oldest first.
 *
 * Everything that is not a note is dropped rather than approximated: a message
 * from somebody who is not crew (the owner's own instruction, another member's
 * chatter), a message naming no file, a message naming a file this diff does
 * not show, a line number of zero. */
export function reviewNotes(input: {
  authors: readonly ReviewAuthor[];
  messages: readonly ReviewMessage[];
  paths: readonly string[];
}): ReviewNote[] {
  const { authors, messages, paths } = input;
  const byKey = new Map(authors.map((author) => [author.pubkey, author.name]));
  if (byKey.size === 0 || paths.length === 0) return [];
  const notes: ReviewNote[] = [];
  for (const message of messages) {
    const author = byKey.get(message.pubkey);
    if (author === undefined) continue;
    // The FIRST anchor in the message, not every one: a note is about the line
    // it opens with, and a body that mentions three files is one note that
    // references three, never three notes.
    ANCHOR.lastIndex = 0;
    let found: RegExpExecArray | null = ANCHOR.exec(message.content);
    while (found !== null) {
      const path = resolve(found[1], paths);
      const line = Number(found[2]);
      if (path !== null && Number.isInteger(line) && line > 0) {
        notes.push({
          author,
          body: message.content.trim(),
          created_at: message.created_at,
          id: message.id,
          line,
          path,
        });
        break;
      }
      found = ANCHOR.exec(message.content);
    }
  }
  return notes.sort((a, b) => a.created_at - b.created_at);
}

/** The notes for one file, keyed by the line they sit under. */
export function notesByLine(
  notes: readonly ReviewNote[],
  path: string,
): ReadonlyMap<number, ReviewNote[]> {
  const out = new Map<number, ReviewNote[]>();
  for (const note of notes) {
    if (note.path !== path) continue;
    const at = out.get(note.line);
    if (at === undefined) out.set(note.line, [note]);
    else at.push(note);
  }
  return out;
}

/** The header sentence above a note.
 *
 * **Not "requested changes".** That is a pull request's review state, and the
 * owner's clarification is explicit that this thread must not borrow a pull
 * request's vocabulary. What this build actually knows is who wrote it and
 * which line it is about, so that is what the sentence says. */
export function noteHeadline(note: ReviewNote): string {
  return `left a note on line ${note.line}`;
}

/** What Reply sends: the reviewer addressed by name — the harness's own
 * mention convention, the same one `reviewDispatch.ts`'s `reviewMessage` uses —
 * with the anchor repeated so the answer is readable in the thread on its own,
 * where the diff is not on screen. */
export function replyMessage(
  note: ReviewNote,
  text: string,
  berth: "thread" | "dm",
): string {
  const body = `re ${note.path}:${note.line} — ${text.trim()}`;
  return berth === "dm" ? body : `@${note.author} ${body}`;
}

/** What Apply suggestion sends: the note handed to the agent that wrote the
 * code, by name.
 *
 * **Offered only when there IS such an agent to name.** The brief's "Apply
 * hands it back to the agent that wrote the patch" needs a patch author this
 * app can address, and the only one it ever has is a commit's git author when
 * that name is also a crew member of this workspace. A worktree diff has no
 * author at all, and a commit by the owner has no agent behind it — in both
 * cases the button is not drawn rather than sending a message into the void. */
export function applyMessage(note: ReviewNote, patchAuthor: string): string {
  return `@${patchAuthor} apply ${note.author}'s note on ${note.path}:${note.line}`;
}

/** Which crew member wrote the code under review, or `null`.
 *
 * The git author name matched against the workspace's own roster, exactly and
 * case-insensitively. A name that is not on the roster is a human or an agent
 * this workspace cannot reach, and both answer `null`. */
export function patchAuthorInCrew(
  author: string | null,
  roster: readonly ReviewAuthor[],
): ReviewAuthor | null {
  if (author === null || author.trim() === "") return null;
  const wanted = author.trim().toLowerCase();
  return (
    roster.find((member) => member.name.trim().toLowerCase() === wanted) ?? null
  );
}
