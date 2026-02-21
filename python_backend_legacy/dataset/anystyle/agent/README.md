# Human-Labeled Gold Agent

This folder contains a human-in-the-loop annotation agent for AnyStyle gold labels.

## Scripts
- `build_queue.py`: build `queue.tsv` from extracted references.
- `suggest_labels.py`: fill `suggest_*` columns using AnyStyle parse.
- `validate_queue.py`: validate rows and set `validation_status`.
- `export_gold_xml.py`: export approved+valid rows to `training/gold_labels.human.xml`.
- `run_agent_cycle.py`: run one full cycle.

## Queue Format (`queue.tsv`)
Important columns:
- `status`: `todo|approved|skip|rejected`
- `validation_status`: `valid|invalid|skipped`
- `reference_text`, `json_file`, `pdf_path`
- `suggest_*`: auto-suggested labels
- `final_*`: human-corrected labels (override suggestions)

## Typical Workflow
1. Build queue + suggestions:
```bash
cd /home/pantera/projects/TEIA
python3 python_backend_legacy/dataset/anystyle/agent/run_agent_cycle.py --max-rows 1000 --suggest-limit 1000
```

2. Human review `queue.tsv`:
- set `status=approved` for good rows
- edit `final_*` where needed
- set `status=skip` or `rejected` for bad rows

3. Validate + export:
```bash
cd /home/pantera/projects/TEIA
python3 python_backend_legacy/dataset/anystyle/agent/validate_queue.py --queue-tsv python_backend_legacy/dataset/anystyle/agent/queue.tsv
python3 python_backend_legacy/dataset/anystyle/agent/export_gold_xml.py --queue-tsv python_backend_legacy/dataset/anystyle/agent/queue.tsv --output-xml python_backend_legacy/dataset/anystyle/training/gold_labels.human.xml --min-rows 100
```

4. Train with human gold:
```bash
cd /home/pantera/projects/TEIA/annotarium
./scripts/anystyle.sh train /home/pantera/projects/TEIA/python_backend_legacy/dataset/anystyle/training/gold_labels.human.xml /home/pantera/projects/TEIA/python_backend_legacy/dataset/anystyle/models/custom_human.mod
```
