import { VingilotMarkAnimation } from "./VingilotMarkAnimation";

/**
 * The landing hero: the mark sailing above the product's name.
 *
 * Replaces upstream's `/landing/buzz-wordmark.png`, and deliberately is not a
 * picture of a word. A raster wordmark is one fixed size, one fixed colour and
 * one fixed resolution; setting the name in the app's own type instead keeps it
 * sharp at any zoom, follows the theme through `currentColor` like every other
 * mark in this directory, and is readable by anything that reads text. There is
 * no second asset to keep in step with the first.
 *
 * The mark here is the *animated* one, not the static {@link VingilotMark}. The
 * screen it replaces was a field of thirty-eight flapping bees, and a landing
 * page that arrives completely still reads as a page that has not finished
 * loading. One ship carrying the motion is the honest translation of that: the
 * bees were a swarm because the product was a swarm, and this one is not.
 *
 * Sized in `rem`-derived Tailwind tokens rather than the fixed 600px the raster
 * needed, so the hero scales with the zoom shortcuts (see AGENTS.md on why px
 * text is frozen against ⌘+/-).
 */
export function VingilotWordmark() {
  return (
    <div className="flex flex-col items-center">
      <VingilotMarkAnimation className="w-28" />
      <p className="mt-4 text-7xl font-normal leading-none tracking-tight">
        Vingilot
      </p>
    </div>
  );
}
