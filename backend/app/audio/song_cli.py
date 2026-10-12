"""Analyse a song from the command line.

    python -m app.audio.song_cli song.mp3                       # report JSON to the screen
    python -m app.audio.song_cli song.mp3 --out report.json     # ... to a file
    python -m app.audio.song_cli song.mp3 --plot check.png      # + a diagnostic plot
    python -m app.audio.song_cli song.mp3 --min-clip 0.6 --every-beat --plot check.png --from 0 --to 30
    python -m app.audio.song_cli song.mp3 --analysis --out analysis.json   # the analysis document (measurements only)

Run it from the backend folder (``cd backend``) with the project's Python (``.venv\\Scripts\\python.exe``).
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="song_cli", description="Beats, tempo, drops and Reel cut points of a song.")
    ap.add_argument("song", type=Path, help="an MP3, WAV, M4A, AAC, OGG, FLAC... file")
    ap.add_argument("--min-clip", type=float, default=0.4, help="shortest clip in seconds (0.25, 0.40, 0.60...)")
    ap.add_argument("--every-beat", action="store_true", help="a cut on every beat (faster beats than --min-clip are grouped)")
    ap.add_argument("--out", type=Path, help="write the JSON report here")
    ap.add_argument("--plot", type=Path, help="save a diagnostic plot (PNG) here")
    ap.add_argument("--analysis", action="store_true", help="the analysis document (beats, onsets, frame features, events)")
    ap.add_argument("--frame-step", type=int, default=1, help="with --analysis: keep every n-th frame of frame_features")
    ap.add_argument("--from", dest="start", type=float, default=0.0, help="plot from this second")
    ap.add_argument("--to", dest="end", type=float, default=None, help="plot up to this second")
    args = ap.parse_args(argv)

    if not args.song.is_file():
        print(f"error: no such file: {args.song}", file=sys.stderr)
        return 2
    if not 0.1 <= args.min_clip <= 5.0:
        print("error: --min-clip must be between 0.1 and 5 seconds", file=sys.stderr)
        return 2
    if args.analysis:
        from app.audio.analysis_json import analyze_to_json

        doc = analyze_to_json(args.song, frame_step=max(args.frame_step, 1))
        text = json.dumps(doc, indent=2, ensure_ascii=False)
        if args.out:
            args.out.write_text(text, encoding="utf-8")
        else:
            print(text)
        for e in doc["errors"]:
            print(f"{'error' if doc['status'] == 'failed' else 'note'}: {e}", file=sys.stderr)
        return 0 if doc["status"] == "completed" else 1
    from app.audio.song_report import analyze_song
    from app.core.errors import AppError

    t0 = time.monotonic()
    try:
        report = analyze_song(args.song, min_clip=args.min_clip, every_beat=args.every_beat)
    except AppError as exc:
        print(f"error: {exc.message}", file=sys.stderr)
        return 1
    took = time.monotonic() - t0
    text = json.dumps(report, indent=2, ensure_ascii=False)
    if args.out:
        args.out.write_text(text, encoding="utf-8")
    else:
        print(text)
    s = report["analysis"]
    print(f"{report['audio']['analysed_seconds']:.1f} s of audio in {took:.1f} s: {report['tempo']['global_bpm']:g} BPM, {s['beat_count']} beats, "
          f"{s['possible_drop_count']} drops, {len(report['editing_segments'])} clips (min {s['min_clip_seconds']} s)", file=sys.stderr)  # fmt: skip
    for w in s["warnings"]:
        print(f"warning: {w}", file=sys.stderr)
    if args.plot:
        from app.audio.song_plot import plot_report

        print(f"plot: {plot_report(args.song, report, args.plot, args.start, args.end)}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
