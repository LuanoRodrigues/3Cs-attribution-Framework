from __future__ import annotations

import dataclasses
import enum
from dataclasses import dataclass, field
from typing import Any


class StageName(str, enum.Enum):
    PDF_TO_MD = "PDF_TO_MD"
    FOOTNOTE_PARSE = "FOOTNOTE_PARSE"
    REFERENCE_PARSE = "REFERENCE_PARSE"
    CONSISTENCY_AUDIT = "CONSISTENCY_AUDIT"
    SCHEMA_EXTRACTION = "SCHEMA_EXTRACTION"
    FINAL_REPORT = "FINAL_REPORT"
    ICJ_SCORING = "ICJ_SCORING"


class StageStatus(str, enum.Enum):
    PENDING = "PENDING"
    RUNNING = "RUNNING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    SKIPPED = "SKIPPED"


@dataclass
class StageArtifact:
    name: str
    path: str
    kind: str = "file"
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class StageRunRecord:
    stage: StageName
    status: StageStatus
    started_at_utc: str
    ended_at_utc: str | None = None
    duration_seconds: float | None = None
    wrapper_module: str | None = None
    wrapper_callable: str | None = None
    inputs: dict[str, Any] = field(default_factory=dict)
    outputs: dict[str, Any] = field(default_factory=dict)
    context_updates: dict[str, Any] = field(default_factory=dict)
    artifacts: list[StageArtifact] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    error: dict[str, Any] | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class PipelineRunRecord:
    run_id: str
    state_dir: str
    created_at_utc: str
    updated_at_utc: str
    stage_order: list[StageName]
    selected_stages: list[StageName]
    context: dict[str, Any] = field(default_factory=dict)
    stage_results: list[StageRunRecord] = field(default_factory=list)
    status: str = "RUNNING"


def to_jsonable(value: Any) -> Any:
    if dataclasses.is_dataclass(value):
        return {k: to_jsonable(v) for k, v in dataclasses.asdict(value).items()}
    if isinstance(value, enum.Enum):
        return value.value
    if isinstance(value, dict):
        return {str(k): to_jsonable(v) for k, v in value.items()}
    if isinstance(value, list):
        return [to_jsonable(v) for v in value]
    if isinstance(value, tuple):
        return [to_jsonable(v) for v in value]
    return value


def stage_name_from_raw(raw: str) -> StageName:
    return StageName[str(raw).strip().upper()]
