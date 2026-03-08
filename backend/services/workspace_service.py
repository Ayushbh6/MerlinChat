import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from bson import ObjectId
from fastapi import HTTPException, UploadFile

from backend.db.database import workspace_files_collection, workspaces_collection
from backend.runtime.workspace_storage import workspace_storage


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _isoformat(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    return value


def _normalize_optional_text(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    return normalized or None


def parse_object_id(raw_id: str, resource_name: str) -> ObjectId:
    try:
        return ObjectId(raw_id)
    except Exception as exc:
        raise HTTPException(status_code=404, detail=f"{resource_name} not found") from exc


def sanitize_filename(filename: str | None) -> str:
    candidate = Path(filename or "file").name
    sanitized = re.sub(r"[^A-Za-z0-9._-]+", "_", candidate).strip("._")
    return sanitized or "file"


def serialize_workspace(doc: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(doc["_id"]),
        "title": doc["title"],
        "description": doc.get("description"),
        "subject_area": doc.get("subject_area"),
        "semester": doc.get("semester"),
        "created_at": _isoformat(doc["created_at"]),
        "updated_at": _isoformat(doc["updated_at"]),
    }


def serialize_workspace_file(doc: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(doc["_id"]),
        "workspace_id": doc["workspace_id"],
        "filename": doc["filename"],
        "stored_filename": doc["stored_filename"],
        "content_type": doc["content_type"],
        "size_bytes": doc["size_bytes"],
        "storage_backend": doc.get("storage_backend", "local"),
        "storage_path": doc["storage_path"],
        "status": doc["status"],
        "created_at": _isoformat(doc["created_at"]),
    }


async def get_workspace_or_404(workspace_id: str) -> dict[str, Any]:
    oid = parse_object_id(workspace_id, "workspace")
    workspace = await workspaces_collection.find_one({"_id": oid})
    if not workspace:
        raise HTTPException(status_code=404, detail="workspace not found")
    return workspace


async def list_workspace_files_docs(workspace_id: str) -> list[dict[str, Any]]:
    cursor = workspace_files_collection.find({"workspace_id": workspace_id}).sort(
        "created_at", 1
    )
    return await cursor.to_list(length=1000)


async def write_workspace_manifest(workspace: dict[str, Any]) -> dict[str, Any]:
    workspace_id = str(workspace["_id"])
    await workspace_storage.ensure_workspace(workspace_id)
    file_docs = await list_workspace_files_docs(workspace_id)

    manifest = {
        "workspace": serialize_workspace(workspace),
        "generated_at": utc_now().isoformat(),
        "paths": {
            "docs_dir": "/workspace/docs",
            "artifacts_dir": "/workspace/artifacts",
            "manifest_path": "/workspace/workspace_manifest.json",
        },
        "files": [],
    }

    for file_doc in file_docs:
        manifest["files"].append(
            {
                "id": str(file_doc["_id"]),
                "filename": file_doc["filename"],
                "stored_filename": file_doc["stored_filename"],
                "content_type": file_doc["content_type"],
                "size_bytes": file_doc["size_bytes"],
                "storage_backend": file_doc.get("storage_backend", "local"),
                "storage_path": file_doc["storage_path"],
                "agent_path": f"/workspace/docs/{file_doc['stored_filename']}",
                "extension": Path(file_doc["filename"]).suffix.lower(),
                "status": file_doc["status"],
            }
        )

    await workspace_storage.write_manifest(workspace_id, manifest)
    return manifest


async def create_workspace(payload: dict[str, Any]) -> dict[str, Any]:
    now = utc_now()
    workspace_doc = {
        "title": payload["title"].strip(),
        "description": _normalize_optional_text(payload.get("description")),
        "subject_area": _normalize_optional_text(payload.get("subject_area")),
        "semester": _normalize_optional_text(payload.get("semester")),
        "created_at": now,
        "updated_at": now,
    }
    result = await workspaces_collection.insert_one(workspace_doc)
    workspace_doc["_id"] = result.inserted_id
    await workspace_storage.ensure_workspace(str(result.inserted_id))
    await write_workspace_manifest(workspace_doc)
    return workspace_doc


async def store_workspace_file(
    workspace: dict[str, Any], upload: UploadFile
) -> dict[str, Any]:
    workspace_id = str(workspace["_id"])
    await workspace_storage.ensure_workspace(workspace_id)

    file_id = ObjectId()
    safe_name = sanitize_filename(upload.filename)
    stored_filename = f"{file_id}_{safe_name}"
    storage_result = await workspace_storage.save_upload(
        workspace_id, stored_filename, upload
    )

    file_doc = {
        "_id": file_id,
        "workspace_id": workspace_id,
        "filename": upload.filename or safe_name,
        "stored_filename": stored_filename,
        "content_type": upload.content_type or "application/octet-stream",
        "size_bytes": storage_result["size_bytes"],
        "storage_backend": storage_result["storage_backend"],
        "storage_path": storage_result["storage_path"],
        "storage_object_id": storage_result["storage_object_id"],
        "status": "ready",
        "created_at": utc_now(),
    }
    await workspace_files_collection.insert_one(file_doc)

    updated_at = utc_now()
    workspace["updated_at"] = updated_at
    await workspaces_collection.update_one(
        {"_id": workspace["_id"]}, {"$set": {"updated_at": updated_at}}
    )

    return file_doc


async def create_workspace_text_file(
    workspace: dict[str, Any],
    *,
    title: str,
    body: str,
) -> dict[str, Any]:
    normalized_title = title.strip()
    if not normalized_title:
        raise HTTPException(status_code=400, detail="title is required")

    workspace_id = str(workspace["_id"])
    await workspace_storage.ensure_workspace(workspace_id)

    file_id = ObjectId()
    safe_name = sanitize_filename(normalized_title)
    if "." not in safe_name:
        safe_name = f"{safe_name}.md"
    stored_filename = f"{file_id}_{safe_name}"
    content = body.strip()
    storage_result = await workspace_storage.save_bytes(
        workspace_id,
        stored_filename,
        content.encode("utf-8"),
        content_type="text/markdown; charset=utf-8",
    )

    file_doc = {
        "_id": file_id,
        "workspace_id": workspace_id,
        "filename": safe_name,
        "stored_filename": stored_filename,
        "content_type": "text/markdown",
        "size_bytes": storage_result["size_bytes"],
        "storage_backend": storage_result["storage_backend"],
        "storage_path": storage_result["storage_path"],
        "storage_object_id": storage_result["storage_object_id"],
        "status": "ready",
        "created_at": utc_now(),
    }
    await workspace_files_collection.insert_one(file_doc)

    updated_at = utc_now()
    workspace["updated_at"] = updated_at
    await workspaces_collection.update_one(
        {"_id": workspace["_id"]}, {"$set": {"updated_at": updated_at}}
    )

    return file_doc

async def delete_workspace_file(workspace: dict[str, Any], file_id: str) -> None:
    workspace_id = str(workspace["_id"])
    fid = parse_object_id(file_id, "file")
    
    file_doc = await workspace_files_collection.find_one({
        "_id": fid,
        "workspace_id": workspace_id
    })
    
    if not file_doc:
        raise HTTPException(status_code=404, detail="file not found")
        
    await workspace_storage.delete_file(file_doc)
    await workspace_files_collection.delete_one({"_id": fid})
    
    updated_at = utc_now()
    workspace["updated_at"] = updated_at
    await workspaces_collection.update_one(
        {"_id": workspace["_id"]}, {"$set": {"updated_at": updated_at}}
    )
    await write_workspace_manifest(workspace)
