/** The Fast Studio page body (ids are what components/studio/engine.ts wires up). Everything runs in the browser. */
export const STUDIO_HTML = `
<div class="wrap">
  <header>
    <h1>Fast Studio</h1>
    <p class="sub">Give it a song and your clips: the edit is made on this device in seconds. Cuts land on real hits in the music,
      the best moments (sharp, faces, action) are picked, effects run on the GPU, and you export a 1080p MP4. Nothing is uploaded.</p>
  </header>

  <div class="projects" id="projects" hidden>
    <div class="row"><span class="label">Your Reels (saved on this phone)</span><button class="btn mini" id="pnew" type="button">+ New Reel</button><span class="fname" id="psaved"></span></div>
    <div class="plist" id="plist"></div>
  </div>

  <div class="row kindrow">
    <span class="label">What are you making?</span>
    <div class="seg" id="kind" role="group" aria-label="Kind of Reel">
      <button data-k="music" aria-pressed="true">🎵 Music edit</button><button data-k="talk" aria-pressed="false">🗣 Talking · vlog · tutorial</button>
    </div>
  </div>

  <div class="row tplrow">
    <span class="label">Or start from a template</span>
    <div class="seg tpl" id="tpl" role="group" aria-label="Templates">
      <button data-t="talking" aria-pressed="false">🗣 Talking head</button><button data-t="tutorial" aria-pressed="false">📚 Tutorial</button><button data-t="recipe" aria-pressed="false">🍲 Recipe</button><button data-t="beforeafter" aria-pressed="false">✨ Before / After</button><button data-t="product" aria-pressed="false">🛍 Product</button><button data-t="montage" aria-pressed="false">⚡ Beat montage</button><button data-t="travel" aria-pressed="false">🧳 Travel</button><button data-t="ganpati" aria-pressed="false">🌺 Ganpati</button><button data-t="diwali" aria-pressed="false">🪔 Diwali</button>
    </div>
    <span class="fname" id="tplhelp"></span>
  </div>

  <section class="step" id="s1">
    <div class="sh"><span class="num">1</span><h2>Music</h2><span class="st" id="s1st">Choose a song to start</span></div>
    <div class="row">
      <button class="btn primary" id="mpick">♬ Choose song</button>
      <input id="mfile" type="file" accept="audio/*,video/*,.mp3,.m4a,.aac,.wav,.mov,.mp4" hidden>
      <span class="fname" id="mname">MP3, M4A, WAV or any video's sound (iPhone: from Files or Photos)</span>
    </div>
    <div class="recent" id="recent" hidden><span class="label">Recent songs</span><div class="rlist" id="rlist"></div></div>
    <canvas class="wave" id="mwave"></canvas>
    <div class="row lenrow" id="lenrow" hidden>
      <span class="label">Reel length</span>
      <div class="seg" id="slen" role="group" aria-label="How much of the song">
        <button data-l="0" aria-pressed="true">Full song</button><button data-l="15" aria-pressed="false">15 s</button><button data-l="30" aria-pressed="false">30 s</button><button data-l="60" aria-pressed="false">1 min</button><button data-l="c" aria-pressed="false">Custom</button>
      </div>
      <label class="lenc" hidden id="slencw"><input id="slenc" type="number" inputmode="numeric" min="5" max="180" step="1" value="45"> s</label>
      <button class="btn" id="sauto" hidden title="Pick the strongest part of the song again">✨ Best part</button>
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
      <span><i style="background:var(--drop)"></i>DROP: best shot</span>
      <span><i style="background:var(--hit)"></i>HIT: strong accent</span>
      <span><i style="background:var(--cut)"></i>CUT: plain cut</span>
      <span><i style="background:var(--break)"></i>BREAK: slow-motion</span>
    </div>
  </section>

  <section class="step locked" id="s2">
    <div class="sh"><span class="num">2</span><h2>Clips</h2><span class="st" id="s2st">Several clips or one long video</span></div>
    <div class="drop" id="dropzone" role="button" tabindex="0">Drop videos here or click to choose. You can add more at any time.</div>
    <input id="vfile" type="file" accept="video/*,.mov,.mp4,.m4v" multiple hidden>
    <div class="row">
      <button class="btn primary" id="addv">＋ Add videos</button>
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
      <label class="tog"><input type="checkbox" id="dn1" checked> 🧹 Clean up voice noise</label>
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
          <button class="btn hot" id="export" disabled>⬇ Export 1080p MP4</button><label class="tog" title="For adding the same song as Instagram's own sound (trending audio)"><input type="checkbox" id="nosong"> Without the song</label>
          <button class="btn" id="cover" disabled>Cover image</button>
        </div>
        <div class="row vorow" id="vorow" style="justify-content:center"><button class="btn" id="vorec" type="button">🎙 Record voiceover</button><button class="btn mini" id="vodel" type="button" hidden>Remove voiceover</button><label class="tog"><input type="checkbox" id="dn2" checked> 🧹 Clean up noise</label><span class="fname" id="vostat"></span></div>
        <details class="kfbox" id="kfbox"><summary>◆ Keyframes: move, zoom, turn, fade a shot or a text</summary>
          <div class="kfhead"><span class="fname" id="kftarget"></span><select id="kfpreset" aria-label="Ready-made move"><option value="">Ready-made move…</option></select></div>
          <canvas id="kftl" class="kftl" aria-label="Keyframes of the shot or text; tap to move the playhead"></canvas>
          <div class="row kfbtns"><button class="btn mini" id="kfprev" type="button" aria-label="Previous keyframe">◀ ◆</button><button class="btn mini" id="kfadd" type="button">◇ Add keyframe</button><button class="btn mini" id="kfnext" type="button" aria-label="Next keyframe">◆ ▶</button><select id="kfease" aria-label="Ease into this keyframe"></select><button class="btn mini" id="kfdel" type="button">Delete ◆</button><button class="btn mini" id="kfclear" type="button">Clear all</button></div>
          <div class="kfsliders" id="kfsliders"></div>
          <p class="hint"><span id="kfinfo"></span>. Tap a text or sticker to animate it, otherwise the shot under the playhead. Pause where the move starts and set it; move the playhead and set it again. Drag the picture to move it. Double-tap a slider to reset it.</p>
        </details>
        <div class="msg" id="xmsg" hidden></div>
        <div class="row" id="saverow" hidden style="justify-content:center"><button class="btn hot" id="savevid">Save to Photos / Share</button><a class="btn" id="dlvid">Download</a></div>
        <div class="opts">
          <span class="label">Style</span>
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
          <label class="tog" id="capwrap" hidden><input type="checkbox" id="caps"> Captions: the words of the song, word by word</label>
          <div class="row" id="caprow" hidden><select id="caplang" aria-label="Language of the song"><option value="">Language: detect</option><option value="hi">Hindi</option><option value="mr">Marathi</option><option value="en">English</option><option value="gu">Gujarati</option><option value="pa">Punjabi</option><option value="bn">Bengali</option><option value="ta">Tamil</option><option value="te">Telugu</option></select><select id="captr" aria-label="Also show the captions in"><option value="">Translation: off</option><option value="mr">+ मराठी (Marathi)</option><option value="hi">+ हिंदी (Hindi)</option><option value="en">+ English</option><option value="hinglish">+ Hinglish</option><option value="gu">+ ગુજરાતી</option><option value="bn">+ বাংলা</option><option value="ta">+ தமிழ்</option><option value="te">+ తెలుగు</option><option value="pa">+ ਪੰਜਾਬੀ</option></select><label class="tog" id="trwrap" hidden><input type="checkbox" id="tronly"> Only the translation</label><span class="fname" id="capstat"></span><label class="tog" id="kwwrap"><input type="checkbox" id="kwon" checked> ✨ Key words + zoom (talking, voiceover)</label></div>
          <span class="label">Look</span>
          <div class="seg" id="look"><button data-l="natural" aria-pressed="false">Natural</button><button data-l="vivid" aria-pressed="true">Vivid</button><button data-l="cine" aria-pressed="false">Cinematic</button><button data-l="mono" aria-pressed="false">B&amp;W</button><button data-l="copy" aria-pressed="false" hidden>Copied</button></div>
          <span class="label">Background</span>
          <div class="seg" id="bgmode" role="group" aria-label="Background behind the person"><button data-b="none" aria-pressed="true">Original</button><button data-b="blur" aria-pressed="false">Blur</button><button data-b="color" aria-pressed="false">Colour</button><button data-b="photo" aria-pressed="false">Photo</button></div>
          <div class="row" id="bgrow" hidden><span class="ovc" id="bgcolors" hidden></span><button class="btn mini" id="bgpick" type="button" hidden>Choose photo</button><input id="bgfile" type="file" accept="image/*" hidden></div>
          <span class="fname" id="bgstat"></span>
          <label class="tog" id="aiwrap" hidden><input type="checkbox" id="aipick"> AI picks the best moments</label>
          <span class="fname" id="aistat" hidden></span>
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
