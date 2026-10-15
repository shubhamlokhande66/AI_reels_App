# "Copy a Reel" benchmark (Fast Studio)

`make_refs.py` writes four reference Reels with known style into `out/` (every cut on a known beat of a known song, a
known transition at each cut, a known colour grade, known zooms) and `out/truth.json`:

| Reel | pace | transitions | look |
|---|---|---|---|
| fast_flash | a cut on every beat | 70% hard, 30% white flash | contrast 1.3, saturation 1.4, warm |
| calm_dissolve | every 4 beats | dissolves | desaturated, teal-orange, lifted blacks, vignette |
| mono_fade | every 2 beats | half fades through black | black and white, grain |
| whip_zoom | 2, 2, 1, 1 beats | whip pans and zoom-throughs | natural, zoom-ins inside half the shots |

- `check-analysis.cjs`: reads each Reel through the studio and scores the cuts, transition types, pace, zooms and look.
- `check-apply.cjs`: copies each style onto an edit and compares the edit's pace, transition mix, zooms and its rendered
  colours with the reference.

Results (headless Chromium): cuts found 96-100% (78 cuts), transition type right 99-100%, cut time error ~15-20 ms,
pace (beats per shot) 4/4, zoomed shots 50% (truth 52%), no false zooms; reading an 18 s Reel takes 17-28 s. Applied:
same pace, transition shares within a few percent (calm: 100% dissolves), and the rendered look matched to the
reference on the measured frames (saturation, warmth, contrast, brightness within ~0.01-0.05).
