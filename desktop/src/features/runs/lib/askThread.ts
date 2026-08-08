// What an ask *is* once it has been asked: a question, the directory it was
// asked in, and whatever came back — kept, so the owner can go back and read it
// (vingilot/docs/plans/2026-08-08-palette-and-documents.md, Task 2).
//
// **Why this is a store of its own, and what was checked first.** Upstream's
// chat is the only message store in this app, and it is a relay: every message
// is a Nostr event signed with the owner's key and published to a community
// (`features/messages/hooks.ts`'s send mutation ends in `relayClient.
// sendMessage` / `sendChannelMessage`, and needs a `Channel` and an
// `Identity`). Three things follow, and each on its own decides it:
//
// - the workspace screen runs against a local coordinator and needs no
//   community at all, so an ask would be unaskable until the owner joined one;
// - the question carries a path on this machine, and putting it in a channel
//   publishes that path to a server;
// - the *answer* comes from a local ACP adapter that holds no key. To land it
//   in a channel this app would have to sign the agent's words with the owner's
//   identity — a forged author in a signed, hash-chained log. Buzz's own agents
//   post under their own pubkeys for exactly this reason.
//
// So the conversation is kept here instead, and this is the whole of it: no
// second *message* store, one record per question. The seam that would put it
// in a Buzz channel is an identity for the local agent plus a channel to post
// into — upstream's managed-agent identity plumbing extended to the workspace,
// which is a feature, not a seam. When Task 3's document substrate exists, this
// is the first thing that should move onto it.
//
// Pure: shapes, parsing, and the caps. `askStore.ts` puts it in storage.

import { type AgentTurn, turnSummary } from "./agentTurn.ts";

export interface AskExchange {
  /** Unique within its thread and stable once written — the pending ask is
   * named by it while a turn is in flight. */
  id: string;
  /** Epoch milliseconds, from the caller's clock. */
  askedAt: number;
  question: string;
  /** **Exactly what was sent with the question.** Kept on the record rather
   * than derived at render time: a thread read months later must say what that
   * question was asked with, not what the surface would send today. */
  cwd: string;
  answer: string | null;
  refusal: string | null;
}

/** Per directory. Long enough to be a conversation, short enough that one
 * worktree cannot fill a webview's storage quota. */
export const MAX_EXCHANGES = 20;
/** How many directories keep a thread at all. Past this the oldest-touched one
 * goes — an answer about a worktree deleted last month is not worth the quota
 * that loses today's. */
export const MAX_DIRECTORIES = 8;
/** Past this an answer is cut, and the cut is stated in the text rather than
 * left as a sentence that stops. */
export const MAX_ANSWER_CHARS = 4000;

export type AskThreads = Record<string, AskExchange[]>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readExchange(value: unknown): AskExchange | null {
  if (!isRecord(value)) return null;
  const id = str(value.id);
  const question = str(value.question);
  const cwd = str(value.cwd);
  if (id === null || question === null || cwd === null) return null;
  return {
    answer: str(value.answer),
    askedAt: typeof value.askedAt === "number" ? value.askedAt : 0,
    cwd,
    id,
    question,
    refusal: str(value.refusal),
  };
}

/** Read stored threads. Missing, unparseable or half-readable storage reads as
 * whatever *is* readable — never a throw, and never an empty answer standing
 * in for a failed parse of one directory's rows. */
export function parseThreads(raw: string | null): AskThreads {
  if (raw === null || raw === "") return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!isRecord(parsed)) return {};
  const threads: AskThreads = {};
  for (const [cwd, rows] of Object.entries(parsed)) {
    if (!Array.isArray(rows)) continue;
    const exchanges = rows
      .map(readExchange)
      .filter((entry): entry is AskExchange => entry !== null)
      .slice(-MAX_EXCHANGES);
    if (exchanges.length > 0) threads[cwd] = exchanges;
  }
  return threads;
}

/** The caps, applied on the way out rather than on the way in, so a thread is
 * only ever trimmed by the write that made it too long. */
export function capThreads(threads: AskThreads): AskThreads {
  const kept = Object.entries(threads)
    .filter(([, rows]) => rows.length > 0)
    .sort((a, b) => lastAskedAt(b[1]) - lastAskedAt(a[1]))
    .slice(0, MAX_DIRECTORIES);
  const capped: AskThreads = {};
  for (const [cwd, rows] of kept) capped[cwd] = rows.slice(-MAX_EXCHANGES);
  return capped;
}

function lastAskedAt(rows: readonly AskExchange[]): number {
  return rows[rows.length - 1]?.askedAt ?? 0;
}

export function appendExchange(
  threads: AskThreads,
  exchange: AskExchange,
): AskThreads {
  const existing = threads[exchange.cwd] ?? [];
  return capThreads({ ...threads, [exchange.cwd]: [...existing, exchange] });
}

/** What came back, written onto the question it answers. A `null` for both is
 * not a possible outcome and is refused: an exchange settled with neither is
 * indistinguishable from one still waiting. */
export function settleExchange(
  threads: AskThreads,
  cwd: string,
  id: string,
  outcome: { answer: string } | { refusal: string },
): AskThreads {
  const rows = threads[cwd];
  if (rows === undefined) return threads;
  return {
    ...threads,
    [cwd]: rows.map((row) =>
      row.id === id
        ? {
            ...row,
            answer: "answer" in outcome ? capAnswer(outcome.answer) : null,
            refusal: "refusal" in outcome ? outcome.refusal : null,
          }
        : row,
    ),
  };
}

function capAnswer(answer: string): string {
  return answer.length <= MAX_ANSWER_CHARS
    ? answer
    : `${answer.slice(0, MAX_ANSWER_CHARS)}\n\n…the rest of this answer was not kept — it ran past ${MAX_ANSWER_CHARS} characters.`;
}

/** What the agent said, out of everything it did. Only `message` entries: a
 * thought is not an answer and a tool call is not an answer, and a transcript
 * pasted in whole would read as one. */
export function answerFromTurn(turn: AgentTurn): string {
  const said = turn.trace
    .filter((entry) => entry.kind === "message")
    .map((entry) => entry.text.trim())
    .filter((text) => text !== "");
  return said.length > 0
    ? said.join("\n\n")
    : `the agent ${turnSummary(turn)} without saying anything.`;
}

/** How one row reads. `pendingId` is the exchange a turn is in flight for —
 * without it an unanswered row is indistinguishable from one whose app was
 * closed mid-turn, and telling the owner "asking…" about a question nothing is
 * working on is the kind of lie this island keeps having to unlearn. */
export type ExchangeState = "asking" | "answered" | "refused" | "unanswered";

export function exchangeState(
  exchange: AskExchange,
  pendingId: string | null,
): ExchangeState {
  if (exchange.answer !== null) return "answered";
  if (exchange.refusal !== null) return "refused";
  return exchange.id === pendingId ? "asking" : "unanswered";
}

/** What a row with no answer and nothing in flight says for itself. */
export const UNANSWERED_NOTE =
  "no answer was recorded — this app or the agent stopped before one came back.";

/** What a question refused before it ever ran says for itself. It is written
 * onto the exchange rather than shown once and forgotten: a question typed
 * while a turn is running has to end up *somewhere*, and the thread is the one
 * place the owner already knows to look. */
export const NOT_ASKED_NOTE =
  "not asked — a turn was already running when this was typed, and one adapter runs at a time. Ask it again now that the one above it has come back.";
