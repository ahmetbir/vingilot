// The React side of native file-drop routing: register the element a ref points
// at as a drop zone for as long as it is mounted and enabled
// (vingilot/seams/drag-and-drop.yaml).
//
// Callbacks are held in refs and read live, so a consumer passing an inline
// arrow (every one of them does) re-registers only when `enabled` or the ref
// identity actually changes — not on every render. The zone is the element
// itself; routing to it is `nativeDrop.ts`'s job.

import * as React from "react";

import { registerDropZone } from "@/features/runs/lib/nativeDrop";

interface NativeFileDropOptions {
  /** False parks the zone: no registration, and any hover it was showing is not
   * this hook's to clear because it never registered. Defaults to true. */
  enabled?: boolean;
  /** Absolute paths of the dropped files, routed here because the drop landed
   * over this element. */
  onDrop: (paths: string[]) => void;
  /** True while a file drag hovers this element. */
  onHoverChange?: (hovering: boolean) => void;
}

export function useNativeFileDrop<T extends HTMLElement = HTMLElement>(
  ref: React.RefObject<T | null>,
  { enabled = true, onDrop, onHoverChange }: NativeFileDropOptions,
): void {
  const onDropRef = React.useRef(onDrop);
  const onHoverChangeRef = React.useRef(onHoverChange);
  onDropRef.current = onDrop;
  onHoverChangeRef.current = onHoverChange;

  React.useEffect(() => {
    const element = ref.current;
    if (!enabled || element === null) return;
    return registerDropZone({
      element,
      onDrop: (paths) => onDropRef.current(paths),
      onHoverChange: (hovering) => onHoverChangeRef.current?.(hovering),
    });
  }, [enabled, ref]);
}

/** The callback-ref form, for a drop surface whose element is not known at
 * render (it may be a form, a section or a div at different hosts, and it may be
 * gated by `ref={cond ? dropRef : undefined}` so the host itself decides when
 * the zone is live — React calls the callback with null on detach, which
 * unregisters). Attaching to `null` (the gate closed, or unmount) tears the zone
 * down; attaching to an element registers it. The returned callback is stable,
 * so it does not itself churn registration between renders. */
export function useNativeFileDropRef({
  onDrop,
  onHoverChange,
}: Omit<NativeFileDropOptions, "enabled">): (
  element: HTMLElement | null,
) => void {
  const onDropRef = React.useRef(onDrop);
  const onHoverChangeRef = React.useRef(onHoverChange);
  onDropRef.current = onDrop;
  onHoverChangeRef.current = onHoverChange;
  const cleanupRef = React.useRef<(() => void) | null>(null);

  return React.useCallback((element: HTMLElement | null) => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    if (element === null) return;
    cleanupRef.current = registerDropZone({
      element,
      onDrop: (paths) => onDropRef.current(paths),
      onHoverChange: (hovering) => onHoverChangeRef.current?.(hovering),
    });
  }, []);
}
