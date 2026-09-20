"""The Maya backend.

Loading `.env` happens here, before any submodule is imported, because several
agent modules construct their Anthropic client at import time and read the API
key from the environment as they do. Leaving that to `backend.settings` made the
key's availability depend on which submodule happened to be imported first: add
an import to `backend.main` that reaches an agent before settings, and every
generation fails at request time with "Could not resolve authentication method".
"""

from dotenv import load_dotenv

load_dotenv()
