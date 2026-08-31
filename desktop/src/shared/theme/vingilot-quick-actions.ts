/**
 * Vingilot redesign P4 — the status bar's configurable canned-prompt buttons
 * (mockup `.sbtn` defaults: Stop, Commit, Create PR — Stop is the app's real
 * stop-run behavior, not a prompt, and is not one of the buttons stored
 * here; see StatusBarQuickActions.tsx). Persisted in the app's
 * localStorage-key-per-concern idiom, beside vingilot-dock-size.ts and
 * vingilot-crew-position.ts.
 *
 * An explicit empty list is a real, distinct choice (the owner removed every
 * button) and is honored as such — only a genuinely absent or unreadable
 * value falls back to the mockup's two defaults (Commit, Create PR).
 */

import { getStorageItem, setStorageItem } from "@/shared/lib/safeStorage";
import {
  DEFAULT_QUICK_ACTIONS,
  readQuickActionsList,
  type QuickActionButton,
} from "@/features/runs/lib/quickActions";

export const VINGILOT_QUICK_ACTIONS_STORAGE_KEY = "vingilot-quick-actions";

/** The stored buttons, or the mockup's two defaults when nothing has been
 * stored yet or the stored value cannot be read as an array at all. */
export function readVingilotQuickActions(): QuickActionButton[] {
  const stored = getStorageItem(VINGILOT_QUICK_ACTIONS_STORAGE_KEY);
  if (stored === null) return [...DEFAULT_QUICK_ACTIONS];
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return [...DEFAULT_QUICK_ACTIONS];
  }
  if (!Array.isArray(parsed)) return [...DEFAULT_QUICK_ACTIONS];
  return readQuickActionsList(parsed);
}

export function persistVingilotQuickActions(
  buttons: readonly QuickActionButton[],
) {
  setStorageItem(VINGILOT_QUICK_ACTIONS_STORAGE_KEY, JSON.stringify(buttons));
}
