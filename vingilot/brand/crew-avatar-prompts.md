# Crew avatar prompts

One prompt per crew member, plus the shared style block every prompt starts with.
Written for an image model (Midjourney / gpt-image / Ideogram); generate square,
export at 512×512 (the app renders avatars small — test legibility at 32px).

## The shared style block (paste before every prompt)

> Minimal flat vector emblem, single subject centered on a plain dark navy
> circular background (#101418), warm parchment-gold foreground (#E8D9B0) with
> one deep-teal accent (#0B7285), maritime instrument aesthetic — engraved ship
> fittings, not cartoons, no faces, no people, no text, no letters, thick
> confident linework readable at 32 pixels, consistent 2px stroke weight,
> subtle circular border ring like a ship's porthole.

The set must read as one family: same palette, same ring, same stroke. Generate
all five in one session if the tool supports style reference / seed reuse.

## Mate — the assistant, First Mate

> A ship's wheel with eight handles, drawn as if mid-turn: one handle catching
> the teal accent light, a small compass rose at the hub. The one object on the
> ship that touches everything.

*(Fallback if the wheel reads as "Navigator" to you: a bosun's call whistle
crossed with a spyglass — the one who is called and sees.)*

## Bosun — keeps the ship running

> A heavy forged shackle and a marlinspike crossed like tools on a workshop
> wall, a coil of rope behind them, teal accent on the spike's tip. Rigging
> hardware — the thing you reach for when something is jammed.

## Lookout — sees trouble first

> A crow's nest viewed from below against the ring, with a small four-pointed
> star (not a sun) just off-center above it, teal accent on the star. High,
> small, watching — nothing in its hands.

## Navigator — plots the course

> A pair of brass dividers (chart compass) standing open on a fragment of a
> rhumb-line chart, one needle point touching a plotted course line, teal
> accent along the plotted line. Precision instrument over a map, mid-work.

## Scribe — writes the log

> A quill resting across an open ship's logbook, pages slightly curved, a tiny
> anchor watermark on the visible page, teal accent on the quill's tip. The
> record, being kept.

## Where they land when you have them

- App expects square avatars; drop them in and set per-agent via the profile's
  avatar (or wire into the pack as `avatar_url` when we decide to ship them).
- The welcome kickoff banner (`WelcomeKickoffStage`) currently draws no
  characters — the bees' three APNGs left with them. These five (or animated
  variants of three of them) are what fills it.
- Keep the source files; the derive-mark pipeline (`vingilot/brand/`) can emit
  the sizes if we standardise later.
