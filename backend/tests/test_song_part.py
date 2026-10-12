"""Which part of the song a Reel uses: the AI picks among the best-ranked parts; without AI a new version rotates."""

from __future__ import annotations

from app.audio.analyzer import analyze_audio
from app.director.song_part import choose_song_part
from app.video.timeline import rank_music_windows


class FakeAI:
    def __init__(self, pick):
        self.pick, self.seen = pick, None

    def chat_json(self, system, user, **kw):
        self.seen = user
        return {"pick": self.pick, "reason": "the calm intro suits the product shots"}


def test_ai_picks_a_part_and_says_why(media_dir):
    audio = analyze_audio(media_dir / "beat120.wav")
    cands = rank_music_windows(audio, 6, 5)
    ai = FakeAI(2)
    start, note = choose_song_part(audio, 6, "start with the calm intro", "premium", "6 clips: product (6)", 0, True, provider=ai)
    assert start == cands[2]["start"] and note.startswith("AI chose the song part") and "calm intro" in note
    assert "start with the calm intro" in ai.seen and '"candidates"' in ai.seen
    bad, _ = choose_song_part(audio, 6, "", None, "", 0, True, provider=FakeAI(99))  # an impossible answer: the default
    assert bad is None


def test_without_ai_new_versions_rotate(media_dir):
    audio = analyze_audio(media_dir / "beat120.wav")
    cands = rank_music_windows(audio, 6, 5)
    assert choose_song_part(audio, 6, "", None, "", 0, False) == (None, "")  # the first version: the best part
    starts = {choose_song_part(audio, 6, "", None, "", seed, False)[0] for seed in (1, 2, 4, 5)}
    assert starts <= {c["start"] for c in cands[:3]} and len(starts) >= 2


def test_the_same_song_again_starts_at_the_same_point(storage, media_dir):
    """The song uploaded again (another project, same settings) reuses the first choice: same start, same beats."""
    from app.jobs import pipeline as pl
    from app.schemas.project import ProjectSettings

    def project(pid, **settings):
        key = f"projects/{pid}/input/song.wav"
        storage.write_bytes(key, (media_dir / "beat120.wav").read_bytes())
        return pl.PipelineInput(project_id=pid, job_type="generate", videos=[], audio=pl.MediaRef(f"{pid}a", "song.wav", key),
                                settings=ProjectSettings(**settings))  # fmt: skip

    asked = []
    choices = iter([(12.0, "AI chose 0:12"), (30.0, "AI chose 0:30"), (40.0, "AI chose 0:40")])

    def choose():
        asked.append(1)
        return next(choices)

    assert pl._remembered_song_part(storage, project("p1"), choose) == (12.0, "AI chose 0:12")
    assert pl._remembered_song_part(storage, project("p2"), choose) == (12.0, "AI chose 0:12")  # same song: same start
    assert len(asked) == 1
    assert pl._remembered_song_part(storage, project("p3", brief="use the drop"), choose)[0] == 30.0  # other instructions: a fresh choice
    v2 = project("p4")
    v2.seed = 1
    assert pl._remembered_song_part(storage, v2, choose)[0] == 40.0  # a new version: a fresh choice
