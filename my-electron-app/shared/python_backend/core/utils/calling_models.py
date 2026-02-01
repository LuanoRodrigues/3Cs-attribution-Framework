from __future__ import annotations

from typing import Any, Dict, Optional, Tuple


def _process_batch_for(*args: Any, **kwargs: Any) -> bool:
    # Stub: in the desktop app this is a no-op unless an LLM/batch runner is configured.
    return True


def _get_prompt_details(
    *,
    prompt_key: str,
    ai_provider_key: Optional[str] = None,
    default_model_override: Optional[str] = None,
    template_vars: Optional[Dict[str, Any]] = None,
    results_so_far: Optional[Dict[str, Any]] = None,
    section_id: Optional[str] = None,
    **_: Any,
) -> Tuple[str, Optional[str], Optional[int], Dict[str, Any], str]:
    # Returns: prompt_text, chosen_model, max_tokens_cfg, json_schema, effort_cfg
    return "", default_model_override or ai_provider_key, None, {}, "medium"


def call_models(**_: Any) -> Dict[str, Any]:
    # Minimal shape used by downstream code.
    return {"raw_text": "", "analysis": {}, "responses": []}


def call_models_plots(**_: Any) -> Dict[str, Any]:
    return {"text": ""}


def call_models_na(**_: Any) -> tuple[Dict[str, Any], bool]:
    return ({}, False)


def call_models_old_backin(**_: Any) -> tuple[Dict[str, Any], bool]:
    return ({}, False)

