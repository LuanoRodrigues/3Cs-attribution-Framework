# Screen Tool Schema

## Required columns
- `pdf_path`: local path to the PDF for the item.

## Researcher columns
- `screen_decision`: `include` | `exclude` | `maybe` | (blank for uncoded).
- `screen_codes`: free-form comma-separated tags.
- `screen_comment`: researcher notes/justification.
- `screen_blind`: `1`/`true` to hide LLM decision, blank otherwise.

## LLM assist columns
- `llm_screen_decision`: `include` | `exclude` | `maybe` (LLM suggestion).
- `llm_screen_justification`: single-sentence rationale.

## Legacy fallback columns (auto-mapped)
- `status` → `llm_screen_decision`
- `justification` → `llm_screen_justification`
