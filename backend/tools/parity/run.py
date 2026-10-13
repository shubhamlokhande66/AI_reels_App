"""Parity runner for the Next.js migration: reads JSON cases on stdin, runs them through the Python code, writes
results on stdout. A case is {"kind": ..., ...}; see frontend/tests/server/*.parity.test.ts."""

from __future__ import annotations

import json
import sys

from pydantic import TypeAdapter

from app.core.errors import AppError


def ops_case(c: dict) -> dict:
    from app.models.timeline import Timeline
    from app.video.timeline_ops import OpContext, Operation, apply_operations

    tl = Timeline.model_validate(c["timeline"])
    ops = TypeAdapter(list[Operation]).validate_python(c["ops"])
    ctx = OpContext(clip_durations=c["ctx"]["clipDurations"], clip_names=c["ctx"]["clipNames"], audio_duration=c["ctx"]["audioDuration"])
    try:
        return {"ok": True, "timeline": apply_operations(tl, ops, ctx).to_doc()}
    except AppError as e:
        return {"ok": False, "code": e.code, "message": e.message}


def keyframes_case(c: dict) -> dict:
    from app.models.timeline import Keyframe
    from app.video import keyframes as kf

    ks = [Keyframe.model_validate(k) for k in c["keyframes"]]
    v, notes = kf.validate(ks, c["length"])
    return {"keyframes": [k.to_doc() for k in v], "notes": notes, "source": kf.source_seconds(v, c["length"]),
            "motion": kf.motion_chain(v, 1080, 1920), "frame": kf.frame_filters(v, 1080, 1920),
            "setpts": kf.speed_setpts(v, c["length"]) if kf.has_speed(v) else None}


def dsp_case(c: dict) -> dict:
    """librosa's features of a signal, for frontend/server/audio/dsp (the same signal, the same calls)."""
    import librosa
    import numpy as np

    y = np.asarray(c["y"], dtype=np.float32)
    sr = 22050
    S = np.abs(librosa.stft(y, n_fft=2048, hop_length=512))
    mel = librosa.feature.melspectrogram(y=y, sr=sr, hop_length=512)
    env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=512)
    low = S[librosa.fft_frequencies(sr=sr, n_fft=2048) <= 150]
    Sc = np.abs(librosa.stft(y, n_fft=1024, hop_length=1024)).astype(np.float32)
    harm, perc = librosa.decompose.hpss(Sc, kernel_size=(17, 17))
    mf = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=13, hop_length=2048)
    L = lambda a: [float(v) for v in np.asarray(a).ravel()]
    return {
        "S": L(S), "shape": list(S.shape), "mel": L(mel), "env": L(env),
        "bandOnset": L(librosa.onset.onset_strength(S=librosa.amplitude_to_db(low, ref=np.max), sr=sr, hop_length=512)),
        "rmsY": L(librosa.feature.rms(y=y, frame_length=2048, hop_length=512)[0]), "rmsS": L(librosa.feature.rms(S=S, frame_length=2048)[0]),
        "centroid": L(librosa.feature.spectral_centroid(S=S, sr=sr)[0]), "bandwidth": L(librosa.feature.spectral_bandwidth(S=S, sr=sr)[0]),
        "rolloff": L(librosa.feature.spectral_rolloff(S=S, sr=sr)[0]), "zcr": L(librosa.feature.zero_crossing_rate(y, frame_length=2048, hop_length=512)[0]),
        "tuning": float(librosa.estimate_tuning(S=S**2, sr=sr)), "chroma": L(librosa.feature.chroma_stft(S=S**2, sr=sr)),
        "mfcc": L(mf), "mfccNorm": L(librosa.util.normalize(mf, axis=1)), "tempo": float(librosa.feature.tempo(onset_envelope=env, sr=sr, hop_length=512)[0]),
        "onsets": [int(v) for v in librosa.onset.onset_detect(onset_envelope=env, sr=sr, hop_length=512)],
        "peaks": [int(v) for v in librosa.util.peak_pick(env, pre_max=6, post_max=6, pre_avg=12, post_avg=12, delta=0.4 * float(np.percentile(env, 97)), wait=10)],
        "harm": L(harm), "perc": L(perc), "percShape": list(Sc.shape),
        "segments": [int(v) for v in librosa.segment.agglomerative(mf, 4)],
        "segments2": [int(v) for v in librosa.segment.agglomerative(librosa.util.normalize(mf, axis=1), 7)],
        "ac": L(librosa.autocorrelate(env - env.mean())),
    }


KINDS = {"ops": ops_case, "keyframes": keyframes_case, "dsp": dsp_case}

if __name__ == "__main__":
    cases = json.load(sys.stdin)
    json.dump([KINDS[c["kind"]](c) for c in cases], sys.stdout)
