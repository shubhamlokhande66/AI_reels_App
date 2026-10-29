# Test clips with known truth for scene-change detection and the subject-following crop.
import os; os.makedirs("./out", exist_ok=True)
import numpy as np, subprocess, json, sys
W,H,FPS = 960,540,30
rng = np.random.default_rng(7)
def noise_img(seed, w, h, scale, pal):
    r = np.random.default_rng(seed); img = np.zeros((h,w))
    for k,s in enumerate([scale, scale/2, scale/4, scale/8]):
        gh, gw = int(h/s)+2, int(w/s)+2; g = r.random((gh,gw))
        yy = np.linspace(0, gh-1.001, h); xx = np.linspace(0, gw-1.001, w)
        y0 = yy.astype(int); x0 = xx.astype(int); fy = (yy-y0)[:,None]; fx = (xx-x0)[None,:]
        a = g[y0][:,x0]; b = g[y0][:,x0+1]; c = g[y0+1][:,x0]; d = g[y0+1][:,x0+1]
        img += (a*(1-fx)*(1-fy)+b*fx*(1-fy)+c*(1-fx)*fy+d*fx*fy) * 0.5**k
    img = (img-img.min())/(img.max()-img.min())
    p = np.array(pal, float)  # 3 colours, interpolate
    t = img[...,None]
    col = np.where(t<0.5, p[0]+(p[1]-p[0])*(t*2), p[1]+(p[2]-p[1])*((t-0.5)*2))
    return col.clip(0,255).astype(np.uint8)
GREEN = [(20,40,15),(70,120,50),(170,200,140)]
GREEN2= [(25,45,20),(80,115,60),(160,190,150)]   # nearly the same palette: a hard case
SUNSET= [(40,10,30),(200,80,40),(250,210,120)]
SEA   = [(5,20,60),(30,110,170),(200,230,240)]
GREY  = [(30,30,30),(120,120,120),(220,220,220)]
def write(name, frames_iter, n):
    p = subprocess.Popen(['ffmpeg','-y','-loglevel','error','-f','rawvideo','-pix_fmt','rgb24','-s',f'{W}x{H}','-r',str(FPS),'-i','-',
                          '-c:v','libvpx-vp9','-b:v','2M','-deadline','realtime','-cpu-used','8','-pix_fmt','yuv420p',name], stdin=subprocess.PIPE)
    for k,f in enumerate(frames_iter):
        p.stdin.write(np.ascontiguousarray(f).tobytes())
    p.stdin.close(); p.wait()

# ---------- clip 1: scenes ----------
big = {k: noise_img(i+1, W*3, H, 120, pal) for i,(k,pal) in enumerate([('A',GREEN),('B',GREEN2),('C',SUNSET),('D',SEA),('E',GREY),('F',SUNSET)])}
def scene_frame(k, t, pan=0.0, obj=None):
    img = big[k]; x = int((W*1.0 + 40*np.sin(t*0.8) + pan*t*FPS) % (W*2))
    f = img[:, x:x+W].copy()
    if obj: # a moving ball (motion inside the scene, not a cut)
        cx = int(obj[0] + obj[1]*t); cy = H//2
        yy,xx = np.ogrid[:H,:W]; f[(yy-cy)**2+(xx-cx)**2 < 45**2] = (230,40,40)
    return f
# segments: (scene, seconds, pan px/frame); boundaries listed in truth
plan = [('A',3.0,0,None), ('B',2.6,0,(100,150)), ('C',3.2,0,None), ('D',3.0,25,None), ('E',2.8,0,None), ('F',3.0,0,(800,-200))]
frames = []; truth = []; t_abs = 0
seg_frames = []
for (k,dur,pan,obj) in plan:
    n = int(round(dur*FPS)); seg_frames.append([scene_frame(k, j/FPS, pan, obj) for j in range(n)])
# transitions between segments: A|B hard, B|C hard, C->D fade through black (0.8 s), D|E hard, E->F dissolve (1.0 s)
out = []
def tnow(): return len(out)/FPS
out += seg_frames[0]; truth.append({'kind':'cut','t':tnow()})
out += seg_frames[1]; truth.append({'kind':'cut','t':tnow()})
c = seg_frames[2]; d = seg_frames[3]
nf = int(0.4*FPS)
out += c[:-nf]; t0 = tnow()
for j in range(nf): out.append((c[len(c)-nf+j]*(1-(j+1)/nf)).astype(np.uint8))
for j in range(nf): out.append((d[j]*((j+1)/nf)).astype(np.uint8))
truth.append({'kind':'fade','t0':t0,'t1':tnow()})
# trap inside D: a 2-frame white flash at D+1.0 s
d2 = d[nf:]; fl = int(1.0*FPS); d2[fl] = np.full_like(d2[fl], 250); d2[fl+1] = np.full_like(d2[fl], 250)
traps = [{'kind':'flash','t':tnow()+fl/FPS}, {'kind':'fast pan','t0':tnow(),'t1':tnow()+len(d2)/FPS}]
out += d2; truth.append({'kind':'cut','t':tnow()})
e = seg_frames[4]; f = seg_frames[5]; nd = int(1.0*FPS)
out += e[:-nd//2]; t0 = tnow()
for j in range(nd):
    a = (j+1)/(nd+1); out.append((e[len(e)-nd//2+min(j,nd//2-1)]*(1-a) + f[j]*a).astype(np.uint8))
truth.append({'kind':'dissolve','t0':t0,'t1':tnow()})
out += f[nd:]
traps.append({'kind':'passing object (ball in B and F)'})
write('./out/scenes.webm', out, len(out))
json.dump({'dur':len(out)/FPS,'boundaries':truth,'traps':traps}, open('./out/scenes.json','w'), indent=1)

# ---------- clip 2: one subject, shaky handheld camera ----------
bg = noise_img(42, W+80, H+80, 90, GREY)
T = 12.0; n = int(T*FPS); path = []; out = []
sh = np.cumsum(rng.normal(0, 1.2, (n,2)), axis=0); sh = np.clip(sh - np.linspace(0,1,n)[:,None]*sh[-1], -30, 30)
for j in range(n):
    t = j/FPS
    if t < 3: x = 220 + 6*np.sin(t*3)                  # stands still (small sway)
    elif t < 7: u=(t-3)/4; x = 220 + (740-220)*(u*u*(3-2*u))   # walks across
    else: x = 740 + 6*np.sin(t*3)                       # stands still again
    y = 300 + 10*np.sin(t*1.3)
    ox, oy = int(40+sh[j,0]), int(40+sh[j,1])
    fr = bg[oy:oy+H, ox:ox+W].copy()
    yy,xx = np.ogrid[:H,:W]; fr[(yy-y)**2/1.6+(xx-x)**2 < 38**2] = (220,30,30)   # an upright red "person"
    out.append(fr); path.append([t, x/W, y/H])
write('./out/subject.webm', out, n)
json.dump({'path':path}, open('./out/subject.json','w'))
print('ok', json.load(open('./out/scenes.json'))['boundaries'])
