/** The studio's GPU programs (GLSL ES 1.0), one copy for the website (components/studio/engine.ts) and the Android
 * app's native engine (modules/shubix-video: copied into its assets by `pnpm shaders`). Change them here only; never
 * put a // comment in MAIN_FRAG (the website joins it into one line). */

/** the picture effects' numbers in PIC_FRAG (kind): the studio's effect id -> its kind */
export const PIC_FX: Record<string, number> = { grain: 1, leak: 2, rainbow: 3, negative: 4, halftone: 5, pixel8: 6, crt: 7, fisheye: 8, swirl: 9, sketch: 10, duotone: 11, zoom3d: 12 };

/** the studio renderer: a full-frame quad */
export const MAIN_VERT = `attribute vec2 a; void main(){ gl_Position = vec4(a,0.,1.); }`;

/** the studio renderer: two shots, the transition between them (mode), each shot's framing, adjust, beauty, mask, look */
export const MAIN_FRAG = `precision highp float;
uniform sampler2D tA, tB, tL;
uniform vec2 res;
uniform vec4 rA, rB, bgR, frR;
uniform float rotA, rotB, zbA, zbB, rgbA, rgbB, exA, exB, brA, brB, alA, alB, clA, clB, hasA;
uniform vec2 dbA, dbB, irisC, offA, offB;
uniform float mode, prog, mixv, time, snap, bgDark, border;
uniform float con, sat, bri, teal, mono, vig, grain, flash, loopMix, warm, lift;
uniform vec3 leak;
uniform vec4 tfA, tfB, bgA, bgB, bgrA, bgrB, bdA, bdB, adA, adB, mz, mg;
uniform vec4 ad2A, ad2B, tsh, thi;   /* a shot's highlights, shadows, hue, sharpen and the look's shadow and highlight tints */
uniform float beA, beB;   /* skin smoothing of a shot */
uniform float mzc;
uniform vec4 shp, shq;   // a beat shape of the shot: kind, level, centre, and the grid / strips count
/* a canvas pattern behind a fitted shot (k: 0 gradient, 1 stripes, 2 dots, 3 grid, 4 checker), in its colour and a lighter one; sized to a 1080-wide frame */
vec3 pat(vec2 p, vec3 c, float k){ vec2 q = p/res.x*1080.; vec3 l = mix(c, vec3(1.), 0.35); float s;
  if(k<0.5) return mix(l, c*0.55, clamp(p.y/res.y, 0., 1.));
  if(k<1.5) s = step(40., mod(q.x+q.y, 80.)); else if(k<2.5) s = step(14., length(mod(q, 60.)-30.)); else if(k<3.5) s = step(4., min(mod(q.x, 64.), mod(q.y, 64.))); else s = mod(floor(q.x/72.)+floor(q.y/72.), 2.);
  return mix(l, c, s); }
vec2 rotP(vec2 p, float r){ vec2 c=res*0.5; vec2 d=p-c; float cs=cos(-r), sn=sin(-r); return c+vec2(cs*d.x-sn*d.y, sn*d.x+cs*d.y); }
vec3 tap(sampler2D t, vec2 uv, float ro){ uv=clamp(uv,0.001,0.999);
  if(ro<0.0001) return texture2D(t,uv).rgb;
  return vec3(texture2D(t,clamp(uv+vec2(ro,0.),0.001,0.999)).r, texture2D(t,uv).g, texture2D(t,clamp(uv-vec2(ro,0.),0.001,0.999)).b); }
vec3 layer(sampler2D t, vec2 p, vec4 r, float rot, float zb, vec2 db, float rgb, vec4 tf, out float inside){
  vec2 q = rotP(p, rot); vec2 uv = (q-r.xy)/r.zw;
  inside = step(0.,uv.x)*step(uv.x,1.)*step(0.,uv.y)*step(uv.y,1.);
  uv = vec2(dot(tf.xy, uv-0.5), dot(tf.zw, uv-0.5)) + 0.5;   // turned / mirrored / flipped
  float ro = rgb/r.z; vec3 c = tap(t,uv,ro);
  if(zb>0.01 || length(db)>0.5){
    vec3 acc=c; vec2 du = db/r.zw;
    for(int k=1;k<10;k++){ float f=float(k)/9.; vec2 u2 = mix(uv, vec2(0.5), zb*0.1*f) + du*(f-0.5); acc += tap(t,u2,ro); }
    c = acc/10.;
  }
  return c;
}
// a shot with its clip settings: border and canvas around a fitted picture, then its own colour
vec3 adj(vec3 c, vec4 a){ c *= 1.+a.x*0.5; c = (c-0.5)*(1.+a.y)+0.5; float l = dot(c, vec3(0.299,0.587,0.114)); c = mix(vec3(l), c, 1.+a.z); return c*vec3(1.+0.15*a.w, 1., 1.-0.15*a.w); }
vec3 hueRot(vec3 c, float a){ float l = dot(c, vec3(0.299,0.587,0.114)); vec3 k = c - l; float cs = cos(a), sn = sin(a);
  vec3 u = normalize(vec3(1.,-0.5,-0.5)), v = normalize(vec3(0.,0.866,-0.866)); float x = dot(k,u), y = dot(k,v);
  return l + u*(x*cs - y*sn) + v*(x*sn + y*cs) + (k - u*x - v*y); }
vec3 shotL(sampler2D t, vec2 p, vec4 r, float rot, float zb, vec2 db, float rgb, vec4 tf, vec4 bg, vec4 bgr, vec4 bd, vec4 ad, vec4 ad2, float be, out float inside){
  vec3 c = layer(t,p,r,rot,zb,db,rgb,tf,inside);
  if(inside>0.5 && (ad2.w>0.01 || be>0.01)){
    float ib; vec2 o = vec2(1.6,0.);
    vec3 bl = (layer(t,p+o,r,rot,0.,vec2(0.),0.,tf,ib)+layer(t,p-o,r,rot,0.,vec2(0.),0.,tf,ib)+layer(t,p+o.yx,r,rot,0.,vec2(0.),0.,tf,ib)+layer(t,p-o.yx,r,rot,0.,vec2(0.),0.,tf,ib))*0.25;
    if(ad2.w>0.01) c += (c-bl)*ad2.w*2.5;
    if(be>0.01){
      vec2 o2 = vec2(4.5,0.);
      vec3 wb = (layer(t,p+o2,r,rot,0.,vec2(0.),0.,tf,ib)+layer(t,p-o2,r,rot,0.,vec2(0.),0.,tf,ib)+layer(t,p+o2.yx,r,rot,0.,vec2(0.),0.,tf,ib)+layer(t,p-o2.yx,r,rot,0.,vec2(0.),0.,tf,ib)+bl*4.)/8.;
      float skin = smoothstep(0.02,0.1,c.r-c.g)*smoothstep(0.0,0.06,c.g-c.b)*step(0.2,c.r);
      float flatness = 1.-smoothstep(0.03,0.14,length(c-wb));
      c = mix(c, wb*1.02+0.01, clamp(be*skin*flatness,0.,0.9));
    }
  }
  if(inside<0.5 && bd.w>0.){ vec2 q = rotP(p,rot); if(q.x>r.x-bd.w && q.x<r.x+r.z+bd.w && q.y>r.y-bd.w && q.y<r.y+r.w+bd.w){ c = bd.rgb; inside = 1.; } }
  if(inside<0.5 && bg.w>-0.5){ float ib; c = bg.w>1.5 ? pat(p, bg.rgb, bg.w-2.) : bg.w>0.5 ? layer(t,p,bgr,0.,1.,vec2(0.),0.,tf,ib)*0.62 : bg.rgb; inside = 1.; }
  c = adj(c, ad);
  if(ad2.x!=0. || ad2.y!=0.){ float l = dot(c, vec3(0.299,0.587,0.114)); c += ad2.x*0.28*smoothstep(0.45,1.,l) + ad2.y*0.28*(1.-smoothstep(0.,0.55,l)); }
  if(ad2.z!=0.) c = hueRot(c, ad2.z*3.14159);
  return c;
}
float hash(vec2 p){ return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453); }
/* Beat shapes (the shot's effect, stepping on its beats): 1 box that grows, 2 grid of windows, 3 strips, 4 circle,
 * 5 heart, 6 star, 7 frame in frame, 8 mirror, 9 kaleidoscope, 10 triple split, 11 VHS. Outside a shape: the same shot,
 * blurred and dark. shp = (kind, level, centre x, centre y); shq.x = cells across for the grid / strips. */
float rbox(vec2 d, vec2 h, float r){ vec2 q = abs(d)-h+r; return length(max(q,0.))+min(max(q.x,q.y),0.)-r; }
vec2 shWarp(vec2 p){
  if(shp.x<8.5){ if(p.x>res.x*0.5) p.x = res.x-p.x; return p; }
  if(shp.x<9.5){ vec2 c = res*0.5; return c-abs(p-c); }
  if(shp.x<10.5){ float h = res.y/3.; return vec2(p.x, mod(p.y,h)+h); }
  float jump = step(0.985, hash(vec2(floor(p.y*0.02), floor(time*9.))));
  p.x += sin(p.y*0.045+time*23.)*res.x*0.0025 + jump*res.x*0.02; return p;
}
float shMask(vec2 p0, out float rim){
  float k = shp.x, lv = shp.y; vec2 c = shp.zw; rim = 0.;
  float w = res.x*0.007;   // the white edge
  if(k<1.5 || (k>6.5 && k<7.5)){
    vec2 hh = res*0.5*lv; float r = res.x*0.035; float d = rbox(p0-c, hh, r);
    float wk = k>6.5 ? w*1.8 : w; rim = smoothstep(-1.,1.,d)*(1.-smoothstep(wk-1.,wk+1.,d))*step(lv,0.995);
    return 1.-smoothstep(-1.,1.,d); }
  if(k<3.5){
    float n = max(1.,shq.x), gap = res.x*0.01;
    vec2 cell = k<2.5 ? res/n : vec2(res.x/n, res.y);
    vec2 id = floor(p0/cell); float idx = k<2.5 ? id.y*n+id.x : id.x;
    vec2 l = mod(p0, cell)-cell*0.5; float d = rbox(l, cell*0.5-gap, gap*1.4);
    return step(idx+0.5, lv)*(1.-smoothstep(-1.,1.,d)); }
  float L = length(max(c,res-c)); vec2 dd = p0-c;
  if(k<4.5){ float R = lv*L; float d = length(dd)-R; rim = smoothstep(-1.,1.,d)*(1.-smoothstep(w-1.,w+1.,d))*step(lv,0.995); return 1.-smoothstep(-1.,1.,d); }
  if(k<5.5){ vec2 u = dd/(lv*L*1.9+1e-3); float X = u.x*1.15, Y = -u.y*1.15+0.3; float a = X*X+Y*Y-1.; float h = a*a*a-X*X*Y*Y*Y; return 1.-smoothstep(-0.02,0.02,h); }
  if(k<6.5){ float r = length(dd)/(lv*L*1.85+1e-3); float an = atan(dd.y,dd.x); float lim = 0.55+0.45*pow(0.5+0.5*cos(5.*an+1.5708),3.); return 1.-smoothstep(lim-0.03,lim,r); }
  if(k>9.5 && k<10.5){ float h = res.y/3.; float idx = floor(p0.y/h); float e = abs(mod(p0.y,h)); rim = 0.; return step(idx+0.5, lv)*step(1.5, e)*step(e, h-1.5); }
  return 1.;
}
void main(){
  vec2 p0 = vec2(gl_FragCoord.x, res.y-gl_FragCoord.y);
  // mosaic (blocks) and magnifier (a round lens) of the shot, on screen
  if(mz.z>0. && p0.x>mz.x && p0.x<mz.x+mz.z && p0.y>mz.y && p0.y<mz.y+mz.w) p0 = mz.xy + (floor((p0-mz.xy)/mzc)+0.5)*mzc;
  float ring = 0.;
  if(mg.z>0.){ float dd = distance(p0, mg.xy); ring = smoothstep(mg.z-5., mg.z-2., dd)*(1.-smoothstep(mg.z, mg.z+2., dd)); if(dd<mg.z) p0 = mg.xy + (p0-mg.xy)/mg.w; }
  if(mode>12.5 && mode<13.5){ float blk = max(1., res.x*0.07*sin(3.14159*prog)); p0 = (floor(p0/blk)+0.5)*blk; }
  if(mode>15.5 && mode<16.5){ vec2 dd = p0-res*0.5; float rr = length(dd); p0 += (dd/(rr+1e-3))*sin(rr*0.06-prog*20.)*res.x*0.02*sin(3.14159*prog); }
  vec2 p = p0 - offB, pA = p0 - offA;   // the creator's keyframed move of each layer
  float inA=0., inB=0.;
  vec3 A = vec3(0.);
  if(hasA>0.5){ A = shotL(tA,pA,rA,rotA,zbA,dbA,rgbA,tfA,bgA,bgrA,bdA,adA,ad2A,beA,inA); A = (A + A*exA)*brA*alA*mix(1.,inA,clA); }
  vec2 pS = shp.x>7.5 ? shWarp(p) : p;   // mirror, kaleidoscope, triple split, VHS move the picture itself
  vec3 B = shotL(tB,pS,rB,rotB,zbB,dbB,rgbB,tfB,bgB,bgrB,bdB,adB,ad2B,beB,inB);
  B *= mix(1.,inB,clB)*alB;
  if(shp.x>0.5 && (shp.x<7.5 || (shp.x>9.5 && shp.x<10.5))){
    float rim; float mk = shMask(p0, rim);
    if(mk<0.999 || rim>0.){ float ib; vec3 bgc = layer(tB,p,rB,rotB,1.,vec2(0.),0.,tfB,ib)*0.34; B = mix(bgc, B, mk); B = mix(B, vec3(1.), rim*0.92); }
  }
  if(snap>0.5){
    vec2 q = rotP(p,rotB);
    bool inFrame = q.x>frR.x && q.x<frR.x+frR.z && q.y>frR.y && q.y<frR.y+frR.w;
    bool inBorder = q.x>frR.x-border && q.x<frR.x+frR.z+border && q.y>frR.y-border && q.y<frR.y+frR.w+border;
    float ib;
    if(!inFrame) B = inBorder ? vec3(1.) : layer(tB,p,bgR,0.,0.7,vec2(0.),0.,tfB,ib)*(1.-bgDark);
  }
  B = (B + B*exB)*brB;
  vec3 col;
  if(mode<0.5) col = B;
  else if(mode<1.5) col = mix(A,B,mixv);
  else if(mode<2.5) col = prog<0.5 ? A*(1.-2.*prog) : B*(2.*prog-1.);
  else if(mode<3.5) col = inB>0.5 ? B : A;
  else if(mode<5.5){
    float band = floor(p0.y/(res.y/10.)); float h = hash(vec2(band, floor(time*70.)));
    if(h<0.3 && hasA>0.5){ vec4 ra=rA; ra.x += (hash(vec2(band,1.))-0.5)*0.14*res.x; float ia; col = layer(tA,pA,ra,rotA,0.,vec2(0.),0.,tfA,ia); }
    else if(h<0.5){ vec4 rb=rB; rb.x += (hash(vec2(band,2.))-0.5)*0.14*res.x; float ib2; col = layer(tB,p,rb,rotB,0.,vec2(0.),rgbB,tfB,ib2); }
    else col = B;
  }
  else if(mode<6.5){ float q=1.-pow(1.-prog,3.); vec2 far=max(irisC,res-irisC); float R=length(far)*q*1.05; float f=max(1.,R*0.18); float mk=1.-smoothstep(R-f,R,distance(p0,irisC)); col=mix(A,B,mk); }
  else if(mode<7.5){ float q=1.-pow(1.-prog,3.); float s=(p0.x+p0.y*0.6)/(res.x+res.y*0.6); float e=-0.15+q*1.3; float mk=1.-smoothstep(e-0.08,e,s); col=mix(A,B,mk); }
  else if(mode>16.5){ float mk = 0.;   /* the pattern transitions: where the next shot shows */
    if(mode<17.5) mk = step(fract(p0.y/(res.y/12.)), prog);                                   /* stripes */
    else if(mode<18.5) mk = step(fract(p0.x/(res.x/8.)), prog);                               /* blinds */
    else if(mode<19.5){ vec2 c = floor(p0/(res.x/7.)); float t0 = 0.1 + mod(c.x+c.y, 2.)*0.45; mk = smoothstep(t0, t0+0.12, prog); }   /* checkerboard */
    else if(mode<20.5){ float cell = res.x/10.; vec2 c = (floor(p0/cell)+0.5)*cell; mk = step(distance(p0, c)/cell, prog*0.75); }      /* dots */
    else if(mode<21.5) mk = step(hash(floor(p0/3.)), prog);                                    /* noise dissolve */
    else if(mode<22.5) mk = step(abs(p0.y-res.y*0.5), prog*res.y*0.5);                          /* split open */
    else if(mode<23.5){ float e = prog*1.3-0.15 + 0.05*sin(p0.y/res.y*18.+prog*10.); mk = 1.-smoothstep(e-0.02, e, p0.x/res.x); }   /* wave wipe */
    else if(mode<26.5 && mode>25.5){ vec2 c = floor(p0/(res.x/6.)); float h = hash(c)*0.8; mk = smoothstep(h, h+0.2, prog); }       /* random tiles */
    if(mode>23.5 && mode<24.5) col = prog<0.5 ? mix(A, vec3(1.), 2.*prog) : mix(vec3(1.), B, 2.*prog-1.);                      /* dip to white */
    else if(mode>24.5 && mode<25.5) col = vec3(mix(A.r, B.r, smoothstep(0., 0.6, prog)), mix(A.g, B.g, smoothstep(0.2, 0.8, prog)), mix(A.b, B.b, smoothstep(0.4, 1., prog)));   /* colour split */
    else col = mix(A, B, mk);
  }
  else if(mode>11.5){
    if(mode<12.5){ float lb = dot(B, vec3(0.299,0.587,0.114)); col = mix(A, B, smoothstep(0., 0.15, prog*1.2-(1.-lb))); }
    else if(mode<13.5 || mode>15.5) col = mix(A, B, smoothstep(0.35, 0.65, prog));
    else if(mode<14.5){ vec2 dd = p0-res*0.5; float a = mod(atan(dd.x, -dd.y)+6.28318, 6.28318)/6.28318; col = mix(A, B, 1.-smoothstep(prog-0.01, prog, a)); }
    else { float hw = prog*res.x*0.5; col = mix(A, B, 1.-smoothstep(hw-2., hw, abs(p0.x-res.x*0.5))); }
  }
  else if(mode>8.5){ float q=prog*prog*(3.-2.*prog);   /* smooth in and out: the shape is seen growing */ vec2 far=max(irisC,res-irisC); float L=length(far); vec2 d=p0-irisC; float mk;
    if(mode<9.5){ float R=L*1.45*q+1e-3; float v=(abs(d.x)+abs(d.y))/R; mk=1.-smoothstep(0.93,1.,v); }
    else if(mode<10.5){ float R=L*1.9*q+1e-3; vec2 u=d/R; float X=u.x*1.15; float Y=-u.y*1.15+0.3; float a=X*X+Y*Y-1.; float h=a*a*a-X*X*Y*Y*Y; mk=1.-smoothstep(-0.03,0.03,h); }
    else { float R=L*1.85*q+1e-3; float r=length(d)/R; float an=atan(d.y,d.x); float lim=0.55+0.45*pow(0.5+0.5*cos(5.*an+1.5708),3.); mk=1.-smoothstep(lim-0.05,lim,r); }
    col=mix(A,B,mk); }
  else { float k=floor(p0.x/(res.x/6.)); float pk=clamp(prog*1.6-k*0.12,0.,1.); float hh=res.y*(1.-pow(1.-pk,3.)); float mk = mod(k,2.)>0.5 ? step(p0.y,hh) : step(res.y-hh,p0.y); col=mix(A,B,mk); }
  // colour grade
  col = lift + col*(1.-lift);   // lifted blacks (faded / matte)
  col = (col-0.5)*con + 0.5; col *= bri;
  float l = dot(col, vec3(0.299,0.587,0.114));
  col = mix(vec3(l), col, sat);
  if(teal>0.){ vec3 tint = mix(vec3(0.75,1.05,1.12), vec3(1.12,0.98,0.82), smoothstep(0.15,0.85,l)); col = mix(col, col*tint, teal); }
  col *= vec3(1.+0.12*warm, 1., 1.-0.12*warm);   // white balance: warm (+) / cool (-)
  if(tsh.w>0. || thi.w>0.){ float lt = dot(col, vec3(0.299,0.587,0.114)); col = mix(col, col*tsh.rgb*2., tsh.w*(1.-smoothstep(0.,0.6,lt))); col = mix(col, col*thi.rgb*2., thi.w*smoothstep(0.4,1.,lt)); }
  if(leak.z>0.){ float d = distance(p0, leak.xy)/(res.x*0.9); vec3 lc = vec3(1.,0.67,0.35)*leak.z*(1.-smoothstep(0.,1.,d)); col = 1.-(1.-col)*(1.-lc); }
  col = mix(col, vec3(dot(col,vec3(0.299,0.587,0.114))), mono);   // after the light leak: black and white stays black and white
  col += flash;
  if(shp.x>10.5 && shp.x<11.5){ col *= 0.86+0.14*sin(p0.y*1.7); col += (hash(vec2(p0.y*0.13, floor(time*24.)))-0.5)*0.07; col = mix(vec3(dot(col,vec3(0.299,0.587,0.114))), col, 0.78); col.r *= 1.04; col.b *= 0.93; }
  vec2 uvn = p0/res-0.5; float vd = length(uvn*vec2(res.x/res.y,1.)*vec2(1.,1.));
  col *= 1. - vig*smoothstep(0.3,0.75,vd);
  if(grain>0.) col += (hash(p0*0.73 + fract(time*7.)*vec2(97.,13.))-0.5)*grain*0.6;
  col = mix(col, vec3(1.), ring*0.9);   // the magnifier's rim
  if(loopMix>0.) col = mix(col, texture2D(tL, p0/res).rgb, loopMix);
  gl_FragColor = vec4(clamp(col,0.,1.),1.);
}`;

/** a pass over the finished frame: the quad and its uv (v) */
export const PASS_VERT = `attribute vec2 a; varying vec2 v; void main(){ v = vec2(a.x*0.5+0.5, 0.5-a.y*0.5); gl_Position = vec4(a, 0.0, 1.0); }`;

/** Curves and HSL of a shot (cv: M R G B five points each; HSL: 8 bands x hue, saturation, lightness) */
export const GRADE_FRAG = `precision mediump float; varying vec2 v; uniform sampler2D T; uniform float M[5], R[5], G[5], B[5]; uniform vec3 H[8]; uniform float useH;
      float cv(float x, float P[5]){ float s = clamp(x, 0.0, 1.0)*4.0; float k = floor(min(s, 3.999)); float f = s - k; float a = P[0], b = P[1];
        if(k > 0.5){ a = P[1]; b = P[2]; } if(k > 1.5){ a = P[2]; b = P[3]; } if(k > 2.5){ a = P[3]; b = P[4]; } return mix(a, b, f*f*(3.0 - 2.0*f)); }
      vec3 hsv(vec3 c){ vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0); vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g)); vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
        float d = q.x - min(q.w, q.y); return vec3(abs(q.z + (q.w - q.y)/(6.0*d + 1e-6)), d/(q.x + 1e-6), q.x); }
      vec3 rgb(vec3 c){ vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0/3.0, 1.0/3.0))*6.0 - 3.0); return c.z*mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y); }
      void main(){ vec4 t = texture2D(T, v); vec3 c = t.rgb;
        c = vec3(cv(cv(c.r, M), R), cv(cv(c.g, M), G), cv(cv(c.b, M), B));
        if(useH > 0.5){ vec3 x = hsv(c); float hs = 0.0, ss = 0.0, ls = 0.0, ws = 0.0;
          float C[8]; C[0] = 0.0; C[1] = 30.0; C[2] = 60.0; C[3] = 120.0; C[4] = 180.0; C[5] = 235.0; C[6] = 275.0; C[7] = 315.0;
          for(int k = 0; k < 8; k++){ float d = abs(x.x*360.0 - C[k]); d = min(d, 360.0 - d); float w = max(0.0, 1.0 - d/45.0); hs += H[k].x*w; ss += H[k].y*w; ls += H[k].z*w; ws += w; }
          float g = smoothstep(0.05, 0.25, x.y); x.x = fract(x.x + hs*g/12.0 + 1.0); x.y = clamp(x.y*(1.0 + ss*g), 0.0, 1.0); x.z = clamp(x.z*(1.0 + ls*g*0.5), 0.0, 1.0); c = rgb(x); }
        gl_FragColor = vec4(c, t.a); }`;

/** the picture effects (kind = PIC_FX: grain 1 ... duotone 11, zoom3d 12), amt 0-1, time */
export const PIC_FRAG = `precision mediump float; varying vec2 v; uniform sampler2D T; uniform vec2 res; uniform float time, kind, amt;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7)))*43758.5453); }
      float lum(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
      vec3 hue(vec3 c, float a){ const vec3 k = vec3(0.57735); float ca = cos(a); return c*ca + cross(k, c)*sin(a) + k*dot(k, c)*(1.0 - ca); }
      void main(){ vec2 uv = v, px = 1.0/res; vec2 d = uv - 0.5;
        if(kind > 7.5 && kind < 8.5){ float r = length(d); uv = 0.5 + d*(1.0 - 0.35*amt + 0.35*amt*r*r*2.0); }
        if(kind > 8.5 && kind < 9.5){ float r = length(d), a = amt*3.0*max(0.0, 0.5 - r)*sin(time*1.5); float s = sin(a), c = cos(a); uv = 0.5 + vec2(c*d.x - s*d.y, s*d.x + c*d.y); }
        // 3D zoom (time = the shot's progress 0-1): a depth guessed from the picture (the middle and the bottom near, the top and
        // edges far); the camera moves in, so the near part grows faster than the far part and slides across it
        if(kind > 11.5){ float p = smoothstep(0.0, 1.0, time); vec2 q = d*vec2(res.x/res.y, 1.0);
          float nr = 0.65*(1.0 - smoothstep(0.08, 0.45, length(q*vec2(1.25, 0.9) - vec2(0.0, 0.06)))) + 0.35*smoothstep(0.1, 1.0, uv.y);
          uv = 0.5 + d/(1.0 + p*amt*(0.05 + 0.22*nr)) + vec2(0.018*sin(p*3.14159)*(nr - 0.5)*amt, -0.02*p*amt*nr); }
        if(kind > 5.5 && kind < 6.5){ float n = 64.0 - 40.0*amt; vec2 N = vec2(n, n*res.y/res.x); uv = (floor(uv*N)+0.5)/N; }
        if(kind > 6.5 && kind < 7.5){ uv = 0.5 + d*(1.0 + 0.08*amt*dot(d, d)*4.0); }
        vec3 col = texture2D(T, clamp(uv, 0.0, 1.0)).rgb;
        if(kind < 1.5){ float g = hash(uv*res + time*60.0) - 0.5; col += g*0.22*amt; if(hash(vec2(floor(uv.x*res.x/3.0), floor(time*12.0))) > 0.997) col *= 0.6; }
        else if(kind < 2.5){ vec2 c = vec2(0.5 + 0.5*sin(time*0.7), 0.3 + 0.25*cos(time*0.5)); float k = 1.0 - smoothstep(0.0, 0.8, distance(uv, c)); vec3 lc = vec3(1.0, 0.55, 0.25)*k*0.85*amt; col = 1.0 - (1.0 - col)*(1.0 - lc); }
        else if(kind < 3.5) col = hue(col, time*2.0 + uv.y*3.0)*mix(1.0, 1.15, amt);
        else if(kind < 4.5) col = mix(col, 1.0 - col, amt);
        else if(kind < 5.5){ float cell = 9.0, l = lum(col); vec2 q = mod(uv*res, cell) - cell*0.5; float dot0 = step(length(q), cell*0.55*sqrt(1.0 - l)); col = mix(col, vec3(1.0 - dot0)*mix(vec3(1.0), col*1.4, 0.5), amt); }
        else if(kind < 6.5) col = floor(col*6.0 + 0.5)/6.0;
        else if(kind < 7.5){ col *= 0.85 + 0.15*sin(uv.y*res.y*3.14159); col.r = texture2D(T, clamp(uv + vec2(px.x*2.0, 0.0), 0.0, 1.0)).r; col *= 1.0 - 0.6*amt*dot(d, d)*2.0; }
        else if(kind > 9.5 && kind < 10.5){ float gx = lum(texture2D(T, uv + vec2(px.x, 0.0)).rgb) - lum(texture2D(T, uv - vec2(px.x, 0.0)).rgb), gy = lum(texture2D(T, uv + vec2(0.0, px.y)).rgb) - lum(texture2D(T, uv - vec2(0.0, px.y)).rgb);
          float e = clamp(length(vec2(gx, gy))*4.0, 0.0, 1.0); col = mix(col, vec3(1.0 - e)*vec3(0.98, 0.96, 0.92), amt); }
        else if(kind > 10.5 && kind < 11.5){ float l = lum(col); col = mix(col, mix(vec3(0.22, 0.05, 0.42), vec3(1.0, 0.62, 0.25), smoothstep(0.1, 0.9, l)), amt); }
        gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0); }`;
