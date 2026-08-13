import * as React from "react";

/**
 * Both assets are served from `public/`, not imported as modules.
 *
 * The mark animation next door ships its sprite sheet through Vite (`import
 * sheet from "./mark-animation.png"`) because it is a small image the component
 * needs a hashed URL for. A 15 MB video is the opposite case: routed through
 * the bundler it would be copied to `assets/` and hashed for no gain, while
 * sitting in the module graph. From `public/` it is copied verbatim, adds
 * nothing to any JS chunk, and is fetched with HTTP range requests the way a
 * video wants to be fetched.
 *
 * The poster is the loop's own first frame, and is also what
 * `--buzz-sea-still` paints as the shell's CSS background. That is what makes
 * the start seamless: the picture is already on screen before the video has
 * decoded anything, so the clip begins by moving rather than by appearing.
 */
const SEA_LOOP_SRC = "/onboarding/sea-backdrop-loop.mp4";
const SEA_POSTER_SRC = "/onboarding/sea-backdrop-poster.jpg";

/**
 * Whether this user has asked for reduced motion, kept current.
 *
 * Read as state rather than left to CSS because the requirement here is not
 * "don't animate" but "don't decode": a `<video>` that a media query has
 * hidden is still a video the compositor is decoding 24 times a second. The
 * only way to actually not pay for it is to not create the element, and that
 * is a rendering decision, which means it has to be in JS.
 *
 * Defaults to `true` when `matchMedia` is unavailable, so the cheap path is
 * also the fallback path.
 */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return true;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });

  React.useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  return reduced;
}

/**
 * The moving sea behind the big onboarding screens.
 *
 * Mount this only on screens that should move — it is the mounting that starts
 * the decode and the unmounting that stops it, so keeping it off the small
 * shells (the error, relaunch and keyring screens) is what keeps them free.
 * Every shell already shows the same sea as a CSS background; this only sets it
 * in motion.
 *
 * **It renders no video at all under `prefers-reduced-motion`.** In that case
 * this returns `null` and the shell's own background — the same frame, held
 * still — is the whole backdrop. Nothing is hidden with CSS, because a hidden
 * video still decodes.
 *
 * On the cost of the clip: it is h264 High / yuv420p, which is the profile
 * VideoToolbox decodes in hardware on every Mac the app ships to, so playback
 * costs GPU time rather than main-thread time and cannot stall React.
 *
 * It is also the re-encoded loop (1.4 MB at 783 kbps), not the 15 MB master —
 * same 1920x1080, same 24 fps, same 361 frames, and its first frame still
 * matches the poster (PSNR 33.9 dB), so nothing above is given up for the 10x.
 *
 * None of that is JS weight. Because these are `public/` files, the only thing
 * the bundle gains is the two path strings below; the media is copied to
 * `dist/onboarding/` byte for byte, with no hashed duplicate under
 * `dist/assets/`, and is fetched only when a screen that mounts this asks for
 * it. What it does cost is a first read from disk — which is why the poster is
 * declared: the still paints immediately, so a slow disk shows the sea rather
 * than a black rectangle.
 *
 * Always `aria-hidden`: it is scenery, and every screen behind it says what it
 * is in text.
 */
export function OnboardingSeaBackdrop() {
  const reduced = usePrefersReducedMotion();

  if (reduced) return null;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-0 overflow-hidden"
      data-testid="onboarding-sea-backdrop"
    >
      <video
        autoPlay
        className="h-full w-full object-cover"
        data-testid="onboarding-sea-video"
        loop
        muted
        playsInline
        poster={SEA_POSTER_SRC}
        preload="auto"
        src={SEA_LOOP_SRC}
        tabIndex={-1}
      />
      {/*
        The same scrim the shell applies to the still, so the copy reads the
        same whether the sea is moving or held. Kept as an element rather than
        folded into the video because a video element has no background stack to
        layer it into.
      */}
      <div
        className="absolute inset-0 bg-[var(--buzz-sea-scrim)]"
        data-testid="onboarding-sea-scrim"
      />
    </div>
  );
}
