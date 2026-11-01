import numpy as np, json, wave, importlib.util, sys
# reuse helpers without running main: exec only function defs
src=open('make_set1.py').read().split("songs={}")[0]
g={}; exec(src,g)
rng=np.random.default_rng(99); g['rng']=rng
sr=44100; add=g['add']; kick=g['kick']; snare=g['snare']; hat=g['hat']; melody=g['melody']
def bc(bpm,D,start=0.5): return list(np.arange(start,D-0.3,60/bpm))
def bcurve(fn,D,start=0.5):
    b=[start]
    while True:
        nb=b[-1]+60/fn(b[-1])
        if nb>D-0.3: break
        b.append(nb)
    return b
def piano(buf,beats):
    for k,b in enumerate(beats[:-1]):
        d=beats[k+1]-b; n=int(d*sr*1.5); t=np.arange(n)/sr
        f=[261.6,329.6,392,349.2][k%4]
        x=sum(np.sin(2*np.pi*f*h*t)/h for h in (1,2,3))*np.exp(-t*3)*0.4*(1.0 if k%4==0 else 0.7)
        add(buf,x,b)
def make(beats,D,kind,jit=0):
    buf=np.zeros(int(D*sr)); bt=[x+(rng.normal(0,jit) if jit else 0) for x in beats]
    for k,b in enumerate(bt):
        nxt=bt[k+1] if k+1<len(bt) else b+(bt[k]-bt[k-1]); d=nxt-b
        if kind=='four':   # 4 on the floor, clap 2/4, hats off-beat
            add(buf,kick(),b); add(buf,hat(),b+d/2,0.8)
            if k%2: add(buf,snare(),b,0.7)
        elif kind=='swing':  # hip-hop 90 with swung hats
            add(buf, kick() if k%2==0 else snare(), b, 1.0 if k%2==0 else 0.9)
            add(buf,hat(),b,0.6); add(buf,hat(),b+d*0.66,0.6)
            if k%4==2: add(buf,kick(),b+d*0.66,0.7)
        elif kind=='dembow':  # reggaeton 95: kick every beat, snare on 3/4-ish
            add(buf,kick(),b); add(buf,snare(),b+d*0.75,0.7)
            if k%2: add(buf,snare(),b+d*0.5,0.7)
        elif kind=='trap':   # 140 with hats on 8ths/16ths rolls, snare on 3 (half-time feel), truth = 140 grid
            if k%4==0: add(buf,kick(),b)
            if k%4==2: add(buf,snare(),b)
            if k%4==3: add(buf,kick(),b+d*0.5,0.8)
            for q in range(2): add(buf,hat(),b+d*q/2,0.5)
        elif kind=='piano':  # no drums, chords on every beat
            pass
    if kind=='piano': piano(buf,bt)
    else: melody(buf,bt,root=196)
    buf=buf/np.max(np.abs(buf))*0.8; return buf,bt
D=30; songs={}
songs['four_floor_124']=make(bc(124,D),D,'four')
songs['hiphop_swing_90']=make(bc(90,D),D,'swing',jit=0.006)
songs['reggaeton_95']=make(bc(95,D),D,'dembow')
songs['trap_70_halftime']=make(bc(70,D),D,'trap')
songs['piano_only_100']=make(bc(100,D),D,'piano')
songs['rock_drift_120_126']=make(bcurve(lambda t:120+6*t/D,D),D,'four',jit=0.008)
songs['change_140_100']=make(bcurve(lambda t:140 if t<14 else 100,D),D,'swing')
truth={}
for n,(x,bt) in songs.items():
    with wave.open('set2/'+n+'.wav','wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr); w.writeframes((x*32767).astype(np.int16).tobytes())
    truth[n]=[float(b) for b in bt]
json.dump(truth,open('set2/truth.json','w'))
