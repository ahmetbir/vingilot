// The Run panel's per-project dev command (vingilot redesign P3, mockup
// `.runcard` — "Start Dev · vite · port 5173").
//
// **A command the owner wrote, or nothing.** The mockup's card names vite
// because the mockup's project runs vite; this app cannot know what starts a
// project's dev server and must not guess — a guessed `npm run dev` typed
// into the wrong repo is the fake data rule broken with a shell. So the card
// starts empty per project, the owner writes the command once, and it is
// remembered here — keyed by the project's own path, the same key its notes
// and plan use (`documents.ts`' reasoning).
//
// Storage is one localStorage map under one key, in the
// key-per-concern idiom. Values are trimmed; an empty write deletes the
// entry, which is how "forget this command" is spelled.

import { getStorageItem, setStorageItem } from "@/shared/lib/safeStorage";

export const DEV_COMMAND_STORAGE_KEY = "vingilot-dev-commands";

type DevCommands = Record<string, string>;

function readAll(): DevCommands {
  const raw = getStorageItem(DEV_COMMAND_STORAGE_KEY);
  if (raw === null) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      return {};
    const map: DevCommands = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string") map[key] = value;
    }
    return map;
  } catch {
    return {};
  }
}

/** The remembered command for `projectPath`, or `null` when none was ever
 * written — the state the card renders as "write the command that starts it". */
export function readDevCommand(projectPath: string): string | null {
  const stored = readAll()[projectPath];
  return stored === undefined || stored.trim() === "" ? null : stored;
}

/** Remember (or, with a blank, forget) the command for `projectPath`. */
export function persistDevCommand(projectPath: string, command: string) {
  const all = readAll();
  const trimmed = command.trim();
  if (trimmed === "") delete all[projectPath];
  else all[projectPath] = trimmed;
  setStorageItem(DEV_COMMAND_STORAGE_KEY, JSON.stringify(all));
}
