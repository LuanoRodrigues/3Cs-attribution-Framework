#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from openai import OpenAI


DEFAULT_SCHEMA = (
    "annotarium/cyber_attribution_markdown_extraction_v2_schema.json"
)
DEFAULT_MARKDOWN = (
    "annotarium/cache/pdf_markdown/"
    "ca3da254e06b03e8b28ce2c2a9f679a6498325fa3126ce1757f9b9304ffa1be3.full_text.md"
)
DEFAULT_OUTPUT = "annotarium/outputs/extraction/output.json"


def _load_schema(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("Schema file must be a JSON object.")
    if "name" not in payload or "schema" not in payload:
        raise ValueError("Schema file must contain 'name' and 'schema' keys.")
    return payload


def _build_messages(markdown_text: str, markdown_path: Path) -> list[dict[str, str]]:
    system_text = (
        "You are a strict information extraction engine.\n"
        "Use only the provided markdown as source evidence.\n"
        "Return only JSON that matches the provided JSON schema.\n"
        "Do not include markdown fences or prose.\n"
        "Use zero-based page indexing.\n"
        "When uncertain, use conservative values and keep arrays concise."
    )

    user_text = (
        "Extract the document into the target schema.\n\n"
        f"Source markdown path: {markdown_path}\n\n"
        "Markdown content:\n"
        f"{markdown_text}"
    )

    return [
        {"role": "system", "content": system_text},
        {"role": "user", "content": user_text},
    ]


def _build_json_mode_messages(
    *, markdown_text: str, markdown_path: Path, schema_wrapper: dict[str, Any]
) -> list[dict[str, str]]:
    system_text = (
        "You are a strict information extraction engine.\n"
        "Return ONE JSON object only.\n"
        "It must conform exactly to the provided JSON schema."
    )
    user_text = (
        "Produce extraction output from this markdown.\n\n"
        f"Source markdown path: {markdown_path}\n\n"
        "SCHEMA WRAPPER JSON (contains name/strict/schema):\n"
        f"{json.dumps(schema_wrapper, ensure_ascii=False)}\n\n"
        "Markdown content:\n"
        f"{markdown_text}"
    )
    return [
        {"role": "system", "content": system_text},
        {"role": "user", "content": user_text},
    ]


def _maybe_validate(instance: dict[str, Any], schema: dict[str, Any]) -> str:
    try:
        import jsonschema  # type: ignore
    except Exception:
        return "skipped (jsonschema not installed)"

    jsonschema.validate(instance=instance, schema=schema)
    return "ok"


def _validate_with_error(instance: dict[str, Any], schema: dict[str, Any]) -> tuple[bool, str]:
    try:
        import jsonschema  # type: ignore
    except Exception:
        return True, "skipped (jsonschema not installed)"
    try:
        jsonschema.validate(instance=instance, schema=schema)
        return True, "ok"
    except Exception as exc:
        return False, str(exc)


def _repair_json_with_model(
    *,
    client: OpenAI,
    model: str,
    schema_wrapper: dict[str, Any],
    current_obj: dict[str, Any],
    validation_error: str,
    max_completion_tokens: int,
) -> dict[str, Any]:
    repair_messages = [
        {
            "role": "system",
            "content": (
                "You fix JSON objects to satisfy a JSON schema. "
                "Return one JSON object only, no prose."
            ),
        },
        {
            "role": "user",
            "content": (
                "Fix the following JSON so it strictly matches the schema.\n\n"
                f"SCHEMA WRAPPER JSON:\n{json.dumps(schema_wrapper, ensure_ascii=False)}\n\n"
                f"VALIDATION ERROR:\n{validation_error}\n\n"
                f"CURRENT JSON:\n{json.dumps(current_obj, ensure_ascii=False)}"
            ),
        },
    ]
    resp = client.chat.completions.create(
        model=model,
        messages=repair_messages,
        temperature=0,
        response_format={"type": "json_object"},
        max_completion_tokens=max_completion_tokens,
    )
    content = resp.choices[0].message.content or ""
    if not content.strip():
        raise RuntimeError("Repair call returned empty JSON.")
    parsed = json.loads(content)
    if not isinstance(parsed, dict):
        raise RuntimeError("Repair call did not return a JSON object.")
    return parsed


def run(args: argparse.Namespace) -> int:
    repo_root = Path(__file__).resolve().parents[1]
    env_file = repo_root / ".env"
    load_dotenv(env_file if env_file.exists() else None)

    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        print("[ERROR] OPENAI_API_KEY is missing.", file=sys.stderr)
        return 2

    schema_path = Path(args.schema).expanduser().resolve()
    markdown_path = Path(args.markdown).expanduser().resolve()
    output_path = Path(args.output).expanduser().resolve()

    if not schema_path.is_file():
        print(f"[ERROR] Schema file not found: {schema_path}", file=sys.stderr)
        return 2
    if not markdown_path.is_file():
        print(f"[ERROR] Markdown file not found: {markdown_path}", file=sys.stderr)
        return 2

    schema_wrapper = _load_schema(schema_path)
    schema_name = str(schema_wrapper["name"])
    strict = bool(schema_wrapper.get("strict", True))
    schema_body = schema_wrapper["schema"]
    markdown_text = markdown_path.read_text(encoding="utf-8", errors="replace")

    client = OpenAI(api_key=api_key)
    models_to_try = [m.strip() for m in args.models.split(",") if m.strip()]
    if not models_to_try:
        models_to_try = ["gpt-4o"]

    last_error: Exception | None = None
    content = ""

    messages = _build_messages(markdown_text=markdown_text, markdown_path=markdown_path)
    messages_json_mode = _build_json_mode_messages(
        markdown_text=markdown_text,
        markdown_path=markdown_path,
        schema_wrapper=schema_wrapper,
    )
    response_format = {
        "type": "json_schema",
        "json_schema": {
            "name": schema_name,
            "strict": strict,
            "schema": schema_body,
        },
    }

    for model in models_to_try:
        try:
            resp = client.chat.completions.create(
                model=model,
                messages=messages,
                temperature=0,
                response_format=response_format,
                max_completion_tokens=args.max_completion_tokens,
            )
            choice = resp.choices[0].message
            content = choice.content or ""
            if content.strip():
                break
            raise RuntimeError(f"Empty JSON content returned by model '{model}'.")
        except Exception as exc:
            last_error = exc
            # Some models reject draft-2020-12 constructs (e.g., allOf) in strict schema mode.
            # Fallback to JSON mode with schema text in prompt.
            try:
                resp = client.chat.completions.create(
                    model=model,
                    messages=messages_json_mode,
                    temperature=0,
                    response_format={"type": "json_object"},
                    max_completion_tokens=args.max_completion_tokens,
                )
                choice = resp.choices[0].message
                content = choice.content or ""
                if content.strip():
                    break
            except Exception as exc2:
                last_error = exc2
                continue

    if not content.strip():
        print(f"[ERROR] Structured extraction failed: {last_error!r}", file=sys.stderr)
        return 1

    try:
        output_obj = json.loads(content)
    except Exception as exc:
        print(f"[ERROR] Model did not return valid JSON: {exc!r}", file=sys.stderr)
        return 1

    ok, validation_status = _validate_with_error(output_obj, schema_body)
    if not ok:
        repaired = output_obj
        last_error = validation_status
        repair_ok = False
        for _ in range(max(0, int(args.repair_attempts))):
            try:
                repaired = _repair_json_with_model(
                    client=client,
                    model=models_to_try[0],
                    schema_wrapper=schema_wrapper,
                    current_obj=repaired,
                    validation_error=last_error,
                    max_completion_tokens=args.max_completion_tokens,
                )
                repair_ok, last_error = _validate_with_error(repaired, schema_body)
                if repair_ok:
                    output_obj = repaired
                    validation_status = "ok"
                    break
            except Exception as exc:
                last_error = str(exc)
        if validation_status != "ok":
            print(f"[ERROR] Output failed schema validation: {last_error}", file=sys.stderr)
            return 1

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(output_obj, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print(
        json.dumps(
            {
                "schema": str(schema_path),
                "markdown": str(markdown_path),
                "output": str(output_path),
                "validation": validation_status,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Apply JSON schema extraction to a markdown document.")
    parser.add_argument("--schema", default=DEFAULT_SCHEMA, help="Path to schema wrapper JSON.")
    parser.add_argument("--markdown", default=DEFAULT_MARKDOWN, help="Path to source markdown.")
    parser.add_argument("--output", default=DEFAULT_OUTPUT, help="Path to output JSON file.")
    parser.add_argument(
        "--models",
        default="gpt-4o,gpt-4o-mini",
        help="Comma-separated model fallback list.",
    )
    parser.add_argument(
        "--max-completion-tokens",
        type=int,
        default=16000,
        help="Max completion tokens for structured output call.",
    )
    parser.add_argument(
        "--repair-attempts",
        type=int,
        default=2,
        help="Number of model-driven repair attempts after local schema validation fails.",
    )
    args = parser.parse_args()
    return run(args)


if __name__ == "__main__":
    raise SystemExit(main())
