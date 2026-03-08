import asyncio
from datetime import datetime, timezone
import json
import mimetypes
import shutil
import sys
import textwrap
from pathlib import Path
from time import perf_counter
from typing import Any

from fastapi import HTTPException

from backend.core.constants import (
    MAX_ARTIFACTS_PER_STEP,
    MAX_CODE_CHARS,
    MAX_RUN_STEPS,
    MAX_STDERR_BYTES,
    MAX_STDOUT_BYTES,
    MAX_STEP_EXECUTION_SECONDS,
    MAX_TOTAL_RUN_SECONDS,
    RUNNER_MEMORY_LIMIT_MB,
)
from backend.services.run_service import get_run_or_404, list_run_steps
from backend.services.workspace_service import (
    get_workspace_or_404,
    list_workspace_files_docs,
    write_workspace_manifest,
)
from backend.runtime.workspace_storage import ROOT_DIR, workspace_storage

RUNNER_ROOT = ROOT_DIR / "storage" / "run_sandboxes"
BOOTSTRAP_FILENAME = "_agent_bootstrap.py"
USER_CODE_FILENAME = "_agent_step.py"
TIMEOUT_EXIT_CODE = 124
ALLOWED_IMPORT_ROOTS = {
    "collections",
    "csv",
    "datetime",
    "functools",
    "io",
    "itertools",
    "json",
    "math",
    "numpy",
    "operator",
    "pandas",
    "pathlib",
    "PIL",
    "pptx",
    "pypdf",
    "re",
    "statistics",
    "textwrap",
}
BLOCKED_IMPORT_ROOTS = {
    "asyncio",
    "builtins",
    "ctypes",
    "http",
    "importlib",
    "multiprocessing",
    "os",
    "requests",
    "shlex",
    "shutil",
    "signal",
    "socket",
    "subprocess",
    "sys",
    "tempfile",
    "urllib",
    "webbrowser",
}


def _truncate_output(value: str, max_bytes: int) -> str:
    encoded = value.encode("utf-8", errors="replace")
    if len(encoded) <= max_bytes:
        return value
    trimmed = encoded[-max_bytes:]
    return trimmed.decode("utf-8", errors="replace")


def _artifact_metadata(artifact_path: Path, artifacts_root: Path) -> dict[str, Any]:
    relative_path = artifact_path.relative_to(artifacts_root).as_posix()
    content_type = mimetypes.guess_type(artifact_path.name)[0] or "application/octet-stream"
    return {
        "name": artifact_path.name,
        "relative_path": relative_path,
        "path": str(artifact_path),
        "agent_path": f"/workspace/artifacts/{relative_path}",
        "runtime_path": str(artifact_path),
        "size_bytes": artifact_path.stat().st_size,
        "content_type": content_type,
    }


def _collect_artifacts(artifacts_root: Path) -> list[dict[str, Any]]:
    if not artifacts_root.exists():
        return []

    artifacts: list[dict[str, Any]] = []
    for path in sorted(artifacts_root.rglob("*")):
        if not path.is_file():
            continue
        artifacts.append(_artifact_metadata(path, artifacts_root))
        if len(artifacts) >= MAX_ARTIFACTS_PER_STEP:
            break
    return artifacts


def _validate_imports(code: str) -> None:
    import ast

    try:
        tree = ast.parse(code)
    except SyntaxError as exc:
        raise HTTPException(status_code=400, detail=f"invalid python syntax: {exc}") from exc

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                root = alias.name.split(".")[0]
                if root in BLOCKED_IMPORT_ROOTS or root not in ALLOWED_IMPORT_ROOTS:
                    raise HTTPException(
                        status_code=400,
                        detail=f"import '{root}' is not allowed in the sandbox",
                    )
        elif isinstance(node, ast.ImportFrom):
            if node.module is None:
                raise HTTPException(status_code=400, detail="relative imports are not allowed")
            root = node.module.split(".")[0]
            if root in BLOCKED_IMPORT_ROOTS or root not in ALLOWED_IMPORT_ROOTS:
                raise HTTPException(
                    status_code=400,
                    detail=f"import '{root}' is not allowed in the sandbox",
                )


def _bootstrap_script() -> str:
    return textwrap.dedent(
        """
        import builtins
        import os
        import runpy
        import socket
        import subprocess
        from pathlib import Path

        WORKSPACE_ROOT = Path(os.environ["WORKSPACE_ROOT"]).resolve()
        ARTIFACTS_ROOT = Path(os.environ["ARTIFACTS_ROOT"]).resolve()
        USER_CODE_PATH = Path(os.environ["USER_CODE_PATH"]).resolve()

        def _blocked(*args, **kwargs):
            raise RuntimeError("This capability is disabled inside the sandbox")

        socket.socket = _blocked
        socket.create_connection = _blocked
        os.system = _blocked
        os.popen = _blocked
        subprocess.Popen = _blocked
        subprocess.run = _blocked
        subprocess.call = _blocked
        subprocess.check_call = _blocked
        subprocess.check_output = _blocked

        _original_open = builtins.open

        def _resolve_path(path_like):
            path = Path(path_like)
            if not path.is_absolute():
                path = (Path.cwd() / path).resolve()
            else:
                path = path.resolve()
            return path

        def _within(base, target):
            try:
                target.relative_to(base)
                return True
            except ValueError:
                return False

        def safe_open(file, mode="r", *args, **kwargs):
            path = _resolve_path(file)
            write_mode = any(flag in mode for flag in ("w", "a", "+", "x"))
            if write_mode:
                if not _within(ARTIFACTS_ROOT, path):
                    raise RuntimeError("Writes are only allowed inside /workspace/artifacts")
                path.parent.mkdir(parents=True, exist_ok=True)
            return _original_open(path, mode, *args, **kwargs)

        builtins.open = safe_open
        os.environ.clear()
        os.chdir(WORKSPACE_ROOT)
        runpy.run_path(str(USER_CODE_PATH), run_name="__main__")
        """
    ).strip()


def _resource_limiter():
    import resource

    memory_bytes = RUNNER_MEMORY_LIMIT_MB * 1024 * 1024
    cpu_limit = max(1, MAX_STEP_EXECUTION_SECONDS)
    resource.setrlimit(resource.RLIMIT_CPU, (cpu_limit, cpu_limit))
    resource.setrlimit(resource.RLIMIT_AS, (memory_bytes, memory_bytes))


async def _materialize_workspace_for_run(run: dict[str, Any], step_index: int) -> dict[str, Path]:
    workspace = await get_workspace_or_404(run["workspace_id"])
    file_docs = await list_workspace_files_docs(run["workspace_id"])
    manifest = await write_workspace_manifest(workspace)

    step_root = RUNNER_ROOT / run["workspace_id"] / str(run["_id"]) / f"step_{step_index}"
    workspace_root = step_root / "workspace"
    docs_root = workspace_root / "docs"
    artifacts_root = workspace_root / "artifacts"

    if step_root.exists():
        shutil.rmtree(step_root)

    docs_root.mkdir(parents=True, exist_ok=True)
    artifacts_root.mkdir(parents=True, exist_ok=True)

    for file_doc in file_docs:
        destination = docs_root / file_doc["stored_filename"]
        await workspace_storage.materialize_file(file_doc, destination)

    runtime_manifest = json.loads(json.dumps(manifest))
    runtime_manifest["paths"] = {
        "workspace_root": str(workspace_root),
        "docs_dir": str(docs_root),
        "artifacts_dir": str(artifacts_root),
        "manifest_path": str(workspace_root / "workspace_manifest.json"),
    }
    for file_entry in runtime_manifest["files"]:
        file_entry["runtime_path"] = str(docs_root / file_entry["stored_filename"])

    (workspace_root / "workspace_manifest.json").write_text(
        json.dumps(runtime_manifest, indent=2), encoding="utf-8"
    )

    return {
        "step_root": step_root,
        "workspace_root": workspace_root,
        "docs_root": docs_root,
        "artifacts_root": artifacts_root,
    }


async def execute_run_code(run_id: str, code: str) -> dict[str, Any]:
    if len(code) > MAX_CODE_CHARS:
        raise HTTPException(
            status_code=400, detail=f"code exceeds max size of {MAX_CODE_CHARS} characters"
        )

    _validate_imports(code)

    run = await get_run_or_404(run_id)
    steps = await list_run_steps(run_id)
    if len(steps) >= MAX_RUN_STEPS:
        raise HTTPException(status_code=400, detail="max steps per run reached")
    created_at = run.get("created_at")
    if isinstance(created_at, datetime):
        total_age_seconds = (datetime.now(timezone.utc) - created_at).total_seconds()
        if total_age_seconds >= MAX_TOTAL_RUN_SECONDS:
            raise HTTPException(status_code=400, detail="max total run time reached")

    step_index = len(steps) + 1
    sandbox = await _materialize_workspace_for_run(run, step_index)

    bootstrap_path = sandbox["step_root"] / BOOTSTRAP_FILENAME
    user_code_path = sandbox["workspace_root"] / USER_CODE_FILENAME
    bootstrap_path.write_text(_bootstrap_script(), encoding="utf-8")
    user_code_path.write_text(code, encoding="utf-8")

    env = {
        "PYTHONUNBUFFERED": "1",
        "PYTHONDONTWRITEBYTECODE": "1",
        "WORKSPACE_ROOT": str(sandbox["workspace_root"]),
        "ARTIFACTS_ROOT": str(sandbox["artifacts_root"]),
        "USER_CODE_PATH": str(user_code_path),
    }

    started_at = perf_counter()
    process = await asyncio.create_subprocess_exec(
        sys.executable,
        "-I",
        str(bootstrap_path),
        cwd=str(sandbox["workspace_root"]),
        env=env,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        preexec_fn=_resource_limiter,
    )

    timed_out = False
    try:
        stdout_bytes, stderr_bytes = await asyncio.wait_for(
            process.communicate(), timeout=MAX_STEP_EXECUTION_SECONDS
        )
    except asyncio.TimeoutError:
        timed_out = True
        process.kill()
        stdout_bytes, stderr_bytes = await process.communicate()

    duration_ms = int((perf_counter() - started_at) * 1000)
    stdout_text = (stdout_bytes or b"").decode("utf-8", errors="replace")
    stderr_text = (stderr_bytes or b"").decode("utf-8", errors="replace")

    if timed_out:
        stderr_text = (stderr_text + "\nExecution timed out.").strip()
        exit_code = TIMEOUT_EXIT_CODE
    else:
        exit_code = process.returncode or 0

    stdout_text = _truncate_output(stdout_text, MAX_STDOUT_BYTES)
    stderr_text = _truncate_output(stderr_text, MAX_STDERR_BYTES)
    artifacts = _collect_artifacts(sandbox["artifacts_root"])

    return {
        "code": code,
        "stdout": stdout_text,
        "stderr": stderr_text,
        "exit_code": exit_code,
        "duration_ms": min(duration_ms, MAX_TOTAL_RUN_SECONDS * 1000),
        "artifacts": artifacts,
        "sandbox": {
            "workspace_root": str(sandbox["workspace_root"]),
            "docs_root": str(sandbox["docs_root"]),
            "artifacts_root": str(sandbox["artifacts_root"]),
            "manifest_path": str(sandbox["workspace_root"] / "workspace_manifest.json"),
            "step_index": step_index,
        },
    }
