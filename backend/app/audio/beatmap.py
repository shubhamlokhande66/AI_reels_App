"""The song's beat map and cut plan, for the music-first screen (and, with ``beat_plan``, for the edit itself).

- **beats**: the beat grid (carried on to the end of the song when the beat is steady: trackers often stop early)
- **major**: a strong hit: a downbeat, or a beat whose hit is at full strength (accent strength, not the loudness at one
  instant, which can sit in a dip right on the beat)
- **sub-beats**: every hit between beats, each listed; the hard ones get a flash. Fast runs (hi-hats, rolls) are also
  summarised as one row
- **loud / soft** is judged within the song's part (a drop or chorus is never "calm"), not against the whole song
- **rises / falls**: stretches where rhythm and energy climb (build-up) or fall away (breakdown)
- **plan**: the edit, cut by cut, like an editor's sheet: an opening fade-in, the reveal on the first strong hit, a cut
  on every beat (every second beat when beats are under 0.65 s apart, faster in build-ups, slower in breakdowns), an
  impact on the drop and strong hits, flashes on hard hits between beats, and a hero shot that fades out at the end

Everything comes from the cached music analysis (audio/analyzer.py): no AI, no extra cost. Effect names are the
renderer's own (video/cutter.py), so what the plan says is what the Reel does.
"""

from __future__ import annotations

from bisect import bisect_left
from statistics import median
from typing import Any

from app.models.analysis import AudioAnalysis

CURVE_STEP = 0.25  # seconds per point of the energy / rhythm curves sent to the screen
TREND_WINDOW = 4.0
TREND_MIN = 0.12
MIN_TREND_SECONDS = 2.0
MAJOR_HIT = 0.95  # accent strength that makes a beat a strong hit
HARD_SUB = 0.9  # a hit between beats this strong gets a flash
MIN_SHOT = 0.35
PUNCH_GAP = 3.0  # punches (on a cut or on a hit between beats) stay at least this far apart: more looks cheap
# the way into each shot, by the moment in the music; it lands on the beat (video/timeline.apply_plan times it)
# crisp ways in only: FFmpeg's zoom transition blows the outgoing frame up (a mushy blur on small clips), and the smooth
# wipes and blur have soft, blurry edges; the punch energy comes from a punch-in on the new shot instead
TRANSITIONS: dict[str, tuple[tuple[str, ...], float]] = {
    "drop": (("flash",), 0.2),
    "major_loud": (("slide_left", "cover_up", "slide_right", "cover_down"), 0.24),
    "beat_loud": (("slide_up", "slide_left", "slide_down", "slide_right"), 0.2),
    "major_soft": (("dissolve",), 0.35),
    "beat_soft": (("dissolve",), 0.3),
    "rise": (("cover_up", "slide_up"), 0.2),
    "fall": (("dissolve",), 0.45),
    "hero": (("dissolve",), 0.4),
}
TRANSITION_LABEL = {"cut": "Cut", "flash": "Flash", "slide_left": "Slide left", "slide_right": "Slide right", "slide_up": "Slide up",
                    "slide_down": "Slide down", "cover_up": "Cover up", "cover_down": "Cover down", "dissolve": "Dissolve",
                    "fade_in": "Fade in"}  # fmt: skip
FLASH_MARGIN = 0.25  # a flash inside a shot keeps this far from a cut: shorter pieces are dropped (timeline_ops.MIN_SEGMENT)
CLOSE_HIT = 0.06  # a hit nearer a cut than this is the cut itself
ROLL_GAP = 0.2  # hits closer than this are a fast run (a roll); only the roll into a drop gets stutter punches
STAND_OUT = 0.2  # a hard hit is an accent when it is this much harder than the median hit around it
ROLL_HITS = 4  # the stutter into a drop uses at most its last 4 hits
MEDIUM_SUB = 0.6  # an accent between beats this strong gets a punch (one per shot); softer ticks are the groove
FLASH_GAP = 3.0  # at most one flash cut every 3 s (the drop always flashes): more looks cheap
LOUD_SHOTS = ("Impact: close-up / detail", "Big movement / new angle", "Close-up of the best detail", "Wide shot, then punch in")
ENDING = 1.6  # seconds held by the final hero shot
LOUD_PARTS = {"drop", "chorus"}

# key: (effect, label, why)
EFFECTS: dict[str, tuple[str, str, str]] = {
    "drop": ("crash_zoom", "Crash zoom + flash", "the drop: the music kicks in"),
    "major_loud": ("punch", "Punch in", "a strong hit in a loud part"),
    "major_soft": ("zoom_in", "Cut + slow zoom-in", "a strong hit in a softer part"),
    "beat_loud": ("none", "Clean", "a beat in a loud part"),
    "beat_soft": ("zoom_in", "Slow push in", "a beat in a softer part"),
    "sub_hit": ("beat_flash", "Flash", "a hard hit between beats"),
    "sub": ("none", "Quick cut (fast styles only)", "a small hit between beats"),
    "rise": ("zoom_in", "Faster cuts + zoom in", "the rhythm and energy build up"),
    "fall": ("ken_burns", "Longer shots + slow drift", "the rhythm and energy fall away"),
}


def _near(sorted_times: list[float], t: float, tol: float) -> bool:
    i = bisect_left(sorted_times, t)
    return any(0 <= j < len(sorted_times) and abs(sorted_times[j] - t) <= tol for j in (i - 1, i))


def beat_grid(a: AudioAnalysis) -> tuple[list[float], float]:
    """(beat times, seconds between beats). The spacing is measured from the beats themselves (the tracker's BPM can be
    double or half of the beats it lists). A steady grid is carried on to the end of the song."""
    beats = sorted(a.beats)
    if len(beats) < 2:
        return beats, 60.0 / a.bpm if a.bpm > 0 else 0.5
    period = float(median([y - x for x, y in zip(beats, beats[1:])]))
    if a.beat_confidence >= 0.6 and period > 0.2:
        t = beats[-1] + period
        while t <= a.duration - 0.15:
            beats.append(round(t, 3))
            t += period
    return beats, period


def _curve(a: AudioAnalysis, hop: float, values: list[float]) -> list[float]:
    if not values:
        return []
    n = int(a.duration / CURVE_STEP) + 1
    return [round(float(values[min(int(k * CURVE_STEP / hop), len(values) - 1)]), 3) for k in range(n)]


def _smooth(xs: list[float], width: int) -> list[float]:
    out, acc = [], 0.0
    for i, x in enumerate(xs):
        acc += x
        if i >= width:
            acc -= xs[i - width]
        out.append(acc / min(i + 1, width))
    return out


def _trends(drive: list[float]) -> list[dict[str, Any]]:
    w = int(TREND_WINDOW / CURVE_STEP)
    labels: list[str] = []
    for i in range(len(drive)):
        before, after = drive[max(i - w, 0) : i + 1], drive[i : i + w + 1]
        d = (sum(after) / len(after)) - (sum(before) / len(before))
        labels.append("rise" if d >= TREND_MIN else "fall" if d <= -TREND_MIN else "")
    spans: list[dict[str, Any]] = []
    i = 0
    while i < len(labels):
        j = i
        while j + 1 < len(labels) and labels[j + 1] == labels[i]:
            j += 1
        start, end = i * CURVE_STEP, (j + 1) * CURVE_STEP
        if labels[i] and end - start >= MIN_TREND_SECONDS:
            change = drive[min(j + w // 2, len(drive) - 1)] - drive[max(i - w // 2, 0)]
            if (change >= TREND_MIN) if labels[i] == "rise" else (change <= -TREND_MIN):
                spans.append({"kind": labels[i], "start": round(start, 2), "end": round(end, 2), "change": round(change, 2)})
        i = j + 1
    return spans


def song_trends(a: AudioAnalysis) -> list[dict[str, Any]]:
    energy = _curve(a, a.energy_hop, a.energy)
    rhythm = _curve(a, a.curve_hop, a.density) or [0.0] * len(energy)
    n = min(len(energy), len(rhythm))
    return _trends(_smooth([(energy[i] + rhythm[i]) / 2 for i in range(n)], int(1.0 / CURVE_STEP)))


class Song:
    """Measurements shared by the map and the plan."""

    def __init__(self, a: AudioAnalysis):
        self.a = a
        self.beats, self.period = beat_grid(a)
        self.strong = sorted(a.strong_beats)
        self.drops = sorted(a.drops)
        pairs = sorted(zip(a.accents, a.accent_strengths or [0.5] * len(a.accents)))  # by time: hit() searches it
        self.acc_t = [t for t, _ in pairs]
        self.acc_s = [h for _, h in pairs]
        local = [a.mean_energy(max(b - 2, 0), b + 2) for b in self.beats] or [0.5]
        self.loud_cut = sorted(local)[int(len(local) * 0.5)]
        subs: list[float] = []
        for t in sorted({round(x, 3) for x in a.accents} | {round(x, 3) for x in a.onsets}):
            if not _near(self.beats, t, min(self.period * 0.2, 0.08)) and (not subs or t - subs[-1] > 0.06):
                subs.append(t)  # two detectors hearing the same hit: one moment
        self.subs = subs

    def hit(self, t: float, tol: float = 0.08) -> float:
        """How hard the music hits at ``t`` (0..1): the nearest accent's strength."""
        i = bisect_left(self.acc_t, t)
        return max((self.acc_s[k] for k in (i - 1, i) if 0 <= k < len(self.acc_t) and abs(self.acc_t[k] - t) <= tol), default=0.0)

    def part(self, t: float) -> str:
        sec = self.a.section_at(t + 0.05)  # a hit right on a boundary belongs to the part it starts
        return sec.label if sec else ""

    def loud(self, t: float) -> bool:
        return self.part(t) in LOUD_PARTS or self.a.mean_energy(max(t - 2, 0), t + 2) >= self.loud_cut

    def is_drop(self, t: float) -> bool:
        return _near(self.drops, t, self.period * 0.5)

    def is_major(self, t: float) -> bool:
        return _near(self.strong, t, 0.06) or self.hit(t) >= MAJOR_HIT

    def key(self, t: float) -> str:
        if self.is_drop(t):
            return "drop"
        return ("major_" if self.is_major(t) else "beat_") + ("loud" if self.loud(t) else "soft")

    def groove(self, t: float) -> bool:
        """Part of a steady run of small hits (hi-hats): neighbours on both sides under 0.2 s away."""
        i = bisect_left(self.subs, t)
        before = i > 0 and t - self.subs[i - 1] < ROLL_GAP
        after = i + 1 < len(self.subs) and self.subs[i + 1] - t < ROLL_GAP
        return before and after

    def hard_subs(self, start: float = 0.0, end: float = 1e9) -> list[float]:
        """Hard hits between beats that stand out. A hard hit that repeats at the same place in the beat across the
        bars around it (a clap on every off-beat) is the groove: the cuts on the beat already carry it."""
        if not hasattr(self, "_hard"):
            raw = [t for t in self.subs if self.hit(t, 0.06) >= HARD_SUB]
            self._hard = [t for t in raw if not self._pattern(t, raw) and self._stands_out(t)]
        return [t for t in self._hard if start <= t <= end]

    def _stands_out(self, t: float) -> bool:
        """Clearly harder than the hits around it (within 1 s): an accent, not one of many equal hits."""
        around = sorted(self.hit(x, 0.06) for x in [*self.subs, *self.beats] if 0.05 < abs(x - t) <= 1.0)
        return not around or self.hit(t, 0.06) - around[len(around) // 2] >= STAND_OUT

    def _pattern(self, t: float, raw: list[float]) -> bool:
        i = bisect_left(self.beats, t) - 1
        if i < 0:
            return False
        phase = t - self.beats[i]
        same = 0
        for k in (-4, -3, -2, -1, 1, 2, 3, 4):
            j = i + k
            if 0 <= j < len(self.beats) and _near(raw, self.beats[j] + phase, self.period * 0.08):
                same += 1
        return same >= 3


def beat_map(a: AudioAnalysis) -> dict[str, Any]:
    s = Song(a)
    events: list[dict[str, Any]] = []
    downs = sorted(a.downbeats)
    known = list(zip(a.beats, a.beat_levels)) if len(a.beat_levels) == len(a.beats) else []
    for t in s.beats:
        key = s.key(t)
        level = next((lv for bt, lv in known if abs(bt - t) <= 0.03), 1)  # audio/accents.py: 4 / 3 bar start, 2 backbeat, 1 other
        events.append({"t": round(t, 3), "kind": "major" if key in ("drop", "major_loud", "major_soft") else "beat",
                       "strength": round(max(s.hit(t), a.energy_at(t) * 0.8), 2), "key": key, "level": level,
                       "downbeat": _near(downs, t, 0.03)})  # fmt: skip
    for d in s.drops:  # a drop between beats still gets its moment
        if not any(abs(ev["t"] - d) <= s.period * 0.5 for ev in events):
            events.append({"t": round(d, 3), "kind": "major", "strength": 1.0, "key": "drop"})
    for t in s.subs:  # every hit between beats; the hard ones flash
        h = s.hit(t, 0.06)
        events.append({"t": t, "kind": "sub", "strength": round(max(h, a.energy_at(t) * 0.6), 2), "key": "sub_hit" if h >= HARD_SUB else "sub"})
    events.sort(key=lambda ev: ev["t"])
    for ev in events:
        effect, label, why = EFFECTS[ev.pop("key")]
        ev.update(effect=effect, effectLabel=label, why=why, section=s.part(ev["t"]))

    rolls: list[dict[str, Any]] = []  # fast runs of small hits, summarised
    run: list[float] = []
    for t in s.subs + [float("inf")]:
        if run and t - run[-1] > s.period * 0.75:
            if len(run) >= 3:
                rolls.append({"start": run[0], "end": run[-1], "count": len(run), "perSecond": round(len(run) / max(run[-1] - run[0], 0.1), 1)})
            run = []
        if t != float("inf"):
            run.append(t)

    energy = _curve(a, a.energy_hop, a.energy)
    rhythm = _curve(a, a.curve_hop, a.density) or [0.0] * len(energy)
    n = min(len(energy), len(rhythm))
    trends = _trends(_smooth([(energy[i] + rhythm[i]) / 2 for i in range(n)], int(1.0 / CURVE_STEP)))
    for tr in trends:
        effect, label, why = EFFECTS[tr["kind"]]
        tr.update(effect=effect, effectLabel=label, why=why)

    plan = cut_plan(a, s, trends)
    from app.director.plan_motion import annotate_plan  # the keyframes and ramps each shot will get

    annotate_plan(plan, a)
    count = {k: sum(1 for ev in events if ev["kind"] == k) for k in ("major", "beat", "sub")}
    return {
        "bpm": round(60.0 / s.period, 1), "trackerBpm": round(a.bpm, 1), "seconds": round(a.duration, 2), "beatSeconds": round(s.period, 3),
        "beatConfidence": round(a.beat_confidence, 2), "downbeatConfidence": round(a.downbeat_confidence, 2),
        "counts": {**count, "hardSub": len(s.hard_subs()), "rolls": len(rolls), "drops": len(s.drops),
                   "rises": sum(t["kind"] == "rise" for t in trends), "falls": sum(t["kind"] == "fall" for t in trends),
                   "cuts": sum(1 for p in plan if p["transition"] != "fade_in" and p["kind"] == "cut")},
        "events": events, "rolls": rolls, "trends": trends, "plan": plan,
        "sections": [{"label": x.label, "start": round(x.start, 2), "end": round(x.end, 2), "energy": round(x.energy, 2), "cutOn": x.cut_on}
                     for x in a.song_sections],
        "drops": [round(d, 3) for d in s.drops],
        "curveStep": CURVE_STEP, "energy": energy[:n], "rhythm": rhythm[:n],
    }  # fmt: skip


def cut_plan(a: AudioAnalysis, s: Song | None = None, trends: list[dict[str, Any]] | None = None,
             start: float = 0.0, end: float | None = None, max_shots: int | None = None,
             every_beat: bool = False, min_shot: float = MIN_SHOT) -> list[dict[str, Any]]:  # fmt: skip
    """The edit, moment by moment, for the song from ``start`` to ``end`` (song time). Rows of kind "cut" start a new
    shot ({t, end, shot, effect, effectLabel, transition, why}). A hard hit between beats becomes a "flash" inside a
    shot, or, when it is under 0.25 s from a cut (too short a piece to show), a "ramp" (the shot speeds up into the
    next cut) or a "zoom" (the new shot zooms in on it). The first shot fades in; the last is the hero shot that fades out.
    Every cut has a way in that suits the moment (``transition`` + ``tdur``), timed to land on the beat. ``max_shots``:
    the footage cannot fill more shots without repeating; the weakest cuts are dropped first (never the drop).
    ``every_beat``: a cut and a transition on every beat (beats closer than ``min_shot``: every second one).
    ``min_shot``: the shortest shot the editor may make (0.25, 0.40, 0.60 s...): faster beats are grouped, never cut."""
    s = s or Song(a)
    end = a.duration if end is None else min(end, a.duration)
    trends = song_trends(a) if trends is None else trends

    def trend_at(t: float) -> str:
        return next((tr["kind"] for tr in trends if tr["start"] <= t < tr["end"]), "")

    # the pace follows the music (director/pace_rules.py): how far apart the beats are sets how often to cut, loud parts
    # faster than calm ones, build-ups faster and breakdowns slower. The drop always cuts, and a due cut waits up to one
    # beat to land on a bar start. A beat that is not cut pulses inside the shot.
    from app.director import pace_rules as pr

    pace = pr.pace_for(s.period)
    grid = [b for b in s.beats if start + min_shot <= b <= end - ENDING]
    cuts: list[float] = []
    last = start
    for b in grid:
        tr, loud = trend_at(b), s.loud(b)
        # "in the drop": the first 2 bars after it (a long loud part labelled drop is not cut on every beat throughout)
        in_drop = any(0 <= b - d <= pr.DROP_BARS * 4 * s.period for d in s.drops)
        step = pr.cut_step(pace, s.period, loud, tr, in_drop=in_drop, min_shot=min_shot)
        if every_beat:
            step = max(1, round(min_shot / s.period + 0.49)) if s.period < min_shot else 1
        beats_since = round((b - last) / s.period)
        # the drop always cuts; a due cut waits up to one beat to land on a downbeat
        due = beats_since >= step and (_near(s.strong, b, 0.06) or beats_since >= step + 1 or step == 1)
        first = not cuts and s.is_major(b) and b - start <= 2.5  # the reveal on the first strong hit
        if (s.is_drop(b) or first or due) and b - last >= min_shot:
            cuts.append(b)
            last = b
    # the hero shot: the last cut lands on the last strong hit before the end (or the last beat)
    tail = [b for b in s.beats if end - ENDING - s.period * 2 <= b <= end - 0.8 and b > start + min_shot]
    hero = next((b for b in reversed(tail) if s.is_major(b)), tail[-1] if tail else None)
    if hero is not None and hero not in cuts and (not cuts or hero - cuts[-1] >= min_shot):
        cuts.append(hero)
    elif cuts:
        hero = cuts[-1]

    if max_shots and len(cuts) + 1 > max_shots:
        def weight(c: float) -> int:
            return 3 if s.is_drop(c) else 2 if s.is_major(c) else 1

        while len(cuts) + 1 > max_shots:
            removable = [k for k, c in enumerate(cuts) if c != hero and weight(c) < 3]
            if not removable:
                break
            low = min(weight(cuts[k]) for k in removable)

            def merged(k: int) -> float:
                prev = cuts[k - 1] if k > 0 else start
                nxt = cuts[k + 1] if k + 1 < len(cuts) else end
                return nxt - prev

            cuts.pop(min((k for k in removable if weight(cuts[k]) == low), key=merged))

    first_major = next((c for c in cuts if s.is_major(c) and c - start <= 2.5), None)
    last_flash, n_loud, last_punch, prev_tr = -1e9, 0, -1e9, ""
    since_transition = pace.transition_every  # the first chance gets a transition
    nexts = {c: (cuts[k + 1] if k + 1 < len(cuts) else end) for k, c in enumerate(cuts)}
    used: dict[str, int] = {}
    rows: list[dict[str, Any]] = [{"t": round(start, 3), "kind": "cut", "shot": "Black → soft fade-in: an establishing shot", "effect": "none",
                                   "effectLabel": "Fade in", "transition": "fade_in", "why": "the opening"}]  # fmt: skip
    for c in cuts:
        key = s.key(c)
        effect, label, why = EFFECTS[key]
        tr = trend_at(c)
        if c == hero:
            shot, effect, label, why = "Hero shot + your logo / text, then fade out", "zoom_in", "Slow zoom-in, fade out", "the ending"
        elif c == first_major:
            shot = "Main reveal: your best shot"
        elif key == "drop":
            shot = "Big impact shot (the best moment)"
        elif key == "major_loud":
            shot = LOUD_SHOTS[n_loud % len(LOUD_SHOTS)]
            n_loud += 1
        elif key == "major_soft":
            shot = "New angle, slow push in"
        elif tr == "rise":
            shot, effect, label, why = "Faster cuts: quick movement", *EFFECTS["rise"]
        elif tr == "fall":
            shot, effect, label, why = "Longer, slower shot", *EFFECTS["fall"]
        else:
            shot = "Angle change" if key == "beat_soft" else "Quick cut, small zoom"
        if effect == "punch":  # a punch-in on the cut, at most every few seconds; otherwise a clean shot
            if c - last_punch >= PUNCH_GAP:
                last_punch = c
            else:
                effect, label = "none", "Clean"
        flash = key == "drop" or (key == "major_loud" and s.hit(c) >= MAJOR_HIT and c - last_flash >= FLASH_GAP)
        on_bar = _near(s.strong, c, 0.06)
        smooth = every_beat or c == hero or pr.wants_transition(pace, since_transition, on_bar)
        if flash:
            last_flash = c
            kind, dur = "flash", TRANSITIONS["drop"][1]
        elif not smooth:  # most cuts are hard cuts on the beat: transitions are occasional (pace_rules)
            kind, dur = "cut", 0.0
            since_transition += 1
        else:
            since_transition = 0
            group = "hero" if c == hero else ("rise" if tr == "rise" else "fall" if tr == "fall" else key if key in TRANSITIONS else "beat_loud")
            choices, dur = TRANSITIONS[group]
            prev_cut = max((x for x in cuts if x < c), default=start)
            room = min(c - prev_cut, nexts[c] - c)  # the shorter of the two shots the transition joins
            dur = pr.transition_seconds(pace, dur, s.period, room) if not every_beat else min(dur, round(s.period * 0.45, 2))
            n = used.get(group, 0)
            kind = choices[n % len(choices)]
            if kind == prev_tr and len(choices) > 1:  # never the same way in twice in a row
                n += 1
                kind = choices[n % len(choices)]
            used[group] = n + 1
            if dur < 0.08:  # no room for a transition here: a hard cut on the beat
                kind, dur = "cut", 0.0
        prev_tr = kind
        rows.append({"t": round(c, 3), "kind": "cut", "shot": shot, "effect": effect, "effectLabel": label,
                     "transition": kind, "tdur": dur, "transitionLabel": TRANSITION_LABEL.get(kind, kind), "why": why})  # fmt: skip
    cut_times = [r["t"] for r in rows]
    drop_cuts = [c for c in cut_times if s.is_drop(c)]
    pre_drop = set(pre_drop_rolls(s, drop_cuts))  # the roll into a drop: the one place for stutter punches
    flashes = sorted(r["t"] for r in rows if r.get("transition") == "flash")
    punches: list[float] = sorted(r["t"] for r in rows if r["effect"] in ("punch", "crash_zoom"))

    def shot_has_hit(t: float) -> bool:
        i = bisect_left(cut_times, t)
        a_, b_ = cut_times[i - 1] if i > 0 else start, cut_times[i] if i < len(cut_times) else end
        return any(a_ < r["t"] < b_ and r["kind"] in ("hit", "flash") for r in rows)
    for t in s.hard_subs(start + 0.2, end - 0.2):  # the hard hits between beats: always marked
        i = bisect_left(cut_times, t)
        nxt = cut_times[i] if i < len(cut_times) else None
        prev = cut_times[i - 1] if i > 0 else None
        if nxt is not None and CLOSE_HIT <= nxt - t < FLASH_MARGIN:
            # too close to the next cut for a piece of its own: the shot speeds up into the cut, landing the hit
            rows.append({"t": round(t, 3), "kind": "ramp", "shot": "Speed up into the next cut", "effect": "speed_ramp",
                         "effectLabel": "Speed ramp", "transition": "", "why": f"a hard hit {nxt - t:.2f} s before the cut"})  # fmt: skip
        elif prev is not None and CLOSE_HIT <= t - prev < FLASH_MARGIN:
            # just after a cut: the new shot zooms in on the hit
            rows.append({"t": round(t, 3), "kind": "zoom", "shot": "Punch-in on the new shot", "effect": "punch",
                         "effectLabel": "Quick punch-in", "transition": "", "why": f"a hard hit {t - prev:.2f} s after the cut"})  # fmt: skip
        elif hero is not None and t > hero:  # inside the calm hero shot: a punch, not a flash
            rows.append({"t": round(t, 3), "kind": "hit", "shot": "Punch on the hit (hero shot)", "effect": "beat_punch",
                         "effectLabel": "Punch", "transition": "", "why": "a hard hit in the ending"})  # fmt: skip
        elif t in pre_drop:
            rows.append({"t": round(t, 3), "kind": "hit", "shot": "Stutter punch (roll into the drop)", "effect": "beat_stutter",
                         "effectLabel": "Strong stutter punch", "transition": "", "why": "a hard hit in the roll into the drop"})  # fmt: skip
        elif not _near(cut_times, t, FLASH_MARGIN) and _near(flashes, t, FLASH_GAP) and (shot_has_hit(t) or _near(punches, t, PUNCH_GAP)):
            if not shot_has_hit(t):  # a punch came just before: this hit gets a soft pulse instead (still marked)
                rows.append({"t": round(t, 3), "kind": "hit", "shot": "Soft pulse on the hit (same shot)", "effect": "zoom_pulse",
                             "effectLabel": "Soft pulse", "transition": "", "why": "a hard hit soon after a punch"})  # fmt: skip
        elif not _near(cut_times, t, FLASH_MARGIN) and _near(flashes, t, FLASH_GAP):
            # flashes stay rare (one every few seconds): a hard hit near another flash gets a punch instead
            punches = sorted([*punches, t])
            rows.append({"t": round(t, 3), "kind": "hit", "shot": "Punch on the hit (same shot)", "effect": "beat_punch",
                         "effectLabel": "Strong punch", "transition": "", "why": "a hard hit between beats"})  # fmt: skip
        elif not _near(cut_times, t, FLASH_MARGIN):
            flashes = sorted([*flashes, t])
            rows.append({"t": round(t, 3), "kind": "flash", "shot": "Flash on the hit (same shot)", "effect": "beat_flash",
                         "effectLabel": "Flash", "transition": "", "why": "a hard hit between beats"})  # fmt: skip
    marked = {r["t"] for r in rows}
    for t in sorted(pre_drop):  # the rest of the roll into the drop: stutter punches building to it
        if start + CLOSE_HIT < t < end - CLOSE_HIT and round(t, 3) not in marked and not _near(cut_times, t, CLOSE_HIT):
            rows.append({"t": round(t, 3), "kind": "hit", "shot": "Stutter punch (roll into the drop)", "effect": "beat_stutter",
                         "effectLabel": "Stutter punch", "transition": "", "why": "the roll into the drop"})  # fmt: skip
            marked.add(round(t, 3))
    # a medium accent between beats (not a steady hi-hat): one punch, at most one per shot (the strongest)
    bounds = [*cut_times, end]
    for a_, b_ in zip(bounds, bounds[1:]):
        if any(a_ < r["t"] < b_ and r["kind"] != "cut" for r in rows):
            continue  # this shot already has its accent
        cands = [t for t in s.subs if a_ + FLASH_MARGIN <= t <= b_ - FLASH_MARGIN and MEDIUM_SUB <= s.hit(t, 0.06) < HARD_SUB and not s.groove(t)
                 and not _near(punches, t, PUNCH_GAP)]
        if cands:
            t = max(cands, key=lambda x: s.hit(x, 0.06))
            punches = sorted([*punches, t])
            rows.append({"t": round(t, 3), "kind": "hit", "shot": "Punch on the accent (same shot)", "effect": "beat_punch",
                         "effectLabel": "Punch", "transition": "", "why": "an accent between beats"})  # fmt: skip
    rows.sort(key=lambda r: r["t"])
    shots = [r for r in rows if r["kind"] == "cut"]
    for k, sh in enumerate(shots):
        sh["end"] = round(shots[k + 1]["t"] if k + 1 < len(shots) else end, 3)
        # no beat is missed: a shot that holds over a beat pulses on it (a punch in loud parts, a softer pulse otherwise)
        last = k + 1 == len(shots)  # the last shot has no next cut to take a beat on its very end: it pulses on it too
        beats_in = [b for b in s.beats if sh["t"] + CLOSE_HIT < b < (sh["end"] + 1e-6 if last else sh["end"] - CLOSE_HIT)]
        hits_in = [r["t"] for r in rows if r["kind"] in ("hit", "ramp", "zoom") and sh["t"] < r["t"] < sh["end"]]
        inside = sorted({round(b, 3) for b in beats_in} | set(hits_in))
        if inside:
            fast = any(r["effect"] == "beat_stutter" and sh["t"] < r["t"] < sh["end"] for r in rows)
            loud = any(s.loud(b) for b in inside)
            if sh["effect"] != "crash_zoom":  # the drop keeps its crash zoom (it punches on the hits too: video/cutter.py)
                hits_here = any(r["kind"] == "hit" and r["effect"] == "beat_punch" and sh["t"] < r["t"] < sh["end"] for r in rows)
                sh["effect"] = "beat_stutter" if fast else "beat_punch" if hits_here else "zoom_pulse"
            what = []
            if beats_in:
                what.append(f"{len(beats_in)} beat{'s' if len(beats_in) > 1 else ''}")
            if hits_in:
                what.append(f"{len(hits_in)} hit{'s' if len(hits_in) > 1 else ''}")
            kind = "punches" if sh["effect"] == "crash_zoom" else "stutter punches" if fast else "punch" if sh["effect"] == "beat_punch" else "soft pulse"
            sh["effectLabel"] = (sh["effectLabel"] if sh["transition"] != "fade_in" else "Fade in") + f" + {kind} on {' and '.join(what)}"
            sh["pulses"] = inside
    for r in rows:
        r.setdefault("end", r["t"])
    return rows


def pre_drop_rolls(s: Song, drop_cuts: list[float]) -> list[float]:
    """Hits of a fast run (3+ hits under 0.2 s apart) that ends right before a drop: the build-up into it."""
    out: list[float] = []
    for d in drop_cuts:
        run = [t for t in s.subs if d - 1.2 < t < d - CLOSE_HIT]
        tail: list[float] = []
        for t in reversed(run):  # walk back from the drop while the hits keep coming fast
            if (tail and tail[-1] - t >= ROLL_GAP) or (not tail and d - t >= FLASH_MARGIN + ROLL_GAP):
                break
            tail.append(t)
        if len(tail) >= 3:
            out += tail[:ROLL_HITS]  # tail runs backwards from the drop: its last hits
    return out


def plan_hits(rows: list[dict[str, Any]]) -> list[float]:
    """Song times the picture must answer inside the shots: the beats a shot holds over (it pulses on them)."""
    return sorted({b for r in rows for b in r.get("pulses", [])})


def missed_beats(a: AudioAnalysis, rows: list[dict[str, Any]], start: float, end: float) -> list[float]:
    """Beats and hard hits from ``start`` to ``end`` that the plan does not mark (should be none). Steady hi-hats and
    soft ticks are the groove, not accents: they are left alone on purpose."""
    s = Song(a)
    marked = sorted([r["t"] for r in rows] + plan_hits(rows))
    beats = [b for b in s.beats if start + CLOSE_HIT < b < end - CLOSE_HIT]
    out = [b for b in beats if not _near(marked, b, CLOSE_HIT)]
    shots = [r for r in rows if r["kind"] == "cut"]
    marks = [r["t"] for r in rows if r["kind"] in ("hit", "flash", "ramp", "zoom")]
    for t in s.hard_subs(start + 0.2, end - 0.2):  # the first / last 0.2 s are the fade: hits there are not marked
        if _near(marked, t, CLOSE_HIT):
            continue
        shot = next((r for r in shots if r["t"] <= t < r["end"]), None)
        if shot is None or not any(shot["t"] < m < shot["end"] for m in marks):  # one punch per shot answers the rest
            out.append(t)
    return sorted(out)
