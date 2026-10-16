# Fast Studio beat benchmark

Synthetic songs with known beat times (no copyrighted audio), scored like the comparison table: a beat counts when it is
within ±70 ms (F-measure).

```
cd scripts/studio-beats
python3 make_set1.py                                        # set 1: 100, 128, off-beat 140, 95->128, drift 108->114, slow 72, fast 174
mkdir -p set2 && python3 make_set2.py                       # set 2: four-on-the-floor, swung hip-hop, reggaeton, half-time trap, piano, drift, change
mkdir -p set3 && (cd set3 && python3 ../make_set3.py)       # set 3: what Indian Reels use (below)
python3 make_degraded.py . deg1 && python3 make_degraded.py set2 deg2 && python3 make_degraded.py set3 deg3   # as heard on a phone
node score.mjs ../../components/studio/engine.ts            # the on-device tracker alone (any folder with truth.json)
# the neural network (the server's Beat This!), then the two together as the studio uses them:
NODE_OPTIONS="--conditions=react-server" npx tsx --tsconfig ../../tsconfig.json run-beatthis.ts . set2 set3 deg1 deg2 deg3
node ensemble.mjs ../../components/studio/engine.ts . set2 set3 deg1 deg2 deg3
```

Set 3: pop / hip-hop 135 with triplet hats and an 808 on and off the beat, bhangra dhol 98, garba 6/8, lavani dholki
160, Bollywood dembow 96, a free-time intro then 128, kaharwa on tabla 84, a bhajan speeding up 90 -> 140.
`make_degraded.py`: MP3 128 kb/s, room echo, a phone speaker's roll-off, room noise, quieter and slightly clipped.

Results (F-measure, mean per set):

| | set 1 | set 2 | set 3 | set 1 phone | set 2 phone | set 3 phone | 2 real songs* |
|---|---|---|---|---|---|---|---|
| before (tracker only, PR #5) | 100% | 100% | 83.4% | - | - | - | 55% / 49% |
| tracker now | 99.7% | 100% | 86.9% | 90.7% | 87.9% | 79.5% | 100% / 99% |
| Beat This! alone | 94.8% | 92.7% | 80.1% | 93.4% | 85.8% | 78.4% | 60% / 99% |
| **both, as the studio uses them** | **99.7%** | **100%** | **99.7%** | **98.5%** | **89.1%** | **99.7%** | **100% / 99%** |

\* real songs have no annotation: scored against essentia's multi-feature tracker on the beats where essentia, librosa
and Beat This! were compared, and checked by where the hits are (see docs/fast-studio.md).
