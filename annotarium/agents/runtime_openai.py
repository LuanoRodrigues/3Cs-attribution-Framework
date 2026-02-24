from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


class OpenAIStructuredStepError(RuntimeError):
    def __init__(self, message: str, *, details: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.details = details or {}


@dataclass
class OpenAIStructuredStepConfig:
    model: str = "gpt-4o"
    fallback_models: list[str] = field(default_factory=lambda: ["gpt-4o-mini"])
    temperature: float = 0.0
    max_completion_tokens: int = 16000
    retries_per_model: int = 2
    timeout_seconds: float | None = None


@dataclass
class OpenAIStructuredStepResult:
    ok: bool
    step: str
    model: str | None
    response_json: dict[str, Any] | None
    raw_content: str
    mode: str | None
    attempts: int
    usage: dict[str, Any] = field(default_factory=dict)
    error: dict[str, Any] | None = None


def _create_client(api_key: str | None = None) -> Any:
    try:
        from openai import OpenAI  # type: ignore
    except Exception as exc:
        raise OpenAIStructuredStepError(
            "openai package is not available.",
            details={"hint": "Install openai and retry.", "exception": repr(exc)},
        ) from exc

    resolved_key = (api_key or os.getenv("OPENAI_API_KEY", "")).strip()
    if not resolved_key:
        # Fallback: load OPENAI_API_KEY from annotarium/.env without requiring python-dotenv.
        try:
            env_path = Path(__file__).resolve().parents[1] / ".env"
            if env_path.is_file():
                for raw in env_path.read_text(encoding="utf-8", errors="ignore").splitlines():
                    line = raw.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    key, value = line.split("=", 1)
                    if key.strip() == "OPENAI_API_KEY":
                        candidate = value.strip().strip('"').strip("'")
                        if candidate:
                            resolved_key = candidate
                            break
        except Exception:
            pass
    if not resolved_key:
        raise OpenAIStructuredStepError(
            "OPENAI_API_KEY is missing.",
            details={"hint": "Set OPENAI_API_KEY in your environment."},
        )
    return OpenAI(api_key=resolved_key)


def _parse_json_object(raw: str) -> dict[str, Any]:
    text = (raw or "").strip()
    if not text:
        raise ValueError("Empty response content.")
    parsed = json.loads(text)
    if not isinstance(parsed, dict):
        raise ValueError("Structured response must be a JSON object.")
    return parsed


def _validate_json(instance: dict[str, Any], schema: dict[str, Any]) -> tuple[bool, str]:
    try:
        import jsonschema  # type: ignore
    except Exception:
        return True, "skipped (jsonschema not installed)"
    try:
        jsonschema.validate(instance=instance, schema=schema)
        return True, "ok"
    except Exception as exc:
        return False, str(exc)


def _schema_prompt(schema_wrapper: dict[str, Any]) -> str:
    return (
        "Return exactly one JSON object matching this schema wrapper. "
        "Do not include markdown fences or extra text.\n\n"
        f"{json.dumps(schema_wrapper, ensure_ascii=False)}"
    )


def run_structured_step(
    *,
    step: str,
    messages: list[dict[str, Any]],
    schema_wrapper: dict[str, Any],
    config: OpenAIStructuredStepConfig | None = None,
    api_key: str | None = None,
    validate_with_jsonschema: bool = True,
) -> OpenAIStructuredStepResult:
    cfg = config or OpenAIStructuredStepConfig()

    if "name" not in schema_wrapper or "schema" not in schema_wrapper:
        raise OpenAIStructuredStepError(
            "schema_wrapper must include 'name' and 'schema'.",
            details={"step": step},
        )

    client = _create_client(api_key=api_key)
    models = [cfg.model] + [m for m in cfg.fallback_models if m and m != cfg.model]

    response_format_schema = {
        "type": "json_schema",
        "json_schema": {
            "name": str(schema_wrapper["name"]),
            "strict": bool(schema_wrapper.get("strict", True)),
            "schema": schema_wrapper["schema"],
        },
    }

    last_error: dict[str, Any] | None = None
    attempts = 0

    for model in models:
        for _ in range(max(1, int(cfg.retries_per_model))):
            attempts += 1
            try:
                kwargs: dict[str, Any] = {
                    "model": model,
                    "messages": messages,
                    "temperature": float(cfg.temperature),
                    "response_format": response_format_schema,
                    "max_completion_tokens": int(cfg.max_completion_tokens),
                }
                if cfg.timeout_seconds is not None:
                    kwargs["timeout"] = float(cfg.timeout_seconds)

                resp = client.chat.completions.create(**kwargs)
                content = (resp.choices[0].message.content or "").strip()
                parsed = _parse_json_object(content)
                validation = "skipped"
                if validate_with_jsonschema:
                    ok, validation = _validate_json(parsed, schema_wrapper["schema"])
                    if not ok:
                        raise OpenAIStructuredStepError(
                            "Structured response failed schema validation.",
                            details={"validation_error": validation, "model": model, "mode": "json_schema"},
                        )
                usage = getattr(resp, "usage", None)
                return OpenAIStructuredStepResult(
                    ok=True,
                    step=step,
                    model=model,
                    response_json=parsed,
                    raw_content=content,
                    mode="json_schema",
                    attempts=attempts,
                    usage={"raw": getattr(usage, "model_dump", lambda: usage)() if usage is not None else {}},
                    error=None,
                )
            except Exception as exc:
                last_error = {
                    "exception": repr(exc),
                    "model": model,
                    "mode": "json_schema",
                }

            try:
                prompt_messages = list(messages) + [
                    {"role": "system", "content": _schema_prompt(schema_wrapper)}
                ]
                kwargs = {
                    "model": model,
                    "messages": prompt_messages,
                    "temperature": float(cfg.temperature),
                    "response_format": {"type": "json_object"},
                    "max_completion_tokens": int(cfg.max_completion_tokens),
                }
                if cfg.timeout_seconds is not None:
                    kwargs["timeout"] = float(cfg.timeout_seconds)

                resp = client.chat.completions.create(**kwargs)
                content = (resp.choices[0].message.content or "").strip()
                parsed = _parse_json_object(content)
                validation = "skipped"
                if validate_with_jsonschema:
                    ok, validation = _validate_json(parsed, schema_wrapper["schema"])
                    if not ok:
                        raise OpenAIStructuredStepError(
                            "JSON mode response failed schema validation.",
                            details={"validation_error": validation, "model": model, "mode": "json_object"},
                        )
                usage = getattr(resp, "usage", None)
                return OpenAIStructuredStepResult(
                    ok=True,
                    step=step,
                    model=model,
                    response_json=parsed,
                    raw_content=content,
                    mode="json_object",
                    attempts=attempts,
                    usage={"raw": getattr(usage, "model_dump", lambda: usage)() if usage is not None else {}},
                    error=None,
                )
            except Exception as exc:
                last_error = {
                    "exception": repr(exc),
                    "model": model,
                    "mode": "json_object",
                }

    raise OpenAIStructuredStepError(
        "Structured step failed for all models.",
        details={
            "step": step,
            "models_tried": models,
            "attempts": attempts,
            "last_error": last_error,
        },
    )
