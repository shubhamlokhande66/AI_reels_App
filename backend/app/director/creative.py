"""The Creative Plan: WHAT Reel to make and WHY, decided before a single shot is placed.

A plan names a concept, the hook, the story beats, the pacing and visual energy, how the music is read (what lands on
the drop, where the edit breathes), and the text / effects / transition strategy. It is a decision, never an
instruction to the renderer: the director's shots carry it out and the safety layer still validates every shot.

* ``draft_plan`` writes one deterministically from the brief, the hooks, the hero moment and the song's sections; the
  rule-based editor uses it as is, and the AI director receives it as a starting point to improve;
* ``DIRECTIONS`` are the three concept directions of the multiple-versions feature (Viral, Cinematic, Premium). They
  differ in hook, pacing, shot order, music reading, text and effects, not just colour.

Story structures follow the content type (product, food, fashion, travel ...) but are trimmed to the footage: a
"reaction" beat needs a face, a "cta" beat needs a call to action, a short Reel gets fewer beats.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from pydantic import Field

from app.ai.schemas import Text, _Answer
from app.director.brief import ProjectBrief
from app.director.hooks import HookOption
from app.director.music_map import MusicMap
from app.models.base import CamelModel

STORIES = {
    "product": ["hook", "tease", "reveal", "detail", "hero_shot", "cta"],
    "jewelry": ["hook", "tease", "reveal", "detail", "hero_shot", "cta"],
    "beauty": ["hook", "before", "application", "result", "hero_shot", "cta"],
    "food": ["hook", "ingredients", "preparation", "transformation", "final_dish", "reaction"],
    "fashion": ["look", "detail", "movement", "full_look", "hero_shot"],
    "travel": ["location_hook", "establishing", "experience", "detail", "hero_moment"],
    "fitness": ["hook", "effort", "progress", "peak", "result"],
    "event": ["hook", "atmosphere", "people", "highlight", "finale"],
    "tutorial": ["result_teaser", "step", "step", "step", "result"],
    "education": ["question", "context", "explanation", "takeaway"],
}
DEFAULT_STORY = ["hook", "context", "build", "reveal", "payoff"]


@dataclass(frozen=True)
class Direction:
    id: str
    label: str
    concept: str  # name template
    style: str
    pace: str
    caption_style: str
    order: str  # quality | chronological
    hook_types: tuple[str, ...]  # preferred kinds of opening, best first
    pacing: str
    visual_energy: str
    music: str
    text: str
    effects: str
    transitions: str
    description: str
    shot_order: str = ""


DIRECTIONS: dict[str, Direction] = {d.id: d for d in (
    Direction("viral", "Viral", "Scroll-Stopper", "viral", "fast", "bold", "quality",
              ("fast_movement", "visual_surprise", "pattern_interrupt", "curiosity"), "fast", "high",
              "cut on the strong hits; the biggest moment lands exactly on the drop; no long holds in loud parts",
              "a short hook line in the first second, one benefit, CTA at the end", "beat punches and micro zooms on hits, one flash on the drop",
              "hard cuts; at most one motion transition into the drop",
              "Strongest hook first, fast cuts on the hits, built for retention.",
              "the strongest, most energetic moments first; never let two similar shots touch"),
    Direction("cinematic", "Cinematic", "Cinematic Story", "cinematic", "calm", "minimal", "chronological",
              ("visual_surprise", "curiosity", "close_up"), "slow", "medium",
              "shots breathe across bars and phrases; cuts on phrase starts in calm parts; the hero moment held over the drop",
              "little or no text; a quiet title and the CTA only at the very end", "slow push-ins, gentle slow motion on the hero moment",
              "mostly cuts, dissolves only between scenes", "A story in order: establishing shot, journey, reveal, a held ending.",
              "the order the clips were filmed (c1, c2, c3 ...): a journey from the widest establishing view to the hero"),
    Direction("premium", "Premium", "Brand Reveal", "luxury", "balanced", "luxury", "quality",
              ("product_reveal", "close_up", "text_hook"), "medium", "medium",
              "tease in the build, the product reveal exactly on the drop, detail shots on accents, a long hero shot at the end",
              "brand name and one benefit in the brand's look; a clear CTA", "subtle glow on highlights, slow zooms on details; nothing busy",
              "clean cuts and a single dissolve before the hero shot", "Product and brand first: close-ups, a reveal on the drop, a hero ending.",
              "tease with details and close-ups first, the clearest full product view on the drop, the best product shot last"),
)}  # fmt: skip


class CreativePlan(CamelModel):
    concept: str
    direction: str = "auto"  # viral | cinematic | premium | auto
    logline: str = ""  # one sentence: the idea
    hook: dict[str, Any] = {}  # {type, clipId, asset, start, duration, why}
    story: list[str] = []
    pacing: str = "medium"  # slow | medium | medium_fast | fast
    visual_energy: str = "medium"  # low | medium | high
    music_interpretation: str = ""
    text_strategy: str = ""
    effects_strategy: str = ""
    transition_strategy: str = "hard cuts by default; other transitions only with a reason"
    shot_order: str = ""  # how the shots are ordered (the concept's own; versions differ here)
    ending: str = ""
    source: str = "rules"  # rules | ai


class DirectorConcept(_Answer):
    """The concept part of the AI director's answer (same call as the shots)."""

    concept: str = Field(default="", description="2-4 word name of the creative concept, e.g. 'Luxury Reveal'")
    logline: str = Field(default="", description="one sentence: the idea of this Reel")
    hook_type: str = Field(default="", description="one of the hook types")
    story: list[Text] = Field(default=[], description="the story beats in order, e.g. hook, tease, reveal, detail, hero_shot, cta")
    pacing: str = Field(default="", description="slow|medium|medium_fast|fast")
    visual_energy: str = Field(default="", description="low|medium|high")
    music_interpretation: str = Field(default="", description="what lands on the drop, where the edit breathes")
    text_strategy: str = ""
    effects_strategy: str = ""
    transition_strategy: str = ""
    ending: str = ""


PACING = {"calm": "slow", "balanced": "medium", "fast": "fast"}


def story_for(brief: ProjectBrief, n_shots_hint: int, has_face: bool) -> list[str]:
    beats = list(STORIES.get(brief.content_type, DEFAULT_STORY))
    if not brief.cta and "cta" in beats:
        beats.remove("cta")
    if not has_face and "reaction" in beats:
        beats.remove("reaction")
    if brief.cta and "cta" not in beats and brief.objective in ("product_showcase",):
        beats.append("cta")
    while len(beats) > max(n_shots_hint, 3):  # a short Reel cannot tell six beats: drop from the middle
        beats.pop(len(beats) // 2)
    return beats


def _music_reading(mm: MusicMap | None) -> str:
    if mm is None or not mm.sections:
        return "cuts follow the beat; the strongest moment goes on the loudest strong beat"
    parts = [f"{s['label']} {s['start']:.0f}-{s['end']:.0f}s" for s in mm.sections]
    inner = [d for d in mm.drops if d > 1.0] or [s["start"] for s in mm.sections if s["label"] == "drop" and s["start"] > 1.0]
    if inner:
        lead = f"hero moment on the drop at {inner[0]:.1f}s"
    elif mm.sections[0]["label"] in ("drop", "chorus"):
        lead = ("the Reel starts on the loudest part of the song: open hard on the strongest hook, keep the energy up, and "
                "put the hero moment on the strongest beat about two-thirds in")
    else:
        lead = "hero moment on the loudest strong beat"
    return f"{lead}; song parts: {', '.join(parts)}"


def draft_plan(brief: ProjectBrief, hooks: list[HookOption], mm: MusicMap | None, *, direction: str | None = None,
               pace: str = "balanced", has_face: bool = False, hero: dict | None = None) -> CreativePlan:  # fmt: skip
    d = DIRECTIONS.get(direction or "")
    hook = hooks_for(direction, hooks)[0] if hooks else None
    shots = max(int(brief.duration / (1.2 if (d and d.pacing == "fast") or pace == "fast" else 2.2 if pace == "calm" else 1.7)), 3)
    story = story_for(brief, shots, has_face)
    subject = brief.content_type.replace("_", " ") if brief.content_type != "other" else "footage"
    name = d.concept if d else {"product_showcase": "Product Reveal", "food_showcase": "From Raw to Ready", "travel_story": "Journey",
                                "tutorial": "How It's Done"}.get(brief.objective, "Highlight Reel")  # fmt: skip
    if brief.style == "luxury" and not d:
        name = "Luxury Reveal"
    music = (d.music + "; " if d else "") + _music_reading(mm)
    return CreativePlan(
        concept=name, direction=d.id if d else "auto",
        logline=f"A {d.label.lower() if d else brief.style if brief.style != 'auto' else ''} {subject} Reel for {brief.platform.replace('_', ' ')}"
                f"{' aimed at ' + brief.audience.replace('_', ' ') if brief.audience != 'general' else ''}: "
                f"{'opens on ' + hook.reason if hook else 'opens on the strongest shot'}, builds to the hero moment"
                f"{', ends on ' + repr(brief.cta) if brief.cta and 'cta' in story else ''}.".replace("  ", " "),
        hook=({"type": hook.type, "clipId": hook.clip_id, "asset": hook.name, "start": round(hook.start, 2),
               "duration": round(hook.end - hook.start, 2), "why": hook.reason} if hook else {}),
        story=story, pacing=d.pacing if d else PACING.get(pace, "medium"),
        visual_energy=d.visual_energy if d else ("high" if pace == "fast" else "low" if pace == "calm" else "medium"),
        music_interpretation=music,
        text_strategy=d.text if d else ("hook text in the first second and the CTA at the end" if brief.cta else "text only where it helps"),
        effects_strategy=d.effects if d else "effects only where the footage or a beat calls for them",
        transition_strategy=d.transitions if d else "hard cuts by default; other transitions only with a reason",
        shot_order=d.shot_order if d else "",
        ending=("the strongest hero shot, held on the final strong beat" + (f", with the CTA '{brief.cta}'" if brief.cta and "cta" in story else "")),
        source="rules",
    )  # fmt: skip


def hooks_for(direction: str | None, hooks: list[HookOption], avoid_clips: set[str] = frozenset()) -> list[HookOption]:
    """The openings for one concept, its own first: its preferred kinds of hook, and never a clip another version of the
    same Reel already opens on (so the versions start differently). Falls back to the plain ranking."""
    d = DIRECTIONS.get(direction or "")
    if d is None or not hooks:
        return list(hooks)
    fresh = [h for h in hooks if h.clip_id not in avoid_clips] or list(hooks)
    rank = {t: i for i, t in enumerate(d.hook_types)}
    first = min(fresh, key=lambda h: (rank.get(h.type, len(rank)), -h.hook_score))
    return [first] + [h for h in hooks if h is not first]


def distinct_opening(tl, hooks: list[HookOption], opened: set[str], clips) -> str | None:
    """When a version opens on the same clip as an earlier version of the same Reel, put this concept's own opening into
    shot 1 instead (same cut times, never a moment shown twice), trying its openings in order. Returns a note or None."""
    if not tl.segments or tl.segments[0].clip_id not in opened:
        return None
    for hook in hooks:
        if hook.clip_id in opened:
            continue
        note = _open_on(tl, hook, opened, clips)
        if note:
            return note
    return None


def _open_on(tl, hook: HookOption | None, opened: set[str], clips) -> str | None:
    from app.director.creative_review import _place, _used, _window
    from app.video import footage

    if not tl.segments or tl.segments[0].clip_id not in opened or hook is None or hook.clip_id in opened:
        return None
    clip = next((c for c in clips if c.clip_id == hook.clip_id), None)
    seg = tl.segments[0]
    span = seg.length * seg.speed
    w = _window(clip, hook.start) if clip is not None else None
    if w is None:
        return None
    start = min(max(hook.start, w.start), w.end - span)
    reason = f"This version's own opening ({hook.reason}), so the versions start differently."
    if start >= w.start - 1e-6 and footage.is_fresh(start, start + span, _used(tl, skip=0).get(hook.clip_id, [])):
        if not _place(tl, 0, clip, start, w, reason):
            return None
        return f"Opening set to {clip.name} so this version does not start like an earlier one."
    # its footage is already used later in this version: trade places with that shot instead (no moment shown twice)
    from app.revise.director_patch import swap_footage

    by_id = {c.clip_id: c for c in clips}
    for k in range(1, len(tl.segments)):
        if tl.segments[k].clip_id == hook.clip_id and not tl.segments[k].locked and swap_footage(tl, 0, k, by_id):
            tl.segments[0].reason = f"{tl.segments[0].video}: {reason}"
            return f"Opening set to {tl.segments[0].video} (traded places with shot {k + 1}) so this version does not start like an earlier one."
    return None


def story_order(tl, clip_order: list[str], clips) -> str | None:
    """Cinematic tells a story in the order it happened: the shots between the opening and the ending play in filming
    order (the clip list, then time inside each clip) on the SAME cut times, so rhythm and music sync are unchanged.
    The opening and the ending keep their footage. Nothing changes when a shot is locked, or when re-ordering would
    show a moment twice (then the director's order stays). Returns a note or None."""
    from app.video import footage

    segs = tl.segments
    if len(segs) < 4:
        return None
    mid = list(range(1, len(segs) - 1))
    if any(segs[i].locked for i in mid):
        return None
    rank = {cid: i for i, cid in enumerate(clip_order)}
    fields = ("clip_id", "video", "source_start", "speed", "focus_x", "focus_y", "focus_source", "reason")
    items = [tuple(getattr(segs[i], f) for f in fields) for i in mid]
    ordered = sorted(items, key=lambda f: (rank.get(f[0], len(rank)), f[2]))
    if [f[0] for f in ordered] == [f[0] for f in items] and ordered == items:
        return None
    backup = [segs[i].model_copy() for i in mid]
    room = {c.clip_id: c.analysis.metadata.duration for c in clips}
    for i, f in zip(mid, ordered):
        s = segs[i]
        for name, v in zip(fields, f):
            setattr(s, name, v)
        span = s.length * s.speed
        s.source_end = round(s.source_start + span, 3)
        if s.source_end > room.get(s.clip_id, s.source_end):  # a longer slot than this footage had: start earlier
            s.source_start = round(max(room[s.clip_id] - span, 0.0), 3)
            s.source_end = round(min(room[s.clip_id], s.source_start + span), 3)
    for j, s in enumerate(segs):
        others = [(o.source_start, o.source_end) for n, o in enumerate(segs) if n != j and o.clip_id == s.clip_id]
        if footage.overlap_seconds(s.source_start, s.source_end, others) > 0.1:
            for i, b in zip(mid, backup):
                segs[i] = b
            return None
    return "Cinematic: the shots between the opening and the ending now play in the order they were filmed (same cuts)."


def merge_ai(draft: CreativePlan, concept: DirectorConcept | None, first_shot: dict | None) -> CreativePlan:
    """The final plan: the AI's concept where it gave one, the draft elsewhere; the hook is the shot actually used."""
    plan = draft.model_copy(deep=True)
    if concept is not None:
        for f in ("concept", "logline", "pacing", "visual_energy", "music_interpretation", "text_strategy", "effects_strategy",
                  "transition_strategy", "ending"):  # fmt: skip
            v = getattr(concept, f)
            if isinstance(v, str) and v.strip():
                setattr(plan, f, v.strip()[:300])
        if concept.story:
            plan.story = [s.strip()[:40] for s in concept.story if isinstance(s, str) and s.strip()][:10] or plan.story
        if concept.hook_type:
            plan.hook = {**plan.hook, "type": concept.hook_type[:40]}
        plan.source = "ai"
    if first_shot:
        plan.hook = {**plan.hook, **first_shot}
    return plan
