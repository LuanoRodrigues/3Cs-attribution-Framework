# Annotarium aggregated results

This folder stores a single-file result package for the latest `annotarium/outputs` run.

## Output file

- `results_aggregated.json`

It contains a single JSON object with:
- `artifacts.extraction`
- `artifacts.adapters`
- `artifacts.methodology`
- `artifacts.scoring`
- `artifacts.reports`
- `artifacts.validation`
- optional `artifacts.root` (pipeline summaries when enabled)

Each file entry includes:
- `file_name`
- `file_path`
- `size_bytes`
- `sha256`
- `content` (parsed JSON when possible, otherwise plain text)

Use this when you want one portable file instead of per-folder copies.
