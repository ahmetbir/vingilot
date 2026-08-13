// The one webview-level native file-drop event, routed to the pane under the
// cursor (vingilot/seams/drag-and-drop.yaml).
//
// **Why this file exists at all.** On macOS WKWebView the window's
// `dragDropEnabled` is global: with it `true` (which the terminal path-drop
// requires — only the native layer knows a dropped file's real filesystem
// path, WebKit never fills `File.path`) the OS delivers one
// `onDragDropEvent` for the whole webview and the HTML5 `drop`/`dataTransfer`
// path goes dark for the same drop. There is no per-element native delivery, so
// which pane a file landed on is a question only position can answer, and
// answering it is this module's job.
//
// **Position is physical pixels; the DOM is CSS pixels.** The event carries a
// `PhysicalPosition`, and `elementFromPoint` wants client (CSS) coordinates, so
// every reading is divided by the device pixel ratio first — the one arithmetic
// step that silently routes every drop to the wrong half of a Retina screen if
// it is skipped, which is why it is its own pure function with its own test.
// (The documented caveat that the drop position is inaccurate while the
// devtools debugger is attached is WebKit's, not ours, and only bites a
// developer with the inspector open.)
//
// **Only OS drags reach here.** `onDragDropEvent` fires for a Finder drag, not
// for the app's own @dnd-kit pointer reordering (that never leaves the
// pointer-event world), so a zone's hover affordance lights up for a file from
// Finder and stays dark while a sidebar row is being dragged past it — with no
// code here having to tell the two apart.
//
// **The registry holds live DOM elements, not community data.** A zone
// registers on mount and unregisters on unmount, so nothing here outlives the
// element it points at and there is nothing for `resetCommunityState()` to
// clear (desktop CLAUDE.md's rule is about caches of community-scoped data;
// this is neither).

import { getCurrentWebview } from "@tauri-apps/api/webview";

/** A registered pane that wants native file drops landing over it. */
export interface DropZone {
  /** The element whose on-screen box claims the drop. */
  element: HTMLElement;
  /** Absolute filesystem paths of the dropped files, in the order the OS gave
   * them. Never called for a drop that landed outside this element. */
  onDrop: (paths: string[]) => void;
  /** True while a file drag is hovering this zone, false when it leaves or
   * moves to another zone. Optional: a zone that only acts on the drop (the
   * composer's uploader) does not need the affordance. */
  onHoverChange?: (hovering: boolean) => void;
}

/** Physical device pixels to client (CSS) pixels. Pure so the Retina-routing
 * bug the header names is caught without a screen. A non-positive ratio is
 * treated as 1 — a reading is better placed at 1:1 than divided by zero. */
export function physicalToClient(
  position: { x: number; y: number },
  devicePixelRatio: number,
): { x: number; y: number } {
  const ratio = devicePixelRatio > 0 ? devicePixelRatio : 1;
  return { x: position.x / ratio, y: position.y / ratio };
}

/** The first node of `chain` (ordered nearest-first, i.e. the hit element then
 * its ancestors) that is a registered zone, or null if the drop landed on no
 * zone at all. Pure and generic over the node type so the routing decision —
 * "walk up from what the cursor is over until a pane owns it" — is tested
 * without a document. */
export function firstRegistered<T>(
  chain: readonly T[],
  registered: ReadonlySet<T>,
): T | null {
  for (const node of chain) {
    if (registered.has(node)) return node;
  }
  return null;
}

const zones = new Map<HTMLElement, DropZone>();
/** The zone the drag is currently over, so a move from one pane to the next
 * turns the first one's affordance off and the second's on. */
let hovered: HTMLElement | null = null;
let started = false;
let unlisten: (() => void) | null = null;

function ancestorChain(start: Element | null): Element[] {
  const chain: Element[] = [];
  for (
    let node: Element | null = start;
    node !== null;
    node = node.parentElement
  ) {
    chain.push(node);
  }
  return chain;
}

/** Which registered zone, if any, is under a physical drop position. */
function zoneAt(position: { x: number; y: number }): HTMLElement | null {
  const { x, y } = physicalToClient(
    position,
    typeof window === "undefined" ? 1 : window.devicePixelRatio || 1,
  );
  const hit = document.elementFromPoint(x, y);
  const match = firstRegistered(ancestorChain(hit), new Set(zones.keys()));
  return (match as HTMLElement | null) ?? null;
}

function setHovered(next: HTMLElement | null): void {
  if (next === hovered) return;
  const previous = hovered;
  hovered = next;
  if (previous !== null) zones.get(previous)?.onHoverChange?.(false);
  if (next !== null) zones.get(next)?.onHoverChange?.(true);
}

function handlePayload(payload: {
  type: "enter" | "over" | "drop" | "leave";
  paths?: string[];
  position?: { x: number; y: number };
}): void {
  switch (payload.type) {
    case "enter":
    case "over":
      if (payload.position) setHovered(zoneAt(payload.position));
      return;
    case "leave":
      setHovered(null);
      return;
    case "drop": {
      const zone = payload.position ? zoneAt(payload.position) : null;
      setHovered(null);
      if (zone !== null) zones.get(zone)?.onDrop(payload.paths ?? []);
      return;
    }
  }
}

/** Subscribe to the webview's native drag/drop once, lazily, on the first zone
 * to register. Kept for the life of the app after that — one listener is cheap
 * and tearing it down on the last unregister only to re-add it on the next
 * mount would churn an IPC subscription for nothing. A failed subscribe leaves
 * `started` false so the next registration retries rather than stranding every
 * zone silently. */
async function ensureStarted(): Promise<void> {
  if (started) return;
  started = true;
  try {
    unlisten = await getCurrentWebview().onDragDropEvent((event) => {
      handlePayload(event.payload);
    });
  } catch (error) {
    started = false;
    console.error("native drop routing failed to start", error);
  }
}

/** Register a pane as a native drop zone; the returned function unregisters it.
 * Call from a mount effect and return the result as the cleanup. */
export function registerDropZone(zone: DropZone): () => void {
  zones.set(zone.element, zone);
  void ensureStarted();
  return () => {
    if (hovered === zone.element) hovered = null;
    zones.delete(zone.element);
  };
}

/** Test seam only: drop every registration and reset the subscription flag so
 * one test's zones cannot leak into the next. Not used by the app. */
export function __resetNativeDropForTests(): void {
  zones.clear();
  hovered = null;
  started = false;
  unlisten?.();
  unlisten = null;
}
