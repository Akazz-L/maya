"""How the story so far is written into a prompt.

One renderer, shared by the planner and the review passes, because the point of
this module's existence is that they stop phrasing the same facts differently.
The chat composes its own layers instead, since it caches each one separately.
"""


def story_so_far_text(state: dict) -> str:
    """The digest, the recent summaries, or — on a short project — the chapters.

    Chapters are named by title rather than numbered. A number counted from the
    start of a window names the wrong chapter as soon as the window slides.
    """
    prose = state.get("previous_prose") or []
    if prose:
        return "\n\n".join(f"{title}:\n{body}" for title, body in prose)

    parts = []
    if state.get("digest"):
        parts.append(f"THE STORY SO FAR:\n{state['digest']}")
    summaries = state.get("previous_summaries") or []
    if summaries:
        rendered = "\n\n".join(f"{title} — summary:\n{summary}" for title, summary in summaries)
        parts.append(f"RECENT CHAPTERS:\n{rendered}")
    return "\n\n".join(parts) if parts else "No previous chapters."
