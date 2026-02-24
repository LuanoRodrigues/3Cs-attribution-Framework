# annotarium/agents

Minimal agent-pipeline assets for staged extraction.

## Layout
- `prompts/`: role prompts per stage agent.
- `schemas/`: JSON Schemas for stage outputs plus pipeline state.
- `tests/`: smoke tests for imports and dry-run graph.
- `pipeline.py`: lightweight stage graph and asset checks.

## Stages
1. `stage0_document_metadata` -> document metadata extraction.
2. `stage1_markdown_parse` -> structural markdown parse.
3. `stage2_claim_extraction` -> attribution claim extraction.

## Usage
Run dry-run graph:

```bash
python3 -c "from annotarium.agents import dry_run_graph; print(dry_run_graph())"
```

Run smoke tests:

```bash
python3 -m unittest discover -s annotarium/agents/tests -p 'test_*.py'
```

## Architecture
- The graph is linear and deterministic for smoke validation.
- Each stage references a prompt file and an output schema file.
- `pipeline_state.schema.json` defines orchestrator state for multi-stage execution.
