/** The Fast Studio page body (ids are what components/studio/engine.ts wires up). Everything runs in the browser.
 *
 * One editor for everyone (the .brs root carries v-one, set by components/studio/views.ts): the song and clips fold
 * into one line each; the preview, the timeline and one tool bar with every tool (shot, music, text, captions, look,
 * motion, background, overlay, voice, style), one panel open at a time. Pro tools carry a PRO tag (views.ts PRO_TOOLS).
 * ?view=all opens every panel at once (checks and support). */
import { PRO_TOOLS } from "./views";

const I = (d: string, extra = "") =>
  `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${d}</svg>`;
const IC = {
  menu: I('<path d="M4 7h16M4 12h16M4 17h10"/>'),
  shot: I('<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4L8.1 15.9M14.5 14.5L20 20M8.1 8.1L12 12"/>'),
  music: I('<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>'),
  text: I('<path d="M4 7V4h16v3M9 20h6M12 4v16"/>'),
  captions: I('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 15h4M13 15h4M7 11h10"/>'),
  look: I('<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor"/>'),
  motion: I('<path d="M12 3l9 9-9 9-9-9z"/>'),
  bg: I('<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="12" cy="10" r="3"/><path d="M6 19c1.5-3 4-4 6-4s4.5 1 6 4"/>'),
  voice: I('<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5"/>'),
  style: I('<path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4 6.8 19.1l1-5.8L3.5 9.2l5.9-.9z"/>'),
  play: I('<path d="M8 5v14l11-7z" fill="currentColor" stroke="none"/>'),
  mix: I('<path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>'),
  save: I('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>'),
  chev: I('<path d="M9 6l6 6-6 6"/>'),
  image: I('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/>'),
  copy: I('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><path d="M17.5 14v7M14 17.5h7"/>'),
  prev: I('<path d="M6 5v14M19 5v14L8 12z" fill="currentColor"/>'),
  next: I('<path d="M18 5v14M5 5v14l11-7z" fill="currentColor"/>'),
  plus: I('<path d="M12 5v14M5 12h14"/>'),
  layers: I('<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>'),
  undo: I('<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'),
  redo: I('<path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>'),
  back: I('<path d="M19 12H5M11 6l-6 6 6 6"/>'),
  arrow: I('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  check: I('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  pen: I('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>'),
  spark: I('<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z" fill="currentColor" stroke="none"/>'),
  upload: I('<path d="M12 16V4M7 9l5-5 5 5M5 14v5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5"/>'),
  scan: I('<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 9h8M8 12h8M8 15h5"/>'),
  lock: I('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
  crown: '<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 7l4.5 4L12 4l4.5 7L21 7l-2 12H5z"/></svg>',
};
// the Create flow's AI checklist (step 3 on computers, the Analysing screen on phones); data-t: the tasks it follows
const AI_STEPS: [string, string, string][] = [
  ["scenes", "Detecting scenes and best moments", "clips"],
  ["beats", "Matching with music beats", "beats"],
  ["faces", "Auto transitions and effects", "ai"],
  ["look", "Colour and quality enhancement", "make"],
];
const aiList = (cls: string) => `<ul class="${cls}">${AI_STEPS.map(([k, t, d]) => `<li data-ai="${k}" data-t="${d}">${IC.scan}<span>${t}</span></li>`).join("")}</ul>`;
// a tool: a button in the tool bar and the heading of its panel
// in the editor's order (the tool bar on a phone, the rail on a computer)
const TOOLS: [string, string, string][] = [
  ["style", "Style", IC.style], ["shots", "Shots", IC.shot], ["music", "Music", IC.music], ["text", "Text", IC.text], ["captions", "Captions", IC.captions],
  ["look", "Look", IC.look], ["bg", "Background", IC.bg], ["layers", "Layers", IC.layers], ["voice", "Voice", IC.voice], ["motion", "Motion", IC.motion],
];
// every tool in one bar; a Pro tool (views.ts PRO_TOOLS) carries a PRO tag, and on a free plan it opens /pricing
const dock = TOOLS.map(([k, n, ic]) => `<button type="button" class="tool" data-tool="${k}" aria-pressed="false">${ic}<span>${n}</span>${PRO_TOOLS.has(k) ? `<em class="protag">${IC.crown}PRO</em>` : ""}</button>`).join("");
const panelHead = (k: string) => { const t = TOOLS.find((x) => x[0] === k)!; return `<h3 class="ph">${t[2]}${t[1]}</h3>`; };

export const STUDIO_HTML = `
<nav class="fcrumbs" id="fcrumbs" aria-label="Breadcrumb"></nav>
<div class="topbar" id="topbar">
  <button type="button" class="ibtn tb-back" id="tbback" aria-label="Back">${IC.back}</button>
  <div class="tb-title"><span class="tb-name" id="tbname">Your Reel</span><span class="tb-sub" id="psaved"></span></div>
  <label class="tb-aspect" title="Format"><select id="tbaspect" aria-label="Format"><option value="9:16">9:16</option><option value="4:5">4:5</option><option value="1:1">1:1</option><option value="16:9">16:9</option></select></label>
  <span class="tb-undo" role="group" aria-label="Undo and redo"><button type="button" class="btn icon" id="undo" disabled aria-label="Undo" title="Undo (Ctrl+Z)">${IC.undo}</button><button type="button" class="btn icon" id="redo" disabled aria-label="Redo" title="Redo (Ctrl+Shift+Z)">${IC.redo}</button></span>
  <button type="button" class="btn save tb-export" id="topexport" disabled>${IC.save}<span>Export</span></button>
</div>
<div class="wrap">
  <div class="fhead" id="fhead">
    <button type="button" class="fback" id="fback" aria-label="Back">${IC.back}</button>
    <b class="fptitle" id="fptitle"></b>
    <div class="ft"><h1 id="ftitle">Music Reel</h1><p id="fsub">Turn your clips into a stunning Reel with music, beats and Shubix edits.</p></div>
    <ol class="fsteps" id="fsteps" aria-label="Steps">
      <li data-f="1"><i>1</i><span>Music</span></li><li data-f="2"><i>2</i><span>Clips</span></li><li data-f="3"><i>3</i><span>Shubix Edit</span></li><li data-f="4"><i>4</i><span>Preview &amp; Export</span></li>
    </ol>
    <button type="button" class="fskip" id="fskip">Skip</button>
  </div>
  <section class="fintro" id="fintro" aria-labelledby="fintroh">
    <span class="fbadge" id="fintroic">${IC.music}</span>
    <h2 id="fintroh">Create a Music Reel</h2>
    <p id="fintrop">Turn your clips into a stunning Reel with music, beats and Shubix edits.</p>
    <ul class="fchecks" id="fintrol"><li>${IC.check}Pick a song</li><li>${IC.check}Add your videos or photos</li><li>${IC.check}Shubix edits on the beat</li><li>${IC.check}Preview, make changes and export</li></ul>
    <button type="button" class="btn primary big fgo" data-fnext="1">Let's Start ${IC.arrow}</button>
    <button type="button" class="btn ghost fsample" id="fsample" hidden>No clips with you? Try it with our sample clips</button>
  </section>
  <!-- the kind and the template, pressed by the address (/create/music|talking|photo, /create/story, ?tpl=): never
       shown (each kind has its own page now); the engine, steps.ts and auto.ts read and press these buttons -->
  <section class="step starts" id="s0" hidden>
    <div class="sh3"><span class="num">1</span><h2>What are we making?</h2><span class="st" id="s0st">Choose one to start</span></div>
    <div class="sbody">
    <div class="makegrid">
      <button type="button" class="kindx storycard" id="storykind">${IC.text}<span><b>Story → Reel</b><small>Write it; Shubix narrates it, shows it scene by scene, adds captions</small></span></button>
      <div class="kinds" id="kind" role="group" aria-label="Kind of Reel">
        <button data-k="music" aria-pressed="false">${IC.music}<span><b>Music Reel</b><small>Cuts land on every beat</small></span></button>
        <button data-k="talk" aria-pressed="false">${IC.voice}<span><b>Talking Reel</b><small>Pauses cut, captions added</small></span></button>
      </div>
      <button type="button" class="kindx" id="photokind" aria-pressed="false">${IC.image}<span><b>Photos to Reel</b><small>Your photos, moving to the music</small></span></button>
      <button type="button" class="kindx copycard" id="copycard" aria-pressed="false">${IC.copy}<span><b>Copy a Reel</b><small>Match a Reel you like: its cuts and look</small></span></button>
    </div>
  <div class="tplrow">
    <span class="label">Or start from a template</span>
    <div class="tpl" id="tpl" role="group" aria-label="Templates"><!-- filled by the studio: the templates from Admin -->
    </div>
    <span class="fname" id="tplhelp"></span>
  </div>
    </div>
  </section>



  <div class="fgrid">
  <div class="fmain">
  <section class="step" id="s1">
    <button type="button" class="sh" aria-expanded="true"><span class="num">1</span><span class="fh"><h2>Choose Music</h2><small class="fsh">Pick a song or sound for your Reel</small></span><span class="st" id="s1st">Choose a song to start</span></button>
    <div class="sbody">
    <div class="fchoose">
    <div class="row fpickrow">
      <button class="btn primary" id="mpick">${IC.music}Choose song</button>
      <input id="mfile" type="file" accept="audio/*,video/*,.mp3,.m4a,.aac,.wav,.mov,.mp4" hidden>
      <span class="fname" id="mname">MP3, M4A, WAV or any video's sound (iPhone: from Files or Photos)</span>
      <button class="btn ghost" id="skipmusic" type="button" hidden>Continue without music</button>
    </div>
    <div class="recent" id="recent" hidden><span class="label">Recent songs</span><div class="rlist" id="rlist"></div></div>
    <button type="button" class="btn primary big fnext fchoosenext" data-fnext="1">Next ${IC.arrow}</button>
    </div>
    <div class="fadjust">
    <div class="fsong" id="fsong"><span class="fsongic">${IC.music}</span><span class="fsongt"><b id="fsongn"></b><small id="fsongd"></small></span></div>
    <div class="fwavebox"><canvas class="wave" id="mwave"></canvas></div>
    <div class="row lenrow" id="lenrow" hidden>
      <span class="label">Reel length</span>
      <div class="seg" id="slen" role="group" aria-label="How much of the song">
        <button data-l="0" aria-pressed="true">Full</button><button data-l="15" aria-pressed="false">15 s</button><button data-l="30" aria-pressed="false">30 s</button><button data-l="60" aria-pressed="false">1 min</button><button data-l="c" aria-pressed="false">Custom</button>
      </div>
      <label class="lenc" hidden id="slencw"><input id="slenc" type="number" inputmode="numeric" min="5" max="180" step="1" value="45"> s</label>
      <button class="btn" id="sauto" hidden title="Pick the strongest part of the song again">${IC.style}Best part</button>
      <span class="sinfo" id="sinfo"></span>
    </div>
    <p class="hint" id="lenhint" hidden>Drag on the waveform to choose the part yourself.</p>
    <div class="stats">
      <span>Length <b id="mdur">—</b></span>
      <span><b id="mbpm">—</b> BPM</span>
      <span>Shots <b id="mclips">—</b></span>
      <span>Drops <b id="mdrop">—</b></span>
      <span>Breaks <b id="mbreak">—</b></span>
    </div>
    <div class="fsugg" id="fsugg">${IC.spark}<span><b>Suggested Part</b><small>We found the best part of the song, with strong beats. Drag on the waveform to choose another.</small></span></div>
    <div class="legend">
      <span><i style="background:var(--drop)"></i>Drop: best shot</span>
      <span><i style="background:var(--hit)"></i>Hit: strong accent</span>
      <span><i style="background:var(--cut)"></i>Cut: plain cut</span>
      <span><i style="background:var(--break)"></i>Break: slow motion</span>
    </div>
    <button type="button" class="btn primary big fnext" data-fnext="1">Next ${IC.arrow}</button>
    </div>
    </div>
  </section>

  <section class="step locked" id="s2">
    <button type="button" class="sh" aria-expanded="true"><span class="num">2</span><span class="fh"><h2>Clips</h2><small class="fsh">Add multiple videos or photos. The more clips, the better!</small></span><span class="st" id="s2st">Several clips or one long video</span></button>
    <div class="sbody">
    <div class="ftabs" id="ftabs" role="group" aria-label="Videos or photos"><button type="button" data-ft="videos" aria-pressed="true">Videos</button><button type="button" data-ft="photos" aria-pressed="false">Photos</button></div>
    <div class="drop" id="dropzone" role="button" tabindex="0">${IC.upload}<b class="vonly fdesk">Drag &amp; drop videos here</b><b class="ponly fdesk">Drag &amp; drop photos here</b><b class="vonly fmob">Tap to Add Videos</b><b class="ponly fmob">Tap to Add Photos</b><span class="vonly fdesk">or tap to choose · you can add more at any time</span><span class="ponly fdesk">or tap to choose · each photo becomes a short moving shot</span><span class="fmob">or choose from gallery</span><small>Supports MP4, MOV, 3GP, JPG, PNG</small></div>
    <input id="vfile" type="file" accept="video/*,.mov,.mp4,.m4v" multiple hidden>
    <div class="row">
      <button class="btn primary" id="addv"><span class="vonly">+ Add videos</span><span class="ponly">+ Add photos</span></button>
      <button class="btn" id="clearv" hidden>Remove all</button>
      <span class="fname" id="qinfo"></span>
    </div>
    <span class="flabel fcliplabel">Selected Clips</span>
    <div class="fclipgrid"><div class="clips" id="clips"></div><button type="button" class="fadd" id="fadd" aria-label="Add more clips">${IC.plus}</button></div>
    <div class="row talkrow" id="talkrow" hidden>
      <span class="label">Pauses</span>
      <div class="seg" id="tpace" role="group" aria-label="How much of the pauses to cut">
        <button data-p="tight" aria-pressed="false">Tight</button><button data-p="natural" aria-pressed="true">Natural</button><button data-p="relaxed" aria-pressed="false">Relaxed</button><button data-p="off" aria-pressed="false">Keep all</button>
      </div>
      <span class="label">Music under voice</span>
      <div class="seg" id="tmusic" role="group" aria-label="Music volume under the voice">
        <button data-v="0" aria-pressed="false">Off</button><button data-v="0.05" aria-pressed="false">Soft</button><button data-v="0.09" aria-pressed="true">Medium</button><button data-v="0.16" aria-pressed="false">Loud</button>
      </div>
      <label class="tog"><input type="checkbox" id="dn1" checked> Clean up voice noise</label>
      <span class="fname" id="tinfo"></span>
    </div>
    <div class="row">
      <span class="label">Format</span>
      <div class="seg" id="aspect">
        <button data-a="9:16" aria-pressed="true">9:16 Reel</button>
        <button data-a="4:5" aria-pressed="false">4:5</button>
        <button data-a="1:1" aria-pressed="false">1:1</button>
        <button data-a="16:9" aria-pressed="false">16:9</button>
      </div>
    </div>
    <span class="fslot" id="fsndslot"></span>
    <button type="button" class="btn primary big fnext" data-fnext="1" id="fclipsnext" disabled><span id="fclipsnt">Next</span> ${IC.arrow}</button>
    </div>
  </section>

  <section class="step fai" id="fai">
    <div class="sh3"><span class="num">3</span><span class="fh"><h2>Shubix Edit</h2><small class="fsh">We'll analyse your clips, match them with the beats and create a stunning Reel.</small></span></div>
    <div class="faibody">
      ${aiList("faiList")}
      <div class="fready" id="fready">${IC.spark}<b id="freadyt">Ready to create your Reel!</b><small id="freadys">Add a song and your clips, then press Generate.</small></div>
    </div>
  </section>
  </div>

  <aside class="fprev" id="fprev" aria-label="Reel preview">
    <div class="fprevh"><b>Reel Preview</b><span class="fslot" id="faspslot"></span></div>
    <div class="fprevbox" id="fprevbox"><span class="fplay">${IC.play}</span><small id="fprevnote">Your Reel appears here</small></div>
    <button type="button" class="btn primary big fgen" id="fgen" disabled>${IC.spark}<span id="fgent">Generate Reel</span>${IC.arrow}</button>
    <p class="fnote">Shubix will analyse your clips and create a stunning edit</p>
    <p class="fnote fsmall">${IC.lock}Everything happens on this device. Your videos are never uploaded.</p>
  </aside>
  </div>

  <section class="fan" id="fan" aria-live="polite">
    <h2>Analysing Clips</h2>
    <div class="aoring"><svg viewBox="0 0 120 120"><circle class="bg" cx="60" cy="60" r="52"/><circle class="fg" id="fanring" cx="60" cy="60" r="52" stroke-dasharray="326.7" stroke-dashoffset="326.7"/></svg><b id="fanpct">0%</b></div>
    <p class="fanst"><b id="fant">Reading your clips…</b><small id="fand"></small></p>
    ${aiList("faiList fanList")}
    <p class="fnote fbox">${IC.lock}This happens on your phone. Your videos are never uploaded.</p>
  </section>

  <section class="step locked" id="s3">
    <div class="sh3"><span class="num">4</span><h2>Your Reel</h2><span class="st" id="s3st">The edit appears once there are clips</span></div>
    <div class="create">
      <div class="stage">
        <div class="pv">
          <div class="pvbox"><canvas id="out" width="1080" height="1920"></canvas>
            <button type="button" class="playov" id="playov" aria-label="Play preview"><span class="ic-play">${IC.play}</span><span class="ic-pause"><svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor"/></svg></span></button></div>
          <div class="summary" id="summary">
            <h2 class="sumh">Your Reel is ready</h2>
            <p class="sumi" id="suminfo"></p>
            <button type="button" class="btn" data-proxy="remix">${IC.mix}<span>Change Reel</span></button>
          </div>
          <div class="inspector" id="inspector"></div>
        </div>
        <div class="bar"><i id="prog"></i></div>
        <div class="transport">
          <span class="tc" id="tcur">0:00.0</span>
          <button class="btn icon" id="pshot" type="button" aria-label="Previous shot">${IC.prev}</button>
          <button class="btn icon" id="cover" disabled aria-label="Cover image" title="Cover image">${IC.image}<span>Cover</span></button>
          <button class="btn primary" id="play" disabled>${IC.play}<span>Preview</span></button>
          <button class="btn icon" id="remix" disabled aria-label="Change Reel" title="Change Reel: Shubix makes a new version">${IC.mix}<span>Change Reel</span></button>
          <button class="btn icon" id="nshot" type="button" aria-label="Next shot">${IC.next}</button>
          <span class="tc" id="ttot">0:00.0</span>
          <button class="btn icon" id="pvfull" type="button" aria-label="Full screen" title="Full screen">${I('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>')}</button>
        </div>
        <div class="feditbar"><button type="button" class="btn primary big" id="fedit">${IC.pen}<span>Edit</span></button><small>Change shots, effects, text, music and more on the timeline</small></div>
        <div class="tlbar"><button class="btn mini feditdone" id="feditdone" type="button">${IC.check} Done editing</button><button class="btn mini" id="addbeat" type="button" title="A beat where the playhead is: a cut can land on it">♩ Beat here</button><button class="btn mini" id="clrbeat" type="button" title="Remove the beats you added">Clear my beats</button><span class="tlzs"><button class="btn mini" id="tlzo" type="button" aria-label="Zoom the timeline out">−</button><span id="tlz" class="fname">1×</span><button class="btn mini" id="tlzi" type="button" aria-label="Zoom the timeline in">+</button><button class="btn mini" id="tlfit" type="button" aria-label="The whole Reel in view" title="The whole Reel in view">${I('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>')}</button></span></div>
        <div class="strip"><div class="tlscroll"><canvas id="tl" class="tl" aria-label="Timeline, one block per shot"></canvas></div><div class="tlmusic" id="tlmusic"></div></div>
        <div class="lanesbox"><canvas class="lanes" id="lanes" aria-label="Timeline: effects, video, text, voice and music. Pinch or use − and + to zoom, drag a shot's edge to make it longer or shorter, tap a transition or an effect to change it"></canvas></div>
        <label class="tog safe"><input type="checkbox" id="safe" checked> Instagram safe zones (preview only)</label>
        <div class="msg" id="xmsg" hidden></div>
        <div class="row" id="saverow" hidden><button class="btn gold" id="savevid">Save to Photos / Share</button><a class="btn" id="dlvid">Download</a></div>
        <div class="postcap" id="postcap" hidden>
          <label class="fname" for="postcapt">Caption for your post</label>
          <textarea id="postcapt" rows="4" spellcheck="true"></textarea>
          <div class="row"><button class="btn mini" id="postcopy" type="button">Copy caption</button><span class="fname" id="postcapst"></span></div>
        </div>
      </div>

      <div class="tools">
        <nav class="dock" id="dock" aria-label="Tools">${dock}</nav>

        <div class="panels" id="panels">
          <!-- the left panel's tabs on a computer (the design): each opens its tool, Effects / Transitions the shot sheet -->
          <nav class="ptabs" id="ptabs" aria-label="Library">
            <button type="button" data-pt="media" aria-pressed="false">${IC.image}<span>Media</span></button><button type="button" data-pt="music" aria-pressed="false">${IC.music}<span>Music</span></button><button type="button" data-pt="text" aria-pressed="false">${IC.text}<span>Text</span></button><button type="button" data-pt="stickers" aria-pressed="false">${I('<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0M9 9.5h.01M15 9.5h.01"/>')}<span>Stickers</span></button><button type="button" data-pt="effects" aria-pressed="false">${IC.spark}<span>Effects</span></button><button type="button" data-pt="transitions" aria-pressed="false">${I('<path d="M4 6l7 6-7 6zM20 6l-7 6 7 6z"/>')}<span>Transitions</span></button><button type="button" data-pt="filters" aria-pressed="false">${I('<path d="M4 6h16M7 12h10M10 18h4"/>')}<span>Filters</span></button>
          </nav>
          <section class="panel" data-panel="media"><h3 class="ph">${IC.image}Media</h3><div class="mslot" id="mslot"></div></section>
          <section class="panel" data-panel="style">${panelHead("style")}
            <div class="seg" id="mode">
              <button data-m="auto" aria-pressed="true">Auto</button>
              <button data-m="smooth" aria-pressed="false">Smooth</button>
              <button data-m="fast" aria-pressed="false">Fast</button>
              <button data-m="copy" aria-pressed="false" title="Upload a Reel you like: its pace, transitions, effects and colours are copied onto your clips">Copy a Reel</button>
            </div>
            <input id="reffile" type="file" accept="video/*,.mov,.mp4,.m4v" hidden>
            <div class="refbox" id="refbox" hidden><span class="fname" id="refinfo"></span> <button class="btn" id="refchange" type="button">Change Reel</button>
              <div class="row" id="stsaverow" hidden><select id="stcat" aria-label="Kind of Reel"><option value="wedding">Wedding</option><option value="travel">Travel</option><option value="festival">Festival</option><option value="dance">Dance</option><option value="talking">Talking</option><option value="product">Product</option><option value="food">Food</option><option value="fitness">Fitness</option><option value="vlog">Vlog</option><option value="birthday">Birthday</option><option value="other">Other</option></select><label class="tog"><input type="checkbox" id="stshare"> Share (helps everyone's styles)</label><button class="btn mini" id="stsave" type="button">Save to my styles</button><span class="fname" id="ststat"></span></div></div>
            <div class="row learnrow" id="learnrow" hidden><span class="label">Learned style</span><select id="lcat" aria-label="Kind of Reel"></select><div class="seg" id="lscope"><button data-s="mine" aria-pressed="false">Mine</button><button data-s="all" aria-pressed="true">With shared</button></div><button class="btn mini" id="luse" type="button">Use</button><span class="fname" id="linfo"></span>
              <details class="stdetails"><summary>My saved styles</summary><ul id="stlist"></ul></details></div>
            <span class="fname" id="modehelp">Auto: the music decides. Calm parts get longer shots, drops and hits get effects.</span>
            <span id="aiwrap" hidden></span><input type="checkbox" id="aipick" hidden aria-hidden="true">
            <span class="fname" id="aistat" hidden></span>
          </section>

          <section class="panel" data-panel="music">${panelHead("music")}
            <div class="row"><button type="button" class="btn" data-open-step="s1">${IC.music}Change the song or its part</button><button type="button" class="btn" data-open-step="s2">${IC.plus}Add or change clips</button></div>
            <div class="clipsnd" id="clipsnd" hidden>
            <b>Your clips have their own sound</b>
            <small>Wind, traffic, people talking… Choose what the Reel keeps under the song.</small>
            <div class="seg" id="csnd" role="group" aria-label="The clips' own sound">
            <button data-c="mute" aria-pressed="true">Mute it</button><button data-c="voices" aria-pressed="false">Keep voices only</button><button data-c="all" aria-pressed="false">Keep all</button>
            </div>
            </div>
            <div class="ausliders musiconly">
            <label class="cslide"><span>Music volume</span><input type="range" id="mvol" min="0" max="1.5" step="0.05" value="1"><output>100%</output></label>
            <label class="tog"><input type="checkbox" id="sfxon" checked> Sound effects on transitions (whoosh, boom, click, pop)</label>
            <label class="cslide"><span>Effects volume</span><input type="range" id="sfxv" min="0" max="1.5" step="0.05" value="0.6"><output>60%</output></label>
            <div class="row" id="sfxadd"><span class="fname">Add at the playhead:</span><button type="button" class="btn mini" data-sfx="whoosh">Whoosh</button><button type="button" class="btn mini" data-sfx="pop">Pop</button><button type="button" class="btn mini" data-sfx="boom">Boom</button><button type="button" class="btn mini" data-sfx="click">Click</button><button type="button" class="btn mini" data-sfx="riser">Riser</button><button type="button" class="btn mini" data-sfx="ding">Ding</button></div>
            <div class="chips" id="sfxlist"></div>
            <label class="cslide"><span>Fade in</span><input type="range" id="mfin" min="0" max="4" step="0.1" value="0"><output>0.0 s</output></label>
            <label class="cslide"><span>Fade out</span><input type="range" id="mfout" min="0" max="4" step="0.1" value="0"><output>0.0 s</output></label>
            <select id="xclip" aria-label="Extract audio: use a clip's sound as the song"><option value="">Use a clip's sound as the song…</option></select>
            <p class="hint">A clip's own sound under the music: Shot → Volume.</p>
            </div>
          </section>

          <section class="panel" data-panel="text">${panelHead("text")}
            <label class="label" for="hook">Hook text (3-5 words, first 2 seconds)</label>
            <input id="hook" type="text" maxlength="40" placeholder="e.g. WAIT FOR THE DROP">
            <span class="label">Text style</span>
            <div class="seg" id="tstyle"><button data-t="pop" aria-pressed="true">Pop</button><button data-t="karaoke" aria-pressed="false">Karaoke</button><button data-t="box" aria-pressed="false">Box</button><button data-t="clean" aria-pressed="false">Clean</button></div>
            <span class="label">Text &amp; stickers</span>
            <div class="row ovadd">
              <button class="btn" id="ovtext" type="button">+ Text</button><button class="btn" id="ovsticker" type="button">+ Sticker</button>
              <select id="ovpreset" aria-label="Ready-made text"><option value="">+ Ready-made…</option><option value="price">Price tag ₹</option><option value="follow">Follow for more</option><option value="save">Save this</option><option value="step1">Step 1</option><option value="before">BEFORE</option><option value="after">AFTER</option><option value="ganpati">गणपती बाप्पा मोरया</option><option value="diwali">शुभ दीपावली</option><option value="hdiwali">Happy Diwali</option></select>
            </div>
            <div class="emojis" id="emojis" hidden></div>
            <div class="ovlist" id="ovlist"></div>
            <p class="hint" id="ovhint" hidden>Drag a text or sticker on the preview to move it. Pause the preview where it should start or end.</p>
          </section>

          <section class="panel" data-panel="captions">${panelHead("captions")}
            <label class="tog" id="capwrap" hidden><input type="checkbox" id="caps"> Captions: the words, word by word</label>
            <p class="hint capnone">Captions appear here once a song with words or a talking video is in.</p>
            <div class="row" id="caprow" hidden><select id="caplang" aria-label="Language of the song"><option value="">Language: detect</option><option value="hi">Hindi</option><option value="mr">Marathi</option><option value="en">English</option><option value="gu">Gujarati</option><option value="pa">Punjabi</option><option value="bn">Bengali</option><option value="ta">Tamil</option><option value="te">Telugu</option></select><select id="captr" aria-label="Also show the captions in"><option value="">Translation: off</option><option value="mr">+ मराठी (Marathi)</option><option value="hi">+ हिंदी (Hindi)</option><option value="en">+ English</option><option value="hinglish">+ Hinglish</option><option value="gu">+ ગુજરાતી</option><option value="bn">+ বাংলা</option><option value="ta">+ தமிழ்</option><option value="te">+ తెలుగు</option><option value="pa">+ ਪੰਜਾਬੀ</option></select><label class="tog" id="trwrap" hidden><input type="checkbox" id="tronly"> Only the translation</label><span class="fname" id="capstat"></span><label class="tog" id="kwwrap"><input type="checkbox" id="kwon" checked> Key words + zoom (talking, voiceover)</label></div>
          </section>

          <section class="panel" data-panel="look">${panelHead("look")}
            <label class="tog aitog"><input type="checkbox" id="aitouch" checked> Shubix touch-ups: fit wide clips, fix dark shots, keep voices, one reversed drop, fade out at the end</label>
            <div class="seg" id="look"><button data-l="natural" aria-pressed="false">Natural</button><button data-l="vivid" aria-pressed="true">Vivid</button><button data-l="cine" aria-pressed="false">Cinematic</button><button data-l="mono" aria-pressed="false">B&amp;W</button><button data-l="copy" aria-pressed="false" hidden>Copied</button></div>
          </section>

          <section class="panel" data-panel="bg">${panelHead("bg")}
            <div class="seg" id="bgmode" role="group" aria-label="Background behind the person"><button data-b="none" aria-pressed="true">Original</button><button data-b="blur" aria-pressed="false">Blur</button><button data-b="color" aria-pressed="false">Colour</button><button data-b="photo" aria-pressed="false">Photo</button></div>
            <div class="row" id="bgrow" hidden><span class="ovc" id="bgcolors" hidden></span><button class="btn mini" id="bgpick" type="button" hidden>Choose photo</button><input id="bgfile" type="file" accept="image/*" hidden></div>
            <span class="fname" id="bgstat"></span>
          </section>

          <section class="panel" data-panel="layers">${panelHead("layers")}
            <div class="row"><button type="button" class="btn" id="lyadd">${IC.plus}Add a video or photo on top</button><input id="lyfile" type="file" accept="video/*,image/*,.mov,.mp4,.jpg,.jpeg,.png,.webp" multiple hidden></div>
            <p class="hint">It starts at the playhead. Picture in picture, split screen, a masked shape, a logo…</p>
            <div class="lylist" id="lylist"></div>
            <div class="lyedit" id="lyedit" hidden>
              <span class="label">Layout</span>
              <div class="chips"><button type="button" class="chip" data-lay="tl"><i class="lyic lay-tl" aria-hidden="true"></i><span>Top left</span></button><button type="button" class="chip" data-lay="tr"><i class="lyic lay-tr" aria-hidden="true"></i><span>Top right</span></button><button type="button" class="chip" data-lay="bl"><i class="lyic lay-bl" aria-hidden="true"></i><span>Bottom left</span></button><button type="button" class="chip" data-lay="br"><i class="lyic lay-br" aria-hidden="true"></i><span>Bottom right</span></button><button type="button" class="chip" data-lay="top"><i class="lyic lay-top" aria-hidden="true"></i><span>Top</span></button><button type="button" class="chip" data-lay="bottom"><i class="lyic lay-bottom" aria-hidden="true"></i><span>Bottom</span></button><button type="button" class="chip" data-lay="left"><i class="lyic lay-left" aria-hidden="true"></i><span>Left</span></button><button type="button" class="chip" data-lay="right"><i class="lyic lay-right" aria-hidden="true"></i><span>Right</span></button><button type="button" class="chip" data-lay="full"><i class="lyic lay-full" aria-hidden="true"></i><span>Full</span></button></div>
              <span class="label">When · <span id="lytime"></span></span>
              <div class="chips"><button type="button" class="chip" data-lyt="start">Start at the playhead</button><button type="button" class="chip" data-lyt="end">End at the playhead</button><button type="button" class="chip" data-lyt="all">Whole Reel</button></div>
              <span class="label">Place</span>
              <label class="cslide"><span>Across</span><input type="range" data-ly="x" min="0" max="1" step="0.01"><output></output></label>
              <label class="cslide"><span>Down</span><input type="range" data-ly="y" min="0" max="1" step="0.01"><output></output></label>
              <label class="cslide"><span>Size</span><input type="range" data-ly="s" min="0.1" max="1.2" step="0.01"><output></output></label>
              <label class="cslide"><span>Rotate</span><input type="range" data-ly="r" min="-180" max="180" step="1"><output></output></label>
              <label class="cslide"><span>Opacity</span><input type="range" data-ly="op" min="0" max="1" step="0.05"><output></output></label>
              <label class="cslide"><span>Corners</span><input type="range" data-ly="rad" min="0" max="1" step="0.05"><output></output></label>
              <div class="chips"><button type="button" class="chip" data-lyf="fh">Mirror</button><button type="button" class="chip" data-lyf="fv">Flip</button></div>
              <span class="label">Mask</span>
              <div class="chips" id="lymask"><button type="button" class="chip" data-m="none"><i class="lyic mk-none" aria-hidden="true"></i><span>None</span></button><button type="button" class="chip" data-m="circle"><i class="lyic mk-circle" aria-hidden="true"></i><span>Circle</span></button><button type="button" class="chip" data-m="rect"><i class="lyic mk-rect" aria-hidden="true"></i><span>Rectangle</span></button><button type="button" class="chip" data-m="line"><i class="lyic mk-line" aria-hidden="true"></i><span>Line</span></button><button type="button" class="chip" data-m="mirror"><i class="lyic mk-mirror" aria-hidden="true"></i><span>Mirror</span></button></div>
              <div id="lymaskopts">
                <label class="cslide"><span>Width</span><input type="range" data-ly="mk.w" min="0.05" max="1.5" step="0.01"><output></output></label>
                <label class="cslide"><span>Height</span><input type="range" data-ly="mk.h" min="0.05" max="1.5" step="0.01"><output></output></label>
                <label class="cslide"><span>Angle</span><input type="range" data-ly="mk.a" min="-90" max="90" step="1"><output></output></label>
                <label class="cslide"><span>Feather</span><input type="range" data-ly="mk.f" min="0" max="0.6" step="0.01"><output></output></label>
                <label class="tog"><input type="checkbox" data-ly="mk.inv"> Invert (cut the shape out)</label>
              </div>
              <span class="label">Crop</span>
              <label class="cslide"><span>Left</span><input type="range" data-ly="crop.l" min="0" max="0.45" step="0.01"><output></output></label>
              <label class="cslide"><span>Right</span><input type="range" data-ly="crop.r" min="0" max="0.45" step="0.01"><output></output></label>
              <label class="cslide"><span>Top</span><input type="range" data-ly="crop.t" min="0" max="0.45" step="0.01"><output></output></label>
              <label class="cslide"><span>Bottom</span><input type="range" data-ly="crop.b" min="0" max="0.45" step="0.01"><output></output></label>
              <span class="label">Fade</span>
              <label class="cslide"><span>Fade in</span><input type="range" data-ly="fin" min="0" max="2" step="0.1"><output></output></label>
              <label class="cslide"><span>Fade out</span><input type="range" data-ly="fout" min="0" max="2" step="0.1"><output></output></label>
              <label class="cslide" id="lyvolrow"><span>Its sound</span><input type="range" data-ly="vol" min="0" max="2" step="0.05"><output></output></label>
              <label class="cslide"><span>Blend</span><select data-ly="blend" aria-label="Blend mode"><option value="source-over">Normal</option><option value="screen">Screen (light leaks, dust)</option><option value="multiply">Multiply</option><option value="overlay">Overlay</option><option value="soft-light">Soft light</option><option value="lighten">Lighten</option><option value="darken">Darken</option><option value="color-dodge">Colour dodge</option><option value="difference">Difference</option></select></label>
              <div class="row"><label class="tog"><input type="checkbox" data-ly="key.on"> Green screen (chroma key)</label><button type="button" class="btn mini" data-lykey="#00FF00"><i class="keydot" style="background:#00FF00" aria-hidden="true"></i>Green</button><button type="button" class="btn mini" data-lykey="#0047FF"><i class="keydot" style="background:#0047FF" aria-hidden="true"></i>Blue</button><button type="button" class="btn mini" data-lykey="#000000"><i class="keydot" style="background:#000000" aria-hidden="true"></i>Black</button><button type="button" class="btn mini" data-lykey="#FFFFFF"><i class="keydot" style="background:#FFFFFF" aria-hidden="true"></i>White</button></div>
              <label class="cslide"><span>Key strength</span><input type="range" data-ly="key.tol" min="0" max="1" step="0.05"><output></output></label>
              <button type="button" class="btn ghost" data-lydel="1">Remove this layer</button>
            </div>
          </section>

          <section class="panel" data-panel="voice">${panelHead("voice")}
            <div class="row vorow" id="vorow"><button class="btn" id="vorec" type="button">${IC.voice}Record voiceover</button><button class="btn mini" id="vodel" type="button" hidden>Remove voiceover</button><label class="tog"><input type="checkbox" id="dn2" checked> Clean up noise</label><span class="fname" id="vostat"></span></div>
            <div class="ttsbox musiconly" id="ttsbox">
              <label class="label" for="ttstext">Text to speech</label>
              <textarea id="ttstext" rows="2" maxlength="1200" placeholder="Type what the voice should say… (English, हिन्दी, मराठी, తెలుగు, മലയാളം)"></textarea>
              <div class="row"><select id="ttsvoice" aria-label="Voice"></select><button type="button" class="btn" id="ttsadd">${IC.voice}Add at the playhead</button></div>
              <p class="hint">Made on this phone. Each voice is downloaded once (about 60 MB).</p>
              <div class="ttslist" id="ttslist"></div>
            </div>
            <span class="label musiconly">Voice changer</span>
            <div class="chips musiconly" id="vfx" role="group" aria-label="Voice changer"><button type="button" class="chip" data-f="none" aria-pressed="true">Original</button><button type="button" class="chip" data-f="deep" aria-pressed="false">Deep</button><button type="button" class="chip" data-f="chipmunk" aria-pressed="false">Chipmunk</button><button type="button" class="chip" data-f="robot" aria-pressed="false">Robot</button><button type="button" class="chip" data-f="radio" aria-pressed="false">Radio</button><button type="button" class="chip" data-f="echo" aria-pressed="false">Echo</button></div>
            <p class="hint talkonly">Talking videos: pauses, music under the voice and noise cleanup are in step 2.</p>
          </section>

          <section class="panel" data-panel="motion">${panelHead("motion")}
            <details class="kfbox" id="kfbox"><summary>Keyframes: move, zoom, turn, fade a shot or a text</summary>
              <div class="kfhead"><span class="fname" id="kftarget"></span><select id="kfpreset" aria-label="Ready-made move"><option value="">Ready-made move…</option></select></div>
              <canvas id="kftl" class="kftl" aria-label="Keyframes of the shot or text; tap to move the playhead"></canvas>
              <div class="row kfbtns"><button class="btn mini" id="kfprev" type="button" aria-label="Previous keyframe">◀ ◆</button><button class="btn mini" id="kfadd" type="button">◇ Add keyframe</button><button class="btn mini" id="kfnext" type="button" aria-label="Next keyframe">◆ ▶</button><select id="kfease" aria-label="Ease into this keyframe"></select><button class="btn mini" id="kfdel" type="button">Delete ◆</button><button class="btn mini" id="kfclear" type="button">Clear all</button></div>
              <div class="kfsliders" id="kfsliders"></div>
              <span class="label kfml">Ready-made moves</span>
              <div class="kfmoves" id="kfmoves"></div>
              <p class="hint"><span id="kfinfo"></span>. Tap a text or sticker to animate it, otherwise the shot under the playhead. Pause where the move starts and set it; move the playhead and set it again. Drag the picture to move it. Double-tap a slider to reset it.</p>
            </details>
          </section>

          <button type="button" class="btn primary big fapply" id="fapply">${IC.check} Done</button>
          <section class="panel wide" data-panel="shots">
            <div class="shotcard" id="shotcard"></div>
            <details class="allshots" id="allshots"><summary>All shots</summary>
              <p class="note">One row per shot. Change any shot's transition, effect or speed, or press ↻ for a different moment. The rest of the edit stays, and no moment of footage is used twice.</p>
              <div class="edl"><table><thead><tr><th>Time</th><th>Type</th><th>Clip</th><th>Transition</th><th>Effect</th><th>Speed</th></tr></thead><tbody id="edl"></tbody></table></div>
            </details>
          </section>
        </div>
      </div>
    </div>
  </section>
</div>
<div class="savebar" id="savebar">
  <button class="btn save big" id="export" disabled>${IC.save}<span>Export</span></button>
  <label class="tog" title="For adding the same song as Instagram's own sound (trending audio)"><input type="checkbox" id="nosong"> Without the song (add it in Instagram)</label>
</div>
<!-- a saved Reel opening (/create/edit?p=): engine.ts openProject; flow.ts shows it from the first paint -->
<div class="openload" id="openload" role="status" aria-live="polite"><span class="openspin" aria-hidden="true"></span><b id="openh">Opening your Reel…</b><small id="openstep">Getting the song and the clips</small><a class="btn" href="/reels" id="openback">Back to My Reels</a></div>
<div class="toasts" id="toasts" role="status" aria-live="polite"></div>
<!-- the shot sheet: a shot tapped on the timeline (views.ts): over the clip on a computer, from the bottom on a phone -->
<section class="shotsheet" id="shotsheet" hidden role="dialog" aria-label="Shot">
  <div class="ss-head"><span class="ss-grip" aria-hidden="true"></span><button type="button" class="ss-x" id="ssx" aria-label="Close">${I('<path d="M6 6l12 12M18 6L6 18"/>')}</button></div>
  <div class="ss-body shotcard" id="ssbody"></div>
  <span class="ss-rs" aria-hidden="true" title="Drag to resize"></span>
</section>
<section class="fexp" id="fexp" hidden aria-live="polite" aria-labelledby="fexph">
  <h2 id="fexph">Exporting</h2>
  <div class="aoring"><svg viewBox="0 0 120 120"><circle class="bg" cx="60" cy="60" r="52"/><circle class="fg" id="fexpring" cx="60" cy="60" r="52" stroke-dasharray="326.7" stroke-dashoffset="326.7"/></svg><b id="fexppct">0%</b></div>
  <p class="fanst"><b>Making your Reel…</b><small>This may take a few moments. Please keep this screen open.</small></p>
  <ul class="faiList fanList" id="fexplist"><li data-at="0.02">${IC.scan}<span>Preparing clips</span></li><li data-at="0.3">${IC.spark}<span>Applying effects</span></li><li data-at="0.85">${IC.image}<span>Rendering video</span></li><li data-at="1">${IC.music}<span>Finalizing audio</span></li></ul>
</section>
<section class="fdone" id="fdone" hidden aria-labelledby="fdoneh">
  <div class="fdhead"><button type="button" class="fback" data-fd="close" aria-label="Back to your Reel">${IC.back}</button></div>
  <span class="fconf" aria-hidden="true">🎉</span>
  <h2 id="fdoneh">Reel Exported!</h2>
  <div class="fdvid"><video id="fdvideo" playsinline controls preload="metadata"></video></div>
  <p class="fdsaved"><b>Saved to your phone</b><small id="fdsize"></small></p>
  <button type="button" class="btn primary big" data-fd="share">${IC.upload}Share</button>
  <button type="button" class="btn big" data-fd="save">${IC.save}Save to Photos</button>
  <button type="button" class="btn big" data-fd="download">${IC.save}Download</button>
  <div class="fdcap" id="fdcap"><b>Caption for your Post</b></div>
</section>
<div class="xsheet" id="xsheet" hidden>
  <div class="xsh" role="dialog" aria-modal="true" aria-labelledby="xsht">
    <img class="xprev" id="xprev" alt="">
    <div class="xsh-h"><h2 id="xsht">Export Your Reel</h2><button type="button" class="ibtn" id="xshclose" aria-label="Close">✕</button></div>
    <p class="xsh-l">Quality</p>
    <div class="seg" id="xres" role="group" aria-label="Quality"><button type="button" data-r="720">720p</button><button type="button" data-r="1080" aria-pressed="true">1080p</button><button type="button" data-r="4k">4K</button></div>
    <p class="xsh-l">Frame rate</p>
    <div class="seg" id="xfps" role="group" aria-label="Frame rate"><button type="button" data-f="30" aria-pressed="true">30 fps</button><button type="button" data-f="60">60 fps</button></div>
    <p class="xsh-size" id="xsize"></p>
    <label class="xtog"><span class="xti">${I('<path d="M4 7h16M4 12h10M4 17h7"/><path d="M15 15l5 5M20 15l-5 5"/>')}</span><span class="xtt">Remove Watermark <a class="xpro" id="xwmpro" href="/pricing" title="Paid plans can remove the watermark">Pro</a></span><input type="checkbox" id="xwm" role="switch"><i aria-hidden="true"></i></label>
    <label class="xtog" id="xmyrow" hidden><span class="xti">${I('<rect x="3" y="4" width="18" height="16" rx="4"/><path d="M10 9.2v5.6l4.6-2.8z" fill="currentColor"/>')}</span><span class="xtt">Save to My Reels</span><input type="checkbox" id="xmy" role="switch" checked><i aria-hidden="true"></i></label>
    <button type="button" class="btn save big" id="xgo">${IC.save}<span>Export to phone</span></button>
    <button type="button" class="btn big" id="xgocloud" hidden><span>Export &amp; save to My Reels</span></button>
    <p class="xsh-note" id="xcloudnote" hidden></p>
  </div>
</div>`;
