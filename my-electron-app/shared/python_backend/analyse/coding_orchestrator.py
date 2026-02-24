from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Dict, Optional


LegacyRunner = Callable[[], Any]


@dataclass
class CodingRequest:
    engine_id: str
    dir_base: str
    collection_name: str
    collection_key: str
    coding_mode: str
    prompt_key: str
    research_questions_count: int
    context: str
    extras: Dict[str, Any]


@dataclass
class CodingEngine:
    engine_id: str
    description: str
    run: Callable[[CodingRequest, LegacyRunner], Any]


class CodingRegistry:
    def __init__(self) -> None:
        self._engines: Dict[str, CodingEngine] = {}

    def register(self, engine: CodingEngine) -> None:
        self._engines[engine.engine_id] = engine

    def get(self, engine_id: str) -> Optional[CodingEngine]:
        return self._engines.get(engine_id)

    def resolve(self, engine_id: str) -> CodingEngine:
        engine = self.get(engine_id)
        if engine is not None:
            return engine
        fallback = self.get("legacy_verbatim")
        if fallback is None:
            raise RuntimeError("legacy_verbatim engine is not registered.")
        return fallback


def _safe_collection_name(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", str(value or "").strip())
    cleaned = re.sub(r"_+", "_", cleaned).strip("._-")
    return cleaned or "collection"


def _resolve_run_dir(dir_base: str, collection_name: str) -> Path:
    base_dir = Path(str(dir_base or ".")).resolve()
    safe_collection = _safe_collection_name(collection_name)
    if _safe_collection_name(base_dir.name).lower() == safe_collection.lower():
        return base_dir
    return base_dir / safe_collection


def _safe_write_json(path_obj: Path, payload: Dict[str, Any]) -> None:
    try:
        path_obj.parent.mkdir(parents=True, exist_ok=True)
        path_obj.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception:
        # non-blocking persistence
        pass


def _legacy_verbatim_engine(request: CodingRequest, legacy_runner: LegacyRunner) -> Any:
    return legacy_runner()


def _legacy_with_targeted_alias_engine(request: CodingRequest, legacy_runner: LegacyRunner) -> Any:
    # Phase 1: alias engine that keeps behavior identical while centralizing routing.
    return legacy_runner()


def _legacy_screening_engine(request: CodingRequest, legacy_runner: LegacyRunner) -> Any:
    return legacy_runner()


def _legacy_eligibility_engine(request: CodingRequest, legacy_runner: LegacyRunner) -> Any:
    return legacy_runner()


_registry = CodingRegistry()
_registry.register(
    CodingEngine(
        engine_id="legacy_verbatim",
        description="Legacy verbatim coding flow (current default).",
        run=_legacy_verbatim_engine,
    )
)
_registry.register(
    CodingEngine(
        engine_id="targeted_hybrid_legacy",
        description="Legacy engine with centralized targeted/hybrid routing alias.",
        run=_legacy_with_targeted_alias_engine,
    )
)
_registry.register(
    CodingEngine(
        engine_id="legacy_screening",
        description="Legacy screening flow behind centralized registry.",
        run=_legacy_screening_engine,
    )
)
_registry.register(
    CodingEngine(
        engine_id="legacy_eligibility",
        description="Legacy eligibility criteria flow behind centralized registry.",
        run=_legacy_eligibility_engine,
    )
)


def resolve_engine_id(explicit_engine_id: Optional[str], coding_mode: str) -> str:
    explicit = str(explicit_engine_id or "").strip()
    if explicit:
        return explicit
    env_engine = str(os.environ.get("ZOTERO_CODING_ENGINE", "")).strip()
    if env_engine:
        return env_engine
    mode = str(coding_mode or "open").strip().lower()
    if mode == "hybrid":
        return "targeted_hybrid_legacy"
    return "legacy_verbatim"


def run_review_step_with_registry(
    *,
    step_name: str,
    explicit_engine_id: Optional[str],
    dir_base: str,
    collection_name: str,
    collection_key: str,
    coding_mode: str,
    prompt_key: str,
    research_questions: Any,
    context: str,
    extras: Optional[Dict[str, Any]],
    legacy_runner: LegacyRunner,
) -> Any:
    engine_id = resolve_engine_id(explicit_engine_id, coding_mode)
    rq_count = len(research_questions) if isinstance(research_questions, list) else (1 if str(research_questions or "").strip() else 0)
    request = CodingRequest(
        engine_id=engine_id,
        dir_base=str(dir_base or ""),
        collection_name=str(collection_name or ""),
        collection_key=str(collection_key or ""),
        coding_mode=str(coding_mode or "open"),
        prompt_key=str(prompt_key or "code_pdf_page"),
        research_questions_count=rq_count,
        context=str(context or ""),
        extras=dict(extras or {}),
    )

    run_dir = _resolve_run_dir(request.dir_base, request.collection_name or request.collection_key or "collection")
    orchestrator_dir = run_dir / "coding_orchestrator"
    started_at = datetime.utcnow().isoformat(timespec="seconds") + "Z"
    manifest_path = orchestrator_dir / "coding_manifest.json"
    result_path = orchestrator_dir / "coding_result.json"

    pre_manifest = {
        "schema": "coding_manifest_v1",
        "started_at": started_at,
        "status": "running",
        "step_name": str(step_name or "unknown"),
        "engine_id": request.engine_id,
        "resolved_engine_id": _registry.resolve(request.engine_id).engine_id,
        "request": {
            "collection_name": request.collection_name,
            "collection_key": request.collection_key,
            "coding_mode": request.coding_mode,
            "prompt_key": request.prompt_key,
            "research_questions_count": request.research_questions_count,
        },
    }
    _safe_write_json(manifest_path, pre_manifest)
    print(
        f"[coding_orchestrator.py][run_review_step_with_registry][debug] "
        f"step={pre_manifest['step_name']} engine={pre_manifest['resolved_engine_id']} collection={request.collection_name or request.collection_key} mode={request.coding_mode}"
    )

    engine = _registry.resolve(request.engine_id)
    try:
        raw_result = engine.run(request, legacy_runner)
        result_for_write = raw_result if isinstance(raw_result, dict) else {
            "status": "ok",
            "result_type": type(raw_result).__name__,
            "result_repr": str(raw_result)[:2000],
        }
        result_for_write.setdefault("coding_engine", engine.engine_id)
        result_for_write.setdefault("coding_manifest_path", str(manifest_path))
        result_for_write.setdefault("step_name", str(step_name or "unknown"))
        _safe_write_json(result_path, result_for_write)
        done_manifest = {
            **pre_manifest,
            "ended_at": datetime.utcnow().isoformat(timespec="seconds") + "Z",
            "status": "completed" if str(result_for_write.get("status") or "ok") == "ok" else "error",
            "result_path": str(result_path),
        }
        _safe_write_json(manifest_path, done_manifest)
        if isinstance(raw_result, dict):
            raw_result.setdefault("coding_engine", engine.engine_id)
            raw_result.setdefault("coding_manifest_path", str(manifest_path))
            raw_result.setdefault("step_name", str(step_name or "unknown"))
            return raw_result
        return raw_result
    except Exception as exc:
        error_result = {
            "status": "error",
            "message": str(exc),
            "coding_engine": engine.engine_id,
            "coding_manifest_path": str(manifest_path),
            "step_name": str(step_name or "unknown"),
        }
        _safe_write_json(result_path, error_result)
        fail_manifest = {
            **pre_manifest,
            "ended_at": datetime.utcnow().isoformat(timespec="seconds") + "Z",
            "status": "error",
            "error": str(exc),
            "result_path": str(result_path),
        }
        _safe_write_json(manifest_path, fail_manifest)
        return error_result


def run_verbatim_with_registry(
    *,
    explicit_engine_id: Optional[str],
    dir_base: str,
    collection_name: str,
    collection_key: str,
    coding_mode: str,
    prompt_key: str,
    research_questions: Any,
    context: str,
    extras: Optional[Dict[str, Any]],
    legacy_runner: LegacyRunner,
) -> Dict[str, Any]:
    out = run_review_step_with_registry(
        step_name="coding",
        explicit_engine_id=explicit_engine_id,
        dir_base=dir_base,
        collection_name=collection_name,
        collection_key=collection_key,
        coding_mode=coding_mode,
        prompt_key=prompt_key,
        research_questions=research_questions,
        context=context,
        extras=extras,
        legacy_runner=legacy_runner,
    )
    if isinstance(out, dict):
        return out
    return {
        "status": "ok",
        "result": out,
    }
