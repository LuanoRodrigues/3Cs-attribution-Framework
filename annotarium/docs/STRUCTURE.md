# Annotarium Structure

## Apps
- `annotarium/apps/electron/threec_electron_viewer/` - Electron viewer app.

## Docs
- `annotarium/docs/` - Methodology, framework, pipeline, and mapping docs.

## Outputs
- `annotarium/outputs/extraction/` - Extraction JSON outputs.
- `annotarium/outputs/scoring/` - ICJ/minimal scoring artifacts.
- `annotarium/outputs/reports/` - Combined report JSONs (raw + scores).
- `annotarium/outputs/validation/` - Validation reports.
- `annotarium/outputs/adapters/` - Adapter/intermediate JSON used by scorer variants.

## Pipelines and Code
- `annotarium/*.py` - Extraction/scoring/validation runners and core scripts.
- `annotarium/agents/` - Agent pipeline implementation and tools.
- `annotarium/scripts/` - Utility shell scripts.

## Data and Runs
- `annotarium/Reports/` - Input reports and per-report artifacts.
- `annotarium/session/` - Historical pipeline runs and stage outputs.
- `annotarium/cache/` - Cached markdown/OCR/intermediate data.
