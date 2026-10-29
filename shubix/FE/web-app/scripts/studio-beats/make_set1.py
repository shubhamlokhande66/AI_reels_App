import numpy as np, json, wave
sr=44100; rng=np.random.default_rng(7)
def kick(n=int(0.25*sr)):
    t=np.arange(n)/sr; f=50+90*np.exp(-t*30); ph=2*np.pi*np.cumsum(f)/sr; return np.sin(ph)*np.exp(-t*9)
def snare(n=int(0.2*sr)):
    t=np.arange(n)/sr; return (rng.standard_normal(n)*0.7+np.sin(2*np.pi*190*t)*0.5)*np.exp(-t*22)
def hat(n=int(0.05*sr), open_=False):
    t=np.arange(n if not open_ else int(0.18*sr))/sr; x=rng.standard_normal(len(t)); x=np.diff(np.r_[0,x]); return x*np.exp(-t*(60 if not open_ else 18))*0.35
def add(buf, x, t, g=1.0):
    i=int(round(t*sr)); j=min(len(buf), i+len(x));
    if i<len(buf) and i>=0: buf[i:j]+=g*x[:j-i]
def melody(buf, beats, root=220):
    notes=[0,3,7,10,12,7,5,3]
    for k,b in enumerate(beats[:-1]):
        d=beats[k+1]-b; n=int(d*sr); t=np.arange(n)/sr; f=root*2**(notes[k%8]/12)
        x=(np.sin(2*np.pi*f*t)+0.5*np.sin(2*np.pi*2*f*t))*np.minimum(1,t/0.02)*np.exp(-t*1.5)*0.25
        add(buf,x,b)
def beats_const(bpm,dur,start=0.3): return list(np.arange(start,dur-0.3,60/bpm))
def beats_curve(fn,dur,start=0.3):
    b=[start]
    while True:
        nb=b[-1]+60/fn(b[-1])
        if nb>dur-0.3: break
        b.append(nb)
    return b
def render(beats, dur, style, mel=False, jitter=0):
    buf=np.zeros(int(dur*sr))
    bt=[x+(rng.normal(0,jitter) if jitter else 0) for x in beats]
    for k,b in enumerate(bt):
        nxt=bt[k+1] if k+1<len(bt) else b+(bt[k]-bt[k-1])
        half=(b+nxt)/2
        if style=='rock':        # kick 1,3  snare 2,4  closed hats on 8ths
            add(buf, kick() if k%2==0 else snare(), b, 1.0 if k%2==0 else 0.8)
            add(buf,hat(),b); add(buf,hat(),half)
        elif style=='offbeat':   # house: kick every beat, open hat on the off-beat, clap 2,4
            add(buf,kick(),b); add(buf,hat(open_=True),half,1.2)
            if k%2==1: add(buf,snare(),b,0.6)
        elif style=='slow':      # 72: kick on 1 and 3, snare 2 and 4, hats on 16ths-ish (8ths at 144)
            add(buf, kick() if k%2==0 else snare(), b, 1.0 if k%2==0 else 0.8)
            for q in range(4): add(buf,hat(),b+(nxt-b)*q/4,0.6)
        elif style=='dnb':       # 174: kick 1 and "and of 3", snare 2 and 4, hats on 8ths
            if k%4 in (0,): add(buf,kick(),b)
            if k%4 in (1,3): add(buf,snare(),b,0.9)
            if k%4==2: add(buf,kick(),half,0.8)
            add(buf,hat(),b,0.5); add(buf,hat(),half,0.5)
    if mel: melody(buf, bt)
    buf=buf/np.max(np.abs(buf))*0.8
    return buf, bt
songs={}
D=30
songs['drums_100']=render(beats_const(100,D),D,'rock')
songs['drums_melody_128']=render(beats_const(128,D),D,'rock',mel=True)
songs['offbeat_melody_140']=render(beats_const(140,D),D,'offbeat',mel=True)
songs['tempo_change_95_128']=render(beats_curve(lambda t: 95 if t<15 else 128, D),D,'rock')
songs['live_drift_108_114']=render(beats_curve(lambda t: 108+6*t/D, D),D,'rock',mel=True,jitter=0.008)
songs['slow_72']=render(beats_const(72,D),D,'slow')
songs['fast_174']=render(beats_const(174,D),D,'dnb')
truth={}
for name,(x,bt) in songs.items():
    with wave.open(name+'.wav','wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr); w.writeframes((x*32767).astype(np.int16).tobytes())
    truth[name]=[float(b) for b in bt]
json.dump(truth,open('truth.json','w'))
print(list(truth))
