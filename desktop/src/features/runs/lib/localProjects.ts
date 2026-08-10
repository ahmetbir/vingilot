// The project list, local and authoritative
// (vingilot/docs/plans/2026-08-10-coordinator-optional.md, Task 1).
//
// Until now a project existed only inside the coordinator's workspace
// document, and the coordinator is a development service — Postgres in Docker
// plus `cargo run` (vingilot/scripts/coordinator-run.sh), none of which ships
// in the .dmg. On any machine that is not the one the coordinator runs on, the
// workspace therefore opened with no projects **and no way to add one**: the
// add button wrote a CAS mutation against something that was not there. That
// is what this module ends. The list lives on this machine, in a file the
// owner can read and back up, and it is what the workspace shows.
//
// **Where it lives:** `~/.vingilot/projects.json`, beside `~/.vingilot/worktrees`
// (`projects.ts`'s `DEFAULT_WORKTREE_ROOT_SUFFIX`) — a plain pretty-printed
// JSON file, not WebKit storage. localStorage would have been fewer lines and
// is the wrong answer twice over: a webview data reset clears it without
// telling anyone, and the owner cannot open it, copy it, or put it in a
// backup. The Rust side owns the bytes (`vingilot_projects/mod.rs`); this
// module owns what they mean.
//
// **One direction, never two.** When the coordinator is reachable the local
// list is pushed into its workspace document so a Run can still reference a
// repo by id — and nothing is ever read back out of it into the local list
// (except once; see the seed below). A two-way merge between a file and a CAS
// document is a conflict machine, and it is not opened here.
//
// **The seed is the dangerous one.** On the owner's Mac mini his real projects
// exist ONLY in the coordinator, so the first run of this build decides
// whether he still has them. `seedOnceDecision` is that decision and its
// condition is deliberately four separate facts, all required, because each
// one of them is a way to lose or duplicate his list: seeding before the
// coordinator has actually answered would write an empty list over nothing and
// mark it done; seeding into a list that was already started would duplicate
// whatever both sides hold; seeding twice would resurrect projects he
// removed. And because a silent import is indistinguishable from a silent loss
// when it goes wrong, the import is recorded in the document itself so the UI
// can say it happened (`importNotice`).
//
// **And the push has to know about the seed**, which is the trap one layer
// down: if he ran this build while the coordinator was down, added a project,
// and the coordinator then came up holding the five only it has, the seed
// correctly refuses (the list was already started) — and a push would then
// replace those five with the one. So `pushDecision` refuses too, and
// `unreconciledNotice` says what to do about it.

import {
  type ForeignRepoEntry,
  mergeForeignRepos,
  readRepoEntries,
  type Repo,
} from "./projects.ts";
import { chooseRepo, type RepoProbe } from "./repoChoice.ts";

/** The file's shape version. Bumped only if an older build would misread a
 * newer file; a reader that does not recognise the version refuses rather
 * than guesses (see `readLocalProjects`). */
export const LOCAL_PROJECTS_VERSION = 1;

/** Where the file lives, as the owner would type it. The real path is
 * resolved on the Rust side (`vingilot_projects`) — this constant exists so
 * the sentence the UI shows and the path the backend writes cannot be
 * described differently. */
export const LOCAL_PROJECTS_DISPLAY_PATH = "~/.vingilot/projects.json";

/** What was imported from a coordinator, once. Kept in the document rather
 * than in React state because the fact it records is permanent: this list did
 * not start empty, it started as a copy of somebody else's. */
export interface ImportRecord {
  /** ISO instant the import happened. */
  at: string;
  /** How many projects came across. Entries the coordinator held that this
   * build cannot read as projects came across too (into `foreign`) but are not
   * counted here: the sentence this feeds says "projects", and an entry this
   * build cannot name is not one it can show him. */
  count: number;
  /** Whether the owner has read the notice. Persisted so the sentence appears
   * once and stays gone, rather than returning at every launch. */
  acknowledged: boolean;
}

export interface LocalProjects {
  version: number;
  repos: Repo[];
  /** Entries of the file's `repos` array this build cannot read as a `Repo`.
   * Held aside and written back where they were, for the same reason
   * `readRepoEntries` does it for workspace state: this module rewrites the
   * whole array on every add and remove, so an entry it dropped would be
   * erased from the owner's file with no error and no confirm. */
  foreign: ForeignRepoEntry[];
  imported: ImportRecord | null;
}

export const EMPTY_LOCAL_PROJECTS: LocalProjects = {
  foreign: [],
  imported: null,
  repos: [],
  version: LOCAL_PROJECTS_VERSION,
};

function readImport(value: unknown): ImportRecord | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.at !== "string" || typeof v.count !== "number") return null;
  return { acknowledged: v.acknowledged === true, at: v.at, count: v.count };
}

export type LocalProjectsRead =
  | { ok: true; doc: LocalProjects }
  | { ok: false; reason: string };

/** Read the file's text. `null` means the file is not there, which is a fresh
 * machine and reads as the empty document.
 *
 * **Unreadable is not empty.** Invalid JSON, a non-object, a `repos` that is
 * not an array, or a version from a future build all come back as a refusal —
 * never as `EMPTY_LOCAL_PROJECTS`. The difference matters more here than
 * anywhere else in this feature: an empty document is exactly the state that
 * lets `seedOnceDecision` import and lets an add write, so reading a file we
 * could not parse as "empty" would overwrite it with whatever the coordinator
 * happened to hold. A refusal keeps the bytes where they are for the owner to
 * look at. */
export function readLocalProjects(text: string | null): LocalProjectsRead {
  if (text === null) return { doc: EMPTY_LOCAL_PROJECTS, ok: true };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (thrown) {
    return { ok: false, reason: `is not valid JSON (${String(thrown)})` };
  }

  // `null` is the one parsed value that cannot be asked for a key at all.
  // Everything else that is not an object — an array, a number, a string —
  // simply has no `repos` array, and is refused a few lines down in the same
  // words rather than by a second check saying the same thing twice.
  if (parsed === null) return { ok: false, reason: "holds null" };

  const record = parsed as Record<string, unknown>;
  if (
    typeof record.version === "number" &&
    record.version > LOCAL_PROJECTS_VERSION
  ) {
    return {
      ok: false,
      reason:
        `was written by a newer build (version ${record.version}; this one ` +
        `reads ${LOCAL_PROJECTS_VERSION})`,
    };
  }
  if (!Array.isArray(record.repos)) {
    return { ok: false, reason: "has no repos array" };
  }

  const { foreign, repos } = readRepoEntries(record);
  return {
    doc: {
      foreign,
      imported: readImport(record.imported),
      repos,
      version: LOCAL_PROJECTS_VERSION,
    },
    ok: true,
  };
}

/** The bytes to write. Pretty-printed with a trailing newline because the
 * owner is expected to open this file, not just back it up. */
export function serializeLocalProjects(doc: LocalProjects): string {
  return `${JSON.stringify(
    {
      imported: doc.imported,
      repos: mergeForeignRepos(doc.repos, doc.foreign),
      version: LOCAL_PROJECTS_VERSION,
    },
    null,
    2,
  )}\n`;
}

export type AddLocalProject =
  | { ok: true; doc: LocalProjects }
  | { ok: false; reason: string };

/** Add a picked directory. Every refusal — duplicate, bare repo, not a repo —
 * is `repoChoice.ts`'s, unchanged: what a directory means did not become a
 * different question when the list stopped living in the coordinator. */
export function addLocalProject(
  doc: LocalProjects,
  path: string,
  probe: RepoProbe,
): AddLocalProject {
  const choice = chooseRepo(path, probe, doc.repos);
  if (!choice.ok) return { ok: false, reason: choice.reason };
  return { doc: { ...doc, repos: [...doc.repos, choice.repo] }, ok: true };
}

/** Forget a path. Removes the entry and nothing else — no file is touched, no
 * directory walked, nothing on disk read or written inside the project. */
export function removeLocalProject(
  doc: LocalProjects,
  repoId: string,
): LocalProjects {
  return { ...doc, repos: doc.repos.filter((repo) => repo.id !== repoId) };
}

/** What the coordinator said, as the seed decision needs it. `answered: false`
 * covers every non-answer alike — unreachable, a refusal, a poll that has not
 * come back yet — because the seed treats them identically: a list that has
 * not arrived cannot be imported from.
 *
 * The answer carries the workspace document itself and not a list read out of
 * it, on purpose. There are two readers (`projects.ts`) and only one of them
 * is right here: the seed is the moment the coordinator's array becomes the
 * local file, so an entry dropped on the way in is dropped out of the thing
 * the owner is then told to back up. Taking `state` puts that choice inside
 * this function, where the reason for it is written down, instead of at a call
 * site where the shorter name is the losing one. */
export type CoordinatorRepos =
  | { answered: false }
  | { answered: true; state: unknown };

/** Why an import did not happen. Named rather than boolean because these are
 * four different situations and the tests are about telling them apart. */
export type SeedRefusal =
  | "already-imported"
  | "list-not-empty"
  | "no-answer"
  | "nothing-to-import";

export type SeedDecision =
  | { seed: true; doc: LocalProjects }
  | { seed: false; why: SeedRefusal };

/** The one time anything is read from the coordinator into the local list.
 *
 * All four conditions are required, and the order below is the order they are
 * checked in:
 *
 * 1. **Never imported before.** The record is what makes this once. Without
 *    it, removing an imported project would put it back on the next launch.
 * 2. **The local list is empty.** A list with anything in it is a list the
 *    owner has started; merging a coordinator's into it would duplicate every
 *    project both sides hold, and there is no key to merge on — two checkouts
 *    of one repository are two projects with one derived id.
 * 3. **The coordinator answered.** Not "was polled", not "is configured" —
 *    answered, with a workspace document. Seeding off a non-answer would
 *    import nothing and mark the import done, which on the Mac mini is
 *    exactly how his projects would disappear.
 * 4. **It has something to import.** An empty `repos` array is a real answer
 *    but not an import: recording it would burn the one chance this list has
 *    to be seeded, for a coordinator that had not been given its projects
 *    yet. Entries this build cannot parse do not count as something to import
 *    either — they would burn the seed for a list it could show nothing of.
 *
 * What crosses is the whole array, parseable or not: `foreign` comes across
 * beside `repos`, so the file the owner is told to back up holds everything
 * the coordinator held rather than the part this build happened to understand.
 * `doc.foreign` is kept ahead of it — the local list is empty by condition 2,
 * but a file can hold entries this build cannot read while holding no projects
 * it can, and the recorded index survives on both sides. Two entries claiming
 * one index cost their order and nothing else (`mergeForeignRepos` splices,
 * never drops).
 *
 * `at` is passed in rather than read from a clock here — this module has no
 * side effects, and the timestamp ends up in a file the owner reads. */
export function seedOnceDecision(
  doc: LocalProjects,
  coordinator: CoordinatorRepos,
  at: string,
): SeedDecision {
  if (doc.imported !== null) return { seed: false, why: "already-imported" };
  if (doc.repos.length > 0) return { seed: false, why: "list-not-empty" };
  if (!coordinator.answered) return { seed: false, why: "no-answer" };
  const { foreign, repos } = readRepoEntries(coordinator.state);
  if (repos.length === 0) return { seed: false, why: "nothing-to-import" };
  return {
    doc: {
      ...doc,
      foreign: [...doc.foreign, ...foreign],
      imported: { acknowledged: false, at, count: repos.length },
      repos: [...repos],
    },
    seed: true,
  };
}

/** The sentence shown after an import, or `null` when there is nothing to
 * say. It names the count, where the list now lives, and which direction it
 * travels from here — because the thing the owner has to know is not that
 * something was copied but that the copy is now the original. */
export function importNotice(doc: LocalProjects): string | null {
  const record = doc.imported;
  if (record === null || record.acknowledged) return null;
  const projects = record.count === 1 ? "project was" : "projects were";
  return (
    `${record.count} ${projects} imported from the coordinator into ` +
    `${LOCAL_PROJECTS_DISPLAY_PATH}. That file is now what this workspace ` +
    "shows: it is read from here, backed up from here, and pushed to the " +
    "coordinator when one is running — never read back out of it."
  );
}

/** The owner has read the notice. Persisted, so it does not come back. */
export function acknowledgeImport(doc: LocalProjects): LocalProjects {
  if (doc.imported === null) return doc;
  return { ...doc, imported: { ...doc.imported, acknowledged: true } };
}

/** The sentence for a local list that could not be read, or `null` when it
 * was. The reason is the reader's own words (`readLocalProjects`, or the Rust
 * side, or a rejected `invoke` on a machine with no Tauri host at all).
 *
 * This exists because of the one way this feature loses his projects
 * quietly. When the file cannot be read nothing is written and the screen
 * falls back to whatever the coordinator holds — which on a machine with no
 * coordinator is nothing at all. An empty project list with no sentence
 * beside it is indistinguishable from a fresh install, and he would add his
 * projects again over a file that still has them. So the count of what IS on
 * screen is named, and when it is zero the sentence says in words that this
 * is not an empty list. */
export function unreadableStoreNotice(
  reason: string | null,
  shown: number,
): string | null {
  if (reason === null) return null;
  const instead =
    shown === 0
      ? "Nothing is listed below, and that is not an empty list — it is a " +
        "list this build could not open."
      : `What is listed below is the ${shown} ` +
        `${shown === 1 ? "project" : "projects"} the coordinator holds, not ` +
        "this machine's list.";
  return (
    `this machine's project list could not be read (${reason}). ` +
    `${LOCAL_PROJECTS_DISPLAY_PATH} is left exactly as it is — nothing is ` +
    "written to it, and no project can be added or forgotten until it can be " +
    `read. ${instead}`
  );
}

function sameRepos(a: readonly Repo[], b: readonly Repo[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((repo, index) => {
    const other = b[index];
    return (
      other !== undefined &&
      repo.id === other.id &&
      repo.name === other.name &&
      repo.path === other.path
    );
  });
}

export type PushRefusal = "already-agrees" | "never-seen-this-list";

export type PushDecision =
  | { push: true; repos: unknown[] }
  | { push: false; why: PushRefusal };

/** What to write into the workspace document so the coordinator agrees with
 * this machine.
 *
 * The local list wins wholesale: a repo the coordinator holds and this machine
 * does not is a repo that was forgotten here, and the point of one direction
 * is that forgetting sticks. What is NOT overwritten is an entry this build
 * cannot parse — those are spliced back at their old positions
 * (`mergeForeignRepos`), because the array is still the unit of change on the
 * wire.
 *
 * **`never-seen-this-list` is the one case where forgetting must not stick**,
 * and it is the way the Mac mini loses his projects if this function is
 * written the obvious way. Picture the order: the new build launches while the
 * coordinator happens to be down, he adds one project, the coordinator comes
 * up holding the five that only IT has. The seed refuses (the list was already
 * started, correctly — merging has no key to merge on), and a push would then
 * replace those five with the one. So a list this machine has never taken —
 * `imported === null` while both sides hold something — is not pushed to at
 * all. It is a standoff, and `unreconciledNotice` says how to end it. */
export function pushDecision(doc: LocalProjects, state: unknown): PushDecision {
  const { foreign, repos } = readRepoEntries(state);
  if (doc.imported === null && doc.repos.length > 0 && repos.length > 0) {
    return { push: false, why: "never-seen-this-list" };
  }
  if (sameRepos(repos, doc.repos))
    return { push: false, why: "already-agrees" };
  return { push: true, repos: mergeForeignRepos(doc.repos, foreign) };
}

/** The sentence for the standoff above, or `null` when there is not one.
 *
 * It names the way out, and the way out is real: the seed's condition is an
 * empty local list, so forgetting the projects added here puts this machine
 * back in the state where the coordinator's list is imported wholesale. */
export function unreconciledNotice(
  doc: LocalProjects,
  state: unknown,
): string | null {
  const decision = pushDecision(doc, state);
  if (decision.push || decision.why !== "never-seen-this-list") return null;
  const count = readRepoEntries(state).repos.length;
  const projects = count === 1 ? "project" : "projects";
  return (
    `the coordinator holds ${count} ${projects} this machine has never ` +
    "taken, and this list was started here before it ever answered. Nothing " +
    "was pushed to it and nothing was taken from it — the two lists are left " +
    `as they are. To take the coordinator's list instead, forget the ` +
    `${doc.repos.length === 1 ? "project" : "projects"} added here: an empty ` +
    "list is imported from the coordinator once, the next time it answers."
  );
}
