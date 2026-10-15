# Every song of a set again as it reaches a phone: MP3 at 128 kb/s, then phone-mic room echo and noise, quieter and
# slightly clipped. Writes <set>_deg/ with the same truth.json.   python3 make_degraded.py <set dir> <out dir>
import json, os, subprocess, sys, wave, numpy as np
src, dst = sys.argv[1], sys.argv[2]; os.makedirs(dst, exist_ok=True); rng = np.random.default_rng(11)
truth = json.load(open(os.path.join(src, 'truth.json'))); json.dump(truth, open(os.path.join(dst, 'truth.json'), 'w'))
for name in truth:
    a, b = os.path.join(src, name + '.wav'), os.path.join(dst, name + '.mp3')
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', a, '-b:a', '128k', b], check=True)
    raw = subprocess.run(['ffmpeg', '-loglevel', 'error', '-i', b, '-ac', '1', '-ar', '44100', '-f', 's16le', '-'], capture_output=True, check=True).stdout
    x = np.frombuffer(raw, np.int16)/32768.0
    sr = 44100; n = int(0.4*sr); ir = rng.standard_normal(n)*np.exp(-np.arange(n)/(0.08*sr)); ir[0] = 1; ir /= np.sqrt(np.sum(ir**2))
    y = np.convolve(x, ir)[:len(x)]*0.6 + 0.4*x                                 # room echo
    y = np.convolve(y, np.ones(3)/3, mode='same')                                # small phone speaker / mic roll-off
    y = y + 0.02*rng.standard_normal(len(y))                                     # room noise (about -34 dB)
    y = np.clip(0.55*y/np.max(np.abs(y))*1.15, -0.55, 0.55)                       # quieter, a little clipped
    with wave.open(os.path.join(dst, name + '.wav'), 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr); w.writeframes((y*32767).astype(np.int16).tobytes())
    os.remove(b)
print('degraded', len(truth), 'songs ->', dst)
