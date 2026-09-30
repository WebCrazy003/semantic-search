# scripts/reset_admin.py
"""Get back into DocSage when no administrator can log in.

    python scripts/reset_admin.py <username>

Gives <username> a new temporary password, makes it an active administrator, and
prints the password; it must be changed at the next login. If there is no such account
it is created. Needs access to this computer's files, which is the point: it is the way
back in for a sole administrator who forgot their password, since nobody else can
approve their reset request.

Safe to run while the app is running.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app.config import get_settings  # noqa: E402
from app.services.access_store import AccessStore  # noqa: E402
from app.services.passwords import (  # noqa: E402
    PasswordRuleError,
    check_username,
    generate_password,
    hash_password,
)


def reset_admin(store: AccessStore, username: str) -> tuple[str, bool]:
    """Returns (temporary password, whether the account was created)."""
    password = generate_password()
    user = store.find_user(username)
    if user is None:
        store.create_user(
            check_username(username),
            hash_password(password),
            role="admin",
            must_change_password=True,
        )
        return password, True
    store.update_user(user.user_id, role="admin", disabled=False)
    store.set_password(user.user_id, hash_password(password), must_change=True)
    store.supersede_reset_requests(user.user_id)
    store.revoke_sessions(user.user_id)
    return password, False


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: python scripts/reset_admin.py <username>")
        return 2
    settings = get_settings()
    store = AccessStore(settings.access_db_path)
    store.initialise()
    try:
        password, created = reset_admin(store, argv[1])
    except PasswordRuleError as exc:
        print(f"FAIL  {exc}")
        return 1
    finally:
        store.close()
    print(f"OK    {'created' if created else 'reset'} administrator {argv[1]}")
    print(f"      temporary password: {password}")
    print("      it must be changed at the next login")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
