# AnyStyle Improvement Report (20260217T162540Z)

- Benchmark dev: `/home/pantera/projects/TEIA/python_backend_legacy/dataset/anystyle/training/dev.v3.xml`
- Candidate model: `/home/pantera/projects/TEIA/python_backend_legacy/dataset/anystyle/models/custom_auto_20260217T162540Z.mod`
- Baseline model: `/home/pantera/projects/TEIA/python_backend_legacy/dataset/anystyle/models/custom_v2.mod`
- Decision: `promote_candidate`

## Metrics
- Candidate on pipeline dev: seq `26.97%` (24), tok `3.44%` (67)
- Candidate on benchmark: seq `80.00%` (28), tok `20.09%` (133)
- Baseline on benchmark: seq `0.00%` (0), tok `0.00%` (0)

## Promotion Guard
- Human gold used: `True`
- Human gold count: `446`
- Min human gold for promotion: `300`
- Promotion blocked: `False`

## K-Fold
- Folds: `3`
- Candidate k-fold avg: seq `27.36%` (41), tok `3.74%` (120)
- Baseline k-fold avg: seq `90.14%` (134), tok `20.26%` (649)
- Promoted model: `/home/pantera/projects/TEIA/python_backend_legacy/dataset/anystyle/models/custom_best.mod`
