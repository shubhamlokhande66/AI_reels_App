/**
 * Shubix shared editing intelligence.
 *
 * Platform-neutral edit decisions and animation primitives. Both the browser studio and
 * the native editor consume the same plan; renderers remain platform-specific.
 */
export type Easing = "linear" | "lin" | "ease-in" | "ease-out" | "ease-in-out" | "inOut" | "inQuad" | "outCubic" | "outExpo" | "outBack" | "hold" | "bezier";
export type KeyframeValue = number | string | boolean;
export type Keyframe<T extends KeyframeValue = KeyframeValue> = {
  id: string; time: number; value: T; easing: Easing; inTangent?: number; outTangent?: number;
  /** Cubic-bezier control points [x1, y1, x2, y2], used when easing is `bezier`. */
  bezier?: [number, number, number, number];
};
export type AnimatedProperty = "x" | "y" | "scale" | "scaleX" | "scaleY" | "rotation" |
  "opacity" | "blur" | "brightness" | "contrast" | "saturation" | "temperature" |
  "volume" | "cropX" | "cropY" | "cropWidth" | "cropHeight";
export type TransformTrack = { property: AnimatedProperty; keyframes: Keyframe<number>[] };
export type MaskKind = "rectangle" | "ellipse" | "linear" | "radial" | "freehand" | "person" | "luma" | "text";
export type MaskDefinition = {
  id: string; kind: MaskKind; inverted: boolean; feather: number; expansion: number;
  points?: Array<{ x: number; y: number }>; tracking?: "none" | "face" | "person" | "object";
};
export type EffectDefinition = {
  id: string; category: "color" | "cinematic" | "motion" | "distortion" | "light" | "beauty" | "audio";
  label: string; intensity: number; gpuCost: "low" | "medium" | "high";
  mobileSafe: boolean; params: Record<string, number | string | boolean>;
};
export type TransitionDefinition = {
  id: string; category: "basic" | "movement" | "stylized" | "cinematic";
  label: string; duration: number; mobileSafe: boolean; beatFriendly: boolean;
  params?: Record<string, number | string | boolean>;
};

export const EFFECT_LIBRARY: readonly EffectDefinition[] = [
  { id:"exposure",category:"color",label:"Exposure",intensity:0,gpuCost:"low",mobileSafe:true,params:{exposure:0} },
  { id:"contrast",category:"color",label:"Contrast",intensity:0.12,gpuCost:"low",mobileSafe:true,params:{contrast:1.12} },
  { id:"saturation",category:"color",label:"Saturation",intensity:0.08,gpuCost:"low",mobileSafe:true,params:{saturation:1.08} },
  { id:"temperature",category:"color",label:"Temperature",intensity:0,gpuCost:"low",mobileSafe:true,params:{temperature:0} },
  { id:"hsl",category:"color",label:"HSL",intensity:0,gpuCost:"medium",mobileSafe:true,params:{hue:0,saturation:0,lightness:0} },
  { id:"curves",category:"color",label:"RGB Curves",intensity:0,gpuCost:"medium",mobileSafe:true,params:{lift:0,gamma:1,gain:1} },
  { id:"lut",category:"color",label:"3D LUT",intensity:0.25,gpuCost:"medium",mobileSafe:true,params:{mix:0.25} },
  { id:"vignette",category:"cinematic",label:"Vignette",intensity:0.18,gpuCost:"low",mobileSafe:true,params:{amount:0.18,feather:0.75} },
  { id:"grain",category:"cinematic",label:"Film Grain",intensity:0.12,gpuCost:"medium",mobileSafe:true,params:{amount:0.12,size:0.35} },
  { id:"glow",category:"light",label:"Bloom / Glow",intensity:0.16,gpuCost:"high",mobileSafe:false,params:{threshold:0.78,radius:0.45,mix:0.16} },
  { id:"light-leak",category:"light",label:"Light Leak",intensity:0.2,gpuCost:"medium",mobileSafe:true,params:{mix:0.2,angle:35} },
  { id:"chromatic-aberration",category:"distortion",label:"Chromatic Aberration",intensity:0.08,gpuCost:"medium",mobileSafe:true,params:{amount:0.08} },
  { id:"rgb-split",category:"distortion",label:"RGB Split",intensity:0.12,gpuCost:"medium",mobileSafe:true,params:{offset:2} },
  { id:"glitch",category:"distortion",label:"Glitch",intensity:0.2,gpuCost:"high",mobileSafe:false,params:{amount:0.2,frequency:0.35} },
  { id:"blur",category:"motion",label:"Gaussian Blur",intensity:0,gpuCost:"medium",mobileSafe:true,params:{radius:0} },
  { id:"directional-blur",category:"motion",label:"Directional Blur",intensity:0.15,gpuCost:"high",mobileSafe:false,params:{angle:0,radius:0.15} },
  { id:"sharpen",category:"cinematic",label:"Sharpen",intensity:0.12,gpuCost:"medium",mobileSafe:true,params:{amount:0.12} },
  { id:"motion-blur",category:"motion",label:"Motion Blur",intensity:0.18,gpuCost:"high",mobileSafe:false,params:{shutter:0.18} },
  { id:"speed-ramp",category:"motion",label:"Speed Ramp",intensity:0.35,gpuCost:"medium",mobileSafe:true,params:{curve:"ease-in-out",min:0.5,max:2.5} },
  { id:"stabilize",category:"motion",label:"Stabilization",intensity:0.4,gpuCost:"high",mobileSafe:false,params:{strength:0.4,crop:0.08} },
  { id:"skin-soften",category:"beauty",label:"Skin Softening",intensity:0.12,gpuCost:"high",mobileSafe:false,params:{amount:0.12,preserveDetail:0.9} },
  { id:"background-blur",category:"beauty",label:"Portrait Background Blur",intensity:0.3,gpuCost:"high",mobileSafe:false,params:{radius:0.3,edgeFeather:0.2} },
  { id:"drift",category:"cinematic",label:"Ken Burns Drift",intensity:0.18,gpuCost:"low",mobileSafe:true,params:{zoom:1.07,pan:0.03} },
  { id:"punch-soft",category:"motion",label:"Soft Zoom",intensity:0.12,gpuCost:"low",mobileSafe:true,params:{zoom:1.07,duration:0.3} },
  { id:"zoomburst",category:"motion",label:"Zoom Burst",intensity:0.3,gpuCost:"medium",mobileSafe:true,params:{zoom:1.32,rgb:16} },
] as const;

export const TRANSITION_LIBRARY: readonly TransitionDefinition[] = [
  {id:"hard",category:"basic",label:"Hard Cut",duration:0,mobileSafe:true,beatFriendly:true},
  {id:"dissolve",category:"basic",label:"Cross Dissolve",duration:0.35,mobileSafe:true,beatFriendly:false},
  {id:"dip",category:"basic",label:"Fade Through Black",duration:0.45,mobileSafe:true,beatFriendly:false},
  {id:"flash",category:"basic",label:"Flash White",duration:0.22,mobileSafe:true,beatFriendly:true},
  {id:"slideleft",category:"movement",label:"Push Left",duration:0.32,mobileSafe:true,beatFriendly:true},
  {id:"slideright",category:"movement",label:"Push Right",duration:0.32,mobileSafe:true,beatFriendly:true},
  {id:"slideup",category:"movement",label:"Slide Up",duration:0.32,mobileSafe:true,beatFriendly:true},
  {id:"zoom",category:"movement",label:"Zoom In",duration:0.3,mobileSafe:true,beatFriendly:true},
  {id:"zoomout",category:"movement",label:"Zoom Out",duration:0.3,mobileSafe:true,beatFriendly:true},
  {id:"whip",category:"movement",label:"Whip Pan",duration:0.24,mobileSafe:false,beatFriendly:true},
  {id:"spin",category:"stylized",label:"Spin",duration:0.42,mobileSafe:true,beatFriendly:true},
  {id:"glitch",category:"stylized",label:"Digital Glitch",duration:0.18,mobileSafe:false,beatFriendly:true},
  {id:"glitch-rgb",category:"stylized",label:"RGB Wipe",duration:0.25,mobileSafe:false,beatFriendly:true},
  {id:"light-leak",category:"cinematic",label:"Light Leak",duration:0.5,mobileSafe:true,beatFriendly:false},
  {id:"burn",category:"cinematic",label:"Film Burn",duration:0.55,mobileSafe:false,beatFriendly:false},
  {id:"luma",category:"cinematic",label:"Luma Wipe",duration:0.4,mobileSafe:false,beatFriendly:true},
  {id:"iris",category:"cinematic",label:"Mask Reveal",duration:0.45,mobileSafe:false,beatFriendly:false},
  {id:"bars",category:"stylized",label:"Bars Wipe",duration:0.26,mobileSafe:true,beatFriendly:true},
  {id:"diamond",category:"stylized",label:"Diamond Wipe",duration:0.36,mobileSafe:true,beatFriendly:true},
  {id:"heart",category:"stylized",label:"Heart Wipe",duration:0.42,mobileSafe:true,beatFriendly:true},
  {id:"star",category:"stylized",label:"Star Wipe",duration:0.4,mobileSafe:true,beatFriendly:true},
] as const;

export type ShotAnalysis = {
  id: string; sourceIndex: number; duration: number; quality: number; motion: number;
  faceScore?: number; subjectScore?: number; speech?: boolean; sceneChange?: boolean;
  isHighlight?: boolean; isProduct?: boolean; isFood?: boolean; isLandscape?: boolean;
};
export type DirectorInput = {
  shots: ShotAnalysis[]; beats?: number[]; drops?: number[]; quietRanges?: Array<[number,number]>;
  targetDuration?: number; aspect?: "9:16"|"4:5"|"1:1"|"16:9";
  mood?: "cinematic"|"energetic"|"minimal"|"story"|"product"|"travel"|"food";
  mobile?: boolean; intensity?: "subtle"|"balanced"|"bold";
};
export type DirectedShot = {
  sourceId: string; sourceIndex: number; trimStart: number; trimEnd: number; timelineStart: number;
  duration: number; transition: string; effects: string[]; speed: number;
  keyframes: TransformTrack[]; role: "hook" | "hero" | "detail" | "bridge" | "ending"; reason: string;
};
export type DirectorPlan = {
  version: 1; duration: number; aspect: string; mood: string; soundtrack: { beatSync: boolean; cutPoints: number[] };
  shots: DirectedShot[]; globalLook: string[]; notes: string[];
};

const clamp=(n:number,min:number,max:number)=>Math.min(max,Math.max(min,n));
const nearest=(t:number,points:number[],window=0.22)=>points.reduce((best,p)=>Math.abs(p-t)<Math.abs(best-t)?p:best,t);
function motionTrack(duration:number,zoom:number,pan:number):TransformTrack[] {
  return [
    {property:"scale",keyframes:[{id:"kf-in",time:0,value:1,easing:"ease-out"},{id:"kf-out",time:duration,value:zoom,easing:"ease-in-out"}]},
    {property:"x",keyframes:[{id:"pan-in",time:0,value:0,easing:"ease-in-out"},{id:"pan-out",time:duration,value:pan,easing:"ease-in-out"}]},
  ];
}

/**
 * Creates an explainable first-pass edit. It favours good footage, protects speech,
 * uses restrained transitions, aligns cuts to nearby beats and reserves stronger motion
 * for drops/highlights. This is a decision plan, not a renderer; the platform engine applies it.
 */
export function createDirectorPlan(input: DirectorInput): DirectorPlan {
  const mood=input.mood??"cinematic", intensity=input.intensity??"balanced", mobile=input.mobile??false;
  const beats=[...(input.beats??[])].filter(Number.isFinite).sort((a,b)=>a-b);
  const drops=[...(input.drops??[])].filter(Number.isFinite);
  const ranked=input.shots.filter(s=>s.duration>0).map(s=>({...s,
    score:clamp(s.quality*0.34+(s.subjectScore??0.5)*0.24+(s.faceScore??0.5)*0.1+
      s.motion*0.12+(s.isHighlight?0.16:0)+(s.sceneChange?0.04:0)+
      ((mood==="product" && s.isProduct)||(mood==="food" && s.isFood)?0.12:0)-
      (s.speech && mood!=="story"?0.1:0),0,1)
  })).sort((a,b)=>b.score-a.score);
  const target=clamp(input.targetDuration??Math.min(30,input.shots.reduce((n,s)=>n+s.duration,0)),5,180);
  const pace=mood==="energetic"?1.25:mood==="story"||mood==="product"?0.82:1;
  const ideal=clamp(target/Math.max(1,Math.ceil(target/(3.2/pace))),0.8,5.5);
  const chosen: Array<(typeof ranked)[number] & { duration: number }> = [];
  let used=0;
  for(const s of ranked){
    if(used>=target)break;
    const d=Math.min(s.duration,ideal,target-used);
    if(d>=0.45){chosen.push({...s,duration:d});used+=d;}
  }
  if(!chosen.length && ranked.length) { const s=ranked[0]; chosen.push({...s,duration:Math.min(s.duration,target)}); used=chosen[0].duration; }
  const planShots:DirectedShot[]=[];
  let cursor=0;
  for(let i=0;i<chosen.length;i++){
    const s=chosen[i], raw=cursor+s.duration, beat=beats.length?nearest(raw,beats):raw;
    const cut=beats.length && Math.abs(beat-raw)<0.22?beat:raw;
    const d=Math.max(0.45,Math.min(s.duration,cut-cursor));
    const drop=drops.some(t=>Math.abs(t-cursor)<0.5);
    const quiet=(input.quietRanges??[]).some(([a,b])=>cursor>=a && cursor<=b);
    const highlight=!!s.isHighlight||s.score>0.82;
    const transition= i===0?"hard":quiet?(mood==="minimal"?"hard":"dissolve"):
      (drop&&intensity!=="subtle"?"flash":
      mood==="minimal"||mood==="story"?"dissolve":
      highlight&&intensity==="bold"?"whip": "hard");
    const effects:string[]=[];
    // Use renderer identifiers that Fast Studio and the native preview already understand.
    if(mood==="cinematic"||mood==="travel")effects.push("drift");
    if(mood==="product"||mood==="food"||s.isProduct||s.isFood)effects.push("punch-soft");
    if(drop&&intensity!=="subtle"&&!quiet)effects.push("zoomburst");
    if(s.speech){ for(let j=effects.length-1;j>=0;j--)if(["zoomburst","shake","hook"].includes(effects[j]))effects.splice(j,1); }
    if(mobile){for(let j=effects.length-1;j>=0;j--)if(!EFFECT_LIBRARY.find(e=>e.id===effects[j])?.mobileSafe)effects.splice(j,1);}
    const role: DirectedShot["role"] = i===0?"hook":i===chosen.length-1?"ending":highlight?"hero":(s.isFood||s.isProduct)?"detail":s.motion>0.7?"bridge":"detail";
    const zoom=s.speech?1.025:highlight?1.09:1.045, pan=(i%2===0?1:-1)*(highlight?0.03:0.015);
    planShots.push({sourceId:s.id,sourceIndex:s.sourceIndex,trimStart:0,trimEnd:d,timelineStart:cursor,duration:d,
      transition,effects,speed:drop&&intensity!=="subtle"&&!quiet?1.15:1,keyframes:motionTrack(d,zoom,pan),role,
      reason:s.speech?"Protected spoken moment":role==="hook"?"Opening hook selected from strongest footage":role==="hero"?"High visual quality / highlight":quiet?"Calmer moment: restrained transition":role==="detail"?"Product / food detail": "Best available subject and motion"});
    cursor+=d;
  }
  const notes:string[]=[];
  if(!beats.length)notes.push("No beat grid supplied: cuts use visual pacing until music analysis is available.");
  if(planShots.length<2)notes.push("Add more usable footage for a varied sequence.");
  if(mobile)notes.push("Mobile-safe effect subset selected to protect preview and export performance.");
  return {version:1,duration:cursor,aspect:input.aspect??"9:16",mood,
    soundtrack:{beatSync:beats.length>0,cutPoints:planShots.slice(1).map(s=>s.timelineStart)},
    shots:planShots,globalLook:mood==="cinematic"?["contrast","vignette"]:mood==="product"?["contrast","sharpen"]:[],
    notes};
}

/** Evaluate a numeric keyframe track at timeline time. */
export type TransformKeyframe = { t: number; x: number; y: number; s: number; r: number; o: number; ez?: string; bezier?: [number, number, number, number] };

/** Evaluate the compact transform keyframes stored by Fast Studio and shared Reel projects. */
export function evaluateTransformKeyframes(frames: TransformKeyframe[], time: number) {
  const read = (property: "x" | "y" | "s" | "r" | "o", fallback: number) => {
    if (!frames.length) return fallback;
    return evaluateKeyframes(frames.map((frame, index) => ({
      id: String(index), time: frame.t, value: frame[property],
      easing: (frame.ez || "inOut") as Easing,
      bezier: frame.bezier,
    })), time);
  };
  return { x: read("x", 0), y: read("y", 0), s: read("s", 1), r: read("r", 0), o: read("o", 1) };
}

function cubicBezierAt(t: number, p1: number, p2: number): number {
  const u = 1 - t;
  return 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t;
}

/** Solve CSS-style cubic-bezier timing curves without browser APIs (shared by Web and Android). */
export function cubicBezierProgress(x: number, curve: [number, number, number, number]): number {
  const [rawX1, y1, rawX2, y2] = curve;
  const x1 = clamp(rawX1, 0, 1), x2 = clamp(rawX2, 0, 1), target = clamp(x, 0, 1);
  let lo = 0, hi = 1, t = target;
  // Bisection is stable for flat tangents and is inexpensive for editor frame evaluation.
  for (let i = 0; i < 18; i++) {
    const at = cubicBezierAt(t, x1, x2);
    if (Math.abs(at - target) < 1e-5) break;
    if (at < target) lo = t; else hi = t;
    t = (lo + hi) / 2;
  }
  return cubicBezierAt(t, y1, y2);
}

/** Stable, sorted keyframes with duplicate timestamps collapsed (last keyframe wins). */
export function normaliseKeyframes<T extends KeyframeValue>(frames: Keyframe<T>[], minGap = 0.001): Keyframe<T>[] {
  const sorted = frames.filter((frame) => Number.isFinite(frame.time) && (typeof frame.value !== "number" || Number.isFinite(frame.value)))
    .map((frame) => ({ ...frame })).sort((a, b) => a.time - b.time);
  const result: Keyframe<T>[] = [];
  for (const frame of sorted) {
    const last = result[result.length - 1];
    if (last && Math.abs(frame.time - last.time) < minGap) result[result.length - 1] = frame;
    else result.push(frame);
  }
  return result;
}

/** Insert or replace a keyframe at the same timestamp while keeping the track ordered. */
export function upsertKeyframe<T extends KeyframeValue>(frames: Keyframe<T>[], frame: Keyframe<T>, tolerance = 0.001): Keyframe<T>[] {
  const next = normaliseKeyframes(frames.filter((item) => Math.abs(item.time - frame.time) >= tolerance));
  next.push({ ...frame });
  return normaliseKeyframes(next, tolerance);
}

/** Shift a copied keyframe group while preserving relative timing and non-negative positions. */
export function shiftKeyframes<T extends KeyframeValue>(frames: Keyframe<T>[], offset: number): Keyframe<T>[] {
  if (!Number.isFinite(offset)) return normaliseKeyframes(frames);
  const minTime = frames.length ? Math.min(...frames.map((frame) => frame.time)) : 0;
  const shift = Math.max(-minTime, offset);
  return normaliseKeyframes(frames.map((frame) => ({ ...frame, time: frame.time + shift })));
}

export function evaluateKeyframes(frames: Keyframe<number>[], time: number): number {
  if(!frames.length)return 0;
  const sorted=normaliseKeyframes(frames);
  if(!sorted.length)return 0;
  if(time<=sorted[0].time)return sorted[0].value;
  if(time>=sorted[sorted.length-1].time)return sorted[sorted.length-1].value;
  let i=0;while(i<sorted.length-1&&sorted[i+1].time<time)i++;
  const a=sorted[i],b=sorted[i+1],span=Math.max(0.000001,b.time-a.time);
  let t=clamp((time-a.time)/span,0,1);
  if(b.easing==="hold")return a.value;
  if(b.easing==="ease-in" || b.easing==="inQuad")t=t*t;
  else if(b.easing==="ease-out")t=1-(1-t)*(1-t);
  else if(b.easing==="ease-in-out" || b.easing==="inOut")t=t<0.5?2*t*t:1-Math.pow(-2*t+2,2)/2;
  else if(b.easing==="outCubic")t=1-Math.pow(1-t,3);
  else if(b.easing==="outExpo")t=t>=1?1:1-Math.pow(2,-10*t);
  else if(b.easing==="outBack"){const c1=1.70158,c3=c1+1;t=1+c3*Math.pow(t-1,3)+c1*Math.pow(t-1,2);}
  else if(b.easing==="bezier")t=cubicBezierProgress(t,b.bezier??[0.25,0.1,0.25,1]);
  return a.value+(b.value-a.value)*t;
}

export const MASK_LIBRARY: readonly MaskKind[] = ["rectangle","ellipse","linear","radial","freehand","person","luma","text"];
export const BLEND_MODES = ["normal","multiply","screen","overlay","soft-light","hard-light","color-dodge","color-burn","difference","exclusion","hue","saturation","color","luminosity"] as const;
export const AUDIO_TOOLS = ["volume","fade-in","fade-out","ducking","voice-isolation","noise-reduction","compressor","limiter","equalizer","reverb","delay","stereo-width","beat-sync"] as const;
export const TEXT_TOOLS = ["font","weight","tracking","leading","fill","gradient","stroke","shadow","background","highlight","reveal","typewriter","karaoke","tracking-follow","safe-area"] as const;


export type AudioEnvelope = { volume?: number; duration: number; fadeIn?: number; fadeOut?: number };

/** Evaluate a deterministic music gain envelope at a timeline position (seconds). */
export function evaluateAudioGain(time: number, envelope: AudioEnvelope): number {
  const duration = Math.max(0, Number.isFinite(envelope.duration) ? envelope.duration : 0);
  const position = clamp(Number.isFinite(time) ? time : 0, 0, duration);
  const volume = clamp(envelope.volume ?? 1, 0, 1);
  const fadeIn = Math.max(0, envelope.fadeIn ?? 0);
  const fadeOut = Math.max(0, envelope.fadeOut ?? 0);
  const inGain = fadeIn > 0 ? clamp(position / fadeIn, 0, 1) : 1;
  const outGain = fadeOut > 0 ? clamp((duration - position) / fadeOut, 0, 1) : 1;
  return volume * Math.min(inGain, outGain);
}


/**
 * Product-facing editor tool catalogue.
 *
 * This is deliberately separate from EFFECT_LIBRARY: a tool may be discoverable in
 * the product catalogue before every renderer supports it. UI must call
 * resolveEditorToolAvailability() and never present an unavailable tool as export-ready.
 */
export type EditorPlatform = "web" | "android";
export type EditorToolStatus = "ready" | "studio-only" | "preview-only" | "planned";
export type EditorToolCategory =
  | "clip" | "timeline" | "transform" | "keyframe" | "speed" | "color" | "effect"
  | "transition" | "mask" | "layer" | "text" | "caption" | "audio" | "ai" | "export";
export type EditorToolDefinition = {
  id: string;
  label: string;
  category: EditorToolCategory;
  tier: "basic" | "advanced" | "pro" | "trending";
  status: EditorToolStatus;
  platforms: readonly EditorPlatform[];
  /** Human-readable renderer boundary; never infer support from platform alone. */
  renderer: "shared" | "studio" | "media3" | "webgl" | "webcodecs" | "analysis";
  description: string;
  tags?: readonly string[];
};

const tool = (
  id: string, label: string, category: EditorToolCategory, tier: EditorToolDefinition["tier"],
  status: EditorToolStatus, platforms: readonly EditorPlatform[],
  renderer: EditorToolDefinition["renderer"], description: string, tags: readonly string[] = [],
): EditorToolDefinition => ({ id, label, category, tier, status, platforms, renderer, description, tags });

/**
 * Complete discoverability catalogue for the editor. "planned" and "preview-only"
 * entries are intentionally gated until a renderer can preview AND export them.
 */
export const EDITOR_TOOL_CATALOG: readonly EditorToolDefinition[] = [
  // Clip basics
  tool("trim", "Trim", "clip", "basic", "ready", ["web","android"], "shared", "Set source in and out points"),
  tool("split", "Split", "clip", "basic", "ready", ["web","android"], "shared", "Split a clip at the playhead"),
  tool("crop", "Crop", "clip", "basic", "ready", ["web","android"], "shared", "Crop the visible source frame"),
  tool("rotate", "Rotate", "transform", "basic", "ready", ["web","android"], "shared", "Rotate by quarter turns or custom angle"),
  tool("flip", "Flip", "transform", "basic", "ready", ["web","android"], "shared", "Mirror horizontally or vertically"),
  tool("duplicate", "Duplicate", "clip", "basic", "ready", ["web","android"], "shared", "Duplicate a clip or overlay"),
  tool("freeze-frame", "Freeze Frame", "clip", "advanced", "planned", ["web","android"], "shared", "Hold a selected source frame"),
  tool("reverse", "Reverse", "clip", "advanced", "planned", ["web","android"], "shared", "Reverse clip playback"),
  tool("extract-audio", "Extract Audio", "clip", "advanced", "studio-only", ["web","android"], "studio", "Create an audio track from source video"),
  tool("replace-clip", "Replace Clip", "clip", "basic", "ready", ["web","android"], "shared", "Replace media while preserving edit timing"),

  // Timeline and layers
  tool("multi-track", "Multi-track Timeline", "timeline", "pro", "studio-only", ["web","android"], "studio", "Arrange video, audio, text and overlay tracks"),
  tool("magnetic-snap", "Magnetic Snap", "timeline", "advanced", "ready", ["web","android"], "shared", "Snap edits to clips, markers and beats"),
  tool("timeline-zoom", "Timeline Zoom", "timeline", "basic", "ready", ["web","android"], "shared", "Zoom and navigate frame-level timeline positions"),
  tool("ripple-edit", "Ripple Edit", "timeline", "advanced", "planned", ["web","android"], "shared", "Close gaps while preserving downstream timing"),
  tool("slip-edit", "Slip Edit", "timeline", "pro", "planned", ["web","android"], "shared", "Change source range without moving timeline placement"),
  tool("track-lock", "Track Lock", "layer", "advanced", "planned", ["web","android"], "shared", "Lock a track against accidental edits"),
  tool("group-layers", "Group Layers", "layer", "pro", "planned", ["web","android"], "shared", "Group and transform multiple overlays"),
  tool("blend-modes", "Blend Modes", "layer", "pro", "studio-only", ["web","android"], "studio", "Screen, multiply, overlay, soft-light and related compositing"),
  tool("opacity", "Layer Opacity", "layer", "advanced", "studio-only", ["web","android"], "studio", "Animate overlay transparency"),

  // Motion and keyframes
  tool("keyframes-transform", "Transform Keyframes", "keyframe", "advanced", "ready", ["web","android"], "shared", "Animate position, scale, rotation and opacity"),
  tool("keyframes-bezier", "Bezier Easing", "keyframe", "pro", "ready", ["web","android"], "shared", "Edit cubic-Bezier motion curves"),
  tool("keyframes-copy-paste", "Copy / Paste Keyframes", "keyframe", "advanced", "ready", ["web","android"], "shared", "Copy keyframe groups between shots"),
  tool("motion-path", "Motion Paths", "keyframe", "pro", "planned", ["web","android"], "shared", "Animate along editable paths"),
  tool("auto-reframe", "Auto Reframe", "transform", "advanced", "studio-only", ["web","android"], "studio", "Reframe a subject for vertical, square and landscape outputs"),
  tool("face-follow", "Face Follow", "transform", "pro", "studio-only", ["web","android"], "studio", "Follow detected face-analysis frames"),
  tool("object-tracking", "Object Tracking", "transform", "pro", "planned", ["web","android"], "analysis", "Track a selected object across frames"),
  tool("person-segmentation", "Person Segmentation", "mask", "pro", "planned", ["web","android"], "analysis", "Create a subject mask for background replacement"),

  // Speed
  tool("speed-presets", "Speed Presets", "speed", "basic", "ready", ["web","android"], "shared", "Slow motion and fast playback presets"),
  tool("speed-ramp", "Speed Ramp", "speed", "pro", "studio-only", ["web","android"], "studio", "Animate playback speed with a curve"),
  tool("smooth-slow-motion", "Smooth Slow Motion", "speed", "pro", "planned", ["web","android"], "media3", "Frame interpolation for smoother slow motion"),
  tool("time-remap", "Time Remapping", "speed", "pro", "planned", ["web","android"], "shared", "Advanced variable-speed time mapping"),

  // Colour and image
  tool("color-presets", "Color Looks", "color", "basic", "ready", ["web","android"], "shared", "Warm, cool, cinematic, vintage, cyberpunk and more"),
  tool("hsl", "HSL Adjustments", "color", "advanced", "ready", ["web","android"], "shared", "Adjust hue, saturation and lightness"),
  tool("curves", "RGB Curves", "color", "pro", "studio-only", ["web","android"], "studio", "Control shadows, midtones and highlights"),
  tool("lut", "3D LUT", "color", "pro", "studio-only", ["web","android"], "studio", "Apply creative lookup-table color profiles"),
  tool("selective-color", "Selective Color", "color", "pro", "planned", ["web","android"], "webgl", "Grade selected color ranges independently"),
  tool("vignette", "Vignette", "color", "advanced", "studio-only", ["web","android"], "studio", "Shape edge falloff and focus"),
  tool("film-grain", "Film Grain", "color", "advanced", "planned", ["web","android"], "webgl", "Add adjustable analog film texture"),
  tool("halation", "Halation", "color", "trending", "planned", ["web","android"], "webgl", "Add film-like highlight bloom"),
  tool("bloom-glow", "Bloom / Glow", "color", "advanced", "planned", ["web","android"], "webgl", "Glow bright highlights with threshold and radius controls"),

  // Effects: common and currently popular looks
  tool("gaussian-blur", "Gaussian Blur", "effect", "basic", "ready", ["web","android"], "shared", "Blur with adjustable radius"),
  tool("sharpen", "Sharpen", "effect", "advanced", "ready", ["web","android"], "shared", "Recover perceived detail after scaling"),
  tool("motion-blur", "Motion Blur", "effect", "pro", "planned", ["web","android"], "webgl", "Directional shutter blur tied to motion"),
  tool("chromatic-aberration", "Chromatic Aberration", "effect", "trending", "planned", ["web","android"], "webgl", "Separate color channels at image edges"),
  tool("rgb-split", "RGB Split", "effect", "trending", "studio-only", ["web","android"], "studio", "Offset RGB channels for music-driven accents"),
  tool("glitch", "Digital Glitch", "effect", "trending", "studio-only", ["web","android"], "studio", "Digital breakup and signal distortion"),
  tool("vhs", "VHS Retro", "effect", "trending", "studio-only", ["web","android"], "studio", "Retro tape noise, scanlines and chroma shift"),
  tool("film-burn", "Film Burn", "effect", "trending", "studio-only", ["web","android"], "studio", "Light-leak and film-burn overlays"),
  tool("light-leak", "Light Leak", "effect", "advanced", "studio-only", ["web","android"], "studio", "Cinematic light leaks"),
  tool("strobe", "Strobe", "effect", "trending", "studio-only", ["web","android"], "studio", "Beat-triggered flash accents"),
  tool("kaleidoscope", "Kaleidoscope", "effect", "trending", "studio-only", ["web","android"], "studio", "Radial mirrored repetition"),
  tool("mirror", "Mirror", "effect", "advanced", "studio-only", ["web","android"], "studio", "Mirror and split-screen symmetry"),
  tool("mosaic", "Mosaic / Pixelate", "effect", "advanced", "ready", ["web","android"], "shared", "Pixelate regions or full frames"),
  tool("beauty", "Beauty Retouch", "effect", "advanced", "studio-only", ["web","android"], "studio", "Subtle skin smoothing with detail preservation"),
  tool("stabilization", "Stabilization", "effect", "pro", "studio-only", ["web","android"], "studio", "Reduce camera shake with crop compensation"),
  tool("background-removal", "Background Removal", "effect", "pro", "planned", ["web","android"], "analysis", "Separate foreground subject from background"),
  tool("portrait-blur", "Portrait Background Blur", "effect", "pro", "planned", ["web","android"], "analysis", "Depth-aware subject separation and blur"),

  // Transitions
  tool("cut", "Hard Cut", "transition", "basic", "ready", ["web","android"], "shared", "Instant cut at the edit point"),
  tool("dissolve", "Cross Dissolve", "transition", "basic", "ready", ["web","android"], "shared", "Blend adjacent shots"),
  tool("fade", "Fade In / Out", "transition", "basic", "ready", ["web","android"], "shared", "Fade picture or audio"),
  tool("push-slide", "Push / Slide", "transition", "advanced", "ready", ["web","android"], "shared", "Directional movement between shots"),
  tool("zoom-transition", "Zoom Transition", "transition", "trending", "ready", ["web","android"], "shared", "Beat-friendly zoom between shots"),
  tool("whip-pan", "Whip Pan", "transition", "trending", "studio-only", ["web","android"], "studio", "Fast directional motion blur transition"),
  tool("glitch-transition", "Glitch Transition", "transition", "trending", "studio-only", ["web","android"], "studio", "Digital glitch transition"),
  tool("luma-wipe", "Luma Wipe", "transition", "pro", "studio-only", ["web","android"], "studio", "Reveal using luminance"),
  tool("mask-reveal", "Mask Reveal", "transition", "pro", "planned", ["web","android"], "webgl", "Reveal through a custom animated mask"),
  tool("3d-flip", "3D Flip", "transition", "trending", "planned", ["web","android"], "webgl", "Perspective flip between clips"),
  tool("liquid-morph", "Liquid Morph", "transition", "trending", "planned", ["web","android"], "webgl", "Flowing morph between matched subjects"),

  // Masks and compositing
  tool("shape-masks", "Shape Masks", "mask", "advanced", "studio-only", ["web","android"], "studio", "Rectangle, ellipse, linear and radial masks"),
  tool("freehand-mask", "Freehand Mask", "mask", "pro", "planned", ["web","android"], "webgl", "Draw custom mask paths"),
  tool("mask-feather", "Mask Feather / Invert", "mask", "advanced", "studio-only", ["web","android"], "studio", "Soften or invert mask edges"),
  tool("chroma-key", "Chroma Key", "mask", "pro", "studio-only", ["web","android"], "studio", "Remove a selected key color"),
  tool("luma-key", "Luma Key", "mask", "pro", "studio-only", ["web","android"], "studio", "Composite by luminance"),
  tool("rotoscoping", "AI Rotoscoping", "mask", "pro", "planned", ["web","android"], "analysis", "Track a person or object mask over time"),

  // Text and captions
  tool("text-overlay", "Text Overlays", "text", "basic", "ready", ["web","android"], "shared", "Add, position and time text layers"),
  tool("text-animation", "Text Animation", "text", "advanced", "studio-only", ["web","android"], "studio", "Fade, pop, typewriter and reveal animation"),
  tool("kinetic-typography", "Kinetic Typography", "text", "trending", "studio-only", ["web","android"], "studio", "Animate words and phrases to speech or music"),
  tool("word-captions", "Word-by-word Captions", "caption", "advanced", "studio-only", ["web","android"], "studio", "Synchronize captions to spoken words"),
  tool("karaoke-captions", "Karaoke Captions", "caption", "trending", "studio-only", ["web","android"], "studio", "Highlight each spoken word as it is heard"),
  tool("caption-translation", "Caption Translation", "caption", "advanced", "studio-only", ["web","android"], "studio", "Translate captions while preserving timing"),
  tool("auto-captions", "Auto Captions", "caption", "advanced", "studio-only", ["web","android"], "studio", "Generate and style speech captions"),

  // Audio
  tool("audio-mix", "Audio Mixer", "audio", "advanced", "ready", ["web","android"], "shared", "Independent clip and music gain"),
  tool("audio-fades", "Audio Fade In / Out", "audio", "basic", "ready", ["web","android"], "shared", "Apply deterministic gain envelopes"),
  tool("audio-ducking", "Auto Ducking", "audio", "pro", "planned", ["web","android"], "shared", "Lower music under dialogue"),
  tool("voice-isolation", "Voice Isolation", "audio", "pro", "planned", ["web","android"], "analysis", "Separate speech from background audio"),
  tool("noise-reduction", "Noise Reduction", "audio", "advanced", "planned", ["web","android"], "shared", "Reduce steady background noise"),
  tool("voiceover", "Voiceover / TTS", "audio", "advanced", "studio-only", ["web","android"], "studio", "Record or synthesize narration"),
  tool("equalizer", "Equalizer", "audio", "pro", "planned", ["web","android"], "shared", "Shape frequency bands"),
  tool("audio-effects", "Reverb / Delay", "audio", "advanced", "planned", ["web","android"], "shared", "Add spatial and echo effects"),

  // AI and export
  tool("ai-director", "AI Director", "ai", "pro", "ready", ["web","android"], "analysis", "Plan shot roles, pacing, effects and beat-aware cuts"),
  tool("beat-sync", "Beat Sync", "ai", "advanced", "ready", ["web","android"], "analysis", "Align edits to detected beats and drops"),
  tool("smart-crop", "AI Smart Crop", "ai", "advanced", "studio-only", ["web","android"], "analysis", "Keep faces and subjects inside the output frame"),
  tool("auto-hook", "AI Opening Hook", "ai", "trending", "studio-only", ["web","android"], "analysis", "Choose an opening moment and hook treatment"),
  tool("auto-broll", "AI B-roll Suggestions", "ai", "pro", "planned", ["web","android"], "analysis", "Suggest supporting footage for story gaps"),
  tool("export-quality", "Export Quality / FPS", "export", "basic", "ready", ["web","android"], "shared", "Choose output size, frame rate and quality"),
] as const;

export type EditorRendererCapabilities = {
  platform: EditorPlatform;
  studioSession?: boolean;
  media3?: boolean;
  webgl?: boolean;
  webcodecs?: boolean;
  analysis?: boolean;
};

/** Resolve availability at runtime so the UI never offers a tool the active renderer drops. */
export function resolveEditorToolAvailability(
  definition: EditorToolDefinition,
  capabilities: EditorRendererCapabilities,
): { available: boolean; status: EditorToolStatus; reason?: string } {
  if (!definition.platforms.includes(capabilities.platform)) {
    return { available: false, status: definition.status, reason: "Not available on this platform." };
  }
  if (definition.status === "planned") {
    return { available: false, status: "planned", reason: "This tool is not implemented in the active renderer yet." };
  }
  if (definition.status === "studio-only" && !capabilities.studioSession) {
    return { available: false, status: "studio-only", reason: "Open a Reel created by Shubix Studio to use this tool." };
  }
  if (definition.renderer === "media3" && !capabilities.media3) {
    return { available: false, status: definition.status, reason: "The native Media3 renderer is unavailable in this build." };
  }
  if (definition.renderer === "webgl" && !capabilities.webgl) {
    return { available: false, status: definition.status, reason: "The WebGL renderer is unavailable." };
  }
  if (definition.renderer === "webcodecs" && !capabilities.webcodecs) {
    return { available: false, status: definition.status, reason: "WebCodecs export is unavailable in this browser." };
  }
  if (definition.renderer === "analysis" && !capabilities.analysis) {
    return { available: false, status: definition.status, reason: "The required analysis capability is unavailable." };
  }
  return { available: definition.status === "ready" || definition.status === "studio-only", status: definition.status };
}

/** Browse tools by category/tier without duplicating platform-specific support logic. */
export function getEditorTools(
  filter: { category?: EditorToolCategory; tier?: EditorToolDefinition["tier"]; includeUnavailable?: boolean } = {},
  capabilities?: EditorRendererCapabilities,
): EditorToolDefinition[] {
  return EDITOR_TOOL_CATALOG.filter((item) => {
    if (filter.category && item.category !== filter.category) return false;
    if (filter.tier && item.tier !== filter.tier) return false;
    if (!filter.includeUnavailable && capabilities && !resolveEditorToolAvailability(item, capabilities).available) return false;
    if (!filter.includeUnavailable && !capabilities && item.status === "planned") return false;
    return true;
  });
}
