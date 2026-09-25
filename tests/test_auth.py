"""Clerk session tokens, verified for real against a key generated here.

CLERK_JWT_KEY takes Clerk's JWKS fetch out of the path, so these run offline
while still going through the same verification the app uses in production.
"""

import time

import jwt
import pytest
import pytest_asyncio
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from httpx import ASGITransport, AsyncClient

ORIGIN = "http://localhost:5173"


def _keypair() -> tuple[str, str]:
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private = key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode()
    public = key.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
    ).decode()
    return private, public


SIGNING_KEY, PUBLIC_KEY = _keypair()
OTHER_SIGNING_KEY, _ = _keypair()


def session_token(
    sub: str = "user_real",
    azp: str = ORIGIN,
    expires_in: int = 60,
    key: str = SIGNING_KEY,
) -> str:
    now = int(time.time())
    claims = {"sub": sub, "azp": azp, "iat": now, "nbf": now, "exp": now + expires_in}
    return jwt.encode(claims, key, algorithm="RS256", headers={"kid": "ins_test"})


@pytest_asyncio.fixture
async def client(db, monkeypatch):
    monkeypatch.setenv("CLERK_JWT_KEY", PUBLIC_KEY)
    monkeypatch.setenv("CLERK_AUTHORIZED_PARTIES", ORIGIN)

    from backend.db import get_db
    from backend.main import app

    async def override_db():
        yield db

    app.dependency_overrides[get_db] = override_db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


async def _status(client, token: str) -> int:
    resp = await client.get("/projects", headers={"Authorization": f"Bearer {token}"})
    return resp.status_code


@pytest.mark.asyncio
async def test_a_valid_session_token_is_accepted(client):
    assert await _status(client, session_token()) == 200


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "token",
    [
        pytest.param(session_token(expires_in=-120), id="expired"),
        pytest.param(session_token(key=OTHER_SIGNING_KEY), id="wrong-signature"),
        pytest.param(session_token(azp="https://evil.example"), id="other-origin"),
        pytest.param("not-a-jwt", id="garbage"),
    ],
)
async def test_an_invalid_session_token_is_refused(client, token):
    assert await _status(client, token) == 401


@pytest.mark.asyncio
async def test_the_token_subject_decides_whose_projects_are_listed(client):
    mine = {"Authorization": f"Bearer {session_token(sub='user_a')}"}
    theirs = {"Authorization": f"Bearer {session_token(sub='user_b')}"}

    await client.post("/projects", json={"name": "A's novel"}, headers=mine)

    assert [p["name"] for p in (await client.get("/projects", headers=mine)).json()] == ["A's novel"]
    assert (await client.get("/projects", headers=theirs)).json() == []
