#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import re
import sys
import typing
import types
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Optional, Sequence, Set, Tuple


DEFAULT_PDF_PATH = (
    r"C:\Users\luano\Zotero\storage\K5C6BLBK\Mandiant - 2013 - APT1 Exposing One of China's Cyber Espionage Units.pdf"
)

_MIN_STOPWORDS = """a
an
and
are
as
at
be
been
being
but
by
for
from
had
has
have
he
her
his
i
in
is
it
its
of
on
or
that
the
their
them
they
this
to
was
we
were
which
with
you
your
"""


def _app_root() -> Path:
    return Path(__file__).resolve().parents[1]


def _ensure_nltk_stopwords(app_root: Path) -> None:
    nltk_data_dir = app_root / ".nltk_data"
    stopwords_dir = nltk_data_dir / "corpora" / "stopwords"
    english_path = stopwords_dir / "english"
    if not english_path.exists():
        stopwords_dir.mkdir(parents=True, exist_ok=True)
        english_path.write_text(_MIN_STOPWORDS, encoding="utf-8")

    current = os.environ.get("NLTK_DATA", "").strip()
    if current:
        if str(nltk_data_dir) not in current.split(os.pathsep):
            os.environ["NLTK_DATA"] = os.pathsep.join([str(nltk_data_dir), current])
    else:
        os.environ["NLTK_DATA"] = str(nltk_data_dir)


def _ensure_tiktoken_fallback() -> None:
    if "tiktoken" in sys.modules:
        return
    try:
        __import__("tiktoken")
        return
    except Exception:
        pass

    fake = types.ModuleType("tiktoken")

    class _SimpleEncoding:
        def encode(self, text: str):
            return (text or "").split()

    def _encoding_for_model(_model_name: str):
        return _SimpleEncoding()

    def _get_encoding(_enc_name: str):
        return _SimpleEncoding()

    fake.encoding_for_model = _encoding_for_model  # type: ignore[attr-defined]
    fake.get_encoding = _get_encoding  # type: ignore[attr-defined]
    sys.modules["tiktoken"] = fake


def _resolve_pdf_path(raw_path: str) -> Path:
    raw = (raw_path or "").strip().strip('"').strip("'")
    if not raw:
        raise ValueError("Empty PDF path.")

    candidates: list[Path] = [Path(raw).expanduser()]
    match = re.match(r"^([A-Za-z]):[\\/](.+)$", raw)
    if match:
        drive = match.group(1).lower()
        tail = match.group(2).replace("\\", "/")
        candidates.append(Path(f"/mnt/{drive}/{tail}"))

    for candidate in candidates:
        if candidate.exists():
            return candidate.resolve()

    return candidates[0]


def _load_data_processing_module(app_root: Path):
    shared_dir = app_root / "shared"
    pages_dir = app_root / "src" / "pages"

    for extra in (shared_dir, pages_dir):
        extra_str = str(extra)
        if extra_str not in sys.path:
            sys.path.insert(0, extra_str)

    module_path = app_root / "src" / "pages" / "retrieve" / "data_processing.py"
    if not module_path.is_file():
        raise FileNotFoundError(f"Could not find module at: {module_path}")

    spec = importlib.util.spec_from_file_location("retrieve_data_processing", module_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load module spec from: {module_path}")

    module = importlib.util.module_from_spec(spec)
    # data_processing.py currently has several evaluated type annotations
    # without matching imports; seed typing symbols so import can proceed.
    for name in dir(typing):
        if name.startswith("_"):
            continue
        module.__dict__.setdefault(name, getattr(typing, name))
    spec.loader.exec_module(module)
    module.__dict__.setdefault("hashlib", hashlib)
    if not hasattr(module, "link_citations_to_footnotes"):
        legacy_fp = app_root.parent / "python_backend_legacy" / "llms" / "footnotes_parser.py"
        try:
            legacy_spec = importlib.util.spec_from_file_location("legacy_footnotes_parser", legacy_fp)
            if legacy_spec is None or legacy_spec.loader is None:
                raise RuntimeError(f"Could not load module spec from: {legacy_fp}")
            legacy_module = importlib.util.module_from_spec(legacy_spec)
            legacy_spec.loader.exec_module(legacy_module)
            if not hasattr(legacy_module, "link_citations_to_footnotes"):
                raise AttributeError("legacy footnotes_parser has no link_citations_to_footnotes")
            module.__dict__["link_citations_to_footnotes"] = legacy_module.link_citations_to_footnotes
            print(f"[LOG] Using legacy footnotes parser from {legacy_fp}")
        except Exception as exc:
            print(
                f"[WARNING] Could not load legacy footnotes parser; using empty citation fallback. "
                f"{type(exc).__name__}: {exc}",
                file=sys.stderr,
            )

            def _link_citations_fallback(full_text: str, references=None):
                refs = references if isinstance(references, list) else []
                return {"total": {}, "results": [], "flat_text": full_text or "", "references": refs}

            module.__dict__["link_citations_to_footnotes"] = _link_citations_fallback
    return module


def _result_counts(result: dict[str, Any]) -> dict[str, Any]:
    sections = result.get("sections") if isinstance(result, dict) else {}
    summary = result.get("summary") if isinstance(result, dict) else {}
    full_words = ((summary.get("full_text") or {}).get("words") if isinstance(summary, dict) else None)
    full_tokens = ((summary.get("full_text") or {}).get("tokens") if isinstance(summary, dict) else None)
    return {
        "sections": len(sections) if isinstance(sections, dict) else 0,
        "full_text_words": full_words,
        "full_text_tokens": full_tokens,
    }


def _read_cache_json(cache_path: Path) -> dict[str, Any]:
    if not cache_path.is_file() or cache_path.stat().st_size == 0:
        return {}
    try:
        return json.loads(cache_path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _fallback_cache_path(pdf_path: Path) -> Path:
    annotarium_home = (os.environ.get("ANNOTARIUM_HOME") or "").strip()
    base = Path(annotarium_home).expanduser() if annotarium_home else (Path.home() / "annotarium")
    cache_dir = base / "cache" / "pdf_markdown"
    h = hashlib.sha256(str(pdf_path).encode("utf-8")).hexdigest()
    return cache_dir / f"{h}.md"


def _word_count(text: str) -> int:
    return len(re.findall(r"\w+", text or ""))


def _token_count(text: str) -> int:
    return len((text or "").split())


def _build_offline_cache_payload(full_text: str, *, reason: str, method: str) -> dict[str, Any]:
    safe_text = full_text or ""
    summary = {
        "full_text": {"words": _word_count(safe_text), "tokens": _token_count(safe_text)},
        "flat_text": {"words": _word_count(safe_text), "tokens": _token_count(safe_text)},
    }
    return {
        "full_text": safe_text,
        "flat_text": safe_text,
        "html": safe_text,
        "toc": [],
        "sections": {},
        "process_log": {"mode": "offline_fallback", "reason": reason, "method": method},
        "word_count": summary["full_text"]["words"],
        "references": [],
        "citations": {"total": {}, "results": [], "flat_text": safe_text, "references": []},
        "summary": summary,
        "payload": {},
        "summary_log": {"mode": "offline_fallback", "reason": reason, "method": method},
    }


def _extract_markdown_offline(pdf_path: Path) -> tuple[str, str, list[str]]:
    errors: list[str] = []

    try:
        import pymupdf4llm  # type: ignore

        md = pymupdf4llm.to_markdown(str(pdf_path), write_images=False)
        if isinstance(md, str) and md.strip():
            return md.strip(), "pymupdf4llm", errors
        errors.append("pymupdf4llm returned empty output")
    except Exception as exc:
        errors.append(f"pymupdf4llm failed: {type(exc).__name__}: {exc}")

    try:
        import fitz  # type: ignore

        chunks: list[str] = []
        doc = fitz.open(str(pdf_path))
        try:
            for page in doc:
                txt = page.get_text("text") or ""
                txt = txt.strip()
                if txt:
                    chunks.append(txt)
        finally:
            doc.close()
        if chunks:
            return "\n\n".join(chunks).strip(), "fitz.get_text", errors
        errors.append("fitz.get_text returned empty output")
    except Exception as exc:
        errors.append(f"fitz.get_text failed: {type(exc).__name__}: {exc}")

    try:
        from pypdf import PdfReader  # type: ignore

        reader = PdfReader(str(pdf_path))
        chunks = []
        for page in reader.pages:
            txt = (page.extract_text() or "").strip()
            if txt:
                chunks.append(txt)
        if chunks:
            return "\n\n".join(chunks).strip(), "pypdf.extract_text", errors
        errors.append("pypdf.extract_text returned empty output")
    except Exception as exc:
        errors.append(f"pypdf.extract_text failed: {type(exc).__name__}: {exc}")

    return "", "none", errors


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Run process_pdf with Mistral OCR, always use/create the JSON cache (.md), "
            "and always write a markdown-only full_text file."
        )
    )
    parser.add_argument(
        "pdf_path",
        nargs="?",
        default=DEFAULT_PDF_PATH,
        help="PDF path (Windows path supported).",
    )
    parser.add_argument(
        "--mistral-model",
        default="mistral-ocr-latest",
        help="Mistral OCR model passed to process_pdf.",
    )
    parser.add_argument(
        "--ocr-retry",
        type=int,
        default=5,
        help="Retry count for OCR rate limits/errors.",
    )
    parser.add_argument(
        "--no-core-sections",
        action="store_true",
        help="Disable core section extraction.",
    )
    parser.add_argument(
        "--no-cache",
        action="store_true",
        help="Force recomputation instead of default cache-first behavior.",
    )
    parser.add_argument(
        "--offline-only",
        action="store_true",
        help="Skip provider OCR and use local offline PDF text/markdown extraction only.",
    )
    parser.add_argument(
        "--write-full-text-md",
        default="",
        help=(
            "Output .md path for pure markdown full_text copy. "
            "Default: <cache_dir>/<cache_stem>.full_text.md"
        ),
    )
    args = parser.parse_args()

    app_root = _app_root()
    os.environ.setdefault("ANNOTARIUM_HOME", str((app_root.parent / "annotarium").resolve()))
    _ensure_nltk_stopwords(app_root)
    _ensure_tiktoken_fallback()
    pdf_path = _resolve_pdf_path(args.pdf_path)
    if not pdf_path.exists():
        print(f"[ERROR] PDF not found: {pdf_path}", file=sys.stderr)
        return 2

    module: Any | None = None
    module_load_error: Exception | None = None
    process_error: Exception | None = None
    result: Optional[dict[str, Any]] = None

    if not args.offline_only:
        try:
            module = _load_data_processing_module(app_root)
        except Exception as exc:
            module_load_error = exc
            print(
                f"[WARNING] Could not load data_processing module; using offline fallback. "
                f"{type(exc).__name__}: {exc}",
                file=sys.stderr,
            )

    cache_path = Path(module._cache_path(str(pdf_path))) if module is not None else _fallback_cache_path(pdf_path)

    if module is not None and not args.offline_only:
        api_env_var = getattr(module, "MISTRAL_API_KEY_ENV_VAR", "MISTRAL_API_KEY")
        api_key = os.getenv(api_env_var, "")
        if not api_key:
            print(f"[WARNING] {api_env_var} is empty. OCR requests may fail.", file=sys.stderr)

        use_cache = not bool(args.no_cache)
        try:
            result = module.process_pdf(
                pdf_path=str(pdf_path),
                cache=use_cache,
                cache_full=use_cache,
                mistral_model=args.mistral_model,
                ocr_retry=args.ocr_retry,
                core_sections=not args.no_core_sections,
            )
        except Exception as exc:
            process_error = exc
            print(
                f"[WARNING] process_pdf failed; using offline fallback. {type(exc).__name__}: {exc}",
                file=sys.stderr,
            )

    cache_json = _read_cache_json(cache_path)
    source_data = cache_json if (isinstance(cache_json, dict) and cache_json.get("full_text")) else (result or {})

    fallback_used = False
    fallback_method = ""
    fallback_errors: list[str] = []
    fallback_reason = ""
    if not isinstance(source_data, dict) or not source_data.get("full_text"):
        fallback_reason = (
            "module_load_error"
            if module_load_error is not None
            else ("process_pdf_error" if process_error is not None else "missing_full_text")
        )
        full_text, fallback_method, fallback_errors = _extract_markdown_offline(pdf_path)
        source_data = _build_offline_cache_payload(full_text, reason=fallback_reason, method=fallback_method)
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        cache_path.write_text(json.dumps(source_data, ensure_ascii=False, indent=2), encoding="utf-8")
        fallback_used = True

    full_text = source_data.get("full_text", "") if isinstance(source_data, dict) else ""
    raw_full_text = source_data.get("raw_full_text", full_text) if isinstance(source_data, dict) else full_text
    out_md = (
        Path(args.write_full_text_md).expanduser()
        if args.write_full_text_md
        else cache_path.with_name(f"{cache_path.stem}.full_text.md")
    )
    out_md.parent.mkdir(parents=True, exist_ok=True)
    out_md.write_text(raw_full_text or "", encoding="utf-8")

    payload: dict[str, Any] = {
        "pdf_path": str(pdf_path),
        "cache_path": str(cache_path),
        "cache_content_type": "json",
        "cache_exists": cache_path.exists(),
        "cache_size_bytes": cache_path.stat().st_size if cache_path.exists() else 0,
        "full_text_md_path": str(out_md.resolve()),
        "full_text_md_size_bytes": out_md.stat().st_size,
        "result": _result_counts(source_data if isinstance(source_data, dict) else {}),
        "written_markdown_source": "raw_full_text" if raw_full_text else "full_text",
        "fallback_used": fallback_used,
        "fallback_method": fallback_method or None,
        "fallback_reason": fallback_reason or None,
        "offline_only": bool(args.offline_only),
    }
    if module_load_error is not None:
        payload["module_load_error"] = f"{type(module_load_error).__name__}: {module_load_error}"
    if process_error is not None:
        payload["process_pdf_error"] = f"{type(process_error).__name__}: {process_error}"
    if fallback_errors:
        payload["fallback_errors"] = fallback_errors

    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
