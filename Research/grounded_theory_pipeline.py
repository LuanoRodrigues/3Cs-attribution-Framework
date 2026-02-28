"""
Grounded Theory (GT) reporting pipeline.

Purpose
- Render a structured Grounded Theory study report to HTML from a single JSON input file.

Grounded Theory definition
- An inductive–comparative approach designed to generate an integrated explanatory theory of a process or action from data,
  using iterative cycles of data collection and analysis (constant comparison, theoretical sampling, saturation).

Procedural methodology (typical)
1) Start with a phenomenon/process of interest; collect initial qualitative data.
2) Code early data and analyse concurrently using constant comparison across incidents.
3) Iteratively refine categories and properties; write analytic memos to capture emerging conceptual relations.
4) Sample theoretically: collect "next" data to elaborate, challenge, and saturate categories (not to represent a population).
5) Integrate categories into an explanatory account: specify relationships, conditions, and consequences; delimit the theory.
6) Write the theory as an integrated product grounded in data, supported by illustrative excerpts.

Typical data types
- Iterative interviews, observations, documents/records; often multiple sources if they advance theoretical sampling.

Common analytic techniques
- Constant comparison; staged coding (labels vary by GT genre); memo-writing; theoretical sampling; saturation decisions.

Expected outputs/deliverables
- Substantive theory (often a conceptual model of a process), core category/categories, explanatory propositions,
  memos as an audit trail, and an explicit account of saturation and sampling logic.

Main authors and major variants
- Barney G. Glaser and Anselm L. Strauss (classic/original GT; discovery of theory).
- Anselm L. Strauss and Juliet Corbin (Straussian GT; axial coding and a more structured analytic scheme).
- Kathy Charmaz (constructivist GT; interpretive emphasis and researcher co-construction).

Input contract (JSON)
The pipeline expects a JSON object with at least the keys referenced in `build_report_context()`.
Missing keys should raise immediately; this is deliberate.

Example (minimal sketch)
{
  "topic": "Example topic",
  "authors_list": "A. Researcher; B. Researcher",
  "affiliation": "Example University",
  "gt_genre": "Constructivist grounded theory",
  "epistemological_stance": "Constructivist / interpretivist",
  "ai_models_used": "none",
  "ai_abstract": "<p>...</p>",
  "ai_introduction": "<p>...</p>",
  "phenomenon": "Process X in context Y",
  "aims": "Generate an explanatory account of ...",
  "research_questions": ["How do ...?", "What explains ...?"],
  "context_and_setting": "<p>...</p>",
  "sampling_strategy": "<p>...</p>",
  "data_sources": [
    {"source_type": "Interviews", "n": 18, "details": "Semi-structured"},
    {"source_type": "Documents", "n": 42, "details": "Policies, emails"}
  ],
  "data_collection_cycles": [
    {"cycle": "1", "sampling_logic": "Initial purposive", "data_collected": "8 interviews", "analysis_notes": "Initial coding", "next_sampling_decision": "Seek deviant case"},
    {"cycle": "2", "sampling_logic": "Theoretical", "data_collected": "6 interviews", "analysis_notes": "Focused coding", "next_sampling_decision": "Saturate core category"}
  ],
  "analysis_procedures": "<p>...</p>",
  "theoretical_sampling_log": [
    {"decision": "Recruit deviant case", "rationale": "Challenge category boundary", "result": "Refined property P"}
  ],
  "memoing_and_audit_trail": "<p>...</p>",
  "saturation_account": "<p>...</p>",
  "quality_and_rigor": "<p>...</p>",
  "reflexivity": "<p>...</p>",
  "ethics": "<p>...</p>",
  "core_category_name": "Core category name",
  "core_category_definition": "Definition",
  "core_category_rationale": "Why this is core",
  "categories": [
    {"category": "Category A", "definition": "Definition", "properties": ["P1", "P2"], "conditions_actions_consequences": "C/A/C", "excerpts": ["Quote 1", "Quote 2"]}
  ],
  "negative_cases_and_variation": "<p>...</p>",
  "theory_narrative": "<p>...</p>",
  "propositions": ["If ..., then ..."],
  "conceptual_model_image_path": "",
  "conceptual_model_description": "<p>...</p>",
  "discussion": "<p>...</p>",
  "limitations": "<p>...</p>",
  "conclusion": "<p>...</p>",
  "references": [
    {"citation": "Glaser BG, Strauss AL. 1967. The Discovery of Grounded Theory.", "url": ""}
  ]
}

Outputs
- A single HTML report file.
"""

import argparse
import datetime
import html
import json
import re
import sys
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, StrictUndefined

_THIS_FILE = Path(__file__).resolve()
_REPO_ROOT = _THIS_FILE.parents[1]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))


class GroundedTheoryValidationError(ValueError):
    pass


def _norm_text(value):
    return str(value or "").strip()


def _must_nonempty(ctx, key, errors):
    if not _norm_text(ctx.get(key, "")):
        errors.append(f"Missing required non-empty field: {key}")


def _must_list(ctx, key, min_len, errors):
    arr = ctx.get(key)
    if not isinstance(arr, list):
        errors.append(f"Field must be a list: {key}")
        return []
    if len(arr) < min_len:
        errors.append(f"Field requires at least {min_len} item(s): {key}")
    return arr


def _contains_any(text, patterns):
    low = _norm_text(text).lower()
    for p in patterns:
        if re.search(p, low):
            return True
    return False


def enforce_grounded_theory_methodology(ctx):
    """
    Enforce strict Grounded Theory methodology requirements.
    Raises GroundedTheoryValidationError when key GT elements are missing.
    """
    errors = []

    # Core framing
    for key in [
        "topic",
        "phenomenon",
        "aims",
        "context_and_setting",
        "sampling_strategy",
        "analysis_procedures",
        "memoing_and_audit_trail",
        "saturation_account",
        "core_category_name",
        "core_category_definition",
        "core_category_rationale",
        "negative_cases_and_variation",
        "theory_narrative",
        "discussion",
        "limitations",
        "conclusion",
    ]:
        _must_nonempty(ctx, key, errors)

    # RQ shape
    rqs = _must_list(ctx, "research_questions", 3, errors)
    if isinstance(rqs, list) and len(rqs) > 5:
        errors.append("research_questions must contain at most 5 questions.")
    for i, rq in enumerate(rqs):
        if not _norm_text(rq):
            errors.append(f"research_questions[{i}] is empty.")

    # Data sources
    data_sources = _must_list(ctx, "data_sources", 1, errors)
    for i, ds in enumerate(data_sources):
        if not isinstance(ds, dict):
            errors.append(f"data_sources[{i}] must be an object.")
            continue
        if not _norm_text(ds.get("source_type", "")):
            errors.append(f"data_sources[{i}].source_type is required.")
        n = ds.get("n", 0)
        if not isinstance(n, int) or n <= 0:
            errors.append(f"data_sources[{i}].n must be a positive integer.")
        if not _norm_text(ds.get("details", "")):
            errors.append(f"data_sources[{i}].details is required.")

    # Iterative cycles + concurrent analysis
    cycles = _must_list(ctx, "data_collection_cycles", 2, errors)
    for i, c in enumerate(cycles):
        if not isinstance(c, dict):
            errors.append(f"data_collection_cycles[{i}] must be an object.")
            continue
        for k in ["cycle", "sampling_logic", "data_collected", "analysis_notes", "next_sampling_decision"]:
            if not _norm_text(c.get(k, "")):
                errors.append(f"data_collection_cycles[{i}].{k} is required.")

    # Theoretical sampling log required
    sampling_log = _must_list(ctx, "theoretical_sampling_log", 1, errors)
    for i, row in enumerate(sampling_log):
        if not isinstance(row, dict):
            errors.append(f"theoretical_sampling_log[{i}] must be an object.")
            continue
        for k in ["decision", "rationale", "result"]:
            if not _norm_text(row.get(k, "")):
                errors.append(f"theoretical_sampling_log[{i}].{k} is required.")

    # Category system + propositions
    categories = _must_list(ctx, "categories", 2, errors)
    for i, c in enumerate(categories):
        if not isinstance(c, dict):
            errors.append(f"categories[{i}] must be an object.")
            continue
        for k in ["category", "definition", "conditions_actions_consequences"]:
            if not _norm_text(c.get(k, "")):
                errors.append(f"categories[{i}].{k} is required.")
        props = c.get("properties")
        excerpts = c.get("excerpts")
        if not isinstance(props, list) or len(props) < 1:
            errors.append(f"categories[{i}].properties must contain at least 1 item.")
        if not isinstance(excerpts, list) or len(excerpts) < 1:
            errors.append(f"categories[{i}].excerpts must contain at least 1 item.")

    props = _must_list(ctx, "propositions", 1, errors)
    for i, p in enumerate(props):
        if not _norm_text(p):
            errors.append(f"propositions[{i}] is empty.")

    refs = _must_list(ctx, "references", 1, errors)
    for i, r in enumerate(refs):
        if not isinstance(r, dict) or not _norm_text(r.get("citation", "")):
            errors.append(f"references[{i}].citation is required.")

    # Methodological signal checks (strict GT markers)
    analysis = _norm_text(ctx.get("analysis_procedures", ""))
    sampling = _norm_text(ctx.get("sampling_strategy", ""))
    saturation = _norm_text(ctx.get("saturation_account", ""))
    memo = _norm_text(ctx.get("memoing_and_audit_trail", ""))
    neg_cases = _norm_text(ctx.get("negative_cases_and_variation", ""))
    theory = _norm_text(ctx.get("theory_narrative", ""))

    if not _contains_any(analysis, [r"constant\s+comparison", r"comparative", r"concurrent", r"iterative"]):
        errors.append("analysis_procedures must explicitly describe constant comparison and iterative/concurrent analysis.")
    if not _contains_any(sampling, [r"theoretical\s+sampling", r"sample\s+theoretic"]):
        errors.append("sampling_strategy must explicitly describe theoretical sampling logic.")
    if not _contains_any(saturation, [r"saturat"]):
        errors.append("saturation_account must explicitly report saturation decisions/evidence.")
    if not _contains_any(memo, [r"memo"]):
        errors.append("memoing_and_audit_trail must explicitly document memo-writing and audit trail.")
    if not _contains_any(neg_cases, [r"negative\s+case", r"deviant", r"variation", r"counter[-\s]?example"]):
        errors.append("negative_cases_and_variation must explicitly discuss variation/deviant or negative cases.")
    if not _contains_any(theory, [r"process", r"relationship", r"condition", r"consequence", r"explan"]):
        errors.append("theory_narrative must present an explanatory process account (relations/conditions/consequences).")

    if errors:
        raise GroundedTheoryValidationError("Grounded Theory methodology validation failed:\n- " + "\n- ".join(errors))


def _html_table(headers, rows):
    parts = []
    parts.append('<table class="data-table">')
    parts.append("<thead><tr>")
    for h in headers:
        parts.append(f"<th>{html.escape(str(h))}</th>")
    parts.append("</tr></thead>")
    parts.append("<tbody>")
    for r in rows:
        parts.append("<tr>")
        for c in r:
            parts.append(f"<td>{html.escape(str(c))}</td>")
        parts.append("</tr>")
    parts.append("</tbody></table>")
    return "".join(parts)


def _data_sources_table(data_sources):
    headers = ["Data source", "Count", "Details"]
    rows = []
    for ds in data_sources:
        rows.append([ds["source_type"], ds["n"], ds["details"]])
    return _html_table(headers, rows)


def _data_collection_cycles_table(cycles):
    headers = ["Cycle", "Sampling logic", "Data collected", "Concurrent analysis", "Next sampling decision"]
    rows = []
    for c in cycles:
        rows.append([c["cycle"], c["sampling_logic"], c["data_collected"], c["analysis_notes"], c["next_sampling_decision"]])
    return _html_table(headers, rows)


def _theoretical_sampling_log_table(log_rows):
    headers = ["Decision", "Rationale", "Resulting analytic move"]
    rows = []
    for x in log_rows:
        rows.append([x["decision"], x["rationale"], x["result"]])
    return _html_table(headers, rows)


def _categories_table(categories):
    headers = ["Category", "Definition", "Properties / dimensions", "Conditions / actions / consequences", "Illustrative excerpts"]
    rows = []
    for c in categories:
        props = "; ".join([str(p) for p in c["properties"]])
        excerpts = "<br>".join([html.escape(str(q)) for q in c["excerpts"]])
        rows.append([c["category"], c["definition"], props, c["conditions_actions_consequences"], excerpts])
    table = _html_table(headers, rows)
    table = table.replace("&lt;br&gt;", "<br>")
    return table


def _references_list(references):
    parts = []
    parts.append("<ol>")
    for r in references:
        citation = html.escape(str(r["citation"]))
        url = str(r["url"])
        if url:
            parts.append(f'<li>{citation} <a href="{html.escape(url)}" target="_blank" rel="noopener">[link]</a></li>')
        else:
            parts.append(f"<li>{citation}</li>")
    parts.append("</ol>")
    return "".join(parts)


def build_report_context(ctx):
    gt_definition = "An inductive–comparative approach designed to generate an integrated explanatory theory of a process or action from data, using iterative cycles of data collection and analysis (constant comparison, theoretical sampling, saturation)."

    gt_procedural_methodology = [
        "Start with a phenomenon/process of interest; collect initial qualitative data.",
        "Code early data and analyse concurrently (joint coding/analysis), using constant comparison across incidents.",
        "Iteratively refine categories/properties; write analytic memos to capture emerging conceptual relations.",
        "Sample theoretically: collect “next” data to elaborate, challenge, and saturate categories (not to represent a population).",
        "Integrate categories into an explanatory account (delimit theory; specify relationships/conditions/consequences).",
        "Write the theory as an integrated product grounded in data, supported by illustrative excerpts."
    ]

    gt_typical_data_types = "Iterative interviews, observations, documents/records; often multiple sources if they advance theoretical sampling."
    gt_common_analytic_techniques = "Constant comparison; coding stages (terminology varies by GT genre); memo-writing; theoretical sampling; saturation decisions."
    gt_expected_outputs = "A substantive theory (often a conceptual model of process), core category/categories, explanatory propositions, memos as an audit trail, and an account of saturation and sampling logic."
    gt_time_requirements = "High, because GT expects iterative redesign of data collection and analysis and may require multiple sampling cycles."
    gt_strengths = "Strong for process and action questions; yields explanatory, integrated conceptual products; handles variation and deviant cases via constant comparison."
    gt_limitations = "Resource intensive; can drift into thematic description if concepts are not raised to processual analysis; overly mechanical coding recipes can distort theoretical sensitivity."
    gt_suitable_topics = "Process, action, interaction, change over time, and questions about what explains variation in how people or organisations do X."

    gt_main_authors = [
        "Glaser, B. G., & Strauss, A. L. (classic/original grounded theory; theory discovery; constant comparison).",
        "Strauss, A. L., & Corbin, J. (Straussian grounded theory; more structured coding procedures, including axial coding).",
        "Charmaz, K. (constructivist grounded theory; interpretive emphasis and co-construction)."
    ]

    generation_date = datetime.datetime.now(datetime.timezone.utc).date().isoformat()

    data_sources_table = _data_sources_table(ctx["data_sources"])
    data_collection_cycles_table = _data_collection_cycles_table(ctx["data_collection_cycles"])
    theoretical_sampling_log_table = _theoretical_sampling_log_table(ctx["theoretical_sampling_log"])
    categories_table = _categories_table(ctx["categories"])
    references_list = _references_list(ctx["references"])

    outputs_and_deliverables = [
        "Substantive theory and conceptual model grounded in data.",
        "Core category/categories and defined relations.",
        "Explanatory propositions or theoretical statements.",
        "Analytic memos and decision log as an audit trail.",
        "Account of theoretical sampling logic and saturation decisions.",
        "Illustrative excerpts supporting categories and theory."
    ]

    report_ctx = {
        "topic": ctx["topic"],
        "authors_list": ctx["authors_list"],
        "affiliation": ctx["affiliation"],
        "gt_genre": ctx["gt_genre"],
        "epistemological_stance": ctx["epistemological_stance"],
        "ai_models_used": ctx["ai_models_used"],
        "generation_date": generation_date,
        "ai_abstract": ctx["ai_abstract"],
        "ai_introduction": ctx["ai_introduction"],
        "gt_definition": gt_definition,
        "gt_procedural_methodology": gt_procedural_methodology,
        "gt_typical_data_types": gt_typical_data_types,
        "gt_common_analytic_techniques": gt_common_analytic_techniques,
        "gt_expected_outputs": gt_expected_outputs,
        "gt_time_requirements": gt_time_requirements,
        "gt_strengths": gt_strengths,
        "gt_limitations": gt_limitations,
        "gt_suitable_topics": gt_suitable_topics,
        "gt_main_authors": gt_main_authors,
        "phenomenon": ctx["phenomenon"],
        "aims": ctx["aims"],
        "research_questions": ctx["research_questions"],
        "context_and_setting": ctx["context_and_setting"],
        "sampling_strategy": ctx["sampling_strategy"],
        "data_sources_table": data_sources_table,
        "data_collection_cycles_table": data_collection_cycles_table,
        "analysis_procedures": ctx["analysis_procedures"],
        "theoretical_sampling_log_table": theoretical_sampling_log_table,
        "memoing_and_audit_trail": ctx["memoing_and_audit_trail"],
        "saturation_account": ctx["saturation_account"],
        "quality_and_rigor": ctx["quality_and_rigor"],
        "reflexivity": ctx["reflexivity"],
        "ethics": ctx["ethics"],
        "core_category_name": ctx["core_category_name"],
        "core_category_definition": ctx["core_category_definition"],
        "core_category_rationale": ctx["core_category_rationale"],
        "categories_table": categories_table,
        "negative_cases_and_variation": ctx["negative_cases_and_variation"],
        "theory_narrative": ctx["theory_narrative"],
        "propositions": ctx["propositions"],
        "conceptual_model_image_path": ctx["conceptual_model_image_path"],
        "conceptual_model_description": ctx["conceptual_model_description"],
        "discussion": ctx["discussion"],
        "limitations": ctx["limitations"],
        "conclusion": ctx["conclusion"],
        "outputs_and_deliverables": outputs_and_deliverables,
        "references_list": references_list
    }
    return report_ctx


def render_report(template_path, report_context, output_path):
    env = Environment(
        loader=FileSystemLoader(str(Path(template_path).parent)),
        autoescape=True,
        undefined=StrictUndefined
    )
    template = env.get_template(Path(template_path).name)
    html_out = template.render(**report_context)
    Path(output_path).write_text(html_out, encoding="utf-8")


def main():
    repo = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["render_context", "phase2_pipeline"], default="render_context")
    parser.add_argument("--input", help="Path to the GT JSON input file (render_context mode)")
    parser.add_argument("--template", default=str(repo / "Research" / "templates" / "grounded_theory_report_template.html"), help="Path to the grounded theory HTML template")
    parser.add_argument("--output", help="Path to write the rendered HTML report (render_context mode)")
    parser.add_argument("--summary-path")
    parser.add_argument(
        "--systematic-context-path",
        default=str(repo / "Research" / "outputs" / "Attribution_of_Cyberattacks_-_Phase_2_Expansion" / "systematic_review_context.json"),
    )
    parser.add_argument(
        "--critical-context-path",
        default=str(repo / "Research" / "outputs" / "Attribution_of_Cyberattacks_-_Phase_2_Expansion" / "CRR" / "critical_review_context.json"),
    )
    parser.add_argument("--outdir", default=str(repo / "Research" / "outputs" / "Attribution_of_Cyberattacks_-_Phase_2_Expansion" / "GROUNDED_THEORY"))
    parser.add_argument("--model", default="gpt-5-mini")
    parser.add_argument("--citation-style", default="apa")
    parser.add_argument("--function-name", default="systematic_review_section_writer")
    args = parser.parse_args()

    if args.mode == "phase2_pipeline":
        if not args.summary_path:
            parser.error("--summary-path is required when --mode phase2_pipeline")
        from Research.pipeline.run_phase2_grounded_theory_template import run_pipeline

        result = run_pipeline(
            summary_path=Path(args.summary_path).resolve(),
            systematic_context_path=Path(args.systematic_context_path).resolve(),
            critical_context_path=Path(args.critical_context_path).resolve(),
            template_path=Path(args.template).resolve(),
            outdir=Path(args.outdir).resolve(),
            model=str(args.model),
            citation_style=str(args.citation_style),
            function_name=str(args.function_name),
        )
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return

    if not args.input or not args.output:
        parser.error("--input and --output are required when --mode render_context")

    ctx = json.loads(Path(args.input).read_text(encoding="utf-8"))
    enforce_grounded_theory_methodology(ctx)
    report_context = build_report_context(ctx)
    render_report(args.template, report_context, args.output)


if __name__ == "__main__":
    main()
