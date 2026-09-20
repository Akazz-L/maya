"""The API key must not depend on which module is imported first.

Several agent modules build their Anthropic client at import time, reading the
key from the environment as they do. `.env` is therefore loaded by the `backend`
package itself. Without that, importing an agent before `backend.settings` — one
added import in `backend.main` is enough — leaves the client keyless, and every
generation fails at request time rather than at startup.
"""

import pathlib
import subprocess
import sys
import textwrap

ROOT = pathlib.Path(__file__).resolve().parent.parent

# The agent module a bare import is most likely to reach first, since both the
# chat endpoint and every reviewer go through it.
PROBE = textwrap.dedent(
    """
    from backend.agents.chat import client
    assert client.api_key == "sk-ant-from-dotenv", client.api_key
    print("ok")
    """
)


def test_importing_an_agent_first_still_finds_the_key(tmp_path):
    (tmp_path / ".env").write_text("ANTHROPIC_API_KEY=sk-ant-from-dotenv\nJWT_SECRET=x\n")
    result = subprocess.run(
        [sys.executable, "-c", PROBE],
        cwd=tmp_path,  # load_dotenv() searches from the working directory
        # A key already in this process's environment would mask the bug.
        env={"PATH": "/usr/bin:/bin", "PYTHONPATH": str(ROOT)},
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    assert "ok" in result.stdout
