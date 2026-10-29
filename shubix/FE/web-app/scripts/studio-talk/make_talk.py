# Talking-head test clips with known speech: phrases spoken by espeak-ng (English, Hindi, Marathi) with known pauses
# between them (short natural ones and long ones that should be cut), quiet room noise, a moving picture with a "face".
# Writes out/talk_<n>.webm (VP9 + Opus, 720x1280) and out/talk_truth.json (speech intervals per clip, in seconds).
#   cd scripts/studio-talk && python3 make_talk.py        (needs espeak-ng, ffmpeg, numpy)
import json, os, subprocess, wave
import numpy as np
SR = 48000
os.makedirs('out', exist_ok=True)
rng = np.random.default_rng(11)
def say(text, voice, speed=150):
    subprocess.run(['espeak-ng', '-v', voice, '-s', str(speed), '-w', 'out/_p.wav', text], check=True)
    with wave.open('out/_p.wav') as w: sr = w.getframerate(); x = np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float32)/32768
    t = np.arange(int(len(x)*SR/sr))/SR; y = np.interp(t, np.arange(len(x))/sr, x)
    nz = np.nonzero(np.abs(y) > 0.01)[0]; return y[nz[0]:nz[-1]+1] if len(nz) else y   # trimmed to the voice
CLIPS = [
  ('en-us', [("Hi everyone, welcome back to my channel.", 1.6), ("Today I will show you three quick tips.", 0.3), ("Tip number one: always start with a hook.", 2.2),
             ("Tip number two: keep it short.", 0.35), ("And tip three: add captions.", 1.2)]),
  ('hi',    [("नमस्ते दोस्तों, आज हम कुछ नया सीखेंगे।", 1.4), ("यह बहुत आसान है।", 0.3), ("बस मेरे साथ बने रहिए।", 1.8)]),
  ('mr',    [("नमस्कार मित्रांनो, आज आपण गणपती सजावट बघणार आहोत।", 2.0), ("चला सुरुवात करूया।", 0.4), ("हे खूप सोपं आहे।", 1.0)]),
]
truth = {}
for n, (voice, parts) in enumerate(CLIPS):
    lead = 0.9 + 0.3*n; audio = [np.zeros(int(lead*SR))]; t = lead; spans = []
    for text, gap in parts:
        y = say(text, voice); spans.append([round(t, 3), round(t + len(y)/SR, 3)]); audio += [y, np.zeros(int(gap*SR))]; t += len(y)/SR + gap
    a = np.concatenate(audio); a = a/np.max(np.abs(a))*0.5
    a += 0.004*rng.standard_normal(len(a)) + 0.003*np.sin(2*np.pi*50*np.arange(len(a))/SR)   # room noise and mains hum
    dur = len(a)/SR
    with wave.open('out/_a.wav', 'wb') as w: w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes((np.clip(a, -1, 1)*32767).astype(np.int16).tobytes())
    name = f'talk_{n}'
    # picture: a coloured room with a skin-toned "face" that moves a little (as a person talking does)
    vf = (f"color=c=0x{['3a5f7d','6d4c3d','2f5d50'][n]}:s=720x1280:r=30:d={dur:.3f},format=yuv420p,"
          f"drawbox=x='300+20*sin(t*1.3)':y='380+10*sin(t*2.1)':w=150:h=200:color=0xe0b090:t=fill,"
          f"drawbox=x=0:y=1000:w=720:h=280:color=0x222222:t=fill,noise=alls=12:allf=t")
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', vf, '-i', 'out/_a.wav', '-c:v', 'libvpx-vp9', '-b:v', '1M', '-deadline', 'realtime', '-cpu-used', '8',
                    '-c:a', 'libopus', '-b:a', '96k', '-shortest', f'out/{name}.webm'], check=True)
    truth[name] = {'voice': voice, 'dur': round(dur, 3), 'speech': spans, 'gaps': [g for _, g in parts[:-1]]}
    print(name, voice, f'{dur:.1f} s', len(spans), 'phrases')
for f in ('out/_a.wav', 'out/_p.wav'): os.remove(f)
json.dump(truth, open('out/talk_truth.json', 'w'), indent=1, ensure_ascii=False)
