// A one-shot mailbox for text a surface wants typed into a terminal that is
// not open yet (vingilot redesign P3 — the Run panel's Start Dev and the
// Files tree's "New terminal here").
//
// **Why a mailbox and not a write.** `pty_write` needs an open session, and
// the sessions this island opens are opened by a *measurement* — a new tab's
// pty comes up only after its Terminal is laid out (`ui/Terminal.tsx`'s
// "opened by a measurement" rule). A caller that opened a tab and wrote
// immediately would race the open and lose. So the caller files the text
// here, keyed by the session id it computed from the strip's own `nextN`
// (`terminalTabs.ts`), and `Terminal.tsx` takes it exactly once, right after
// its `pty_open` resolves — the same channel, and the same *kind* of act, as
// the drop-a-file-paste that already types into the shell
// (`Terminal.tsx:316`). Nothing is executed behind the shell's back: the
// text lands in the prompt the way a keystroke does, visible, and with its
// trailing newline it is the shell that runs it.
//
// **Filed-then-taken is the island's established one-shot idiom**
// (`filesTarget.ts`, `historyTarget.ts`), with one addition: a freshness
// bound. A target for a pane lands milliseconds later or not at all; a typed
// command aimed at a session that never opened (the tab creation failed, the
// owner closed it first) must not sit for an hour and fire into an unrelated
// shell the day the ordinal is reused. Stale mail is dropped on read.
//
// Module-level by design and NOT in `resetCommunityState()`: the mail is
// keyed by pty session ids, which are worktree-scoped, not community-scoped,
// and it self-expires. Nothing here persists.

/** How long filed text stays deliverable. Generous against a slow first
 * layout; small against ordinal reuse. */
export const TYPE_TTL_MS = 15_000;

interface Mail {
  text: string;
  at: number;
}

const box = new Map<string, Mail>();

/** File `text` to be typed into `session` when it opens. Replaces any
 * undelivered mail for the same session — two Start presses are one intent. */
export function fileTerminalType(
  session: string,
  text: string,
  now: number = Date.now(),
) {
  box.set(session, { at: now, text });
}

/** Take the mail for `session`, once. Stale mail answers `null` and is
 * dropped — see the header. */
export function takeTerminalType(
  session: string,
  now: number = Date.now(),
): string | null {
  const mail = box.get(session);
  if (mail === undefined) return null;
  box.delete(session);
  return now - mail.at > TYPE_TTL_MS ? null : mail.text;
}
