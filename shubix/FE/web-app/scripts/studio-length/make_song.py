# A song with a known structure, to check that "Best part" finds the drop: 120 BPM (a beat every 0.5 s)
#   0-8 s quiet pad intro · 8-24 s verse (soft kick) · 24-40 s DROP (full drums + bass) · 40-48 s break (pad)
#   48-64 s second chorus (as loud as the drop) · 64-72 s outro (fading)
# Writes out/structured_120.wav and out/structured_120.json (the sections).
import json, os, wave
import numpy as np
SR, BPM, DUR = 44100, 120.0, 72.0
P = 60/BPM; rng = np.random.default_rng(3)
t = np.arange(int(DUR*SR))/SR; x = np.zeros_like(t)
def hit(at, f0, f1, d, a):
    i = int(at*SR); n = min(int(d*SR), len(x)-i)
    if n <= 0: return
    tt = np.arange(n)/SR; f = f1 + (f0-f1)*np.exp(-tt/0.03); x[i:i+n] += a*np.sin(2*np.pi*np.cumsum(f)/SR)*np.exp(-tt/(d*0.4))
def noise(at, d, a):
    i = int(at*SR); n = min(int(d*SR), len(x)-i)
    if n <= 0: return
    x[i:i+n] += a*rng.standard_normal(n)*np.exp(-np.arange(n)/SR/(d*0.3))
pad = 0.06*np.sin(2*np.pi*220*t)*(0.6+0.4*np.sin(2*np.pi*t/8)) + 0.04*np.sin(2*np.pi*277*t)
x += pad
loud = lambda b: (24 <= b < 40) or (48 <= b < 64)
k = 0; b = 0.0
while b < DUR - 0.05:
    if 8 <= b < 24: hit(b, 110, 50, 0.25, 0.35)                       # verse: soft kick
    elif loud(b):
        hit(b, 120, 45, 0.35, 1.0)                                       # drop: hard kick, snare, hats, bass
        if k % 2: noise(b, 0.2, 0.5)
        noise(b+P/2, 0.05, 0.18)
        i = int(b*SR); n = int(P*SR); x[i:i+n] += 0.25*np.sign(np.sin(2*np.pi*55*np.arange(n)/SR))*np.exp(-np.arange(n)/SR/0.3)
    elif 64 <= b < 72: hit(b, 110, 50, 0.25, 0.4*(72-b)/8)               # outro
    k += 1; b += P
y = np.tanh(1.4*x)/np.tanh(1.4)*0.85
os.makedirs('out', exist_ok=True)
with wave.open('out/structured_120.wav', 'wb') as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes((y*32767).astype(np.int16).tobytes())
json.dump({'bpm': BPM, 'sections': [['intro', 0, 8], ['verse', 8, 24], ['drop', 24, 40], ['break', 40, 48], ['chorus', 48, 64], ['outro', 64, 72]]}, open('out/structured_120.json', 'w'))
print('ok')
