import numpy as np
SR = 22050
def bar_song(bpm=120, bars=16, pickup=2, seed=0):
    """4/4: kick on 1 (hard) and 3 (softer), snare on 2 and 4, a new chord every bar. Starts `pickup` beats before bar 1."""
    rng = np.random.default_rng(seed); p = 60 / bpm; n = (bars * 4 + pickup); y = np.zeros(int((n * p + 1) * SR))
    t = np.arange(int(0.12 * SR)) / SR
    kick = np.sin(2 * np.pi * (60 + 80 * np.exp(-t * 30)) * t) * np.exp(-t * 18)
    snare = rng.standard_normal(len(t)) * np.exp(-t * 35) * 0.5
    chords = [(220, 277, 330), (196, 247, 294), (175, 220, 262), (247, 311, 370)]
    downs = []
    for k in range(n):
        i = int(k * p * SR); pos = (k - pickup) % 4
        if pos == 0: y[i:i + len(t)] += kick * 1.0; downs.append(round(k * p, 3))
        elif pos == 2: y[i:i + len(t)] += kick * 0.75
        else: y[i:i + len(t)] += snare
        if pos == 0:
            c = chords[((k - pickup) // 4) % 4]; dur = int(4 * p * SR); tt = np.arange(dur) / SR
            y[i:i + dur] += 0.06 * sum(np.sin(2 * np.pi * f * tt) for f in c)[: len(y) - i]
    return (y / np.abs(y).max()).astype(np.float32), downs, [round(k * p, 3) for k in range(n)]
