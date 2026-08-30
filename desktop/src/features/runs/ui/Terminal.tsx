// A real terminal, one instance per PTY session, backed by the
// `vingilot_pty` Tauri commands (desktop/src-tauri/src/vingilot_pty/).
// Renders with @xterm/xterm + @xterm/addon-fit — the plan's second and last
// named dependency (vingilot/docs/plans/2026-08-06-projects-and-terminal.md).
//
// **Trust boundary:** this runs the owner's own shell in the worktree named
// by `cwd` — the same risk class as opening Terminal.app there (ADR-003's
// V1 trust model). Nothing here isolates or sandboxes the shell.
//
// **Persistence is the pty's, not this component's.** Mounting attaches a
// view to a session; unmounting detaches it and leaves the shell running, so
// a worktree switch, a project switch, or any re-render is survivable. What
// the screen held comes back from the session's own scrollback, replayed by
// `pty_open` on reattach — this component never assumes its xterm outlives
// anything. The shell is killed only when the owner closes its tab or the
// worktree itself leaves the workspace (features/runs/lib/terminalTabs.ts),
// the two events that mean "really closed".
//
// How far that persistence reaches is the backend's answer, not this
// component's guess: with tmux the shell also outlives the app itself, though
// not a reboot (vingilot_pty/tmux.rs). The status bar states which mode is
// live (features/runs/lib/terminalPersistence.ts); nothing here may imply
// more than it says.
//
// **A session is opened by a measurement, not by mounting.** Terminals for
// every worktree mount at once, all but one of them inside a hidden subtree
// that measures 0×0. Opening those at a placeholder size does not merely
// start a shell small: under tmux the sole attached client's size *is* the
// session's size, so it reshapes a session restored from a previous app run
// and re-wraps its scrollback. So this waits — being shown is what measures
// it, and being measured is what opens it (features/runs/lib/terminalFit.ts).
// A worktree the owner never looks at costs no shell at all.
//
// **The wheel here is an input, not a scroll.** Under tmux the scrollback is
// tmux's: there is nothing in this subtree for the browser to move, and xterm
// turns the gesture into a mouse report that goes out on the pty. So the
// container claims the gesture (`shared/lib/wheelOwner.ts`) — without that
// claim the shell's boundary lock consumes every wheel at window capture, one
// layer above xterm, and the terminal cannot scroll at all
// (tests/e2e/terminal-wheel.spec.ts).
//
// **The workspace type scale stops at this container** (vingilot/docs/workbench.md,
// "The type scale"). The type inside is xterm's own, and it is never inherited:
// this file constructs XTerm with no `fontSize`, so xterm falls back to its own
// default of 15 and then writes that out explicitly wherever it counts — onto
// the element it measures a cell from, and onto `.xterm-rows` through a
// stylesheet it appends itself (@xterm/xterm 5.5.0 lib/xterm.js; its
// css/xterm.css carries no font rule at all). So a text size on this host would
// change nothing today. The scale stops here to keep it that way: app styling
// never begins creeping onto the element xterm owns, so the day something
// inside does read an inherited font is a day nobody has to find
// (lib/typeScale.test.mjs). The chrome around it — the tab strip, the scratch
// header, the notice below — is not exempt.
//
// **Its colours are the app's, and they are asked for rather than written
// down.** xterm's stock palette is `#ffffff` on `#000000`
// (@xterm/xterm 5.5.0 browser/services/ThemeService.ts, `DEFAULT_FOREGROUND` /
// `DEFAULT_CURSOR`), which is white text on a black rectangle — legible on the
// dark themes this was built against, and on a light one a black hole in the
// pane with invisible text in it (Catppuccin Latte's `--background` is 94.9%
// lightness). So the background, foreground, cursor and selection are read off
// the app's own tokens, through a probe element wearing the same Tailwind
// classes the rest of the app uses. Read rather than duplicated: a copy of the
// palette here is a copy that goes stale the first time a theme is added, and
// what the terminal must match is what the app actually paints. Only these
// five; the 16 ANSI colours stay xterm's, because those are the shell's own
// vocabulary and an app that recoloured them would be lying about what a
// program printed.
//
// **The background is named, not left transparent.** Asking for `transparent`
// reads like "let the pane show through" and is not what happens: xterm parses
// a theme colour with `css.toColor`, whose last resort is a 1×1 canvas that
// throws on anything not fully opaque, so `transparent` is swallowed and the
// slot falls back to `#000000` — which `Viewport._handleThemeChange` then
// writes onto `.xterm-viewport`, an element stretched over the whole terminal.
// Measured: `background: "transparent"` produced a computed `rgb(0, 0, 0)`
// there. Handing over the pane's own surface paints the same pixels the pane
// would have, and every colour xterm composites *over* the background —
// the selection below, above all — then lands on the right ground.
//
// **The type inside is still xterm's, deliberately.** No `fontFamily` is set
// even though the stock stack (`courier-new, courier, monospace`) is not what
// anyone would choose: `paneModel.ts`'s `CELL_PX` is a *measurement* of that
// stack at xterm's default 15px, and the 80-column floor is built on it. A
// nicer font is a different cell advance and therefore a floor that no longer
// guarantees the columns it claims. Same for the horizontal padding below,
// which `TERMINAL_CHROME_PX` counts.

import "@xterm/xterm/css/xterm.css";

import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { Terminal as XTerm } from "@xterm/xterm";
import * as React from "react";

import {
  onPtyOutput,
  ptyBacking,
  ptyCopyMode,
  ptyCopyModeExit,
  ptyOpen,
  ptyResize,
  ptyWrite,
} from "@/features/runs/lib/ptyClient";
import {
  acceptPtyChunk,
  initialPtyStreamState,
} from "@/features/runs/lib/ptyStream";
import { takeTerminalType } from "@/features/runs/lib/terminalType";
import {
  resolveFit,
  resolveFitAction,
  type SessionPhase,
  type TerminalGeometry,
} from "@/features/runs/lib/terminalFit";
import {
  SELECTION_ALPHA,
  type TerminalPalette,
  samePalette,
  translucent,
  usableColor,
} from "@/features/runs/lib/terminalPalette";
import { useTerminalFind } from "@/features/runs/lib/useTerminalFind";
import {
  copyModeNotice,
  linesBehind,
  scrollbackNotice,
} from "@/features/runs/lib/terminalScrollback";
import { shellEscapePaths } from "@/features/runs/lib/shellEscape";
import { useNativeFileDrop } from "@/features/runs/lib/useNativeFileDrop";
import { FindBar } from "@/features/runs/ui/FindBar";
import { wheelOwnerProps } from "@/shared/lib/wheelOwner";

/** Said in the field's own title — the terminal's answer to `FileViewer.tsx`'s
 * `SMART_CASE_TITLE`, same rule, same three keys. Smart case applies here too:
 * `useTerminalFind.ts` computes it the same way `findInFile.ts` does. */
const TERMINAL_FIND_HINT =
  "Find in this terminal's scrollback. Smart case: matches either case until you type a capital letter, then it matches exactly. Enter for the next match, ⇧Enter for the previous, Esc to close.";

interface TerminalProps {
  /** The PTY session id: `<worktree binding id>#<tab ordinal>` (mod.rs: "same
   * tab of the same worktree ⇒ same session"). Opaque here — this component
   * neither derives it nor reads anything out of it. */
  sessionId: string;
  /** Where the shell starts. `null` means this worktree's cwd cannot yet be
   * derived (e.g. a task worktree with no owner run) — the terminal shows a
   * waiting state instead of opening a session. */
  cwd: string | null;
  /** False while a different worktree/tab is showing — the DOM stays
   * mounted (scrollback intact) but hidden, never torn down. */
  active: boolean;
  /** Bumped by the work surface's ⌘` handler; focusing only happens when
   * `active` is also true, so a background terminal never steals focus. */
  focusToken: number;
  /** True for the scratch shell (`lib/scratchTerminal.ts`): the session is
   * spawned outside tmux, so closing it is the end of it and there is nothing
   * to reattach to. Everything else about this component is the same — an
   * xterm attached to a pty knows nothing about how long the pty lives. */
  ephemeral?: boolean;
}

/** One colour, as the app resolves it — the probe is dressed in a Tailwind
 * class and asked what that came out as.
 *
 * Through a real element rather than by reading the CSS custom property: the
 * tokens are bare HSL triples in one place and whole colours in another
 * (`shared/styles/globals/theme.css`), and a caller that wrapped every reading
 * in `hsl(…)` would produce an invalid colour for the second kind and never
 * hear about it. An element wearing `text-foreground` is the same question the
 * rest of the app asks, answered by the same engine.
 *
 * A fully transparent answer is `null`, not a colour — the rule, and the reason
 * for it, are `lib/terminalPalette.ts`'s `usableColor`. All this adds is the
 * element to ask. */
function probeColor(
  probe: HTMLElement,
  className: string,
  property: "backgroundColor" | "color",
): string | null {
  probe.className = className;
  return usableColor(window.getComputedStyle(probe)[property]);
}

/** The palette handed to xterm: the app's own surface, foreground, accent
 * cursor and accent selection.
 *
 * The surface answers twice. Once as `background`, for the reason in the header
 * above; and once as `cursorAccent`, which is the colour the character *under*
 * a block cursor is drawn in — so it has to be the surface or the cell the
 * cursor sits on goes blank.
 *
 * **The selection is thinned here, not by xterm.** It cannot be probed as
 * `bg-primary/30`: Tailwind compiles a slash opacity to
 * `color-mix(in oklab, …)`, which Chromium computes to an `oklab(…)` value that
 * xterm's parser cannot read at all — it threw on every reading, `parseColor`
 * swallowed it, and the selection was silently xterm's stock grey the entire
 * time (`terminal-chrome.spec.ts` is what caught it, by asking what the
 * terminal was actually painted with rather than whether the component had
 * computed something). Nor can it be handed over opaque and left to xterm's own
 * 30%: that thinning runs *after* the colour the DOM renderer paints has
 * already been composited, and compositing an opaque colour returns it
 * unchanged — so the accent reached the screen at full strength, a solid block
 * with the app's foreground drawn on top of it. Measured on the light theme the
 * e2e build boots in, where `--primary` and `--foreground` are the same colour:
 * selected text was invisible. So the alpha is applied to the probed accent
 * here, in the one spelling xterm reads back (`lib/terminalPalette.ts`), and
 * xterm composites it over the surface it was just given. */
function terminalTheme(probe: HTMLElement): TerminalPalette {
  // The term ground, not the general background: the redesign gives the
  // terminal the mockup's `.term` surface (#101014, `--vingilot-term`), one
  // step darker than the stage. Probed through the same class the pane's own
  // box wears (`vingilot-tokens.css`), so the xterm and the padding ring
  // around it cannot disagree about what the ground is.
  const surface = probeColor(probe, "vingilot-term-ground", "backgroundColor");
  const accent = probeColor(probe, "bg-primary", "backgroundColor");
  const theme: TerminalPalette = {
    background: surface ?? undefined,
    cursor: probeColor(probe, "text-primary", "color") ?? undefined,
    cursorAccent: surface ?? undefined,
    foreground: probeColor(probe, "text-foreground", "color") ?? undefined,
    // A reading this cannot thin is still a real colour, and a selection drawn
    // too strongly is a better failure than no selection colour at all.
    selectionBackground:
      accent === null
        ? undefined
        : (translucent(accent, SELECTION_ALPHA) ?? accent),
  };
  probe.className = "";
  return theme;
}

/** How many frames to keep re-asking for a measurement before giving up.
 * xterm re-measures its cell box from its own IntersectionObserver once a
 * hidden subtree is shown, which lands a frame or more after the React effect
 * that noticed the change; ~2s is far past that and still terminates. A
 * terminal that somehow exhausts it keeps its last good geometry and is
 * re-fitted by the next ResizeObserver callback.
 *
 * Exhausting it is not a deadline for opening the session, only for this
 * burst of frames. A terminal that is never shown is never measured and so
 * never opened — which is the point — and being shown starts a fresh burst. */
const MAX_FIT_FRAMES = 120;

export function Terminal({
  active,
  cwd,
  ephemeral = false,
  focusToken,
  sessionId,
}: TerminalProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  /** The whole pane's box, the drop zone a Finder drag is hit-tested against.
   * Outside the xterm host (`containerRef`) so the affordance can be drawn over
   * the pane without reaching into the element xterm owns. */
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const termRef = React.useRef<XTerm | null>(null);
  const focusTerminal = React.useCallback(() => termRef.current?.focus(), []);
  // ⌘F over this terminal's own scrollback (`lib/useTerminalFind.ts`'s
  // header). `rootRef` is the ownership boundary — the same box the drop
  // affordance above is drawn over — and `active` gates it to whichever one
  // of this worktree's mounted terminals is actually shown, exactly as
  // `focusToken`'s own effect below does.
  const termFind = useTerminalFind({ active, focusTerminal, paneRef: rootRef });
  /** The element the app's colours are read off. Outside the xterm host on
   * purpose — that element belongs to xterm, and this one exists to be
   * restyled several times a second while a theme is being picked. */
  const probeRef = React.useRef<HTMLSpanElement | null>(null);
  /** How far back through xterm's own scrollback the view is sitting. Always
   * 0 under tmux, which owns the history itself
   * (`lib/terminalScrollback.ts`). */
  const [behind, setBehind] = React.useState(0);
  /** Re-runs the live attachment's measure step. Held in a ref because the
   * attachment owns it: it closes over that attachment's xterm, phase, and
   * frame handle, and is null between attachments. */
  const remeasureRef = React.useRef<(() => void) | null>(null);
  /** True while a Finder file drag is hovering this pane. Drives the quiet
   * drop affordance below. Never true for the app's own @dnd-kit drags — a
   * sidebar reorder is pointer events and never reaches `onDragDropEvent`
   * (`lib/nativeDrop.ts`), so this stays dark while a row is dragged past. */
  const [isDropTarget, setIsDropTarget] = React.useState(false);
  /** True while the pane sits in tmux copy-mode — where a wheel-up
   * deliberately put it, and where typed keys go to tmux rather than the
   * shell. Read by a poll below; drives the "back to live" notice. */
  const [inCopyMode, setInCopyMode] = React.useState(false);
  // Mirrors for the copy-mode poll's arm/disarm logic (the poll effect below):
  // a wheel burst arms ~5 ticks of asking; consecutive "not in copy-mode"
  // answers disarm. Refs, not state — the loop must read them without
  // re-running the effect.
  const inCopyModeRef = React.useRef(false);
  const copyModeInterestRef = React.useRef(0);

  // A wheel is the only way this app's panes enter tmux copy-mode, so it is
  // what arms the poll. A NATIVE capture listener on the pane's own box, not
  // a React synthetic: xterm owns the wheel on its viewport, and capture on
  // this element fires before anything downstream can consume it.
  React.useEffect(() => {
    const root = rootRef.current;
    if (root === null) return;
    const arm = () => {
      copyModeInterestRef.current = 5;
    };
    root.addEventListener("wheel", arm, { capture: true, passive: true });
    return () => {
      root.removeEventListener("wheel", arm, { capture: true });
    };
  }, []);

  // A dropped file inserts its shell-escaped absolute path at the cursor, iTerm
  // style — the same `pty_write` channel a keystroke uses, so it lands exactly
  // where the caret is. A trailing space (never a newline) is appended so the
  // owner can drop again or type the next argument; the line is his to run, and
  // a drop that ran itself would be a drop that could run anything.
  useNativeFileDrop(rootRef, {
    enabled: cwd !== null,
    onDrop: (paths) => {
      if (paths.length === 0) return;
      void ptyWrite(sessionId, `${shellEscapePaths(paths)} `);
    },
    onHoverChange: setIsDropTarget,
  });

  // One xterm instance per attachment. Tearing this down detaches a view; it
  // does not end the session, and re-running it reattaches to the same live
  // shell — `pty_open` replays what the screen held rather than spawning a
  // second one.
  React.useEffect(() => {
    const mounted = containerRef.current;
    if (cwd === null || mounted === null) return;
    // Re-bound as non-nullable: the hoisted helpers below are function
    // declarations, which do not inherit the narrowing from the guard.
    const container: HTMLDivElement = mounted;
    const shellCwd: string = cwd;

    const probe = probeRef.current;
    /** The palette this xterm is currently wearing, so a re-reading that says
     * the same thing can be dropped rather than re-applied. */
    let applied: TerminalPalette | null =
      probe === null ? null : terminalTheme(probe);

    /** How many times a palette has actually been handed to xterm, written to
     * the DOM so that "the theme was re-applied" is a thing a test can watch.
     *
     * Applying a palette is otherwise invisible when it changes nothing, which
     * is exactly the case the gate below exists for: a Cmd +/- keystroke
     * reaches the observer, re-reads the same colours, and must go no further.
     * Without a counter the only observable difference between the gate working
     * and the gate being absent is a repaint nobody can assert on. */
    let generation = 0;
    function markPalette() {
      generation += 1;
      container.dataset.paletteGeneration = String(generation);
    }
    if (applied !== null) markPalette();

    const term = new XTerm({
      // Required for `SearchAddon`'s match decorations: `registerDecoration`
      // is xterm 5.x's proposed (not-yet-stable) API, and the addon throws
      // "You must set the allowProposedApi option to true" on every
      // `findNext`/`findPrevious` call without this — silently, from xterm's
      // own internals, past any try/catch this file has. Scoped to the whole
      // terminal rather than to search alone because there is no narrower
      // knob: `allowProposedApi` is a constructor option, not per-addon.
      allowProposedApi: true,
      cursorBlink: true,
      theme: applied ?? undefined,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    // Loaded for every attachment, active or not — the same choice already
    // made for `fit` above, and for the same reason: the terminal for a
    // worktree the owner is not looking at costs no shell (the header's
    // "opened by a measurement" rule), but it is still one `loadAddon` call
    // cheaper than a second code path that adds the addon only when a
    // terminal becomes active. `useTerminalFind`'s own listener is what
    // actually gates the feature on `active`; this just wires the addon in.
    const search = new SearchAddon({ highlightLimit: 1000 });
    term.loadAddon(search);
    const detachFind = termFind.attach(search);
    term.open(container);
    termRef.current = term;

    let detached = false;
    let phase: SessionPhase = "unopened";
    /** The geometry this session was last given, so a measurement landing on
     * the same cells costs nothing. Reset with the attachment, because a
     * reattach makes no claim about what the session's size is. */
    let given: TerminalGeometry | null = null;
    let frame: number | null = null;
    let stream = initialPtyStreamState();
    let unlisten: (() => void) | undefined;

    // Subscribed once per attachment, and always before any `pty_open`: that
    // command emits the reattach replay — and a fresh shell its first prompt
    // — from inside itself, so a listener attached afterwards misses the
    // screen it exists to render. The overlap that ordering creates (a live
    // chunk emitted between the subscribe and the snapshot, and so present in
    // both) is resolved by `ptyStream`. Subscribing here rather than inside
    // `open` also means a retried open cannot stack a second listener.
    const subscribed = onPtyOutput(sessionId, (chunk) => {
      const accepted = acceptPtyChunk(stream, chunk);
      stream = accepted.state;
      for (const text of accepted.write) term.write(text);
    }).then((stop) => {
      if (detached) stop();
      else unlisten = stop;
    });

    async function open(cols: number, rows: number) {
      phase = "opening";
      await subscribed;
      if (detached) return;
      try {
        await ptyOpen(sessionId, shellCwd, cols, rows, ephemeral);
      } catch (error) {
        // Back to unopened, so being shown again retries rather than
        // stranding the pane with no shell and no explanation but this line.
        phase = "unopened";
        if (!detached) term.write(`\r\n[terminal: ${String(error)}]\r\n`);
        return;
      }
      if (detached) return;
      phase = "open";
      // Mail filed for this session before it existed — the dock's Start Dev
      // and "New terminal here" (`lib/terminalType.ts`). Typed down the same
      // channel the drop-paste above uses, after the open so it cannot race
      // it; taken once, so a reattach never re-types a command.
      const typed = takeTerminalType(sessionId);
      if (typed !== null) void ptyWrite(sessionId, typed);
      // The container can have been resized while the open was in flight, and
      // nothing else is watching for that.
      remeasure();
    }

    /** One measurement, and whatever it licenses. Answers whether to ask
     * again on a later frame. */
    function step(): "retry" | "settled" {
      if (detached) return "settled";
      const { height, width } = container.getBoundingClientRect();
      const action = resolveFitAction(
        phase,
        resolveFit(width, height, fit.proposeDimensions() ?? null),
        given,
      );
      if (action.type === "retry") return "retry";
      if (action.type === "idle") return "settled";

      // Both halves or neither: sizing the xterm without handing the pty the
      // same geometry leaves the shell writing for a shape the view is not
      // rendering.
      fit.fit();
      if (action.type === "open") {
        void open(action.cols, action.rows);
      } else {
        // Recorded before the call rather than after it: what matters is that
        // this geometry has been sent, and a later frame proposing the same
        // cells must not send it a second time while the first is in flight.
        // A resize that fails leaves the session's size unknown to this view,
        // so the record is dropped and the next measurement reaches the shell.
        given = { cols: action.cols, rows: action.rows };
        void ptyResize(sessionId, action.cols, action.rows).catch(() => {
          // The session can close under a resize (the shell exited, the
          // worktree left the workspace). Nothing to render for it either way.
          given = null;
        });
      }
      return "settled";
    }

    function remeasure() {
      if (frame !== null) {
        cancelAnimationFrame(frame);
        frame = null;
      }
      let frames = 0;
      function attempt() {
        frame = null;
        if (step() !== "retry") return;
        frames += 1;
        if (frames > MAX_FIT_FRAMES) return;
        frame = requestAnimationFrame(attempt);
      }
      attempt();
    }

    remeasureRef.current = remeasure;
    remeasure();

    const dataDisposable = term.onData((data) => {
      void ptyWrite(sessionId, data);
    });

    /** Where the view is in xterm's own scrollback, read off the buffer rather
     * than taken from whatever fired.
     *
     * Called on new output too, where the viewport tracks the base and the
     * distance stays 0 — so a terminal at the bottom under a build's worth of
     * output computes a number per event and sets no state at all. */
    function readScrollback() {
      if (detached) return;
      const buffer = term.buffer.active;
      setBehind(linesBehind(buffer.baseY, buffer.viewportY));
    }

    // **Two sources, because xterm only announces one of the two ways this
    // changes.** `onScroll` covers what the buffer does — output arriving,
    // `scrollToBottom()`, an alt-screen switch. It does *not* cover the owner
    // scrolling: @xterm/xterm 5.5.0's `browser/Viewport.ts` turns a scroll of
    // its own element into `_onRequestScrollLines.fire({ suppressScrollEvent:
    // true })`, and `BufferService.scrollLines` honours that flag by not
    // firing `onScroll` at all. So a wheel over a terminal whose history is
    // its own — the scratch shell, and every terminal on a machine with no
    // tmux — moved the view and told nobody.
    //
    // Hence the DOM event as well, taken in the capture phase on this
    // container: a `scroll` event does not bubble, but capture still reaches
    // every ancestor of its target, which is how one listener here covers an
    // element xterm creates, owns and may replace.
    //
    // **Capture also means this runs before xterm's own listener**, which sits
    // on the viewport element itself and is what actually moves the buffer. So
    // the reading has to be deferred past it — and a microtask is not far
    // enough. The event loop performs a microtask checkpoint whenever the
    // JavaScript stack empties, which it does between two listeners for one
    // event, so a `queueMicrotask` here runs *before* xterm's handler and reads
    // the position the view has just left. Measured: after scrolling a 400-line
    // buffer to the top, the rendered first row was `line-1` and the microtask
    // still read a distance of 0. A frame is past the whole dispatch, and is
    // coalesced so a flick that fires a dozen scroll events costs one read.
    const scrollDisposable = term.onScroll(() => readScrollback());
    let scrollFrame: number | null = null;
    const onDomScroll = () => {
      if (scrollFrame !== null) return;
      scrollFrame = requestAnimationFrame(() => {
        scrollFrame = null;
        readScrollback();
      });
    };
    container.addEventListener("scroll", onDomScroll, { capture: true });

    const resizeObserver = new ResizeObserver(() => remeasure());
    resizeObserver.observe(container);

    // The app's colours are a live reading, not a snapshot: the theme is
    // switched by rewriting the root element's class and its inline custom
    // properties (`shared/theme/ThemeProvider.tsx`), and a terminal that kept
    // the palette it was born with would be the one surface still wearing the
    // old theme. Attribute-filtered, so this hears the two writes that mean a
    // theme changed.
    //
    // Not *only* those two, though — which is why the reading is compared
    // before it is used. Cmd +/- zooms by writing an inline `font-size` on the
    // same element (`app/useWebviewZoomShortcuts.ts`), so every zoom keystroke
    // arrives here as well, and the terminals for every worktree are mounted at
    // once. xterm 5.5.0 does not diff `options.theme`: assigning it rebuilds
    // the palette, fires `onChangeColors`, and makes the DOM renderer re-inject
    // its stylesheet and refresh every row. A palette that has not changed is
    // dropped here instead (`lib/terminalPalette.ts`).
    const themeObserver =
      probe === null
        ? null
        : new MutationObserver(() => {
            const next = terminalTheme(probe);
            if (applied !== null && samePalette(applied, next)) return;
            applied = next;
            term.options.theme = next;
            markPalette();
          });
    themeObserver?.observe(document.documentElement, {
      attributeFilter: ["class", "style"],
    });

    return () => {
      detached = true;
      remeasureRef.current = null;
      if (frame !== null) {
        cancelAnimationFrame(frame);
        frame = null;
      }
      unlisten?.();
      dataDisposable.dispose();
      scrollDisposable.dispose();
      container.removeEventListener("scroll", onDomScroll, { capture: true });
      if (scrollFrame !== null) cancelAnimationFrame(scrollFrame);
      resizeObserver.disconnect();
      themeObserver?.disconnect();
      detachFind();
      term.dispose();
      termRef.current = null;
      // A reattachment replays the session's screen and lands at the bottom of
      // it, so the distance this view had scrolled back belongs to the xterm
      // that is going, not to the one that replaces it.
      setBehind(0);
    };
    // `ephemeral` is here because it decides how the session is spawned, and a
    // session's lifetime is fixed at spawn. It never changes for a given
    // `sessionId` — a scratch id and a tab id cannot name each other
    // (`lib/scratchTerminal.ts`) — so this dependency never actually fires.
    // `termFind.attach` is stable (`useCallback`, no deps) for the same reason
    // `focusTerminal` above it is, so adding it costs this effect nothing.
  }, [sessionId, cwd, ephemeral, termFind.attach]);

  // **The half of the scroll story `linesBehind` cannot see.** Under tmux the
  // wheel is an input and the history is tmux's, so `behind` stays 0 there by
  // design — but a wheel-up really does move the view: it puts the pane in
  // copy-mode, where the two ways back the owner is expected to know are
  // wheeling to the bottom and `q`, and where a typed key is swallowed as a
  // copy-mode command rather than reaching the shell. That swallowing is the
  // owner's "scroll duzgun calismiyor" (2026-08-29 redesign, decision 4). So
  // the pane is asked — `pty_copy_mode`, tmux's own `#{pane_in_mode}` — on a
  // 1s poll gated three ways: only while shown (a hidden terminal polls
  // nothing), only for a session tmux could be backing (`pty_backing` is one
  // answer per app run; an ephemeral spawn is never tmux's), and stopped with
  // the attachment. The answer drives the same corner control the non-tmux
  // path already has, re-worded (`copyModeNotice`), whose click runs
  // copy-mode's own cancel. The e2e half is terminal-scroll-live.spec.ts;
  // the tmux half is proved against a real server in
  // vingilot_pty/live/wheel.rs.
  React.useEffect(() => {
    if (!active || cwd === null || ephemeral) return;
    let stopped = false;
    let handle: number | null = null;
    const tick = async () => {
      // The IPC (a tmux process spawn per ask) runs only while a wheel has
      // recently ARMED this pane or it is already known to be in copy-mode —
      // an idle Deck spawns nothing (P2 verify, minor 2: the unarmed loop
      // was 1 process/sec per active terminal, ×2 under a split). A wheel is
      // the only way this app's panes enter copy-mode; each burst re-arms.
      if (copyModeInterestRef.current === 0 && !inCopyModeRef.current) {
        if (!stopped) handle = window.setTimeout(() => void tick(), 1_000);
        return;
      }
      try {
        const mode = await ptyCopyMode(sessionId);
        if (!stopped) {
          setInCopyMode(mode);
          inCopyModeRef.current = mode;
          if (mode) copyModeInterestRef.current = 5;
          else if (copyModeInterestRef.current > 0)
            copyModeInterestRef.current -= 1;
        }
      } catch {
        // An unreachable backend reads as "not in copy-mode": the affordance
        // simply does not appear, which is where it started.
        if (!stopped) {
          setInCopyMode(false);
          inCopyModeRef.current = false;
          copyModeInterestRef.current = 0;
        }
      }
      if (!stopped) handle = window.setTimeout(() => void tick(), 1_000);
    };
    void ptyBacking()
      .then((backing) => {
        if (!stopped && backing === "tmux") void tick();
      })
      .catch(() => {});
    return () => {
      stopped = true;
      if (handle !== null) window.clearTimeout(handle);
      setInCopyMode(false);
    };
  }, [active, cwd, ephemeral, sessionId]);

  // Being shown is what measures this terminal, and a measurement is the only
  // thing that opens its session — so for a terminal that mounted hidden this
  // is the open, not merely a re-fit. For one already open it is still the
  // re-fit: every resize while it was hidden measured 0×0 and was refused.
  React.useEffect(() => {
    if (!active) return;
    remeasureRef.current?.();
  }, [active]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: focusToken is a pure trigger, its value is never read
  React.useEffect(() => {
    if (!active) return;
    termRef.current?.focus();
  }, [active, focusToken]);

  // One corner control, two backings: the counted notice where xterm owns the
  // history, the copy-mode notice where tmux does. They cannot both be
  // non-null — `behind` is 0 under tmux and `inCopyMode` false outside it.
  const notice = scrollbackNotice(behind) ?? copyModeNotice(inCopyMode);

  return (
    // `relative` so the scrollback control below can be positioned against
    // this box. It costs the layout nothing, and being *out of flow* is the
    // point: a control that took a row would change the container's height,
    // which under tmux is the same thing as resizing the owner's live session.
    // biome-ignore lint/a11y/noStaticElementInteractions: a drop target is not a control — the drag handlers add a second way in for pointer drags, and the keyboard path to the same act (typing into the shell) is the terminal itself
    <div
      className={`vingilot-term-ground relative min-h-0 min-w-0 flex-1 ${active ? "flex" : "hidden"}`}
      data-testid={`terminal-${sessionId}`}
      // A text drag from inside the webview (selected chat text, a path in
      // the Files pane) lands as keystrokes at the cursor — the HTML5 path,
      // which a native Finder drag never takes (`nativeDrop.ts`'s header: the
      // OS drag goes dark for the DOM). Each split half is its own target
      // because each renders its own Terminal.
      onDragOver={(event) => {
        if (cwd !== null && event.dataTransfer.types.includes("text/plain")) {
          event.preventDefault();
        }
      }}
      onDrop={(event) => {
        if (cwd === null) return;
        const text = event.dataTransfer.getData("text/plain");
        if (text === "") return;
        event.preventDefault();
        void ptyWrite(sessionId, text);
      }}
      ref={rootRef}
    >
      {/* The drop affordance: a quiet ring in the app's accent, drawn over the
       * pane only while a Finder file drag hovers it. `pointer-events-none` so
       * it never intercepts the hit-test that routes the drop — the position
       * still resolves to the terminal element underneath. Theme-correct
       * because `border-primary`/`bg-primary` are the app's own tokens, the
       * same accent every other drop target in the app uses. */}
      {isDropTarget && cwd !== null ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-20 rounded-md border-2 border-dashed border-primary/70 bg-primary/5"
          data-testid={`terminal-drop-target-${sessionId}`}
        />
      ) : null}
      {/* The element `terminalTheme` dresses to read the app's colours. Hidden
       * by its parent rather than by its own class, because its own class is
       * the thing being rewritten. */}
      <span aria-hidden="true" className="hidden">
        <span ref={probeRef} />
      </span>
      {cwd === null ? (
        <p className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          waiting for this worktree's checkout…
        </p>
      ) : (
        <>
          {/* `px-2 py-1`, and neither half is a taste decision to revisit.
           * The horizontal is load-bearing by arrangement: `paneModel.ts`'s
           * `TERMINAL_CHROME_PX` counts it when deriving the 80-column floor.
           * The vertical looks free and is not — rows are derived from the
           * measured height of this box, so taking 4px more off each edge
           * crosses a row boundary at about half of all pane heights, and a row
           * fewer is a `ptyResize`. Under tmux that is a SIGWINCH to the
           * owner's live session and a re-wrap of scrollback he has had since
           * before the app was restarted — the exact failure the header above
           * describes. Padding here is not free; it is measured in the owner's
           * shells. */}
          <div
            className="flex-1 overflow-hidden px-2 py-1"
            ref={containerRef}
            {...wheelOwnerProps}
          />
          {notice === null ? null : (
            <button
              aria-label={notice.detail}
              className="absolute bottom-3 right-4 z-10 rounded-full border border-border/60 bg-popover px-2 py-1 text-2xs text-muted-foreground shadow-md transition-colors hover:bg-muted hover:text-foreground"
              data-lines-behind={notice.behind}
              data-testid={`terminal-jump-to-bottom-${sessionId}`}
              onClick={() => {
                if (behind > 0) {
                  termRef.current?.scrollToBottom();
                  return;
                }
                // The tmux case: copy-mode's own cancel, and an optimistic
                // hide — the next poll re-shows it if tmux disagrees.
                setInCopyMode(false);
                void ptyCopyModeExit(sessionId);
              }}
              // Moving the view must not take the keyboard with it. xterm holds
              // focus on a helper textarea of its own, and a mousedown anywhere
              // else moves focus off it — so the owner who clicked this would
              // have had to click back into the terminal before his next
              // keystroke reached the shell. Refused at mousedown rather than
              // repaired at click: not stealing focus is a smaller act than
              // taking it and handing it back, and it leaves focus where it was
              // for an owner who was not typing into this terminal anyway.
              // Every other path that moves a terminal's view is explicit about
              // this too — `WorkSurface.tsx`'s ⌘`, ⌘T and ⌥⌘←/→ each bump
              // `focusToken` for the same reason.
              onMouseDown={(event) => event.preventDefault()}
              title={notice.detail}
              type="button"
            >
              {notice.label}
            </button>
          )}
          {termFind.open ? (
            <FindBar
              ariaLabel="find in this terminal's scrollback"
              find={termFind}
              hint={TERMINAL_FIND_HINT}
              testIdPrefix="terminal-find"
            />
          ) : null}
        </>
      )}
    </div>
  );
}
