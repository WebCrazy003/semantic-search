# backend/app/services/passwords.py
"""Password hashing, the username and password rules, and generated secrets.

scrypt from the standard library rather than a bcrypt or argon2 wheel: the offline
release bundles every dependency by hand, and hashlib is already there.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import re
import secrets

# n=2**14, r=8 costs 16 MB and roughly 50 ms per hash on a laptop: slow enough to make
# guessing expensive, fast enough that logging in does not feel it.
_N, _R, _P, _DKLEN = 2**14, 8, 1, 32
_SALT_BYTES = 16
_PREFIX = "scrypt"

USERNAME_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{2,31}$")
RESERVED_USERNAMES = frozenset({"admin", "root", "system", "library"})
PASSWORD_MIN = 8
PASSWORD_MAX = 128

# No 0/O, 1/l/I: a generated password is read off a screen and typed by someone else.
_UNAMBIGUOUS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"


class PasswordRuleError(ValueError):
    """A username or password that breaks the rules. The message is shown to the user."""


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(_SALT_BYTES)
    digest = _scrypt(password, salt, _N, _R, _P, _DKLEN)
    return "$".join(
        [_PREFIX, str(_N), str(_R), str(_P), _b64(salt), _b64(digest)]
    )


def verify_password(password: str, stored: str) -> bool:
    try:
        prefix, n, r, p, salt, digest = stored.split("$")
        if prefix != _PREFIX:
            return False
        expected = _unb64(digest)
        actual = _scrypt(password, _unb64(salt), int(n), int(r), int(p), len(expected))
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(actual, expected)


def needs_rehash(stored: str) -> bool:
    """True when the hash was made with weaker parameters than today's."""
    try:
        _, n, r, p, _, _ = stored.split("$")
    except ValueError:
        return True
    return (int(n), int(r), int(p)) != (_N, _R, _P)


def username_key(username: str) -> str:
    return username.strip().lower()


def check_username(username: str) -> str:
    """The username to store, or PasswordRuleError saying what is wrong with it."""
    name = username.strip()
    if not USERNAME_PATTERN.fullmatch(name):
        raise PasswordRuleError(
            "A username is 3 to 32 English letters, digits, dots, dashes or underscores, "
            "starting with a letter or digit"
        )
    if username_key(name) in RESERVED_USERNAMES:
        raise PasswordRuleError("That username is reserved. Choose another")
    return name


def check_password(password: str, username: str | None = None) -> None:
    if len(password) < PASSWORD_MIN:
        raise PasswordRuleError(f"A password needs at least {PASSWORD_MIN} characters")
    if len(password) > PASSWORD_MAX:
        raise PasswordRuleError(f"A password can be at most {PASSWORD_MAX} characters")
    if username is not None and password.strip().lower() == username_key(username):
        raise PasswordRuleError("The password cannot be the same as the username")


def generate_password(length: int = 16) -> str:
    return "".join(secrets.choice(_UNAMBIGUOUS) for _ in range(length))


def new_token() -> str:
    return secrets.token_urlsafe(32)


def token_hash(token: str) -> str:
    """Tokens are long and random, so a plain SHA-256 is the right hash for them."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _scrypt(password: str, salt: bytes, n: int, r: int, p: int, dklen: int) -> bytes:
    return hashlib.scrypt(
        password.encode("utf-8"), salt=salt, n=n, r=r, p=p, dklen=dklen, maxmem=64 * 1024 * 1024
    )


def _b64(raw: bytes) -> str:
    return base64.b64encode(raw).decode("ascii")


def _unb64(text: str) -> bytes:
    return base64.b64decode(text.encode("ascii"))


# Checked against when a username does not exist, so an unknown name costs the same
# scrypt as a known one and response time does not reveal which accounts exist.
DUMMY_HASH = hash_password(secrets.token_urlsafe(16))
