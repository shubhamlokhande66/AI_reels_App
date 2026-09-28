"""Built-in editing styles."""

from app.styles.base import EditingStyle, register_style

FAST_TRENDING = register_style(
    EditingStyle(
        id="fast_trending",
        name="Fast Trending",
        description="Fast beat-synced cuts, punchy zooms and quick flashes.",
        cut_beats_high=2,
        cut_beats_low=4,
        min_segment=0.8,
        max_segment=3.5,
        transitions={"cut": 0.74, "flash": 0.05, "zoom": 0.09, "slide": 0.06, "speed_ramp": 0.06},
        transition_duration=0.15,
        max_transition_ratio=0.3,
        effects={"none": 0.3, "punch": 0.35, "zoom_in": 0.35},
        slow_motion_chance=0.0,
        motion_preference=0.9,
        fade_in_out=0.0,
        audio_fade_out=0.8,
        caption_style="bold",
    )
)

CINEMATIC = register_style(
    EditingStyle(
        id="cinematic",
        accent_hits=False,
        name="Cinematic",
        description="Longer shots, slow fades, subtle zoom and slow motion.",
        cut_beats_high=4,
        cut_beats_low=8,
        min_segment=1.6,
        max_segment=6.0,
        transitions={"cut": 0.15, "fade": 0.35, "dissolve": 0.45, "blur": 0.05},
        transition_duration=0.6,
        max_transition_ratio=0.9,
        effects={"zoom_in": 0.6, "zoom_out": 0.3, "none": 0.1},
        slow_motion_chance=0.35,
        slow_motion_speed=0.6,
        motion_preference=-0.2,
        opening="establishing",
        grade_filter="eq=contrast=1.08:saturation=0.92",
        fade_in_out=0.6,
        audio_fade_in=1.0,
        audio_fade_out=1.6,
        caption_style="minimal",
    )
)

LUXURY = register_style(
    EditingStyle(
        id="luxury",
        accent_hits=False,
        name="Luxury",
        description="Smooth transitions, elegant zoom, slow motion and premium pacing.",
        cut_beats_high=4,
        cut_beats_low=4,
        min_segment=1.2,
        max_segment=5.0,
        transitions={"cut": 0.2, "dissolve": 0.5, "fade": 0.2, "blur": 0.1},
        transition_duration=0.5,
        max_transition_ratio=0.85,
        effects={"zoom_in": 0.75, "zoom_out": 0.25},
        slow_motion_chance=0.5,
        slow_motion_speed=0.6,
        motion_preference=-0.5,
        closing="reveal",
        grade_filter="eq=contrast=1.06:saturation=0.85:brightness=-0.01",
        fade_in_out=0.5,
        audio_fade_in=0.8,
        audio_fade_out=1.6,
        caption_style="luxury",
    )
)

FOOD = register_style(
    EditingStyle(
        id="food",
        name="Food",
        description="Fast cuts on action, ending on a slow hero reveal of the finished dish.",
        cut_beats_high=2,
        cut_beats_low=4,
        min_segment=0.8,
        max_segment=3.5,
        transitions={"cut": 0.78, "flash": 0.04, "zoom": 0.10, "slide": 0.08},
        transition_duration=0.15,
        max_transition_ratio=0.3,
        effects={"none": 0.4, "punch": 0.3, "zoom_in": 0.3},
        slow_motion_chance=0.0,
        motion_preference=0.8,
        closing="reveal",
        grade_filter="eq=saturation=1.18:contrast=1.05",
        caption_style="bold",
    )
)

TRAVEL = register_style(
    EditingStyle(
        id="travel",
        name="Travel",
        description="Establishing shot first, landscape-friendly framing, motion transitions.",
        cut_beats_high=2,
        cut_beats_low=4,
        min_segment=0.9,
        max_segment=4.0,
        transitions={"cut": 0.4, "slide": 0.25, "zoom": 0.15, "dissolve": 0.15, "speed_ramp": 0.05},
        transition_duration=0.3,
        max_transition_ratio=0.65,
        effects={"zoom_in": 0.4, "zoom_out": 0.3, "none": 0.3},
        slow_motion_chance=0.15,
        slow_motion_speed=0.6,
        motion_preference=0.2,
        opening="establishing",
        prefer_landscape=True,
        grade_filter="eq=contrast=1.05:saturation=1.12",
        fade_in_out=0.3,
        caption_style="highlight",
    )
)

# "Custom" starts from balanced defaults; the API layer applies user-provided overrides.
CUSTOM = register_style(
    EditingStyle(
        id="custom",
        name="Custom",
        description="Start from balanced defaults and tune pacing, transitions and effects.",
        cut_beats_high=2,
        cut_beats_low=4,
        min_segment=0.6,
        max_segment=4.0,
        transitions={"cut": 0.6, "fade": 0.15, "dissolve": 0.15, "zoom": 0.1},
        transition_duration=0.25,
        effects={"none": 0.4, "zoom_in": 0.4, "punch": 0.2},
        motion_preference=0.3,
    )
)


MINIMAL = register_style(
    EditingStyle(
        id="minimal",
        accent_hits=False,
        name="Minimal",
        description="Plain cuts on the beat, no effects. Lets the footage speak.",
        cut_beats_high=4,
        cut_beats_low=4,
        min_segment=1.4,
        max_segment=5.0,
        transitions={"cut": 1.0},
        transition_duration=0.1,
        effects={"none": 1.0},
        slow_motion_chance=0.0,
        motion_preference=0.0,
        caption_style="minimal",
    )
)

STORYTELLING = register_style(
    EditingStyle(
        id="storytelling",
        accent_hits=False,
        name="Storytelling",
        description="An establishing opening, a steady journey, and a reveal at the end.",
        cut_beats_high=4,
        cut_beats_low=8,
        min_segment=1.4,
        max_segment=5.5,
        transitions={"cut": 0.45, "dissolve": 0.4, "fade": 0.15},
        transition_duration=0.4,
        max_transition_ratio=0.6,
        effects={"zoom_in": 0.4, "none": 0.6},
        slow_motion_chance=0.15,
        slow_motion_speed=0.7,
        motion_preference=0.0,
        opening="establishing",
        closing="reveal",
        fade_in_out=0.4,
        caption_style="highlight",
    )
)
