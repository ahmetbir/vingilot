/**
 * Vingilot redesign P4 — Review's persisted reviewer choice and instruction
 * text (mockup `.revpop`). Two keys, the localStorage-key-per-concern idiom:
 * which crew member reviews (a persona id — the roster's stable identity,
 * unlike a pubkey a remint could change) and what he is asked to do (free
 * text; "Reset to default" restores DEFAULT_REVIEW_INSTRUCTION).
 */

import { getStorageItem, setStorageItem } from "@/shared/lib/safeStorage";
import { DEFAULT_REVIEW_INSTRUCTION } from "@/features/runs/lib/reviewDispatch";

export const VINGILOT_REVIEW_REVIEWER_STORAGE_KEY = "vingilot-review-reviewer";
export const VINGILOT_REVIEW_INSTRUCTION_STORAGE_KEY =
  "vingilot-review-instruction";

/** The stored reviewer's persona id, or `null` when none has been chosen
 * yet — `reviewDispatch.ts`'s `resolveStoredReviewer` decides what that
 * means against the workspace's real roster. */
export function readVingilotReviewReviewer(): string | null {
  return getStorageItem(VINGILOT_REVIEW_REVIEWER_STORAGE_KEY);
}

export function persistVingilotReviewReviewer(personaId: string) {
  setStorageItem(VINGILOT_REVIEW_REVIEWER_STORAGE_KEY, personaId);
}

/** The stored instruction, or the default when nothing has been typed yet. */
export function readVingilotReviewInstruction(): string {
  return (
    getStorageItem(VINGILOT_REVIEW_INSTRUCTION_STORAGE_KEY) ??
    DEFAULT_REVIEW_INSTRUCTION
  );
}

export function persistVingilotReviewInstruction(text: string) {
  setStorageItem(VINGILOT_REVIEW_INSTRUCTION_STORAGE_KEY, text);
}
