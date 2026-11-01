# Vertical clips of a real person (scikit-image's astronaut photo, public domain): a slow push-in, and a mirrored copy
# placed lower. Writes out/person_<n>.webm and out/person_truth.json: where the face centre is in every clip (fractions
# of the frame) and which part of the picture is background (the left strip: the flag; the top-right: the shuttle).
#   cd scripts/studio-vision && python3 make_person.py      (needs numpy, scikit-image, ffmpeg)
import json, os, subprocess
import numpy as np
from skimage import data, transform
os.makedirs('out', exist_ok=True)
img = data.astronaut()                      # 512x512, face centre at about (225, 128) px
FACE = (225/512, 128/512)
W, H, FPS, DUR = 540, 960, 30, 6.0
truth = {}
for n, (flip, shift) in enumerate([(False, 0.0), (True, 0.18)]):
    src = img[:, ::-1] if flip else img
    fx = (1 - FACE[0]) if flip else FACE[0]
    frames = []; faces = []
    for k in range(int(DUR*FPS)):
        u = k/(DUR*FPS - 1); z = 1.0 + 0.12*u                 # push in 12%
        ch = 512/z; cw = ch*W/H                                # crop of the photo shown (portrait)
        cx = fx*512; x0 = min(max(cx - cw/2, 0), 512 - cw); y0 = 0.0
        crop = transform.resize(src[int(y0):int(y0+ch), int(x0):int(x0+cw)], (H, W), anti_aliasing=True)
        fr = np.zeros((H, W, 3)); dy = int(shift*H); fr[dy:] = crop[:H-dy]; fr[:dy] = crop[0:1].mean(axis=1, keepdims=True)
        frames.append((fr*255).astype(np.uint8))
        faces.append([round((cx - x0)/cw, 4), round((FACE[1]*512 - y0)/ch + dy/H, 4)])   # the picture moved down by dy, same size
    name = f'person_{n}'
    p = subprocess.Popen(['ffmpeg', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-',
                          '-c:v', 'libvpx-vp9', '-b:v', '2M', '-deadline', 'realtime', '-cpu-used', '8', '-pix_fmt', 'yuv420p', f'out/{name}.webm'], stdin=subprocess.PIPE)
    for f in frames: p.stdin.write(f.tobytes())
    p.stdin.close(); p.wait()
    truth[name] = {'face': faces[::15], 'every': 15/FPS, 'dur': DUR, 'shift': shift, 'flip': flip}
    print(name, 'face at start', faces[0], 'end', faces[-1])
json.dump(truth, open('out/person_truth.json', 'w'), indent=1)
