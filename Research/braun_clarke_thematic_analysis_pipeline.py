"""Braun & Clarke Thematic Analysis: template renderer + authoring checklist

Goal
----
Render a Braun & Clarke-aligned thematic analysis manuscript/report from a JSON
context into a single HTML file using the companion Jinja2 template:

  - braun_clarke_thematic_analysis_template.html

This is designed for LLM-driven drafting (scalable, fillable fields) and for
human revision.

Primary sources for the conceptual "contract" encoded here
----------------------------------------------------------
Six-phase (reflexive) TA process (Braun & Clarke):
  https://www.thematicanalysis.net/doing-reflexive-ta/

15-point quality checklist (updated; reproduced on the authors' TA site):
  https://www.thematicanalysis.net/faqs/

Editor/reviewer evaluation prompts (20 questions; Clarke & Braun):
  https://cdn.auckland.ac.nz/assets/psych/about/our-research/documents/Checklist%20for%20reviewers%20and%20editors%20evaluating%20thematic%20analysis%20manuscripts.pdf


Context schema (JSON)
---------------------
All keys referenced in the template must exist in the JSON (this script renders
with StrictUndefined). Use empty strings, empty lists, or null when you intend
to omit a section.

Top-level metadata
  topic: str
  manuscript_title: str
  blinded: bool
  authors_list: str
  affiliation: str
  corresponding_author: str | null
  generation_date: str
  ai_models_used: str
  keywords: list[str] | []

Front matter
  abstract_html: str | ""  (HTML)

Introduction
  introduction_html: str | "" (HTML)
  research_questions_html: str | "" (HTML)

Method
  ta_type: str
    Examples:
      - "Reflexive thematic analysis (Braun & Clarke)"
      - "Codebook / framework TA" (only if you actually do it)
      - "Coding reliability TA" (only if you actually do it)

  ta_rationale_html: str | "" (HTML)
  theoretical_position_html: str | "" (HTML)
  reflexivity_html: str | "" (HTML)

  data_context_html: str | "" (HTML)
  sampling_html: str | "" (HTML)
  data_collection_html: str | "" (HTML)
  ethics_html: str | "" (HTML)

  analysis_overview_html: str | "" (HTML)

  analysis_phases: list[dict] | []
    Each dict:
      name: str
      what_done_html: str (HTML)

  software_tools_html: str | "" (HTML)
  quality_practices_html: str | "" (HTML)

Findings
  findings_overview_html: str | "" (HTML)

  thematic_map_figure: dict | null
    src: str (path or URL)
    caption_html: str (HTML)
    alt_text: str
    credit: str | null

  themes: list[dict] | []
    Each theme dict:
      name: str
      central_organising_concept: str | "" | null
      overview_html: str | "" (HTML)
      subthemes: list[dict] | []
        Each subtheme dict:
          name: str
          description_html: str (HTML)
      extracts: list[dict] | []
        Each extract dict:
          source_label: str (e.g., "P03", "Doc12")
          meta: str | "" | null (optional short context)
          quote_html: str (HTML; include quotation marks if you want them)
          analytic_commentary_html: str | "" (HTML)

  additional_figures: list[dict] | []  (same schema as thematic_map_figure)

Discussion
  discussion_html: str | "" (HTML)

Limitations
  limitations_html: str | "" (HTML)

Conclusion
  conclusion_html: str | "" (HTML)

Notes and references
  footnotes: list[str] | []  (HTML strings)
  references_list: list[dict] | []
    Each dict:
      html_string: str (HTML formatted reference entry)

Appendices
  appendices: list[dict] | []
    Each dict:
      title: str
      content_html: str (HTML)

Internal QA / checklist section
  include_internal_checklist: bool


Checklist (author-facing, paraphrased)
-------------------------------------
This checklist is embedded in the template (optional) and also summarised here.
It is intended to prevent "method mash-ups" and improve coherence.

Six phases (reflexive TA) – practical anchors
  1) Immerse in dataset (read/re-read; initial analytic notes).
  2) Code the dataset (often multiple passes; collate relevant extracts).
  3) Draft candidate themes from codes (broader patterns of shared meaning).
  4) Develop/review themes against coded data and entire dataset.
  5) Refine/define/name themes (scope/focus; "story" of each theme).
  6) Write up (integrate narrative + extracts; situate in literature).

15-point quality criteria (from Braun & Clarke; paraphrased)
  - transcription fit-for-purpose and checked
  - comprehensive coding across all data
  - themes not built from anecdotes
  - collate relevant extracts per theme
  - check themes against coded data + dataset
  - themes coherent, distinctive; subthemes aligned
  - interpretation beyond summary
  - extracts evidence claims
  - analysis is convincing + answers RQ
  - balance narrative/extracts
  - adequate time; allow recursion/rework
  - approach + assumptions explicit
  - method described matches analysis shown
  - language matches epistemology/ontology
  - researcher activity visible; themes not claimed to "just emerge"

20 evaluation prompts (editor/reviewer guide; paraphrased)
  Methods/methodology coherence:
    - explain TA use and specify TA type
    - ensure fit with aims, theory, and data collection
    - enact the claimed TA type consistently
    - avoid importing procedures/assumptions from other approaches without justification
    - state theoretical assumptions (inductive ≠ theory-free)
    - include reflexive positioning
    - describe analytic procedure clearly
    - avoid conceptual/procedural confusion (e.g., claiming reflexive TA but using
      codebooks + independent coders + reliability stats)
  Analytic output quality:
    - make themes easy to locate + provide an overview (table/map)
    - avoid domain/topic summaries when claiming fully developed themes
    - separate contextual description from thematic claims
    - ensure applied themes yield actionable implications when relevant
    - avoid conceptual clashes (constructionist claims + positivist reliability logic)
    - ensure extract/claim alignment and good extract balance
    - frame generalisability/transferability appropriately


CLI
---
python braun_clarke_thematic_analysis_pipeline.py \
  --context /path/to/context.json \
  --template /path/to/braun_clarke_thematic_analysis_template.html \
  --outdir /path/to/out

Outputs
-------
outdir/thematic_analysis.html
outdir/manifest.json
outdir/context.resolved.json
"""

import argparse
import json
import re
from pathlib import Path

from jinja2 import Environment
from jinja2 import StrictUndefined


class BraunClarkeValidationError(ValueError):
    pass


def _read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _read_json(path: Path) -> dict:
    return json.loads(_read_text(path))


def _render(template_text: str, context: dict) -> str:
    env = Environment(undefined=StrictUndefined, autoescape=False)
    template = env.from_string(template_text)
    return template.render(**context)


def _strip_html_for_word_count(html: str) -> str:
    html = re.sub(r"<style[\s\S]*?</style>", " ", html)
    html = re.sub(r"<script[\s\S]*?</script>", " ", html)
    html = re.sub(r"<[^>]+>", " ", html)
    html = re.sub(r"\s+", " ", html)
    return html.strip()


def _count_words(text: str) -> int:
    if text == "":
        return 0
    return len(text.split())


def _write_text(path: Path, text: str) -> None:
    path.write_text(text, encoding="utf-8")


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def _norm(value) -> str:
    return str(value or "").strip()


def _contains_any(text: str, patterns: list[str]) -> bool:
    low = _norm(text).lower()
    for p in patterns:
        if re.search(p, low):
            return True
    return False


def _require_nonempty(context: dict, key: str, errors: list[str]) -> None:
    if _norm(context.get(key, "")) == "":
        errors.append(f"Missing required non-empty field: {key}")


def enforce_braun_clarke_methodology(context: dict) -> None:
    """
    Strict quality gate for Braun & Clarke-style thematic analysis reports.
    Raises BraunClarkeValidationError on methodology contract violations.
    """
    errors: list[str] = []

    for key in [
        "topic",
        "manuscript_title",
        "ta_type",
        "ta_rationale_html",
        "theoretical_position_html",
        "reflexivity_html",
        "analysis_overview_html",
        "findings_overview_html",
        "discussion_html",
        "limitations_html",
        "conclusion_html",
    ]:
        _require_nonempty(context, key, errors)

    ta_type = _norm(context.get("ta_type", ""))
    is_reflexive = _contains_any(ta_type, [r"reflexive", r"braun\s*&?\s*clarke", r"braun[\s-]*clarke"])
    if not is_reflexive:
        errors.append("ta_type must explicitly indicate Braun & Clarke reflexive thematic analysis.")

    phases = context.get("analysis_phases")
    if not isinstance(phases, list) or len(phases) < 6:
        errors.append("analysis_phases must include at least 6 phases.")
    else:
        phase_text = " ".join(_norm(p.get("name", "")) + " " + _norm(p.get("what_done_html", "")) for p in phases if isinstance(p, dict))
        required_markers = [
            r"familiari[sz]",
            r"\bcod",
            r"theme",
            r"review",
            r"defin|name",
            r"writ|report"
        ]
        for marker in required_markers:
            if not re.search(marker, phase_text.lower()):
                errors.append(f"analysis_phases missing expected methodological marker: /{marker}/")

    themes = context.get("themes")
    if not isinstance(themes, list) or len(themes) < 2:
        errors.append("themes must contain at least 2 developed themes.")
    else:
        for i, t in enumerate(themes):
            if not isinstance(t, dict):
                errors.append(f"themes[{i}] must be an object.")
                continue
            if _norm(t.get("name", "")) == "":
                errors.append(f"themes[{i}].name is required.")
            if _norm(t.get("overview_html", "")) == "":
                errors.append(f"themes[{i}].overview_html is required.")
            extracts = t.get("extracts")
            if not isinstance(extracts, list) or len(extracts) < 1:
                errors.append(f"themes[{i}] must include at least 1 extract.")
            else:
                has_analytic_commentary = False
                for j, ex in enumerate(extracts):
                    if not isinstance(ex, dict):
                        errors.append(f"themes[{i}].extracts[{j}] must be an object.")
                        continue
                    if _norm(ex.get("quote_html", "")) == "":
                        errors.append(f"themes[{i}].extracts[{j}].quote_html is required.")
                    if _norm(ex.get("analytic_commentary_html", "")) != "":
                        has_analytic_commentary = True
                if not has_analytic_commentary:
                    errors.append(f"themes[{i}] must include analytic_commentary_html for at least one extract.")

    # Reflexive TA should not be framed as coding reliability / inter-rater design
    if is_reflexive:
        joined = " ".join(
            [
                _norm(context.get("analysis_overview_html", "")),
                _norm(context.get("quality_practices_html", "")),
                _norm(context.get("ta_rationale_html", "")),
                _norm(context.get("analysis_phases", "")),
            ]
        ).lower()
        if re.search(r"\b(inter[-\s]?rater|cohen'?s?\s*kappa|fleiss|icc|agreement\s+rate|independent\s+coder|coding\s+reliability)\b", joined):
            errors.append(
                "Reflexive TA inconsistency: detected coding-reliability/inter-rater language. "
                "Remove or justify explicitly if not using reflexive TA."
            )

    if errors:
        raise BraunClarkeValidationError("Braun & Clarke methodology validation failed:\n- " + "\n- ".join(errors))


def _run_render_from_context(*, context_path: Path, template_path: Path, outdir: Path) -> dict:
    outdir.mkdir(parents=True, exist_ok=True)
    context = _read_json(context_path)
    enforce_braun_clarke_methodology(context)
    template_text = _read_text(template_path)
    html = _render(template_text, context)

    out_html = outdir / "thematic_analysis.html"
    _write_text(out_html, html)
    _write_text(outdir / "context.resolved.json", json.dumps(context, indent=2, ensure_ascii=False))

    manifest = {
        "mode": "render_context",
        "manuscript_title": context["manuscript_title"],
        "generation_date": context["generation_date"],
        "blinded": context["blinded"],
        "include_internal_checklist": context["include_internal_checklist"],
        "word_count_approx": _count_words(_strip_html_for_word_count(html)),
        "output_html_path": str(out_html),
        "context_path": str(context_path),
        "template_path": str(template_path),
    }
    _write_text(outdir / "manifest.json", json.dumps(manifest, indent=2, ensure_ascii=False))
    return manifest


def _run_phase2_pipeline(
    *,
    summary_path: Path,
    systematic_context_path: Path,
    critical_context_path: Path,
    template_path: Path,
    outdir: Path,
    model: str,
    citation_style: str,
    function_name: str,
) -> dict:
    from Research.pipeline.run_phase2_braun_clarke_template import run_pipeline  # local import to avoid top-level coupling

    return run_pipeline(
        summary_path=summary_path,
        systematic_context_path=systematic_context_path,
        critical_context_path=critical_context_path,
        template_path=template_path,
        outdir=outdir,
        model=model,
        citation_style=citation_style,
        function_name=function_name,
    )


def main() -> None:
    repo = _repo_root()
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["render_context", "phase2_pipeline"], default="render_context")
    parser.add_argument("--context")
    parser.add_argument("--template", default=str(repo / "Research" / "templates" / "braun_clarke_thematic_analysis_template.html"))
    parser.add_argument("--outdir", default=str(repo / "Research" / "outputs" / "Attribution_of_Cyberattacks_-_Phase_2_Expansion" / "BRAUN_CLARKE"))
    parser.add_argument("--summary-path")
    parser.add_argument(
        "--systematic-context-path",
        default=str(repo / "Research" / "outputs" / "Attribution_of_Cyberattacks_-_Phase_2_Expansion" / "systematic_review_context.json"),
    )
    parser.add_argument(
        "--critical-context-path",
        default=str(repo / "Research" / "outputs" / "Attribution_of_Cyberattacks_-_Phase_2_Expansion" / "CRR" / "critical_review_context.json"),
    )
    parser.add_argument("--model", default="gpt-5-mini")
    parser.add_argument("--citation-style", default="apa")
    parser.add_argument("--function-name", default="systematic_review_section_writer")
    args = parser.parse_args()

    template_path = Path(args.template).resolve()
    outdir = Path(args.outdir).resolve()
    manifest: dict
    if args.mode == "phase2_pipeline":
        if not args.summary_path:
            parser.error("--summary-path is required when --mode phase2_pipeline")
        manifest = _run_phase2_pipeline(
            summary_path=Path(args.summary_path).resolve(),
            systematic_context_path=Path(args.systematic_context_path).resolve(),
            critical_context_path=Path(args.critical_context_path).resolve(),
            template_path=template_path,
            outdir=outdir,
            model=str(args.model),
            citation_style=str(args.citation_style),
            function_name=str(args.function_name),
        )
    else:
        if not args.context:
            parser.error("--context is required when --mode render_context")
        manifest = _run_render_from_context(
            context_path=Path(args.context).resolve(),
            template_path=template_path,
            outdir=outdir,
        )
    print(json.dumps(manifest, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
