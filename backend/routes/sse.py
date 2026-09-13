"""Server-sent event framing shared by the streaming routes."""

import json

#: `X-Accel-Buffering: no` tells a reverse proxy not to buffer the response,
#: which would otherwise hold the tokens back and deliver them in one lump.
SSE_HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}


def sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"
