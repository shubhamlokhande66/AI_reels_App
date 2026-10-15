# Fast Studio beat benchmark

Synthetic songs with known beat times, scored like the comparison table (a beat counts when it is within ±70 ms).

```
cd scripts/studio-beats
python3 make_set1.py                 # 7 songs: 100, 128, off-beat 140, 95->128, drift 108->114, slow 72, fast 174
node score.mjs ../../components/studio/engine.ts
mkdir -p set2 && python3 make_set2.py && cd set2 && node ../score.mjs ../../../components/studio/engine.ts
```

Set 2 (not used while tuning): four-on-the-floor 124, swung hip-hop 90, reggaeton 95, half-time trap 70, piano only 100,
drift 120->126, change 140->100. Needs numpy.
