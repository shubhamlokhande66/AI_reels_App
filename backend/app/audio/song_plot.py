"""Diagnostic plots of a song report, to check the detection by eye: the waveform, RMS energy, onset strength with the
beats on it, the tempo sections and the candidate events, all on one time axis. Needs matplotlib (requirements-dev)."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import librosa
import numpy as np

from app.audio.analyzer import load_audio
from app.audio.beat_detector import HOP, onset_envelope

EVENT_STYLE = {"MUSIC_DROP": ("#d62728", "drop"), "BUILD_UP": ("#2ca02c", "build-up"), "ENERGY_DROP": ("#1f77b4", "energy drop"),
               "SILENCE": ("#7f7f7f", "silence"), "REVERB_TAIL": ("#8c564b", "tail"), "VOCAL_ENTRY": ("#e377c2", "vocal"),
               "TEMPO_CHANGE": ("#17becf", "tempo"), "SECTION_CHANGE": ("#bcbd22", "section")}  # fmt: skip


def plot_report(audio_path: str | Path, report: dict[str, Any], out: str | Path, start: float = 0.0, end: float | None = None) -> Path:
    """Save a PNG of the song from ``start`` to ``end`` seconds (all of it by default)."""
    import matplotlib

    matplotlib.use("Agg")  # no window: a file
    import matplotlib.pyplot as plt

    y, sr = load_audio(Path(audio_path), int(report["audio"]["analysed_seconds"]) + 1)
    end = float(report["audio"]["analysed_seconds"]) if end is None else end
    t = np.arange(len(y)) / sr
    keep = (t >= start) & (t <= end)
    env = onset_envelope(y, sr)
    te = librosa.frames_to_time(np.arange(len(env)), sr=sr, hop_length=HOP)
    rms = librosa.feature.rms(y=y, hop_length=HOP)[0]
    tr = librosa.frames_to_time(np.arange(len(rms)), sr=sr, hop_length=HOP)
    ev = [e for e in report["events"] if start <= e["time"] <= end]

    fig, ax = plt.subplots(4, 1, figsize=(16, 10), sharex=True, gridspec_kw={"height_ratios": [2, 1.2, 2, 1]})
    ax[0].plot(t[keep][::20], y[keep][::20], lw=0.4, color="#555")
    ax[0].set_ylabel("waveform")
    for e in ev:
        if e["event_type"] in EVENT_STYLE:
            color, label = EVENT_STYLE[e["event_type"]]
            if e.get("end"):
                ax[0].axvspan(e["time"], e["end"], color=color, alpha=0.15)
            ax[0].axvline(e["time"], color=color, lw=1.5)
            ax[0].text(e["time"], ax[0].get_ylim()[1] * 0.85, f" {label} {e['confidence']:.2f}", color=color, fontsize=8)

    k = (tr >= start) & (tr <= end)
    ax[1].plot(tr[k], rms[k], color="#9467bd")
    ax[1].set_ylabel("RMS energy")

    k = (te >= start) & (te <= end)
    ax[2].plot(te[k], env[k], lw=0.7, color="#333", label="onset strength")
    top = env[k].max() if k.any() else 1.0
    for kind, color, h in (("WEAK_BEAT", "#aec7e8", 0.4), ("MAIN_BEAT", "#1f77b4", 0.6), ("STRONG_BEAT", "#ff7f0e", 0.8)):
        times = [e["time"] for e in ev if e["event_type"] == kind]
        if times:
            ax[2].vlines(times, 0, top * h, color=color, lw=1, alpha=0.8, label=kind.lower())
    downs = [e["time"] for e in ev if "DOWNBEAT" in e.get("tags", [])]
    if downs:
        ax[2].plot(downs, [top * 0.95] * len(downs), "v", color="#d62728", ms=5, label="downbeat")
    for kind, color, mark in (("SUB_BEAT", "#2ca02c", "|"), ("ONSET", "#7f7f7f", "|"), ("PERCUSSION_HIT", "#9467bd", "|"),
                              ("BASS_HIT", "#8c564b", "|"), ("IMPACT", "#d62728", "*")):  # fmt: skip
        times = [e["time"] for e in ev if e["event_type"] == kind]
        if times:
            ax[2].plot(times, np.zeros(len(times)), mark, color=color, ms=9, label=kind.lower())
    for x in report.get("rhythm", []):
        if x["kind"] == "fast_sequence" and start <= x["start"] <= end:
            ax[2].axvspan(x["start"], x["end"], color="#bcbd22", alpha=0.2)
    for e in ev:
        if e["event_type"] == "FILL":
            ax[2].axvspan(e["time"], e["end"], color="#ff9896", alpha=0.3)
    ax[2].legend(loc="upper right", fontsize=8)
    ax[2].set_ylabel("onsets & beats")

    for s in report["tempo"]["sections"]:
        if s["end"] >= start and s["start"] <= end:
            ax[3].axvspan(max(s["start"], start), min(s["end"], end), alpha=0.25 + 0.5 * s["confidence"] * 0.5, color="#17becf")
            ax[3].text(max(s["start"], start), 0.5, f" {s['estimated_bpm']:g} BPM ({s['confidence']:.2f})", va="center", fontsize=9)
    for seg in report["editing_segments"]:
        if start <= seg["start"] <= end:
            ax[3].axvline(seg["start"], ymin=0, ymax=0.3, color="#000", lw=0.8)
    ax[3].set_yticks([])
    ax[3].set_ylabel("tempo / cuts")
    ax[3].set_xlabel("seconds")
    ax[3].set_xlim(start, end)
    fig.suptitle(f"{Path(audio_path).name}: {report['tempo']['global_bpm']:g} BPM, {report['analysis']['beat_count']} beats, "
                 f"{report['analysis']['possible_drop_count']} drops")  # fmt: skip
    fig.tight_layout()
    out = Path(out)
    fig.savefig(out, dpi=110)
    plt.close(fig)
    return out
