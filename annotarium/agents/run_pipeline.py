#!/usr/bin/env python3
from __future__ import annotations

import argparse
import importlib
import inspect
import json
import os
import sys
import time
import traceback
from pathlib import Path
from typing import Any

if __package__ in (None, ""):
    sys.path.append(str(Path(__file__).resolve().parents[2]))
    from annotarium.agents.models import (  # type: ignore
        PipelineRunRecord,
        StageArtifact,
        StageName,
        StageRunRecord,
        StageStatus,
        stage_name_from_raw,
        to_jsonable,
    )
else:
    from .models import (
        PipelineRunRecord,
        StageArtifact,
        StageName,
        StageRunRecord,
        StageStatus,
        stage_name_from_raw,
        to_jsonable,
    )


DEFAULT_STAGE_ORDER: list[StageName] = [
    StageName.PDF_TO_MD,
    StageName.FOOTNOTE_PARSE,
    StageName.REFERENCE_PARSE,
    StageName.CONSISTENCY_AUDIT,
    StageName.SCHEMA_EXTRACTION,
    StageName.FINAL_REPORT,
    StageName.ICJ_SCORING,
]

DEFAULT_WRAPPER_CANDIDATES: dict[StageName, list[str]] = {
    StageName.PDF_TO_MD: [
        "annotarium.agents.tools.tool_process_pdf",
    ],
    StageName.FOOTNOTE_PARSE: [
        "annotarium.agents.tools.tool_footnotes",
    ],
    StageName.REFERENCE_PARSE: [
        "annotarium.agents.tools.tool_references",
    ],
    StageName.CONSISTENCY_AUDIT: [
        "annotarium.agents.tools.tool_full_reference_agent",
        "annotarium.agents.tools.tool_consistency_audit",
    ],
    StageName.SCHEMA_EXTRACTION: [
        "annotarium.agents.tools.tool_schema_extract",
    ],
    StageName.FINAL_REPORT: [
        "annotarium.agents.tools.tool_validate",
    ],
    StageName.ICJ_SCORING: [
        "annotarium.agents.tools.tool_icj_score",
    ],
}


class WrapperNotFoundError(RuntimeError):
    pass


def _now_utc() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _display_path(path: Path, repo_root: Path) -> str:
    try:
        return str(path.resolve().relative_to(repo_root.resolve()))
    except Exception:
        return str(path.resolve())


def _safe_read_json(path: Path) -> dict[str, Any] | None:
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None
    return data if isinstance(data, dict) else None


def _safe_write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _parse_stage_overrides(items: list[str]) -> dict[StageName, str]:
    out: dict[StageName, str] = {}
    for raw in items:
        if "=" not in raw:
            raise ValueError(f"Invalid --wrapper mapping: {raw!r}; expected STAGE=module[:callable].")
        stage_text, target = raw.split("=", 1)
        stage = stage_name_from_raw(stage_text)
        out[stage] = target.strip()
    return out


def _normalize_stage_selection(
    *,
    from_stage: StageName | None,
    to_stage: StageName | None,
) -> list[StageName]:
    start_idx = DEFAULT_STAGE_ORDER.index(from_stage) if from_stage else 0
    end_idx = DEFAULT_STAGE_ORDER.index(to_stage) if to_stage else (len(DEFAULT_STAGE_ORDER) - 1)
    if end_idx < start_idx:
        raise ValueError("--to-stage must not come before --from-stage.")
    return DEFAULT_STAGE_ORDER[start_idx : end_idx + 1]


def _stage_state_path(state_dir: Path, stage: StageName) -> Path:
    idx = DEFAULT_STAGE_ORDER.index(stage) + 1
    return state_dir / "stages" / f"{idx:02d}_{stage.value.lower()}.json"


def _resolve_callable(module_obj: Any, explicit_name: str | None = None) -> tuple[Any, str]:
    candidate_names = [explicit_name] if explicit_name else ["run", "execute", "main"]
    for name in [n for n in candidate_names if n]:
        fn = getattr(module_obj, name, None)
        if callable(fn):
            return fn, str(name)
    raise WrapperNotFoundError(
        f"No callable found in module {module_obj.__name__!r}; expected one of {candidate_names}."
    )


def _resolve_wrapper_for_stage(
    *,
    stage: StageName,
    stage_overrides: dict[StageName, str],
) -> tuple[str, str, Any]:
    candidates: list[str] = []
    if stage in stage_overrides:
        candidates.append(stage_overrides[stage])
    candidates.extend(DEFAULT_WRAPPER_CANDIDATES.get(stage, []))

    errors: list[str] = []
    for target in candidates:
        module_name, _, callable_name = target.partition(":")
        try:
            module = importlib.import_module(module_name)
            fn, resolved_name = _resolve_callable(module, explicit_name=(callable_name or None))
            return module_name, resolved_name, fn
        except Exception as exc:
            errors.append(f"{target}: {exc}")

    raise WrapperNotFoundError(
        f"No wrapper available for stage {stage.value}. Tried: {candidates}. Errors: {errors}"
    )


def _invoke_wrapper(fn: Any, *, stage: StageName, context: dict[str, Any], state_dir: Path) -> Any:
    sig = inspect.signature(fn)
    params = list(sig.parameters.values())

    if len(params) == 0:
        return fn()

    if len(params) == 1:
        p = params[0]
        if p.kind in (inspect.Parameter.POSITIONAL_ONLY, inspect.Parameter.POSITIONAL_OR_KEYWORD):
            return fn(context)

    kwargs: dict[str, Any] = {}
    accepted_names = {p.name for p in params if p.kind in (inspect.Parameter.POSITIONAL_OR_KEYWORD, inspect.Parameter.KEYWORD_ONLY)}
    has_var_kwargs = any(p.kind == inspect.Parameter.VAR_KEYWORD for p in params)

    reserved = {
        "context": context,
        "stage": stage.value,
        "state_dir": str(state_dir),
    }
    for key, value in reserved.items():
        if key in accepted_names or has_var_kwargs:
            kwargs[key] = value

    for key, value in context.items():
        if key in kwargs:
            continue
        if key in accepted_names or has_var_kwargs:
            kwargs[key] = value

    return fn(**kwargs)


def _normalize_wrapper_output(raw_output: Any) -> dict[str, Any]:
    if raw_output is None:
        return {}
    if isinstance(raw_output, dict):
        return raw_output
    return {"result": raw_output}


def _extract_artifacts(wrapper_output: dict[str, Any]) -> list[StageArtifact]:
    artifacts: list[StageArtifact] = []
    raw = wrapper_output.get("artifacts")
    if isinstance(raw, list):
        for item in raw:
            if isinstance(item, dict):
                name = str(item.get("name") or item.get("path") or "artifact")
                path = str(item.get("path") or "")
                kind = str(item.get("kind") or "file")
                metadata = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
                artifacts.append(StageArtifact(name=name, path=path, kind=kind, metadata=metadata))

    raw_written = wrapper_output.get("artifacts_written")
    if isinstance(raw_written, list):
        for path in raw_written:
            if isinstance(path, str) and path.strip():
                artifacts.append(StageArtifact(name=Path(path).name, path=path, kind="file", metadata={}))
    return artifacts


def _context_updates_from_output(wrapper_output: dict[str, Any]) -> dict[str, Any]:
    updates: dict[str, Any] = {}

    for key in ("context_updates", "next_context", "context"):
        maybe = wrapper_output.get(key)
        if isinstance(maybe, dict):
            updates.update(maybe)

    maybe_outputs = wrapper_output.get("outputs")
    if isinstance(maybe_outputs, dict):
        for key, value in maybe_outputs.items():
            if isinstance(key, str):
                updates[key] = value

    maybe_data = wrapper_output.get("data")
    if isinstance(maybe_data, dict):
        for key in ("markdown_path", "output_path", "report_json_path", "report_md_path", "references", "citations", "citation_summary"):
            if key in maybe_data:
                updates[key] = maybe_data[key]

    return updates


def _build_manifest(
    *,
    run_id: str,
    state_dir: Path,
    selected_stages: list[StageName],
    context: dict[str, Any],
    stage_results: list[StageRunRecord],
    status: str,
    created_at_utc: str,
) -> dict[str, Any]:
    return to_jsonable(
        PipelineRunRecord(
            run_id=run_id,
            state_dir=str(state_dir),
            created_at_utc=created_at_utc,
            updated_at_utc=_now_utc(),
            stage_order=DEFAULT_STAGE_ORDER,
            selected_stages=selected_stages,
            context=context,
            stage_results=stage_results,
            status=status,
        )
    )


def _run_stage(
    *,
    stage: StageName,
    context: dict[str, Any],
    state_dir: Path,
    stage_overrides: dict[StageName, str],
) -> StageRunRecord:
    started_at = _now_utc()
    t0 = time.time()

    try:
        module_name, callable_name, fn = _resolve_wrapper_for_stage(stage=stage, stage_overrides=stage_overrides)
    except Exception as exc:
        return StageRunRecord(
            stage=stage,
            status=StageStatus.FAILED,
            started_at_utc=started_at,
            ended_at_utc=_now_utc(),
            duration_seconds=round(time.time() - t0, 3),
            inputs=dict(context),
            error={
                "type": type(exc).__name__,
                "message": str(exc),
                "traceback": traceback.format_exc(),
            },
        )

    try:
        raw = _invoke_wrapper(fn, stage=stage, context=dict(context), state_dir=state_dir)
        output = _normalize_wrapper_output(raw)
        context_updates = _context_updates_from_output(output)
        artifacts = _extract_artifacts(output)
        output_status = str(output.get("status") or "").strip().lower()
        stage_status = StageStatus.COMPLETED if output_status in ("", "ok", "success") else StageStatus.FAILED

        return StageRunRecord(
            stage=stage,
            status=stage_status,
            started_at_utc=started_at,
            ended_at_utc=_now_utc(),
            duration_seconds=round(time.time() - t0, 3),
            wrapper_module=module_name,
            wrapper_callable=callable_name,
            inputs=dict(context),
            outputs=output,
            context_updates=context_updates,
            artifacts=artifacts,
            warnings=list(output.get("warnings", [])) if isinstance(output.get("warnings"), list) else [],
            metadata={"wrapper_target": f"{module_name}:{callable_name}"},
        )
    except Exception as exc:
        return StageRunRecord(
            stage=stage,
            status=StageStatus.FAILED,
            started_at_utc=started_at,
            ended_at_utc=_now_utc(),
            duration_seconds=round(time.time() - t0, 3),
            wrapper_module=module_name,
            wrapper_callable=callable_name,
            inputs=dict(context),
            error={
                "type": type(exc).__name__,
                "message": str(exc),
                "traceback": traceback.format_exc(),
            },
        )


def _is_completed_stage_file(path: Path) -> bool:
    payload = _safe_read_json(path)
    if not payload:
        return False
    return payload.get("status") == StageStatus.COMPLETED.value


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Run the annotarium staged pipeline with resumability and per-stage JSON artifacts. "
            "Wrappers are loaded dynamically from annotarium.agents.wrappers.* modules."
        )
    )
    parser.add_argument("--state-dir", default="annotarium/session/pipeline_state", help="Directory for run state JSON files.")
    parser.add_argument("--run-id", default="", help="Optional run identifier. Defaults to UTC timestamp.")

    parser.add_argument("--pdf", default="", help="Input PDF path.")
    parser.add_argument("--markdown", default="", help="Input markdown path.")
    parser.add_argument("--schema", default="annotarium/cyber_attribution_markdown_extraction_v2_schema.json", help="Schema wrapper path.")

    parser.add_argument("--from-stage", choices=[s.value for s in DEFAULT_STAGE_ORDER], default="", help="Start execution from this stage.")
    parser.add_argument("--to-stage", choices=[s.value for s in DEFAULT_STAGE_ORDER], default="", help="Stop execution after this stage.")
    parser.add_argument("--force-stage", action="append", default=[], help="Force rerun for a stage name. Can be set multiple times.")
    parser.add_argument("--wrapper", action="append", default=[], help="Override wrapper mapping: STAGE=module[:callable].")

    parser.add_argument("--continue-on-error", action="store_true", help="Continue to later stages after a stage failure.")
    parser.add_argument("--dry-run", action="store_true", help="Resolve stages/wrappers and write plan without executing wrappers.")
    parser.add_argument("--summary-json", default="", help="Optional path for final summary JSON copy.")
    parser.add_argument("--expected-footnotes-max", type=int, default=0, help="Canonical footnote max for full reference agent.")
    parser.add_argument("--extract-biblio-with-llm", action="store_true", default=None, help="Enable LLM bibliography extraction in full reference agent.")
    parser.add_argument("--quality-min-avg-confidence", type=float, default=0.5, help="Minimum avg confidence quality gate.")
    parser.add_argument("--quality-max-unresolved", type=int, default=0, help="Maximum unresolved missing items allowed.")
    parser.add_argument("--llm-cache-path", default="", help="Optional LLM cache path for full reference agent.")
    parser.add_argument("--no-llm-cache", action="store_true", help="Disable LLM cache in full reference agent.")
    parser.add_argument("--biblio-checkpoint-path", default="", help="Optional biblio checkpoint path for resumable runs.")
    parser.add_argument("--no-resume-biblio-checkpoint", action="store_true", help="Disable resume from biblio checkpoint.")
    parser.add_argument("--full-reference-timeout-seconds", type=float, default=1800.0, help="Timeout for full reference agent wrapper.")
    parser.add_argument("--collect-visuals-source", choices=["markdown", "pdf", "both", "mistral", "markdown+mistral", "all"], default="markdown", help="Source for table/image collectors.")
    parser.add_argument("--mistral-api-key-env", default="MISTRAL_API_KEY", help="Env var for Mistral API key used by visuals collector.")
    parser.add_argument("--mistral-model", default="mistral-ocr-latest", help="Mistral model for visuals collector.")
    parser.add_argument("--mistral-visuals-cache-path", default="", help="Optional cache path for raw Mistral OCR visuals response.")
    parser.add_argument("--extract-artifacts", action="store_true", help="Enable artifact extraction from images/tables.")
    parser.add_argument("--artifact-taxonomy-json", default="", help="Optional custom taxonomy json for artifact extraction.")
    parser.add_argument("--artifact-max-images", type=int, default=30, help="Max images for artifact OCR extraction.")
    parser.add_argument("--artifact-max-tables", type=int, default=100, help="Max tables for GPT artifact extraction.")
    parser.add_argument("--icj-profile", choices=["strict", "balanced", "permissive"], default="balanced", help="Calibration profile for ICJ scoring stage.")

    args = parser.parse_args()

    repo_root = _repo_root()
    os.environ.setdefault("ANNOTARIUM_HOME", str((repo_root / "annotarium").resolve()))

    state_dir = Path(args.state_dir).expanduser()
    if not state_dir.is_absolute():
        state_dir = (repo_root / state_dir).resolve()
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "stages").mkdir(parents=True, exist_ok=True)
    (state_dir / "outputs").mkdir(parents=True, exist_ok=True)
    (state_dir / "logs").mkdir(parents=True, exist_ok=True)

    manifest_path = state_dir / "pipeline_state.json"
    existing_manifest = _safe_read_json(manifest_path) or {}

    run_id = args.run_id.strip() or str(existing_manifest.get("run_id") or time.strftime("%Y%m%dT%H%M%SZ", time.gmtime()))
    created_at = str(existing_manifest.get("created_at_utc") or _now_utc())

    stage_overrides = _parse_stage_overrides(args.wrapper)
    selected_stages = _normalize_stage_selection(
        from_stage=StageName(args.from_stage) if args.from_stage else None,
        to_stage=StageName(args.to_stage) if args.to_stage else None,
    )
    forced = {stage_name_from_raw(s) for s in args.force_stage}

    context: dict[str, Any] = {}
    if isinstance(existing_manifest.get("context"), dict):
        context.update(existing_manifest["context"])

    if args.pdf:
        pdf_path = Path(args.pdf).expanduser()
        if not pdf_path.is_absolute():
            pdf_path = (repo_root / pdf_path).resolve()
        context["pdf_path"] = str(pdf_path.resolve())
        if not context.get("write_full_text_md"):
            context["write_full_text_md"] = str((state_dir / "outputs" / f"{run_id}.full_text.md").resolve())
    if args.markdown:
        markdown_path = Path(args.markdown).expanduser()
        if not markdown_path.is_absolute():
            markdown_path = (repo_root / markdown_path).resolve()
        context["markdown_path"] = str(markdown_path.resolve())
    if args.schema:
        schema_path = Path(args.schema).expanduser()
        if not schema_path.is_absolute():
            schema_path = (repo_root / schema_path).resolve()
        context["schema_path"] = str(schema_path.resolve())

    if not context.get("pdf_path") and not context.get("markdown_path"):
        raise ValueError("Missing input: provide --pdf or --markdown, or resume from a state_dir that already has context.")
    if context.get("markdown_path") and not context.get("pdf_path") and not args.from_stage:
        start_idx = DEFAULT_STAGE_ORDER.index(StageName.FOOTNOTE_PARSE)
        selected_stages = selected_stages[start_idx:]

    schema_abs = Path(str(context["schema_path"])).expanduser().resolve()
    if not schema_abs.is_file():
        raise FileNotFoundError(f"Schema file not found: {schema_abs}")

    context["state_dir"] = str(state_dir)
    context["outputs_dir"] = str((state_dir / "outputs").resolve())
    context["logs_dir"] = str((state_dir / "logs").resolve())
    context["run_id"] = run_id
    context.setdefault("output_path", str((state_dir / "outputs" / f"{run_id}.extraction.output.json").resolve()))
    context.setdefault("report_json_path", str((state_dir / "outputs" / f"{run_id}.validation_report.json").resolve()))
    context.setdefault("report_md_path", str((state_dir / "outputs" / f"{run_id}.validation_report.md").resolve()))
    context.setdefault("icj_score_report_path", str((state_dir / "outputs" / f"{run_id}.icj_score_report.json").resolve()))
    context.setdefault("icj_profile", str(args.icj_profile))
    context.setdefault("expected_footnotes_max", int(args.expected_footnotes_max))
    if args.extract_biblio_with_llm is not None:
        context["extract_biblio_with_llm"] = bool(args.extract_biblio_with_llm)
    context.setdefault("quality_min_avg_confidence", float(args.quality_min_avg_confidence))
    context.setdefault("quality_max_unresolved", int(args.quality_max_unresolved))
    if args.llm_cache_path:
        llm_cache_path = Path(args.llm_cache_path).expanduser()
        if not llm_cache_path.is_absolute():
            llm_cache_path = (repo_root / llm_cache_path).resolve()
        context["llm_cache_path"] = str(llm_cache_path)
    context.setdefault("no_llm_cache", bool(args.no_llm_cache))
    if args.biblio_checkpoint_path:
        cp = Path(args.biblio_checkpoint_path).expanduser()
        if not cp.is_absolute():
            cp = (repo_root / cp).resolve()
        context["biblio_checkpoint_path"] = str(cp)
    context.setdefault("resume_biblio_checkpoint", not bool(args.no_resume_biblio_checkpoint))
    context.setdefault("full_reference_timeout_seconds", float(args.full_reference_timeout_seconds))
    context.setdefault("collect_visuals_source", str(args.collect_visuals_source))
    context.setdefault("mistral_api_key_env", str(args.mistral_api_key_env))
    context.setdefault("mistral_model", str(args.mistral_model))
    context.setdefault("extract_artifacts", bool(args.extract_artifacts))
    context.setdefault("artifact_max_images", int(args.artifact_max_images))
    context.setdefault("artifact_max_tables", int(args.artifact_max_tables))
    if args.mistral_visuals_cache_path:
        vp = Path(args.mistral_visuals_cache_path).expanduser()
        if not vp.is_absolute():
            vp = (repo_root / vp).resolve()
        context["mistral_visuals_cache_path"] = str(vp)
    if args.artifact_taxonomy_json:
        tp = Path(args.artifact_taxonomy_json).expanduser()
        if not tp.is_absolute():
            tp = (repo_root / tp).resolve()
        context["artifact_taxonomy_json"] = str(tp)

    stage_records: list[StageRunRecord] = []
    failed = False

    for stage in selected_stages:
        stage_path = _stage_state_path(state_dir, stage)

        if args.dry_run:
            record = StageRunRecord(
                stage=stage,
                status=StageStatus.SKIPPED,
                started_at_utc=_now_utc(),
                ended_at_utc=_now_utc(),
                duration_seconds=0.0,
                inputs=dict(context),
                metadata={"reason": "dry_run"},
            )
            stage_records.append(record)
            _safe_write_json(stage_path, to_jsonable(record))
            continue

        reuse_completed = stage not in forced and _is_completed_stage_file(stage_path)
        if reuse_completed:
            payload = _safe_read_json(stage_path) or {}
            updates = payload.get("context_updates") if isinstance(payload.get("context_updates"), dict) else {}
            context.update(updates)
            record = StageRunRecord(
                stage=stage,
                status=StageStatus.SKIPPED,
                started_at_utc=_now_utc(),
                ended_at_utc=_now_utc(),
                duration_seconds=0.0,
                inputs=dict(context),
                context_updates=updates,
                metadata={"reason": "resume_completed"},
            )
            stage_records.append(record)
            continue

        record = _run_stage(stage=stage, context=context, state_dir=state_dir, stage_overrides=stage_overrides)
        stage_records.append(record)
        _safe_write_json(stage_path, to_jsonable(record))

        if record.status == StageStatus.COMPLETED:
            context.update(record.context_updates)
        else:
            failed = True
            if not args.continue_on_error:
                break

    final_status = "FAILED" if failed else "COMPLETED"

    summary = _build_manifest(
        run_id=run_id,
        state_dir=state_dir,
        selected_stages=selected_stages,
        context=context,
        stage_results=stage_records,
        status=final_status,
        created_at_utc=created_at,
    )
    _safe_write_json(manifest_path, summary)

    if args.summary_json:
        summary_path = Path(args.summary_json).expanduser()
        if not summary_path.is_absolute():
            summary_path = (repo_root / summary_path).resolve()
        _safe_write_json(summary_path, summary)

    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 1 if failed else 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(
            json.dumps(
                {
                    "error": "run_pipeline_unhandled_exception",
                    "type": type(exc).__name__,
                    "message": str(exc),
                    "traceback": traceback.format_exc(),
                },
                ensure_ascii=False,
                indent=2,
            ),
            file=sys.stderr,
        )
        raise SystemExit(2)
