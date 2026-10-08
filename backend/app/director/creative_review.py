"""The Quality Reviewer: judges a finished edit the way a creative director would, scores it 0-100 with timestamped
issues, and (``auto_revise``) repairs what it can before a single frame is rendered.

It measures the EDL against the same analyses the editor used (no AI, no rendering, so a review costs milliseconds):
hook strength, pacing, story / retention (weak middle, the strongest moment on the music's peak, the ending), shot
diversity, beat alignment, visual quality, transitions, motion flow and text. Technical faults found in the rendered
file (``review.check_render``) are added as high-severity issues.

Revisions are deterministic edit decisions (replace the opening, move the hero moment onto the drop, swap a
repetitive shot, calm the transitions ...), applied to a copy of the timeline; a revision is kept only when it scores
better. At most ``MAX_REVISIONS`` rounds, so the cost stays bounded.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from app.director import intelligence as intel
from app.director.music_map import MusicMap, loud_limit
from app.director.review import BEAT_TOLERANCE, MAX_HOOK, MIN_ENDING, Check
from app.models.analysis import UsableWindow
from app.models.timeline import Timeline, Transition
from app.video import footage
from app.video.timeline import ClipInput, _windows_of, brief_terms, cut_points

TARGET_SCORE = 80  # below this the reviewer tries to improve the edit
# Fixes for a failed hard quality check (a shot that drags in a loud part): applied whatever the overall score, because
# a high score elsewhere does not make a failed check acceptable. They are safe, deterministic and keep the footage.
MUST_FIX = {"split_long_shot"}
MAX_REVISIONS = 2
WEIGHTS = {"hook": 0.18, "pacing": 0.12, "story": 0.14, "diversity": 0.14, "beat": 0.10, "visual": 0.10,
           "transitions": 0.06, "motion": 0.05, "ending": 0.06, "text": 0.05}  # fmt: skip
SIMILAR = 0.86  # colour signatures this alike look like the same shot
SEVERITY_COST = {"high": 12, "medium": 6, "low": 2}


@dataclass
class Issue:
    timestamp: float
    problem: str
    severity: str  # high | medium | low
    category: str
    fix: str | None = None  # the revision that addresses it, None = needs a human

    def to_doc(self) -> dict:
        return {"timestamp": round(self.timestamp, 2), "problem": self.problem, "severity": self.severity,
                "category": self.category, "fix": self.fix}


@dataclass
class CreativeReview:
    overall_score: int
    categories: dict[str, int]
    issues: list[Issue] = field(default_factory=list)
    iterations: list[dict] = field(default_factory=list)  # one entry per revision round

    def to_doc(self) -> dict:
        return {"overallScore": self.overall_score, "categories": self.categories, "issues": [i.to_doc() for i in self.issues],
                "iterations": self.iterations, "target": TARGET_SCORE}


# ----------------------------------------------------------------------------- helpers
def _window(clip: ClipInput | None, t: float) -> UsableWindow | None:
    if clip is None:
        return None
    ws = _windows_of(clip)
    inside = [w for w in ws if w.start - 1e-3 <= t <= w.end + 1e-3]
    return inside[0] if inside else min(ws, key=lambda w: min(abs(w.start - t), abs(w.end - t)), default=None)


def _sim(a: list[float], b: list[float]) -> float:
    return sum(min(x, y) for x, y in zip(a, b)) if a and b and len(a) == len(b) else 0.0


def _pct(x: float) -> int:
    return int(round(min(max(x, 0.0), 1.0) * 100))


# ----------------------------------------------------------------------------- the review
def review_edit(tl: Timeline, clips: list[ClipInput], mm: MusicMap | None, *, brief: str = "", max_transition_ratio: float = 0.5,
                pace: str = "balanced", steps: bool = False, render_checks: list[Check] | None = None) -> CreativeReview:  # fmt: skip
    by_id = {c.clip_id: c for c in clips}
    segs = tl.segments
    n = len(segs)
    issues: list[Issue] = []
    cat: dict[str, float] = {}
    wins = [_window(by_id.get(s.clip_id), s.source_start) for s in segs]
    terms = brief_terms(brief)
    sigs = [w.signature for c in clips for w in _windows_of(c)]

    # hook: the opening against the strongest opening the footage offers
    hooks = intel.rank_hooks(clips, brief)
    first, w0 = segs[0], wins[0]
    if hooks and w0 is not None and first.clip_id in by_id:
        mine = intel.hook_score(intel.hook_parts(by_id[first.clip_id], w0, terms, sigs))
        ratio = mine / max(hooks[0].score, 1e-6)
        cat["hook"] = min(ratio, 1.0)
        if ratio < 0.85 and not steps:
            issues.append(Issue(0.0, f"weak opening: {hooks[0].name} would hook harder ({hooks[0].reason})",
                                "high" if ratio < 0.7 else "medium", "hook", "replace_opening"))  # fmt: skip
    else:
        cat["hook"] = 0.6
    if first.length > MAX_HOOK + 1e-6:
        cat["hook"] *= 0.8
        issues.append(Issue(0.0, f"the opening shot lasts {first.length:.1f}s; the hook should land within {MAX_HOOK:g}s", "medium", "hook"))

    # pacing: cut speed follows the music, rhythm is not mechanical, no shot drags
    pace_pen = 0.0
    lengths = [s.length for s in segs]
    if mm is not None:
        for s in segs:
            lim = loud_limit(mm, s.timeline_start, s.timeline_end, pace)
            if lim and s.length > lim[1] * 1.15 and not steps:
                pace_pen += 0.15
                issues.append(Issue(s.timeline_start, f"a {s.length:.1f}s shot drags in a {lim[0].replace('_', ' ')} part of the song",
                                    "medium", "pacing", "split_long_shot"))  # fmt: skip
    if n >= 5:
        mean = sum(lengths) / n
        cv = (sum((x - mean) ** 2 for x in lengths) / n) ** 0.5 / max(mean, 1e-6)
        if cv < 0.12:
            pace_pen += 0.2
            issues.append(Issue(segs[n // 2].timeline_start, "every shot is the same length: the rhythm feels predictable", "low", "pacing"))
    cat["pacing"] = 1.0 - min(pace_pen, 0.8)

    # story / retention: the middle must not sag, and the strongest moment belongs on the music's peak
    story = 1.0
    value = [(0.55 * w.quality + 0.45 * w.motion_between(s.source_start, s.source_end)) if w else 0.3 for s, w in zip(segs, wins)]
    if n >= 6 and not steps:
        third = n // 3
        middle = value[third: n - third]
        overall = sum(value) / n
        if middle and sum(middle) / len(middle) < 0.8 * overall:
            k = third + min(range(len(middle)), key=lambda i: middle[i])
            story -= 0.3
            issues.append(Issue(segs[k].timeline_start, "the middle sags: these shots are weaker than the rest, viewers may drop off",
                                "medium", "story", "strengthen_middle"))  # fmt: skip
    hero = intel.find_hero(clips) if n >= 3 else None
    peak = _peak_index(tl, mm)
    if hero is not None and peak is not None and not steps:
        s = segs[peak]
        on = s.clip_id == hero.clip_id and footage.overlap_seconds(s.source_start, s.source_end, [(hero.start, hero.end)]) > 0.2
        if not on and (wins[peak] is None or intel.hero_value(by_id[s.clip_id], wins[peak], s.source_start, s.source_end) < 0.9 * hero.score):
            story -= 0.3
            issues.append(Issue(s.timeline_start, f"the music's peak shows a weaker moment; the strongest one ({hero.name} "
                                                  f"{hero.start:.1f}-{hero.end:.1f}s) belongs here", "medium", "story", "hero_on_drop"))  # fmt: skip
    cat["story"] = max(story, 0.0)

    # diversity: no repetitive neighbours, every clip gets used
    rep = 0
    for i in range(1, n):
        a, b = segs[i - 1], segs[i]
        continuous = a.clip_id == b.clip_id and abs(a.source_end - b.source_start) < 0.05  # one action split on a hit
        if continuous:
            continue
        same = a.clip_id == b.clip_id or (wins[i - 1] is not None and wins[i] is not None and _sim(wins[i - 1].signature, wins[i].signature) >= SIMILAR)
        if same:
            rep += 1
            issues.append(Issue(b.timeline_start, "repetitive visual: this shot looks like the one before it", "medium", "diversity", "swap_repetitive"))
    usable = {c.clip_id for c in clips if c.analysis.usable} or {c.clip_id for c in clips}
    used_share = len({s.clip_id for s in segs} & usable) / max(min(len(usable), n), 1)
    cat["diversity"] = max(0.0, min(used_share, 1.0) - 0.15 * rep)

    # beat alignment
    cuts = cut_points(tl)
    if mm is not None and mm.beats and cuts:
        snap = mm.snap_points
        on = sum(1 for c in cuts if min(abs(c - b) for b in snap) <= BEAT_TOLERANCE)
        cat["beat"] = on / len(cuts)
    else:
        cat["beat"] = 0.7  # no detectable beat: a visually paced edit, judged neutrally

    # visual quality of the footage actually on screen
    q = [w.quality for w in wins if w is not None]
    cat["visual"] = sum(q) / len(q) if q else 0.5
    for s, w in zip(segs, wins):
        if w is not None and w.quality < 0.35:
            issues.append(Issue(s.timeline_start, f"low-quality footage ({w.quality:.2f}) from {s.video}", "low", "visual", "swap_repetitive"))

    # transitions: clean cuts by default; overuse costs
    non_cut = sum(1 for s in segs[1:] if s.transition_in.type != "cut")
    ratio = non_cut / max(n - 1, 1)
    allowed = max(min(max_transition_ratio, 0.9), 0.1)
    cat["transitions"] = 1.0 if ratio <= allowed else max(0.0, 1.0 - (ratio - allowed) * 2)
    if ratio > allowed + 1e-6:
        issues.append(Issue(segs[1].timeline_start if n > 1 else 0.0, f"too many transitions ({non_cut} of {n - 1} cuts); clean cuts read better",
                            "medium", "transitions", "calm_transitions"))  # fmt: skip

    # motion flow between shots
    reversals = 0
    for i in range(1, n):
        if wins[i - 1] is not None and wins[i] is not None and intel.motion_match(wins[i - 1], wins[i]) < 0 and segs[i].clip_id != segs[i - 1].clip_id:
            reversals += 1
            issues.append(Issue(segs[i].timeline_start, f"jarring cut: the movement reverses ({wins[i - 1].direction} then {wins[i].direction})",
                                "low", "motion", "match_motion"))  # fmt: skip
    cat["motion"] = max(0.0, 1.0 - 0.25 * reversals)

    # ending
    last, wl = segs[-1], wins[-1]
    end = 1.0
    if last.length < MIN_ENDING - 1e-6:
        end -= 0.4
        issues.append(Issue(last.timeline_start, f"the Reel ends on a {last.length:.2f}s shot and feels cut off", "medium", "ending"))
    if wl is not None and q and wl.quality < 0.85 * (sum(q) / len(q)):
        end -= 0.3
        issues.append(Issue(last.timeline_start, "weak ending: the last shot is weaker than the rest", "medium", "ending", "strengthen_ending"))
    cat["ending"] = max(end, 0.0)

    # text: readable, one at a time, not overloaded
    text = 1.0
    ov = sorted(tl.overlays, key=lambda o: o.start)
    for a, b in zip(ov, ov[1:]):
        if b.start < a.end - 0.05:
            text -= 0.3
            issues.append(Issue(b.start, "two texts on screen at once", "medium", "text"))
    if tl.duration > 0 and len(ov) > max(tl.duration / 4, 2):
        text -= 0.3
        issues.append(Issue(ov[0].start if ov else 0.0, f"text overload: {len(ov)} texts in {tl.duration:g}s", "low", "text"))
    for o in ov:
        if o.end - o.start < 0.25 * max(len(o.text.split()), 1) + 0.5:
            text -= 0.15
            issues.append(Issue(o.start, f"'{o.text}' is on screen too briefly to read", "low", "text"))
    cat["text"] = max(text, 0.0)

    # technical faults in the rendered file
    tech_cost = 0
    for c in render_checks or []:
        if not c.ok:
            tech_cost += SEVERITY_COST["high"]
            issues.append(Issue(0.0, f"technical: {c.name}" + (f" ({c.detail})" if c.detail else ""), "high", "technical"))

    categories = {k: _pct(cat.get(k, 0.7)) for k in WEIGHTS}
    score = sum(WEIGHTS[k] * categories[k] for k in WEIGHTS) - tech_cost
    issues.sort(key=lambda i: ({"high": 0, "medium": 1, "low": 2}[i.severity], i.timestamp))
    return CreativeReview(int(round(min(max(score, 0), 100))), categories, issues)


def _peak_index(tl: Timeline, mm: MusicMap | None) -> int | None:
    """The shot that starts on the music's peak (a drop, else the loudest strong beat) in the middle of the Reel."""
    if mm is None or len(tl.segments) < 3:
        return None
    segs = tl.segments
    middle = list(range(1, len(segs) - 1))
    inner = [d for d in mm.drops if segs[0].timeline_end <= d < segs[-1].timeline_start]
    if inner:
        return min(middle, key=lambda i: abs(segs[i].timeline_start - inner[0]))
    order = {"very_high": 3, "high": 2, "medium": 1, "low": 0}
    loud = lambda i: order.get(mm.energy_at(segs[i].timeline_start), 0)  # noqa: E731
    # as the editor does: the loudest strong moment, and when the music is evenly loud, about 60% into the Reel
    best = max(middle, key=lambda i: loud(i) + 0.25 * (mm.level_at(segs[i].timeline_start) >= 3) - 0.6 * abs(segs[i].timeline_start / tl.duration - 0.6))
    return best if loud(best) >= 2 else None


# ----------------------------------------------------------------------------- revisions
def _used(tl: Timeline, skip: int | None = None) -> dict[str, list[tuple[float, float]]]:
    out: dict[str, list[tuple[float, float]]] = {}
    for i, s in enumerate(tl.segments):
        if i != skip:
            out.setdefault(s.clip_id, []).append((s.source_start, s.source_end))
    return out


def _place(tl: Timeline, i: int, clip: ClipInput, start: float, w: UsableWindow, reason: str) -> bool:
    """Put footage into shot ``i``; False (nothing changed) when the person locked that shot by editing it by hand."""
    s = tl.segments[i]
    if s.locked:
        return False
    span = s.length * s.speed
    s.clip_id, s.video = clip.clip_id, clip.name
    s.source_start, s.source_end = round(start, 3), round(start + span, 3)
    s.focus_x, s.focus_y, s.focus_source = w.focus_x, w.focus_y, w.focus_source
    s.reason = f"{clip.name}: {reason}"
    return True


def _best_fresh(tl: Timeline, i: int, clips: list[ClipInput], key, avoid_clips: set[str] = frozenset()) -> tuple[ClipInput, float, UsableWindow] | None:
    """The best unused moment (by ``key(clip, window, start, end)``) that fits shot ``i`` without repeating footage."""
    s = tl.segments[i]
    span = s.length * s.speed
    used = _used(tl, skip=i)
    best, best_v = None, -1e9
    for c in [c for c in clips if c.analysis.usable] or clips:
        if c.clip_id in avoid_clips:
            continue
        for w in _windows_of(c):
            a = w.start
            while a + span <= w.end + 1e-6:
                if footage.is_fresh(a, a + span, used.get(c.clip_id, [])):
                    v = key(c, w, a, a + span)
                    if v > best_v:
                        best, best_v = (c, a, w), v
                a += 0.25
    return best


def _neighbours(tl: Timeline, i: int) -> set[str]:
    return {tl.segments[j].clip_id for j in (i - 1, i + 1) if 0 <= j < len(tl.segments)}


def revise_once(tl: Timeline, review: CreativeReview, clips: list[ClipInput], mm: MusicMap | None, *, brief: str = "",
                max_transition_ratio: float = 0.5) -> list[str]:  # fmt: skip
    """Apply one round of fixes for the review's issues, in place. Returns what was changed (plain sentences)."""
    by_id = {c.clip_id: c for c in clips}
    done: list[str] = []
    fixes = {i.fix for i in review.issues if i.fix}
    terms = brief_terms(brief)
    sigs = [w.signature for c in clips for w in _windows_of(c)]

    if "replace_opening" in fixes:
        pick = _best_fresh(tl, 0, clips, lambda c, w, a, b: intel.hook_score(intel.hook_parts(c, w, terms, sigs)) + 0.05 * w.motion_between(a, b),
                           avoid_clips=_neighbours(tl, 0) - {tl.segments[0].clip_id})  # fmt: skip
        if pick:
            c, a, w = pick
            if _place(tl, 0, c, a, w, f"Replaced the opening: the strongest hook in the footage ({intel.HookCandidate(c.clip_id, c.name, a, a, 0, intel.hook_parts(c, w, terms, sigs)).reason})."):
                done.append(f"replaced the opening with {c.name}")

    peak = _peak_index(tl, mm)
    hero = intel.find_hero(clips)
    if "hero_on_drop" in fixes and peak is not None and hero is not None:
        s = tl.segments[peak]
        span = s.length * s.speed
        c = by_id.get(hero.clip_id)
        # the hero moment may already be on screen earlier: give that earlier shot other footage first
        for j, o in enumerate(tl.segments):
            if j != peak and o.clip_id == hero.clip_id and footage.overlap_seconds(o.source_start, o.source_end, [(hero.start, hero.start + span)]) > 0.05:
                alt = _best_fresh(tl, j, clips, lambda c2, w2, a2, b2: w2.quality - (1.0 if c2.clip_id == hero.clip_id and a2 < hero.start + span and b2 > hero.start else 0.0))
                if alt:
                    _place(tl, j, alt[0], alt[1], alt[2], "Moved here so the strongest moment is saved for the music's peak.")
        w = _window(c, hero.start) if c else None
        if c is not None and w is not None and hero.start + span <= w.end + 1e-6 and footage.is_fresh(hero.start, hero.start + span, _used(tl, skip=peak).get(c.clip_id, [])):
            if _place(tl, peak, c, hero.start, w, "Saved the strongest moment of the footage for the music's peak."):
                done.append(f"put the strongest moment ({c.name}) on the music's peak")

    if "strengthen_middle" in fixes or "strengthen_ending" in fixes:
        targets = []
        if "strengthen_middle" in fixes:
            targets += [i.timestamp for i in review.issues if i.fix == "strengthen_middle"]
        if "strengthen_ending" in fixes:
            targets.append(tl.segments[-1].timeline_start)
        for t in targets:
            i = next((k for k, s in enumerate(tl.segments) if abs(s.timeline_start - t) < 1e-3), None)
            if i is None or i == peak:
                continue
            pick = _best_fresh(tl, i, clips, lambda c, w, a, b: 0.55 * w.quality + 0.45 * w.motion_between(a, b) - (0.5 if c.clip_id in _neighbours(tl, i) else 0.0))
            if pick:
                c, a, w = pick
                cur = _window(by_id.get(tl.segments[i].clip_id), tl.segments[i].source_start)
                if cur is None or 0.55 * w.quality + 0.45 * w.motion_between(a, a + 1) > 0.55 * cur.quality + 0.45 * cur.motion + 0.03:
                    last = i == len(tl.segments) - 1
                    if _place(tl, i, c, a, w, "A stronger shot to end on." if last else "A stronger moment so the middle keeps viewers watching."):
                        done.append(f"strengthened the {'ending' if last else 'middle'} with {c.name}")

    rep_times = [i.timestamp for i in review.issues if i.fix == "swap_repetitive"]
    for t in rep_times:
        i = next((k for k, s in enumerate(tl.segments) if abs(s.timeline_start - t) < 1e-3), None)
        if i is None or i in (0, peak):
            continue
        prev_w = _window(by_id.get(tl.segments[i - 1].clip_id), tl.segments[i - 1].source_start) if i > 0 else None
        pick = _best_fresh(tl, i, clips, lambda c, w, a, b: w.quality - (_sim(w.signature, prev_w.signature) if prev_w else 0.0)
                           + 0.1 * intel.motion_match(prev_w, w), avoid_clips=_neighbours(tl, i))  # fmt: skip
        if pick:
            c, a, w = pick
            if _place(tl, i, c, a, w, "Brings in different footage so neighbouring shots do not look alike."):
                done.append(f"swapped a repetitive shot at {tl.segments[i].timeline_start:.1f}s for {c.name}")

    for t in [i.timestamp for i in review.issues if i.fix == "match_motion"]:
        i = next((k for k, s in enumerate(tl.segments) if abs(s.timeline_start - t) < 1e-3), None)
        if i is None or i in (0, peak):
            continue
        prev_w = _window(by_id.get(tl.segments[i - 1].clip_id), tl.segments[i - 1].source_start)
        pick = _best_fresh(tl, i, clips, lambda c, w, a, b: (0.0 if intel.motion_match(prev_w, w) < 0 else 0.5) + w.quality,
                           avoid_clips=_neighbours(tl, i))  # fmt: skip
        if pick and intel.motion_match(prev_w, pick[2]) >= 0:
            c, a, w = pick
            if _place(tl, i, c, a, w, f"Continues the movement of the shot before ({prev_w.direction if prev_w else 'still'}) instead of reversing it."):
                done.append(f"smoothed a direction change at {t:.1f}s")

    if "calm_transitions" in fixes:
        n = len(tl.segments)
        allowed = int(max_transition_ratio * max(n - 1, 1))
        fancy = [s for s in tl.segments[1:] if s.transition_in.type != "cut" and not s.locked]
        extra = len(fancy) - allowed
        if extra > 0:
            for s in sorted(fancy, key=lambda s: (mm.level_at(s.timeline_start) if mm else 1))[:extra]:  # keep those on the strongest beats
                s.transition_in = Transition(type="cut", duration=0.0)
            done.append(f"turned {extra} transition(s) into clean cuts")

    if "split_long_shot" in fixes:
        done += _split_long(tl, review, mm)
    return done


def _split_long(tl: Timeline, review: CreativeReview, mm: MusicMap | None) -> list[str]:
    """A shot that drags in a loud part is split on a strong beat; the footage carries on (no repeat)."""
    if mm is None:
        return []
    out: list[str] = []
    for t in sorted({i.timestamp for i in review.issues if i.fix == "split_long_shot"}, reverse=True):
        k = next((j for j, s in enumerate(tl.segments) if abs(s.timeline_start - t) < 1e-3), None)
        if k is None or tl.segments[k].locked:
            continue
        s = tl.segments[k]
        beats = [b.t for b in mm.beats if s.timeline_start + 0.6 < b.t < s.timeline_end - 0.6]
        if not beats:
            continue
        mid = (s.timeline_start + s.timeline_end) / 2
        cut = max(beats, key=lambda b: (mm.level_at(b), -abs(b - mid)))
        second = s.model_copy(deep=True)
        second.id = s.id[:6] + "s" + s.id[7:] if len(s.id) >= 8 else s.id + "s"
        second.timeline_start = round(cut, 3)
        second.source_start = round(s.source_start + (cut - s.timeline_start) * s.speed, 3)
        second.transition_in = Transition(type="cut", duration=0.0)
        second.effect = "punch" if s.effect == "none" else s.effect
        second.reason = f"{s.video}: Split on a strong beat so the shot keeps up with the loud music (same footage, no repeat)."
        s.timeline_end = round(cut, 3)
        s.source_end = second.source_start
        tl.segments.insert(k + 1, second)
        out.append(f"split a long shot on the beat at {cut:.1f}s")
    return out


def auto_revise(tl: Timeline, clips: list[ClipInput], mm: MusicMap | None, *, brief: str = "", max_transition_ratio: float = 0.5,
                pace: str = "balanced", steps: bool = False, repair=None) -> tuple[Timeline, CreativeReview]:  # fmt: skip
    """Review -> revise -> review, at most ``MAX_REVISIONS`` rounds; the best-scoring edit wins.

    ``repair(timeline)`` re-runs the structural quality checks (reflow, duplicates, transitions) after each revision.
    Step-by-step Reels keep their order, so only their transitions are revised.
    """
    review = review_edit(tl, clips, mm, brief=brief, max_transition_ratio=max_transition_ratio, pace=pace, steps=steps)
    first = review.overall_score
    best_tl, best = tl, review
    rounds: list[dict] = []
    for k in range(MAX_REVISIONS):
        must_only = best.overall_score >= TARGET_SCORE
        todo = [i for i in best.issues if i.fix and (i.fix in MUST_FIX or not must_only)]
        if steps:
            todo = [i for i in todo if i.fix in ("calm_transitions", *MUST_FIX)]
        if not todo:
            break
        cand = best_tl.model_copy(deep=True)
        changes = revise_once(cand, CreativeReview(best.overall_score, best.categories, todo), clips, mm, brief=brief,
                              max_transition_ratio=max_transition_ratio)  # fmt: skip
        if not changes:
            break
        if repair is not None:
            repair(cand)
        again = review_edit(cand, clips, mm, brief=brief, max_transition_ratio=max_transition_ratio, pace=pace, steps=steps)
        kept = again.overall_score > best.overall_score or (must_only and again.overall_score >= best.overall_score)
        rounds.append({"round": k + 1, "changes": changes, "scoreBefore": best.overall_score, "scoreAfter": again.overall_score, "kept": kept})
        if not kept:
            break
        best_tl, best = cand, again
    best.iterations = rounds
    if rounds:
        best_tl.notes = best_tl.notes + [
            f"Quality reviewer: {first} -> {best.overall_score}/100 after {sum(1 for r in rounds if r['kept'])} revision(s): "
            + "; ".join(c for r in rounds if r["kept"] for c in r["changes"])[:300]
        ] if any(r["kept"] for r in rounds) else best_tl.notes + [f"Quality reviewer: {first}/100; its revision did not improve the edit, so the first version was kept."]
    return best_tl, best
