# Scene changes and the subject-following crop (Fast Studio)

- `make_clips.py` writes two test clips with known answers into `out/`:
  - `scenes.webm`: hard cuts (one between two scenes with almost the same colours), a fade through black, a 1 s dissolve,
    and traps that are not scene changes (a fast pan, a 2-frame white flash, a ball passing through).
  - `subject.webm`: one subject on a shaky handheld background that stands, walks across, and stands again.
- `check.cjs` loads both in `/studio` (needs `npm i playwright` and a running app) and prints the scene changes found, the
  shots that run across a true boundary, and how often the subject is inside the frame (new moving crop vs the old fixed one).

Results (headless Chromium): 5/5 scene changes found (hard cuts within one frame, the whole fade and dissolve covered),
no false ones (also none on six clips without scene changes), 0 shots across a boundary; subject in frame 100% on long
shots where the best fixed crop manages 12-45%, camera jerk about 0.3 px/frame².
