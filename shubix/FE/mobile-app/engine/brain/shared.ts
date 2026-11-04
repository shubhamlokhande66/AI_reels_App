// The values and small helpers the brain shares (speeds, recipes, the plan's key...). Moved from components/studio/engine.ts.
// @ts-nocheck
import { planRank } from '@mobile/core/lib/plan-locks';

export function createSharedBrain(ES, EH){
const lockNeed = (cat, key) => ES.LOCKS[cat + ':' + key] || 'free';
const isLocked = (cat, key) => !EH.allOpen() && planRank(lockNeed(cat, key)) > planRank(EH.asFree() ? 'free' : ES.planNow);
const isPartStart = t => ES.songPartsRel.some(x => Math.abs(x.t - t) < 0.08);
const SIZES = {'9:16':[1080,1920], '4:5':[1080,1350], '1:1':[1080,1080], '16:9':[1920,1080], '3:4':[1080,1440], '4:3':[1440,1080], '2:1':[1920,960], '2.35:1':[1920,816]};
const SPEED = {
  normal: {label:'1×', at:()=>1, pos:l=>l},
  slow:   {label:'Slow 0.5×', at:()=>0.5, pos:l=>0.5*l},
  fast:   {label:'Fast 1.6×', at:()=>1.6, pos:l=>1.6*l},
};
const SNAP_T = 0.32;
const snapSpeed = {label:'Freeze → 1×', at:l=> l<SNAP_T ? 0 : 1, pos:l=> l<SNAP_T ? 0 : l-SNAP_T};
const FX_NAME = {jump:'Punch-in (jump cut)', 'punch-soft':'Soft zoom', 'pan-soft':'Ken Burns (soft)', snap:'Photo snap (freeze + flash)', hook:'Hook zoom + RGB', none:'—', pan:'Ken Burns + beat bounce', zoomburst:'Zoom burst + RGB', drift:'Slow drift + vignette', punch:'Zoom punch', tilt:'Tilt punch', shake:'Shake', bounce:'Beat bounce',
  boxgrow:'Shape: box grows on the beat', grid:'Shape: grid opens on the beat', strips:'Shape: strips on the beat', circle:'Shape: circle pulse', heartbeat:'Shape: heart pulse', starbeat:'Shape: star pulse',
  frame:'Frame in frame', mirror:'Mirror', kaleido:'Kaleidoscope', triple:'Triple split', vhs:'VHS retro', strobe:'Strobe on the beat', rgbpulse:'RGB split on the beat', blurpulse:'Blur pulse on the beat',
  grain:'Film grain', leak:'Light leak', rainbow:'Rainbow', negative:'Negative', halftone:'Halftone', pixel8:'8-bit pixels', crt:'CRT screen', fisheye:'Fisheye', swirl:'Swirl', sketch:'Sketch', duotone:'Duotone', zoom3d:'3D zoom'};
const ACCENTS = ['punch','shake','flash','pulse'];
const aiReelOk = () => ES.aiOn && !!ES.reelId && ES.aiReel === ES.reelId;
const fpOf = src => [src.name, src.file ? src.file.size : 0, src.file ? src.file.lastModified : 0].join('|');
const aiTrusted = () => ES.aiOn && !!ES.director && ES.director.key === dirKey();
const dirKey = () => [ES.wish, ES.tplKind, ES.mode, ES.mode === 'copy' && ES.refProfile ? ES.refProfile.name + '|' + ES.refProfile.dur : '', ES.mixNo, ES.plan.length, ES.plan.map(s=>s.start.toFixed(2)).join(','), ES.sources.map(fpOf).join(';')].join('#');
const dirSlotOf = i => { const d = (ES.aiOn && ES.director && ES.director.key===dirKey() && ES.director.slots[i]) || null; return d && !d.auto ? d : null; };
const dirShot = i => { const d = dirSlotOf(i); return d && d.cand ? d.cand : null; };
const TR_STYLE = { smooth: ['dissolve', 'dip'], fast: ['whip', 'flash'], auto: ['flash', 'dissolve'] };
const RECIPES = [
  { name: 'Clean cut', drop: 'flash', zoom: 'punch', brk: 'dip' },
  { name: 'Drop punch', drop: 'whip', zoom: 'zoomburst', brk: 'dissolve' },
  { name: 'Zoom in', drop: 'zoom', zoom: 'punch', brk: 'blur' },
  { name: 'Cinematic', drop: 'dissolve', zoom: 'zoomburst', brk: 'dip' },
  { name: 'Flash beat', drop: 'flash', zoom: 'zoomburst', brk: 'luma' },
];
const dirBase = () => [ES.wish, ES.mode, ES.mode === 'copy' && ES.refProfile ? ES.refProfile.name + '|' + ES.refProfile.dur : '', ES.sources.map(fpOf).join(';'), ES.song ? ES.song.key : ''].join('#');
const planSig = () => ES.plan.length + ':' + ES.plan.map(s=>s.start.toFixed(2)).join(',');
const paceUsable = () => ES.aiOn && ES.kind !== 'talk' && ES.buf && ES.beats.length >= 8 && ES.sources.length && !ES.recording && !(ES.mode === 'copy' && ES.refProfile);
const paceNow = () => (paceUsable() && ES.pacing && ES.pacing.key === EH.paceKey()) ? ES.pacing : null;
const paceWanted = () => paceUsable() && !paceNow() && ES.paceFailedKey !== EH.paceKey();
const SEQ_FAST = 0.5;
const SEQ_MAX = 40;
const SPEED_KEYS = {normal:'1×', slow:'Slow 0.5×', fast:'Fast 1.6×', velocity:'Velocity (beat)', ramp:'Ramp 1.8×→0.6×', freeze:'Freeze → 1×', hold:'Freeze frame'};
const holdSpeed = {label:'Freeze frame', at:()=>0, pos:()=>0};
const speedKey = sp => (Object.keys(SPEED_KEYS).find(k=>SPEED_KEYS[k]===sp.label) || (sp.label.startsWith('Ramp') ? 'ramp' : 'normal'));
const lyOf = () => ES.layers.map(L => { const c = JSON.parse(JSON.stringify({ ...L, fc: undefined })); return c; });
const refKeyOf = f => f ? f.name + '|' + f.size + '|' + (f.lastModified || 0) : '';
const copyTimed = () => ES.mode === 'copy' && !!ES.refProfile && !ES.refProfile.learned && !!ES.refProfile.key && !!ES.song && !!ES.song.file && refKeyOf(ES.song.file) === ES.refProfile.key && (ES.refProfile.moments || []).some(m => m.at !== undefined);
const REF_TR = { hard:'hard', dissolve:'dissolve', fade:'dip', flash:'flash', whip:'whip', zoom:'zoom', glitch:'glitch', spin:'spin', iris:'iris', diamond:'diamond', heart:'heart', star:'star', wipe:'wipe', bars:'bars', blur:'blur' };
const copyExact = () => ES.mode === 'copy' && !!ES.refProfile && (ES.refProfile.moments || []).length >= 2;
const AI_CS = c => { const o = {}, n = (k, a, b) => { const v = Number(c[k]); if(Number.isFinite(v) && v) o[k] = Math.min(b, Math.max(a, v)); };
  if([90,180,270].includes(c.rot)) o.rot = c.rot; for(const k of ['fh','fv','fit','enh']) if(c[k] === true) o[k] = true;
  if(o.fit){ if(c.bg === 'blur' || c.bg === 'color' || EH.CANVAS_PATS.includes(c.bg)) o.bg = c.bg; if(/^#[0-9a-f]{6}$/i.test(c.bgc || '')) o.bgc = c.bgc; n('bd', 0, 1); if(/^#[0-9a-f]{6}$/i.test(c.bdc || '')) o.bdc = c.bdc; }
  n('stab', 0, 1); n('smooth', 0, 1); n('bri', -1, 1); n('con', -1, 1); n('sat', -1, 1); n('warm', -1, 1); n('hi', -1, 1); n('sh', -1, 1); n('hue', -1, 1); n('sharp', 0, 1); n('vig', 0, 1); n('beauty', 0, 1); n('fin', 0, 1.5); n('fout', 0, 1.5);
  // reverse, zoom, the clip's sound, and the mask / green screen / curves / HSL objects (the server checked their fields)
  if(c.rev === true) o.rev = true; n('zoom', 1, 3); n('pitch', -12, 12); for(const k of ['vol','mus']) if(Number.isFinite(Number(c[k])) && c[k] !== undefined) o[k] = Math.min(2, Math.max(0, Number(c[k])));
  for(const k of ['mk','ck','cv','hsl','kx']) if(c[k] && typeof c[k] === 'object') o[k] = JSON.parse(JSON.stringify(c[k]));
  return o; };
  return { lockNeed, isLocked, isPartStart, SIZES, SPEED, SNAP_T, snapSpeed, FX_NAME, ACCENTS, aiReelOk, fpOf, aiTrusted, dirKey, dirSlotOf, dirShot, TR_STYLE, RECIPES, dirBase, planSig, paceUsable, paceNow, paceWanted, SEQ_FAST, SEQ_MAX, SPEED_KEYS, holdSpeed, speedKey, lyOf, refKeyOf, copyTimed, REF_TR, copyExact, AI_CS };
}
