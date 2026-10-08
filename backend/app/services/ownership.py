# backend/app/services/ownership.py
"""Who owns a file, decided by where it lives.

Every document is a user's upload, kept in PDF_DIRECTORY/users/<user_id>/. Because the
owner is a function of the path, clearing the index, rebuilding the manifest or
rescanning never changes who owns what. A file anywhere else belongs to nobody and is
never indexed.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

# The owner of documents from before every document was a user's: files put in the
# documents folder by hand, and everything indexed before accounts existed. The app hands
# them to the first admin (library_migration.py) and never gives a document this owner
# again; only an indexer built without accounts (unit tests) still does.
LIBRARY = "library"
USERS_DIRNAME = "users"

# The scope of an indexing run over every user's uploads.
EVERYONE = "all"

PUBLIC = "public"
PRIVATE = "private"


def users_root(documents_dir: Path) -> Path:
    return documents_dir / USERS_DIRNAME


def user_folder(documents_dir: Path, user_id: str) -> Path:
    return users_root(documents_dir) / user_id


def owner_for(path: Path, documents_dir: Path) -> str | None:
    """The owner of a file: a user id, or None when it belongs to nobody.

    Nobody owns a file outside users/, or one sitting directly in users/ rather than
    inside a user's folder.
    """
    try:
        relative = path.relative_to(users_root(documents_dir))
    except ValueError:
        return None
    return relative.parts[0] if len(relative.parts) >= 2 else None


def document_id_for(owner_id: str, file_hash: str) -> str:
    """Library documents keep the bare file hash, so no existing point is re-keyed.

    A user's document folds the owner in, so two users uploading the same file get two
    documents, and one deleting theirs never touches the other's.
    """
    if owner_id == LIBRARY:
        return file_hash
    return hashlib.sha256(f"user:{owner_id}:{file_hash}".encode()).hexdigest()


def within(path: Path, folder: Path) -> bool:
    """Whether `path` is `folder` or inside it, without touching the disk."""
    return path.is_relative_to(folder)


# Stands in for the user id of someone not logged in. Real ids are uuid4 hex, so no
# user can ever own a document under this one.
VISITOR = "-"


@dataclass(frozen=True)
class AccessScope:
    """What a search or a listing may see.

    user_id None is an admin, who sees everything. Otherwise `mode` narrows what the
    user can read: their own documents and public ones (all), only their own (mine), or
    only public ones (public).
    """

    user_id: str | None
    mode: Literal["all", "mine", "public"] = "all"

    @property
    def unrestricted(self) -> bool:
        return self.user_id is None

    @classmethod
    def visitor(cls) -> AccessScope:
        """Someone who is not logged in: public documents only."""
        return cls(user_id=VISITOR, mode="public")
