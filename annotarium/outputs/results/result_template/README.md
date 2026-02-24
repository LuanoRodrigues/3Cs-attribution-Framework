# Result template bundle

This folder is a reusable template for a full run result package. Files are copied from
the corresponding folders under `annotarium/outputs/` so this can be shared, archived,
or compared across runs.

## Contents

- `extraction/` - canonical extraction outputs and claim payload variants.
- `adapters/` - scorer adapter payloads.
- `methodology/` - structured methodology JSON and rendered methodology HTML.
- `scoring/` - scoring outputs, per-claim/claim-set score breakdowns, and audit logs.
- `reports/` - report JSONs and portfolio-level summary.
- `validation/` - validation JSON and Markdown.
- `manifest.json` - generated metadata (source path, target path, byte size, SHA-256) for each copied file.

## Rebuild this template

```bash
python3 annotarium/scripts/build_result_template.py --overwrite
```

For custom inputs/results roots, use `--outputs-root` and `--results-root`.
