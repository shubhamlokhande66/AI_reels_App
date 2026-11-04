# @shubix/core

The code both sides run, moved here once instead of copied twice (found from the import graph):
`src/lib/*` (CMS texts, plans and locks, features, studio templates, collections, chat size, the beat tracker core) and
`src/engine/*` (clip analysis, OpenCV ops, face finding, shots, moments, footage, FFT, Python-exact rounding).

No React, no Node-only APIs. The web app and Metro read the TypeScript (`default` export condition); the API runs the
compiled CommonJS in `dist/` (`node --conditions=shubix-dist`, built by `pnpm --filter @shubix/core build`).
