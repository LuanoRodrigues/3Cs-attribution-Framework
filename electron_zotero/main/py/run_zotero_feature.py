#!/usr/bin/env python3
import json
import os
import sys
import traceback
import importlib.util
from pathlib import Path
import io
from contextlib import redirect_stdout, redirect_stderr


def _bootstrap_python_paths(repo_root: Path):
    candidates = [
        repo_root,
        repo_root / "my-electron-app",
        repo_root / "my-electron-app" / "shared",
        repo_root / "my-electron-app" / "shared" / "python_backend",
        repo_root / "my-electron-app" / "shared" / "python_backend" / "retrieve",
        repo_root / "my-electron-app" / "src" / "pages",
        repo_root / "python_backend_legacy",
    ]
    for candidate in candidates:
        path_str = str(candidate)
        if candidate.exists() and path_str not in sys.path:
            sys.path.insert(0, path_str)


def _safe_json(value, depth=0):
    if depth > 5:
      return str(value)
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, (list, tuple)):
        return [_safe_json(v, depth + 1) for v in value[:200]]
    if isinstance(value, dict):
        out = {}
        count = 0
        for k, v in value.items():
            out[str(k)] = _safe_json(v, depth + 1)
            count += 1
            if count >= 200:
                break
        return out
    return str(value)


def _coerce_arg(arg_type, raw):
    if arg_type == "boolean":
        if isinstance(raw, bool):
            return raw
        return str(raw).strip().lower() in {"1", "true", "yes", "y", "on"}
    if arg_type == "number":
        try:
            if "." in str(raw):
                return float(raw)
            return int(raw)
        except Exception:
            return raw
    if arg_type == "json":
        if isinstance(raw, (dict, list)):
            return raw
        s = str(raw or "").strip()
        if not s:
            return None
        return json.loads(s)
    return raw

def _resolve_zotero_class_path(repo_root: Path) -> Path:
    candidates = [
        repo_root / "zotero_module" / "zotero_class.py",
        repo_root / "my-electron-app" / "shared" / "python_backend" / "retrieve" / "zotero_class.py",
        repo_root / "electron_zotero" / "zotero_module" / "zotero_class.py",
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    raise FileNotFoundError(f"zotero_class.py not found. Tried: {', '.join(str(p) for p in candidates)}")

def _load_zotero_module(repo_root: Path):
    zpath = _resolve_zotero_class_path(repo_root)
    spec = importlib.util.spec_from_file_location("zotero_class_dynamic", str(zpath))
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load module from {zpath}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main():
    try:
        # Default to CPU in this runner to avoid GPU-arch mismatches (e.g., sm_61 vs torch build).
        # Set ZOTERO_FORCE_CPU=0 to re-enable CUDA visibility.
        if os.getenv("ZOTERO_FORCE_CPU", "1").strip().lower() not in {"0", "false", "no"}:
            os.environ.setdefault("CUDA_VISIBLE_DEVICES", "")
            os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")

        payload = json.loads(sys.argv[1]) if len(sys.argv) > 1 else {}
        function_name = str(payload.get("functionName") or "").strip()
        args_schema = payload.get("argsSchema") or []
        args_values = payload.get("argsValues") or {}
        execute = bool(payload.get("execute", True))

        if not function_name:
            print(json.dumps({"status": "error", "message": "functionName is required"}))
            return 2

        repo_root = Path(__file__).resolve().parents[3]
        _bootstrap_python_paths(repo_root)

        zc = _load_zotero_module(repo_root)

        # Prevent Linux/mac issue in Zotero.__init__ expecting default_storage global.
        if not hasattr(zc, "default_storage"):
            zc.default_storage = os.getenv("ZOTERO_STORAGE_PATH", str(Path.home() / "Zotero" / "storage"))

        library_id = str(os.getenv("ZOTERO_LIBRARY_ID") or os.getenv("LIBRARY_ID") or "").strip()
        library_type = str(os.getenv("ZOTERO_LIBRARY_TYPE") or os.getenv("LIBRARY_TYPE") or "user").strip() or "user"
        api_key = str(os.getenv("ZOTERO_API_KEY") or os.getenv("API_KEY") or os.getenv("ZOTERO_KEY") or "").strip()

        if not library_id or not api_key:
            print(json.dumps({"status": "error", "message": "Missing Zotero credentials in env (.env)."}))
            return 3

        client = zc.Zotero(library_id=library_id, library_type=library_type, api_key=api_key)
        method = getattr(client, function_name, None)
        if method is None:
            print(json.dumps({"status": "error", "message": f"Function not found: {function_name}"}))
            return 4

        kwargs = {}
        for spec in args_schema:
            key = spec.get("key")
            if not key:
                continue
            if key in args_values:
                kwargs[key] = _coerce_arg(spec.get("type", "string"), args_values[key])
            elif "default" in spec:
                kwargs[key] = spec.get("default")

        if not execute:
            print(json.dumps({"status": "ok", "mode": "dry_run", "function": function_name, "kwargs": _safe_json(kwargs)}))
            return 0

        std_capture = io.StringIO()
        err_capture = io.StringIO()
        with redirect_stdout(std_capture), redirect_stderr(err_capture):
            result = method(**kwargs)
        print(
            json.dumps(
                {
                    "status": "ok",
                    "function": function_name,
                    "kwargs": _safe_json(kwargs),
                    "result": _safe_json(result),
                    "captured_stdout": std_capture.getvalue()[-20000:],
                    "captured_stderr": err_capture.getvalue()[-20000:]
                },
                ensure_ascii=False
            )
        )
        return 0
    except Exception as exc:
        print(
            json.dumps(
                {
                    "status": "error",
                    "message": str(exc),
                    "trace": traceback.format_exc(limit=8)
                }
            )
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
