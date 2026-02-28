"""isr_analytic_essay_pipeline.py

Purpose
-------
Generate an International Studies Review (ISR) *Analytical Essay* manuscript in
HTML using a Jinja2 template that encodes ISR’s structural and style
requirements.

This pipeline is designed for LLM-assisted drafting at scale:
- You feed in section-level HTML fragments (abstract/introduction/etc.).
- You optionally use inline footnote markers ("[[FN: ...]]") in those
  fragments.
- The pipeline converts markers into numbered footnote references and builds a
  footnotes section (ISR requires footnotes, not endnotes).
- It computes approximate word counts and emits compliance warnings (e.g.,
  >15,000 words).
- It validates figure metadata for accessibility (alt text) and flags common
  "colour-only" references.

Sources used to encode the rules
--------------------------------
The rule-set implemented here is derived from three publicly available ISR/OUP
resources:

1) *ISR Submission Guidelines* (DOCX):
   - Analytical essays integrate scholarship, clarify debates, provide new
     perspectives, identify new directions.
   - ≤ 15,000 words including references.
   - 1.5 (preferred) or double spaced throughout, excluding figures/tables.
   - Short quotes in quotation marks; long quotes indented; bracket edits; use
     ellipses; indicate emphasis.
   - Footnotes only.
   - Figures/tables inline near first mention; refer to "supplementary files";
     do not call them "online appendixes".
   - Limit self-citations for double-blind review; do not use placeholders like
     "author"; cite yourself in the third person; quote your own text explicitly.
   - Chicago author–date citations; include page numbers even for paraphrases.

   The ISR guidelines also encourage authors to reflect on documented gender
   citation gaps in IR scholarship when finalizing manuscripts.

2) *ISR Style Checklist (Chicago Manual of Style)* (PDF):
   - US spelling; serial comma; numbers 1–100 spelled out (exceptions).
   - Abbreviation handling (define in abstract then redefine in text).
   - Chicago author–date in-text citations (Author Year, page-range) and ISR
     bibliography formatting examples.

3) *OUP Making Figures Accessible (Journals edition, v2.2 May 2024)* (PDF):
   - Do not convey meaning only through colour.
   - WCAG contrast guidance (non-text objects ≥ 3:1; normal text ≥ 4.5:1; large
     text ≥ 3:1).
   - Alt text best practices: objective, standalone (avoid "Image of"), end with
     a period; avoid formatting like bullet points; multi-panel figures get
     per-panel descriptions.

What you provide (input contract)
---------------------------------
A JSON file ("context JSON") containing the fields below.

Required fields
~~~~~~~~~~~~~~~
- topic: str
- manuscript_title: str (if omitted, topic used)

- abstract_html: str  (HTML fragment)
- introduction_html: str
- literature_review_html: str
- analysis_html: str
- implications_html: str
- conclusion_html: str

Optional fields (highly recommended)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
- blinded: bool
  If true, do not render identifying information in the output.

- include_title_page: bool
  If true *and* blinded=false, include an author/title page section.

- authors_list: str
- affiliation: str
- corresponding_author: str
- keywords: list[str]

- acknowledgements_html: str
- funding_html: str
- disclosures_html: str

- supplementary_note_html: str
  Use this to tell reviewers when to consult "supplementary files".
  Do not label as "online appendix".

Figures / tables (for QA, and optional rendering)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
Figures should be placed inline near first mention in the main text.
This pipeline can validate figure metadata even if you embed figures directly
in the section HTML.

- figures: list[dict]
  Each dict may include:
  - src: str               (image path/URL)
  - caption_html: str      (HTML fragment)
  - alt_text: str          (required for accessibility)
  - credit: str            (optional)

- tables: list[dict]
  Each dict may include:
  - title: str
  - table_html: str        (full HTML table markup)
  - note_html: str         (optional)

References
~~~~~~~~~~
- references_list: list[dict]
  Each dict: {"html_string": "..."}

Footnotes
~~~~~~~~~
You have two ways to supply footnotes:

A) Preferred (LLM-friendly): inline markers in section HTML fragments:
   Insert markers like:
     [[FN: This is a footnote with a citation (Spruyt 1994, 63–67).]]
   The pipeline will:
     - Replace the marker with a numbered superscript reference.
     - Add the footnote text to the Footnotes section.

B) Direct list:
   - footnotes: list[str]  (HTML strings)

If both are present, inline markers are appended after provided footnotes.

Outputs
-------
- Rendered HTML manuscript (default: ./out/isr_analytic_essay.html)
- A JSON manifest with:
  - word counts
  - warnings
  - (optional) errors

How to run
----------
python isr_analytic_essay_pipeline.py \
  --context /path/to/context.json \
  --template /path/to/isr_analytic_essay_template.html \
  --outdir /path/to/out

Notes on “exact rules”
----------------------
This pipeline enforces the *structural* rules and emits warnings for
hard-to-validate items. Some checklist items (US spelling, serial comma,
restrictive “that” vs non-restrictive “which”) are stylistic and not reliably
validated automatically; those are surfaced via the template’s optional internal
checklist.

"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Tuple

from jinja2 import Environment, FileSystemLoader, select_autoescape

_THIS_FILE = Path(__file__).resolve()
_REPO_ROOT = _THIS_FILE.parents[1]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))


# ---------------------------
# Utilities
# ---------------------------

_FN_PATTERN = re.compile(r"\[\[FN:(.*?)\]\]", re.DOTALL)


def strip_html(html: str) -> str:
    """Very lightweight HTML stripping for word-counting.

    This is not a full HTML parser; it is intended for approximate word count.
    """
    if not html:
        return ""
    text = re.sub(r"<\s*br\s*/?>", " ", html, flags=re.I)
    text = re.sub(r"</p\s*>", " ", text, flags=re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def count_words(text: str) -> int:
    if not text:
        return 0
    tokens = re.findall(r"\b\w+(?:[-']\w+)*\b", text)
    return len(tokens)


def extract_and_replace_footnotes(section_html: str, start_index: int = 1) -> Tuple[str, List[str]]:
    """Replace [[FN: ...]] markers with superscript links and return footnote list.

    Returns
    -------
    new_html: str
        Section HTML with footnote markers replaced.
    footnotes: list[str]
        Extracted footnote bodies (HTML escaped by caller if needed).
    """
    footnotes: List[str] = []

    def _repl(match: re.Match) -> str:
        nonlocal start_index
        body = match.group(1).strip()
        n = start_index
        start_index += 1
        footnotes.append(body)
        return f"<sup><a href='#fn{n}' id='fnref{n}'>{n}</a></sup>"

    new_html = _FN_PATTERN.sub(_repl, section_html or "")
    return new_html, footnotes


# ---------------------------
# Validation
# ---------------------------

@dataclass
class ValidationResult:
    warnings: List[str]
    errors: List[str]


def validate_word_limit(total_words: int, limit: int = 15000) -> ValidationResult:
    warnings, errors = [], []
    if total_words > limit:
        warnings.append(
            f"Word count appears to exceed ISR limit: {total_words} > {limit} (limit includes references; confirm manually)."
        )
    return ValidationResult(warnings=warnings, errors=errors)


def validate_blinding(text: str) -> ValidationResult:
    """Heuristic checks for common blinding failures."""
    warnings, errors = [], []

    # Placeholder patterns that violate ISR guidance (use third person, not "Author").
    if re.search(r"\b(author|authors)\b\s*(\(|\[)?\s*\d{4}", text, flags=re.I):
        warnings.append("Found potential self-citation placeholder like 'author (YYYY)'. ISR asks you not to use placeholders; cite in third person.")

    if re.search(r"\b(blinded|anonymized)\b", text, flags=re.I):
        warnings.append("Manuscript text mentions 'blinded/anonymized'. Consider removing meta-commentary from the manuscript body.")

    return ValidationResult(warnings=warnings, errors=errors)


def validate_author_date_pages(text: str) -> ValidationResult:
    """Heuristic check for author–date citations missing page numbers.

    ISR asks that citations *usually* include page numbers even for paraphrases.
    This cannot be guaranteed programmatically; we flag common patterns.
    """
    warnings, errors = [], []

    # Pattern: (Spruyt 1994) or (Spruyt, 1994) => likely missing pages.
    suspect = re.findall(r"\(([^\)]+?)\b(19\d{2}|20\d{2})\)" , text)
    if suspect:
        warnings.append(
            "Detected parenthetical citations that end right after the year (e.g., '(Author 1994)'). ISR usually expects page/locators '(Author 1994, 63–67)'."
        )

    # Another pattern: Author (1994) without pages.
    if re.search(r"\b[A-Z][A-Za-z\-]+\s*\(\s*(19\d{2}|20\d{2})\s*\)", text):
        warnings.append(
            "Detected narrative citations like 'Author (1994)' without page/locator. ISR usually expects 'Author (1994, 63–67)'."
        )

    return ValidationResult(warnings=warnings, errors=errors)


def validate_colour_only_references(text: str) -> ValidationResult:
    """Flag phrases that may rely on colour as the only cue in describing figures."""
    warnings, errors = [], []

    colour_terms = r"red|green|blue|yellow|orange|purple|black|white|grey|gray"
    object_terms = r"line|bar|area|curve|segment|slice|dot|marker|region"
    if re.search(rf"\b({colour_terms})\b\s+\b({object_terms})\b", text, flags=re.I):
        warnings.append(
            "Found phrases like 'red line/blue bar'. OUP figure accessibility guidance recommends not communicating meaning only through colour; add labels/markers/patterns."
        )

    return ValidationResult(warnings=warnings, errors=errors)


def validate_supplementary_language(text: str) -> ValidationResult:
    """ISR asks authors to refer to 'supplementary files' (not 'online appendixes')."""
    warnings, errors = [], []
    if re.search(r"\bonline\s+appendix|\bonline\s+appendix(?:es)?|\bonline\s+appendi(?:x|ces)", text, flags=re.I):
        warnings.append(
            "Found 'online appendix/appendices' wording. ISR guidelines ask you to refer to 'supplementary files' uploaded to ScholarOne instead."
        )
    return ValidationResult(warnings=warnings, errors=errors)


def validate_figures(figures: List[Dict[str, Any]] | None) -> ValidationResult:
    warnings, errors = [], []
    figures = figures or []

    for i, fig in enumerate(figures, start=1):
        alt = str(fig.get("alt_text", "") or "").strip()
        cap = str(fig.get("caption_html", "") or "").strip()

        if not cap:
            warnings.append(f"Figure {i} has no caption_html. Provide a descriptive caption.")

        if not alt:
            warnings.append(f"Figure {i} is missing alt_text. OUP recommends alt text submitted alongside captions.")
        else:
            if re.match(r"^(image|picture|photo)\s+of\b", alt.strip(), flags=re.I):
                warnings.append(f"Figure {i} alt_text starts with 'Image/Picture/Photo of'. OUP guidance suggests avoiding that phrasing.")
            if "\n" in alt:
                warnings.append(f"Figure {i} alt_text contains newlines. OUP suggests keeping alt text simple and avoiding formatting.")
            if not alt.endswith("."):
                warnings.append(f"Figure {i} alt_text does not end with a period. OUP guidance suggests ending with a full stop.")

    return ValidationResult(warnings=warnings, errors=errors)


# ---------------------------
# Rendering
# ---------------------------

SECTION_KEYS = [
    "abstract_html",
    "introduction_html",
    "literature_review_html",
    "analysis_html",
    "implications_html",
    "conclusion_html",
]


def build_context(raw: Dict[str, Any]) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """Prepare a render context and manifest information."""

    # Copy raw to avoid mutation surprises
    ctx: Dict[str, Any] = dict(raw)

    ctx.setdefault("topic", "")
    ctx.setdefault("manuscript_title", ctx.get("topic", ""))
    ctx.setdefault("blinded", True)
    ctx.setdefault("include_title_page", False)
    ctx.setdefault("include_internal_checklist", False)
    ctx.setdefault("render_assets_appendix", False)

    # Ensure required sections exist
    for k in SECTION_KEYS:
        ctx.setdefault(k, "")

    # Footnote processing
    provided_footnotes = list(ctx.get("footnotes", []) or [])
    collected_footnotes: List[str] = []
    next_n = 1 + len(provided_footnotes)

    for k in SECTION_KEYS + ["methods_html", "supplementary_note_html"]:
        if k in ctx and isinstance(ctx.get(k), str):
            new_html, fns = extract_and_replace_footnotes(ctx[k], start_index=next_n)
            ctx[k] = new_html
            if fns:
                collected_footnotes.extend(fns)
                next_n += len(fns)

    ctx["footnotes"] = provided_footnotes + collected_footnotes

    # Word count (approx)
    main_text = " ".join(strip_html(ctx.get(k, "")) for k in SECTION_KEYS)
    foot_text = strip_html(" ".join(ctx.get("footnotes", []) or []))
    refs_text = strip_html(" ".join([r.get("html_string", "") for r in (ctx.get("references_list") or []) if isinstance(r, dict)]))

    main_words = count_words(main_text)
    foot_words = count_words(foot_text)
    refs_words = count_words(refs_text)
    total_words = main_words + foot_words + refs_words

    ctx["word_count"] = ctx.get("word_count") or total_words
    ctx.setdefault("generation_date", datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC"))

    manifest = {
        "counts": {
            "main_text_words": main_words,
            "footnotes_words": foot_words,
            "references_words": refs_words,
            "total_words_estimate": total_words,
        },
        "warnings": [],
        "errors": [],
    }

    return ctx, manifest


def render(template_path: Path, context: Dict[str, Any]) -> str:
    env = Environment(
        loader=FileSystemLoader(str(template_path.parent)),
        autoescape=select_autoescape(["html", "htm", "xml"]),
    )
    template = env.get_template(template_path.name)
    return template.render(**context)


def run(context_path: Path, template_path: Path, outdir: Path) -> Dict[str, Any]:
    raw = json.loads(context_path.read_text(encoding="utf-8"))
    ctx, manifest = build_context(raw)

    # Validation
    full_text_for_checks = " ".join([
        strip_html(ctx.get(k, "")) for k in SECTION_KEYS
    ]) + " " + strip_html(" ".join(ctx.get("footnotes", []) or []))

    vr = validate_word_limit(manifest["counts"]["total_words_estimate"], limit=15000)
    manifest["warnings"].extend(vr.warnings)
    manifest["errors"].extend(vr.errors)

    vr = validate_blinding(full_text_for_checks)
    manifest["warnings"].extend(vr.warnings)
    manifest["errors"].extend(vr.errors)

    vr = validate_author_date_pages(full_text_for_checks)
    manifest["warnings"].extend(vr.warnings)
    manifest["errors"].extend(vr.errors)

    vr = validate_colour_only_references(full_text_for_checks)
    manifest["warnings"].extend(vr.warnings)
    manifest["errors"].extend(vr.errors)

    vr = validate_supplementary_language(full_text_for_checks)
    manifest["warnings"].extend(vr.warnings)
    manifest["errors"].extend(vr.errors)

    vr = validate_figures(ctx.get("figures"))
    manifest["warnings"].extend(vr.warnings)
    manifest["errors"].extend(vr.errors)

    # References presence (ISR requires a references section)
    if not (ctx.get("references_list") or []):
        manifest["warnings"].append("No references_list provided. ISR requires a references section at the end of the manuscript.")

    # Render HTML
    outdir.mkdir(parents=True, exist_ok=True)
    html = render(template_path, ctx)

    out_html = outdir / "isr_analytic_essay.html"
    out_html.write_text(html, encoding="utf-8")

    out_manifest = outdir / "isr_analytic_essay_manifest.json"
    out_manifest.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    return {
        "status": "ok",
        "output_html": str(out_html),
        "manifest_json": str(out_manifest),
        "counts": manifest["counts"],
        "warnings": manifest["warnings"],
        "errors": manifest["errors"],
    }


def build_argparser() -> argparse.ArgumentParser:
    repo = Path(__file__).resolve().parents[1]
    p = argparse.ArgumentParser(description="Render an ISR analytical essay HTML manuscript from context JSON.")
    p.add_argument("--mode", choices=["render_context", "phase2_pipeline"], default="render_context")
    p.add_argument("--context", help="Path to context.json (render_context mode)")
    p.add_argument("--template", default=str(repo / "Research" / "templates" / "isr_analytic_essay_template.html"), help="Path to isr_analytic_essay_template.html")
    p.add_argument("--outdir", default=str(repo / "Research" / "outputs" / "Attribution_of_Cyberattacks_-_Phase_2_Expansion" / "ISR"), help="Output directory")
    p.add_argument("--summary-path")
    p.add_argument(
        "--systematic-context-path",
        default=str(repo / "Research" / "outputs" / "Attribution_of_Cyberattacks_-_Phase_2_Expansion" / "systematic_review_context.json"),
    )
    p.add_argument(
        "--critical-context-path",
        default=str(repo / "Research" / "outputs" / "Attribution_of_Cyberattacks_-_Phase_2_Expansion" / "CRR" / "critical_review_context.json"),
    )
    p.add_argument("--model", default="gpt-5-mini")
    p.add_argument("--citation-style", default="apa")
    p.add_argument("--function-name", default="systematic_review_section_writer")
    return p


def main() -> int:
    args = build_argparser().parse_args()
    if args.mode == "phase2_pipeline":
        if not args.summary_path:
            raise SystemExit("--summary-path is required when --mode phase2_pipeline")
        from Research.pipeline.run_phase2_isr_analytic_essay_template import run_pipeline

        result = run_pipeline(
            summary_path=Path(args.summary_path).expanduser().resolve(),
            systematic_context_path=Path(args.systematic_context_path).expanduser().resolve(),
            critical_context_path=Path(args.critical_context_path).expanduser().resolve(),
            template_path=Path(args.template).expanduser().resolve(),
            outdir=Path(args.outdir).expanduser().resolve(),
            model=str(args.model),
            citation_style=str(args.citation_style),
            function_name=str(args.function_name),
        )
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0

    if not args.context:
        raise SystemExit("--context is required when --mode render_context")
    result = run(
        context_path=Path(args.context).expanduser().resolve(),
        template_path=Path(args.template).expanduser().resolve(),
        outdir=Path(args.outdir).expanduser().resolve(),
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
