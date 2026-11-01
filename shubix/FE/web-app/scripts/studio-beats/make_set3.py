# Set 3: realistic rhythms of the songs people put on Reels in India, with known beat times (truth.json + .wav).
# Synthesised (no copyrighted audio): 808s with long tails that also move on the off-beats, triplet hats, claps, dhol,
# dholki, tabla, harmonium-like drones, a sung-like lead whose notes start off the beat, and a free-time intro.
#   cd scripts/studio-beats && mkdir -p set3 && cd set3 && python3 ../make_set3.py && node ../score.mjs ../../../components/studio/engine.ts
import json, wave, numpy as np
SR = 44100
rng = np.random.default_rng(3)

def env(n, a, d):  # attack (s), exponential decay time (s)
    t = np.arange(n)/SR; e = np.exp(-t/d); na = max(1, int(a*SR)); e[:na] *= np.linspace(0, 1, na); return e
def kick(l=0.35, f0=120, f1=45, tail=0.0):
    n = int((l+tail)*SR); t = np.arange(n)/SR; f = f1 + (f0-f1)*np.exp(-t/0.03); ph = 2*np.pi*np.cumsum(f)/SR
    x = np.sin(ph)*env(n, 0.002, 0.12 + tail*0.6)
    return x + 0.25*np.random.default_rng(1).standard_normal(n)*env(n, 0.0005, 0.004)   # click
def b808(l=0.7, f=48):
    n = int(l*SR); t = np.arange(n)/SR; fr = f*(1 + 0.6*np.exp(-t/0.02)); return np.tanh(1.6*np.sin(2*np.pi*np.cumsum(fr)/SR))*env(n, 0.012, l*0.55)
def noise(n, lo, hi, seed):
    x = np.random.default_rng(seed).standard_normal(n); X = np.fft.rfft(x); fr = np.fft.rfftfreq(n, 1/SR); X[(fr<lo)|(fr>hi)] = 0; return np.fft.irfft(X, n)
def snare(): n = int(0.22*SR); return 0.7*noise(n, 1500, 9000, 2)*env(n, 0.001, 0.06) + 0.5*np.sin(2*np.pi*190*np.arange(n)/SR)*env(n, 0.001, 0.05)
def clap():
    n = int(0.25*SR); x = np.zeros(n); b = noise(n, 900, 5000, 5)
    for o in (0, 0.011, 0.022): k = int(o*SR); x[k:] += b[:n-k]*env(n-k, 0.0005, 0.012 if o < 0.02 else 0.09)
    return 0.8*x
def hat(open_=False): n = int((0.25 if open_ else 0.05)*SR); return 0.35*noise(n, 6500, 15000, 7)*env(n, 0.0005, 0.12 if open_ else 0.015)
def dhol_bass(): n = int(0.45*SR); t = np.arange(n)/SR; f = 75 + 60*np.exp(-t/0.05); return 1.1*np.sin(2*np.pi*np.cumsum(f)/SR)*env(n, 0.003, 0.18) + 0.3*noise(n, 200, 2000, 9)*env(n, 0.001, 0.02)
def dhol_treble(): n = int(0.18*SR); t = np.arange(n)/SR; return 0.55*np.sin(2*np.pi*520*t)*env(n, 0.001, 0.05) + 0.45*noise(n, 1500, 7000, 11)*env(n, 0.0005, 0.012)
def tabla(tone, d=0.25, amp=0.6): n = int(d*SR); t = np.arange(n)/SR; return amp*(np.sin(2*np.pi*tone*t) + 0.4*np.sin(2*np.pi*2.7*tone*t))*env(n, 0.004, d*0.3)
def dhaa():
    a = tabla(95, 0.5, 0.9)*0.8; b = tabla(410, 0.3, 0.5); a[:len(b)] += b; return a
def tone(f, l, a=0.01, d=None, kind='saw', vib=0.0):
    n = int(l*SR); t = np.arange(n)/SR; fr = f*(1 + vib*np.sin(2*np.pi*5.5*t)); ph = np.cumsum(fr)/SR
    w = 2*(ph % 1) - 1 if kind == 'saw' else np.sin(2*np.pi*ph)
    e = np.minimum(1, t/max(a, 1e-4)) * (np.exp(-t/d) if d else np.minimum(1, (l-t)/0.08).clip(0))
    return w*e
def put(buf, x, t, g=1.0):
    i = int(round(t*SR));
    if i >= len(buf): return
    m = min(len(x), len(buf)-i); buf[i:i+m] += g*x[:m]
def lowpass(x, fc):
    X = np.fft.rfft(x); fr = np.fft.rfftfreq(len(x), 1/SR); X *= 1/(1 + (fr/fc)**4); return np.fft.irfft(X, len(x))
def master(x):
    x = x/np.max(np.abs(x))*0.9; return np.tanh(1.8*x)/np.tanh(1.8)*0.89   # loud, compressed master like a Reels song

songs, truth = {}, {}
def beats_const(bpm, start, dur): p = 60/bpm; return list(np.arange(start, dur-0.05, p))

# 1) pop / hip-hop 135, triplet hi-hats, 808 that moves on and off the beat, clap on 2 and 4, lead notes off the beat
def pop_triplet():
    bpm, D = 135, 26.0; p = 60/bpm; x = np.zeros(int(D*SR)); B = beats_const(bpm, 0.5, D)
    for k, b in enumerate(B):
        if k % 4 in (1, 3): put(x, clap(), b, 0.9)
        for j in range(3): put(x, hat(), b + j*p/3, 0.5 if j else 0.7)
        if k % 8 == 6: [put(x, hat(), b + p/2 + j*p/12, 0.35) for j in range(6)]   # hat roll
        # 808 pattern: on 1, on the "and" of 2, on the 2/3 of 3 (syncopated), long tails
        if k % 4 == 0: put(x, b808(0.9), b, 0.9)
        if k % 4 == 1: put(x, b808(0.6, 52), b + p/2, 0.85)
        if k % 4 == 2: put(x, b808(0.5, 44), b + 2*p/3, 0.85)
        if k % 2 == 0: put(x, kick(0.25, 140, 55), b, 0.45)
        if k % 2 == 0: put(x, tone(392 if k % 8 < 4 else 349, p*0.9, 0.03, kind='saw', vib=0.01), b + p/3, 0.12)   # lead
    x = lowpass(x, 14000); return master(x), B
# 2) bhangra dhol 98: swung chaal (dha on the beat, a swung "and" on the treble), bass on 1 and the dotted "and"
def bhangra():
    bpm, D = 98, 26.0; p = 60/bpm; x = np.zeros(int(D*SR)); B = beats_const(bpm, 0.4, D); sw = 0.66
    for k, b in enumerate(B):
        put(x, dhol_bass(), b, 0.9 if k % 2 == 0 else 0.7)
        put(x, dhol_treble(), b + sw*p, 0.8)
        if k % 2 == 1: put(x, dhol_bass(), b + sw*p, 0.6)        # the "chaal" bounce
        if k % 4 == 3: put(x, dhol_treble(), b + p*0.33, 0.5)
        put(x, tone(293.7*(1.5 if k % 8 >= 4 else 1), p, 0.02, kind='saw', vib=0.006), b, 0.06)   # tumbi-like riff
    return master(x), B
# 3) garba / dandiya, 6/8: two dotted-quarter beats a bar at 120 dotted-quarters / min; dhol 1-(2)-3 4-(5)-6
def garba():
    bpm, D = 120, 26.0; p = 60/bpm; e8 = p/3; x = np.zeros(int(D*SR)); B = beats_const(bpm, 0.5, D)
    for k, b in enumerate(B):
        put(x, dhol_bass(), b, 1.0)
        put(x, dhol_treble(), b + 2*e8, 0.7)
        put(x, dhol_treble(), b + e8, 0.35)
        if k % 2 == 1: put(x, hat(), b + e8, 0.3)
        put(x, tone(440 if k % 4 < 2 else 494, p*0.95, 0.02, kind='saw', vib=0.008), b, 0.07)
    return master(x), B
# 4) lavani dholki 160: fast, dense, accent on 1 and 5 of the 8-beat cycle, rolls between
def lavani():
    bpm, D = 160, 24.0; p = 60/bpm; x = np.zeros(int(D*SR)); B = beats_const(bpm, 0.3, D)
    for k, b in enumerate(B):
        put(x, dhol_bass(), b, 1.0 if k % 4 == 0 else 0.75)
        put(x, dhol_treble(), b + p/2, 0.55)
        if k % 8 in (3, 7): [put(x, dhol_treble(), b + p/2 + j*p/8, 0.35) for j in range(1, 4)]
        put(x, tone(523 if k % 8 < 4 else 587, p, 0.01, kind='saw', vib=0.012), b + p/4, 0.08)
    return master(x), B
# 5) Bollywood dembow 96: kick on every beat, snare on the "a" of 1 and the "and" of 2 (3-3-2), long synth pads
def dembow():
    bpm, D = 96, 26.0; p = 60/bpm; x = np.zeros(int(D*SR)); B = beats_const(bpm, 0.5, D)
    for k, b in enumerate(B):
        put(x, kick(0.3, 130, 50, 0.15), b, 1.0)
        if k % 2 == 0: put(x, snare(), b + 0.75*p, 0.85)
        else: put(x, snare(), b + 0.5*p, 0.85)
        put(x, hat(), b + p/2, 0.3)
        if k % 4 == 0: put(x, tone(220, 4*p, 0.3, kind='sin'), b, 0.15)
    return master(x), B
# 6) a 6 s free-time intro (harmonium-like chords, no pulse), then drums at 128 (truth only where the beat runs)
def free_intro():
    bpm, D = 128, 26.0; p = 60/bpm; x = np.zeros(int(D*SR)); t = 0.2
    for d, f in [(1.3, 261.6), (0.9, 293.7), (1.7, 329.6), (1.1, 293.7), (0.8, 261.6)]:
        put(x, tone(f, d+0.4, 0.15, kind='saw', vib=0.004) + 0.6*tone(f*1.5, d+0.4, 0.15, kind='saw'), t, 0.12); t += d
    start = 6.2; B = beats_const(bpm, start, D)
    for k, b in enumerate(B):
        put(x, kick(0.3), b, 0.9)
        if k % 2 == 1: put(x, snare(), b, 0.8)
        put(x, hat(), b + p/2, 0.4); put(x, hat(), b, 0.25)
        put(x, tone(130.8 if k % 8 < 4 else 146.8, p*0.9, 0.01, kind='saw'), b, 0.12)
    return master(x), B
# 7) kaharwa on tabla 84 with a harmonium drone: soft attacks, dha on 1 and 5, ghost strokes between
def tabla_kaharwa():
    bpm, D = 84, 28.0; p = 60/bpm; x = np.zeros(int(D*SR)); B = beats_const(bpm, 0.5, D)
    bols = ['dha', 'ge', 'na', 'ti', 'na', 'ka', 'dhi', 'na']
    for k, b in enumerate(B):
        bol = bols[k % 8]
        put(x, dhaa() if bol.startswith('dh') else tabla(380 if bol == 'na' else 300, 0.25, 0.55), b, 1.0 if k % 4 == 0 else 0.75)
        put(x, tabla(600, 0.12, 0.25), b + p/2, 1.0)
        if k % 2: put(x, tabla(700, 0.08, 0.18), b + 0.75*p, 1.0)
    x += 0.04*(tone(146.8, D, 1.0, kind='saw') + tone(220, D, 1.0, kind='saw'))[:len(x)]
    return master(x), B

# 8) a bhajan / garba that speeds up the whole way: 90 -> 140 BPM over 26 s (dholak + manjira + harmonium)
def accelerando():
    D = 27.0; x = np.zeros(int(D*SR)); B = []; t = 0.6
    while t < D - 0.3:
        u = min(1, t/26); bpm = 90 + 50*u; B.append(t); t += 60/bpm
    for k, b in enumerate(B):
        p = (B[k+1]-b) if k+1 < len(B) else 60/140
        put(x, dhol_bass(), b, 0.9 if k % 2 == 0 else 0.7)
        put(x, dhol_treble(), b + p/2, 0.5)
        put(x, hat(), b + p/2, 0.35)                       # manjira
        put(x, tone(293.7 if k % 8 < 4 else 329.6, p*0.95, 0.02, kind='saw', vib=0.005), b, 0.06)
    return master(x), B

for name, fn in [('pop_triplet_808_135', pop_triplet), ('bhangra_dhol_98', bhangra), ('garba_6_8_120', garba), ('lavani_dholki_160', lavani),
                 ('bollywood_dembow_96', dembow), ('free_intro_then_128', free_intro), ('tabla_kaharwa_84', tabla_kaharwa), ('bhajan_accelerando_90_140', accelerando)]:
    x, B = fn()
    with wave.open(name + '.wav', 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes((x*32767).astype(np.int16).tobytes())
    truth[name] = [round(float(b), 4) for b in B]
json.dump(truth, open('truth.json', 'w'))
print('wrote', len(truth), 'songs')
