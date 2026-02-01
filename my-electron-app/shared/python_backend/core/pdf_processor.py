from __future__ import annotations

from pathlib import Path
from typing import Any, Callable


def referenced_paragraph(*, paragraph_html: str, **_: Any) -> str:
    return paragraph_html or ""


def _exponential_backoff(func: Callable[..., Any], *args: Any, **kwargs: Any) -> Any:
    return func(*args, **kwargs)


def _cache_path(*parts: str) -> str:
    return str(Path(*parts))

