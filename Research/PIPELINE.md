# Research Pipeline

## Purpose
Centralize review flow in `Research/pipeline` with one orchestrator and stage-specific modules.

Pipeline stages:
1. research
2. outline
3. article
4. polish

Workflow adapters (retrieve/screening/coding) are executed before stages.

## Entry points
- Main runner: `Research/pipeline/runner.py` (`TEIAResearchPipeline`)
- Retrieve integration: `Research/pipeline/retrieve_integration.py`
  - `run_from_retrieve_payload(...)`
  - `build_pipeline_context(...)`

## Intent routing
`context.intent` controls workflow path.

- `systematic_review` (default)
1. Zotero supervisor (`run_review_supervisor`)
2. Screening (optional)
3. Coding
4. Continue to research/outline/article/polish
5. Optional template rendering (`systematic`/`scoping`)

- `coding_only`
1. Screening (optional)
2. Coding
3. Early return (no outline/article/polish)

## Providers
Evidence providers used by `ResearchStage`:
- `ContextProvider`
- `SynthesisProvider`
- `AiServicesProvider`
- `ThematicLegacyProvider`

Workflow providers used by runner:
- `ZoteroProvider`
- `ScreeningProvider`
- `CodingProvider`

## Retrieve payload contract
Use either snake_case or common camelCase aliases.

Required:
- `topic`
- `collection_name` (or `collectionName`) when using Zotero workflow

Common keys:
- `intent`: `systematic_review` or `coding_only`
- `review_type`: `systematic` or `scoping`
- `render_template`: bool
- `enable_screening`: bool
- `enable_coding`: bool
- `run_eligibility`: bool
- `research_questions`: `list[str]`
- `overarching_theme`: str
- `screening_mode`, `screening_function`
- `coding_mode`, `prompt_key`
- `results_by_item` or `results_by_item_path`
- `results_so_far`
- `legacy_thematic_output`
- `pdf_paths` (fallback coding path)

## Example usage
```python
from Research.pipeline.retrieve_integration import run_from_retrieve_payload

result = run_from_retrieve_payload(
    topic="Cyber attribution frameworks",
    payload={
        "intent": "systematic_review",
        "review_type": "systematic",
        "collectionName": "frameworks",
        "screeningEnabled": True,
        "codingMode": "open",
        "promptKey": "code_pdf_page",
        "researchQuestions": [
            "How is attribution operationalized?",
            "What evidence standards are used?",
        ],
    },
    zotero_client=zt,
)
```

## Artifacts per run
Default root: `tmp/systematic_review/pipeline_runs/<run_id>/`

Generated files:
- `workflow_result.json` (coding_only path)
- `stage_01_research.json`
- `stage_02_outline.md`
- `stage_03_article.md`
- `stage_04_polished.md`
- `rendered_systematic.html` or `rendered_scoping.html` (if enabled)
- `run_summary.json`
- `stage_state.json`

## Notes
- Runner ingests workflow artifacts and attempts to auto-load `results_by_item` paths into context for research aggregation.
- `Research/research_pipeline.py` is a compatibility shim; use `Research.pipeline` directly for new integrations.
