"""Render a legacy structured story bible into the markdown a bible document holds.

Used by migration 0002 to convert existing projects, and by project creation to
seed a new bible with the conventional headings.
"""

BIBLE_TEMPLATE = "## Characters\n\n## World\n\n## Style\n\n## Timeline\n"


def _bullets(items) -> list[str]:
    return [f"- {item}" for item in (items or [])]


def _characters(characters) -> list[str]:
    lines: list[str] = []
    for char in characters or []:
        lines.append(f"### {char.get('name') or 'Unnamed'}")
        traits = char.get("traits") or []
        if traits:
            lines += ["", "Traits:", *_bullets(traits)]
        examples = char.get("dialogue_examples") or []
        if examples:
            lines += ["", "Dialogue examples:", *[f'- "{e}"' for e in examples]]
        lines.append("")
    return lines


def _world(world) -> list[str]:
    lines: list[str] = []
    world = world or {}
    locations = world.get("locations") or []
    if locations:
        lines += ["", "Locations:", *_bullets(locations)]
    rules = world.get("rules") or []
    if rules:
        lines += ["", "Rules:", *_bullets(rules)]
    return lines


def _style(style) -> list[str]:
    lines: list[str] = []
    style = style or {}
    voice = (style.get("voice") or "").strip()
    if voice:
        lines += ["", f"Voice: {voice}"]
    avoid = style.get("avoid") or []
    if avoid:
        lines += ["", "Avoid:", *_bullets(avoid)]
    return lines


def _timeline(timeline) -> list[str]:
    bullets = _bullets(timeline)
    return ["", *bullets] if bullets else []


def render_bible_markdown(data: dict) -> str:
    """Convert a structured bible dict to markdown. Returns BIBLE_TEMPLATE when
    there is nothing to render, so a new or empty project still gets headings."""
    if not data:
        return BIBLE_TEMPLATE

    sections = [
        ("## Characters", _characters(data.get("characters"))),
        ("## World", _world(data.get("world"))),
        ("## Style", _style(data.get("style_guide"))),
        ("## Timeline", _timeline(data.get("timeline"))),
    ]

    lines: list[str] = []
    for heading, body in sections:
        lines.append(heading)
        lines += body
        lines.append("")

    return "\n".join(lines).rstrip() + "\n"
