/**
 * Shubix shared editing intelligence.
 *
 * Platform-neutral edit decisions and animation primitives. Both the browser studio and
 * the native editor consume the same plan; renderers remain platform-specific.
 */
export type Easing = "linear" | "ease-in" | "ease-out" | "ease-in-out" | "hold" | "bezier";
export type KeyframeValue = number | string | boolean;
export type Keyframe<T extends KeyframeValue = KeyframeValue> = {
  id: string; time: number; value: T; easing: Easing; inTangent?: number; outTangent?: number;
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
] as const;

export const TRANSITION_LIBRARY: readonly TransitionDefinition[] = [
  {id:"cut",category:"basic",label:"Hard Cut",duration:0,mobileSafe:true,beatFriendly:true},
  {id:"cross-dissolve",category:"basic",label:"Cross Dissolve",duration:0.35,mobileSafe:true,beatFriendly:false},
  {id:"fade-black",category:"basic",label:"Fade Through Black",duration:0.45,mobileSafe:true,beatFriendly:false},
  {id:"fade-white",category:"basic",label:"Flash White",duration:0.22,mobileSafe:true,beatFriendly:true},
  {id:"push-left",category:"movement",label:"Push Left",duration:0.32,mobileSafe:true,beatFriendly:true},
  {id:"push-right",category:"movement",label:"Push Right",duration:0.32,mobileSafe:true,beatFriendly:true},
  {id:"slide-up",category:"movement",label:"Slide Up",duration:0.32,mobileSafe:true,beatFriendly:true},
  {id:"zoom-in",category:"movement",label:"Zoom In",duration:0.3,mobileSafe:true,beatFriendly:true},
  {id:"zoom-out",category:"movement",label:"Zoom Out",duration:0.3,mobileSafe:true,beatFriendly:true},
  {id:"whip-pan",category:"movement",label:"Whip Pan",duration:0.24,mobileSafe:false,beatFriendly:true},
  {id:"spin",category:"stylized",label:"Spin",duration:0.42,mobileSafe:true,beatFriendly:true},
  {id:"glitch",category:"stylized",label:"Digital Glitch",duration:0.18,mobileSafe:false,beatFriendly:true},
  {id:"rgb-wipe",category:"stylized",label:"RGB Wipe",duration:0.25,mobileSafe:false,beatFriendly:true},
  {id:"light-leak",category:"cinematic",label:"Light Leak",duration:0.5,mobileSafe:true,beatFriendly:false},
  {id:"film-burn",category:"cinematic",label:"Film Burn",duration:0.55,mobileSafe:false,beatFriendly:false},
  {id:"luma-wipe",category:"cinematic",label:"Luma Wipe",duration:0.4,mobileSafe:false,beatFriendly:true},
  {id:"mask-reveal",category:"cinematic",label:"Mask Reveal",duration:0.45,mobileSafe:false,beatFriendly:false},
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
  keyframes: TransformTrack[]; reason: string;
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
    score:clamp(s.quality*0.42+(s.subjectScore??0.5)*0.28+(s.faceScore??0.5)*0.12+
      (s.isHighlight?0.18:0)+(s.sceneChange?0.04:0)-(s.speech?0.12:0),0,1)
  })).sort((a,b)=>b.score-a.score);
  const target=clamp(input.targetDuration??Math.min(30,input.shots.reduce((n,s)=>n+s.duration,0)),5,180);
  const pace=mood==="energetic"?1.25:mood==="story"||mood==="product"?0.82:1;
  const ideal=clamp(target/Math.max(1,Math.ceil(target/(3.2/pace))),0.8,5.5);
  const chosen: typeof ranked=[];
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
    const highlight=!!s.isHighlight||s.score>0.82;
    const transition= i===0?"cut":(drop&&intensity!=="subtle"?"flash-white":
      mood==="minimal"||mood==="story"?"cross-dissolve":
      highlight&&intensity==="bold"?"whip-pan": "cut");
    const effects:string[]=[];
    if(mood==="cinematic"||mood==="travel")effects.push("vignette","grain");
    if(mood==="product"||mood==="food")effects.push("contrast","sharpen");
    if(drop&&intensity!=="subtle")effects.push("speed-ramp");
    if(mobile){for(let j=effects.length-1;j>=0;j--)if(!EFFECT_LIBRARY.find(e=>e.id===effects[j])?.mobileSafe)effects.splice(j,1);}
    const zoom=highlight?1.09:1.045, pan=(i%2===0?1:-1)*(highlight?3:1.5);
    planShots.push({sourceId:s.id,sourceIndex:s.sourceIndex,trimStart:0,trimEnd:d,timelineStart:cursor,duration:d,
      transition,effects,speed:drop&&intensity!=="subtle"?1.15:1,keyframes:motionTrack(d,zoom,pan),
      reason:highlight?"High visual quality / highlight":s.speech?"Preserve spoken moment":"Best available subject and motion"});
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
export function evaluateKeyframes(frames: Keyframe<number>[], time: number): number {
  if(!frames.length)return 0;
  const sorted=[...frames].sort((a,b)=>a.time-b.time);
  if(time<=sorted[0].time)return sorted[0].value;
  if(time>=sorted[sorted.length-1].time)return sorted[sorted.length-1].value;
  let i=0;while(i<sorted.length-1&&sorted[i+1].time<time)i++;
  const a=sorted[i],b=sorted[i+1],span=Math.max(0.000001,b.time-a.time);
  let t=clamp((time-a.time)/span,0,1);
  if(a.easing==="hold")return a.value;
  if(a.easing==="ease-in")t=t*t;
  else if(a.easing==="ease-out")t=1-(1-t)*(1-t);
  else if(a.easing==="ease-in-out")t=t<0.5?2*t*t:1-Math.pow(-2*t+2,2)/2;
  return a.value+(b.value-a.value)*t;
}

export const MASK_LIBRARY: readonly MaskKind[] = ["rectangle","ellipse","linear","radial","freehand","person","luma","text"];
export const BLEND_MODES = ["normal","multiply","screen","overlay","soft-light","hard-light","color-dodge","color-burn","difference","exclusion","hue","saturation","color","luminosity"] as const;
export const AUDIO_TOOLS = ["volume","fade-in","fade-out","ducking","voice-isolation","noise-reduction","compressor","limiter","equalizer","reverb","delay","stereo-width","beat-sync"] as const;
export const TEXT_TOOLS = ["font","weight","tracking","leading","fill","gradient","stroke","shadow","background","highlight","reveal","typewriter","karaoke","tracking-follow","safe-area"] as const;
