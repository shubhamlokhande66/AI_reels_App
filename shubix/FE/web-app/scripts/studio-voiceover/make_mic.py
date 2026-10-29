# A stand-in microphone for check-voiceover.cjs: a spoken voice (espeak-ng) with pauses, as out/mic_voice.wav (48 kHz).
import subprocess, wave, os
import numpy as np
SR = 48000
os.makedirs('out', exist_ok=True)
subprocess.run(['espeak-ng', '-v', 'en-us', '-s', '150', '-w', 'out/_v.wav', 'Here are three tips for better reels. One, start with a hook. Two, keep it short. Three, add captions.'], check=True)
with wave.open('out/_v.wav') as w: sr = w.getframerate(); x = np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float32)/32768
y = np.interp(np.arange(int(len(x)*SR/sr))/SR, np.arange(len(x))/sr, x)
a = np.concatenate([np.zeros(int(0.8*SR)), y, np.zeros(int(1.5*SR)), y[:int(3*SR)], np.zeros(int(6*SR))]); a = a/np.abs(a).max()*0.6
with wave.open('out/mic_voice.wav', 'wb') as w: w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes((a*32767).astype(np.int16).tobytes())
os.remove('out/_v.wav'); print('mic voice', round(len(a)/SR, 1), 's')
