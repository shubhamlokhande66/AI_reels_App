/** The Fast Studio page body (ids are what components/studio/engine.ts wires up). Everything runs in the browser. */
export const STUDIO_HTML = `
<div class="wrap">
  <header>
    <h1>Fast Studio</h1>
    <p class="sub">Give it a song and your clips: the edit is made on this device in seconds. Cuts land on real hits in the music,
      the best moments (sharp, faces, action) are picked, effects run on the GPU, and you export a 1080p MP4. Nothing is uploaded.</p>
  </header>

  <section class="step" id="s1">
    <div class="sh"><span class="num">1</span><h2>Music</h2><span class="st" id="s1st">Choose a song to start</span></div>
    <div class="row">
      <button class="btn primary" id="mpick">♬ Choose song</button>
      <input id="mfile" type="file" accept="audio/*,video/*" hidden>
      <span class="fname" id="mname">MP3, WAV, M4A or a video's sound</span>
    </div>
    <canvas class="wave" id="mwave"></canvas>
    <div class="stats">
      <span>Length <b id="mdur">—</b></span>
      <span>Tempo <b id="mbpm">—</b> BPM</span>
      <span>Shots <b id="mclips">—</b></span>
      <span>Drops <b id="mdrop">—</b></span>
      <span>Breaks <b id="mbreak">—</b></span>
    </div>
    <div class="legend">
      <span><i style="background:var(--drop)"></i>DROP: best shot</span>
      <span><i style="background:var(--hit)"></i>HIT: strong accent</span>
      <span><i style="background:var(--cut)"></i>CUT: plain cut</span>
      <span><i style="background:var(--break)"></i>BREAK: slow-motion</span>
    </div>
  </section>

  <section class="step locked" id="s2">
    <div class="sh"><span class="num">2</span><h2>Clips</h2><span class="st" id="s2st">Several clips or one long video</span></div>
    <div class="drop" id="dropzone" role="button" tabindex="0">Drop videos here or click to choose. You can add more at any time.</div>
    <input id="vfile" type="file" accept="video/*" multiple hidden>
    <div class="row">
      <button class="btn primary" id="addv">＋ Add videos</button>
      <button class="btn" id="clearv" hidden>Remove all</button>
      <span class="fname" id="qinfo"></span>
    </div>
    <div class="clips" id="clips"></div>
    <div class="row">
      <span class="label">Format</span>
      <div class="seg" id="aspect">
        <button data-a="9:16" aria-pressed="true">9:16 Reel</button>
        <button data-a="4:5" aria-pressed="false">4:5</button>
        <button data-a="1:1" aria-pressed="false">1:1</button>
        <button data-a="16:9" aria-pressed="false">16:9</button>
      </div>
    </div>
  </section>

  <section class="step locked" id="s3">
    <div class="sh"><span class="num">3</span><h2>Create</h2><span class="st" id="s3st">The edit appears once there are clips</span></div>
    <div class="create">
      <div class="stage">
        <canvas id="out" width="1080" height="1920"></canvas>
        <div class="bar"><i id="prog"></i></div>
        <div class="row" style="justify-content:center">
          <button class="btn primary" id="play" disabled>▶ Preview</button>
          <button class="btn" id="remix" disabled>↻ New mix</button>
          <button class="btn hot" id="export" disabled>⬇ Export 1080p MP4</button>
          <button class="btn" id="cover" disabled>Cover image</button>
        </div>
        <div class="msg" id="xmsg" hidden></div>
        <div class="opts">
          <span class="label">Style</span>
          <div class="seg" id="mode">
            <button data-m="auto" aria-pressed="true">Auto</button>
            <button data-m="smooth" aria-pressed="false">Smooth</button>
            <button data-m="fast" aria-pressed="false">Fast</button>
          </div>
          <span class="fname" id="modehelp">Auto: the music decides. Calm parts get longer shots, drops and hits get effects.</span>
          <label class="label" for="hook">Hook text (3-5 words, first 2 seconds)</label>
          <input id="hook" type="text" maxlength="40" placeholder="e.g. WAIT FOR THE DROP">
          <span class="label">Look</span>
          <div class="seg" id="look"><button data-l="natural" aria-pressed="false">Natural</button><button data-l="vivid" aria-pressed="true">Vivid</button><button data-l="cine" aria-pressed="false">Cinematic</button><button data-l="mono" aria-pressed="false">B&amp;W</button></div>
          <label class="tog"><input type="checkbox" id="safe" checked> Show Instagram safe zones (preview only)</label>
        </div>
      </div>
      <div style="display:grid;gap:10px;min-width:0">
        <p class="note"><b>Timeline:</b> one block per shot (colour = clip). Change any shot's transition, effect or speed,
          or press ↻ for a different moment. The rest of the edit stays, and no moment of footage is used twice.</p>
        <canvas id="tl" class="tl" aria-label="Timeline, one block per shot"></canvas>
        <div class="edl"><table><thead><tr><th>Time</th><th>Type</th><th>Clip</th><th>Transition</th><th>Effect</th><th>Speed</th></tr></thead><tbody id="edl"></tbody></table></div>
      </div>
    </div>
  </section>
</div>`;
