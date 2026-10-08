"""From words to edits.

A change request becomes a list of small, typed ``Action`` values. Actions are produced in two ways:

* a deterministic phrase parser (instant, offline, testable), and
* the local LLM for whatever the parser did not understand (its JSON is validated strictly).

Actions never run anything themselves. Edit actions are translated into ordinary EDL operations (the same
validated operations the editor uses); rebuild actions become settings for a fresh generation.
"""

from __future__ import annotations

import random
import re
from dataclasses import asdict, dataclass, field
from typing import Any, Callable

from app.ai.provider import AIProvider
from app.core.errors import AppError
from app.models.timeline import EFFECT_TYPES, TRANSITION_TYPES, CropSpec, Timeline
from app.schemas.project import MAX_DURATION, MIN_DURATION
from app.styles import list_styles
from app.video import timeline_ops as ops

# Actions that need a fresh edit from the footage (they change how shots are chosen and cut).
REBUILD_KINDS = {"style", "pace", "reshuffle", "captions_on"}
# Edit actions that still make sense on a freshly built timeline (they do not point at a specific shot).
GLOBAL_KINDS = {"speed", "effect", "transition", "music_volume", "music_fade", "caption_style", "framing", "watermark_off", "mute_music",
                "grade", "text_off", "text_less", "cta", "hook_text"}  # fmt: skip
# Creative changes the Director makes on the current edit (revise/director_patch.py): no rebuild, cuts kept.
DIRECTOR_KINDS = {"replace_hook", "drop_reveal", "product_earlier"}
KINDS = REBUILD_KINDS | GLOBAL_KINDS | DIRECTOR_KINDS | {"delete", "move", "duration", "captions_off", "voice_off", "voice_volume"}
# Changes that remove something the user may want to keep: shown first and applied only after confirmation.
DESTRUCTIVE_KINDS = {"delete", "text_off", "captions_off", "voice_off", "mute_music"}
GRADE_WORDS: tuple[tuple[str, str], ...] = (
    (r"\bwarm(?:er)?\b|\bgolden\b|\bcosy\b|\bcozy\b", "warm"), (r"\bcinematic (?:colou?rs?|grade|look)\b|\bteal\b|\bfilm(?:ic)? (?:colou?rs?|look)\b", "cinematic"),
    (r"\bluxur(?:y|ious) (?:colou?rs?|grade|look)\b|\bpremium (?:colou?rs?|grade)\b", "luxury"), (r"\bclean(?:er)? (?:colou?rs?|look)\b|\bbright(?:er)?\b", "clean"),
    (r"\b(?:more )?contrast\b|\bpunchy colou?rs?\b|\bvivid\b|\bvibrant\b", "high_contrast"), (r"\bsoft(?:er)? (?:colou?rs?|look)\b|\bpastel\b", "soft"),
    (r"\bnatural (?:colou?rs?|look)\b|\bno (?:colou?r )?grad(?:e|ing)\b", "natural"),
)  # fmt: skip

STYLE_WORDS: dict[str, tuple[str, ...]] = {
    "fast_trending": ("fast trending", "trending", "viral"),
    "cinematic": ("cinematic", "filmic", "movie"),
    "luxury": ("luxury", "premium", "elegant", "classy"),
    "food": ("food", "foodie"),
    "travel": ("travel", "adventure"),
    "minimal": ("minimal", "clean", "simple"),
    "storytelling": ("storytelling", "story"),
}
CAPTION_STYLES = ("minimal", "bold", "karaoke", "highlight", "luxury")
EXAMPLES = (
    "make it calmer with longer shots",
    "faster cuts, more energy",
    "remove the first clip",
    "make it 20 seconds",
    "add captions",
    "smoother transitions",
    "louder music",
    "use the luxury style",
    "show a different order",
    "make the first 3 seconds stronger",
    "use the drop for the product reveal",
    "show the product earlier",
)


@dataclass
class Action:
    kind: str
    scope: str = "all"  # all | first | last | shot
    shot: int | None = None  # 1-based, when scope == "shot"
    value: Any = None  # str (style, effect ...) or number (seconds, speed ...)
    factor: float | None = None  # multiply the current value
    delta: float | None = None  # add to the current value
    to: str | int | None = None  # move target: "start" | "end" | position
    text: str = ""  # the words this came from
    source: str = "rules"  # rules | ai

    @property
    def rebuild(self) -> bool:
        return self.kind in REBUILD_KINDS

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class Plan:
    actions: list[Action] = field(default_factory=list)
    not_understood: list[str] = field(default_factory=list)
    used_ai: bool = False
    ai_note: str | None = None


# ------------------------------------------------------------------ rules
_ORD = {"first": 1, "1st": 1, "second": 2, "2nd": 2, "third": 3, "3rd": 3, "fourth": 4, "4th": 4, "fifth": 5, "5th": 5,
        "sixth": 6, "6th": 6, "seventh": 7, "7th": 7, "eighth": 8, "8th": 8}  # fmt: skip
_NOUN = r"(?:shot|clip|scene|part|video|footage)"
_REF = re.compile(rf"\b(?:(?P<ord>{'|'.join(_ORD)}|last|final|opening|ending)\s+(?:{_NOUN})s?|(?:{_NOUN})\s*(?:no\.?\s*|number\s*|#)?(?P<num>\d{{1,2}})|#(?P<hash>\d{{1,2}}))\b")


def _shot_ref(c: str) -> tuple[str, int | None] | None:
    m = _REF.search(c)
    if not m:
        return None
    if m.group("num") or m.group("hash"):
        return "shot", int(m.group("num") or m.group("hash"))
    word = m.group("ord")
    if word in ("last", "final", "ending"):
        return "last", None
    if word == "opening":
        return "first", None
    return "shot", _ORD[word]


def _scope(c: str) -> dict[str, Any]:
    ref = _shot_ref(c)
    if not ref:
        return {"scope": "all", "shot": None}
    if ref == ("shot", 1):
        return {"scope": "first", "shot": None}
    return {"scope": ref[0], "shot": ref[1]}


def _has(c: str, pattern: str) -> bool:
    return re.search(pattern, c) is not None


_CAPTION = r"(?:caption|subtitle|lyrics? text)s?"
_NEG = r"(?:remove|delete|no|without|hide|turn off|disable|drop|get rid of|don'?t (?:want|need|show|add))"
_POS = r"(?:add|turn on|enable|show|with|include|need|want|put|use|give me|generate)"


def _r_watermark(c: str) -> list[Action] | None:
    if _has(c, rf"{_NEG}\b.*\b(?:watermark|logo)") or _has(c, r"\b(?:watermark|logo)\b.*\b(?:off|away|remove)"):
        return [Action("watermark_off")]
    return None


def _r_voice(c: str) -> list[Action] | None:
    if not _has(c, r"\b(?:voice|voice-?over|voiceover|narration|narrator)\b"):
        return None
    if _has(c, rf"{_NEG}|mute|silence"):
        return [Action("voice_off")]
    if _has(c, r"\b(?:louder|higher|increase|up|clearer|stronger|boost)\b"):
        return [Action("voice_volume", delta=0.25)]
    if _has(c, r"\b(?:quieter|lower|softer|reduce|decrease|down|less)\b"):
        return [Action("voice_volume", delta=-0.25)]
    return None


def _r_captions(c: str) -> list[Action] | None:
    if not _has(c, _CAPTION):
        return None
    if _has(c, rf"{_NEG}\b.*{_CAPTION}"):
        return [Action("captions_off")]
    for st in CAPTION_STYLES:
        if _has(c, rf"\b{st}\b"):
            return [Action("caption_style", value=st)]
    if _has(c, rf"{_POS}\b.*{_CAPTION}") or _has(c, rf"{_CAPTION}\b.*\b(?:on|please)\b") or _has(c, rf"^{_CAPTION}$"):
        return [Action("captions_on")]
    return None


def _r_music(c: str) -> list[Action] | None:
    music = r"\b(?:music|song|track|audio|background|bgm|beat)\b"
    if _has(c, r"\bfade\b") and _has(c, music + r"|\bout\b|\bending\b"):
        return [Action("music_fade", value=2.0)]
    if not _has(c, music):
        return None
    if _has(c, rf"\b(?:mute|silence)\b|{_NEG}\b.*{music}|\bno music\b"):
        return [Action("mute_music")]
    if _has(c, r"\b(?:louder|increase|higher|up|more|boost|stronger|raise)\b"):
        return [Action("music_volume", delta=0.2)]
    if _has(c, r"\b(?:quieter|lower|softer|reduce|decrease|down|less|reduce|tone down|turn down)\b"):
        return [Action("music_volume", delta=-0.25)]
    return None


_NUM_SEC = re.compile(r"(\d{1,3}(?:\.\d+)?)\s*(?:seconds?|secs?|s)\b")


def _r_duration(c: str) -> list[Action] | None:
    m = _NUM_SEC.search(c)
    if m and _has(c, r"\b(?:make|keep|reduce|trim|length|duration|cut|shorten|extend|lengthen|total|only|around|about|exactly|be|should|bring)\b"):
        return [Action("duration", value=float(m.group(1)))]
    if m and _has(c, r"\b(?:long|longer|shorter)\b"):
        return [Action("duration", value=float(m.group(1)))]
    # "the ending is too long" is about a part, not the whole Reel: leave that to the AI / the user
    about_a_part = _shot_ref(c) is not None or _has(c, r"\b(?:ending|end|intro|opening|start|beginning|middle|part|section|shot|clip|scene)\b")
    whole = r"(?:reel|video|it|overall|whole thing|everything)"
    if not about_a_part and (
        _has(c, r"\b(?:shorter (?:reel|video|overall)|shorten (?:it|the reel|the video)|make it shorter|reduce (?:the )?length)\b")
        or _has(c, rf"\b{whole}\b.*\btoo long\b|^too long$")
    ):
        return [Action("duration", factor=0.75)]
    if not about_a_part and (
        _has(c, r"\b(?:longer (?:reel|video|overall)|make it longer|extend (?:it|the reel|the video)|lengthen)\b")
        or _has(c, rf"\b{whole}\b.*\btoo short\b|^too short$")
    ):
        return [Action("duration", factor=1.3)]
    return None


def _r_framing(c: str) -> list[Action] | None:
    if _has(c, r"\b(?:fill the (?:screen|frame)|full[- ]?screen|crop to fill|no (?:blur|blurred|black bars|bars)|remove (?:the )?(?:blur|blurred|bars)|zoom to fill|fill)\b"):
        return [Action("framing", value="fill")]
    if _has(c, r"\b(?:whole|entire|full) (?:picture|frame|video|image)\b|\b(?:don'?t|do not|no) crop|\bno cropping\b|\bfit (?:the )?(?:whole|video|frame|screen)\b"):
        return [Action("framing", value="fit")]
    return None


def _r_grade(c: str) -> list[Action] | None:
    if not _has(c, r"\bcolou?rs?\b|\bgrad(?:e|ing)\b|\blook\b|\btones?\b|\bwarm|\bcontrast\b|\bvivid\b|\bvibrant\b|\bbright|\bpastel\b|\bteal\b"):
        return None
    for pat, grade in GRADE_WORDS:
        if _has(c, pat):
            return [Action("grade", value=grade)]
    return None


_TEXT = r"(?:text|texts|titles?|words on screen|on-?screen text|overlays?|writing)"


def _r_text(c: str) -> list[Action] | None:
    m = re.search(r"\b(?:cta|call to action)\b[^a-z0-9]*(?:to|:|=|says?|reads?|with)?\s*[\"']?(?P<t>[^\"']{2,60})[\"']?$", c)
    if m and _has(c, r"\b(?:change|set|make|use|update|replace|cta|call to action)\b") and m.group("t").strip() not in ("", "the", "it"):
        return [Action("cta", value=m.group("t").strip().strip(".")[:42])]
    m = re.search(r"\bhook(?: text)?\b[^a-z0-9]*(?:to|:|=|says?|reads?)\s*[\"']?(?P<t>[^\"']{2,60})[\"']?$", c)
    if m:
        return [Action("hook_text", value=m.group("t").strip().strip(".")[:42])]
    if not _has(c, rf"\b{_TEXT}\b"):
        return None
    if _has(c, rf"{_NEG}\b.*\b{_TEXT}\b|\bno {_TEXT}\b|\b{_TEXT}\b.*\b(?:off|away)\b"):
        return [Action("text_off")]
    if _has(c, rf"\b(?:less|fewer|reduce|minimal|too much|too many|cleaner)\b.*\b{_TEXT}\b|\b{_TEXT}\b.*\b(?:less|fewer|too much)\b"):
        return [Action("text_less")]
    return None


_TRANSITION_WORDS = (
    (r"\b(?:no|without|hard|straight|plain|simple) (?:transitions?|cuts?)\b|\bcut only\b"
     r"|\b(?:remove|drop|fewer|less|unnecessary|extra|too many) (?:\w+ )?transitions?\b", "cut"),
    (r"\bspeed[- ]?ramp\b", "speed_ramp"),
    (r"\b(?:dissolve|crossfade|cross[- ]fade|smooth(?:er)?|softer|gentle|gentler)\b", "dissolve"),
    (r"\bfade\b", "fade"),
    (r"\bslide\b", "slide"),
    (r"\bblur\b", "blur"),
    (r"\bflash\b", "flash"),
    (r"\bzoom\b", "zoom"),
)


def _r_transition(c: str) -> list[Action] | None:
    if not _has(c, r"\btransitions?\b|\bhard cuts?\b|\bstraight cuts?\b|\bcut only\b"):
        return None
    for pat, name in _TRANSITION_WORDS:
        if _has(c, pat):
            return [Action("transition", value=name, **_scope(c))]
    return None


def _r_effect(c: str) -> list[Action] | None:
    if _has(c, rf"\b(?:no|without|remove|drop|less|fewer|turn off) (?:the )?(?:\w+ )?effects?\b") or _has(c, r"\bplain shots?\b"):
        return [Action("effect", value="none", **_scope(c))]
    for pat, name in ((r"\bken[- ]?burns\b", "ken_burns"), (r"\b(?:crash|snap|fast|quick)[- ]?zoom\b", "crash_zoom"),
                      (r"\b(?:camera )?shak(?:e|y|ing)\b|\bhandheld\b", "shake"), (r"\b(?:roll|rotat\w*|sway|dutch angle)\b", "roll"),
                      (r"\bblack (?:and|&) white\b|\bb ?& ?w\b|\bmonochrome\b|\bgr[ae]yscale\b", "black_white"),
                      (r"\bflash(?:es)? (?:effect|on (?:the )?(?:beat|cuts?))\b|\bwhite flash\b", "flash")):  # fmt: skip
        if _has(c, pat) and not _has(c, r"\btransition"):
            return [Action("effect", value=name, **_scope(c))]
    if _has(c, r"\bzoom[- ]?out\b"):
        return [Action("effect", value="zoom_out", **_scope(c))]
    if _has(c, r"\bpunch(?:[- ]?in)?\b"):
        return [Action("effect", value="punch", **_scope(c))]
    if _has(c, r"\bzoom(?:[- ]?in| effect|s)?\b|\bpush[- ]?in\b|\bslow zoom\b") and not _has(c, r"\btransition"):
        return [Action("effect", value="zoom_in", **_scope(c))]
    if _has(c, r"\b(?:tilt|pan)[- ]?up\b"):
        return [Action("effect", value="pan_up", **_scope(c))]
    if _has(c, r"\b(?:tilt|pan)[- ]?down\b"):
        return [Action("effect", value="pan_down", **_scope(c))]
    if _has(c, r"\bpan(?:s|ning)?\b|\bslider\b|\bcamera (?:movement|moves|motion)\b") and not _has(c, r"\btransition"):
        return [Action("effect", value="pan", **_scope(c))]  # alternates left / right shot by shot
    return None


def _r_delete(c: str) -> list[Action] | None:
    if not _has(c, r"\b(?:remove|delete|drop|cut out|get rid of|skip|take out|without|discard)\b"):
        return None
    ref = _shot_ref(c)
    if ref is None:
        return None
    s = _scope(c)
    return [Action("delete", **s)]


def _r_move(c: str) -> list[Action] | None:
    if not _has(c, r"\b(?:move|put|place|swap|bring|send)\b"):
        return None
    ref = _shot_ref(c)
    if ref is None:
        return None
    to: str | int | None = None
    if _has(c, r"\b(?:start|beginning|front|top|first|opening|open)\b") and not _has(c, r"^\s*(?:put|move)\s+(?:the\s+)?first"):
        to = "start"
    elif _has(c, r"\b(?:end|back|last|final|ending|close)\b") and not _has(c, r"^\s*(?:put|move)\s+(?:the\s+)?last"):
        to = "end"
    m = re.search(r"\b(?:to|at|in) (?:position|place|spot|#)?\s*(\d{1,2})\b", c)
    if m:
        to = int(m.group(1))
    if to is None and _has(c, r"^\s*(?:put|move|bring)\s+(?:the\s+)?last\b.*\b(?:first|start|beginning)\b"):
        to = "start"
    if to is None:
        return None
    return [Action("move", **_scope(c), to=to)]


_PACE_CALM = r"\b(?:longer (?:shots?|clips?|takes?)|fewer cuts|less cuts|not so many cuts|calm(?:er)?|relax(?:ed|ing)?|smooth(?:er)? (?:pace|edit|cuts?)|slow(?:er)? (?:cuts?|pace|pacing|edit|rhythm|tempo)|too (?:fast|quick|busy|rushed|choppy|many cuts)|less busy|breathe|more room)\b"
_PACE_FAST = r"\b(?:more cuts|cuts? (?:faster|quicker)|faster (?:cuts?|pace|pacing|edit|rhythm)|shorter (?:shots?|clips?)|quick(?:er)? cuts?|every beat|more energ(?:y|etic)|energetic|punchy|dynamic|snappy|snappier|upbeat|too slow|boring|more exciting|hype|lively)\b"


def _r_pace(c: str) -> list[Action] | None:
    bare = r"^(?:please |can you |make it |a bit |a little |bit |much |little |just |it is |it's |its |too )*"
    if _has(c, bare + r"(?:slower|slow|slow down|calmer|smoother)\s*(?:please|a bit|a little)?$"):
        return [Action("pace", value="calm")]
    if _has(c, bare + r"(?:faster|quicker|speed up|snappier|livelier)\s*(?:please|a bit|a little)?$"):
        return [Action("pace", value="fast")]
    if _has(c, _PACE_CALM):
        return [Action("pace", value="calm")]
    if _has(c, _PACE_FAST):
        return [Action("pace", value="fast")]
    if _has(c, r"\b(?:balanced|normal|default|medium) (?:pace|pacing|cuts)\b"):
        return [Action("pace", value="balanced")]
    return None


def _r_speed(c: str) -> list[Action] | None:
    tgt = r"(?:playback|footage|video|videos|clips?|shots?|motion|speed)"
    if _has(c, r"\bslow[- ]?(?:mo|motion)\b|\bhalf[- ]speed\b"):
        return [Action("speed", value=0.5, **_scope(c))]
    if _has(c, r"\b(?:double|2x|twice) (?:the )?speed\b"):
        return [Action("speed", value=2.0, **_scope(c))]
    if _has(c, r"\b(?:normal|real|regular|original)[- ](?:speed|time)\b|\breset (?:the )?speed\b"):
        return [Action("speed", value=1.0, **_scope(c))]
    if _has(c, rf"\b(?:slow down|slower|slow)\b.*\b{tgt}\b") or _has(c, rf"\b{tgt}\b.*\b(?:slower|slow down)\b"):
        return [Action("speed", factor=0.75, **_scope(c))]
    if _has(c, rf"\b(?:speed up|faster|quicker)\b.*\b{tgt}\b") or _has(c, rf"\b{tgt}\b.*\b(?:faster|speed up)\b") or _has(c, r"\btime[- ]?lapse\b"):
        return [Action("speed", factor=1.5, **_scope(c))]
    return None


def _r_style(c: str) -> list[Action] | None:
    if not _has(c, r"\b(?:style|look|feel|vibe|mode|mood|theme|make it|more|change|switch|convert|turn|use|go|try|want)\b"):
        return None
    for sid, words in STYLE_WORDS.items():
        for w in words:
            if _has(c, rf"\b{re.escape(w)}\b"):
                if w == "story" and not _has(c, r"\bstory ?(?:telling|style|mode|like)\b|\bstory\b"):
                    continue
                return [Action("style", value=sid)]
    return None


def _r_reshuffle(c: str) -> list[Action] | None:
    if _has(c, r"\b(?:different|other|new|another) (?:clips?|order|shots?|edit|version|selection|arrangement|take|cut|sequence)\b|\bre-?shuffle\b|\bshuffle\b|\bmix (?:it )?up\b|\btry again\b|\bsurprise me\b|\bregenerate\b|\bredo (?:it|the edit)\b"):
        return [Action("reshuffle")]
    return None


# Order matters: specific things (logo, captions, music, numbers) before generic words like "faster".
def _r_director(c: str) -> list[Action] | None:
    from app.revise.director_patch import parse_director

    return parse_director(c)


_RULES: tuple[Callable[[str], list[Action] | None], ...] = (
    _r_director, _r_watermark, _r_voice, _r_captions, _r_text, _r_music, _r_duration, _r_framing, _r_grade, _r_transition, _r_effect, _r_delete,
    _r_move, _r_pace, _r_speed, _r_style, _r_reshuffle,
)  # fmt: skip

_SPLIT = re.compile(r"[.;!\n]+|,|\bplus\b|\balso\b|\bthen\b|\band\b|\bbut\b|\bafter that\b|\bmake sure\b|\bplease\b|\bwith\b|&", re.IGNORECASE)


def _clauses(text: str) -> list[str]:
    text = re.sub(r"\bblack\s*(?:and|&)\s*white\b", "monochrome", text.lower())  # one phrase, not two requests
    parts = [p.strip(" -–—:") for p in _SPLIT.split(text)]
    return [p for p in parts if len(p) > 1]


def parse_rules(text: str) -> tuple[list[Action], list[str]]:
    """(actions, clauses the rules did not understand)."""
    actions: list[Action] = []
    unknown: list[str] = []
    for clause in _clauses(text):
        found = None
        for rule in _RULES:
            found = rule(clause)
            if found:
                break
        if found:
            for a in found:
                a.text = clause
            actions += found
        else:
            unknown.append(clause)
    for a in actions:  # on-screen text keeps the user's own capitals ("Shop Now", not "shop now")
        if a.kind in ("cta", "hook_text") and isinstance(a.value, str):
            at = text.lower().find(a.value.lower())
            if at >= 0:
                a.value = text[at : at + len(a.value)]
    # "add captions" + "bold captions" -> keep both; a second identical rebuild is pointless
    seen: set[tuple[str, Any]] = set()
    unique: list[Action] = []
    for a in actions:
        key = (a.kind, a.value if a.kind in REBUILD_KINDS else None, a.scope, a.shot)
        if a.kind in REBUILD_KINDS and key in seen:
            continue
        seen.add(key)
        unique.append(a)
    return unique, unknown


# ------------------------------------------------------------------ LLM (for what the rules did not understand)
SYSTEM = (
    "You translate a video editor's change request into a JSON list of actions. Reply with JSON only. "
    "You never write code. Use ONLY these actions and fields:\n"
    '{"action":"speed","scope":"all|first|last|shot","shot":2,"factor":0.75}   (factor <1 slows, >1 speeds up)\n'
    '{"action":"delete","scope":"first|last|shot","shot":2}\n'
    '{"action":"move","scope":"first|last|shot","shot":2,"to":"start|end|3"}\n'
    '{"action":"effect","scope":"all|first|last|shot","shot":2,"value":"none|zoom_in|zoom_out|punch"}\n'
    '{"action":"transition","scope":"all|first|last|shot","shot":2,"value":"cut|fade|dissolve|zoom|slide|blur|flash|speed_ramp"}\n'
    '{"action":"music_volume","factor":1.3}   {"action":"mute_music"}   {"action":"music_fade","value":2}\n'
    '{"action":"duration","value":20}   (seconds)\n'
    '{"action":"captions_on"}   {"action":"captions_off"}   {"action":"caption_style","value":"minimal|bold|karaoke|highlight|luxury"}\n'
    '{"action":"framing","value":"fit|fill"}   {"action":"watermark_off"}   {"action":"voice_off"}   {"action":"voice_volume","factor":1.2}\n'
    '{"action":"pace","value":"calm|balanced|fast"}   {"action":"style","value":"<style id>"}   {"action":"reshuffle"}\n'
    'Answer as {"actions":[...],"unclear":"<the part you could not map, or an empty string>"}. Shots are numbered from 1. '
    "Return ONLY actions the request clearly asks for, usually one or two. Never add actions that were not requested. "
    "If a request is vague or cannot be expressed with these actions, return an empty actions list and put it in unclear."
)


def system_prompt() -> str:
    from app.video.grades import available as grades
    from app.video.transitions import available as transitions

    featured = [t for t in ("cut", "fade", "dissolve", "zoom", "slide", "blur", "flash", "speed_ramp", "wipe_left", "circle_open") if t in transitions()]
    return (SYSTEM.replace("none|zoom_in|zoom_out|punch", "|".join(EFFECT_TYPES))
            .replace("cut|fade|dissolve|zoom|slide|blur|flash|speed_ramp", "|".join(featured))
            .replace('Answer as {"actions"', '{"action":"grade","value":"' + "|".join(grades()) + '"}   {"action":"text_off"}   {"action":"text_less"}\n'
                     '{"action":"cta","value":"<new call to action, max 6 words>"}   {"action":"hook_text","value":"<opening text, max 6 words>"}\n'
                     'Shots may carry "shows": what the clip shows. Use it to find a shot the user describes (e.g. "the product"). '
                     'Answer as {"actions"'))


def _num(v: Any, lo: float, hi: float) -> float | None:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return min(max(f, lo), hi) if f == f else None


_ORD_BY_NUM = {v: k for k, v in _ORD.items()}
_REMOVAL = r"\b(?:remove|delete|drop|cut out|cut|skip|get rid of|take out|without|discard|trim out)\b"
_FIRST = r"\b(?:first|opening|intro|start|beginning|1st)\b"
_LAST = r"\b(?:last|end|ending|final|outro|closing|finish)\b"


def _grounded(kind: str, scope: str, shot: int | None, text: str) -> str | None:
    """A model may only act on what the user actually referred to. Returns why not, or None when it is fine."""
    t = text.lower()
    if scope == "shot" and shot is not None:
        words = [w for w, n in _ORD.items() if n == shot]
        if not (re.search(rf"(?<!\d){shot}(?!\d)", t) or any(re.search(rf"\b{w}\b", t) for w in words)):
            return f"the AI picked shot {shot}, which you did not mention"
    elif scope == "first" and not _has(t, _FIRST):
        return "the AI picked the first shot, which you did not mention"
    elif scope == "last" and not _has(t, _LAST):
        return "the AI picked the last shot, which you did not mention"
    if kind == "delete" and not _has(t, _REMOVAL):
        return "the AI wanted to remove a shot, but you did not ask for that"
    return None


def parse_ai_actions(data: dict[str, Any], shots: int, style_ids: set[str], request_text: str | None = None) -> tuple[list[Action], list[str]]:
    """Strictly validate the model's answer. Anything unknown, out of range or not grounded in the user's own words
    (when ``request_text`` is given) is dropped and reported."""
    out: list[Action] = []
    dropped: list[str] = []
    raw = data.get("actions")
    for item in raw if isinstance(raw, list) else []:
        if not isinstance(item, dict):
            continue
        kind = str(item.get("action", "")).strip().lower()
        if kind not in KINDS:
            dropped.append(f"unknown action '{kind[:30]}'")
            continue
        scope = str(item.get("scope") or "all").lower()
        if scope not in ("all", "first", "last", "shot"):
            scope = "all"
        shot = item.get("shot")
        shot = int(shot) if isinstance(shot, (int, float)) and 1 <= int(shot) <= max(shots, 1) else None
        if scope == "shot" and shot is None:
            dropped.append(f"{kind}: no such shot")
            continue
        if request_text is not None:
            why = _grounded(kind, scope, shot, request_text)
            if why:
                dropped.append(why)
                continue
        a = Action(kind, scope=scope, shot=shot, source="ai", text=f"{kind} {item.get('value', '')}".strip())
        value = item.get("value")
        if kind in ("delete", "move") and scope == "all":
            dropped.append(f"{kind}: which shot?")
            continue
        if kind == "speed":
            a.factor = _num(item.get("factor"), 0.25, 4)
            a.value = _num(value, 0.25, 4) if a.factor is None else None
            if a.factor is None and a.value is None:
                continue
        elif kind == "effect" and (value in EFFECT_TYPES or value == "pan"):  # "pan" = left and right in turn
            a.value = value
        elif kind == "transition" and value in TRANSITION_TYPES:
            a.value = value
        elif kind in ("music_volume", "voice_volume"):
            a.factor = _num(item.get("factor"), 0.0, 3)
            a.delta = _num(item.get("delta"), -1.5, 1.5)
            if a.factor is None and a.delta is None:
                continue
        elif kind == "music_fade":
            a.value = _num(value, 0.5, 10) or 2.0
        elif kind == "duration":
            a.value = _num(value, MIN_DURATION, MAX_DURATION)
            a.factor = _num(item.get("factor"), 0.3, 3) if a.value is None else None
            if a.value is None and a.factor is None:
                continue
        elif kind == "grade" and isinstance(value, str) and value in _grades():
            a.value = value
        elif kind in ("cta", "hook_text") and isinstance(value, str) and value.strip():
            a.value = value.strip()[:42]
        elif kind in ("text_off", "text_less"):
            pass
        elif kind in ("grade", "cta", "hook_text"):
            dropped.append(f"{kind}: unsupported value '{str(value)[:20]}'")
            continue
        elif kind == "caption_style" and value in CAPTION_STYLES:
            a.value = value
        elif kind == "framing" and value in ("fit", "fill"):
            a.value = value
        elif kind == "pace" and value in ("calm", "balanced", "fast"):
            a.value = value
        elif kind == "style" and value in style_ids:
            a.value = value
        elif kind == "move":
            to = item.get("to")
            a.to = to if to in ("start", "end") else (int(to) if isinstance(to, (int, float)) and 1 <= int(to) <= shots else None)
            if a.to is None:
                continue
        elif kind in ("effect", "transition", "caption_style", "framing", "pace", "style"):
            dropped.append(f"{kind}: unsupported value '{str(value)[:20]}'")
            continue
        out.append(a)
    unclear = data.get("unclear")
    if isinstance(unclear, str) and unclear.strip().lower().rstrip(".") not in ("", "none", "n/a", "nothing", "anything you could not map"):
        dropped.append(unclear.strip()[:120])
    return out, dropped


def _grades() -> list[str]:
    from app.video.grades import available

    return available()


def summary_for_ai(tl: Timeline, settings: dict[str, Any], shows: dict[str, str] | None = None) -> dict[str, Any]:
    """``shows``: clip id -> what the vision model saw in it (lets the AI find "the product", "the finished dish" ...)."""
    shows = shows or {}
    return {
        "shots": [
            {"n": i, "clip": s.video[:40], "seconds": round(s.length, 1), "speed": s.speed, "effect": s.effect, "transition": s.transition_in.type,
             **({"shows": shows[s.clip_id][:120]} if s.clip_id in shows else {})}
            for i, s in enumerate(tl.segments, 1)
        ],
        "texts": [{"text": o.text, "role": o.role} for o in tl.overlays],
        "grade": tl.color_grade,
        "duration": round(tl.duration, 1), "style": tl.style, "pace": settings.get("pace"), "captions": bool(tl.captions),
        "has_voice": tl.voice is not None,
    }  # fmt: skip


def plan_revision(text: str, tl: Timeline, settings: dict[str, Any], provider: AIProvider | None, shows: dict[str, str] | None = None) -> Plan:
    actions, unknown = parse_rules(text)
    plan = Plan(actions=actions, not_understood=list(unknown))
    if unknown and provider is not None:
        import json

        style_ids = {s.id for s in list_styles()}
        try:
            from app.ai.schemas import RevisionAnswer

            data = provider.generate_structured(
                system_prompt(), json.dumps({"request": " , ".join(unknown), "reel": summary_for_ai(tl, settings, shows), "styles": sorted(style_ids)}),
                RevisionAnswer, task="revision", temperature=0.2,
            ).model_dump(exclude_none=True)
            extra, dropped = parse_ai_actions(data, len(tl.segments), style_ids, request_text=" , ".join(unknown))
            plan.used_ai = True
            if dropped and not extra:
                plan.ai_note = "The AI model's suggestion did not match what you asked, so it was ignored: " + "; ".join(dropped[:2]) + "."
            plan.actions += extra
            plan.not_understood = dropped if extra else list(unknown)
            if extra and dropped:
                plan.not_understood = dropped
        except AppError as e:  # AI unavailable, timed out or returned nonsense: say so, keep what the rules understood
            plan.ai_note = f"The AI model could not help with the unclear part ({e.message})."
    elif unknown:
        plan.ai_note = "AI assist is not available, so only the phrases I know were applied."
    return plan


# ------------------------------------------------------------------ actions -> EDL operations
def _targets(a: Action, tl: Timeline, notes: list[str]) -> list[int]:
    n = len(tl.segments)
    if a.scope == "all":
        return list(range(n))
    if a.scope == "first":
        return [0]
    if a.scope == "last":
        return [n - 1]
    if a.shot is not None and 1 <= a.shot <= n:
        return [a.shot - 1]
    notes.append(f"There is no shot {a.shot}; the Reel has {n}.")
    return []


def describe(a: Action) -> str:
    where = {"all": "every shot", "first": "the first shot", "last": "the last shot"}.get(a.scope, f"shot {a.shot}")
    k, v = a.kind, a.value
    if k == "speed":
        how = f"{v}x" if v is not None else f"{'slower' if (a.factor or 1) < 1 else 'faster'} (x{a.factor})"
        return f"Playback speed of {where}: {how}"
    if k == "delete":
        return f"Remove {where}"
    if k == "move":
        return f"Move {where} to the {a.to}" if isinstance(a.to, str) else f"Move {where} to position {a.to}"
    if k == "effect":
        return f"Effect on {where}: {v}"
    if k == "transition":
        return f"Transition into {where}: {v}"
    if k == "music_volume":
        return "Music louder" if (a.delta or 0) > 0 or (a.factor or 1) > 1 else "Music quieter"
    if k == "mute_music":
        return "Mute the music"
    if k == "music_fade":
        return "Fade the music out at the end"
    if k == "voice_volume":
        return "Voice louder" if (a.delta or 0) > 0 or (a.factor or 1) > 1 else "Voice quieter"
    if k == "voice_off":
        return "Remove the voice-over"
    if k == "duration":
        return f"Length: {v:g} seconds" if v is not None else f"Length: {'shorter' if (a.factor or 1) < 1 else 'longer'}"
    if k == "captions_off":
        return "Remove captions"
    if k == "captions_on":
        return "Add captions (rebuilds the edit)"
    if k == "caption_style":
        return f"Caption look: {v}"
    if k == "framing":
        return "Fill the whole screen (crops the picture)" if v == "fill" else "Show the whole picture (blurred backdrop)"
    if k == "watermark_off":
        return "Remove the watermark"
    if k == "pace":
        return {"calm": "Calmer pace: longer shots, fewer cuts", "fast": "Faster pace: more cuts", "balanced": "Balanced pace"}[str(v)] + " (rebuilds the edit)"
    if k == "style":
        return f"Style: {v} (rebuilds the edit)"
    if k == "grade":
        return f"Colour grade: {v}"
    if k == "text_off":
        return "Remove all on-screen text"
    if k == "text_less":
        return "Less text: keep only the hook and the call to action"
    if k == "cta":
        return f'Call to action: "{v}"'
    if k == "hook_text":
        return f'Opening text: "{v}"'
    if k in DIRECTOR_KINDS:
        from app.revise.director_patch import describe as describe_patch

        return describe_patch(k)
    if k == "effect" and v == "pan":
        return f"Camera pans on {where} (left and right in turn)"
    return "Different clip selection and order (rebuilds the edit)"


def actions_to_ops(actions: list[Action], tl: Timeline, *, audio_duration: float | None = None) -> tuple[list[Any], list[str], list[Action]]:
    """(operations, notes, actions that produced something). Pure; nothing is applied here."""
    out: list[Any] = []
    notes: list[str] = []
    applied: list[Action] = []
    doomed: set[int] = set()
    cur_music = tl.music_volume
    overlays = list(tl.overlays)

    for a in actions:
        if a.rebuild:
            continue
        before = len(out)
        k = a.kind
        if k == "speed":
            for i in _targets(a, tl, notes):
                s = tl.segments[i]
                new = a.value if a.value is not None else s.speed * (a.factor or 1)
                out.append(ops.SetSpeed(segment_id=s.id, speed=round(min(max(new, ops.MIN_SPEED), ops.MAX_SPEED), 3)))
        elif k == "delete":
            for i in _targets(a, tl, notes):
                doomed.add(i)
        elif k == "move":
            idx = _targets(a, tl, notes)
            if idx:
                n = len(tl.segments)
                to = 0 if a.to == "start" else n - 1 if a.to == "end" else min(max(int(a.to or 1) - 1, 0), n - 1)
                out.append(ops.Move(segment_id=tl.segments[idx[0]].id, to_index=to))
        elif k == "effect":
            for n_, i in enumerate(_targets(a, tl, notes)):
                effect = ("pan_left" if n_ % 2 == 0 else "pan_right") if a.value == "pan" else str(a.value)
                out.append(ops.SetEffect(segment_id=tl.segments[i].id, effect=effect))
        elif k == "grade":
            out.append(ops.SetGrade(grade=str(a.value)))
        elif k in ("text_off", "text_less", "cta", "hook_text"):
            texts = _texts_after(a, tl, overlays)
            if texts is None:
                notes.append("There is no on-screen text to change." if k in ("text_off", "text_less") else "")
                notes[:] = [n for n in notes if n]
            else:
                overlays = texts
                out.append(ops.SetOverlays(overlays=texts))
        elif k == "transition":
            for i in _targets(a, tl, notes):
                if i == 0:
                    continue  # the first shot has nothing to transition from
                out.append(ops.SetTransition(segment_id=tl.segments[i].id, transition=str(a.value), duration=None if a.value == "cut" else 0.4))
        elif k == "music_volume":
            new = cur_music * a.factor if a.factor is not None else cur_music + (a.delta or 0)
            cur_music = round(min(max(new, 0.0), 1.5), 3)
            out.append(ops.SetMusic(volume=cur_music))
        elif k == "mute_music":
            cur_music = 0.0
            out.append(ops.SetMusic(volume=0.0))
        elif k == "music_fade":
            out.append(ops.SetMusic(fade_out=float(a.value or 2.0)))
        elif k == "voice_volume":
            if tl.voice is None:
                notes.append("There is no voice-over to adjust.")
            else:
                cur = tl.voice.volume
                new = cur * a.factor if a.factor is not None else cur + (a.delta or 0)
                out.append(ops.SetVoiceMix(volume=round(min(max(new, 0.0), 2.0), 3)))
        elif k == "voice_off":
            if tl.voice is None:
                notes.append("There is no voice-over to remove.")
            else:
                out.append(ops.ClearVoice())
        elif k == "duration":
            lo, hi = MIN_DURATION, min(MAX_DURATION, audio_duration or MAX_DURATION)
            target = a.value if a.value is not None else tl.duration * (a.factor or 1)
            clamped = min(max(target, lo), hi)
            if clamped != target:
                notes.append(f"A length of {target:g}s is outside what this Reel can be; using {clamped:g}s.")
            out.append(ops.FitDuration(target=round(clamped, 2)))
        elif k == "captions_off":
            if not tl.captions:
                notes.append("There are no captions to remove.")
            else:
                out.append(ops.ReplaceCaptions(captions=[]))
        elif k == "caption_style":
            if not tl.captions:
                notes.append("There are no captions yet; say \"add captions\" first.")
            else:
                out.append(ops.SetCaptionStyle(style=str(a.value)))
        elif k == "framing":
            for i in range(len(tl.segments)):
                out.append(ops.SetCrop(segment_id=tl.segments[i].id, crop=CropSpec(framing=str(a.value))))
        elif k == "watermark_off":
            if tl.watermark is None:
                notes.append("There is no watermark on this Reel.")
            else:
                out.append(ops.ClearWatermark())
        if len(out) > before or (k == "delete" and doomed):
            applied.append(a)

    if doomed:
        if len(doomed) >= len(tl.segments):
            notes.append("That would remove every shot; a Reel needs at least one.")
        else:
            # deletions last, by id, so the indices in the request always mean the ORIGINAL numbering
            out += [ops.Delete(segment_id=tl.segments[i].id) for i in sorted(doomed)]
    elif not out and not applied:
        pass
    return out, notes, applied


def rebuild_overrides(actions: list[Action]) -> dict[str, Any]:
    """Settings for a fresh generation. Later requests win over earlier ones."""
    o: dict[str, Any] = {}
    for a in actions:
        if a.kind == "style":
            o["style"] = a.value
        elif a.kind == "pace":
            o["pace"] = a.value
        elif a.kind == "captions_on":
            o["captions"] = True
        elif a.kind == "reshuffle":
            o["seed"] = random.randint(1, 10_000_000)
        elif a.kind == "duration" and a.value is not None:
            o["duration"] = int(min(max(round(a.value), MIN_DURATION), MAX_DURATION))
    if ("style" in o or "pace" in o) and "seed" not in o:
        o["seed"] = 0
    return o


def short_label(text: str, limit: int = 60) -> str:
    t = re.sub(r"\s+", " ", text).strip()
    return t if len(t) <= limit else t[: limit - 1].rstrip() + "…"


def actions_from_dicts(items: list[dict[str, Any]], shots: int) -> list[Action]:
    """Re-validate a plan that was shown to the user and confirmed (nothing the client sends is trusted as-is)."""
    style_ids = {st.id for st in list_styles()}
    rows = [{"action": d.get("kind"), "scope": d.get("scope"), "shot": d.get("shot"), "value": d.get("value"), "factor": d.get("factor"),
             "delta": d.get("delta"), "to": d.get("to")} for d in items if isinstance(d, dict)]  # fmt: skip
    acts, _ = parse_ai_actions({"actions": rows}, shots, style_ids)  # no request_text: the user has seen and approved these
    # parse_ai_actions drops invalid rows, so keep the original wording/source only for rows that survived, in order
    kept = iter(d for d in items if isinstance(d, dict))
    out: list[Action] = []
    for a in acts:
        for d in kept:
            if str(d.get("kind")) == a.kind:
                a.text = str(d.get("text", ""))[:200]
                a.source = "ai" if d.get("source") == "ai" else "rules"
                break
        out.append(a)
    return out


def _texts_after(a: Action, tl: Timeline, current: list) -> list | None:
    """The on-screen texts after a text action (None = nothing to change)."""
    from app.models.timeline import TextOverlay
    from app.video.overlays import tidy_text

    if a.kind == "text_off":
        return [] if current else None
    if a.kind == "text_less":
        keep = [o for o in current if o.role in ("hook", "cta")] or current[:1]
        return keep if len(keep) < len(current) else None
    text = tidy_text(str(a.value or ""))
    if not text:
        return None
    role = "cta" if a.kind == "cta" else "hook"
    others = [o for o in current if o.role != role]
    if role == "cta":
        new = TextOverlay(text=text, start=max(tl.duration - 2.2, 0.0), end=tl.duration, role="cta", position="center", animation="scale")
    else:
        new = TextOverlay(text=text, start=0.3, end=min(2.3, tl.duration), role="hook", animation="slide_up")
    return sorted([*others, new], key=lambda o: o.start)
