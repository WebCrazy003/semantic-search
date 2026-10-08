# backend/app/api/drive.py
"""The document manager: folders kept in the database, files moved between them, and
indexing asked for by hand (2026-10-08 spec §3.5).

Everyone works in their own tree ("me"). An admin may also open the library's tree and
any user's. A move never touches the disk, the index or Qdrant: it changes which folder
a row points at, so it is instant and allowed while indexing runs.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from datetime import UTC, datetime
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Response

from app.api.guards import remove_document
from app.auth import active_user
from app.deps import Container, get_container
from app.logging_config import get_logger
from app.models.request_models import (
    CreateFolderRequest,
    DriveDeleteRequest,
    DriveIndexRequest,
    DriveMoveRequest,
    RenameFolderRequest,
)
from app.models.response_models import (
    DriveCrumb,
    DriveFileView,
    DriveFolderView,
    DriveIndexResponse,
    DriveListing,
    DriveTree,
)
from app.services.access_store import User
from app.services.drive_service import FileState
from app.services.drive_store import DriveError, DriveFile, Folder, NameTakenError
from app.services.extractors import file_type_for
from app.services.manifest_service import DocumentRecord
from app.services.ownership import LIBRARY, user_folder, within

logger = get_logger("api.drive")
router = APIRouter(tags=["drive"])


def resolve_tree(container: Container, user: User, tree: str) -> str:
    """The tree a request names, if the caller may open it. 403 otherwise."""
    if tree in ("me", user.user_id):
        return user.user_id
    if user.is_admin and (tree == LIBRARY or container.access.get_user(tree) is not None):
        return tree
    raise HTTPException(status_code=403, detail="You can only open your own documents")


def _refused(error: DriveError) -> HTTPException:
    return HTTPException(
        status_code=409 if isinstance(error, NameTakenError) else 400, detail=str(error)
    )


@router.get("/drive/tree", response_model=DriveTree)
def drive_tree(
    tree: str = Query(default="me"),
    user: User = Depends(active_user),
    container: Container = Depends(get_container),
) -> DriveTree:
    """Every folder in the tree, nested, with how many files sit directly in each."""
    owner = resolve_tree(container, user, tree)
    files = container.drive.sync(owner)
    counts = Counter(file.folder_id for file in files)
    children: defaultdict[str | None, list[Folder]] = defaultdict(list)
    for folder in container.drive.store.folders(owner):
        children[folder.parent_id].append(folder)
    return DriveTree(
        tree=owner, folders=_nest(children, counts, None), root_file_count=counts[None]
    )


@router.get("/drive/list", response_model=DriveListing)
def drive_list(
    tree: str = Query(default="me"),
    folder_id: str | None = Query(default=None),
    user: User = Depends(active_user),
    container: Container = Depends(get_container),
) -> DriveListing:
    """The folders and files directly in one folder, each file with its indexing state."""
    owner = resolve_tree(container, user, tree)
    store = container.drive.store
    try:
        store.folder_in(owner, folder_id)
    except DriveError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error

    files = container.drive.sync(owner)
    states = container.drive.states(owner, files)
    folders = store.folders(owner)
    here = [file for file in files if file.folder_id == folder_id]
    counts = Counter(file.folder_id for file in files)
    external = _external_roots(container)
    return DriveListing(
        tree=owner,
        folder_id=folder_id,
        breadcrumb=[
            DriveCrumb(folder_id=f.folder_id, name=f.name) for f in store.ancestors(folder_id)
        ],
        folders=[
            DriveFolderView(
                folder_id=folder.folder_id,
                name=folder.name,
                parent_id=folder.parent_id,
                file_count=counts[folder.folder_id],
            )
            for folder in folders
            if folder.parent_id == folder_id
        ],
        files=sorted(
            (_file_view(states[file.file_id], external) for file in here),
            key=lambda view: view.name.casefold(),
        ),
        not_indexed=sum(1 for state in states.values() if state.state == "not_indexed"),
    )


@router.post("/drive/folders", response_model=DriveFolderView, status_code=201)
def create_folder(
    body: CreateFolderRequest,
    user: User = Depends(active_user),
    container: Container = Depends(get_container),
) -> DriveFolderView:
    owner = resolve_tree(container, user, body.tree)
    try:
        folder = container.drive.store.create_folder(owner, body.parent_id, body.name)
    except DriveError as error:
        raise _refused(error) from error
    return DriveFolderView(folder_id=folder.folder_id, name=folder.name, parent_id=folder.parent_id)


@router.patch("/drive/folders/{folder_id}", response_model=DriveFolderView)
def rename_folder(
    folder_id: str,
    body: RenameFolderRequest,
    user: User = Depends(active_user),
    container: Container = Depends(get_container),
) -> DriveFolderView:
    folder = _own_folder(container, user, folder_id)
    try:
        renamed = container.drive.store.rename_folder(folder.folder_id, body.name)
    except DriveError as error:
        raise _refused(error) from error
    return DriveFolderView(
        folder_id=renamed.folder_id, name=renamed.name, parent_id=renamed.parent_id
    )


@router.delete("/drive/folders/{folder_id}", status_code=204)
def delete_folder(
    folder_id: str,
    user: User = Depends(active_user),
    container: Container = Depends(get_container),
) -> Response:
    """The folder, the folders in it and their documents. A user's uploads are deleted
    from disk, as deleting a document does; library files are only unindexed."""
    folder = _own_folder(container, user, folder_id)
    store = container.drive.store
    files = store.files_under(folder.folder_id)
    by_path = container.drive.records_by_path()
    if container.indexing.is_running or container.drive.busy(folder.tree, files, by_path):
        raise HTTPException(
            status_code=409, detail="Wait until indexing finishes, then delete the folder"
        )
    _purge(container, folder.tree, files, by_path)
    # Library files stay on disk; without their folder they go back to the top.
    store.forget_many([file.path for file in files])
    store.delete_folder(folder.folder_id)
    logger.info("%s deleted folder %s with %d file(s)", user.username, folder.name, len(files))
    return Response(status_code=204)


@router.post("/drive/files/delete", status_code=204)
def delete_files(
    body: DriveDeleteRequest,
    user: User = Depends(active_user),
    container: Container = Depends(get_container),
) -> Response:
    """Delete files, indexed or not. A user's uploads are deleted from disk; library
    files are only unindexed, as deleting a document always does."""
    owner = resolve_tree(container, user, body.tree)
    try:
        files = container.drive.store.files_by_id(owner, body.file_ids)
    except DriveError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    by_path = container.drive.records_by_path()
    if container.indexing.is_running or container.drive.busy(owner, files, by_path):
        raise HTTPException(status_code=409, detail="Wait until indexing finishes, then delete")
    _purge(container, owner, files, by_path)
    if owner != LIBRARY:
        container.drive.store.forget_many([file.path for file in files])
    logger.info("%s deleted %d file(s)", user.username, len(files))
    return Response(status_code=204)


@router.post("/drive/move", status_code=204)
def move(
    body: DriveMoveRequest,
    user: User = Depends(active_user),
    container: Container = Depends(get_container),
) -> Response:
    """Move files and folders within one tree. Rows only: nothing on disk changes."""
    owner = resolve_tree(container, user, body.tree)
    store = container.drive.store
    try:
        if body.folder_ids:
            store.move_folders(owner, body.folder_ids, body.to)
        if body.file_ids:
            store.move_files(owner, body.file_ids, body.to)
    except DriveError as error:
        # A folder or file that is not in this tree is someone else's: not here.
        raise _refused(error) from error
    return Response(status_code=204)


@router.post("/drive/index", response_model=DriveIndexResponse, status_code=202)
def index_files(
    body: DriveIndexRequest,
    background_tasks: BackgroundTasks,
    user: User = Depends(active_user),
    container: Container = Depends(get_container),
) -> DriveIndexResponse:
    """Index these files, or every file in the tree that is not indexed yet.

    Only the files named are processed, and the run does not sweep, so indexing one
    file never unindexes any other.
    """
    owner = resolve_tree(container, user, body.tree)
    if body.file_ids is None:
        chosen = container.drive.not_indexed(owner)
    else:
        container.drive.sync(owner)
        try:
            chosen = container.drive.store.files_by_id(owner, body.file_ids)
        except DriveError as error:
            raise HTTPException(status_code=404, detail=str(error)) from error
    if not chosen:
        return DriveIndexResponse(status="nothing")
    outcome = container.drive.request_index(
        owner, [file.path for file in chosen], user.user_id, force=body.force, trigger="manual"
    )
    if outcome == "started":
        background_tasks.add_task(container.indexing.drain)
    return DriveIndexResponse(status=outcome, files=len(chosen))


# ------------------------------------------------------------------ helpers


def _own_folder(container: Container, user: User, folder_id: str) -> Folder:
    folder = container.drive.store.folder(folder_id)
    if folder is None:
        raise HTTPException(status_code=404, detail="No such folder")
    if folder.tree != user.user_id and not user.is_admin:
        # Someone else's folder does not exist for you.
        raise HTTPException(status_code=404, detail="No such folder")
    return folder


def _nest(
    children: dict[str | None, list[Folder]], counts: Counter[str | None], parent: str | None
) -> list[DriveFolderView]:
    return [
        DriveFolderView(
            folder_id=folder.folder_id,
            name=folder.name,
            parent_id=folder.parent_id,
            file_count=counts[folder.folder_id],
            folders=_nest(children, counts, folder.folder_id),
        )
        for folder in children.get(parent, [])
    ]


def _external_roots(container: Container) -> list[Path]:
    documents = container.settings.pdf_directory.resolve()
    roots = (Path(folder.path).resolve() for folder in container.manifest.folders())
    return [root for root in roots if not within(root, documents)]


def _file_view(state: FileState, external: list[Path]) -> DriveFileView:
    file, record = state.file, state.record
    path = Path(file.path)
    size, modified = (record.file_size, record.modified_at) if record else _on_disk(path)
    file_type = file_type_for(file.name)
    return DriveFileView(
        file_id=file.file_id,
        name=file.name,
        folder_id=file.folder_id,
        file_type=file_type,
        size=size,
        modified_at=modified,
        state=state.state,
        error=state.error,
        document_id=record.document_id if record else None,
        pages=record.pages if record else None,
        pages_approximate=file_type == "docx",
        chunks=record.chunks if record else None,
        visibility=record.visibility if record else None,
        external=bool(external) and any(within(path, root) for root in external),
    )


def _on_disk(path: Path) -> tuple[int, datetime | None]:
    """Size and modification time of a file that has no index record yet."""
    try:
        stat = path.stat()
    except OSError:
        return 0, None
    return stat.st_size, datetime.fromtimestamp(stat.st_mtime, tz=UTC)


def _purge(
    container: Container,
    tree: str,
    files: list[DriveFile],
    by_path: dict[str, DocumentRecord],
) -> None:
    """Take files out of search and, for a user's uploads, off the disk.

    A file whose content another of the owner's files shares is one copy of a document
    that stays: only that copy goes, and the document is pointed at the other one.
    """
    for file in files:
        record = by_path.get(file.path)
        if record is None:
            if tree != LIBRARY:
                _delete_upload(container, tree, file.path)
        elif tree != LIBRARY and len(record.known_paths) > 1:
            _delete_upload(container, tree, file.path)
            _forget_copy(container, record, file.path)
        else:
            remove_document(container, record)


def _forget_copy(container: Container, record: DocumentRecord, path: str) -> None:
    others = [known for known in record.known_paths if known != path]
    record.alt_filepaths = others[1:]
    if record.filepath == path:
        record.filepath = others[0]
        record.filename = Path(others[0]).name
        container.qdrant.set_location(record.document_id, record.filepath, record.filename)
    container.manifest.upsert(record)


def _delete_upload(container: Container, tree: str, path: str) -> None:
    """An upload that was never indexed: delete the file, only inside its owner's folder."""
    folder = user_folder(container.settings.pdf_directory, tree).resolve()
    target = Path(path).resolve()
    if within(target, folder) and target.is_file():
        target.unlink()
