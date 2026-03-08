import json
import os
import shutil
from pathlib import Path
from typing import Any

from bson import ObjectId
from fastapi import UploadFile

from backend.db.database import db, gridfs_bucket

ROOT_DIR = Path(__file__).resolve().parent.parent.parent
DEFAULT_STORAGE_ROOT = ROOT_DIR / "storage" / "workspaces"
STORAGE_BACKEND = os.environ.get("WORKSPACE_STORAGE_BACKEND", "local").strip().lower()
STORAGE_ROOT_RAW = Path(
    os.environ.get("WORKSPACE_STORAGE_ROOT", str(DEFAULT_STORAGE_ROOT))
).expanduser()
STORAGE_ROOT = (
    STORAGE_ROOT_RAW
    if STORAGE_ROOT_RAW.is_absolute()
    else (ROOT_DIR / STORAGE_ROOT_RAW).resolve()
)
GRIDFS_BUCKET_NAME = os.environ.get("GRIDFS_BUCKET_NAME", "workspace_files_fs")
UPLOAD_CHUNK_SIZE = 1024 * 1024
MANIFEST_FILENAME = "workspace_manifest.json"


class WorkspaceStorageBackend:
    provider_name = "base"

    async def ensure_workspace(self, workspace_id: str) -> None:
        raise NotImplementedError

    async def save_upload(
        self,
        workspace_id: str,
        stored_filename: str,
        upload: UploadFile,
    ) -> dict[str, Any]:
        raise NotImplementedError

    async def write_manifest(self, workspace_id: str, manifest: dict[str, Any]) -> None:
        raise NotImplementedError

    async def materialize_file(
        self, file_doc: dict[str, Any], destination_path: Path
    ) -> None:
        raise NotImplementedError

    async def read_file_bytes(self, file_doc: dict[str, Any]) -> bytes:
        raise NotImplementedError

    async def save_bytes(
        self,
        workspace_id: str,
        stored_filename: str,
        data: bytes,
        *,
        content_type: str,
    ) -> dict[str, Any]:
        raise NotImplementedError

    async def delete_file(self, file_doc: dict[str, Any]) -> None:
        raise NotImplementedError


class LocalWorkspaceStorage(WorkspaceStorageBackend):
    provider_name = "local"

    def __init__(self, root: Path):
        self.root = root

    def _workspace_root(self, workspace_id: str) -> Path:
        return self.root / workspace_id

    def _docs_dir(self, workspace_id: str) -> Path:
        return self._workspace_root(workspace_id) / "docs"

    def _artifacts_dir(self, workspace_id: str) -> Path:
        return self._workspace_root(workspace_id) / "artifacts"

    def _manifest_path(self, workspace_id: str) -> Path:
        return self._workspace_root(workspace_id) / MANIFEST_FILENAME

    async def ensure_workspace(self, workspace_id: str) -> None:
        self._docs_dir(workspace_id).mkdir(parents=True, exist_ok=True)
        self._artifacts_dir(workspace_id).mkdir(parents=True, exist_ok=True)

    async def save_upload(
        self,
        workspace_id: str,
        stored_filename: str,
        upload: UploadFile,
    ) -> dict[str, Any]:
        await self.ensure_workspace(workspace_id)
        destination = self._docs_dir(workspace_id) / stored_filename
        size_bytes = 0

        with destination.open("wb") as output_file:
            while True:
                chunk = await upload.read(UPLOAD_CHUNK_SIZE)
                if not chunk:
                    break
                size_bytes += len(chunk)
                output_file.write(chunk)

        await upload.close()
        return {
            "storage_backend": self.provider_name,
            "storage_path": f"workspaces/{workspace_id}/docs/{stored_filename}",
            "storage_object_id": None,
            "size_bytes": size_bytes,
        }

    async def save_bytes(
        self,
        workspace_id: str,
        stored_filename: str,
        data: bytes,
        *,
        content_type: str,
    ) -> dict[str, Any]:
        await self.ensure_workspace(workspace_id)
        destination = self._docs_dir(workspace_id) / stored_filename
        destination.write_bytes(data)
        return {
            "storage_backend": self.provider_name,
            "storage_path": f"workspaces/{workspace_id}/docs/{stored_filename}",
            "storage_object_id": None,
            "size_bytes": len(data),
        }

    async def write_manifest(self, workspace_id: str, manifest: dict[str, Any]) -> None:
        await self.ensure_workspace(workspace_id)
        self._manifest_path(workspace_id).write_text(
            json.dumps(manifest, indent=2), encoding="utf-8"
        )

    async def materialize_file(
        self, file_doc: dict[str, Any], destination_path: Path
    ) -> None:
        destination_path.parent.mkdir(parents=True, exist_ok=True)
        source_path = (
            self._docs_dir(file_doc["workspace_id"]) / file_doc["stored_filename"]
        ).resolve()
        shutil.copy2(source_path, destination_path)

    async def read_file_bytes(self, file_doc: dict[str, Any]) -> bytes:
        source_path = (
            self._docs_dir(file_doc["workspace_id"]) / file_doc["stored_filename"]
        ).resolve()
        return source_path.read_bytes()

    async def delete_file(self, file_doc: dict[str, Any]) -> None:
        source_path = (
            self._docs_dir(file_doc["workspace_id"]) / file_doc["stored_filename"]
        ).resolve()
        if source_path.exists():
            source_path.unlink()

class GridFSWorkspaceStorage(WorkspaceStorageBackend):
    provider_name = "gridfs"

    def __init__(self, bucket_name: str):
        self.bucket_name = bucket_name
        self.files_collection = db.get_collection(f"{bucket_name}.files")

    async def ensure_workspace(self, workspace_id: str) -> None:
        return None

    async def save_upload(
        self,
        workspace_id: str,
        stored_filename: str,
        upload: UploadFile,
    ) -> dict[str, Any]:
        data = await upload.read()
        await upload.close()
        metadata = {
            "workspace_id": workspace_id,
            "stored_filename": stored_filename,
            "kind": "workspace_file",
            "content_type": upload.content_type or "application/octet-stream",
        }
        blob_id = await gridfs_bucket.upload_from_stream(
            stored_filename, data, metadata=metadata
        )
        return {
            "storage_backend": self.provider_name,
            "storage_path": f"gridfs://{self.bucket_name}/{blob_id}",
            "storage_object_id": str(blob_id),
            "size_bytes": len(data),
        }

    async def save_bytes(
        self,
        workspace_id: str,
        stored_filename: str,
        data: bytes,
        *,
        content_type: str,
    ) -> dict[str, Any]:
        metadata = {
            "workspace_id": workspace_id,
            "stored_filename": stored_filename,
            "kind": "workspace_file",
            "content_type": content_type,
        }
        blob_id = await gridfs_bucket.upload_from_stream(
            stored_filename, data, metadata=metadata
        )
        return {
            "storage_backend": self.provider_name,
            "storage_path": f"gridfs://{self.bucket_name}/{blob_id}",
            "storage_object_id": str(blob_id),
            "size_bytes": len(data),
        }

    async def write_manifest(self, workspace_id: str, manifest: dict[str, Any]) -> None:
        cursor = self.files_collection.find(
            {"metadata.workspace_id": workspace_id, "metadata.kind": "workspace_manifest"}
        )
        existing = await cursor.to_list(length=100)
        for item in existing:
            await gridfs_bucket.delete(item["_id"])

        payload = json.dumps(manifest, indent=2).encode("utf-8")
        metadata = {
            "workspace_id": workspace_id,
            "kind": "workspace_manifest",
            "content_type": "application/json",
        }
        await gridfs_bucket.upload_from_stream(
            MANIFEST_FILENAME, payload, metadata=metadata
        )

    async def materialize_file(
        self, file_doc: dict[str, Any], destination_path: Path
    ) -> None:
        destination_path.parent.mkdir(parents=True, exist_ok=True)
        storage_object_id = file_doc.get("storage_object_id")
        if not storage_object_id:
            raise ValueError("gridfs file is missing storage_object_id")
        blob_id = ObjectId(storage_object_id)
        download_stream = await gridfs_bucket.open_download_stream(blob_id)
        data = await download_stream.read()
        destination_path.write_bytes(data)

    async def read_file_bytes(self, file_doc: dict[str, Any]) -> bytes:
        storage_object_id = file_doc.get("storage_object_id")
        if not storage_object_id:
            raise ValueError("gridfs file is missing storage_object_id")
        blob_id = ObjectId(storage_object_id)
        download_stream = await gridfs_bucket.open_download_stream(blob_id)
        return await download_stream.read()

    async def delete_file(self, file_doc: dict[str, Any]) -> None:
        storage_object_id = file_doc.get("storage_object_id")
        if not storage_object_id:
            return
        blob_id = ObjectId(storage_object_id)
        try:
            await gridfs_bucket.delete(blob_id)
        except Exception:
            pass


def get_workspace_storage_backend() -> WorkspaceStorageBackend:
    if STORAGE_BACKEND == "gridfs":
        return GridFSWorkspaceStorage(GRIDFS_BUCKET_NAME)
    if STORAGE_BACKEND == "local":
        return LocalWorkspaceStorage(STORAGE_ROOT)
    raise ValueError(
        "Unsupported WORKSPACE_STORAGE_BACKEND. Use 'local' or 'gridfs'."
    )


workspace_storage = get_workspace_storage_backend()
