# CapCut vs Shubix: feature list

This list measures how close Shubix is to CapCut's public editing features (the goal is "90%"). It counts only what a
person can do. Shubix has its own versions of these features; no CapCut code is used. Each row says whether Shubix has it
on the **website (W)**, on the **Android app (A)** and whether **Shubix AI** can use it.

Status: ✅ has it · 🟡 partly · ❌ missing · — not wanted. Updated 2026-11-03 (branch `fix/ai-final-tabs`).

## Score

| | Features | ✅ | 🟡 | ❌ |
|---|---|---|---|---|
| All rows below (not counting "not wanted") | 71 | 56 | 9 | 6 |

Counting 🟡 as half: **(56 + 4.5) / 71 = 85%**. The six ❌ rows need a paid service or a licence (see "Needs a decision"). With
those six left out, the score is **60.5 / 65 = 93%**.

A row is ✅ only when every column that applies is ✅.

## Editing

| Feature | W | A | AI | Notes |
|---|---|---|---|---|
| Auto edit to the beat | ✅ | ✅ | ✅ | Shubix's main job |
| Split, duplicate, delete, freeze frame | ✅ | ✅ | ✅ | |
| Reverse | ✅ | ✅ | ✅ | |
| Trim, slip | ✅ | ✅ | — | on the beat grid |
| Reorder shots | ✅ | ✅ | ✅ | |
| Speed (fixed) | ✅ | ✅ | ✅ | |
| Speed curve | ✅ | ✅ | ✅ | |
| Smooth slow motion | ✅ | ✅ | ✅ | frames blended |
| Crop, zoom, framing | ✅ | ✅ | ✅ | follows the face on its own |
| Rotate, mirror, flip | ✅ | ✅ | ✅ | |
| Stabilize | ✅ | ✅ | ✅ | |
| Keyframes on position, scale, turn, opacity | ✅ | 🟡 | ✅ | the phone can add / remove keys, not drag positions |
| Keyframes on colour, volume, mask | ✅ | ✅ | ✅ | |
| Multi-track timeline | — | — | — | not wanted: Shubix makes the Reel itself |
| Undo / redo | ✅ | ✅ | — | |

## Picture

| Feature | W | A | AI | Notes |
|---|---|---|---|---|
| Filters / looks | ✅ | ✅ | ✅ | 24 |
| Adjust (brightness, contrast, saturation, warmth, highlights, shadows, hue, sharpen, vignette) | ✅ | ✅ | ✅ | |
| Curves | ✅ | ✅ | ✅ | |
| HSL | ✅ | 🟡 | ✅ | the phone has ready-made HSL looks, no per-band sliders |
| Effects | ✅ | ✅ | ✅ | 39, including 3D zoom |
| 3D photo zoom | 🟡 | 🟡 | ✅ | depth is guessed from the picture, not measured |
| Transitions | ✅ | ✅ | ✅ | 44 |
| Mask (6 shapes, invert, soft edge) | ✅ | ✅ | ✅ | |
| Chroma key / green screen | ✅ | ✅ | ✅ | |
| Remove / replace background (person) | ✅ | ✅ | ✅ | |
| Beauty / smooth skin | ✅ | ✅ | ✅ | |
| Mosaic / blur a region | ✅ | ✅ | — | |
| Magnifier | ✅ | ✅ | — | |
| Blend modes | ✅ | 🟡 | ✅ | on the boxes; the phone sets them through Shubix AI |
| Picture in picture / video boxes | ✅ | ✅ | ✅ | |
| Split screen / grids | ✅ | 🟡 | ✅ | the phone builds grids through Shubix AI |
| Fade in / out | ✅ | ✅ | ✅ | also on every shot at once |

## Text and stickers

| Feature | W | A | AI | Notes |
|---|---|---|---|---|
| Text with fonts, colours, sizes | ✅ | ✅ | ✅ | 18 fonts, Devanagari too |
| Text styles | ✅ | ✅ | ✅ | 11 |
| Text entrances, exits, loops | ✅ | ✅ | ✅ | |
| Text templates | ✅ | ✅ | ✅ | 16 |
| Text keyframes | ✅ | 🟡 | ✅ | the phone can't drag text keys |
| Video in letters | ✅ | ✅ | ✅ | |
| Text behind the person | ✅ | ✅ | ✅ | |
| Text follows the person | ✅ | ✅ | ✅ | |
| Auto captions | ✅ | ✅ | ✅ | |
| Caption translation | ✅ | ✅ | ✅ | |
| Emoji stickers | ✅ | ✅ | ✅ | |
| Shapes | ✅ | ✅ | ✅ | |
| Animated GIF stickers library | ❌ | ❌ | ❌ | needs a GIPHY / Tenor key |
| Text to speech | ✅ | ✅ | ✅ | |

## Sound

| Feature | W | A | AI | Notes |
|---|---|---|---|---|
| Add music | ✅ | ✅ | ✅ | the creator's own songs |
| Music library | ❌ | ❌ | ❌ | needs a licence |
| Beat detection | ✅ | ✅ | ✅ | |
| Own beat markers | ✅ | ✅ | ✅ | add, remove one, remove all |
| Volume per shot | ✅ | ✅ | ✅ | |
| Fade music in / out | ✅ | ✅ | ✅ | |
| Duck music under voices | ✅ | ✅ | ✅ | |
| Extract audio | ✅ | ✅ | — | |
| Voice effects | ✅ | ✅ | ✅ | 7 |
| Voice enhance | ✅ | ✅ | ✅ | |
| Noise reduction | ✅ | ✅ | — | |
| Pitch | ✅ | 🟡 | ✅ | the phone changes it only through Shubix AI |
| Record a voiceover | ✅ | ✅ | — | |
| Sound effects | 🟡 | 🟡 | ✅ | 16 made in the app; no recorded sound library |
| Sound effects library | ❌ | ❌ | ❌ | needs a licence |
| AI voices / voice cloning | ❌ | ❌ | ❌ | needs a paid voice service |

## Canvas and export

| Feature | W | A | AI | Notes |
|---|---|---|---|---|
| Formats | ✅ | ✅ | — | 9:16, 4:5, 1:1, 16:9, 3:4, 4:3, 2:1, 2.35:1 |
| Canvas colour / blur | ✅ | ✅ | ✅ | |
| Canvas patterns | ✅ | ✅ | ✅ | 5 |
| Border | ✅ | ✅ | ✅ | |
| Export up to 4K | ✅ | ✅ | — | 4K where the device can encode it |
| Live preview with every effect | ✅ | 🟡 | — | the phone shows the full look only when paused and in the export |

## AI tools

| Feature | W | A | AI | Notes |
|---|---|---|---|---|
| Edit by chat ("Ask Shubix") | ✅ | ✅ | ✅ | |
| Copy a Reel's style | ✅ | ✅ | ✅ | |
| Object removal | ❌ | ❌ | ❌ | needs a server AI model |
| Picture extend, image generation | ❌ | ❌ | ❌ | needs a server AI model (counted as one row) |

## Needs a decision

These features are not built, because each one needs a paid service or a licence:

- GIF sticker library (GIPHY or Tenor key)
- Music library
- Recorded sound effects library
- AI voices and voice cloning
- Server AI tools (object removal, picture extend, photo background removal, image generation, auto best moments)

## Still to do (free to build)

- Live preview on the phone with the studio's full look while it plays
- On the phone: drag keyframe positions; per-band HSL sliders
