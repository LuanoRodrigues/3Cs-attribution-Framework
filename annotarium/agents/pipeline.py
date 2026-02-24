from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class PipelineStage:
    stage_id: str
    role: str
    prompt_path: Path
    output_schema_path: Path


def _base_dir() -> Path:
    return Path(__file__).resolve().parent


def build_default_pipeline() -> list[PipelineStage]:
    base = _base_dir()
    return [
        PipelineStage(
            stage_id="stage0_document_metadata",
            role="document_metadata_agent",
            prompt_path=base / "prompts" / "stage0_document_metadata_agent.md",
            output_schema_path=base / "schemas" / "stage0_document_metadata.output.schema.json",
        ),
        PipelineStage(
            stage_id="stage1_markdown_parse",
            role="markdown_parse_agent",
            prompt_path=base / "prompts" / "stage1_markdown_parse_agent.md",
            output_schema_path=base / "schemas" / "stage1_markdown_parse.output.schema.json",
        ),
        PipelineStage(
            stage_id="stage2_claim_extraction",
            role="claim_extraction_agent",
            prompt_path=base / "prompts" / "stage2_claim_extraction_agent.md",
            output_schema_path=base / "schemas" / "stage2_claim_extraction.output.schema.json",
        ),
    ]


def dry_run_graph() -> dict[str, list[dict[str, str]]]:
    stages = build_default_pipeline()
    nodes = [{"id": s.stage_id, "role": s.role} for s in stages]
    edges = [
        {"from": stages[i].stage_id, "to": stages[i + 1].stage_id}
        for i in range(len(stages) - 1)
    ]
    return {"nodes": nodes, "edges": edges}


def validate_layout() -> list[str]:
    errors: list[str] = []
    base = _base_dir()
    pipeline_state_schema = base / "schemas" / "pipeline_state.schema.json"
    if not pipeline_state_schema.is_file():
        errors.append(f"missing schema: {pipeline_state_schema}")

    for stage in build_default_pipeline():
        if not stage.prompt_path.is_file():
            errors.append(f"missing prompt: {stage.prompt_path}")
        if not stage.output_schema_path.is_file():
            errors.append(f"missing schema: {stage.output_schema_path}")
    return errors
