# Reference Reels with known style, to score Fast Studio's "copy a Reel" analysis: every cut on a known beat of a known
# song, a known transition at each cut, a known colour grade, known zooms. Writes out/<name>.webm and out/truth.json.
#   cd scripts/studio-style && python3 make_refs.py      (needs numpy and ffmpeg; uses ../studio-beats/make_set1.py's song)
import json, os, subprocess, sys, wave
import numpy as np
W, H, FPS, SR = 540, 960, 30, 44100
os.makedirs('out', exist_ok=True)
rng = np.random.default_rng(5)

# ---- the music: a 128 BPM drum + melody song with known beats (same synthesis as the beat benchmark)
sys.path.insert(0, '../studio-beats')
BPM, START = 128.0, 0.5
P = 60/BPM
def song(dur):
    t = np.arange(int(dur*SR))/SR; x = np.zeros_like(t)
    def hit(at, f0, f1, d, a):
        i = int(at*SR); n = min(int(d*SR), len(x)-i)
        if n <= 0: return
        tt = np.arange(n)/SR; f = f1 + (f0-f1)*np.exp(-tt/0.03)
        x[i:i+n] += a*np.sin(2*np.pi*np.cumsum(f)/SR)*np.exp(-tt/(d*0.4))
    def noise(at, d, a):
        i = int(at*SR); n = min(int(d*SR), len(x)-i)
        if n <= 0: return
        x[i:i+n] += a*rng.standard_normal(n)*np.exp(-np.arange(n)/SR/(d*0.3))
    k = 0; b = START
    while b < dur-0.05:
        hit(b, 120, 50, 0.3, 0.9)
        if k % 2: noise(b, 0.18, 0.35)
        noise(b+P/2, 0.04, 0.12)
        k += 1; b += P
    x += 0.08*np.sin(2*np.pi*220*t)*(0.5+0.5*np.sin(2*np.pi*t/(4*P)))
    return np.tanh(1.5*x)/np.tanh(1.5)*0.8
def beat(k): return START + k*P

# ---- footage: each shot its own textured scene that moves a little (so cuts are real changes, shots are not still)
def tex(seed, pal):
    r = np.random.default_rng(seed); img = np.zeros((H+200, W+200))
    for k, s in enumerate([160, 80, 40, 20]):
        g = r.random((int((H+200)/s)+2, int((W+200)/s)+2))
        yy = np.linspace(0, g.shape[0]-1.001, H+200); xx = np.linspace(0, g.shape[1]-1.001, W+200)
        y0, x0 = yy.astype(int), xx.astype(int); fy, fx = (yy-y0)[:, None], (xx-x0)[None, :]
        img += (g[y0][:, x0]*(1-fx)*(1-fy) + g[y0][:, x0+1]*fx*(1-fy) + g[y0+1][:, x0]*(1-fx)*fy + g[y0+1][:, x0+1]*fx*fy)*0.5**k
    img = ((img-img.min())/(img.max()-img.min()))**1.6; p = np.array(pal, float); t = img[..., None]   # real shadows
    out = np.where(t < 0.5, p[0]+(p[1]-p[0])*t*2, p[1]+(p[2]-p[1])*(t-0.5)*2)
    # a subject: a bright disc, so shots have something to look at
    cy, cx = (H+200)//2 + r.integers(-150, 150), (W+200)//2 + r.integers(-120, 120); yy, xx = np.ogrid[:H+200, :W+200]
    out[(yy-cy)**2 + (xx-cx)**2 < 70**2] = p[2]*0.6 + np.array([90, 40, 30])
    return out.clip(0, 255)
PALS = [[(20,40,15),(70,120,50),(170,200,140)], [(40,10,30),(200,80,40),(250,210,120)], [(5,20,60),(30,110,170),(200,230,240)],
        [(30,30,30),(130,120,110),(230,220,210)], [(50,20,60),(150,60,150),(240,200,240)], [(10,40,40),(40,140,120),(200,240,220)]]
def shot_frames(seed, n, zoom=0.0):
    img = tex(seed, PALS[seed % len(PALS)]); out = []
    for j in range(n):
        u = j/max(1, n-1); dx = int(100 + 30*np.sin(seed + u*2)); dy = int(100 + 20*np.cos(seed + u*2))
        if zoom:
            s = 1 + zoom*u; ch, cw = int(H/s), int(W/s); y0 = 100 + (H-ch)//2; x0 = 100 + (W-cw)//2
            crop = img[y0:y0+ch, x0:x0+cw]; yi = (np.arange(H)*ch/H).astype(int); xi = (np.arange(W)*cw/W).astype(int); out.append(crop[yi][:, xi])
        else: out.append(img[dy:dy+H, dx:dx+W])
    return out

# ---- transitions over the last / first frames around a cut
def blend(a, b, u): return a*(1-u) + b*u
def apply_transition(A, B, kind):   # A: frames ending at the cut, B: frames starting at it (both long enough)
    if kind == 'hard': return A, B
    if kind == 'dissolve':   # 0.4 s centred on the cut
        n = 6
        for j in range(n): u = (j+1)/(2*n+1); A[-n+j] = blend(A[-n+j], B[0], u)
        for j in range(n): u = (n+j+1)/(2*n+1); B[j] = blend(A[-1], B[j], u)
        return A, B
    if kind == 'fade':       # through black, 0.25 s each side
        n = 7
        for j in range(n): A[-n+j] = A[-n+j]*(1-(j+1)/n)
        for j in range(n): B[j] = B[j]*((j+1)/n)
        return A, B
    if kind == 'flash':      # white flash on the cut, gone in 0.2 s
        for j in range(6): B[j] = blend(B[j], np.full_like(B[j], 255.0), (1-j/6)**2)
        A[-1] = blend(A[-1], np.full_like(A[-1], 255.0), 0.5)
        return A, B
    if kind == 'whip':       # fast horizontal slide with motion blur, 0.17 s
        n = 5
        for j in range(n):
            u = (j+1)/(n+1); sh = int(u*W); fr = np.concatenate([A[-n+j][:, sh:], B[0][:, :sh]], axis=1) if sh else A[-n+j]
            k = 41; fr = np.apply_along_axis(lambda r: np.convolve(r, np.ones(k)/k, mode='same'), 1, fr); A[-n+j] = fr
        return A, B
    if kind == 'zoom':       # zoom-through: A scales up and blurs into B
        n = 5
        for j in range(n):
            s = 1 + 0.8*((j+1)/n)**2; ch, cw = int(H/s), int(W/s); y0 = (H-ch)//2; x0 = (W-cw)//2
            crop = A[-n+j][y0:y0+ch, x0:x0+cw]; yi = (np.arange(H)*ch/H).astype(int); xi = (np.arange(W)*cw/W).astype(int)
            A[-n+j] = blend(crop[yi][:, xi], B[0], ((j+1)/(n+1))**2*0.6)
        return A, B
    raise ValueError(kind)

# ---- colour grades (applied to the whole film)
def grade(fr, g):
    x = fr/255.0
    if g.get('lift'): x = g['lift'] + x*(1-g['lift'])
    x = (x-0.5)*g.get('con', 1) + 0.5
    l = x[..., :1]*0.299 + x[..., 1:2]*0.587 + x[..., 2:]*0.114
    x = l + (x-l)*g.get('sat', 1)
    if g.get('warm'): x = x*np.array([1+0.12*g['warm'], 1, 1-0.12*g['warm']])
    if g.get('teal'):
        lt = l.clip(0, 1); tint = np.where(lt < 0.5, np.array([0.8, 1.02, 1.12]), np.array([1.12, 1.0, 0.85])); x = x*(1-g['teal']) + x*tint*g['teal']
    if g.get('mono'): x = x*(1-g['mono']) + l*g['mono']
    if g.get('vig'):
        yy, xx = np.ogrid[:H, :W]; d = np.sqrt(((xx-W/2)/(W/2))**2 + ((yy-H/2)/(H/2))**2)/np.sqrt(2); x = x*(1 - g['vig']*np.clip((d-0.3)/0.45, 0, 1)**2)[..., None]
    if g.get('grain'): x = x + (rng.random(x.shape[:2])[..., None]-0.5)*g['grain']
    return (x.clip(0, 1)*255).astype(np.uint8)

REFS = {
  'fast_flash':    dict(every=[1], trans={'hard': 0.7, 'flash': 0.3}, grade=dict(con=1.3, sat=1.4, warm=0.6), zoom=0, dur=16),
  'calm_dissolve': dict(every=[4], trans={'dissolve': 1.0}, grade=dict(con=0.95, sat=0.7, teal=0.7, lift=0.08, vig=0.5), zoom=0, dur=20),
  'mono_fade':     dict(every=[2], trans={'hard': 0.5, 'fade': 0.5}, grade=dict(con=1.25, mono=1.0, grain=0.12), zoom=0, dur=18),
  'whip_zoom':     dict(every=[2, 2, 1, 1], trans={'whip': 0.5, 'zoom': 0.5}, grade=dict(con=1.05, sat=1.05), zoom=0.18, dur=18),
}
truth = {}
for name, cfg in REFS.items():
    dur = cfg['dur']; nb = int((dur-START)/P)
    # cut beats: a pattern of beats-per-shot, the first shot a little longer (the hook)
    cuts_b = []; k = 2 if cfg['every'][0] == 1 else cfg['every'][0]; i = 0
    while k < nb-1: cuts_b.append(k); k += cfg['every'][i % len(cfg['every'])]; i += 1
    cuts = [beat(k) for k in cuts_b]
    kinds = list(cfg['trans'].keys()); probs = np.array(list(cfg['trans'].values()))
    counts = np.floor(probs*len(cuts)).astype(int); rem = len(cuts) - counts.sum()
    for j in np.argsort(-(probs*len(cuts) - counts))[:rem]: counts[j] += 1
    seq = sum([[kinds[j]]*counts[j] for j in range(len(kinds))], []); rng.shuffle(seq)
    bounds = [0.0] + cuts + [dur]; frames = []; zooms = []
    shots = []
    for s in range(len(bounds)-1):
        a, b = round(bounds[s]*FPS), round(bounds[s+1]*FPS); z = cfg['zoom'] if (cfg['zoom'] and s % 2 == 0) else 0
        shots.append(shot_frames(100*len(name) + s, b-a, z)); zooms.append(bool(z))
    for c in range(len(cuts)):
        shots[c], shots[c+1] = apply_transition(shots[c], shots[c+1], seq[c])
    frames = [grade(f, cfg['grade']) for sh in shots for f in sh]
    audio = song(dur)
    with wave.open('out/_a.wav', 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes((audio*32767).astype(np.int16).tobytes())
    p = subprocess.Popen(['ffmpeg', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-', '-i', 'out/_a.wav',
                          '-c:v', 'libvpx-vp9', '-b:v', '3M', '-deadline', 'realtime', '-cpu-used', '8', '-pix_fmt', 'yuv420p', '-c:a', 'libopus', '-b:a', '128k', '-shortest', f'out/{name}.webm'], stdin=subprocess.PIPE)
    for f in frames: p.stdin.write(np.ascontiguousarray(f).tobytes())
    p.stdin.close(); p.wait()
    truth[name] = dict(cuts=[round(c, 4) for c in cuts], cut_beats=cuts_b, transitions=seq, grade=cfg['grade'], zoom_shots=zooms, bpm=BPM,
                       beats_per_shot=float(np.median(np.diff([0] + cuts_b))), dur=dur)
    print(name, len(cuts), 'cuts', dict(zip(*np.unique(seq, return_counts=True))))
os.remove('out/_a.wav')
json.dump(truth, open('out/truth.json', 'w'), indent=1)
