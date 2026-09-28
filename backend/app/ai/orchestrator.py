"""AI orchestrator: decides the *minimum* set of specialist agents a request needs.

Agents (each is a small service that returns validated JSON, never executes anything):
  video_analyst     understands what is in each clip            (vision model)
  audio_analyst     tempo, beats, energy, drops                 (signal processing, no LLM)
  story_planner     narrative structure and clip roles          (LLM)
  script_writer     hooks and voice-over script                 (LLM; the human edits and approves it)
  voice_planner     voice profile, timing, ducking              (rules + TTS)
  clip_selector     scores and orders shots                     (rules, uses the story hint)
  caption_generator captions from speech, lyrics or the script  (ASR / script)
  style_director    picks the editing style                     (LLM or heuristic)
  quality_checker   timeline + file checks, auto-fix            (rules)
  reel_optimizer    platform limits and format fit              (rules)
"""

from __future__ import annotations

from dataclasses import dataclass

AGENTS = (
    "video_analyst", "audio_analyst", "story_planner", "script_writer", "voice_planner", "clip_selector",
    "caption_generator", "style_director", "quality_checker", "reel_optimizer",
)  # fmt: skip
LLM_AGENTS = {"story_planner", "script_writer", "style_director"}
HUMAN_APPROVED = {"script_writer", "voice_planner"}  # never run silently: the user reviews the script first


@dataclass(frozen=True)
class AgentPlan:
    run: tuple[str, ...]  # executed automatically, in order
    pending_human: tuple[str, ...]  # need the user's approval before running
    skipped: dict[str, str]  # agent -> why it was not needed


def plan_agents(
    *, ai_on: bool, style_auto: bool, has_brief: bool, semantic_ready: bool, audio_mode: str, captions: bool,
    over_platform_limit: bool = False,
) -> AgentPlan:
    """Minimum agents for the request. With AI off nothing that needs an LLM is run."""
    run = ["audio_analyst", "video_analyst"] if not ai_on else ["audio_analyst", "video_analyst"]
    skipped: dict[str, str] = {}
    pending: list[str] = []

    if ai_on and has_brief and semantic_ready:
        run.append("story_planner")
    else:
        skipped["story_planner"] = ("AI assist is off" if not ai_on else
                                    "no brief was given" if not has_brief else "clips have not been understood yet")
    run.append("clip_selector")
    if ai_on and style_auto:
        run.append("style_director")
    else:
        skipped["style_director"] = "the style was chosen by the user" if not style_auto else "AI assist is off (a tempo/motion heuristic is used)"
    if captions:
        run.append("caption_generator")
    else:
        skipped["caption_generator"] = "captions are off"
    if audio_mode in ("voice", "voice_music"):
        pending += ["script_writer", "voice_planner"]
    else:
        skipped["script_writer"] = skipped["voice_planner"] = "this mode has no voice-over"
    if over_platform_limit:
        run.append("reel_optimizer")
    else:
        skipped["reel_optimizer"] = "the Reel fits the platform"
    run.append("quality_checker")
    return AgentPlan(tuple(run), tuple(pending), skipped)
