/** The Fast Studio page body (ids are what components/studio/engine.ts wires up). Everything runs in the browser.
 *
 * Three views of the same Reel (the .brs root carries v-simple / v-editor / v-pro, set by app/studio/page.tsx):
 * - Simple: the steps, then the preview, a few big cards that open one panel each, and a "Save video" bar.
 * - Editor: the song and clips fold into one line each; the preview, the timeline strip and a tool dock that shows one
 *   panel at a time (shots, music, text, captions, look, motion, background, voice, style).
 * - Pro: every panel open in an inspector beside the preview, the timeline and the edit list underneath.
 * The panels are the same elements in every view: only what is shown changes. */
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
};
// a tool: a dock button (Editor), a card (Simple) and the heading of its panel (Pro)
const TOOLS: [string, string, string][] = [
  ["shots", "Shot", IC.shot], ["music", "Music", IC.music], ["text", "Text", IC.text], ["captions", "Captions", IC.captions],
  ["look", "Look", IC.look], ["motion", "Motion", IC.motion], ["bg", "Background", IC.bg], ["voice", "Voice", IC.voice], ["style", "Style", IC.style],
];
// Editor: every tool; Pro: grouped (Shot = the shot + keyframes, Audio = music + voice, Look = look + style)
const PRO_TOOLS: [string, string, string][] = [["pshot", "Shot", IC.shot], ["text", "Text", IC.text], ["audio", "Audio", IC.music], ["plook", "Look", IC.look], ["bg", "Background", IC.bg]];
const dock = TOOLS.map(([k, n, ic]) => `<button type="button" class="tool ed" data-tool="${k}" aria-pressed="false">${ic}<span>${n}</span></button>`).join("")
  + PRO_TOOLS.map(([k, n, ic]) => `<button type="button" class="tool pr" data-tool="${k}" aria-pressed="false">${ic}<span>${n}</span></button>`).join("");
const card = (k: string, n: string, ic: string) =>
  `<button type="button" class="card" data-tool="${k}" aria-expanded="false">${ic}<span class="ct"><b>${n}</b><span class="cv" data-cv="${k}"></span></span></button>`;
const panelHead = (k: string) => { const t = TOOLS.find((x) => x[0] === k)!; return `<h3 class="ph">${t[2]}${t[1]}</h3>`; };

export const STUDIO_HTML = `
<div class="topbar" id="topbar">
  <button type="button" class="ibtn tb-menu" id="menubtn" aria-label="Menu">${IC.menu}</button>
  <a class="tb-brand" href="/"><span class="tb-logo">R</span><span>Reel Maison</span></a>
  <div class="tb-title"><span class="tb-name" id="tbname">Fast Studio</span><span class="tb-sub" id="psaved"></span></div>
  <nav class="tb-nav" id="tbnav" aria-label="Main"></nav>
  <span class="tb-gap"></span>
  <div class="tb-right" id="tbright"></div>
  <div class="views" id="views" role="group" aria-label="View">
    <button type="button" data-view="simple" aria-pressed="true">Simple</button><button type="button" data-view="editor" aria-pressed="false">Editor</button><button type="button" data-view="pro" aria-pressed="false">Pro</button>
  </div>
  <button type="button" class="btn save tb-export" id="topexport" disabled>${IC.save}<span>Export</span></button>
</div>
<div class="wrap">
  <header class="hero">
    <div class="hero-t"><h1>What are we making today?</h1>
    <p class="sub">Your song and clips become a Reel in seconds, on this device. Nothing is uploaded.</p></div>
    <button class="btn ink hero-new" id="pnew" type="button">${IC.plus}New Reel</button>
  </header>

  <div class="starts">
    <div class="kinds" id="kind" role="group" aria-label="Kind of Reel">
      <button data-k="music" aria-pressed="true">${IC.music}<span><b>Music Reel</b><small>Cuts land on every beat</small></span></button>
      <button data-k="talk" aria-pressed="false">${IC.voice}<span><b>Talking Reel</b><small>Pauses cut, captions added</small></span></button>
    </div>
    <button type="button" class="copycard" id="copycard">${IC.copy}<span><b>Copy a Reel</b><small>Match a reference's cuts and look</small></span>${IC.chev}</button>
  </div>

  <div class="homerow">
    <div class="projects" id="projects" hidden>
      <div class="hrow"><h2>Continue editing</h2><a href="/projects">All projects</a></div>
      <div class="plist" id="plist"></div>
    </div>
    <aside class="stylelib" id="stylelib" hidden>
      <div class="hrow"><h2>Your style library</h2><a href="/studio?view=pro&amp;tool=style">Manage</a></div>
      <div class="slist" id="slist"></div>
      <button type="button" class="teach" id="teach">+ Teach a new style from a Reel</button>
    </aside>
  </div>

  <div class="tplrow">
    <span class="label">Templates</span>
    <div class="tpl" id="tpl" role="group" aria-label="Templates">
      <button data-t="talking" aria-pressed="false">Talking head</button><button data-t="tutorial" aria-pressed="false">Tutorial</button><button data-t="recipe" aria-pressed="false">Recipe</button><button data-t="beforeafter" aria-pressed="false">Before / After</button><button data-t="product" aria-pressed="false">Product</button><button data-t="montage" aria-pressed="false">Beat montage</button><button data-t="travel" aria-pressed="false">Travel</button><button data-t="ganpati" aria-pressed="false">Ganpati</button><button data-t="diwali" aria-pressed="false">Diwali</button>
    </div>
    <span class="fname" id="tplhelp"></span>
  </div>

  <section class="step" id="s1">
    <button type="button" class="sh" aria-expanded="true"><span class="num">1</span><h2>Music</h2><span class="st" id="s1st">Choose a song to start</span></button>
    <div class="sbody">
    <div class="row">
      <button class="btn primary" id="mpick">${IC.music}Choose song</button>
      <input id="mfile" type="file" accept="audio/*,video/*,.mp3,.m4a,.aac,.wav,.mov,.mp4" hidden>
      <span class="fname" id="mname">MP3, M4A, WAV or any video's sound (iPhone: from Files or Photos)</span>
    </div>
    <div class="recent" id="recent" hidden><span class="label">Recent songs</span><div class="rlist" id="rlist"></div></div>
    <canvas class="wave" id="mwave"></canvas>
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
      <span>Tempo <b id="mbpm">—</b> BPM</span>
      <span>Shots <b id="mclips">—</b></span>
      <span>Drops <b id="mdrop">—</b></span>
      <span>Breaks <b id="mbreak">—</b></span>
    </div>
    <div class="legend">
      <span><i style="background:var(--drop)"></i>Drop: best shot</span>
      <span><i style="background:var(--hit)"></i>Hit: strong accent</span>
      <span><i style="background:var(--cut)"></i>Cut: plain cut</span>
      <span><i style="background:var(--break)"></i>Break: slow motion</span>
    </div>
    </div>
  </section>

  <section class="step locked" id="s2">
    <button type="button" class="sh" aria-expanded="true"><span class="num">2</span><h2>Clips</h2><span class="st" id="s2st">Several clips or one long video</span></button>
    <div class="sbody">
    <div class="drop" id="dropzone" role="button" tabindex="0">Drop videos here or tap to choose. You can add more at any time.</div>
    <input id="vfile" type="file" accept="video/*,.mov,.mp4,.m4v" multiple hidden>
    <div class="row">
      <button class="btn primary" id="addv">+ Add videos</button>
      <button class="btn" id="clearv" hidden>Remove all</button>
      <span class="fname" id="qinfo"></span>
    </div>
    <div class="clips" id="clips"></div>
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
    </div>
  </section>

  <section class="step locked" id="s3">
    <div class="sh3"><span class="num">3</span><h2>Your Reel</h2><span class="st" id="s3st">The edit appears once there are clips</span></div>
    <div class="create">
      <div class="stage">
        <div class="pv">
          <div class="pvbox"><canvas id="out" width="1080" height="1920"></canvas>
            <button type="button" class="playov" id="playov" aria-label="Play preview">${IC.play}</button></div>
          <div class="summary" id="summary">
            <h2 class="sumh">Your Reel is ready</h2>
            <p class="sumi" id="suminfo"></p>
            <button type="button" class="btn" data-proxy="remix">${IC.mix}<span>New mix</span></button>
          </div>
          <div class="inspector" id="inspector"></div>
        </div>
        <div class="bar"><i id="prog"></i></div>
        <div class="transport">
          <span class="tc" id="tcur">0:00.0</span>
          <button class="btn icon" id="pshot" type="button" aria-label="Previous shot">${IC.prev}</button>
          <button class="btn icon" id="cover" disabled aria-label="Cover image" title="Cover image">${IC.image}<span>Cover</span></button>
          <button class="btn primary" id="play" disabled>${IC.play}<span>Preview</span></button>
          <button class="btn icon" id="remix" disabled aria-label="New mix" title="New mix">${IC.mix}<span>New mix</span></button>
          <button class="btn icon" id="nshot" type="button" aria-label="Next shot">${IC.next}</button>
          <span class="tc" id="ttot">0:00.0</span>
        </div>
        <div class="strip"><canvas id="tl" class="tl" aria-label="Timeline, one block per shot"></canvas><div class="tlmusic" id="tlmusic"></div></div>
        <canvas class="lanes" id="lanes" aria-label="Timeline: video, text, voice and music; tap to move the playhead"></canvas>
        <label class="tog safe"><input type="checkbox" id="safe" checked> Instagram safe zones (preview only)</label>
        <div class="msg" id="xmsg" hidden></div>
        <div class="row" id="saverow" hidden><button class="btn gold" id="savevid">Save to Photos / Share</button><a class="btn" id="dlvid">Download</a></div>
      </div>

      <div class="tools">
        <nav class="dock" id="dock" aria-label="Tools">${dock}</nav>
        <div class="cards" id="cards">
          <div class="cgrid">${card("style", "Style", IC.style)}${card("text", "Text", IC.text)}${card("look", "Look", IC.look)}${card("music", "Music", IC.music)}</div>
          <button type="button" class="more" data-goview="editor">Want to change every shot? Open the Editor view ${IC.chev}</button>
        </div>

        <div class="panels" id="panels">
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
            <label class="tog" id="aiwrap" hidden><input type="checkbox" id="aipick"> AI picks the best moments</label>
            <span class="fname" id="aistat" hidden></span>
          </section>

          <section class="panel" data-panel="music">${panelHead("music")}
            <div class="row"><button type="button" class="btn" data-open-step="s1">${IC.music}Change the song or its part</button><button type="button" class="btn" data-open-step="s2">${IC.plus}Add or change clips</button></div>
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
            <div class="seg" id="look"><button data-l="natural" aria-pressed="false">Natural</button><button data-l="vivid" aria-pressed="true">Vivid</button><button data-l="cine" aria-pressed="false">Cinematic</button><button data-l="mono" aria-pressed="false">B&amp;W</button><button data-l="copy" aria-pressed="false" hidden>Copied</button></div>
          </section>

          <section class="panel" data-panel="bg">${panelHead("bg")}
            <div class="seg" id="bgmode" role="group" aria-label="Background behind the person"><button data-b="none" aria-pressed="true">Original</button><button data-b="blur" aria-pressed="false">Blur</button><button data-b="color" aria-pressed="false">Colour</button><button data-b="photo" aria-pressed="false">Photo</button></div>
            <div class="row" id="bgrow" hidden><span class="ovc" id="bgcolors" hidden></span><button class="btn mini" id="bgpick" type="button" hidden>Choose photo</button><input id="bgfile" type="file" accept="image/*" hidden></div>
            <span class="fname" id="bgstat"></span>
          </section>

          <section class="panel" data-panel="voice">${panelHead("voice")}
            <div class="row vorow" id="vorow"><button class="btn" id="vorec" type="button">${IC.voice}Record voiceover</button><button class="btn mini" id="vodel" type="button" hidden>Remove voiceover</button><label class="tog"><input type="checkbox" id="dn2" checked> Clean up noise</label><span class="fname" id="vostat"></span></div>
            <p class="hint talkonly">Talking videos: pauses, music under the voice and noise cleanup are in step 2.</p>
          </section>

          <section class="panel" data-panel="motion">${panelHead("motion")}
            <details class="kfbox" id="kfbox"><summary>Keyframes: move, zoom, turn, fade a shot or a text</summary>
              <div class="kfhead"><span class="fname" id="kftarget"></span><select id="kfpreset" aria-label="Ready-made move"><option value="">Ready-made move…</option></select></div>
              <canvas id="kftl" class="kftl" aria-label="Keyframes of the shot or text; tap to move the playhead"></canvas>
              <div class="row kfbtns"><button class="btn mini" id="kfprev" type="button" aria-label="Previous keyframe">◀ ◆</button><button class="btn mini" id="kfadd" type="button">◇ Add keyframe</button><button class="btn mini" id="kfnext" type="button" aria-label="Next keyframe">◆ ▶</button><select id="kfease" aria-label="Ease into this keyframe"></select><button class="btn mini" id="kfdel" type="button">Delete ◆</button><button class="btn mini" id="kfclear" type="button">Clear all</button></div>
              <div class="kfsliders" id="kfsliders"></div>
              <p class="hint"><span id="kfinfo"></span>. Tap a text or sticker to animate it, otherwise the shot under the playhead. Pause where the move starts and set it; move the playhead and set it again. Drag the picture to move it. Double-tap a slider to reset it.</p>
            </details>
          </section>

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
  <button class="btn save big" id="export" disabled>${IC.save}<span>Save video · 1080p</span></button>
  <label class="tog" title="For adding the same song as Instagram's own sound (trending audio)"><input type="checkbox" id="nosong"> Without the song (add it in Instagram)</label>
</div>`;
