# Cyber Attribution Markdown Extraction Pipeline (Next Run)

## Goal
Produce a **schema-valid** and **analysis-ready** `annotarium/output.json` from cached markdown, with reliable tables, citations/sources, artifact normalization, and evidence-grounded Six-C blocks.

## Scope
- Input markdown: `annotarium/cache/pdf_markdown/<hash>.full_text.md`
- Schema: `annotarium/cyber_attribution_markdown_extraction_v2_schema.json`
- Output: `annotarium/output.json`
- Default mode: **offline deterministic extraction** (no API).

---

## Stage 0: Preconditions
- Confirm OCR/cache exists and is current.
- Confirm markdown is the target document and not empty.
- Confirm schema file exists and is unchanged for the run.
- Record run metadata: timestamp, script commit/version, input file hash.

Commands:
```bash
ls -lh annotarium/cache/pdf_markdown/*.full_text.md
ls -lh annotarium/cyber_attribution_markdown_extraction_v2_schema.json
```

---

## Stage 1: Build Parse Layer (Stage1 in output)

### 1.1 Page/section policy
- If there are no explicit page markers in markdown, use:
  - `page_marker_policy = "no_page_markers_single_page0"`
  - `page_count = 1`
  - `page_index = 0`
- Keep `page_label` consistent with this policy (use `null` or a documented convention, avoid ambiguous `"1"` unless explicitly intentional).

### 1.2 Text blocks
- Extract section headings from markdown headings.
- Keep text blocks concise and non-duplicative.
- If a table is extracted into `tables[]`, replace full table body in text block with a short stub note.

### 1.3 Tables (critical fix)
- Detect markdown pipe tables and map them into `tables[]` objects.
- Populate required fields: `table_markdown`, `table_cells`, `table_csv`, `table_text_verbatim`, `location`.
- Do not leave structured tables only inside `text_verbatim`.

### 1.4 Figures
- Extract figure markers and captions.
- Normalize figure numbering and keep caption text verbatim where possible.
- If no binary/image URI exists, keep `image_ref` as marker-level reference and note that it is markdown-only.

### 1.5 Citations and sources (critical fix)
- `citations_found[]` must contain **bibliographic citations**, not generic inline links.
- Inline non-bibliographic URLs go to `artifacts_found[]` (type `url`) only.
- URL normalization rules:
  - strip trailing punctuation and superscript footnote markers,
  - do not truncate URLs,
  - keep canonical `http(s)://...` in normalized fields.
- Source year extraction rules:
  - only accept standalone 4-digit years in date-like context,
  - reject numeric fragments from IDs/names (e.g., `Project 2049`, `catalog_id=101913`).
- Ensure each citation `resolved_source_id` points to an existing source, or `null`.

### 1.6 Artifacts (critical fix)
- Extract and normalize separately:
  - `url` (full URL),
  - `domain` (hostname only),
  - optional `file_name` (path tail).
- Domain classification must reject path/file fragments such as:
  - `person1266063.html`, `downloadArticleFile.do`, `CF182.html`, `redir.php`, `BaoMingInfo.aspx`.
- Clean email artifacts:
  - remove HTML wrappers and trailing quote/footnote noise.
- Enforce schema patterns (hash lengths, CVE format, URL format, etc.).

---

## Stage 2: Claim + Six-C Layer (Stage2 in output)

### 2.1 Claim typing and component hygiene
- Keep claim type aligned with statement semantics.
- Do not mix components that are not asserted by the claim statement.
- Separate identity claims from sponsorship/responsibility claims when text evidence differs.

### 2.2 Evidence grounding rule (critical fix)
- `sources_supporting_claim[]` entries must contain anchors that actually support the claim from that source context.
- If external source text is not available:
  - include source in `sources_index`,
  - do **not** claim it as supporting evidence in `sources_supporting_claim`,
  - keep corroboration conservative (internal-only where applicable).

### 2.3 Corroboration integrity
- `corroboration_matrix` must reflect real support relationships, not placeholder propagation from claim text.
- Source counts and unique source entities must be computed from actual mapped support.

### 2.4 Confidence/compliance honesty
- If no confidence scale appears in text, mark `defined_in_document = false`.
- If no legal test mapping is present in text, keep legal references/mapping minimal and explicit about limits.

---

## Stage 3: Validation and Quality Gates

### 3.1 Hard gate (must pass)
- JSON Schema validation: pass.
- No broken references:
  - citation `resolved_source_id` exists or null,
  - IDs match pattern constraints.

### 3.2 Soft quality gates (must pass for “analysis-ready”)
- Tables:
  - if table markers exist in markdown, `tables[]` must be non-empty.
- Citations:
  - bibliographic precision: non-bibliographic links excluded from `citations_found[]`.
- Sources:
  - no obvious year mis-parses (2049 from organization names, 1913 from IDs, etc.).
- Artifacts:
  - no path/file fragments misclassified as domain.
  - malformed email/url artifacts cleaned.
- Six-C:
  - no unsupported “source supports claim” mappings.

---

## Stage 4: Run Commands (Reference)

### 4.1 Generate OCR/cache markdown
```bash
ANNOTARIUM_HOME=/home/pantera/projects/TEIA/annotarium ./.venv/bin/python my-electron-app/scripts/process_pdf_mistral_ocr.py
```

### 4.2 Offline extraction (default)
```bash
python3 annotarium/apply_schema_extraction_offline.py \
  --schema annotarium/cyber_attribution_markdown_extraction_v2_schema.json \
  --markdown annotarium/cache/pdf_markdown/<hash>.full_text.md \
  --output annotarium/output.json
```

### 4.3 Validate output explicitly
```bash
python3 - <<'PY'
import json, jsonschema
from pathlib import Path
schema = json.loads(Path("annotarium/cyber_attribution_markdown_extraction_v2_schema.json").read_text())["schema"]
out = json.loads(Path("annotarium/output.json").read_text())
jsonschema.validate(instance=out, schema=schema)
print("validation_ok")
PY
```

### 4.4 Batch process existing markdown files only
```bash
python3 annotarium/run_reports_pipeline.py \
  --reports-dir annotarium/Reports \
  --recursive \
  --md-only
```

---

## Stage 5: Post-Run Review Checklist
- Check at least 3 claims for evidence-grounding correctness.
- Manually inspect 10 random artifacts across types.
- Manually inspect all extracted tables and at least 5 citations.
- Confirm source years against citation text.
- If any hard/soft gate fails, fix extractor and rerun; do not ship partial quality.

---

## Known Prior Mistakes to Prevent
- Empty `tables[]` while table content exists in text blocks.
- Citation/source contamination by generic URLs.
- Year extraction from IDs/names.
- Domain false positives from file/path fragments.
- Six-C corroboration populated without independent evidence anchors.
