/** The studio editor's tools, the same in both apps (the website's components/studio/markup.ts and the phone app's
 * editor): the clip tools (name, the engine's action), the tools' row (key, name, a plan's tool) and what each tool's
 * panel is for. */
export const SHOT_TOOLS_DEF: [string, string][] = [
  ["Transition", "tr"], ["Effect", "fx"], ["Speed", "sp"], ["Split", "split"], ["Duplicate", "dup"], ["Freeze", "freeze"], ["Other moment", "other"],
  ["Volume", "vol"], ["Extract audio", "extract"], ["Crop", "crop"], ["Reverse", "rev"], ["Rotate", "rot"], ["Mirror", "fh"], ["Flip", "fv"], ["Fit", "fit"],
  ["Canvas", "canvas"], ["Border", "border"], ["Adjust", "adjust"], ["Speed curve", "curve"], ["Stabilize", "stab"], ["Smooth slow-mo", "smooth"], ["Beauty", "beauty"], ["Fade", "fade"],
  ["Mosaic", "mosaic"], ["Magnifier", "lens"], ["Mask", "mask"], ["Chroma key", "chroma"], ["Curves", "curves"], ["HSL", "hsl"], ["Slip", "slip"], ["Trim", "trim"], ["Reset", "reset"], ["Delete", "delete"]
];

export const DOCK_CATEGORIES_DEF: [string, string, boolean][] = [
  ["media", "Media", false],
  ["stickers", "Stickers", false],
  ["look", "Filters", false],
  ["style", "Style", false],
  ["shots", "Shots", false],
  ["music", "Music", false],
  ["text", "Text", false],
  ["captions", "Captions", false],
  ["bg", "Background", true],
  ["layers", "Layers", true],
  ["voice", "Voice", true],
  ["motion", "Motion", true]
];

// what each tool's popup is for (the line under its name)
export const PANEL_NOTE: Record<string, string> = {
  media: "Add or change the clips and photos in your Reel.",
  style: "Choose how Shubix edits your Reel.",
  music: "Change the song, the part that plays and how loud it is.",
  text: "Add a hook, your own text and stickers to your Reel.",
  captions: "Show the spoken words on screen, word by word.",
  look: "Pick a filter and the colours of your Reel.",
  bg: "Choose what fills the frame behind your clips.",
  layers: "Put pictures and videos over your Reel.",
  voice: "Record or make a voiceover for your Reel.",
  motion: "Add camera moves and motion to your shots.",
};
