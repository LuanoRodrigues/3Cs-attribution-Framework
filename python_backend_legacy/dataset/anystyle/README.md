# AnyStyle Training Workspace

This folder is for AnyStyle model training artifacts.

## Layout
- `training/`: tagged XML training sets (e.g. `training-data.xml`)
- `models/`: trained model outputs (e.g. `custom.mod`)
- `tmp/`: temporary intermediate files
- `exports/`: extracted references or generated helper files

## Build Training Data From Dataset JSON
Use the generator script to extract bibliography references and build a draft XML:

```bash
cd /home/pantera/projects/TEIA
python3 python_backend_legacy/dataset/anystyle/build_training_data.py --build-draft-xml
```

Generated files:
- `exports/references_raw.txt` (one reference per line)
- `exports/references_with_source.tsv` (reference + source json/pdf path)
- `training/training-data.draft.xml` (auto-tagged draft from AnyStyle parse)

Note: `training-data.draft.xml` is a bootstrap dataset. Curating/correcting tags will improve final model quality.

## Improvement Pipeline
Run the end-to-end pipeline (extract -> seed labels -> curation -> split -> train -> evaluate -> decision report):

```bash
cd /home/pantera/projects/TEIA
python3 python_backend_legacy/dataset/anystyle/run_improvement_pipeline.py
```

Promote automatically if candidate beats baseline:

```bash
cd /home/pantera/projects/TEIA
python3 python_backend_legacy/dataset/anystyle/run_improvement_pipeline.py --promote
```

Use k-fold evaluation for more robust promotion decisions:

```bash
cd /home/pantera/projects/TEIA
python3 python_backend_legacy/dataset/anystyle/run_improvement_pipeline.py --kfold 3 --promote
```

Outputs:
- `models/custom_auto_<timestamp>.mod` (candidate model)
- `reports/improvement_report_<timestamp>.json`
- `reports/improvement_report_<timestamp>.md`

By default, the pipeline prefers `training/gold_labels.human.xml` when present (>= 50 sequences).  
Disable this fallback behavior with:

```bash
python3 python_backend_legacy/dataset/anystyle/run_improvement_pipeline.py --no-prefer-human-gold
```

Promotion guard:
- Model promotion is blocked unless human gold has at least `300` sequences.
- Override threshold if needed:

```bash
python3 python_backend_legacy/dataset/anystyle/run_improvement_pipeline.py --min-human-gold-for-promotion 500 --promote
```

Promotion decision rule (strict):
- Candidate is promoted only if:
  1. k-fold average is better than baseline, and
  2. benchmark dev (`dev.v3.xml` if present) is non-regressive vs baseline.

## Human Gold Agent
For human-in-the-loop annotation workflow, use:
- `python_backend_legacy/dataset/anystyle/agent/README.md`

## Example
```bash
cd /home/pantera/projects/TEIA/annotarium
./scripts/anystyle.sh train \
  /home/pantera/projects/TEIA/python_backend_legacy/dataset/anystyle/training/training-data.draft.xml \
  /home/pantera/projects/TEIA/python_backend_legacy/dataset/anystyle/models/custom.mod
```
