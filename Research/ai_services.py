# src/core/utils/ai_services.py
import inspect
import sys
from datetime import datetime, timezone
from typing import OrderedDict, Callable, Counter, Iterable

from bibliometric_analysis_tool.core.app_constants import STEP__TIMELINE
from bibliometric_analysis_tool.utils.Zotero_loader_to_df import zotero_client
from extract_pdf_ui import process_pdf
from src.core.utils.Batches_calls import creating_batches
from src.core.utils.Parsers import _safe_str
from src.core.utils.Timeline_Analysis import _period_by_period_entry
from src.core.utils.calling_models import *
from src.core.utils.calling_models import _get_prompt_details, _process_batch_for
from src.core.utils.emits_monitor import emit_model_call_report_html, emit_timeline_descriptive_html, _ui_html, \
    _MONITOR_CSS_MIN, emit_batch_results_html, emit_timeline_structured_pkg_html, emit_review_round1_revisions, \
    emit_revisions_batches, emit_periods_batches_overview_html, emit_initial_draft,    emit_live_feed_html


# It seems the original explicit_path_to_prompts_json is trying to find prompts.json at the project root level (annotarium_package/src/prompts.json)
# Let's assume the explicit_path_to_prompts_json (src/prompts.json) is the correct one.

from bibliometric_analysis_tool.core.app_constants import (
    PROMPTS_FILENAME as _PROMPTS_FILENAME_FROM_CONSTANTS,
    STEP_LOAD_DATA, STEP_AI_ABSTRACT, STEP_AI_INTRODUCTION,
    STEP_AI_LITERATURE_REVIEW_SUMMARY, STEP_AI_METHODOLOGY_REVIEW,
    STEP_AI_DISCUSSION, STEP_AI_CONCLUSION, STEP_AI_LIMITATIONS,
    STEP_AI_SUGGEST_CODING_KEYWORDS, STEP_EXTRACT_PDF_CONTENT_FOR_KEYWORDS,
    STEP_AI_AUTHOR_FOCUS_KEYWORDS, STEP_AI_AUTHOR_GRAPH_ANALYSIS,
    STEP_ANALYZE_AUTHORS, STEP__KEYWORD_COOCCURRENCE_NET,
    STEP_AI_KEYWORD_GRAPH_ANALYSIS, STEP__TIMELINE,
    STEP_AI_DOC_TYPES_ANALYSIS, STEP_AI_AFFILIATIONS_ANALYSIS, STEP_AI_COUNTRIES_ANALYSIS,
    STEP_AI_GENERAL_KEYWORD_THEMES_ANALYSIS, STEP_AI_COAUTHORSHIP_NETWORK_ANALYSIS,
    STEP_AI_SOURCES_ANALYSIS, STEP_AI_CITATION_TABLE_ANALYSIS, STEP_AI_FUNDERS_ANALYSIS,
    STEP_AI_PDF_CONTENT_SUMMARY, STEP_AI_KEYWORD_CLUSTER_SEARCH_TERMS
)

if hasattr(_PROMPTS_FILENAME_FROM_CONSTANTS, 'strip'): PROMPTS_FILENAME = _PROMPTS_FILENAME_FROM_CONSTANTS

from bibliometric_analysis_tool.utils.data_processing import extract_content_for_keywords, \
    generate_timeline_detailed_plotly, describe_trend_data, analyze_publication_trends, _extract_theme_list


# from src.core.utils.data_processing import zot, ZOTERO_CLASS_AVAILABLE, _summarise_doc_types

def _utc_now_iso_z(timespec: str = "seconds") -> str:
    """UTC now as RFC3339/ISO-8601 with 'Z' suffix, e.g., 2025-09-26T14:03:12Z."""
    ts = datetime.now(timezone.utc).isoformat(timespec=timespec)
    return ts[:-6] + "Z" if ts.endswith("+00:00") else ts

def _utc_now_compact() -> str:
    """UTC now as compact slug: YYYYMMDD_HHMMSS_microseconds."""
    return datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S_%f")
def console_only(*args, **kwargs):
    """
    Print directly to the real terminal (sys.__stdout__), never through logging or Qt.
    Use this for developer-facing diagnostics that should NOT appear in the monitor.
    """
    file = kwargs.pop("file", sys.__stdout__)
    end = kwargs.pop("end", "\n")
    text = " ".join(str(a) for a in args)
    try:
        file.write(text + end)
        file.flush()
    except Exception:
        pass
def applying_revisions_from_prep(
            prep: Dict[str, Any],
            *,
            ai_provider_key: str,  # PASS-THROUGH ONLY — not modified
            model_api_name: str,  # PASS-THROUGH ONLY — not modified
            original_draft_plain_text: Optional[str] = None,
            section_title: Optional[str] = None,
            overall_topic: Optional[str] = None,
            max_revisions: int = 20,
            max_questions: int = 10,
            max_keywords: int = 30,
            max_curated_notes: int = 24,
            emit_prompt_text: bool = False,  # optionally produce a compact R2 prompt string
            progress_callback: Optional[Callable[[str], None]] = None,
    ) -> Dict[str, Any]:
        """
        applying_revisions_from_prep — Build an R2 input payload directly from the in-memory `prep`.

        Roadmap
        1) Validate & preserve provenance
           • Accept the `prep` dict returned by `prepare_r2_inputs_from_r1(...)`.
           • Keep an exact copy under `data.r2_prep_original` (verbatim; no mutation).
           • DO NOT change LLM identity — provider/model are pass-through.

        2) Normalize R1 review data
           • Pull R1 block (suggested_revisions, clarifying_questions, search_keywords_phrases).
           • Dedupe with a hash-safe method (works for strings/dicts/lists).
           • Coerce non-string entries (dicts, etc.) into strings safely.
           • If `prep['data']['r1_summary']['search_keywords_phrases_ranked']` exists, prefer that order.
           • Trim to configured caps.

        3) Curate evidence strictly from paragraph_context
           • Source: `prep['data']['extracted_notes']` (if present).
           • Keep BOTH: (a) original HTML as `paragraph_context_html`, (b) normalized plain text as `paragraph_text`.
           • Add auto-metadata:
               - zotero_keys (from zotero://… patterns)
               - years_found (YYYY and normalized ranges)
               - keyword_hits (counts against compact R1 KW list)
               - claim_span (first sentence of the paragraph_text)
               - length_chars (plain length)
               - source_* fields: item_key, title, bib_header, page_number, keyword_found
               - optional echoes: section_title, overall_topic
           • Dedupe curated notes by (sha1 of paragraph_text + item_key), rank by (zotero_keys, keyword hits, reasonable length),
             then cap to `max_curated_notes`.

        4) Assemble an efficient R2 prompt payload
           • `r2_prompt_payload` includes:
               - overview (topic, section)
               - r1_compact (deduped+trimmed lists)
               - curated_evidence (text+html+metadata)
               - constraints (style/precision/citation hints)
               - placeholders.original_draft_plain_text (if provided)
           • Optionally emit a compact textual `prompt_text` for direct LLM calls.

        5) Return unified package (LLM identity untouched)
        """

        # ── small logger shim ─────────────────────────────────────────────────────
        def _cb(msg: str):
            if progress_callback:
                try:
                    progress_callback(msg)
                except Exception:
                    pass
            logging.info(msg)

        # ── helpers ──────────────────────────────────────────────────────────────
        def _norm_key(x):
            try:
                if isinstance(x, (dict, list, tuple)):
                    return json.dumps(x, ensure_ascii=False, sort_keys=True)
                if isinstance(x, str):
                    return " ".join(x.split()).strip().lower()
                return str(x)
            except Exception:
                return str(x)

        def _dedupe_mixed(seq):
            seen = set()
            out = []
            for x in seq or []:
                k = _norm_key(x)
                if k not in seen:
                    seen.add(k)
                    out.append(x)
            return out

        def _stringify_entries(seq: List[Any]) -> List[str]:
            """
            Ensure the list is strictly strings.
            • dict with common text keys → pick that value
            • otherwise → compact JSON dump
            """
            out: List[str] = []
            for v in seq or []:
                if isinstance(v, str):
                    out.append(v)
                elif isinstance(v, dict):
                    for key in ("text", "suggestion", "revision", "message", "detail"):
                        if key in v and isinstance(v[key], str):
                            out.append(v[key])
                            break
                    else:
                        out.append(json.dumps(v, ensure_ascii=False, sort_keys=True))
                elif isinstance(v, (list, tuple)):
                    out.append(" ".join(_stringify_entries(list(v))))
                else:
                    out.append(str(v))
            return out

        def _trim(lst: List[Any], n: int) -> List[Any]:
            return list(lst or [])[:n] if isinstance(n, int) and n > 0 else list(lst or [])

        def _first_sentence(text: str, max_chars: int = 350) -> str:
            s = (text or "").strip()
            if not s:
                return ""
            m = re.search(r"(.+?[.!?])(\s|$)", s, flags=re.S)
            sent = (m.group(1) if m else s[:max_chars]).strip()
            return sent[:max_chars]

        def _extract_years(text: str) -> List[int]:
            years = set(int(y) for y in re.findall(r"\b(19\d{2}|20\d{2})\b", text or ""))
            for a, b in re.findall(r"\b(19\d{2}|20\d{2})\s*[–-]\s*(19\d{2}|20\d{2})\b", text or ""):
                try:
                    a, b = int(a), int(b)
                    if a <= b:
                        years.update(range(a, b + 1))
                except Exception:
                    pass
            return sorted(years)

        def _find_zotero_keys(text: str) -> List[str]:
            return re.findall(r"zotero://select/library/items/([A-Z0-9]+)", text or "")

        def _keyword_hits(text: str, kws: List[str]) -> Dict[str, int]:
            t = (text or "").lower()
            hits = Counter()
            for kw in kws or []:
                k = (kw or "").strip().lower()
                if not k:
                    continue
                if k in t:
                    hits[kw] += t.count(k)
            return dict(hits)

        def _strip_html(s: str) -> str:
            if not s:
                return ""
            try:
                from bs4 import BeautifulSoup
                txt = BeautifulSoup(s, "html.parser").get_text(" ", strip=True)
            except Exception:
                txt = re.sub(r"<[^>]+>", " ", s)
                txt = html.unescape(txt)
            return " ".join(txt.split())

        def _looks_like_biblio_stub(text_plain: str) -> bool:
            if not text_plain:
                return True
            t = text_plain.lower()
            patterns = [
                "bluebook", "apa 7th", "chicago 17th", "aglc 4th", "oscola 4th",
                "alwd 7th", "mla 9th", "date downloaded:", "heinonline"
            ]
            if any(p in t for p in patterns) and len(text_plain) < 280:
                return True
            return False

        # ── 1) validate & preserve ───────────────────────────────────────────────
        if not isinstance(prep, dict) or "data" not in prep:
            raise ValueError("`prep` must be a dict with a 'data' field from prepare_r2_inputs_from_r1(...)")

        data = prep.get("data") or {}
        r2_prep_original = prep  # verbatim; do not mutate

        # Infer section/topic if not passed explicitly
        section_title = section_title or data.get("section_title") or ""
        overall_topic = overall_topic or data.get("overall_topic") or ""

        # ── 2) normalize R1 data ─────────────────────────────────────────────────
        r1_pkg_full = data.get("r1_pkg_full") or data.get("r1_full") or data.get("r1") or {}
        r1_data_full = (r1_pkg_full.get("data") or {}) if isinstance(r1_pkg_full, dict) else {}

        r1_revisions = _dedupe_mixed(r1_data_full.get("suggested_revisions") or [])
        r1_questions = _dedupe_mixed(r1_data_full.get("clarifying_questions") or [])
        r1_keywords = _dedupe_mixed(r1_data_full.get("search_keywords_phrases") or [])

        # Coerce to strings (guards against dicts/lists sneaking in)
        r1_revisions = _stringify_entries(r1_revisions)
        r1_questions = _stringify_entries(r1_questions)
        r1_keywords = [str(k) for k in r1_keywords if isinstance(k, (str, int, float))]

        # Prefer ranked keyword summary if present
        r1_summary = data.get("r1_summary") or {}
        ranked_kw = r1_summary.get("search_keywords_phrases_ranked")
        if isinstance(ranked_kw, list) and ranked_kw:
            seen = set()
            ranked_kw = [k for k in ranked_kw if not (k in seen or seen.add(k))]
            r1_keywords = [str(k) for k in ranked_kw if isinstance(k, (str, int, float))]

        r1_compact = {
            "suggested_revisions": _trim(r1_revisions, max_revisions),
            "clarifying_questions": _trim(r1_questions, max_questions),
            "search_keywords_phrases": _trim(r1_keywords, max_keywords),
        }
        r1_preserved = r1_pkg_full  # verbatim for provenance

        # ── 3) curate evidence from paragraph_context only ───────────────────────
        extracted_notes = data.get("extracted_notes") or []
        curated: List[Dict[str, Any]] = []

        for note in extracted_notes:
            note = note or {}
            para_html = (note.get("paragraph_context") or "").strip()
            if not para_html:
                continue

            para_plain = _strip_html(para_html)
            if _looks_like_biblio_stub(para_plain):
                continue

            keys = _find_zotero_keys(para_html) or _find_zotero_keys(para_plain)
            years = _extract_years(para_plain)
            hits = _keyword_hits(para_plain, r1_compact["search_keywords_phrases"])
            claim = _first_sentence(para_plain)
            length_chars = len(para_plain)

            meta = {
                "zotero_keys": keys,
                "years_found": years,
                "keyword_hits": hits,
                "claim_span": claim,
                "length_chars": length_chars,
                "source_item_key": note.get("source_item_key"),
                "source_bib_header": note.get("source_bib_header"),
                "source_title": note.get("source_title"),
                "page_number": note.get("page_number"),
                "keyword_found": note.get("keyword_found"),
            }
            if section_title:
                meta["section_title"] = section_title
            if overall_topic:
                meta["overall_topic"] = overall_topic

            # stable id for de-duplication
            h = hashlib.sha1()
            sig = f"{meta.get('source_item_key') or ''}||{para_plain}"
            h.update(sig.encode("utf-8", errors="ignore"))
            note_id = h.hexdigest()[:16]

            curated.append({
                "note_id": note_id,
                "paragraph_text": para_plain,
                "paragraph_context_html": para_html,  # preserve original HTML
                "metadata": meta,
            })

        # Deduplicate notes by note_id; rank by quality signal
        seen_notes = set()
        deduped = []
        for n in curated:
            if n["note_id"] not in seen_notes:
                seen_notes.add(n["note_id"])
                deduped.append(n)

        def _score(n: Dict[str, Any]) -> int:
            meta = n.get("metadata", {})
            keys = meta.get("zotero_keys") or []
            hits = meta.get("keyword_hits") or {}
            length_ok = 1 if 120 <= (meta.get("length_chars") or 0) <= 2400 else 0
            return 2 * len(keys) + min(5, sum(hits.values())) + length_ok

        deduped.sort(key=_score, reverse=True)
        curated_unique = deduped[:max_curated_notes]

        # ── 4) assemble R2 prompt payload ────────────────────────────────────────
        r2_prompt_payload = {
            "overview": {"overall_topic": overall_topic, "section_title": section_title},
            "r1_compact": r1_compact,
            "curated_evidence": curated_unique,
            "constraints": {
                "style": "Apply revisions without changing factual claims beyond evidence; maintain timeline structure.",
                "terminology": "Choose one term (e.g., 'publication activity') and use consistently.",
                "citations": "When concrete claims are made, cite where metadata.zotero_keys exist; if multiple keys, name the most relevant.",
                "numerical_precision": "Prefer counts/percentages; avoid vague terms like 'near-zero' or 'robust cadence'.",
            },
            "placeholders": {
                "original_draft_plain_text": (original_draft_plain_text or "").strip(),
            },
        }

        prompt_text = None
        if emit_prompt_text:
            pt_lines = []
            pt_lines.append(f"You are revising the section: {section_title or 'Untitled Section'}")
            if overall_topic:
                pt_lines.append(f"Topic: {overall_topic}")
            pt_lines.append("\n== Revision Requests ==")
            for r in r2_prompt_payload["r1_compact"]["suggested_revisions"]:
                pt_lines.append(f"- {r}")
            if r2_prompt_payload["r1_compact"]["clarifying_questions"]:
                pt_lines.append("\n== Clarifying Questions (address if answerable) ==")
                for q in r2_prompt_payload["r1_compact"]["clarifying_questions"]:
                    pt_lines.append(f"- {q}")
            if r2_prompt_payload["placeholders"]["original_draft_plain_text"]:
                pt_lines.append("\n== Original Draft ==")
                pt_lines.append(r2_prompt_payload["placeholders"]["original_draft_plain_text"])
            if r2_prompt_payload["curated_evidence"]:
                pt_lines.append("\n== Evidence Paragraphs (quote minimally; cite if keys present) ==")
                for i, ev in enumerate(r2_prompt_payload["curated_evidence"], 1):
                    keys = ev["metadata"].get("zotero_keys") or []
                    years = ev["metadata"].get("years_found") or []
                    src = ev["metadata"].get("source_bib_header")
                    pt_lines.append(f"[{i}] {ev['paragraph_text']}")
                    meta_bits = []
                    if keys:  meta_bits.append(f"keys={keys}")
                    if years: meta_bits.append(f"years={years}")
                    if src:   meta_bits.append(f"src={src}")
                    if meta_bits:
                        pt_lines.append("   meta: " + " ".join(meta_bits))
            pt_lines.append("\n== Constraints ==")
            for k, v in r2_prompt_payload["constraints"].items():
                pt_lines.append(f"- {k}: {v}")
            prompt_text = "\n".join(pt_lines)

        # ── 5) build result (LLM identity untouched) ─────────────────────────────
        result = {
            "type": "r2_input_payload",
            "description": "Prepared payload for applying revisions",
            "ai": {
                "provider_key": ai_provider_key,  # pass-through, unchanged
                "model_api_name": model_api_name,  # pass-through, unchanged
            },
            "data": {
                "r2_prompt_payload": r2_prompt_payload,
                "r1_preserved": r1_preserved,
                "r2_prep_original": r2_prep_original,
            },
        }
        if prompt_text is not None:
            result["data"]["prompt_text"] = prompt_text

        _cb(
            f"R2 payload ready: "
            f"{len(r1_compact['suggested_revisions'])} revs, "
            f"{len(r1_compact['clarifying_questions'])} qs, "
            f"{len(r1_compact['search_keywords_phrases'])} kws, "
            f"{len(curated_unique)} curated notes."
        )
        return result



# --- Single-Pass Section Generation Helper---
def _generate_initial_draft_generic(
        prompt_key_for_initial_draft: str,
        section_step_key_for_context: str,
        df_full: pd.DataFrame,  # Added type hint
        results_so_far: dict,  # Added type hint
        progress_callback,
        ai_provider_key: str,  # Added type hint
        model_api_name: str,  # Added type hint
        store_only:bool,
        read:bool,
        use_cache:bool,
        extra_context_vars: dict = None,
):
    def _callback(msg):
        if progress_callback: progress_callback(msg)

    def _topic_tag_from_results(rsf: dict) -> str:
        import re
        topic = (
                (rsf or {}).get(STEP_LOAD_DATA, {}).get("collection_name_for_title") or
                (rsf or {}).get("research_topic") or
                os.getenv("BATCH_FUNCTION") or
                "dataset"
        )
        tag = re.sub(r"[^A-Za-z0-9_.-]+", "_", str(topic))[:40].strip("_")
        return tag or "dataset"

    topic_tag = _topic_tag_from_results(results_so_far)




    section_title = section_step_key_for_context.replace("STEP_AI_", "").replace("_", " ").title().replace("Review",
                                                                                                           "").replace(
        "Insights", "").strip()

    prompt_template, model, max_t, json_schema,effort= _get_prompt_details(prompt_key_for_initial_draft, ai_provider_key,
                                                                        model_api_name,section_id=section_title,results_so_far=results_so_far)
    if "Fallback prompt" in prompt_template or f"Error: Prompt missing for {prompt_key_for_initial_draft}" in prompt_template:
        _callback(f"Warning: Using a fallback/error prompt for initial draft of {section_title}")

    # Use formatted section_title for build_context_for_ai's first arg for clarity in logs
    context_summary = build_context_for_ai(section_title, df_full, results_so_far)
    vars_for_template_format = {"context": context_summary}
    if extra_context_vars: vars_for_template_format.update(extra_context_vars)

    # Initialize formatted_prompt before the try block to ensure it's always defined
    formatted_prompt = f"Error: Could not format prompt for {section_title} using key {prompt_key_for_initial_draft}."
    try:
        placeholder_text = "_CONTENT_WILL_BE_APPENDED_HERE_BY_CODE_"
        if placeholder_text in prompt_template:
            intermediate_prompt = prompt_template.replace(placeholder_text, context_summary)
            vars_for_remaining = {k: v for k, v in vars_for_template_format.items() if
                                  k != 'context' and f"{{{k}}}" in intermediate_prompt}
            formatted_prompt = intermediate_prompt.format(
                **vars_for_remaining) if vars_for_remaining else intermediate_prompt
        else:
            formatted_prompt = prompt_template.format(**vars_for_template_format)
    except KeyError as e:
        _callback(
            f"Initial draft prompt formatting error for {section_title} ({prompt_key_for_initial_draft}): Missing key {e}.")
        # Ensure formatted_prompt (even if partially formatted or an error string) is included in the error data
        return {"type": "error",
                "data": {"prompt_sent": formatted_prompt, "response_html": f"<p>Prompt error (KeyError): {e}</p>",
                         "ai_response_raw": None}, "description": f"Error: {section_title} (Initial Format Error)"}
    except Exception as e_fmt:
        _callback(f"Unexpected formatting error for {section_title} ({prompt_key_for_initial_draft}): {e_fmt}")
        return {"type": "error",
                "data": {"prompt_sent": formatted_prompt, "response_html": f"<p>Prompt error (Other): {e_fmt}</p>",
                         "ai_response_raw": None}, "description": f"Error: {section_title} (Initial Format Error)"}
    analysis_key_suffix = f"InitialDraft_{section_title}__{topic_tag}"
    overall_topic = results_so_far.get(STEP_LOAD_DATA, {}).get("collection_name_for_title", "the research topic")

    ai_response_dict = call_models(store_only=store_only,read=read,use_cache=use_cache,ai_provider_key=ai_provider_key, model_api_name=model, prompt_text=formatted_prompt,
                                   analysis_key_suffix=f"InitialDraft_{section_title.replace(' ', '_')[:20]}", max_tokens=max_t,
                                   base_output_dir_for_logs=results_so_far.get("base_output_dir"),
                                   overall_topic=overall_topic)

    # 2) render safely even if cache is empty
    html_content = get_ai_response_text(ai_response_dict, f"Initial Draft: {section_title}")
    emit_model_call_report_html(
        results_so_far=results_so_far,
        analysis_key_suffix=section_title,  # or any suffix you use
        package= ai_response_dict
,
        call_params={
            "ai_provider_key": ai_provider_key,
            "model_api_name": model_api_name,
            "max_tokens": max_t,
            "vision": False,
            "use_cache": True,
            "json_schema": None,
            "store_only": False,
            "read": False,
            "custom_id": None,
            "effort": effort,
            "from_cache": False,
        },
        section_title=section_step_key_for_context,
    )


    # # --- EMIT: Single-pass section page (dynamic slug/page from analysis_key_suffix) ---
    # # Keep the exact casing and truncation rule per your instruction.
    # _slug = f"InitialDraft_{section_title.replace(' ', '_')[:20]}"
    #
    # # Build the carded body and emit so the widget can route by section_title/subsection/page.
    _emit_body = (
        f"{_MONITOR_CSS_MIN}"
        f"<h2>{html.escape(section_step_key_for_context)} — Initial Draft</h2>"
        f"{html_content}"
    )
    #
    #
    # # page title MUST be section_step_key_for_context
    unique_suffix = _utc_now_compact()
    slug = f"InitialDraft_{section_step_key_for_context.replace(' ', '_')[:40]}_{unique_suffix}"

    _ui_html(
        results_so_far=results_so_far,

        html_body=_emit_body,
        section_title=section_step_key_for_context,
        subsection="initial_draft",                 # append to this subsection
        page=slug       ,                             # route by unique page to avoid overwrite
    )

    response = {
        "type": "html_section",
        "data": {
            "initial_draft_prompt_sent": formatted_prompt,  # NEW canonical key
            "prompt_sent": formatted_prompt,  # kept for backward-compat
            "initial_draft_html_response": html_content,  # NEW canonical key
            "response_html": html_content,  # kept for backward-compat
            "ai_response_raw": ai_response_dict.get("ai_response_object"),
        },
        "description": f"Initial Draft: {section_title}",
    }

    return response
def run_ai_review_round1(
        overall_topic: str,
        section_title: str,
        draft_content_plain_text: str,
        descriptive_data: str,
        ai_provider_key: str,
        model_api_name: str,
        read: bool,
        store_only: bool,
        use_cache: bool,
        progress_callback=None,
        results_so_far: dict = None,
        section_key=STEP__TIMELINE
):
    """
    Round 1 reviewer (tri-phase):
      • Calls Phase 1 prompt:  bReview_review_draft_round1_phase_1  (language/structure/quantification)
      • Calls Phase 2 prompt:  bReview_review_draft_round1_phase_2  (evidence sourcing & critical reasoning)
      • Calls Phase 3 prompt:  bReview_review_draft_round1_phase_3  (statistics & dataset operations)
    Returns all three phase outputs in a single structured package.

    NOTE: This version preserves all LLM call parameters/keys and hardens prompt formatting + parsing.
    """
    import logging, json, re  # keep local to avoid polluting module scope

    # --- Helper for logging and progress callback ---
    def _callback(msg, level="info"):  # Added level for distinguishing debug logs
        if progress_callback:
            if level in ("info", "warning", "error"):
                progress_callback(msg)

        if level == "debug":
            logging.debug(msg)
        elif level == "warning":
            logging.warning(msg)
        elif level == "error":
            logging.error(msg)
        else:
            logging.info(msg)

    # Shared context strings
    overall_topic_str = str(overall_topic or "the general research field")
    section_title_str = str(section_title or "the current section")
    draft_content_str = str(draft_content_plain_text or "No draft content was provided.")
    descriptive_data_str = str(descriptive_data or "No specific descriptive data was provided for context.")

    # Escape braces in variable values to avoid accidental injection into format string
    context_vars_base = {
        "overall_topic": overall_topic_str.replace('{', '{{').replace('}', '}}'),
        "section_title": section_title_str.replace('{', '{{').replace('}', '}}'),
        "draft_content": draft_content_str.replace('{', '{{').replace('}', '}}'),
        "descriptive_data": descriptive_data_str.replace('{', '{{').replace('}', '}}'),
    }

    def _format_prompt_brace_safe(prompt_template: str, context_vars: dict) -> str:
        """Brace-safe formatter that protects allowed tokens, escapes others, then restores."""
        import re as _re

        # Minimal claim_span from the first sentence of the draft (used only if the template references it)
        _claim_span = ""
        try:
            _s = (draft_content_str or "").strip()
            if _s:
                _m = _re.search(r"(.+?[.!?])(\s|$)", _s, flags=_re.S)
                _claim_span = (_m.group(1) if _m else _s[:240]).strip()
        except Exception:
            _claim_span = (draft_content_str or "")[:240].strip()

        class _SafeDict(dict):
            def __missing__(self, k):
                return ""

        _ctx = dict(context_vars)
        if "{claim_span" in prompt_template:
            _ctx.setdefault("claim_span", _claim_span)

        _allowed = set(_ctx.keys())

        def _protect_tokens(tmpl: str, tokens: set) -> str:
            for tok in sorted(tokens, key=len, reverse=True):
                tmpl = _re.sub(r"\{" + _re.escape(tok) + r"(?:![sra])?(?::[^}]*)?\}", f"@@@{tok}@@@", tmpl)
            return tmpl

        _tmpl = _protect_tokens(prompt_template, _allowed)
        _tmpl = _tmpl.replace("{", "{{").replace("}", "}}")
        for tok in _allowed:
            _tmpl = _tmpl.replace(f"@@@{tok}@@@", "{" + tok + "}")

        return _tmpl.format_map(_SafeDict(_ctx))

    def _run_one_phase(prompt_key: str, phase_key_expected: str, phase_label: str,):
        """
        Executes one phase (phase_1, phase_2, or phase_3):
          1) load prompt/schema
          2) brace-safe format
          3) call model
          4) parse JSON, validate top-level key
        Returns a dict with keys:
          ok, content (or None), errors (if any), prompt_sent, raw_text, call_package
        """
        nonlocal results_so_far

        _callback(f"Starting AI Reviewer Round 1 {phase_label} for section: '{section_title_str}'...", level="info")

        try:
            prompt_template, effective_model, max_t, fetched_json_schema, effort = _get_prompt_details(
                prompt_key, ai_provider_key,  model_api_name,section_id=section_title,results_so_far=results_so_far
            )
            _callback(f"Prompt details loaded for key '{prompt_key}'. Effective model: {effective_model}", level="debug")
        except Exception as e_get_prompt:
            _callback(f"CRITICAL ERROR: Failed to get prompt details for {prompt_key}. Error: {e_get_prompt}",
                      level="error")
            logging.error(f"Traceback for get_prompt_details failure in {phase_label} '{section_title_str}':", exc_info=True)
            return {
                "ok": False,
                "errors": [f"Failed to retrieve prompt configuration: {e_get_prompt}"],
                "prompt_sent": None,
                "raw_text": None,
                "call_package": None,
                "content": None
            }

        if "Fallback prompt" in prompt_template or f"Error: Prompt missing for {prompt_key}" in prompt_template:
            _callback(
                f"WARNING: Using a fallback or error prompt for {prompt_key} ({phase_label} for '{section_title_str}'). Check prompt configuration.",
                level="warning"
            )

        _callback(
            f"{phase_label}: Preparing prompt content using Model '{effective_model}'...",
            level="info"
        )

        # Format prompt safely
        try:
            formatted_prompt = _format_prompt_brace_safe(prompt_template, context_vars_base)
            _callback(
                f"{phase_label}: Prompt formatted successfully. Length: {len(formatted_prompt)}",
                level="info"
            )
            _callback(
                f"--- {phase_label} Formatted Prompt ---\n{formatted_prompt}\n--- End of Prompt ---",
                level="debug"
            )
        except Exception as e_fmt:
            _callback(
                f"ERROR: {phase_label} prompt formatting failed (Prompt Key: {prompt_key}): {e_fmt}. "
                f"Draft snippet: '{draft_content_str[:100]}...'",
                level="error"
            )
            logging.error(f"Traceback for prompt formatting error in {phase_label} '{section_title_str}':", exc_info=True)
            return {
                "ok": False,
                "errors": [f"Prompt format error: {e_fmt}"],
                "prompt_sent": None,
                "raw_text": None,
                "call_package": None,
                "content": None
            }

        # Call model
        _callback(f"Calling AI model for {phase_label} '{section_title_str}'...", level="info")
        log_dir = results_so_far.get("base_output_dir") if results_so_far else None
        try:
            call_pkg = call_models(
                store_only=store_only,
                read=read,
                ai_provider_key=ai_provider_key,
                model_api_name=effective_model,
                prompt_text=formatted_prompt,
                analysis_key_suffix=f"bRev_R1_{phase_label}_{section_title_str.replace(' ', '_').replace(':', '')[:25]}",
                max_tokens=max_t,
                base_output_dir_for_logs=log_dir,
                json_schema=fetched_json_schema,
                use_cache=use_cache,
            overall_topic = overall_topic

            )

            # Emit call report (best-effort; don't fail overall flow)
            try:
                emit_model_call_report_html(
                    results_so_far=results_so_far,
                    analysis_key_suffix=f"bRev_R1_{phase_label}_{section_title_str}",
                    package=call_pkg,
                    call_params={
                        "ai_provider_key": ai_provider_key,
                        "model_api_name": model_api_name,
                        "max_tokens": max_t,
                        "vision": False,
                        "use_cache": True,
                        "json_schema": None,
                        "store_only": False,
                        "read": False,
                        "custom_id": None,
                        "effort": effort,
                        "from_cache": False,
                    },
                    section_title=section_title,
                    page=f"bRev_R1_{phase_label}_{section_title_str}",
                )
            except Exception as _emit_err:
                _callback(f"WARNING: emit_model_call_report_html failed in {phase_label}: {_emit_err}", level="warning")

        except Exception as e_call_models:
            _callback(
                f"CRITICAL ERROR: call_models failed for {phase_label} '{section_title_str}'. Error: {e_call_models}",
                level="error")
            logging.error(f"Traceback for call_models failure in {phase_label} '{section_title_str}':", exc_info=True)
            return {
                "ok": False,
                "errors": [f"call_models error: {e_call_models}"],
                "prompt_sent": formatted_prompt,
                "raw_text": None,
                "call_package": None,
                "content": None
            }

        if call_pkg.get("error"):
            error_msg_from_call = call_pkg.get('error_message', 'Unknown error indicated by call_models')
            _callback(
                f"ERROR: AI model call failed for {phase_label} '{section_title_str}'. Details: {error_msg_from_call}",
                level="error"
            )
            return {
                "ok": False,
                "errors": [f"AI model call error: {error_msg_from_call}"],
                "prompt_sent": call_pkg.get("prompt_sent", formatted_prompt),
                "raw_text": call_pkg.get("raw_text", "No raw_text in error response from call_models."),
                "call_package": call_pkg,
                "content": None
            }

        raw_text = call_pkg.get("raw_text", "")


        # Parse JSON
        try:
            json_match = re.search(r'\{[\s\S]*\}', raw_text)
            if not json_match:
                raise json.JSONDecodeError("No JSON object found in response.", raw_text, 0)

            json_str = json_match.group(0)
            _callback(f"{phase_label}: Extracted potential JSON string. Length: {len(json_str)}. Parsing...", level="debug")
            parsed = json.loads(json_str)
            if phase_key_expected not in parsed:
                raise ValueError(f"Top-level key '{phase_key_expected}' not found in parsed JSON.")

            # Optional: minimal shape check
            content = parsed[phase_key_expected]
            if not isinstance(content, dict):
                _callback(
                    f"WARNING: {phase_label} JSON parsed but top-level content is not an object.",
                    level="warning"
                )
            # print("call_pkg:",call_pkg)
            # Try to emit visualizations for revisions/stats (best-effort; schema may vary by phase)
            try:
                emit_review_round1_revisions(
                    results_so_far=results_so_far,
                    pkg=call_pkg,
                    section_title= section_title
,
                )
            except Exception as _emit_rev_err:
                _callback(f"WARNING: emit_review_round1_revisions failed in {phase_label}: {_emit_rev_err}", level="warning")

            return {
                "ok": True,
                "errors": [],
                "prompt_sent": formatted_prompt,
                "raw_text": raw_text,
                "call_package": call_pkg,
                "content": parsed
            }

        except (json.JSONDecodeError, ValueError) as e_parse:
            _callback(
                f"ERROR: {phase_label} response JSON parsing/validation failed. Snippet: '{raw_text[:300]}...'. Error: {e_parse}",
                level="error")
            return {
                "ok": False,
                "errors": [f"JSON Parsing/Validation Error: {e_parse}"],
                "prompt_sent": formatted_prompt,
                "raw_text": raw_text,
                "call_package": call_pkg,
                "content": None
            }
        except Exception as e_general:
            _callback(f"CRITICAL UNEXPECTED ERROR during {phase_label}: {e_general}", level="error")
            logging.error(f"Traceback for general error in {phase_label} '{section_title_str}':", exc_info=True)
            return {
                "ok": False,
                "errors": [f"General Unexpected Error: {e_general}"],
                "prompt_sent": formatted_prompt,
                "raw_text": raw_text,
                "call_package": call_pkg,
                "content": None
            }

    # -------- Run all three phases sequentially --------
    phase1_result = _run_one_phase(
        prompt_key="bReview_review_draft_round1_phase_1",
        phase_key_expected="phase_1",
        phase_label="Phase_1"
    )
    phase2_result = _run_one_phase(
        prompt_key="bReview_review_draft_round1_phase_2",
        phase_key_expected="phase_2",
        phase_label="Phase_2"
    )
    phase3_result = _run_one_phase(
        prompt_key="bReview_review_draft_round1_phase_3",
        phase_key_expected="phase_3",
        phase_label="Phase_3"
    )

    # Build combined return
    combined = {
        "type": "ai_review_round1_tri_phase_output",
        "description": f"AI Review R1 (Phases 1–3): {section_title_str}",
        "prompt_inputs": {
            "overall_topic": overall_topic_str,
            "section_title": section_title_str,
            "descriptive_data_present": bool(descriptive_data_str and descriptive_data_str.strip())
        },
        "phase_1": {
            "ok": phase1_result.get("ok"),
            "errors": phase1_result.get("errors"),
            "prompt_sent": phase1_result.get("prompt_sent"),
            "raw_text": phase1_result.get("raw_text"),
            "ai_response_full_dict": phase1_result.get("call_package"),
            "content": phase1_result.get("content")
        },
        "phase_2": {
            "ok": phase2_result.get("ok"),
            "errors": phase2_result.get("errors"),
            "prompt_sent": phase2_result.get("prompt_sent"),
            "raw_text": phase2_result.get("raw_text"),
            "ai_response_full_dict": phase2_result.get("call_package"),
            "content": phase2_result.get("content")
        },
        "phase_3": {
            "ok": phase3_result.get("ok"),
            "errors": phase3_result.get("errors"),
            "prompt_sent": phase3_result.get("prompt_sent"),
            "raw_text": phase3_result.get("raw_text"),
            "ai_response_full_dict": phase3_result.get("call_package"),
            "content": phase3_result.get("content")
        }
    }

    # Aggregate top-level status
    ok_all = bool(phase1_result.get("ok") and phase2_result.get("ok") and phase3_result.get("ok"))
    if ok_all:
        _callback(f"AI R1 tri-phase successfully processed for '{section_title_str}'.", level="info")
    else:
        _callback(
            f"AI R1 tri-phase completed with issues for '{section_title_str}'. "
            f"Phase1 ok={phase1_result.get('ok')}, Phase2 ok={phase2_result.get('ok')}, Phase3 ok={phase3_result.get('ok')}",
            level="warning"
        )

    return combined



def run_ai_revise_draft_round2(
        overall_topic: str, section_title: str, original_draft_plain_text: str, review_round1_data_content: dict,
        extracted_notes: list, ai_provider_key: str, model_api_name: str,
        read:bool,store_only:bool, progress_callback=None,
        results_so_far: dict = None, skip_notes_in_prompt: bool = False,use_cache=False,
):
    def _callback(msg):
        if progress_callback: progress_callback(msg); logging.info(msg)

    prompt_key = "bReview_revise_draft_round2";
    prompt_template, model, max_t, json_schema,effort= _get_prompt_details(prompt_key, ai_provider_key,  model_api_name,section_id=section_title,results_so_far=results_so_far)
    if "Fallback prompt" in prompt_template: _callback(f"Warning: Fallback for {prompt_key} (R2 {section_title}).")
    _callback(f"AI Writer R2 for '{section_title}' (Model: {model})...")
    rev_str = "\n".join(
        [f"- {rev}" for rev in review_round1_data_content.get("suggested_revisions", ["No specific revisions."])])
    q_str = "\n".join(
        [f"- {q}" for q in review_round1_data_content.get("clarifying_questions", ["No specific questions."])])
    notes_str = "Note extraction was skipped or no relevant notes were provided for this revision."
    if not skip_notes_in_prompt and extracted_notes:
        parts = ["Summary of extracted notes:"]
        for i, note in enumerate(extracted_notes[:5]):
            parts.append(
                f"Note (Src:'{note.get('source_title', 'N/A')}',Pg:{note.get('page_number', '?')},KW:'{note.get('keyword_found', '?')}'): \"{note.get('original_paragraph', '...')[:100]}...\"")
        if len(extracted_notes) > 5: parts.append(f"...and {len(extracted_notes) - 5} more notes.")
        notes_str = "\n".join(parts)
    context_vars = {"overall_topic": overall_topic, "section_title": section_title,
                    "original_draft_content": original_draft_plain_text,
                    "suggested_revisions_list_str": rev_str, "clarifying_questions_list_str": q_str,
                    "extracted_notes_summary": notes_str}
    formatted_prompt_r2 = "Error R2 prompt";
    try:
        formatted_prompt_r2 = prompt_template.format(**context_vars)
    except KeyError as e:
        return {"type": "error", "data": {"prompt_sent": "N/A", "response_html": f"<p>R2 Prompt error: {e}</p>"},
                "description": f"Error R2 {section_title}"}
    log_dir = results_so_far.get("base_output_dir") if results_so_far else None
    resp_dict = call_models(store_only=store_only,read=read,ai_provider_key=ai_provider_key, model_api_name=model, prompt_text=formatted_prompt_r2,
                            analysis_key_suffix=f"bRev_R2_{section_title.replace(' ', '_')[:15]}",
                            max_tokens=max_t,
                            base_output_dir_for_logs=log_dir,use_cache=use_cache,
                            overall_topic=overall_topic,
)


    resp_html = get_ai_response_text(resp_dict, section_title)
    _callback(f"AI R2 for '{section_title}' complete.")
    return_data = {"prompt_sent_r2": formatted_prompt_r2, "response_html": resp_html,
                   "ai_response_raw_r2": resp_dict.get("ai_response_object"),
                   "review_r1_summary_used": review_round1_data_content.get("suggested_revisions", [])[:2],
                   "extracted_notes_count_for_r2": len(extracted_notes) if not skip_notes_in_prompt else 0}
    return {
             "type": "html_section",
             "data": {
                                   "initial_draft_prompt_sent": return_data.get("prompt_sent"),
                                   "prompt_sent": return_data.get("prompt_sent"),
                 "initial_draft_html_response": return_data.get("response_html"),
                 "response_html": return_data.get("response_html") or return_data.get("initial_draft_html_response"),
                            # copy over any other fields (e.g. R1/R2) unchanged:
                           ** {k: v for k, v in return_data.items() if k not in ("prompt_sent", "response_html")}
                      },
         "description": f"Generated {section_title} (AI Reviewed)"
                         }


def _pick_cached_resp(cache_dict: dict, section_title: str, prefer_round=("R2","R1")) -> dict:
    def san(s: str) -> str:
        s = (s or "").replace(" ", "_").replace(":", "")
        s = re.sub(r"[^\w]+", "_", s)
        return re.sub(r"_+", "_", s).strip("_")

    base = san(section_title)
    bases = {base, base[:25], base[:20], base[:15]}

    # Try preferred rounds, first by exact startswith, then by substring containment
    for rnd in prefer_round:
        # startswith
        for b in bases:
            key = f"bRev_{rnd}_{b}"
            if key in cache_dict:
                v = cache_dict[key]
                if isinstance(v, dict):
                    return v
        # fuzzy: any key that contains one of the bases
        for k, v in cache_dict.items():
            if k.startswith(f"bRev_{rnd}_") and any(b in k for b in bases) and isinstance(v, dict):
                return v

    # last resort: first dict value in cache, else empty dict
    for v in cache_dict.values():
        if isinstance(v, dict):
            return v
    return {}
def consolidate_revision_payload_batches(
    section_text: str,
    revision: str,
    batches: list[str],
    *,
        overall_topic,

        ai_provider_key: str,
    model_api_name: str,
    results_so_far: dict | None = None,
    progress_callback=None,
    use_cache: bool = True,
    min_paragraphs: int = 6,
    max_paragraphs: int = 8,
    section_step_key: str = STEP__TIMELINE,

):
    """
    Consolidate a LIST of prebuilt KW-batch HTML fragments into a 6–8 paragraph
    narrative that answers the revision directly, with APA-style inline anchors:

        <a key="ITEM_KEY" bib="Author (Year)" title="EXACT 1–2 sentence verbatim">(Author, Year)</a>

    INPUT
      - section_text: optional local context (the section being revised)
      - revision:     the reviewer's request, e.g., "the section needs to define due diligence"
      - batches:      list[str] where each entry is HTML made of <p>...</p> and anchors
                      previously produced (<a ...> or legacy <sup ...>KEY</sup>)

    OUTPUT
      Returns a single HTML string.

    NOTES
      - Dynamic routing: all monitor/batch artefacts are namespaced under `section_step_key`.
      - Batch execution: enqueues each chunk, runs a single batch job, then reads outputs.
        If batch processing fails, falls back to inline execution to avoid empty returns.
    """
    import re, html, hashlib

    # ── tiny logger/callback shim ─────────────────────────────────────────────
    def _cb(msg: str):
        if progress_callback:
            try:
                progress_callback(msg)
            except Exception:
                pass

    # ── guards ───────────────────────────────────────────────────────────────
    if not isinstance(batches, list) or not batches:
        return ""

    # ── helpers ──────────────────────────────────────────────────────────────
    def _nz(v):
        try:
            s = "" if v is None else str(v)
            return "" if s.lower() == "nan" else s
        except Exception:
            return ""

    def _first_author_surname(authors_str: str):
        a = _nz(authors_str).strip()
        if not a:
            return ""
        first = re.split(r"[;,&]| and ", a)[0].strip()
        if "," in first:
            first = first.split(",", 1)[0].strip()
        parts = first.split()
        return parts[-1] if parts else first

    def _make_bib(authors_str, year):
        # "Surname (YYYY)"
        yr = ""
        try:
            yr = str(int(year))
        except Exception:
            yr = _nz(year)
        sur = _first_author_surname(authors_str) or "n.a."
        return f"{sur} ({yr})" if yr else f"{sur}"

    def _apa_text_from_bib(bib_text: str):
        """
        Convert "Name (YYYY)" → "Name, YYYY". If not matching, return as-is.
        """
        m = re.match(r"^(.*?)\s*\((\d{4})\)\s*$", _nz(bib_text))
        if not m:
            return _nz(bib_text)
        name, year = m.group(1).strip(), m.group(2)
        return f"{name}, {year}"

    def _build_anchor(key: str, bib: str, title_text: str | None = None):
        inner = f"({_apa_text_from_bib(bib)})"
        title_attr = f' title="{html.escape(title_text or "", quote=True)}"' if title_text else ""
        return f'<a key="{html.escape(key)}" bib="{html.escape(bib)}"{title_attr}>{html.escape(inner)}</a>'

    # ── harvest keys + bibs from ALL input fragments (used for normalization) ─
    raw_fragments_html = "\n\n".join([_nz(b) for b in batches if _nz(b)])
    keys = set()
    key_to_bib: dict[str, str] = {}

    # (1) Newer <a ... data-key="K" data-bib="Bib">…</a>
    for m in re.finditer(
        r"<a[^>]*\bdata-key=\"([^\"]+)\"[^>]*\bdata-bib=\"([^\"]+)\"[^>]*>.*?</a>",
        raw_fragments_html, flags=re.I | re.S
    ):
        k, bib = (m.group(1) or "").strip(), (m.group(2) or "").strip()
        if k:
            keys.add(k)
            if k not in key_to_bib and bib:
                key_to_bib[k] = bib

    # (2) Generic <a href="K">Visible</a> (fallback bib from visible)
    for m in re.finditer(
        r"<a[^>]*\bhref=\"([^\"]+)\"[^>]*>(.*?)</a>",
        raw_fragments_html, flags=re.I | re.S
    ):
        k = (m.group(1) or "").strip()
        vis = html.unescape((m.group(2) or "").strip())
        if k:
            keys.add(k)
            if k not in key_to_bib and vis:
                key_to_bib[k] = vis

    # (3) Legacy <sup ... bib="KEY" ...>...</sup>
    for m in re.finditer(
        r"<sup[^>]*\bbib=\"([^\"]+)\"[^>]*>.*?</sup>",
        raw_fragments_html, flags=re.I | re.S
    ):
        k = (m.group(1) or "").strip()
        if k:
            keys.add(k)

    # ── augment bibs from DF if available (authors/year → "Surname (YYYY)") ─
    df = (results_so_far or {}).get("dataframe_full")
    if df is not None and hasattr(df, "empty") and not df.empty:
        try:
            by_key = {str(r.get("key")): r for _, r in df.iterrows()}
        except Exception:
            by_key = {}
        for k in list(keys):
            if key_to_bib.get(k):
                continue
            row = by_key.get(k)
            if row is not None:
                authors_val = _nz(row.get("authors") or row.get("authors_list"))
                year_val = row.get("year")
                key_to_bib[k] = _make_bib(authors_val, year_val)

    # fallback: any keys still missing → use the key string as bib placeholder
    for k in list(keys):
        key_to_bib.setdefault(k, k)

    # ── PROMPT (batch consolidation → narrative with <a key bib title>) ──────
    try:
        tpl_cons, cons_model, cons_max_t, _schema, cons_effort = _get_prompt_details(
            "bReview_batches_to_narrative_with_anchors", ai_provider_key,  model_api_name,section_id=section_step_key,results_so_far=results_so_far
        )
    except Exception:
        tpl_cons, cons_model, cons_max_t, _schema, cons_effort = (None, model_api_name, 9000, None, "high")

    if not tpl_cons or "Fallback" in str(tpl_cons) or "Error" in str(tpl_cons):
        tpl_cons = (
            "You are assisting with an academic revision for a research report.\n\n"
            "SECTION TITLE: {section_title}\n"
            "REVISION REQUEST:\n---\n{revision}\n---\n\n"
            "SECTION CONTEXT (use for scope/voice; do NOT quote it):\n---\n{section_text}\n---\n\n"
            "You are given HTML evidence fragments (batches) made of <p>…</p> and anchors to sources.\n"
            "Select only material that directly answers the revision for this section.\n\n"
            "WRITE {min_paragraphs}–{max_paragraphs} PARAGRAPHS of polished academic prose.\n"
            "• Synthesize evidence (cluster by ideas), do not list quotes.\n"
            "• No headings, lists, or prefaces. Output MUST be ONLY <p>…</p> blocks.\n"
            "• End EACH paragraph with one or more anchors, each EXACTLY:\n"
            '  <a key="KEY" bib="BIB" title="EXACT 1–2 sentence verbatim from the fragment">(Author, Year)</a>\n'
            "  – KEY and BIB must come from the given fragments only (do not invent).\n"
            "  – The visible text MUST be APA in-text built from BIB: (Surname, YYYY).\n"
            "  – If multiple sources support a paragraph, include multiple anchors separated by a single space.\n\n"
            "EVIDENCE BATCHES (HTML):\n--- BEGIN BATCHES ---\n{batches_html}\n--- END BATCHES ---"
        )

    def _render_prompt_for(batch_html: str) -> str:
        return tpl_cons.format(
            section_title=section_step_key,   # dynamic: route under caller's section
            revision=revision,
            section_text=section_text,
            batches_html=_nz(batch_html),
            min_paragraphs=int(min_paragraphs),
            max_paragraphs=int(max_paragraphs),
        )

    # ── PHASE A: enqueue each batch (STORE-ONLY) ─────────────────────────────
    # one request per batch; unique custom_id per batch for later selection
    batch_custom_ids: list[str] = []
    for idx, batch_html in enumerate(batches, start=1):
        prompt_i = _render_prompt_for(batch_html)
        # unique custom_id per batch line to select later
        h = hashlib.md5((revision + section_step_key + str(idx)).encode("utf-8")).hexdigest()[:10]
        cid = f"rev_batches_to_narrative:{idx}:{h}"
        batch_custom_ids.append(cid)

        _ = call_models(
            ai_provider_key=ai_provider_key,
            model_api_name=cons_model or model_api_name,
            prompt_text=prompt_i,
            analysis_key_suffix="rev_batches_to_narrative_v1",
            max_tokens=cons_max_t,
            base_output_dir_for_logs=(results_so_far or {}).get("base_output_dir"),
            use_cache=use_cache,
            store_only=True,     # enqueue
            read=False,
            section_title=section_step_key,  # dynamic routing to the caller's section
            custom_id=cid,
            results_so_far=results_so_far,
            effort=cons_effort,
            overall_topic=overall_topic
,

        )

    # ── PHASE B: process the whole file once (runs the OpenAI Batch) ─────────
    ok = False
    try:
        _cb("[consolidate] Submitting and polling batch for completion…")
        ok = _process_batch_for(
            analysis_key_suffix="rev_batches_to_narrative_v1",
            section_title=section_step_key,   # dynamic collection name
            completion_window="24h",
            poll_interval=15,
        )
    except Exception as _e_proc:
        _cb(f"[consolidate] WARNING: _process_batch_for failed: {_e_proc!r}")

    # ── PHASE C: read each batch result and accumulate paragraphs ────────────
    collected_paras: list[str] = []
    for idx, cid in enumerate(batch_custom_ids, start=1):
        prompt_i = _render_prompt_for(batches[idx - 1])  # same prompt text as written

        # If batch processing failed, fall back to inline execution so we still return content.
        pkg = call_models(
            ai_provider_key=ai_provider_key,
            model_api_name=cons_model or model_api_name,
            prompt_text=prompt_i,
            analysis_key_suffix="rev_batches_to_narrative_v1",
            max_tokens=cons_max_t,
            base_output_dir_for_logs=(results_so_far or {}).get("base_output_dir"),
            use_cache=use_cache,
            store_only=False,
            read=True if ok else False,               # read from batch outputs if available; else run inline
            section_title=section_step_key,           # dynamic routing
            custom_id=cid,
            results_so_far=results_so_far,
            effort=cons_effort,
            overall_topic=overall_topic
        )

        raw_out = ""
        if isinstance(pkg, dict) and not pkg.get("error"):
            raw_out = (_nz(pkg.get("raw_text"))).strip()
        elif not ok and isinstance(pkg, dict):
            # Inline run path returns raw_text directly as well
            raw_out = (_nz(pkg.get("raw_text"))).strip()

        # keep only <p> blocks if present
        paras_i = re.findall(r"<p[\s>][\s\S]*?</p>", raw_out, flags=re.I)
        if paras_i:
            collected_paras.extend(paras_i)
        elif raw_out:
            # treat as one paragraph if model didn't wrap
            collected_paras.append(f"<p>{html.escape(raw_out)}</p>")

    # merge all batch outputs
    out_html = "\n".join(collected_paras).strip()

    # ── Normalize anchors to <a key="…" bib="…" title="…">(Author, Year)</a> ──
    # 1) Convert legacy <sup bib="KEY" ...>…</sup> to anchors (title left empty for now)
    def _sup_to_a(match):
        k = (match.group(1) or "").strip()
        bib = key_to_bib.get(k, k)
        return " " + _build_anchor(k, bib)

    out_html = re.sub(r"\s*<sup[^>]*\bbib=\"([^\"]+)\"[^>]*>.*?</sup>\s*", _sup_to_a, out_html, flags=re.I | re.S)

    # 2) Normalize any <a ... href="KEY" ...>Visible</a> into our shape (title empty for now)
    def _normalize_href_a(match):
        k = (match.group(1) or "").strip()
        vis = html.unescape((match.group(2) or "").strip())
        # Prefer known bib; else use visible text; else fallback to key.
        bib = key_to_bib.get(k, vis or k)
        return _build_anchor(k, bib)

    out_html = re.sub(r"<a[^>]*\bhref=\"([^\"]+)\"[^>]*>(.*?)</a>", _normalize_href_a, out_html, flags=re.I | re.S)

    # 3) Convert data-* to required attributes (retain title if present)
    def _normalize_data_a(m):
        tag = m.group(0)
        # key
        mkey = re.search(r'\bdata-key="([^"]+)"', tag, flags=re.I)
        k = (mkey.group(1) if mkey else "").strip()
        # bib
        mbib = re.search(r'\bdata-bib="([^"]+)"', tag, flags=re.I)
        b = (mbib.group(1) if mbib else "").strip()
        # title (verbatim) if present
        mtit = re.search(r'\btitle="([^"]+)"', tag, flags=re.I)
        t = html.unescape((mtit.group(1) if mtit else "").strip())
        if not k:
            return tag  # leave as-is if no key found
        if not b:
            b = key_to_bib.get(k, k)
        return _build_anchor(k, b, t)

    out_html = re.sub(r"<a[^>]*\bdata-key=\"[^\" ]+\"[^>]*>.*?</a>", _normalize_data_a, out_html, flags=re.I | re.S)

    # 4) Ensure each paragraph ends with >=1 anchor; if missing but we know keys, append one
    if keys:
        def _ensure_trailing_anchor(p_html):
            if re.search(r"</a>\s*</p>\s*$", p_html, flags=re.I):
                return p_html
            # Append a default anchor with first known key/bib
            k = next(iter(keys))
            b = key_to_bib.get(k, k)
            anc = _build_anchor(k, b)
            return re.sub(r"\s*</p>\s*$", f" {anc}</p>", p_html, flags=re.I)

        parts = re.findall(r"<p[\s>][\s\S]*?</p>", out_html, flags=re.I)
        if parts:
            parts = [_ensure_trailing_anchor(p) for p in parts]
            out_html = "\n".join(parts)

    # 5) If any anchor lacks title, set it to the first 1–2 sentences of its paragraph (verbatim)
    def _first_sentences(txt: str, max_sents=2, max_len=300):
        # strip inner tags
        t = re.sub(r"<[^>]+>", "", txt)
        # grab 1–2 sentences
        sents = re.split(r"(?<=[\.!\?])\s+", t.strip())
        joined = " ".join(sents[:max_sents]).strip()
        return joined[:max_len].strip()

    def _fill_titles_in_paragraph(p_html: str):
        par_title = _first_sentences(p_html, 2, 300)
        def _ensure_title(m):
            tag = m.group(0)
            has_title = re.search(r'\btitle="[^"]*"', tag, flags=re.I)
            if has_title:
                return tag
            mk = re.search(r'\bkey="([^"]+)"', tag, flags=re.I)
            mb = re.search(r'\bbib="([^"]+)"', tag, flags=re.I)
            k = (mk.group(1) if mk else "").strip()
            b = (mb.group(1) if mb else "").strip() or key_to_bib.get(k, k)
            return _build_anchor(k or "", b, par_title) if k else tag
        return re.sub(r"<a\b[^>]*>(.*?)</a>", _ensure_title, p_html, flags=re.I | re.S)

    parts = re.findall(r"<p[\s>][\s\S]*?</p>", out_html, flags=re.I)
    if parts:
        parts = [_fill_titles_in_paragraph(p) for p in parts]

        # 6) Clamp to desired paragraph count
        if max_paragraphs and len(parts) > max_paragraphs:
            parts = parts[:max_paragraphs]
        if min_paragraphs and 0 < len(parts) < min_paragraphs:
            # keep fewer rather than fabricating content
            pass

        out_html = "\n".join(parts)

    return out_html
def _consolidating_thematic_keyword(
    *,
    kw_batches: List[Dict[str, List[str]]],         # [{keyword: [payload_html_batch, ...]}, ...]
    ai_provider_key: str,
    model_api_name: str,
    results_so_far: Optional[dict] = None,
    progress_callback=None,
    use_cache: bool = True,
    section_step_key: str = STEP_AI_GENERAL_KEYWORD_THEMES_ANALYSIS,
) -> Dict[str, Any]:
    """
    ASYNCHRONOUS (concurrent) consolidation per keyword using prompt keys:
      • Phase 1  -> 'coding_keyword_consolidation'  (returns HTML subsection with <h3> + <p>…</p>)
      • Phase 2  -> 'initial_draft_thematic_keyword' (refines to a final HTML subsection)

    Returns when ALL keywords are processed.

    Output:
      {
        "type": "keyword_consolidations",
        "data":     { <keyword>: "<h3>…</h3><p>…</p>…" },     # phase-1 HTML
        "sections": { <keyword>: "<h3>…</h3><p>…</p>…" },     # phase-2 refined HTML
        "meta":     { <keyword>: { "batch_count": int, "section_namespace": str,
                                   "phase1_title": str, "phase2_title": str } },
        "description": "coding_keyword_consolidation_v1"
      }
    """
    import json, re, hashlib
    from typing import Any, Dict, List, Optional

    # ── tiny logger/callback shim ─────────────────────────────────────────────
    def _cb(msg: str):
        if progress_callback:
            try:
                progress_callback(msg)
            except Exception:
                pass

    # ── guards ───────────────────────────────────────────────────────────────
    if not isinstance(kw_batches, list) or not kw_batches:
        return {
            "type": "keyword_consolidations",
            "data": {},
            "meta": {},
            "sections": {},
            "description": "coding_keyword_consolidation_v1",
        }

    # ── helpers ──────────────────────────────────────────────────────────────
    def _norm_str(v: Any) -> str:
        try:
            s = "" if v is None else str(v)
            return "" if s.lower() == "nan" else s.strip()
        except Exception:
            return ""

    def _slug(s: str) -> str:
        return re.sub(r"[^A-Za-z0-9_.-]+", "_", str(s or "")).strip("_") or "kw"

    def _safe_json_dumps(obj: Any) -> str:
        try:
            return json.dumps(obj, ensure_ascii=False)
        except Exception:
            try:
                return json.dumps(json.loads(json.dumps(obj, default=str)), ensure_ascii=False)
            except Exception:
                return "{}"

    def _extract_h3_title(html_text: str) -> str:
        m = re.search(r"<h3[^>]*>(.*?)</h3>", html_text or "", flags=re.I | re.S)
        if not m:
            return ""
        # strip inner tags if any
        title = re.sub(r"<[^>]+>", "", m.group(1)).strip()
        return title

    # Ensure downstream storage
    try:
        results_so_far.setdefault("keyword_consolidations", [])
    except Exception:
        pass

    # ── Phase 1: consolidation prompt details (HTML out) ─────────────────────
    try:
        tpl_cons, cons_model, cons_max_t, _schema1, cons_effort = _get_prompt_details(
            "coding_keyword_consolidation", ai_provider_key,  model_api_name,section_id=section_step_key,results_so_far=results_so_far
        )
    except Exception:
        tpl_cons, cons_model, cons_max_t, _schema1, cons_effort = (None, model_api_name, 9000, None, "high")

    if not tpl_cons or "Fallback" in str(tpl_cons) or "Error" in str(tpl_cons):
        # Fallback prompt copied from your config object (HTML-only variant)
        tpl_cons = (
            "System: You are a senior synthesis editor for thematic coding. You receive evidence about a SINGLE keyword "
            "and must produce ONE HTML subsection that reads like a mini literature review.\n\n"
            "--- BEGIN PAYLOAD ---\n{payload}\n--- END PAYLOAD ---"
        )

    def _render_cons_payload(keyword: str, payloads: List[str]) -> str:
        return _safe_json_dumps({
            "keyword": keyword,
            "batches_html": payloads or [],
            "sources_html": "\n\n".join([_norm_str(p) for p in (payloads or []) if _norm_str(p)]),
        })

    def _render_cons_prompt(keyword: str, payloads: List[str]) -> str:
        return tpl_cons.format(payload=_render_cons_payload(keyword, payloads))

    # ── Enqueue Phase 1 jobs per keyword ─────────────────────────────────────
    phase1_jobs: List[Dict[str, Any]] = []
    for entry in kw_batches:
        if not isinstance(entry, dict) or not entry:
            continue
        keyword, payloads = next(iter(entry.items()))
        kw = _norm_str(keyword)
        if not kw:
            continue

        kw_tag = _slug(kw)
        section_ns = f"{section_step_key}_{kw_tag}"
        prompt_text = _render_cons_prompt(kw, payloads or [])
        cid_hash = hashlib.md5((kw + section_ns).encode("utf-8")).hexdigest()[:10]
        custom_id = f"kw_consolidation:{kw_tag}:{cid_hash}"
        overall_topic = results_so_far.get(STEP_LOAD_DATA, {}).get("collection_name_for_title", "the research topic")

        _ = call_models(
            ai_provider_key=ai_provider_key,
            model_api_name=cons_model or model_api_name,
            prompt_text=prompt_text,
            analysis_key_suffix="coding_keyword_consolidation_v1",
            max_tokens=cons_max_t,
            base_output_dir_for_logs=(results_so_far or {}).get("base_output_dir"),
            use_cache=use_cache,
            store_only=True,     # enqueue into batch
            read=False,
            section_title=STEP_AI_GENERAL_KEYWORD_THEMES_ANALYSIS,  # per-keyword namespace
            custom_id=custom_id,
            results_so_far=results_so_far,
            effort=cons_effort,
            overall_topic=overall_topic
        )

        phase1_jobs.append({
            "keyword": kw,
            "payloads": payloads or [],
            "batch_count": len(payloads or []),
            "section_ns": section_ns,
            "prompt_text": prompt_text,
            "custom_id": custom_id,
        })

    if not phase1_jobs:
        return {
            "type": "keyword_consolidations",
            "data": {},
            "meta": {},
            "sections": {},
            "description": "coding_keyword_consolidation_v1",
        }

    # Submit batch per namespace
    def _run_batch(ns: str) -> tuple[str, bool, Optional[str]]:
        try:
            _cb(f"[kw-consolidation] Submitting batch for namespace '{ns}'…")
            ok = _process_batch_for(
                analysis_key_suffix="coding_keyword_consolidation_v1",
                section_title=STEP_AI_GENERAL_KEYWORD_THEMES_ANALYSIS,
                completion_window="24h",
                poll_interval=15,
            )
            return ns, bool(ok), None
        except Exception as e:
            return ns, False, repr(e)

    namespaces = sorted({j["section_ns"] for j in phase1_jobs})
    ns_results: Dict[str, bool] = {}
    from concurrent.futures import ThreadPoolExecutor, as_completed
    with ThreadPoolExecutor(max_workers=min(8, len(namespaces))) as ex:
        fut_map = {ex.submit(_run_batch, ns): ns for ns in namespaces}
        for fut in as_completed(fut_map):
            ns, ok, err = fut.result()
            ns_results[ns] = ok
            if not ok and err:
                _cb(f"[kw-consolidation] WARNING: batch failed for '{ns}': {err}")

    # Read Phase 1 (or inline fallback)
    def _read_or_inline_phase1(job: Dict[str, Any]) -> Dict[str, Any]:
        kw = job["keyword"]
        ns = job["section_ns"]
        read_from_batch = ns_results.get(ns, False)

        pkg = call_models(
            ai_provider_key=ai_provider_key,
            model_api_name=cons_model or model_api_name,
            prompt_text=job["prompt_text"],
            analysis_key_suffix="coding_keyword_consolidation_v1",
            max_tokens=cons_max_t,
            base_output_dir_for_logs=(results_so_far or {}).get("base_output_dir"),
            use_cache=use_cache,
            store_only=False,
            read=True if read_from_batch else False,
            section_title=STEP_AI_GENERAL_KEYWORD_THEMES_ANALYSIS,
            custom_id=job["custom_id"],
            results_so_far=results_so_far,
            effort=cons_effort,
            overall_topic=results_so_far.get(STEP_LOAD_DATA, {}).get("collection_name_for_title", "the research topic")
        )

        raw_html = ""
        if isinstance(pkg, dict) and not pkg.get("error"):
            raw_html = _norm_str(pkg.get("raw_text"))

        # Title from <h3> if present
        phase1_title = _extract_h3_title(raw_html)

        # Emit monitor card
        try:
            emit_revisions_batches(
                results_so_far=results_so_far,
                revisions_map=[{
                    "revision": f"Keyword refinement — {kw}",
                    "keyword": kw,
                    "consolidated_html": raw_html,  # refined body goes here
                    # optionally carry Phase-1 evidence again for the “Evidence” tab:
                    "batches": [],  # or: original batches if you want them visible
                    "raw_count": 0,
                }],

                section_title=STEP_AI_GENERAL_KEYWORD_THEMES_ANALYSIS,
            )

        except Exception as _e:
            _cb(f"[WARN] emit_revisions_batches (phase1) failed for '{kw}': {_e}")

        return {"keyword": kw, "namespace": ns, "html": raw_html, "title": phase1_title, "batch_count": job["batch_count"]}

    phase1_map: Dict[str, str] = {}
    meta_map: Dict[str, Dict[str, Any]] = {}

    with ThreadPoolExecutor(max_workers=min(8, len(phase1_jobs))) as ex:
        fut_map = {ex.submit(_read_or_inline_phase1, j): j["keyword"] for j in phase1_jobs}
        for fut in as_completed(fut_map):
            res = fut.result()
            kw = res["keyword"]
            phase1_map[kw] = res["html"] or ""
            meta_map[kw] = {
                "batch_count": res["batch_count"],
                "section_namespace": res["namespace"],
                "phase1_title": res["title"] or "",
                "phase2_title": "",  # filled after refinement
            }
            # Persist snapshot for downstream
            try:
                results_so_far.setdefault("keyword_consolidations", []).append({
                    "keyword": kw,
                    "phase1_html": res["html"],
                    "meta": meta_map[kw],
                })
            except Exception:
                pass

    # ── Phase 2: refinement prompt details (HTML out) ────────────────────────
    try:
        tpl_ref, ref_model, ref_max_t, _schema2, ref_effort = _get_prompt_details(
            "initial_draft_thematic_keyword", ai_provider_key,  model_api_name,section_id=section_step_key,results_so_far=results_so_far
        )
    except Exception:
        tpl_ref, ref_model, ref_max_t, _schema2, ref_effort = (None, model_api_name, 9000, None, "high")

    if not tpl_ref or "Fallback" in str(tpl_ref) or "Error" in str(tpl_ref):
        # Fallback prompt copied from your config object (HTML-only variant)
        tpl_ref = (
            "System: You refine a thematic keyword subsection into a cohesive academic section.\n"
            "--- BEGIN MATERIALS ---\n{payload}\n--- END MATERIALS ---"
        )

    def _render_ref_payload(keyword: str, phase1_html: str, original_batches: List[str]) -> str:
        return _safe_json_dumps({
            "keyword": keyword,
            "consolidated_html": phase1_html or "",
            "sources_html": "\n\n".join([_norm_str(p) for p in (original_batches or []) if _norm_str(p)]),
            "batches_html": original_batches or [],
        })

    def _render_ref_prompt(keyword: str, phase1_html: str, original_batches: List[str]) -> str:
        return tpl_ref.format(payload=_render_ref_payload(keyword, phase1_html, original_batches))

    # Enqueue Phase 2 jobs
    phase2_jobs: List[Dict[str, Any]] = []
    for entry in kw_batches:
        if not isinstance(entry, dict) or not entry:
            continue
        keyword, payloads = next(iter(entry.items()))
        kw = _norm_str(keyword)
        if not kw:
            continue

        kw_tag = _slug(kw)
        ns = f"{section_step_key}_{kw_tag}:refined"
        prompt_text = _render_ref_prompt(kw, phase1_map.get(kw, ""), payloads or [])
        cid_hash = hashlib.md5((kw + ns).encode("utf-8")).hexdigest()[:10]
        custom_id = f"kw_refine:{kw_tag}:{cid_hash}"

        _ = call_models(
            ai_provider_key=ai_provider_key,
            model_api_name=ref_model or model_api_name,
            prompt_text=prompt_text,
            analysis_key_suffix="initial_draft_thematic_keyword_v1",
            max_tokens=ref_max_t,
            base_output_dir_for_logs=(results_so_far or {}).get("base_output_dir"),
            use_cache=use_cache,
            store_only=True,
            read=False,
            section_title=STEP_AI_GENERAL_KEYWORD_THEMES_ANALYSIS,
            custom_id=custom_id,
            results_so_far=results_so_far,
            effort=ref_effort,
            overall_topic=results_so_far.get(STEP_LOAD_DATA, {}).get("collection_name_for_title", "the research topic")
        )

        phase2_jobs.append({
            "keyword": kw,
            "section_ns": ns,
            "prompt_text": prompt_text,
            "custom_id": custom_id,
        })

    # Submit/read Phase 2 batches
    def _run_batch_ref(ns: str) -> tuple[str, bool, Optional[str]]:
        try:
            _cb(f"[kw-refine] Submitting batch for namespace '{ns}'…")
            ok = _process_batch_for(
                analysis_key_suffix="initial_draft_thematic_keyword_v1",
                section_title=STEP_AI_GENERAL_KEYWORD_THEMES_ANALYSIS,
                completion_window="24h",
                poll_interval=15,
            )
            return ns, bool(ok), None
        except Exception as e:
            return ns, False, repr(e)

    ref_namespaces = sorted({j["section_ns"] for j in phase2_jobs})
    ref_ns_results: Dict[str, bool] = {}
    with ThreadPoolExecutor(max_workers=min(8, len(ref_namespaces))) as ex:
        fut_map = {ex.submit(_run_batch_ref, ns): ns for ns in ref_namespaces}
        for fut in as_completed(fut_map):
            ns, ok, err = fut.result()
            ref_ns_results[ns] = ok
            if not ok and err:
                _cb(f"[kw-refine] WARNING: batch failed for '{ns}': {err}")

    def _read_or_inline_phase2(job: Dict[str, Any]) -> Dict[str, Any]:
        kw = job["keyword"]
        ns = job["section_ns"]

        # --- 1) EXPLICIT BATCH READ (read=True) ---
        pkg = call_models(
            ai_provider_key=ai_provider_key,
            model_api_name=ref_model or model_api_name,
            prompt_text=job["prompt_text"],
            analysis_key_suffix="initial_draft_thematic_keyword_v1",
            max_tokens=ref_max_t,
            base_output_dir_for_logs=(results_so_far or {}).get("base_output_dir"),
            use_cache=use_cache,
            store_only=False,
            read=True,  # <-- force reading from the batch we enqueued earlier
            section_title=STEP_AI_GENERAL_KEYWORD_THEMES_ANALYSIS,
            custom_id=job["custom_id"],
            results_so_far=results_so_far,
            effort=ref_effort,
            overall_topic=overall_topic
        )


        raw_html = ""
        if isinstance(pkg, dict) and not pkg.get("error"):
            raw_html = _norm_str(pkg.get("raw_text"))

        # --- 2) FALLBACK: INLINE RUN (read=False) IF BATCH READ EMPTY/ERROR ---
        if not raw_html:
            pkg = call_models(
                ai_provider_key=ai_provider_key,
                model_api_name=ref_model or model_api_name,
                prompt_text=job["prompt_text"],
                analysis_key_suffix="initial_draft_thematic_keyword_v1",
                max_tokens=ref_max_t,
                base_output_dir_for_logs=(results_so_far or {}).get("base_output_dir"),
                use_cache=use_cache,
                store_only=False,
                read=False,  # <-- run inline if batch retrieval failed/empty
                section_title=STEP_AI_GENERAL_KEYWORD_THEMES_ANALYSIS,
                custom_id=job["custom_id"],
                results_so_far=results_so_far,
                effort=ref_effort,
                overall_topic=overall_topic
            )

            if isinstance(pkg, dict) and not pkg.get("error"):
                raw_html = _norm_str(pkg.get("raw_text"))

        phase2_title = _extract_h3_title(raw_html)

        try:
            emit_revisions_batches(
                results_so_far=results_so_far,
                revisions_map=[{
                    # what the review was about (free text label)
                    "revision": f"Keyword consolidation — {kw}",
                    "keyword": kw,
                    # what to actually show on the Reviewing tab
                    "consolidated_html": raw_html,
                    # what to show on the Evidence tab
                    "batches": job.get("payloads") or [],
                    "raw_count": int(job.get("batch_count") or 0),
                }],

                section_title=STEP_AI_GENERAL_KEYWORD_THEMES_ANALYSIS,
            )
        except Exception as _e:
            _cb(f"[WARN] emit_revisions_batches (phase2) failed for '{kw}': {_e}")

        return {"keyword": kw, "html": raw_html, "title": phase2_title, "namespace": ns}

    sections_map: Dict[str, str] = {}
    with ThreadPoolExecutor(max_workers=min(8, len(phase2_jobs))) as ex:
        fut_map = {ex.submit(_read_or_inline_phase2, j): j["keyword"] for j in phase2_jobs}
        for fut in as_completed(fut_map):
            res = fut.result()
            kw = res["keyword"]
            sections_map[kw] = res["html"] or ""
            if kw in meta_map:
                meta_map[kw]["phase2_title"] = res["title"] or ""
                meta_map[kw]["section_namespace"] = res["namespace"]

            # Persist snapshot
            try:
                results_so_far.setdefault("keyword_consolidations", []).append({
                    "keyword": kw,
                    "phase2_html": res["html"],
                    "meta": meta_map.get(kw, {}),
                })
            except Exception:
                pass

    # Final package
    return {
        "type": "keyword_consolidations",
        "data": phase1_map,          # phase-1 HTML per keyword
        "sections": sections_map,    # phase-2 refined HTML per keyword
        "meta": meta_map,
        "description": "coding_keyword_consolidation_v1",
    }


def prepare_r2_inputs_from_r1(
    r1_pkg: dict,
    *,
    section_title: str,
    overall_topic: str,
    df_full,                                  # pandas.DataFrame (fallback only)
    results_so_far: dict,                     # PRIMARY source of truth
    zot_client,                               # your Zotero client
    progress_callback=None,
        model_name= "gpt5",

    section_step_key: str = STEP__TIMELINE,
):
    """
    Return EXACTLY: { "revisons": [ { "<revision>": <payload> }, ... ] }

    Tri-phase aware (phase_1, phase_2, phase_3). Allowed input types:
      {"none","keywords","locator","quote_page","source_type","author_key","stats"}.

    Behavior highlights:
      • keyword-like inputs → DF catalog search + optional PDF extraction via extract_content_for_keywords
        -> normalized to {title, aauthor, key, hits:[HTML]} (hits from section_html iff section_required else original_paragraph)
      • If PDF extracted hits > 10 → call consolidator and REPLACE payload with compact {"consolidated": {...}}
      • stats → never trigger PDF extraction
      • author_key → metadata only {title, date, itemType, authors} + core_sections via process_pdf(pdf_path=..., core_sections=True)["payload"]
    """
    import json, logging, re

    # ── small logger shim ─────────────────────────────────────────────────────
    def _cb(msg: str):
        if progress_callback:
            try:
                progress_callback(msg)
            except Exception:
                pass
        try:
            logging.info(msg)
        except Exception:
            pass

    # ── helpers to parse variable R1 shapes ───────────────────────────────────
    def _parse_json_maybe(s):
        try:
            return json.loads(s) if isinstance(s, str) and s.strip().startswith("{") else None
        except Exception:
            return None

    def _phase_payload(phase_blob: dict | None, phase_key: str):
        if not isinstance(phase_blob, dict):
            return []
        cand = phase_blob.get("content")
        if isinstance(cand, dict) and phase_key in cand:
            block = cand[phase_key]
            if isinstance(block, dict) and isinstance(block.get("revisions"), list):
                return list(block["revisions"])
            if isinstance(block, list):
                return list(block)
        rt = phase_blob.get("raw_text")
        j = _parse_json_maybe(rt)
        if isinstance(j, dict) and phase_key in j:
            block = j[phase_key]
            if isinstance(block, dict) and isinstance(block.get("revisions"), list):
                return list(block["revisions"])
            if isinstance(block, list):
                return list(block)
        if phase_key in phase_blob:
            block = phase_blob[phase_key]
            if isinstance(block, dict) and isinstance(block.get("revisions"), list):
                return list(block["revisions"])
            if isinstance(block, list):
                return list(block)
        return []

    # ── extract phases + legacy ───────────────────────────────────────────────
    phase1_revs = _phase_payload((r1_pkg or {}).get("phase_1"), "phase_1")
    phase2_revs = _phase_payload((r1_pkg or {}).get("phase_2"), "phase_2")
    phase3_revs = _phase_payload((r1_pkg or {}).get("phase_3"), "phase_3")
    r1_data = (r1_pkg or {}).get("data") or {}
    legacy_revs = r1_data.get("suggested_revisions") or []

    def _canon_rev(r):
        if isinstance(r, str):
            return {"revision": r.strip(), "inputs_needed": [{"type": "none"}]}
        if isinstance(r, dict) and isinstance(r.get("revision"), str):
            out = {**r}
            if not isinstance(out.get("inputs_needed"), list):
                out["inputs_needed"] = [{"type": "none"}]
            return out
        if isinstance(r, dict) and isinstance(r.get("text"), str):
            return {"revision": r["text"].strip(), "inputs_needed": [{"type": "none"}]}
        return None

    def _iter_all_revs():
        for r in (phase1_revs or []):
            c = _canon_rev(r);  c and (yield ("phase_1", c))
        for r in (phase2_revs or []):
            c = _canon_rev(r);  c and (yield ("phase_2", c))
        for r in (phase3_revs or []):
            c = _canon_rev(r);  c and (yield ("phase_3", c))
        for r in (legacy_revs or []):
            c = _canon_rev(r);  c and (yield ("legacy", c))

    # ── results_so_far accessors (primary) ────────────────────────────────────
    def _get_df_from_results():
        try:
            ld = results_so_far.get("Load Data") or results_so_far.get("LoadData")
            if isinstance(ld, dict) and "raw_df_full" in ld:
                return ld.get("raw_df_full")
        except Exception:
            pass
        try:
            for _k, v in (results_so_far or {}).items():
                if isinstance(v, dict) and "raw_df_full" in v:
                    return v.get("raw_df_full")
        except Exception:
            pass
        return df_full


    # ── text utils ────────────────────────────────────────────────────────────
    def _norm_str(x):
        try:
            s = str(x)
        except Exception:
            return ""
        return s if s.lower() != "nan" else ""

    def _dedupe_keep_order(seq, key=lambda x: x):
        seen, out = set(), []
        for v in seq or []:
            k = key(v)
            if k not in seen:
                seen.add(k); out.append(v)
        return out

    def _make_terms_from_verbatim(v):
        s = _norm_str(v)
        toks = [t for t in re.split(r"[^A-Za-z0-9]+", s) if len(t) >= 3]
        return _dedupe_keep_order([t.lower() for t in toks])

    # ── DF KEYWORD SEARCH ─────────────────────────────────────────────────────
    def extract_keyword_hits(
            query_terms,
            fields_text=('title', 'abstract', 'user_notes', 'argumentation_logic',
                         'controlled_vocabulary_terms', 'notes', 'full_text'),
            fields_meta=(),  # we avoid meta-only fields like journal/publicationTitle/item_type by default
    ):
        """
        Scans the catalog DF for query_terms across `fields_text` (and optional `fields_meta` if provided).
        Returns a CLEAN HTML string payload with one <p> per matched snippet:
            <p>…complete snippet…<sup><a data-bib="Authors (Year)" data-key="ITEMKEY">Authors (Year)</a></sup></p>

        Notes:
          • No per-item hit limits.
          • We DO NOT attach abstracts/other metadata to the payload; we only render snippets.
          • Terms like "none", "n/a", "null", "-" are dropped as sentinels.
          • Duplicates are de-duplicated (same item_key + same snippet).
        """
        import re
        import html

        # ------ helpers ---------------------------------------------------------
        _SENTINELS = {"none", "n/a", "na", "null", "nil", "-", "—", ""}

        def _nz(v):
            try:
                s = "" if v is None else str(v)
                return "" if s.lower() in {"nan", "none"} else s
            except Exception:
                return ""

        def _clean_terms(terms):
            out, seen = [], set()
            for t in (terms or []):
                s = _nz(t).strip()
                sl = s.lower()
                if not s or sl in _SENTINELS:
                    continue
                if sl not in seen:
                    seen.add(sl)
                    out.append(s)
            return out

        def _first_author_surname(authors_str):
            a = _nz(authors_str).strip()
            if not a:
                return ""
            # Split common separators and take first chunk
            first = re.split(r"[;,&]| and ", a)[0].strip()
            # If "Surname, Given" form, take before comma
            if "," in first:
                first = first.split(",", 1)[0].strip()
            # Last token heuristic if single token looks multi-part
            parts = first.split()
            return parts[-1] if parts else first

        def _make_bib(authors_str, year):
            yr = ""
            try:
                yr = str(int(year))
            except Exception:
                yr = _nz(year)
            sur = _first_author_surname(authors_str) or "n.a."
            return f"{sur} ({yr})" if yr else f"{sur}"

        def _is_trivial_text(s):
            ss = _nz(s).strip().lower()
            return (not ss) or (ss in {"none", "nan", "null"})

        def _extract_complete_snippet(text, primary_term_lc):
            """
            Prefer a full paragraph containing the match (split on blank lines or single newlines),
            otherwise fall back to the full sentence, otherwise return the whole (trimmed) text.
            """
            t = _nz(text)
            if not t:
                return ""
            tl = t.lower()

            # If we can find the primary term, extract boundaries
            idx = tl.find(primary_term_lc) if primary_term_lc else -1

            # Paragraph heuristic
            if "\n" in t:
                chunks = re.split(r"\n{2,}|\r\n{2,}", t)  # paragraph blocks
                if idx >= 0:
                    # pick the paragraph that contains the index
                    pos = 0
                    for ch in chunks:
                        end = pos + len(ch)
                        if pos <= idx < end:
                            # if line-broken paragraph, normalize to single space
                            return re.sub(r"[ \t]*\n[ \t]*", " ", ch).strip()
                        pos = end + 2  # account for split gap
                # no index → choose first non-trivial paragraph
                for ch in chunks:
                    chn = re.sub(r"[ \t]*\n[ \t]*", " ", ch).strip()
                    if len(chn) > 0:
                        return chn

            # Sentence heuristic
            # Split on ., !, ? followed by whitespace/newline (keep punctuation)
            sentences = re.split(r"(?<=[\.!\?])\s+", t.strip())
            if idx >= 0:
                # find sentence containing the index
                pos = 0
                for s in sentences:
                    end = pos + len(s)
                    if pos <= idx < end:
                        return s.strip()
                    pos = end + 1
            # Fallback: first decent sentence or trimmed whole text
            for s in sentences:
                if s and len(s.strip()) > 0:
                    return s.strip()
            return t.strip()

        def _highlight_terms(snippet, terms_lc):
            """Optional: very light highlighting; keep it conservative to avoid HTML noise."""
            if not snippet:
                return ""
            out = snippet
            # sort by length to avoid nested replacements; escape terms for regex
            for term in sorted(set(terms_lc), key=len, reverse=True):
                try:
                    pat = re.compile(rf"({re.escape(term)})", flags=re.IGNORECASE)
                    out = pat.sub(r"<mark>\1</mark>", out)
                except Exception:
                    pass
            return out

        # ------ get DF ----------------------------------------------------------
        df = results_so_far.get("dataframe_full")
        if df is None or getattr(df, "empty", False):
            return {"ok": False, "query_terms": [], "html": "", "note": "no dataframe in results_so_far"}

        terms = _clean_terms(query_terms)
        if not terms:
            return {"ok": False, "query_terms": [], "html": "", "note": "no usable query terms"}

        cols_available = set(getattr(df, "columns", []))
        search_cols = [c for c in tuple(fields_text) + tuple(fields_meta) if c in cols_available]
        if not search_cols:
            return {"ok": False, "query_terms": terms, "html": "", "note": "no searchable columns in DF"}

        # ------ scan & build HTML ----------------------------------------------
        html_blocks = []
        seen_para = set()  # dedupe on (item_key, snippet_norm)

        terms_lc = [t.lower() for t in terms]
        primary_pref = sorted(terms_lc, key=lambda x: (-len(x), x))  # prefer longest

        # Build a fast mapping for bib info
        # (avoid accidental positional joins; read directly per row)
        for _, row in df.iterrows():
            item_key = _nz(row.get("key"))
            if not item_key:
                continue

            authors_val = _nz(row.get("authors") or row.get("authors_list"))
            year_val = row.get("year")
            bib = _make_bib(authors_val, year_val)

            for field in search_cols:
                hay = _nz(row.get(field))
                if _is_trivial_text(hay):
                    continue
                hay_l = hay.lower()
                matched = [t for t in terms_lc if t in hay_l]
                if not matched:
                    continue

                # choose primary for boundary finding
                primary = next((p for p in primary_pref if p in hay_l), None)
                snippet = _extract_complete_snippet(hay, primary)
                if _is_trivial_text(snippet):
                    continue

                # Nice-to-have: highlight terms (comment out if you want plain text)
                snippet = _highlight_terms(snippet, terms_lc)

                # Escape (we already inserted <mark>), so escape then unescape mark tags
                esc = html.escape(snippet, quote=False)
                esc = esc.replace("&lt;mark&gt;", "<mark>").replace("&lt;/mark&gt;", "</mark>")

                # Dedupe by normalized tuple
                sig = (item_key, esc.strip())
                if sig in seen_para:
                    continue
                seen_para.add(sig)

                # Compose the line → append a plain anchor showing the bib; href=item_key
                anchor = (
                    f'<a href="{html.escape(item_key)}" '
                    f'data-key="{html.escape(item_key)}" '
                    f'data-bib="{html.escape(bib)}">{html.escape(bib)}</a>'
                )
                html_blocks.append(f"<p>{esc} {anchor}</p>")

        final_html = "\n".join(html_blocks)
        return {"ok": True, "query_terms": terms, "html": final_html, "count": len(html_blocks)}


    # ── STATS helpers (prefer results_so_far; NEVER scan PDFs here) ───────────
    def _pick_year_column(df):
        if df is None:
            return None
        cols = list(getattr(df, "columns", []))
        for c in ["year","year_numeric","Year","YEAR"]:
            if c in cols: return c
        for c in ["date","Date","published","Published"]:
            if c in cols: return c
        return None

    def _to_year_int(v):
        if v is None:
            return None
        try:
            return int(v)
        except Exception:
            s = str(v)
            m = re.match(r"^\D*(\d{4})", s)
            if m:
                try: return int(m.group(1))
                except Exception: return None
        return None

    def _year_counts(df):
        if df is None:
            return {}
        col = _pick_year_column(df)
        if not col:
            return {}
        try:
            ys = df[col].map(_to_year_int)
        except Exception:
            try:
                ys = df[col].apply(_to_year_int)
            except Exception:
                return {}
        counts = {}
        try:
            vc = ys.value_counts(dropna=True).sort_index()
            for y, c in vc.items():
                if y is not None:
                    counts[int(y)] = int(c)
        except Exception:
            for y in ys:
                if y is None: continue
                counts[y] = counts.get(y, 0) + 1
        return counts

    def _dataset_describe(df):
        out = {"ok": False, "shape": None, "columns": [], "describe": {}}
        if df is None:
            out["note"] = "no dataframe available"
            return out
        out["ok"] = True
        out["shape"] = [int(df.shape[0]), int(df.shape[1])]
        out["columns"] = list(map(str, df.columns))
        try:
            desc = df.describe(include="all", datetime_is_numeric=True).fillna("").astype(str)
            out["describe"] = {col: {idx: desc.loc[idx, col] for idx in desc.index} for col in desc.columns}
        except Exception as e:
            out["note"] = f"describe failed: {e!r}"
        return out

    def _get_overall_stats_blob():
        for k in ("Overall Publication Timeline", "AI Analyze Publication Timeline", "Publication Timeline", "stats", "timeline_stats"):
            blob = results_so_far.get(k) if isinstance(results_so_far, dict) else None
            if isinstance(blob, dict) and any(x in blob for x in ("descriptive","trend_periods","overall_paper_stats")):
                return blob
        for _k, v in (results_so_far or {}).items():
            if isinstance(v, dict) and any(x in v for x in ("descriptive","trend_periods","overall_paper_stats")):
                return v
        return {}

    def _overall_paper_stats_from_results():
        blob = _get_overall_stats_blob()
        if isinstance(blob, dict) and isinstance(blob.get("overall_paper_stats"), dict):
            return {"ok": True, "source": "results_so_far", **blob["overall_paper_stats"]}
        df = _get_df_from_results()
        yrs = _year_counts(df)
        total = int(df.shape[0]) if df is not None else 0
        peak_year = max(yrs, key=yrs.get) if yrs else None
        return {"ok": bool(df is not None), "source": "computed_fallback", "total_items": total, "year_counts": yrs, "peak_year": peak_year}

    def _current_section_stats_from_results():
        blob = _get_overall_stats_blob()
        ops = blob.get("overall_paper_stats") if isinstance(blob, dict) else None
        label = (section_title or "").strip().lower()
        if isinstance(ops, dict):
            for field in ("by_section", "sections", "per_section_stats", "section_stats"):
                m = ops.get(field)
                if isinstance(m, dict):
                    for k, v in m.items():
                        if (k or "").strip().lower() == label and isinstance(v, dict):
                            return {"ok": True, "source": f"results_so_far:{field}", **v}
        df = _get_df_from_results()
        if df is None or getattr(df, "empty", False):
            return {"ok": False, "note": "no rows matched section title or no DF"}
        cols = {c.lower(): c for c in df.columns}
        candidates = [c for c in ["section","section_title","chapter","part","heading"] if c in cols]
        if not candidates:
            return {"ok": False, "note": "no section label column in DF"}
        canon = cols[candidates[0]]
        sub = df[df[canon].astype(str).str.lower().str.strip() == label]
        if sub.empty:
            return {"ok": False, "note": f"no rows with section label '{section_title}'"}
        yrs = _year_counts(sub)
        total = int(sub.shape[0])
        peak_year = max(yrs, key=yrs.get) if yrs else None
        return {"ok": True, "source": "computed_fallback", "subset_rows": total, "year_counts": yrs, "peak_year": peak_year}

    def _term_stats_from_results(terms):
        hits = extract_keyword_hits(terms)
        per_term = {t.lower(): 0 for t in (hits.get("query_terms") or terms or [])}
        doc_ids_per_term = {t: set() for t in per_term}
        for h in hits.get("hits", []):
            mset = set([m.lower() for m in h.get("matched_terms", [])])
            for t in mset:
                per_term[t] = per_term.get(t, 0) + 1
                doc_ids_per_term.setdefault(t, set()).add(h.get("item_key"))
        dfreq = {t: len(doc_ids_per_term.get(t, set())) for t in per_term}
        return {
            "ok": True,
            "terms": list(per_term.keys()),
            "total_hits": int(sum(per_term.values())),
            "doc_frequency": dfreq,
            "per_term_hits": per_term,
            "top_hits": hits.get("hits", [])[:20]
        }

    def _canon_stat_kind(v):
        s = _norm_str(v).lower().strip()
        s = s.replace("-", " ").replace("_", " ")
        s = re.sub(r"\s+", " ", s)
        if s in ("dataset describe","describe dataset","dataframe describe","dataset pandas describe"):
            return "dataset_describe"
        if s in ("current section stats","section stats","this section stats"):
            return "current_section_stats"
        if s in ("overall paper stats","paper stats","overall stats","global stats"):
            return "overall_paper_stats"
        if s in ("term stats","term statistics","keyword stats","term frequency"):
            return "term_stats"
        if s in ("year by year","trend periods table","phase contributions","detailed stats"):
            return "overall_paper_stats"
        return "overall_paper_stats" if not s else s

    def _build_stats_payload_from_results(item: dict, rev_obj: dict):
        kind = _canon_stat_kind(item.get("stat_kind"))
        if kind == "dataset_describe":
            return {"type": "stats", "stat_kind": "dataset_describe", **_dataset_describe(_get_df_from_results())}
        if kind == "current_section_stats":
            return {"type": "stats", "stat_kind": "current_section_stats", **_current_section_stats_from_results()}
        if kind == "overall_paper_stats":
            return {"type": "stats", "stat_kind": "overall_paper_stats", **_overall_paper_stats_from_results()}
        if kind == "term_stats":
            terms = item.get("terms")
            if not terms:
                terms = _collect_keywords_for_rev(rev_obj)
            return {"type": "stats", "stat_kind": "term_stats", **_term_stats_from_results(terms)}
        return {"type": "stats", "ok": False, "note": f"unknown stat_kind '{item.get('stat_kind')}'", "stat_kind": item.get("stat_kind")}

    # ── author_key helper (metadata minimal + core sections via process_pdf) ──
    def _author_key_payload_with_core_sections(key: str):
        """
        Build author_key payload from results_so_far['dataframe_full'] and core sections via process_pdf.
        Metadata fields (exact): 'key','title','year','authors','abstract','contribution_type',
        'evidence_source_base','framework_model','method_type','methods','ontology',
        'research_question_purpose'.
        """
        meta = {"type": "author_key", "key": key, "ok": False}
        try:
            df = results_so_far.get("dataframe_full")
            row = None
            if df is not None and hasattr(df, "empty") and not df.empty:
                try:
                    row = df.loc[df["key"] == key].iloc[0]
                except Exception:
                    row = None

            def _nz(v):  # normalize to safe string
                try:
                    s = "" if v is None else str(v)
                    return "" if s.lower() == "nan" else s
                except Exception:
                    return ""

            # Build metadata from DF (preferred)
            md = None
            if row is not None:
                md = {
                    "key": key,
                    "title": _nz(row.get("title")),
                    "year": row.get("year"),
                    "authors": _nz(row.get("authors") or row.get("authors_list")),
                    "abstract": _nz(row.get("abstract")),
                    "contribution_type": _nz(row.get("contribution_type")),
                    "evidence_source_base": _nz(row.get("evidence_source_base")),
                    "framework_model": _nz(row.get("framework_model")),
                    "method_type": _nz(row.get("method_type")),
                    "methods": _nz(row.get("methods")),
                    "ontology": _nz(row.get("ontology")),
                    "research_question_purpose": _nz(row.get("research_question_purpose")),
                }

            # Minimal Zotero fallback if DF row is missing
            if md is None:
                try:
                    it = zot_client.item(key)
                except TypeError:
                    it = zot_client.item(key=key)
                except Exception:
                    it = None

                authors = ""
                if isinstance(it, dict):
                    data = it.get("data") or it
                    # try to assemble authors
                    try:
                        creators = data.get("creators") or []
                        names = []
                        for c in creators:
                            if isinstance(c, dict):
                                if c.get("lastName") and c.get("firstName"):
                                    names.append(f"{c['lastName']}, {c['firstName']}")
                                elif c.get("name"):
                                    names.append(c["name"])
                        authors = "; ".join(names)
                    except Exception:
                        authors = ""

                    md = {
                        "key": key,
                        "title": _nz(data.get("title") or data.get("shortTitle")),
                        "year": _nz(data.get("year") or data.get("date")),
                        "authors": authors,
                        "abstract": "",
                        "contribution_type": "",
                        "evidence_source_base": "",
                        "framework_model": "",
                        "method_type": "",
                        "methods": "",
                        "ontology": "",
                        "research_question_purpose": "",
                    }
                else:
                    md = {
                        "key": key,
                        "title": "",
                        "year": "",
                        "authors": "",
                        "abstract": "",
                        "contribution_type": "",
                        "evidence_source_base": "",
                        "framework_model": "",
                        "method_type": "",
                        "methods": "",
                        "ontology": "",
                        "research_question_purpose": "",
                    }

            try:
                pdf_path = zot_client.get_pdf_path_for_item(key)
                core_sections = process_pdf(pdf_path=pdf_path, core_sections=True)["payload"]
            except Exception as e:
                core_sections = {"error": f"process_pdf failed: {e!r}"}

            meta.update(md)
            meta["core_sections"] = core_sections
            meta["ok"] = True
            return meta

        except Exception as e:
            meta["note"] = f"lookup error: {e!r}"
            return meta

    # ── keyword term collectors per revision (sentinel-proof) ──────────────────
    def _collect_keywords_for_rev(rev_obj):
        """
        Collect 1–3 word terms from:
          • rev_obj['keywords'] (verbatim)
          • each inputs_needed item’s 'verbatim' for types: keywords/locator/quote_page/source_type
          • rev_obj['verbatim'] (fallback)
        Dedupe, preserve order; drop sentinel junk like "none"/"n/a"/"null".
        """
        _SENTINELS = {"none", "n/a", "na", "null", "nil", "-", "—", ""}

        def _norm(v):
            try:
                s = "" if v is None else str(v)
                s = s.replace("\u00A0", " ")
                return s.strip()
            except Exception:
                return ""

        raw = []
        if isinstance(rev_obj, dict):
            arr = rev_obj.get("keywords")
            if isinstance(arr, list):
                raw.extend([_norm(k) for k in arr if _norm(k)])

            for it in (rev_obj.get("inputs_needed") or []):
                if not isinstance(it, dict):
                    continue
                t = _norm(it.get("type")).lower()
                if t in {"keywords", "locator", "quote_page", "source_type"}:
                    raw.extend(_make_terms_from_verbatim(it.get("verbatim")))

            v = rev_obj.get("verbatim")
            if v:
                raw.extend(_make_terms_from_verbatim(v))

        seen, out = set(), []
        for k in raw:
            kk = _norm(k)
            ll = kk.lower()
            if not kk or ll in _SENTINELS:
                continue
            if ll not in seen:
                seen.add(ll)
                out.append(kk)
        return out

    # ── allowed types ─────────────────────────────────────────────────────────
    ALLOWED_TYPES = {"none", "keywords", "locator", "quote_page", "source_type", "author_key", "stats"}

    # Resolve catalog DF SAFELY (no boolean evaluation of DataFrame)
    _df_catalog = results_so_far.get("dataframe_full", None)
    if _df_catalog is None or getattr(_df_catalog, "empty", True):
        _df_catalog = _get_df_from_results()

    # Pre-index rows by key for fast metadata lookups
    _df_by_key = {}
    if _df_catalog is not None and not getattr(_df_catalog, "empty", False):
        try:
            _df_by_key = {str(r.get("key")): r for _, r in _df_catalog.iterrows()}
        except Exception:
            _df_by_key = {}

    def _meta_from_df_row(row):
        """Return only requested metadata fields from dataframe_full."""

        def _nz(v):
            try:
                s = "" if v is None else str(v)
                return "" if s.lower() == "nan" else s
            except Exception:
                return ""

        if row is None:
            return {
                "key": "", "title": "", "year": "", "authors": "", "abstract": "",
                "contribution_type": "", "evidence_source_base": "", "framework_model": "",
                "method_type": "", "methods": "", "ontology": "", "research_question_purpose": ""
            }
        return {
            "key": _nz(row.get("key")),
            "title": _nz(row.get("title")),
            "year": row.get("year"),
            "authors": _nz(row.get("authors") or row.get("authors_list")),
            "abstract": _nz(row.get("abstract")),
            "contribution_type": _nz(row.get("contribution_type")),
            "evidence_source_base": _nz(row.get("evidence_source_base")),
            "framework_model": _nz(row.get("framework_model")),
            "method_type": _nz(row.get("method_type")),
            "methods": _nz(row.get("methods")),
            "ontology": _nz(row.get("ontology")),
            "research_question_purpose": _nz(row.get("research_question_purpose")),
        }

    # ── main: build flat [{revision: payload}] -------------------------------
    out_flat = []
    total = 0

    for phase_label, rev in _iter_all_revs():
        rev_text = rev["revision"].strip()
        inputs = rev.get("inputs_needed") or [{"type": "none"}]
        payload: dict = {}
        used_extract = False
        extracted_hits_total = 0
        all_q_terms_for_rev = []

        _cb(f"[{phase_label}] Building payload for revision: {rev_text[:80]}")

        for it in inputs:
            if not isinstance(it, dict):
                continue
            t_raw = it.get("type") or ""
            t = t_raw.strip().lower()
            if t not in ALLOWED_TYPES:
                continue

            # (1) NONE
            if t == "none":
                payload.setdefault("none", {"type": "none"})
                continue

            # (2) AUTHOR KEY  → process_pdf(core_sections=True) + df metadata
            if t == "author_key":
                payload.setdefault("author_key", [])
                key = _norm_str(it.get("verbatim") or it.get("key"))
                if key:
                    payload["author_key"].append(_author_key_payload_with_core_sections(key))
                else:
                    payload["author_key"].append({"type": "author_key", "ok": False, "note": "missing key"})
                continue

            # (3) STATS (skip PDF extractor entirely)
            if t == "stats":
                payload.setdefault("stats", [])
                payload["stats"].append(_build_stats_payload_from_results(it, rev))
                continue

            # (4) KEYWORD-style
            if t == "keywords":
                q_terms = _collect_keywords_for_rev(rev) or _make_terms_from_verbatim(it.get("verbatim"))
            else:
                q_terms = _make_terms_from_verbatim(it.get("verbatim"))
            all_q_terms_for_rev.extend(q_terms or [])

            # 4a) catalog search — NO per-item limit; clean catalog_hits
            if t == "source_type":
                hits_pkg = extract_keyword_hits(
                    q_terms,
                    fields_text=('title', 'argumentation_logic',
                                 'controlled_vocabulary_terms', 'full_text'),
                    # exclude journal/publicationTitle/item_type for source_type
                    fields_meta=('contribution_type', 'evidence_source_base'),
                )
            else:
                hits_pkg = extract_keyword_hits(
                    q_terms,
                    fields_text=('title',  'argumentation_logic',
                                 'controlled_vocabulary_terms',  'full_text'),
                    fields_meta=('contribution_type', 'evidence_source_base'),
                )

            if hits_pkg.get("ok"):
                payload.setdefault("catalog_hits", [])
                for h in hits_pkg.get("hits", []):
                    ikey = _norm_str(h.get("item_key"))
                    row = _df_by_key.get(ikey)
                    meta_clean = _meta_from_df_row(row)
                    payload["catalog_hits"].append({
                        "item_key": ikey,
                        "snippet": _norm_str(h.get("snippet")),
                        "matched_terms": h.get("matched_terms", []),
                        "meta": meta_clean,
                    })

            # 4b) PDF extractor → per-keyword HTML batches (<=10 per batch) and print them
            import html as _html

            # ---- global superscript index (module-global) ----------------------
            global KW_SUP_INDEX
            if "KW_SUP_INDEX" not in globals():
                KW_SUP_INDEX = 1

            # ---- resolver for extractor ---------------------------------------
            def _resolve_extract_fn():
                cand = []
                # results_so_far may carry a reference
                try:
                    cand.append((results_so_far or {}).get("extract_content_for_keywords"))
                except Exception:
                    pass
                # __main__
                try:
                    import __main__ as _M
                    cand.append(getattr(_M, "extract_content_for_keywords", None))
                except Exception:
                    pass
                # globals()
                try:
                    cand.append(globals().get("extract_content_for_keywords"))
                except Exception:
                    pass
                # utils
                try:
                    cand.append(extract_content_for_keywords)
                except Exception:
                    pass
                for fn in cand:
                    if callable(fn):
                        return fn
                return None

            _extract_fn = _resolve_extract_fn()

            # ---- SAFE DF SELECTOR (avoid truthiness on DataFrame) -------------
            def _select_df():
                if _df_catalog is not None and not getattr(_df_catalog, "empty", False):
                    return _df_catalog
                return _get_df_from_results()

            # ---- batching helper ----------------------------------------------
            def _batch(seq, size=10):
                return [seq[i:i + size] for i in range(0, len(seq), size)]

            # ---- notes → HTML lines -------------------------------------------
            def _notes_to_lines(notes: list[dict], *, use_paragraph: bool) -> list[str]:
                """Turn extractor 'notes' into list of <p>…</p><sup><a bib=.. key=..>N</a></sup> lines."""
                global KW_SUP_INDEX
                lines: list[str] = []
                for n in notes or []:
                    text_html = (
                        (n.get("paragraph_context") or "")
                        if use_paragraph
                        else (n.get("section_html") or n.get("original_paragraph") or "")
                    )
                    text_html = str(text_html or "").strip()
                    if not text_html:
                        continue
                    bib = str(n.get("source_bib_header") or "").strip()
                    ikey = str(n.get("source_item_key") or "").strip()
                    anchor = (
                        f'<a href="{_html.escape(ikey)}" '
                        f'data-key="{_html.escape(ikey)}" '
                        f'data-bib="{_html.escape(bib)}">{_html.escape(bib)}</a>'
                    )
                    lines.append(f"<p>{text_html} {anchor}</p>")

                return lines

            # ---- sanitize keywords (skip sentinels like ['none']) --------------
            _SENTINELS = {"none", "n/a", "na", "null", "nil", "-", "—", ""}

            def _sanitize_terms(terms):
                out, seen = [], set()
                for t in (terms or []):
                    s = "" if t is None else str(t).strip()
                    if not s or s.lower() in _SENTINELS:
                        continue
                    if s not in seen:
                        seen.add(s)
                        out.append(s)
                return out

            q_terms_clean = _sanitize_terms(q_terms)
            payload.setdefault("keyword_batches", [])

            if q_terms_clean and _extract_fn is not None:

                locator_kind = str(it.get("locator_kind") or "").strip().lower()
                section_required = bool(it.get("section_required", False))
                use_paragraph = (locator_kind == "paragraph") and (not section_required)

                payload.setdefault("keyword_batches", [])  # [{keyword, batches:[html,...]}]

                for _term in list(dict.fromkeys(q_terms_clean))[0:1]:  # per-keyword; preserve order
                    try:
                        res = _extract_fn(
                            full_df=_select_df(),  # SAFE: no DF truthiness
                            items_to_code_with_keywords_map={},  # scan all
                            zotero_client_instance=zot_client,
                            globally_suggested_keywords=[_term],
                            progress_callback=progress_callback
                        )
                        notes = res.get("data", []) if isinstance(res, dict) else []
                    except Exception as e:
                        _cb(f"extract_content_for_keywords failed for '{_term}': {e!r}")
                        notes = []

                    lines = _notes_to_lines(notes, use_paragraph=use_paragraph)
                    if lines:
                        used_extract = True
                    extracted_hits_total += len(lines)

                    # batching by 10
                    raw_batches = ["\n".join(chunk) for chunk in _batch(lines, size=10)]

                    # Resolve optional section context text (if any)
                    section_text_ctx = _norm_str(
                        (results_so_far or {}).get("current_section_text")
                        or (results_so_far or {}).get("section_text")
                        or ""
                    )

                    # Resolve provider/model (rsf/globals → defaults)
                    apk = (
                            (results_so_far or {}).get("ai_provider_key")
                            or (results_so_far or {}).get("apk")
                            or globals().get("AI_PROVIDER_KEY")
                            or "openai"
                    )
                    mdl = model_name
                    term_tag = re.sub(r'[^A-Za-z0-9_.-]+', '_', str(_term)).strip('_') or "kw"

                    # Consolidate these batches immediately
                    cons_html= consolidate_revision_payload_batches(
                        section_text=section_text_ctx,
                        revision=rev_text,
                        batches=raw_batches,
                        ai_provider_key=apk,
                        model_api_name=mdl,
                        results_so_far=results_so_far,
                        progress_callback=progress_callback,
                        use_cache=True,
                        section_step_key=f"{section_step_key}_{term_tag}",
                    )
                    # print("keyword_batches example of element =",{
                    #         "keyword": _term,
                    #         "consolidated_html": cons_html,
                    #         # keep a single-element 'batches' for back-compat with any downstream reader
                    #         "batches": raw_batches ,
                    #         "revision":rev_text,
                    #         "raw_count": len(lines)
                    #     }
                    #       )
                    if cons_html:
                        payload["keyword_batches"].append({
                            "keyword": _term,
                            "consolidated_html": cons_html,
                            # keep a single-element 'batches' for back-compat with any downstream reader
                            "batches": raw_batches ,
                            "revision":rev_text,
                            "raw_count": len(lines)
                        })

                # print("payload[keyword_batches]",payload["keyword_batches"])
                emit_revisions_batches(
                    results_so_far=results_so_far,
                    revisions_map=payload["keyword_batches"],

                    section_title=section_step_key,
                )




            elif not q_terms_clean:
                _cb("Skipping PDF keyword extraction: no usable keywords (only sentinels like 'none').")
            elif _extract_fn is None:
                _cb("extract_content_for_keywords not found or not callable; skipping PDF extraction.")

        # ---- Consolidate if extractor used & threshold exceeded ----
        # ---- Aggregate already consolidated per-keyword narratives (no second model call) ----
        if extracted_hits_total > 0 and payload.get("keyword_batches"):
            try:
                cons_pieces = []
                for kb in payload.get("keyword_batches", []):
                    # Prefer explicit consolidated_html; otherwise accept the single stored batch
                    piece = _norm_str(kb.get("consolidated_html", "")) or _norm_str(
                        "\n".join(kb.get("batches", []) or [])
                    )
                    if piece:
                        cons_pieces.append(piece.strip())

                if cons_pieces:
                    final_html = "\n\n".join(cons_pieces)
                    payload["consolidated"] = {
                        "html": final_html,
                        "extracted_hits_total": int(extracted_hits_total),
                        "query_terms_aggregate": list(dict.fromkeys(all_q_terms_for_rev)),
                        # sources intentionally omitted per current consolidate_revision_payload_batches contract
                    }
                    _cb(f"[{phase_label}] Aggregated {extracted_hits_total} extracted hits from per-keyword consolidations.")
            except Exception as e:
                _cb(f"[{phase_label}] WARNING: aggregation failed, keeping per-keyword payloads. Error: {e!r}")


            except Exception as e:
                _cb(f"[{phase_label}] WARNING: consolidation failed, keeping raw payload. Error: {e!r}")

        if not payload:
            payload["none"] = {"type": "none"}

        out_flat.append({rev_text: payload})
        total += 1

        # (Optional) simple debug write — keep or remove as you prefer.
        try:
            with open("prepare_output.txt", "w", encoding="utf-8") as t:
                for n, i in enumerate(out_flat):
                    txt = f"\n\n Payload {n}\n{i}\n\n"
                    t.write(txt)
        except Exception:
            pass

    _cb(f"Built {total} revision payload(s) for '{section_title}'.")
    return {"revisons": out_flat}

# --- Orchestrator for Review Workflow ---
def generate_final_draft(
        initial_draft_func,  # Function that returns initial draft package
        section_step_key: str,
        df_full: pd.DataFrame,
        results_so_far: dict,
        ai_provider_key: str,
        model_api_name: str,
        progress_callback,
        store_only, read, use_cache,
        descriptive_data_for_section: str = "No specific descriptive data provided for this section.",
        items_to_code_map_override: dict = None,  # Specific map of item_key -> [keywords]
        note_extraction_item_filter_func=None,
        enable_review_round1: bool = True,
        enable_note_extraction: bool = False,
        enable_review_round2: bool = True,
        q_terms=None,
        create_zotero_collections=False,

        note_extraction_sample_size: int = 15,
):
    """
    Orchestrates a 2-round AI review with optional notes extraction
    and renders monitor-friendly HTML blocks that *always* include:
      - Origin function
      - Output
      - Inputs (parameters + derived context)
    plus a route/tree summary for the section.
    """

    # ───────────────────── helpers ─────────────────────
    def _callback(msg):
        # Always emit a string to the Qt signal
        if isinstance(msg, str):
            text = msg
        elif isinstance(msg, (dict, list)):
            import json as _json
            text = _json.dumps(msg, ensure_ascii=False)
        else:
            text = str(msg)
        if progress_callback:
            progress_callback(text)
        logging.info(msg)

    def _escape(s):
        try:
            return html.escape(str(s))
        except Exception:
            return str(s)

    def _kv_table(d: dict) -> str:
        if not isinstance(d, dict) or not d:
            return ""
        rows = []
        for k, v in d.items():
            vs = json.dumps(v, ensure_ascii=False, indent=2) if isinstance(v, (dict, list)) else str(v)
            rows.append(f"<tr><th>{_escape(k)}</th><td><pre>{_escape(vs)}</pre></td></tr>")
        return "<table class='dataframe'><thead><tr><th>Key</th><th>Value</th></tr></thead><tbody>" + "".join(rows) + "</tbody></table>"

    def _monitor_block(origin_func: str, title_suffix: str, output_html: str, input_dict: dict) -> str:
        """
        Render:   # <OriginFunc>: Output   ...output...
                  # Input                 ...inputs...
        """
        safe_origin = _escape(origin_func or "UnknownFunction")
        out = []
        out.append(f"<h1>{safe_origin}: Output{(' — ' + _escape(title_suffix)) if title_suffix else ''}</h1>")
        out.append(output_html if output_html else "<div class='placeholder-text'>No output.</div>")
        out.append("<h1>Input</h1>")
        out.append(_kv_table(input_dict))
        return "\n".join(out)

    def _pipeline_summary_html(section_title, steps):
        """
        steps = list of dicts:
          { 'step': 'R0 Initial Draft', 'origin': 'func', 'llm': {'provider':..,'model':..}, 'batch': {'store_only':..,'read':..} }
        """
        lis = []
        for i, s in enumerate(steps, 1):
            line = f"<b>{i}.</b> {_escape(s.get('step','Step'))} &nbsp;•&nbsp; <code>{_escape(s.get('origin',''))}</code>"
            llm = s.get("llm") or {}
            batch = s.get("batch") or {}
            hints = []
            if llm:
                hints.append(f"LLM: { _escape(llm.get('provider','?')) } / { _escape(llm.get('model','?')) }")
            if batch:
                hints.append("Batch: " + ", ".join(f"{k}={v}" for k, v in batch.items()))
            extra = (" &nbsp;—&nbsp; <span class='log-info'>" + " | ".join(hints) + "</span>") if hints else ""
            lis.append(f"<li>{line}{extra}</li>")
        return "<h2>Route & Tree (Section Plan)</h2><ol>" + "".join(lis) + "</ol>"

    # ───────────────────── basic context ─────────────────────
    section_title = section_step_key.replace("STEP_AI_", "").replace("_", " ").title().replace("Review", "").replace("Insights", "").strip()
    if not section_title:
        section_title = section_step_key
    overall_topic = (results_so_far.get(STEP_LOAD_DATA, {}) or {}).get("collection_name_for_title", "the research topic")

    _callback(f"--- Orchestrating 2-Round AI Review for: {section_title} ---")

    # Reflect the flags into a shared dict (handy for monitor + caching hints)
    runtime_flags = {"store_only": bool(store_only), "read": bool(read), "use_cache": bool(use_cache)}
    (results_so_far.setdefault("runtime_ai_flags", {})).update(runtime_flags)

    # ───────────────────── 1) initial draft (R0) ─────────────────────
    _callback(f"Orchestrator - R0: Initial draft for {section_title}...")

    # Build kwargs for initial_draft_func by alias
    sig = inspect.signature(initial_draft_func)
    param_names = set(sig.parameters.keys())
    _aliases = {
        "df_full": ["df_full", "df", "df_i", "df_arg", "df_f", "df_for_periods_arg"],
        "results_so_far": ["results_so_far", "rsf", "rsf_i", "results", "res_sf_arg", "rsf_for_periods_arg"],
        "progress_callback": ["progress_callback", "cb", "cb_i", "cb_arg", "callback", "cb_for_periods"],
        "ai_provider_key": ["ai_provider_key", "apk", "apk_i", "provider", "apk_arg", "apk_for_periods"],
        "model_api_name": ["model_api_name", "man", "man_i", "model", "model_api", "model_for_drafting_arg"],
        "store_only": ["store_only", "store", "batch_store", "batch_store_only"],
        "read": ["read", "batch_read"],
        "use_cache": ["use_cache", "cache", "cache_on", "usecache"],
        "q_terms":["q_terms", "keywords", "terms", "keywords_arg", "terms_arg"],
        "section_step_key": ["section_step_key", "section_key", "step_key", "section_step", "section_for_drafting_arg"],
        "zotero_client_instance": ["zotero_client_instance", "zotero_client", "zot_client", "zot", "zotero", "zotero_arg"],
        "create_zotero_collections": ["create_zotero_collections", "create_collections", "make_collections", "ensure_collections"],

    }
    _values = {
        "df_full": df_full,
        "results_so_far": results_so_far,
        "progress_callback": _callback,
        "ai_provider_key": ai_provider_key,
        "model_api_name": model_api_name,
        "store_only": store_only,
        "read": read,
        "use_cache": use_cache,
        "q_terms":q_terms,
        "section_step_key": section_step_key,
        "zotero_client_instance":zotero_client,
        "create_zotero_collections": create_zotero_collections,
    }
    accepted_kwargs = {}
    for canonical, names in _aliases.items():
        for name in names:
            if name in param_names:
                accepted_kwargs[name] = _values[canonical]
                break

    initial_draft_pkg = initial_draft_func(**accepted_kwargs)

    # Init “derived” vars
    initial_draft_html = "<p>[Initial draft content generation failed or package was malformed]</p>"
    initial_draft_prompt_sent = "Initial draft prompt not available due to generation failure."
    plain_text_draft = "Initial draft was not successfully generated for review."
    initial_draft_succeeded = False

    if initial_draft_pkg and initial_draft_pkg.get("type") != "error":
        initial_draft_data_dict = initial_draft_pkg.get("data", {}) or {}
        initial_draft_html = initial_draft_data_dict.get("response_html", initial_draft_html)
        initial_draft_prompt_sent = initial_draft_data_dict.get("prompt_sent", initial_draft_prompt_sent)
        initial_draft_succeeded = True

        # Best-effort plain text for R1
        try:
            if initial_draft_html and initial_draft_html.strip() and not initial_draft_html.lower().startswith("<p>[initial draft"):
                soup = BeautifulSoup(initial_draft_html, "html.parser")
                text_elements = [p.get_text(" ", strip=True) for p in soup.find_all(['p', 'h3', 'h4', 'li', 'div']) if p.get_text(" ", strip=True)]
                if not text_elements and soup.body:
                    text_elements = [soup.body.get_text("\n", strip=True)]
                elif not text_elements:
                    text_elements = [soup.get_text("\n", strip=True)]
                plain_text_draft = "\n".join(filter(None, text_elements)).strip() or "Could not extract meaningful plain text from HTML draft."
        except Exception as e_bs4:
            _callback(f"BeautifulSoup parsing error for R1 input of '{section_title}': {e_bs4}. Using raw HTML as plain_text_draft (suboptimal).")
            plain_text_draft = initial_draft_html
    else:
        # Ensure consistent error-shaped package
        _callback(f"Initial draft for {section_title} failed or returned error. Error details: {(initial_draft_pkg or {}).get('data') if initial_draft_pkg else 'No package returned'}")
        if not initial_draft_pkg: initial_draft_pkg = {"type": "error", "data": {}}
        if not isinstance(initial_draft_pkg.get("data"), dict): initial_draft_pkg["data"] = {}
        # Guard against earlier NameError
        _id_safe = (initial_draft_pkg.get("data") or {})
        _id_safe.setdefault("prompt_sent", initial_draft_prompt_sent)
        _id_safe.setdefault("response_html", initial_draft_html)
        initial_draft_pkg["data"] = _id_safe

    results_so_far[f"{section_step_key}_InitialDraftFullPkg"] = initial_draft_pkg

    if not enable_review_round1:

        # Phase the draft straight to the monitor with a formatted block
        id_data = initial_draft_pkg.get("data", {}) or {}
        id_data.setdefault("initial_draft_prompt_sent", id_data.get("prompt_sent", ""))
        id_data.setdefault("initial_draft_html_response", id_data.get("response_html", ""))

        # Construct monitor HTML for R0 only
        r0_html = _monitor_block(
            origin_func=getattr(initial_draft_func, "__name__", "initial_draft_func"),
            title_suffix="R0 • Initial Draft",
            output_html=id_data.get("response_html", ""),
            input_dict={
                "section_step_key": section_step_key,
                "overall_topic": overall_topic,
                "ai_provider_key": ai_provider_key,
                "model_api_name": model_api_name,
                "runtime_flags": runtime_flags,
                "prompt_sent": id_data.get("prompt_sent", ""),
            },
        )
        initial_draft_pkg.update(id_data)
        # Guarantee field the monitor reads
        initial_draft_pkg["data"]["response_html"] = r0_html
        initial_draft_pkg["response_html"] = r0_html
        return initial_draft_pkg

    # ───────────────────── 2) review round 1 (R1) ─────────────────────
    r1_data_content = {}
    search_kws = []

    if enable_review_round1 and initial_draft_succeeded:
        _callback(f"Orchestrator - R1: AI Review for {section_title} (split by headings)...")

        def _cheap_claim_span(text: str) -> str:
            import re
            s = (text or "").strip()
            if not s:
                return ""
            m = re.search(r"(.+?[.!?])(\s|$)", s, flags=re.S)
            return (m.group(1) if m else s[:240]).strip()

        def _split_into_sections(html_str: str, plain_str: str):
            sections = []
            used_html = False
            try:
                from bs4 import BeautifulSoup
                if html_str and "<" in html_str:
                    soup = BeautifulSoup(html_str, "html.parser")
                    heads = soup.find_all(["h2", "h3", "h4"]) or soup.find_all(["h1"])
                    for h in heads:
                        title = (h.get_text(" ", strip=True) or "Untitled section").strip()
                        buf = []
                        for sib in h.next_siblings:
                            if getattr(sib, "name", None) in ("h1", "h2", "h3", "h4"):
                                break
                            if getattr(sib, "name", None) in ("p", "div", "ul", "ol", "blockquote", "section",
                                                              "article", "pre", "table"):
                                txt = sib.get_text("\n", strip=True)
                                if txt:
                                    buf.append(txt)
                            elif isinstance(sib, str):
                                st = str(sib).strip()
                                if st:
                                    buf.append(st)
                        text = "\n".join(buf).strip()
                        if text:
                            sections.append((title, text))
                    if sections:
                        used_html = True
            except Exception as e_split_html:
                _callback(f"R1 splitter: HTML parse fallback due to error: {e_split_html}")

            if not sections:
                import re
                s = (plain_str or "").splitlines()
                current_title = None
                current_buf = []

                def flush():
                    if current_title and current_buf:
                        txt = "\n".join(current_buf).strip()
                        if txt:
                            sections.append((current_title, txt))

                for line in s:
                    ln = line.rstrip()
                    md = re.match(r"^\s{0,3}#{1,6}\s+(.*)$", ln)
                    allcaps = re.match(r"^[A-Z][A-Z0-9\s\-/]{3,}$", ln) and len(ln.split()) <= 12
                    colon = re.match(r"^[^\S\r\n]*([A-Z][\w\-\s]{2,}):\s*$", ln)
                    if md or allcaps or colon:
                        flush()
                        current_title = (md.group(1) if md else (colon.group(1) if colon else ln)).strip()
                        current_buf = []
                    else:
                        current_buf.append(ln)
                flush()

            if not sections:
                sections = [(section_title, plain_text_draft or "")]
            return sections, used_html

        def _dedupe(seq, key=None):
            """
            Stable de-duplication that supports unhashable items (dicts, lists, sets).
            - Preserves first occurrence order.
            - If `key` is provided, it is used to compute the signature for each item.
            - Otherwise, we try hash(x); if that fails, we fall back to a canonical JSON signature.
            """
            import json

            def _json_default(o):
                # Make common unhashables serializable
                if isinstance(o, set):
                    return sorted(list(o))
                if isinstance(o, bytes):
                    return o.decode("utf-8", "replace")
                try:
                    return o.__dict__
                except Exception:
                    return str(o)

            def _signature(x):
                # Caller-supplied key gets priority
                if key is not None:
                    try:
                        return ("__key__", key(x))
                    except Exception:
                        # fall back to generic signature
                        pass
                # Fast path for hashables
                try:
                    hash(x)
                    return ("__hashable__", x)
                except Exception:
                    pass
                # Canonical JSON for unhashables (dicts/lists/etc.)
                try:
                    return ("__json__", json.dumps(x, ensure_ascii=False, sort_keys=True, default=_json_default))
                except Exception:
                    # Absolute fallback
                    return ("__repr__", repr(x))

            seen = set()
            out = []
            for x in (seq or []):
                sig = _signature(x)
                if sig not in seen:
                    seen.add(sig)
                    out.append(x)
            return out

        def _norm_kw(s):
            return (s or "").strip().strip('"').strip("'")

        from collections import Counter

        sections, used_html = _split_into_sections(initial_draft_html, plain_text_draft)
        _callback(f"R1 splitter: identified {len(sections)} section(s) (source={'HTML' if used_html else 'plain'}).")

        merged_revs, merged_qs, merged_kws = [], [], []
        merged_intext_feedback, merged_citation_feedback = [], []
        r1_section_pkgs = []
        per_section_payloads = []

        for idx, (sub_title, sub_text) in enumerate(sections, 1):
            sec_label = f"{section_title} — {sub_title}"
            claim_span = _cheap_claim_span(sub_text)
            _callback(f"R1 reviewing subsection {idx}/{len(sections)}: {sec_label[:80]}")



            try:
                r1_pkg = run_ai_review_round1(
                    overall_topic=overall_topic,
                    section_title=section_step_key,
                    draft_content_plain_text=sub_text,
                    descriptive_data=descriptive_data_for_section,
                    ai_provider_key=ai_provider_key,
                    model_api_name=model_api_name,
                    progress_callback=_callback,
                    results_so_far=results_so_far,
                    read=read,
                    store_only=store_only,
                    use_cache=use_cache
                )
            except TypeError:
                r1_pkg = run_ai_review_round1(
                    overall_topic=overall_topic,
                    section_title=section_step_key,
                    draft_content_plain_text=sub_text,
                    descriptive_data=descriptive_data_for_section,
                    ai_provider_key=ai_provider_key,
                    model_api_name=model_api_name,
                    progress_callback=_callback,
                    results_so_far=results_so_far,
                    read=read,
                    store_only=store_only,
                    use_cache=use_cache
                )
            # with open("results_so_far.txt", "w", encoding="utf-8") as f:
            #     for k, v in results_so_far.items():
            #         f.write(f"{k}\n\n{v}\n\n\n\n")
            # results_so_far[f"{section_step_key}_ReviewR1OutputFullPkg__{idx:02d}"] = r1_pkg
            r1_section_pkgs.append(r1_pkg)

            d = (r1_pkg or {}).get("data") or {}
            merged_revs.extend(list(d.get("suggested_revisions") or []))
            merged_qs.extend(list(d.get("clarifying_questions") or []))
            merged_kws.extend([_norm_kw(x) for x in (d.get("search_keywords_phrases") or []) if _norm_kw(x)])

            if isinstance(d.get("intext_citation_feedback"), list):
                merged_intext_feedback.extend(d.get("intext_citation_feedback"))
            if isinstance(d.get("citation_feedback"), list):
                merged_citation_feedback.extend(d.get("citation_feedback"))
            current_payload ={
                "title": sub_title,
                "claim_span": claim_span,
                "keywords": list(d.get("search_keywords_phrases") or []),
                "suggested_revisions_count": len(d.get("suggested_revisions") or []),
                "clarifying_questions_count": len(d.get("clarifying_questions") or []),
            }
            per_section_payloads.append(current_payload)
            prep = prepare_r2_inputs_from_r1(
                r1_pkg,
                section_title=section_step_key,
                overall_topic=overall_topic,
                df_full=df_full,
                results_so_far=results_so_far,
                zot_client=zotero_client ,
                progress_callback=_callback,
                model_name=model_api_name,

                section_step_key=section_step_key,
            )



        merged_revs = _dedupe(merged_revs)
        merged_qs = _dedupe(merged_qs)
        merged_kws = [k for k in _dedupe(merged_kws) if k]
        kw_counts = Counter([k.lower() for k in merged_kws if k])
        ranked_kws = [k for k, _n in kw_counts.most_common()]

        r1_pkg_merged = {
            "type": "ai_review_round1_output",
            "data": {
                "suggested_revisions": merged_revs,
                "clarifying_questions": merged_qs,
                "search_keywords_phrases": ranked_kws,
                "intext_citation_feedback": merged_intext_feedback,
                "citation_feedback": merged_citation_feedback,
                "by_section": [
                    {"title": sections[i][0], "pkg": r1_section_pkgs[i]}
                    for i in range(len(sections))
                ],
                "keyword_payloads": {
                    "per_section": per_section_payloads,
                    "aggregate_counts": dict(kw_counts),
                },
            },
        }
        results_so_far[f"{section_step_key}_ReviewR1OutputFullPkg"] = r1_pkg_merged
        results_so_far[f"{section_step_key}_R1_Sections"] = [t for t, _ in sections]
        results_so_far[f"{section_step_key}_R1_MergedKeywords"] = {
            "ranked": ranked_kws,
            "counts": dict(kw_counts),
        }

        if ranked_kws:
            r1_data_content = r1_pkg_merged["data"]
            search_kws = list(ranked_kws)
            _callback(f"R1 merged for '{section_title}'. Suggested Search KWs: {search_kws[:12]}")
        else:
            _callback(f"R1 merged for '{section_title}' yielded no keywords.")

    elif enable_review_round1 and not initial_draft_succeeded:
        _callback(f"Skipping Review Round 1 for {section_title} due to initial draft failure.")
    else:
        _callback(f"R1 skipped by configuration for {section_title}.")

    if not isinstance(r1_data_content, dict) or not r1_data_content.get("suggested_revisions"):
        r1_data_content = {
            "suggested_revisions": ["Review Round 1 was skipped or failed; focus on general improvements and clarity."],
            "clarifying_questions": [f"Ensure the section on '{section_title}' is comprehensive."],
            "search_keywords_phrases": search_kws or [],
        }

    extracted_notes = []
    skip_notes_for_r2_prompt = not (enable_note_extraction and search_kws)


    # ───────────────────── 4) final revision (R2) ─────────────────────
    final_result_package = initial_draft_pkg  # default fallback
    if enable_review_round2:
        if (initial_draft_pkg or {}).get("type") == "error":
            _callback(f"Skipping Review Round 2 for {section_title} due to initial draft failure. Returning initial draft error package.")
        else:
            _callback(f"Orchestrator - R2: AI Revision for {section_title}...")
            r2_pkg = run_ai_revise_draft_round2(
                overall_topic=overall_topic,
                section_title=section_step_key,
                original_draft_plain_text=plain_text_draft,
                review_round1_data_content=r1_data_content,
                extracted_notes=extracted_notes,
                ai_provider_key=ai_provider_key,
                model_api_name=model_api_name,
                progress_callback=_callback,
                results_so_far=results_so_far,
                skip_notes_in_prompt=skip_notes_for_r2_prompt,
                store_only=store_only,
                read=read,
                use_cache=use_cache,
            )

            if r2_pkg and r2_pkg.get("type") == "html_section":
                r2_data_dict = (r2_pkg.get("data") or {})
                r0_origin = getattr(initial_draft_func, "__name__", "initial_draft_func")
                r1_origin = "run_ai_review_round1"
                r2_origin = "run_ai_revise_draft_round2"

                # Build per-phase HTML blocks (with headings)
                r0_block = _monitor_block(
                    origin_func=r0_origin,
                    title_suffix="R0 • Initial Draft",
                    output_html=initial_draft_html or "",
                    input_dict={
                        "section_title": section_title,
                        "overall_topic": overall_topic,
                        "ai_provider_key": ai_provider_key,
                        "model_api_name": model_api_name,
                        "runtime_flags": runtime_flags,
                        "prompt_sent": initial_draft_prompt_sent,
                    },
                )

                r1_out_html = ""
                if isinstance(r1_data_content, dict):
                    _revs = r1_data_content.get("suggested_revisions") or []
                    _qs   = r1_data_content.get("clarifying_questions") or []
                    _kws  = r1_data_content.get("search_keywords_phrases") or []
                    chunks = []
                    if _revs:
                        chunks.append("<h3>Suggested Revisions</h3><ul>" + "".join(f"<li>{_escape(x)}</li>" for x in _revs[:20]) + "</ul>")
                    if _qs:
                        chunks.append("<h3>Clarifying Questions</h3><ol>" + "".join(f"<li>{_escape(x)}</li>" for x in _qs[:10]) + "</ol>")
                    if _kws:
                        chunks.append("<h3>Suggested Search Keywords</h3><p>" + ", ".join(_escape(x) for x in _kws[:30]) + "</p>")
                    r1_out_html = "\n".join(chunks) or "<div class='placeholder-text'>No R1 details.</div>"

                r1_block = _monitor_block(
                    origin_func=r1_origin,
                    title_suffix="R1 • Review",
                    output_html=r1_out_html,
                    input_dict={
                        "section_title": section_title,
                        "overall_topic": overall_topic,
                        "draft_content_plain_text": plain_text_draft[:1500] + (" …" if len(plain_text_draft) > 1500 else ""),
                        "descriptive_data": descriptive_data_for_section,
                        "runtime_flags": runtime_flags,
                    },
                )

                r2_final_html = (r2_data_dict.get("response_html") or "")
                r2_block = _monitor_block(
                    origin_func=r2_origin,
                    title_suffix="R2 • Final Revision",
                    output_html=r2_final_html,
                    input_dict={
                        "section_title": section_title,
                        "overall_topic": overall_topic,
                        "skip_notes_in_prompt": skip_notes_for_r2_prompt,
                        "r1_summary_keys": list((r1_data_content or {}).keys()),
                        "extracted_notes_count": len(extracted_notes),
                        "runtime_flags": runtime_flags,
                    },
                )

                # Route / tree (top)
                route_html = _pipeline_summary_html(section_title, [
                    {"step": "Initial Draft", "origin": r0_origin, "llm": {"provider": ai_provider_key, "model": model_api_name}, "batch": runtime_flags},
                    {"step": "AI Review", "origin": r1_origin, "llm": {"provider": ai_provider_key, "model": model_api_name}, "batch": runtime_flags},
                    {"step": "Notes Extraction (optional)", "origin": "extract_content_for_keywords", "llm": {}, "batch": {}},
                    {"step": "AI Final Revision", "origin": r2_origin, "llm": {"provider": ai_provider_key, "model": model_api_name}, "batch": runtime_flags},
                ])

                combined_html = route_html + "\n" + r0_block + "\n" + r1_block + "\n" + r2_block

                # Fill data for the monitor & for downstream reproducibility
                r2_data_dict.update({
                    "response_html": combined_html,
                    "initial_draft_prompt_sent": initial_draft_prompt_sent,
                    "initial_draft_html_response": initial_draft_html,
                    "review_r1_data_used": r1_data_content,
                    "extracted_notes_count_for_r2": len(extracted_notes),
                    "prompt_sent": r2_data_dict.get("prompt_sent", initial_draft_prompt_sent),
                    "monitor_origin": {
                        "r0": {"function": r0_origin, "inputs": list(accepted_kwargs.keys())},
                        "r1": {"function": r1_origin, "inputs": ["draft_content_plain_text", "descriptive_data", "ai_provider_key", "model_api_name", "runtime_flags"]},
                        "r2": {"function": r2_origin, "inputs": ["original_draft_plain_text", "review_round1_data_content", "extracted_notes", "skip_notes_in_prompt", "ai_provider_key", "model_api_name", "runtime_flags"]},
                    },
                })
                r2_pkg["data"] = r2_data_dict

                # Promote keys the monitor looks for
                for key in ("response_html","initial_draft_html_response","prompt_sent","initial_draft_prompt_sent"):
                    if key in r2_data_dict:
                        r2_pkg[key] = r2_data_dict[key]

                final_result_package = r2_pkg
                _callback(f"R2 complete for {section_title}. Status=ok")
            else:
                _callback(f"Review Round 2 for {section_title} failed. Error: {r2_pkg.get('data') if r2_pkg else 'N/A'}. Returning initial draft pkg.")
                # If the initial draft is an html_section, show it as-is
                if isinstance(final_result_package, dict) and final_result_package.get("type") == "html_section":
                    _callback(final_result_package)
    else:
        _callback(f"Review Round 2 skipped by configuration for {section_title}. Returning initial draft.")

    # Ensure top-level fields the monitor reads are present
    if isinstance(final_result_package, dict):
        inner = final_result_package.get("data", {}) or {}
        for key in ("response_html","initial_draft_html_response","prompt_sent","initial_draft_prompt_sent"):
            if key in inner and key not in final_result_package:
                final_result_package[key] = inner[key]

    return final_result_package


# In ai_services.py

def generate_ai_author_focus_keywords(store_only,read,use_cache,top_auth_df: pd.DataFrame, full_df: pd.DataFrame, ai_provider_key: str,
                                      model_api_name: str, progress_callback=None, results_so_far=None):
    def _cb(m):
        if progress_callback: progress_callback(m); logging.info(m)

    #
    final_map =[
    {
        "item_key": "Y3EEKUDQ",
        "suggested_keywords_for_author": [
            "cyber-attacks",
            "cyber attribution",
            "international law",
            "jus ad bellum",
            "state response",
            "legal ambiguity",
            "risk assessment",
            "cyber security",
            "identification challenges",
            "policy implications",
            "armed conflict",
            "cyber warfare",
            "national security",
            "legal frameworks",
            "cyber incidents",
            "accountability in cyberspace",
            "cross-border cyber operations",
            "cyber threat landscape",
            "law enforcement in cyberspace"
        ]
    },
    {
        "item_key": "GRHKF93L",
        "suggested_keywords_for_author": [
            "cyber attribution",
            "state responsibility",
            "international law",
            "computer network intrusions",
            "forensic technology",
            "sovereign borders",
            "legal challenges",
            "cybersecurity policy",
            "doctrine of attribution",
            "anemic legal frameworks",
            "cyber incident response",
            "cross-border cybercrime",
            "accountability mechanisms",
            "cyber threat analysis",
            "political implications",
            "cyber norms",
            "evidence in cyberspace",
            "cyber conflict",
            "legal standards for attribution"
        ]
    }
]
    return {"type": "author_keywords_map", "data": final_map,
            "description": "AI Suggested Author Focus Keywords (bReview)", "prompt_sent": "cache"}

    _cb("AI: Suggesting focus KWs for top authors (item_key as identifier)...")

    # Initial checks
    if top_auth_df is None or top_auth_df.empty or full_df is None or full_df.empty:
        return {"type": "error",
                "data": {"prompt_sent": "N/A", "error_message": "Missing top_auth_df or full_df data"},
                "description": "Missing data for Author KWs"}
    if 'key' not in full_df.columns:
        return {"type": "error", "data": {"prompt_sent": "N/A", "error_message": "'key' column missing in full_df"},
                "description": "Missing 'key' in full_df for Author KWs"}
    if 'authors' not in full_df.columns:
        return {"type": "error", "data": {"prompt_sent": "N/A", "error_message": "'authors' column missing in full_df"},
                "description": "Missing 'authors' in full_df for Author KWs"}


    author_contexts_for_llm = []
    author_block_to_item_keys_map = {}  # Maps: representative_item_key_sent_to_llm -> [all_zotero_keys_for_this_author]

    num_authors_to_process = min(3, len(top_auth_df))
    _cb(f"Preparing context for top {num_authors_to_process} authors.")

    authors_actually_processed_for_prompt = 0
    processed_author_names_for_prompt = set()

    for _, author_row in top_auth_df.head(num_authors_to_process).iterrows():
        author_name = author_row.get('Author')
        if not author_name or not isinstance(author_name, str) or author_name.strip() == "" or author_name == 'Unk':
            _cb(f"Skipping author with invalid name: {author_name}")
            continue

        if author_name in processed_author_names_for_prompt:  # Avoid processing same author if they appear multiple times
            _cb(f"Author '{author_name}' already processed for prompt context. Skipping duplicate.")
            continue

        try:
            # Use a simpler way to match author names if they are like "Last, First" or "First Last"
            # This regex tries to match the start of the author string against the listed author name components
            author_name_parts = [re.escape(part.strip()) for part in author_name.split(',')]
            # Match if all parts are present, in order, possibly with other authors
            # This is a basic check. A more robust solution might involve parsing author fields properly.
            regex_pattern_for_author = r'(?=.*' + r')(?=.*'.join(author_name_parts) + r')'
            author_pubs_df = full_df[
                full_df['authors'].astype(str).str.contains(regex_pattern_for_author, case=False, na=False, regex=True)]
        except Exception as e_regex:
            _cb(f"Regex error for author '{author_name}': {e_regex}. Skipping.")
            continue

        if author_pubs_df.empty:
            _cb(f"No publications found for author '{author_name}'. Skipping.")
            continue

        author_actual_item_keys = author_pubs_df['key'].dropna().unique().tolist()
        if not author_actual_item_keys:
            _cb(f"No valid Zotero item keys for publications of author '{author_name}'. Skipping.")
            continue

        # Use the first publication's key as the representative key for this author block in the prompt
        representative_item_key_for_block = author_actual_item_keys[0]

        # Store the mapping from this representative key to all of the author's item keys
        if representative_item_key_for_block in author_block_to_item_keys_map:
            _cb(f"Warning: Representative key {representative_item_key_for_block} for author {author_name} collides. This might indicate an issue in author list or pub data. Prioritizing first encountered.")
            # Potentially merge keys or log more details if this happens often.
            # For now, we just note it; the first author associated with this key will "own" it.
        else:
            author_block_to_item_keys_map[representative_item_key_for_block] = author_actual_item_keys
            processed_author_names_for_prompt.add(author_name)  # Mark this author name as processed for prompt

            context_block_str = f"AuthorBlockKey: {representative_item_key_for_block}\nAuthorNameForContext: {author_name}\nRepresentative Publications:\n"
            for _, pub_row in author_pubs_df.head(min(2, len(author_pubs_df))).iterrows():  # Show 1-2 sample pubs
                title = pub_row.get('title', 'N/A')
                abstract_full = pub_row.get('abstract', '')
                abstract_snippet = (abstract_full[:200] + '...') if len(
                    abstract_full) > 200 else abstract_full  # Slightly more context
                context_block_str += f"  - Title: {title}\n    Abstract Snippet: {abstract_snippet}\n"
            author_contexts_for_llm.append(context_block_str)
            authors_actually_processed_for_prompt += 1

    if not author_contexts_for_llm:
        return {"type": "error",
                "data": {"prompt_sent": "N/A", "error_message": "No valid author data to build LLM context"},
                "description": "No pub data for Author KWs"}
    _cb(f"Prepared context for {authors_actually_processed_for_prompt} distinct authors.")

    # Get prompt details
    prompt_key = "author_focus_keyword_generation_custom"  # Ensure this key exists in prompts.json

    prompt_template, model, max_t, json_schema_from_config ,effort= _get_prompt_details(prompt_key, ai_provider_key,
                                                                                       model_api_name)

    if "Fallback" in prompt_template or "Error: Prompt" in prompt_template:
        _cb(f"Warning: Using fallback/error prompt for '{prompt_key}'. LLM output might be unpredictable.")
        # Define a robust fallback prompt string here if critical, ensuring it asks for the item_key structure.
        # Example:
        # prompt_template = (
        #     "For each author block (identified by AuthorBlockKey), suggest 3-5 focused keywords based on their "
        #     "representative publications. Output ONLY a single JSON list of objects, where each object has "
        #     "'item_key' (this should be the AuthorBlockKey you were given for that author block) and "
        #     "'suggested_keywords_for_author' (a list of strings). Do NOT use markdown code blocks.\n\n"
        #     "Author Data:\n---\n{author_data_formatted}\n---\nJSON Output (single JSON list):"
        # )

    final_llm_prompt_str = "Error generating LLM prompt"
    try:
        final_llm_prompt_str = prompt_template.format(author_data_formatted="\n---\n".join(author_contexts_for_llm))
    except KeyError as e_key:
        _cb(f"KeyError formatting prompt for '{prompt_key}': {e_key}. Prompt might be misconfigured.")
        return {"type": "error", "data": {"prompt_sent": "N/A", "error_message": f"Prompt template KeyError: {e_key}"},
                "description": "Prompt format error for Author KWs"}

    base_log_dir = results_so_far.get("base_output_dir") if results_so_far else None
    overall_topic = results_so_far.get(STEP_LOAD_DATA, {}).get("collection_name_for_title", "the research topic")

    # Call LLM
    llm_response_package = call_models(store_only=store_only,read=read,
        ai_provider_key=ai_provider_key, model_api_name=model, prompt_text=final_llm_prompt_str,
        analysis_key_suffix="AuthorFocusKwsLLM",  # Shorter log suffix
                                       max_tokens=max_t,
        base_output_dir_for_logs=base_log_dir,
        json_schema=json_schema_from_config,use_cache=use_cache,
                                       overall_topic=overall_topic
    )

    if llm_response_package.get("error"):
        return {"type": "error", "data": llm_response_package, "description": "LLM Error for Author Focus KWs"}

    raw_llm_text_output = llm_response_package.get("raw_text", "")
    parsed_llm_output_list = []

    try:
        # Enhanced JSON parsing (handles markdown, attempts single list/object, then stream)
        cleaned_text_for_json = raw_llm_text_output
        if re.match(r'^\s*```(?:json)?\s*(.*?)\s*```\s*$', raw_llm_text_output, re.DOTALL | re.IGNORECASE):
            cleaned_text_for_json = re.match(r'^\s*```(?:json)?\s*(.*?)\s*```\s*$', raw_llm_text_output,
                                             re.DOTALL | re.IGNORECASE).group(1).strip()

        try:
            parsed_json_data = json.loads(cleaned_text_for_json)
            if isinstance(parsed_json_data, list):
                parsed_llm_output_list = parsed_json_data
            elif isinstance(parsed_json_data,
                            dict) and "item_key" in parsed_json_data:  # LLM might return a single object if only one author
                parsed_llm_output_list = [parsed_json_data]
            else:  # Try to find list within a dict if structure is like {"results": [...]}
                if isinstance(parsed_json_data, dict):
                    for val in parsed_json_data.values():
                        if isinstance(val, list) and all(isinstance(i, dict) and "item_key" in i for i in val):
                            parsed_llm_output_list = val
                            break
                if not parsed_llm_output_list:  # If still not a list
                    raise ValueError("Parsed JSON is not a list or a recognized single object/dict structure.")
        except json.JSONDecodeError:  # Fallback to stream parsing if single parse fails
            _cb(f"Could not parse LLM output as single JSON. Attempting stream parse for objects.")
            object_matches = re.finditer(r'\{(?:[^{}]|\{[^{}]*\})*\}', cleaned_text_for_json)
            for match in object_matches:
                try:
                    parsed_llm_output_list.append(json.loads(match.group(0)))
                except json.JSONDecodeError:
                    _cb(f"Failed to parse object in stream: {match.group(0)[:100]}...")
            if not parsed_llm_output_list:
                raise json.JSONDecodeError("Failed all JSON parsing attempts from LLM response.", raw_llm_text_output,
                                           0)

    except (json.JSONDecodeError, ValueError) as e_json_parse:
        _cb(f"Error decoding JSON for author keywords: {raw_llm_text_output[:200]}. Error: {e_json_parse}")
        return {"type": "error",
                "data": {"prompt_sent": final_llm_prompt_str, "raw_response": raw_llm_text_output,
                         "error_message": str(e_json_parse)},
                "description": "LLM non-JSON for Author KWs"}

    # Process parsed LLM output to create the final_map (item_key -> [keywords])
    # final_map structure: {actual_zotero_item_key1: [kwA1, kwA2], actual_zotero_item_key2: [kwB1], ...}
    final_map_item_key_to_keywords = {}
    successfully_mapped_author_blocks = 0

    for llm_entry_dict in parsed_llm_output_list:
        if not (isinstance(llm_entry_dict, dict) and \
                "item_key" in llm_entry_dict and \
                "suggested_keywords_for_author" in llm_entry_dict and \
                isinstance(llm_entry_dict["suggested_keywords_for_author"], list)):
            _cb(f"Skipping invalid LLM entry: {str(llm_entry_dict)[:100]}")
            continue

        returned_block_key = llm_entry_dict["item_key"]  # This should be the representative_item_key_for_block
        suggested_kws_for_block = [str(k).strip() for k in llm_entry_dict["suggested_keywords_for_author"] if
                                   str(k).strip()]

        if not suggested_kws_for_block:
            _cb(f"No valid keywords provided for block key '{returned_block_key}'.")
            continue

        if returned_block_key in author_block_to_item_keys_map:
            successfully_mapped_author_blocks += 1
            # Apply these keywords to ALL actual Zotero item keys associated with this author block
            for actual_zotero_item_key in author_block_to_item_keys_map[returned_block_key]:
                final_map_item_key_to_keywords.setdefault(actual_zotero_item_key, [])
                current_kws_for_item = final_map_item_key_to_keywords[actual_zotero_item_key]
                for new_kw in suggested_kws_for_block:
                    if new_kw not in current_kws_for_item:  # Avoid duplicates per item
                        current_kws_for_item.append(new_kw)
        else:
            _cb(f"LLM returned item_key '{returned_block_key}' which was not in the `author_block_to_item_keys_map` sent in the prompt context. LLM Entry: {llm_entry_dict}")

    if not final_map_item_key_to_keywords and authors_actually_processed_for_prompt > 0:
        # This implies LLM might have responded, but keys didn't match or lists were empty.
        _cb(f"LLM keyword generation processed, but no keywords were successfully mapped to items. Parsed LLM output list had {len(parsed_llm_output_list)} entries.")
        return {"type": "error",
                "data": {"prompt_sent": final_llm_prompt_str, "raw_response": raw_llm_text_output,
                         "parsed_llm_output": parsed_llm_output_list,
                         "error_message": "No keywords successfully mapped from LLM response to Zotero items."},
                "description": "Author KWs: Mapping/Format Issue"}

    _cb(f"AI focus keywords generated for {successfully_mapped_author_blocks} author blocks, resulting in keyword lists for {len(final_map_item_key_to_keywords)} Zotero items.")

    # --- Start of Integrated Note Extraction & Caching for Author Focus Keywords ---
    author_focus_notes_pkg = None
    if final_map_item_key_to_keywords:  # Only proceed if keyword generation was successful and produced a map
        _cb(f"Author Focus Keywords generated. Proceeding to extract and cache notes using these keywords...")

        current_overall_topic = results_so_far.get(STEP_LOAD_DATA, {}).get("collection_name_for_title",
                                                                           "unknown_collection")
        current_base_output_dir = results_so_far.get("base_output_dir", "output_default")
        notes_section_context_title = "AuthorFocusKeywordNotes"  # Fixed context for this type of notes

        sanitized_collection_name_for_path = re.sub(r'[^\w\-]+', '_', current_overall_topic.strip())[:50]
        sanitized_notes_section_title_for_path = re.sub(r'[^\w\-]+', '_', notes_section_context_title.strip())[:50]

        notes_cache_dir = Path(
            current_base_output_dir) / sanitized_collection_name_for_path / "notes_cache" / sanitized_notes_section_title_for_path
        notes_cache_dir.mkdir(parents=True, exist_ok=True)
        _cb(f"Notes cache directory for author focus: {notes_cache_dir}")

        map_str_for_hash = json.dumps(final_map_item_key_to_keywords, sort_keys=True)
        global_kws_for_hash_str = json.dumps([], sort_keys=True)  # No global keywords here

        cache_hash_input_string = f"section:{notes_section_context_title}|map:{map_str_for_hash}|global_kws:{global_kws_for_hash_str}"
        cache_filename_hash_value = hashlib.md5(cache_hash_input_string.encode('utf-8')).hexdigest()
        notes_cache_file_path = notes_cache_dir / f"notes_cache_{cache_filename_hash_value}.json"

        if notes_cache_file_path.exists():
            _cb(f"Found cached notes for author focus at {notes_cache_file_path}. Loading...")
            try:
                with open(notes_cache_file_path, 'r', encoding='utf-8') as f_cached_notes:
                    author_focus_notes_pkg = json.load(f_cached_notes)
                _cb(f"Successfully loaded {len(author_focus_notes_pkg.get('data', []))} author focus notes from cache.")
            except Exception as e_load_cached_notes:
                _cb(f"Error loading cached author focus notes: {e_load_cached_notes}. Will attempt fresh extraction.")
                author_focus_notes_pkg = None

        if not author_focus_notes_pkg:
            _cb(f"Cache not found or loading failed. Extracting notes for author focus keywords...")
            zot_client_instance = zot

            items_for_extraction_df = pd.DataFrame()  # Default to empty
            if 'key' in full_df.columns and final_map_item_key_to_keywords:  # Ensure keys exist in df
                keys_to_extract = list(final_map_item_key_to_keywords.keys())
                items_for_extraction_df = full_df[full_df['key'].isin(keys_to_extract)].copy()  # Use .copy()

            if not items_for_extraction_df.empty:
                author_focus_notes_pkg = extract_content_for_keywords(
                    full_df=items_for_extraction_df,
                    items_to_code_with_keywords_map=final_map_item_key_to_keywords,
                    zotero_client_instance=zot_client_instance,
                    globally_suggested_keywords=[],
                    progress_callback=_cb
                )

                if author_focus_notes_pkg and author_focus_notes_pkg.get("type") == "coded_notes_list":
                    _cb(f"Author focus notes extraction successful ({len(author_focus_notes_pkg.get('data', []))} notes). Saving to cache: {notes_cache_file_path}")
                    try:
                        with open(notes_cache_file_path, 'w', encoding='utf-8') as f_save_cache:
                            json.dump(author_focus_notes_pkg, f_save_cache, indent=2)
                    except Exception as e_save_cached_notes:
                        _cb(f"Error saving author focus notes to cache: {e_save_cached_notes}")
                elif author_focus_notes_pkg:
                    _cb(f"Author focus notes extraction returned package of type '{author_focus_notes_pkg.get('type')}'. Details: {author_focus_notes_pkg.get('data')}")
                else:
                    _cb(f"Author focus notes extraction did not return a package.")
            else:
                _cb("No items from full_df matched the keys in final_map_item_key_to_keywords for note extraction, or final_map was empty.")
                author_focus_notes_pkg = {"type": "coded_notes_list", "data": [],
                                          "description": "No matching items for author focus note extraction."}

        if author_focus_notes_pkg:
            results_so_far[f"{STEP_AI_AUTHOR_FOCUS_KEYWORDS}_ExtractedNotesPkg"] = author_focus_notes_pkg
            _cb(f"Author focus notes package (type: {author_focus_notes_pkg.get('type')}) stored in results_so_far.")
        else:
            _cb("No author focus notes package was generated or loaded from cache for storage in results_so_far.")
    else:  # if final_map_item_key_to_keywords was empty
        _cb("Skipping note extraction for author focus as no keywords were generated or mapped.")

    # Return the primary output of this function: the author keywords map
    return_package = {
        "type": "author_keywords_map",
        "data": final_map_item_key_to_keywords,  # This is the map: {actual_zotero_item_key: [keywords]}
        "description": "AI Suggested Author Focus Keywords (item_key based)",
        "prompt_sent": final_llm_prompt_str,
        "raw_llm_response": raw_llm_text_output,  # Store for traceability
        "llm_parsed_entry_count": len(parsed_llm_output_list)  # How many entries LLM returned
    }
    return return_package
# --- Main AI Section Generation Functions ---
def generate_ai_abstract(store_only,read, use_cache, df_full, results_so_far, progress_callback, ai_provider_key, model_api_name):
    return _generate_initial_draft_generic(prompt_key_for_initial_draft="bReview_abstract_generation", section_step_key_for_context=STEP_AI_ABSTRACT, df_full=df_full, results_so_far=results_so_far,
                                           progress_callback=progress_callback, ai_provider_key=ai_provider_key, model_api_name=model_api_name,store_only=store_only,read=read, use_cache=use_cache)



def generate_ai_introduction(

    df_full, results_so_far, progress_callback,
    ai_provider_key, model_api_name,
    *, store_only: bool = False, read: bool = False, use_cache: bool = True
):
    return _generate_initial_draft_generic(
        prompt_key_for_initial_draft="bReview_introduction_generation",
        section_step_key_for_context=STEP_AI_INTRODUCTION,
        df_full= df_full,
        results_so_far=results_so_far,
        progress_callback=progress_callback,
        ai_provider_key=ai_provider_key,
        model_api_name=model_api_name,
        store_only=store_only,
        read=read,
        use_cache=use_cache,
    )



def generate_ai_conclusion(store_only,read, use_cache, df_full, results_so_far, progress_callback, ai_provider_key, model_api_name):
    return _generate_initial_draft_generic(prompt_key_for_initial_draft="bReview_conclusion_generation",
        section_step_key_for_context=STEP_AI_CONCLUSION,
        df_full= df_full,
        results_so_far=results_so_far,
        progress_callback=progress_callback,
        ai_provider_key=ai_provider_key,
        model_api_name=model_api_name,
        store_only=store_only,
        read=read,
        use_cache=use_cache,)


def _generate_initial_draft_lit_landscape(store_only,read, use_cache, df_full, results_so_far, progress_callback, ai_provider_key, model_api_name):
    topic = results_so_far.get(STEP_LOAD_DATA, {}).get("collection_name_for_title", "the research topic")
    stg = f"Bibliometric Overview of the Literature Landscape on '{topic}'"
    return _generate_initial_draft_generic( prompt_key_for_initial_draft="bReview_literature_landscape_overview",
        section_step_key_for_context=STEP_AI_LITERATURE_REVIEW_SUMMARY,
        df_full= df_full,
        results_so_far=results_so_far,
        progress_callback=progress_callback,
        ai_provider_key=ai_provider_key,
        model_api_name=model_api_name,
        store_only=store_only,
        read=read,
        use_cache=use_cache,
        extra_context_vars={"topic": topic, "section_title_guidance": stg})


# def generate_ai_literature_review_summary(store_only,read, use_cache, df_full, results_so_far, progress_callback, ai_provider_key, model_api_name):
#     return _generate_initial_draft_lit_landscape(store_only,read, use_cache, df_full, results_so_far, progress_callback, ai_provider_key,
#                                                  model_api_name)


# In ai_services.py

def _generate_initial_draft_methodology(store_only,read, use_cache, df_full, results_so_far, progress_callback, ai_provider_key, model_api_name):
    def _callback(msg):  # Local callback
        if progress_callback: progress_callback(msg)

    topic = results_so_far.get(STEP_LOAD_DATA, {}).get("collection_name_for_title", "the analyzed topic")
    rq = results_so_far.get("research_question", "To explore the bibliometric landscape of the specified topic.")
    num_proc = str(df_full.shape[0] if df_full is not None else "N/A")

    pdf_content_data = results_so_far.get(STEP_EXTRACT_PDF_CONTENT_FOR_KEYWORDS, {}).get("data", [])
    num_pdfs_coded_val = str(len(pdf_content_data)) if isinstance(pdf_content_data, list) else "0"

    # --- Create a string listing the main analytical sections/themes for the prompt ---
    # These are the names of the AI-driven analysis/writing steps that would typically follow Methodology.
    # This list should align with the main parts of your "Results" and "Discussion".
    potential_final_section_keys = [
        STEP__TIMELINE,
        STEP_AI_DOC_TYPES_ANALYSIS,
        STEP_AI_AUTHOR_GRAPH_ANALYSIS,
        STEP_AI_AFFILIATIONS_ANALYSIS,
        STEP_AI_COUNTRIES_ANALYSIS,
        STEP_AI_GENERAL_KEYWORD_THEMES_ANALYSIS,
        STEP_AI_COAUTHORSHIP_NETWORK_ANALYSIS,
        STEP_AI_KEYWORD_GRAPH_ANALYSIS,
        STEP_AI_SOURCES_ANALYSIS,
        STEP_AI_CITATION_TABLE_ANALYSIS,
        STEP_AI_FUNDERS_ANALYSIS,
        STEP_AI_PDF_CONTENT_SUMMARY,
        STEP_AI_DISCUSSION  # Discussion itself can be considered a synthesis of prior analyses
    ]

    final_section_names = []
    for key in potential_final_section_keys:
        # Convert STEP constant to a readable name if not using descriptions from results_so_far
        readable_name = key.replace("STEP_AI_", "").replace("_", " ").title().replace("Review", "").replace("Insights",
                                                                                                            "").strip()
        if "Analysis" not in readable_name and "Summary" not in readable_name:  # Make it more descriptive
            readable_name += " Analysis"
        final_section_names.append(readable_name)

    final_sections_str_val = ", ".join(final_section_names) if final_section_names else "various key analytical areas"
    # --- End of final_sections_str preparation ---

    extra_vars = {
        "topic": topic,
        "research_question": rq,
        "Inclusion": results_so_far.get("inclusion_criteria",
                                        "Relevant peer-reviewed scholarly publications directly addressing the research topic within the defined scope and timeframe."),
        "Exclusion": results_so_far.get("exclusion_criteria",
                                        "Editorials, commentaries, book reviews, and publications not directly relevant to the core research questions or outside the defined scope."),
        "num_items_processed": num_proc,
        "num_items_screened": results_so_far.get("num_items_screened", num_proc),
        "num_items_included": results_so_far.get("num_items_included", num_proc),
        "num_pdfs_coded": num_pdfs_coded_val,
        "final_sections_str": final_sections_str_val,  # Ensure prompt uses {final_sections_str}
        "Synthesis_approach": results_so_far.get("synthesis_approach_text",  # This can be a general statement
                                                 "A quantitative bibliometric analysis approach was employed, involving analyses of publication trends, contributor profiles (authors, institutions, countries), keyword co-occurrence and clustering for thematic structure, and co-authorship network mapping. The findings from these distinct analytical components were then synthesized to construct a comprehensive overview of the research landscape related to the topic, addressing the primary research question(s).")
    }

    return _generate_initial_draft_generic(
        prompt_key_for_initial_draft="bReview_methodology_generation",
        section_step_key_for_context=STEP_AI_METHODOLOGY_REVIEW,
        df_full=df_full,
        results_so_far=results_so_far,
        progress_callback=progress_callback,
        ai_provider_key=ai_provider_key,
        model_api_name=model_api_name,
        extra_context_vars=extra_vars,
        use_cache=use_cache,
        read=read,
        store_only=store_only,
    )


# In ai_services.py

def generate_ai_methodology_insights(store_only,read, use_cache, df_full, results_so_far, progress_callback, ai_provider_key, model_api_name):
    def _callback(msg):  # Using a local callback for consistent logging prefix
        if progress_callback: progress_callback(f"Methodology Gen: {msg}")
        logging.info(f"Methodology Gen: {msg}")

    _callback("Preparing to generate Methodology section (initial draft only, review rounds will be skipped).")


    methodology_context_summary_for_disabled_r1 = (
        f"Generating Methodology for topic: {results_so_far.get(STEP_LOAD_DATA, {}).get('collection_name_for_title', 'N/A')}. "
        f"Dataset items: {results_so_far.get(STEP_LOAD_DATA, {}).get('analyzed_docs_count', 'N/A')}."
    )

    return generate_final_draft(
        initial_draft_func=_generate_initial_draft_methodology,
        section_step_key=STEP_AI_METHODOLOGY_REVIEW,
        df_full=df_full,
        results_so_far=results_so_far,
        ai_provider_key=ai_provider_key,
        model_api_name=model_api_name,
        progress_callback=progress_callback,  # Pass the original progress_callback here
        descriptive_data_for_section=methodology_context_summary_for_disabled_r1,
        enable_review_round1=False,
        enable_note_extraction=False,
        enable_review_round2=False,
        store_only=store_only, read=read, use_cache=use_cache,

    )

def _generate_initial_draft_discussion(store_only,read, use_cache, df_full, results_so_far, progress_callback, ai_provider_key, model_api_name):
    topic = results_so_far.get(STEP_LOAD_DATA, {}).get("collection_name_for_title", "the research topic")
    kws_data = results_so_far.get(STEP_AI_SUGGEST_CODING_KEYWORDS, {}).get("data", [])
    akw = kws_data[0] if kws_data and isinstance(kws_data, list) and kws_data[0] else "key research themes"
    return _generate_initial_draft_generic( prompt_key_for_initial_draft="bReview_discussion_generation",
        section_step_key_for_context=STEP_AI_DISCUSSION,
        df_full= df_full,
        results_so_far=results_so_far,
        progress_callback=progress_callback,
        ai_provider_key=ai_provider_key,
        model_api_name=model_api_name,
        store_only=store_only,
        read=read,
        use_cache=use_cache,
        extra_context_vars={"topic": topic, "analyzed_keyword": akw})




def generate_ai_discussion(store_only,read, use_cache, df_full, results_so_far, progress_callback, ai_provider_key, model_api_name):
    parts = [
        f"Discussion for {results_so_far.get(STEP_LOAD_DATA, {}).get('collection_name_for_title', 'topic')}. Summary for reviewer:"]
    for k_step in [STEP__TIMELINE, STEP_ANALYZE_AUTHORS, STEP__KEYWORD_COOCCURRENCE_NET,
                   STEP_AI_AUTHOR_GRAPH_ANALYSIS, STEP_AI_KEYWORD_GRAPH_ANALYSIS, STEP__TIMELINE]:
        if k_step in results_so_far and results_so_far[k_step] and results_so_far[k_step].get("description"):
            parts.append(f"- {results_so_far[k_step]['description']}.")
    descriptive_data_for_discussion = "\n".join(parts)
    return generate_final_draft(initial_draft_func=_generate_initial_draft_discussion, section_step_key=STEP_AI_DISCUSSION, df_full=df_full,
                                           results_so_far= results_so_far, ai_provider_key=ai_provider_key, model_api_name=model_api_name, progress_callback=progress_callback,
                                           descriptive_data_for_section= descriptive_data_for_discussion[:2000],store_only=store_only, read=read, use_cache=use_cache)


def _generate_initial_draft_limitations(store_only,read, use_cache, df_full, results_so_far, progress_callback, ai_provider_key, model_api_name):
    return _generate_initial_draft_generic(prompt_key_for_initial_draft="bReview_limitations_generation",
        section_step_key_for_context=STEP_AI_LIMITATIONS,
        df_full= df_full,
        results_so_far=results_so_far,
        progress_callback=progress_callback,
        ai_provider_key=ai_provider_key,
        model_api_name=model_api_name,
        store_only=store_only,
        read=read,
        use_cache=use_cache)



def generate_ai_limitations(store_only,read, use_cache, df_full, results_so_far, progress_callback, ai_provider_key, model_api_name):
    desc = "Limitations based on study design, data sources, and analysis scope."
    return generate_final_draft(initial_draft_func=_generate_initial_draft_limitations, section_step_key=STEP_AI_LIMITATIONS,  df_full=df_full,
                                           results_so_far=results_so_far,  ai_provider_key=ai_provider_key,
                                           model_api_name=model_api_name, progress_callback=progress_callback, descriptive_data_for_section=desc,use_cache=use_cache,store_only=store_only, read=read,)


# --- Enhanced Graph/Figure Analysis Functions (using Review Orchestrator) ---
def _generate_initial_draft_figure_analysis(store_only,read, use_cache, df_full, results_so_far, progress_callback, ai_provider_key, model_api_name,
                                            section_step_key, initial_prompt_key, descriptive_data_figure,
                                            figure_specific_extra_vars=None):
    topic = results_so_far.get(STEP_LOAD_DATA, {}).get("collection_name_for_title", "research topic")
    base_extra = {"overall_topic": topic,
                  "descriptive_data": descriptive_data_figure}  # Ensure descriptive_data is passed as per prompt
    if figure_specific_extra_vars: base_extra.update(figure_specific_extra_vars)
    return _generate_initial_draft_generic(prompt_key_for_initial_draft=initial_prompt_key,
        section_step_key_for_context=section_step_key,
        df_full= df_full,
        results_so_far=results_so_far,
        progress_callback=progress_callback,
        ai_provider_key=ai_provider_key,
        model_api_name=model_api_name,
        store_only=store_only,
        read=read,
        use_cache=use_cache,
        extra_context_vars=base_extra)

def generate_ai_refined_search_keywords(
        overall_topic: str,
        timeline_description: str,
        failed_keywords: list,
        clarifying_questions: list,
        ai_provider_key: str,
        model_api_name: str,
        store_only:bool,
        read:bool,
        use_cache:bool,
        progress_callback=None,
        results_so_far: dict = None
):
    def _callback(msg):
        if progress_callback: progress_callback(msg); logging.info(msg)

    prompt_key = "bReview_refine_timeline_search_keywords"
    prompt_template, effective_model, max_t ,effort= _get_prompt_details(prompt_key, ai_provider_key,  model_api_name,section_id="modifyafter",results_so_far=results_so_far)
    if "Fallback prompt" in prompt_template: _callback(f"Warning: Fallback for {prompt_key} (Refine KWs).")

    _callback(f"AI: Refining search keywords for timeline analysis (Model: {effective_model})...")

    context_vars = {
        "overall_topic": overall_topic,
        "timeline_description": timeline_description,
        "failed_keywords_list_str": "\n- ".join(failed_keywords) if failed_keywords else "N/A",
        "clarifying_questions_list_str": "\n- ".join(clarifying_questions) if clarifying_questions else "N/A"
    }
    formatted_prompt = "Error formatting refine_keywords prompt"
    try:
        formatted_prompt = prompt_template.format(**context_vars)
    except KeyError as e:
        _callback(f"Prompt formatting error for Refine Keywords ({prompt_key}): {e}.")
        return {"type": "error",
                "data": {"prompt_sent": formatted_prompt, "error_message": f"Prompt format error: {e}"}}

    log_dir = results_so_far.get("base_output_dir") if results_so_far else None
    ai_response_dict = call_models(store_only=store_only,read=read,ai_provider_key=ai_provider_key, model_api_name=effective_model, prompt_text=formatted_prompt,
                                   analysis_key_suffix="bRev_RefineTimelineKWs",
                                   use_cache=use_cache,

                                   overall_topic=overall_topic)

    if ai_response_dict.get("error"):
        return {"type": "error", "data": ai_response_dict, "description": "Error refining keywords"}

    raw_text_keywords = ai_response_dict.get("raw_text", "[]");
    refined_keywords = []
    try:
        json_match = re.search(r'\[.*?\]', raw_text_keywords, re.DOTALL)
        json_str = json_match.group(0) if json_match else raw_text_keywords
        refined_keywords = json.loads(json_str)
        if not (isinstance(refined_keywords, list) and all(isinstance(kw, str) for kw in refined_keywords)):
            raise ValueError("Refined keywords output not a list of strings")
    except (json.JSONDecodeError, ValueError) as e_json:
        _callback(f"AI non-JSON list for refined KWs: '{raw_text_keywords[:100]}'. Error: {e_json}. Manual extract.");
        cleaned_text = re.sub(r'^```json\s*|```$', '', raw_text_keywords.strip());
        candidates = [kw.strip('"\' ').strip("[]") for kw in re.split(r',|\n', cleaned_text) if
                      kw.strip()]  # Also strip list brackets if present
        refined_keywords = [kw for kw in candidates if
                            kw and len(kw) > 2 and not kw.lower().startswith(("example", "suggested"))]

    if not refined_keywords:
        return {"type": "error", "data": {**ai_response_dict, "error_message": "Empty/invalid refined KW list"},
                "description": "Error refining KWs"}

    _callback(f"AI suggested refined search keywords: {refined_keywords}")
    return {"type": "keyword_list", "data": refined_keywords, "description": "AI Refined Search Keywords for Timeline",
            "prompt_sent": formatted_prompt}


# def _timeline_batches_for_df(
#     df: "pd.DataFrame",
#     periods: list[dict],
#     batch_size: int = 20,
#     *,
#     features: "list[str] | tuple[str, ...] | None" = None,
#     keyword: "str | None" = None,
# ) -> list[dict]:
#     """
#     Build timeline batches by period and contribution_type, but *delegate* HTML construction
#     to `creating_batches` so every item carries the unified anchor with abstract/tags and
#     optional `data-feature-*` attributes.
#
#     Contract:
#       • If `keyword` is not None: the visible paragraph text becomes `keyword`; abstract moves into anchor.
#       • If `keyword` is None: the abstract is the visible text; anchor appended.
#       • `features` (e.g., ["contribution_type"]) are emitted as data-feature-<name> on the anchor.
#
#     Output 'items' are the payload strings returned by `creating_batches`
#     (each payload is a newline-joined block of <p>…</p> lines).
#     """
#     import html as _html
#     import pandas as pd
#
#     if df is None or getattr(df, "empty", True) or not periods:
#         return []
#
#     _df = df.copy()
#     _df["__year_num"] = pd.to_numeric(_df.get("year"), errors="coerce")
#
#     if "contribution_type" not in _df.columns:
#         _df["contribution_type"] = "Unspecified"
#
#     batches: list[dict] = []
#
#     for p in periods:
#         start = int(p.get("start_year") or p.get("StartYear") or 0)
#         end = int(p.get("end_year") or p.get("EndYear") or start)
#         label = _safe_str(p.get("period_label") or p.get("label") or f"{start}-{end}")
#
#         sub = _df[(_df["__year_num"] >= start) & (_df["__year_num"] <= end)]
#         if sub.empty:
#             continue
#
#         for ct_val, g in sub.groupby("contribution_type"):
#             ct_name = (_safe_str(ct_val) or "Unspecified").strip() or "Unspecified"
#
#             # Synthesise an extractor-like `res` so we can reuse creating_batches.
#             # Each row becomes a "note" keyed by this ct_name to group within the call.
#             # We set source_item_key=key so creating_batches can backfill abstract/tags from df.
#             notes = []
#             for _, row in g.iterrows():
#                 key = _safe_str(row.get("key"))
#                 abs_txt = _safe_str(row.get("abstract"))
#                 title = _safe_str(row.get("title"))
#                 # Prefer abstract as section_html; fallback to title to keep a visible body if needed.
#                 section_html = f"<p>{_html.escape(abs_txt or title or '')}</p>" if (abs_txt or title) else ""
#                 notes.append({
#                     "keyword_found": ct_name,
#                     "source_item_key": key,
#                     "source_title": title,
#                     "item_type": _safe_str(row.get("item_type")),
#                     "abstract": abs_txt,
#                     "section_html": section_html,
#                     # source_bib_header left blank; creating_batches will derive from df when possible
#                 })
#
#             if not notes:
#                 continue
#
#             res = {"data": notes}
#
#             # Call the unified batch builder; pass df for lookup + features/keyword policy.
#             out = creating_batches(
#                 res,
#                 batch_size=batch_size,
#                 progress_callback=None,
#                 features=features,
#                 dataframe=_df,
#                 keyword=keyword,
#             )
#             # Flatten the returned structure {kw: [payloads]} into our batches list
#             # keeping the timeline/ct label.
#             # There will be exactly one key (ct_name) by construction, but we handle generically.
#             payloads: list[str] = []
#             for d in out:
#                 for _, payload_list in d.items():
#                     payloads.extend(payload_list or [])
#
#             if not payloads:
#                 continue
#
#             total = len(payloads)
#             for idx, payload in enumerate(payloads, 1):
#                 batches.append({
#                     "period_label": label,
#                     "start_year": start,
#                     "end_year": end,
#                     "contribution_type": ct_name,
#                     "label": f"{label} • {ct_name} • batch {idx}/{total}",
#                     "count": payload.count("<p>"),  # rough count of paragraphs inside the payload
#                     # Each item is a single string payload returned by creating_batches
#                     "items": [payload],
#                 })
#
#     return batches


def get_llm_structured_timeline_analysis(
        overall_topic: str,
        timeline_data_description: str,
        timeline_image_path: str | None,
        ai_provider_key: str,
        model_api_name: str,
        store_only:bool,
        read:bool,
        use_cache:bool,
        section_title,
        progress_callback=None,
        results_so_far: dict = None
) -> dict:
    """
    Uses an LLM to analyze a textual description and/or an image of timeline data
    and return a structured JSON object detailing trend periods and peaks.
    """



    def _cb(msg):
        if progress_callback: progress_callback(msg)
        logging.info(msg)

    # _emit_phase_open(results_so_far, "A. generating timeline analysis", "A.I structured_timeline_analysis", section_key="B_timeline_stats")
    initial_draft_func_to_use=None

    # _cb("Attempting LLM call (with potential vision) for structured timeline trend analysis...")

    prompt_key = "bReview_timeline_analyze_for_structured_trends"  # This prompt must be multimodal
    prompt_template, model, max_t, json_schema ,effort= _get_prompt_details(
        prompt_key, ai_provider_key,  model_api_name,section_id=section_title,results_so_far=results_so_far  # Ensure model from config is vision-capable
    )

    if "Fallback" in prompt_template or "Error" in prompt_template:
        _cb(f"ERROR: Prompt for {prompt_key} not found or is a fallback. Cannot perform structured trend analysis.")
        return {
            "error": "Missing prompt for structured trend analysis.",
            "structured_trends": None,
            "raw_llm_response": None,
            "prompt_sent": "Prompt not formatted or error in template."  # Corrected fallback
        }

    formatted_prompt_text = "Error formatting prompt."
    try:

        formatted_prompt_text = prompt_template.format(
            overall_topic=str(overall_topic),
            timeline_data_description=str(timeline_data_description)
        )
    except KeyError as e:
        _cb(f"ERROR: KeyError formatting prompt {prompt_key}: {e}")
        return {
            "error": f"Prompt formatting KeyError: {e}",
            "structured_trends": None,
            "raw_llm_response": None,
            "prompt_sent": prompt_template  # Show template on error
        }

    base_log_dir = results_so_far.get("base_output_dir") if results_so_far else None

    use_vision_for_call = False
    actual_image_path_for_api = None
    if timeline_image_path and Path(timeline_image_path).is_file():
        use_vision_for_call = True
        actual_image_path_for_api = timeline_image_path
        _cb(f"Vision input WILL BE USED for timeline analysis, using image: {timeline_image_path}")
    else:
        _cb("No valid image path for timeline analysis; proceeding with text-only analysis for structured trends.")
        if timeline_image_path:  # Path was given but invalid
            _cb(f"Warning: Provided timeline_image_path '{timeline_image_path}' is not a valid file.")

    llm_response_pkg = call_models(store_only=store_only,
        read=read,
        ai_provider_key=ai_provider_key,
        model_api_name=model,
        prompt_text=formatted_prompt_text,
        analysis_key_suffix="TimelineStructuredVision" if use_vision_for_call else "TimelineStructuredText",
        max_tokens=max_t,
        vision=use_vision_for_call,
        dynamic_image_path=actual_image_path_for_api,
        base_output_dir_for_logs=base_log_dir,
        json_schema=json_schema,
        section_title=section_title,
        use_cache=use_cache,results_so_far=results_so_far,
                                   overall_topic=overall_topic

                                   )

    usage_for_totals = dict((llm_response_pkg or {}).get("usage") or {})
    cost_for_totals = float(
        (llm_response_pkg or {}).get("cost_usd")
        or usage_for_totals.get("cost_usd", 0.0)
        or 0.0
    )

    structured_analysis_result_pkg = llm_response_pkg  # or your wrapper

    emit_model_call_report_html(
        results_so_far=results_so_far,
        analysis_key_suffix="TimelineStructuredVision",  # or any suffix you use
        package=structured_analysis_result_pkg,
        call_params={
            "ai_provider_key": ai_provider_key,
            "model_api_name": model_api_name,
            "max_tokens": max_t,
            "vision": False,
            "use_cache": True,
            "json_schema": json_schema,  # or None / "json"
            "store_only": False,
            "read": False,
            "custom_id": "none",
            "effort": effort,
            "from_cache": False,  # set True if you know you hit disk cache
        },
        section_title=STEP__TIMELINE,
        page="analysis_suffix_period",
    )
    if llm_response_pkg.get("error"):
        error_msg = str(llm_response_pkg.get("error") or "Unknown LLM error")
        html_error = (
            "<h3 style='color:red;'>Timeline Analysis – LLM Error</h3>"
            f"<p><b>Reason:</b> {html.escape(error_msg)}</p>"
            "<h4>Prompt sent</h4>"
            f"<pre style='white-space:pre-wrap;border:1px solid #ccc;padding:4px;'>"
            f"{html.escape(formatted_prompt_text)}</pre>"
            "<h4>Raw response</h4>"
            f"<pre style='white-space:pre-wrap;border:1px solid #ccc;padding:4px;'>"
            f"{html.escape(llm_response_pkg.get('raw_text', '')[:1200])}</pre>"
        )

        return {
            "type": "html_section",
            "data": {
                "response_html": html_error,
                "initial_draft_html_response": html_error,
                "prompt_sent": formatted_prompt_text,
                "initial_draft_prompt_sent": formatted_prompt_text,
                "structured_trends_json": None,
                "raw_llm_response": llm_response_pkg.get("raw_text", ""),
                "api_usage": usage_for_totals,
                "api_cost_usd": cost_for_totals,
            },
            "description": "Timeline Analysis - ERROR"
        }

    raw_json_output = llm_response_pkg.get("raw_text", "{}")
    structured_trends_data = None
    try:
        json_match = re.search(r'\{[\s\S]*\}', raw_json_output)
        if json_match:
            json_str = json_match.group(0)
            structured_trends_data = json.loads(json_str)
            results_so_far["Trends"]= structured_trends_data

            _cb("Successfully parsed structured timeline analysis from LLM response.")
        else:
            _cb(f"WARNING: No clear JSON object found in LLM response for structured timeline. Raw: {raw_json_output[:300]}")
            raise json.JSONDecodeError("No JSON object found in response", raw_json_output, 0)

        # REVISED VALIDATION: Check for essential conceptual parts
        if not isinstance(structured_trends_data, dict):
            raise ValueError("LLM output is not a JSON object.")

        missing_essential_parts = []
        if "preliminary_narrative_draft" not in structured_trends_data:
            missing_essential_parts.append("'preliminary_narrative_draft'")

        # Check for trend_periods (accommodating slight casing variations from LLM if necessary)
        has_trend_periods = structured_trends_data.get("trend_periods") or structured_trends_data.get("TrendPeriods")
        if not (has_trend_periods and isinstance(has_trend_periods, list)):
            missing_essential_parts.append("'trend_periods' array")

        # Check for some evidence of scope data
        has_scope_data = "overall_timeline_scope" in structured_trends_data or \
                         "initial_publication_year" in structured_trends_data
        if not has_scope_data:
            missing_essential_parts.append(
                "overall scope data (e.g., 'overall_timeline_scope' or 'initial_publication_year')")

        if missing_essential_parts:
            validation_error_msg = f"Parsed JSON is missing essential components: {', '.join(missing_essential_parts)}"
            _cb(f"WARNING: {validation_error_msg}. Data: {str(structured_trends_data)[:300]}")
            raise ValueError(validation_error_msg)

        _cb("Basic validation of structured timeline JSON passed (key conceptual components present).")

    except (json.JSONDecodeError, ValueError) as e:
        _cb(f"ERROR: Failed to parse or validate structured timeline JSON from LLM: {e}. Raw: {raw_json_output[:300]}")
        return {
            "error": f"JSON parsing/validation error: {e}",
            "structured_trends": None,
            "raw_llm_response": raw_json_output,
            "prompt_sent": formatted_prompt_text,
            "api_usage": usage_for_totals,
            "api_cost_usd": cost_for_totals,
        }

    trend_items_html = ""
    for tp in structured_trends_data.get("trend_periods", []):
        start = html.escape(str(tp.get("start_year", "?")))
        end = html.escape(str(tp.get("end_year", "?")))
        label = html.escape(tp.get("period_label") or tp.get("label", "Period"))
        peak = html.escape(str(tp.get("peak_year", "—")))
        trend_items_html += f"<li><b>{label}</b> ({start}–{end}), peak {peak}</li>"

    prelim = html.escape(structured_trends_data.get("preliminary_narrative_draft", ""))
    json_block = html.escape(json.dumps(structured_trends_data, indent=2))

    html_summary = (
        "<h3>Structured Timeline Analysis</h3>"
        f"<p>{prelim or '[No preliminary narrative returned]'}</p>"
        "<h4>Trend periods</h4>"
        f"<ul>{trend_items_html or '<li>No periods detected</li>'}</ul>"
        "<details><summary>Raw JSON&nbsp;(truncated)</summary>"
        f"<pre style='white-space:pre-wrap;border:1px solid #ccc;padding:4px;'>"
        f"{json_block}</pre></details>"
    )

    return {
        "type": "html_section",
        "data": {
            "response_html": html_summary,
            "initial_draft_html_response": html_summary,
            "prompt_sent": formatted_prompt_text,
            "initial_draft_prompt_sent": formatted_prompt_text,
            "structured_trends_json": structured_trends_data,
            "raw_llm_response": raw_json_output
        },
        "description": "Structured Timeline Analysis"
    }

import logging
import json  # For logging the package
from pathlib import Path
import pandas as pd  # For type hints and operations in _timeline_note_item_filter

# Placeholder for actual constants if not globally available in this snippet
STEP_LOAD_DATA = "Load Data"

def _quick_peak_fallback(peaks_data_list):
    """
    Minimal HTML list summarizing peaks. Safe for non-string fields (ints, None).
    """
    import html  # ensure available in this scope
    try:
        if not peaks_data_list:
            return "<p><i>No peak information available.</i></p>"

        rows = []
        for p in peaks_data_list:
            try:
                # value/magnitude
                val_desc = p.get("value_description", None)
                if val_desc is None:
                    val_desc = p.get("value", p.get("Magnitude", "N/A pubs"))
                desc_text = html.escape(str(val_desc))

                # year
                year_val = p.get("year", p.get("Year", "NA"))
                year_text = html.escape(str(year_val))

                # flags / extras
                overall = p.get("is_overall_peak") or p.get("IsOverallPeak") or False
                prominence = p.get("peak_prominence") or p.get("Prominence") or "NA"
                prom_text = html.escape(str(prominence))
                flag_text = " (overall peak)" if bool(overall) else ""

                rows.append(f"<li><b>{year_text}</b>: {desc_text}{flag_text} — prominence: {prom_text}</li>")
            except Exception as _e_row:
                rows.append(f"<li><i>[Error summarizing a peak: {html.escape(str(_e_row))}]</i></li>")

        return "<ul>" + "\n".join(rows) + "</ul>"
    except Exception as e:
        return f"<p><i>[Peak fallback failed: {html.escape(str(e))}]</i></p>"

def generate_ai_timeline_analysis(df_full: pd.DataFrame,
                                  results_so_far: dict,
                                  progress_callback,
                                  ai_provider_key: str,
                                  model_api_name: str,
                                  q_terms,
                                  store_only,
                                  read,
                                  use_cache: bool = True,
                                  code=None,
                                  review=False,
                                  create_zotero_collections=False

                                  ):
    import logging
    from pathlib import Path

    results_so_far["dataframe_full"] = df_full

    def _callback(msg: str):
        if progress_callback:
            progress_callback(msg)  # feeds any upstream progress handlers
        try:
            # mirror to the monitor "Live feed" page (safe if results_so_far is None)
            emit_live_feed_html(results_so_far, str(msg))
        except Exception:
            pass
        logging.info(str(msg))

    # --- cost aggregator (totals across ALL LLM calls in this step) ---
    results_so_far.setdefault("API_COST_TOTALS", {"input_tokens": 0, "output_tokens": 0, "usd": 0.0})
    results_so_far.setdefault("API_COST_LEDGER", [])

    def _totals_bump(pkg: dict | None, *, label: str = "", meta: dict | None = None):
        if not isinstance(pkg, dict):
            return
        it = int(pkg.get("input_tokens", 0) or 0)
        ot = int(pkg.get("output_tokens", 0) or 0)
        usd = float(pkg.get("usd", pkg.get("cost_usd", 0.0)) or 0.0)
        totals = results_so_far["API_COST_TOTALS"]
        totals["input_tokens"] += it
        totals["output_tokens"] += ot
        totals["usd"] += usd
        # keep a ledger row, so you can show a detailed breakdown later
        row = {"label": label or "call", "input_tokens": it, "output_tokens": ot, "usd": usd}
        if isinstance(meta, dict):
            row["meta"] = meta
        results_so_far["API_COST_LEDGER"].append(row)

    _section_cost = {"input_tokens": 0, "output_tokens": 0, "usd": 0.0}
    overall_topic = results_so_far.get(STEP_LOAD_DATA, {}).get("collection_name_for_title", "the research topic")


    section_step_key = STEP__TIMELINE
    section_title = "Publication Timeline Analysis"
    _ = _callback(f"--- Orchestrating {section_title} Generation ---")

    # 1) Build a dense year→count series for description (min..max filled with zeros)


    trends_series={}

    # 2) Describe trend data using provided helper
    try:
        # Safely compute a year→count series
        if isinstance(df_full, pd.DataFrame) and not df_full.empty and "year" in df_full.columns:
            trends_series = analyze_publication_trends(
                df_full)  # expects a Series indexed by year with .name == "count"
            if trends_series is None or trends_series.empty:
                initial_timeline_summary_text_from_data_proc = "No publication trend data available to describe."
            else:
                initial_timeline_summary_text_from_data_proc = describe_trend_data(trends_series)
        else:
            trends_series = pd.Series(dtype="int32", name="count")
            initial_timeline_summary_text_from_data_proc = "No publication trend data available to describe."

        # plain stdout prints (will not be captured by the logger handler)

    except Exception as _e_trend_desc:
        import traceback as _tb
        logging.error(f"[TIMELINE] Trend description failed: {_e_trend_desc}\n{_tb.format_exc()}")
        initial_timeline_summary_text_from_data_proc = "Error generating comprehensive trend summary."
        trends_series = pd.Series(dtype="int32", name="count")

    console_only(
        f"initial_timeline_summary_text_from_data_proc.strip():{initial_timeline_summary_text_from_data_proc.strip()}\n\n\ntrend_series:{trends_series}")
    results_so_far[f"{section_step_key}_describe_trends_data_{q_terms}"] = describe_trend_data
    descriptive_data_for_next_llm_step = initial_timeline_summary_text_from_data_proc.strip()

    # 3) Produce the publications bar graph using the provided Plotly function
    timeline_image_path = ""
    fig =None
    try:
        fig = generate_timeline_detailed_plotly(df_full if isinstance(df_full, pd.DataFrame) else pd.DataFrame(),
                                                progress_callback=_callback)
        if fig is not None:
            base_dir = Path(results_so_far.get("base_output_dir") or ".")
            try:
                base_dir.mkdir(parents=True, exist_ok=True)
            except Exception:
                pass
            # stable filename keyed on data signature to help cache
            sig = hashlib.md5(",".join(map(str, trends_series.values.tolist())).encode("utf-8")).hexdigest()[:10] \
                if isinstance(trends_series, pd.Series) and not trends_series.empty else "na"
            png_path = base_dir / f"publications_by_year_{sig}.png"
            try:
                # Plotly static export via Kaleido
                fig.write_image(str(png_path), format="png", width=1500, height=800, scale=2)
                timeline_image_path = str(png_path.resolve())
                _callback(f"Saved timeline bar chart → {timeline_image_path}")
            except Exception as e_plot:
                _callback(f"WARNING: write_image failed ({e_plot}); will not attach image.")
                timeline_image_path = ""
        else:
            _callback("No figure produced by generate_timeline_detailed_plotly; skipping image attachment.")
    except Exception as e:
        logging.exception("generate_timeline_detailed_plotly failed.")
        _callback(f"ERROR: Timeline plot generation failed: {e}")
        timeline_image_path = ""




    # 5) Load any pre-existing structured trends (legacy-aware), persist canonical
    _structured_key = f"{STEP__TIMELINE}_StructuredLLMAnalysisData"

    parsed_structured_trends = results_so_far.get(_structured_key)

    parsed_structured_trends = parsed_structured_trends or {}

    # 6) Persist canonical keys and timeline artifacts
    tl_bucket = results_so_far.setdefault("AI Analyze Publication Timeline", {})
    tl_bucket["descriptive_data_for_next_llm_step"] = descriptive_data_for_next_llm_step
    results_so_far[_structured_key] = parsed_structured_trends


    # 1) Descriptive
    emit_timeline_descriptive_html(
        results_so_far,
        descriptive_text=descriptive_data_for_next_llm_step,  # existing
        section_title=STEP__TIMELINE,  # existing
        preliminary_text=initial_timeline_summary_text_from_data_proc,  # NEW
        df_full=df_full,  # NEW (allows figure generation)
        progress_callback=_callback,  # NEW (optional)
        fig=fig,  # (optional) if you already created it elsewhere
    )



    structured_analysis_result_pkg = get_llm_structured_timeline_analysis(
        overall_topic=overall_topic,
        timeline_data_description=initial_timeline_summary_text_from_data_proc,
        timeline_image_path="",
        ai_provider_key=ai_provider_key,
        model_api_name=model_api_name,
        progress_callback=progress_callback,
        results_so_far=results_so_far,
        read=read,
        section_title=STEP__TIMELINE,
        use_cache=use_cache,
        store_only=store_only,
    )


    emit_timeline_structured_pkg_html(
        results_so_far=results_so_far,
        structured_pkg=structured_analysis_result_pkg,
        section_title=STEP__TIMELINE,
    )

    # --- helpers for monitor blocks (local, tiny) ---
    def _escape(s):
        import html
        try:
            return html.escape(str(s))
        except Exception:
            return str(s)

    def _kv_table(d: dict) -> str:
        if not isinstance(d, dict) or not d: return ""
        import json
        rows = []
        for k, v in d.items():
            vs = json.dumps(v, ensure_ascii=False, indent=2) if isinstance(v, (dict, list)) else str(v)
            rows.append(f"<tr><th>{_escape(k)}</th><td><pre>{_escape(vs)}</pre></td></tr>")
        return "<table class='dataframe'><thead><tr><th>Key</th><th>Value</th></tr></thead><tbody>" + "".join(
            rows) + "</tbody></table>"





    sa_usage = None
    sa_cost = None
    if isinstance(structured_analysis_result_pkg, dict):
        data_blk = structured_analysis_result_pkg.get("data") or {}
        sa_usage = data_blk.get("api_usage")
        sa_cost = data_blk.get("api_cost_usd")

    if isinstance(sa_usage, dict):
        results_so_far[f"{section_step_key}_structured_usage"] = sa_usage
        results_so_far[f"{section_step_key}_structured_cost_usd"] = float(sa_cost or 0.0)
        _callback(
            f"Structured analysis cost: in={sa_usage.get('input_tokens', 0)}, "
            f"out={sa_usage.get('output_tokens', 0)}, usd=${float(sa_cost or 0.0):.4f}"
        )
        _totals_bump(
            {
                "input_tokens": int(sa_usage.get("input_tokens", 0) or 0),
                "output_tokens": int(sa_usage.get("output_tokens", 0) or 0),
                "usd": float(sa_cost or 0.0),
            },
            label="Structured trend analysis",
            meta={"section": section_step_key},
        )
    else:
        # No usage dict available; still record cost if the API returned a dollar estimate.
        if sa_cost is not None:
            _totals_bump(
                {"input_tokens": 0, "output_tokens": 0, "usd": float(sa_cost or 0.0)},
                label="Structured trend analysis (cost-only)",
                meta={"section": section_step_key},
            )

    data_block = structured_analysis_result_pkg.get("data", structured_analysis_result_pkg) \
        if isinstance(structured_analysis_result_pkg, dict) else {}

    parsed_structured_trends = (
            data_block.get("structured_trends")
            or data_block.get("structured_trends_json")
    )
    if isinstance(data_block, dict):
        results_so_far[f"{section_step_key}_StructuredLLMAnalysisHTML"] = (
                data_block.get("initial_draft_html_response")
                or data_block.get("response_html")
                or ""
        )

    if data_block and not data_block.get("error") and parsed_structured_trends:
        if results_so_far is not None:
            results_so_far[f"{section_step_key}_StructuredLLMAnalysisData"] = parsed_structured_trends
        _callback("Successfully received and parsed structured trend data from LLM.")
    else:
        print("error in structured analysis result package:", structured_analysis_result_pkg)
        error_info = str(data_block.get("error", "Unknown error"))
        _callback(
            f"ERROR in Phase 1 (Structured Trend Analysis): {error_info}. "
            "Detailed period-by-period drafting will be skipped."
        )


    can_do_period_specific_drafting = bool(
        parsed_structured_trends and \
        (parsed_structured_trends.get("trend_periods") or parsed_structured_trends.get("TrendPeriods")) and \
        isinstance(parsed_structured_trends.get("preliminary_narrative_draft"), str) and \
        len(parsed_structured_trends.get("preliminary_narrative_draft", "")) > 30
    )

    if can_do_period_specific_drafting:
        _callback("Using multi-stage, period-by-period R0 draft generation.")

        descriptive_data_for_next_llm_step = parsed_structured_trends.get("preliminary_narrative_draft",
                                                                          initial_timeline_summary_text_from_data_proc)

        # print("descriptive_data_for_next_llm_step:\n", descriptive_data_for_next_llm_step)



        initial_draft_func_to_use = _period_by_period_entry

    final_pkg = generate_final_draft(
        initial_draft_func=initial_draft_func_to_use,
        section_step_key=section_step_key,
        df_full=df_full,
        results_so_far=results_so_far,
        ai_provider_key=ai_provider_key,
        model_api_name=model_api_name,
        progress_callback=progress_callback,
        descriptive_data_for_section=descriptive_data_for_next_llm_step,
        note_extraction_item_filter_func=False,
        enable_review_round1=review,
        enable_note_extraction=review,
        enable_review_round2=review,
        note_extraction_sample_size=10,
        use_cache=use_cache,
        store_only=store_only,
        read=read,
        q_terms=q_terms,
        create_zotero_collections=create_zotero_collections

    )

    # fold in any batch totals returned from the period-by-period stage (if present)
    try:
        d = (final_pkg.get("data") or {}) if isinstance(final_pkg, dict) else {}
        bt = d.get("batch_cost_totals")
        if isinstance(bt, dict):
            _totals_bump(bt, label="Timeline batches (all rounds)", meta={"section": section_step_key})
    except Exception:
        pass

    # lightweight totals page in the monitor (optional but useful)
    try:
        totals = results_so_far.get("API_COST_TOTALS", {"input_tokens": 0, "output_tokens": 0, "usd": 0.0})
        ledger = results_so_far.get("API_COST_LEDGER", [])
        totals_html = (
            "<style>.kv{width:100%;border-collapse:collapse;font-size:13px}"
            ".kv th{width:220px;text-align:left;padding:6px 8px;border-bottom:1px solid #ddd}"
            ".kv td{padding:6px 8px;border-bottom:1px solid #eee}</style>"
            "<h2>API Cost Totals — Timeline</h2>"
            "<table class='kv'><tbody>"
            f"<tr><th>Input tokens</th><td>{int(totals.get('input_tokens', 0)):,}</td></tr>"
            f"<tr><th>Output tokens</th><td>{int(totals.get('output_tokens', 0)):,}</td></tr>"
            f"<tr><th>Estimated cost (USD)</th><td>${float(totals.get('usd', 0.0)):.4f}</td></tr>"
            "</tbody></table>"
        )
        from src.core.utils.emits_monitor import _ui_html
        _ui_html(results_so_far, section_title=STEP__TIMELINE, subsection="Preparation",
                 page="cost_totals", html_body=totals_html, kind="html")
    except Exception:
        # last-ditch: stash raw
        results_so_far[f"{STEP__TIMELINE}__Preparation__cost_totals__HTML"] = totals_html

    return final_pkg


def _display_doc_type(raw: str) -> str:
        s = (raw or "").strip()
        if not s:
            return "Unspecified"
        return (
            s.replace("journalArticle", "Article")
             .replace("conferencePaper", "Conf-paper")
             .replace("bookSection", "Book section")
             .replace("webpage", "Web page")
             .replace("document", "Document")
             .replace("preprint", "Preprint")
             .replace("manuscript", "Manuscript")
             .replace("presentation", "Presentation")
             .replace("thesis", "Thesis")
             .replace("report", "Report")
             .replace("book", "Book")
             .capitalize()
        )


import pandas as pd
import re  # Will be used in the R0 draft function
import html  # For escaping
# code to be replaced
def _row_to_item(r, *, keyword: "str | None" = None, features: Optional[Iterable[str]] = None) -> str:
    import html as _html, re

    def _s(v):
        try:
            s = "" if v is None else str(v)
            return "" if s.lower() == "nan" else s.strip()
        except Exception:
            return ""

    # --- core fields ---
    key = _s(r.get("key"))
    title = _s(r.get("title"))
    doc_type = _s(r.get("item_type")) or "Unknown"
    abstract = _s(r.get("abstract"))
    year_safe = _s(r.get("year"))

    # --- build in-text citation strictly from creator_summary + year (fallbacks included) ---
    def _surname_from_creator_summary(cs: str) -> str:
        if not cs:
            return ""
        first = re.split(r"\s*;\s*|\s+and\s+", cs, maxsplit=1)[0].strip()
        if not first:
            return ""
        if "," in first:
            left = first.split(",", 1)[0].strip()
            return left or ""
        toks = [t for t in first.split() if t]
        if not toks:
            return ""
        suffixes = {"jr", "jr.", "sr", "sr.", "ii", "iii", "iv", "v"}
        for t in reversed(toks):
            tl = t.lower().strip(".")
            if tl in suffixes or len(tl) == 1:
                continue
            return t
        return toks[-1]

    creator_summary = _s(r.get("creator_summary"))
    surname_cs = _surname_from_creator_summary(creator_summary)

    if not surname_cs:
        # fallback to authors field if creator_summary unusable
        authors_val = r.get("authors")
        authors_str = "; ".join([_s(a) for a in authors_val if _s(a)]) if isinstance(authors_val, list) else _s(authors_val)
        first = (authors_str.split(";")[0].strip() if authors_str else "")
        if "," in first:
            surname_cs = first.split(",", 1)[0].strip()
        else:
            toks = [t for t in first.split() if t]
            surname_cs = (toks[-1].strip() if toks else "n.a.") or "n.a."

    bib_year = ""
    try:
        bib_year = str(int(year_safe)) if year_safe else ""
    except Exception:
        bib_year = year_safe
    bib = f"({surname_cs}, {bib_year})" if bib_year else f"({surname_cs})"

    # --- tags: ONLY '#theme:...' via _extract_theme_list ---
    theme_tags = []
    try:
        theme_tags.extend(_extract_theme_list(r.get("controlled_vocabulary_terms")))
        theme_tags.extend(_extract_theme_list(r.get("tags")))
    except NameError:
        pass
    seen = set()
    tags_list = []
    for t in theme_tags:
        if t not in seen:
            seen.add(t)
            tags_list.append(t)
    tags_str = "; ".join(tags_list)

    # --- dynamic feature attributes (always include contribution_type; skip abstract/tags as separate attrs) ---
    feat_list = list(features or [])
    for base in ("abstract", "tags", "contribution_type"):
        if base not in feat_list:
            feat_list.append(base)

    data_feature_attrs = []
    for feat in feat_list:
        f = feat.strip().lower()
        if f in ("abstract", "tags"):
            continue
        val = _s(r.get(f))
        if val:
            data_feature_attrs.append(f'data-feature-{_html.escape(f)}="{_html.escape(val)}"')

    # drop empty data-tags altogether
    tags_attr = "" if not tags_str else f' data-tags="{_html.escape(tags_str)}"'

    # --- anchor (visible text must be (Author, Year)) ---
    anchor = (
        f'<a href="{_html.escape(key)}" '
        f'data-key="{_html.escape(key)}" '
        f'data-bib="{_html.escape(bib)}" '
        f'data-doc="{_html.escape(doc_type)}" '
        f'data-abstract="{_html.escape(abstract)}"{tags_attr} '
        f'{" ".join(data_feature_attrs)}'
        f'>{_html.escape(bib)}</a>'
    )

    # --- paragraph body policy ---
    if keyword:
        text_body = _html.escape(keyword)
    else:
        text_body = _html.escape(abstract or title or bib)
        if tags_str:
            text_body = f"{text_body} — {_html.escape(tags_str)}"

    return f"<p>{text_body} {anchor}</p>"

# Default for how many example items to extract per document type for the details dictionary
DEFAULT_MAX_SAMPLES_PER_TYPE_FOR_DETAILS = 3  # You can adjust this
def _summarise_doc_types_and_collect_details(
    df_full: pd.DataFrame,
    *,
    batch_size: int = 20,
    min_items_for_own_section: int = 5,
) -> tuple[str, dict]:
    """
    Build a summary string AND a *batched* details dict for AI generation.

    Rules implemented:
    - Every item is assigned to a doc type bucket (by 'item_type').
    - Doc types with < min_items_for_own_section are merged into "Other Types".
    - Buckets with > batch_size are FIRST split by 'contribution_type',
      then each contribution_type sub-bucket is chunked into batches of <= batch_size.
    - Each batch is a dict with label, contribution_type, items[] (max 20), and count.

    Returns:
        summary_string, details_by_type
            details_by_type = {
                "Article": [
                    {"label": "Article • Empirical • batch 1/3", "contribution_type": "empirical",
                     "count": 20, "items": [ {...}, {...}, ... up to 20 ]},
                    ...
                ],
                "Other Types": [
                    {"label": "Other Types • Mixed • batch 1/2", "contribution_type": "mixed",
                     "count": 20, "items": [ {...}, ... ]}
                ]
            }
    """



    if df_full is None or df_full.empty:
        return "No data available in the provided dataset to analyze document types.", {}

    doc_type_col = "item_type"
    if doc_type_col not in df_full.columns:
        return f"Document type column '{doc_type_col}' not found in the dataset.", {}

    # normalise
    df = df_full.copy()
    df[doc_type_col] = df[doc_type_col].fillna("Unspecified").astype(str)
    total_n = len(df)

    # Count by type
    type_counts = df[doc_type_col].value_counts()
    type_perc = (type_counts / total_n) * 100.0

    # Decide which types get a dedicated section vs "Other Types"
    dedicated_types = [t for t, c in type_counts.items() if c >= min_items_for_own_section]
    other_types = [t for t, c in type_counts.items() if c < min_items_for_own_section]

    # ---- Summary string ---------------------------------------------------
    summary_lines = ["Summary of Document Type Distribution:"]
    # list dedicated types individually
    for t in dedicated_types:
        summary_lines.append(f"- {_display_doc_type(t)}: {type_counts[t]} ({type_perc[t]:.1f}%)")
    # group others
    if other_types:
        other_count = int(type_counts[other_types].sum())
        other_pct = float(type_perc[other_types].sum())
        summary_lines.append(f"- Other Types: {other_count} ({other_pct:.1f}%)")
    summary_string = "\n".join(summary_lines)

    # ---- Build batched details dict --------------------------------------
    details_by_type: dict[str, list[dict]] = {}

    def _chunk(lst, size):
        for i in range(0, len(lst), size):
            yield lst[i : i + size]

    # Helper to batch one bucket (doc-type dataframe), first by contribution_type
    def _batches_for_df(_df: pd.DataFrame, label_prefix: str, include_type_in_item: bool = False):
        ct_col = "contribution_type"
        _df = _df.copy()
        if ct_col not in _df.columns:
            _df[ct_col] = "Unspecified"

        groups = []
        # Split first by contribution_type
        for ct_val, g in _df.groupby(ct_col):
            ct_name = (_safe_str(ct_val) or "Unspecified").strip() or "Unspecified"
            # Convert rows to item dicts
            items_all = [_row_to_item(row) for _, row in g.iterrows()]
            # Chunk into batch_size
            chunks = list(_chunk(items_all, batch_size))
            total_chunks = len(chunks)
            for idx, items in enumerate(chunks, start=1):
                label = f"{label_prefix} • {ct_name} • batch {idx}/{total_chunks}"
                groups.append({
                    "label": label,
                    "contribution_type": ct_name,
                    "count": len(items),
                    "items": items,
                })
        return groups

    # Dedicated types
    for raw_type in dedicated_types:
        disp = _display_doc_type(raw_type)
        df_t = df[df[doc_type_col] == raw_type]
        details_by_type.setdefault(disp, [])
        details_by_type[disp].extend(_batches_for_df(df_t, label_prefix=disp))

    # Others (merged)
    if other_types:
        df_other = df[df[doc_type_col].isin(other_types)]
        # In label we keep "Other Types" and contribution_type buckets inside
        details_by_type["Other Types"] = _batches_for_df(df_other, label_prefix="Other Types")

    return summary_string, details_by_type
def _generate_initial_draft_doc_types_PER_TYPE_ANALYSIS_NESTED(
    *,
    df_full_scope: pd.DataFrame,
    rsf_inner_scope: dict,
    cb_inner_scope,
    apk_inner_scope: str,
    model_api_name_scope: str,
    doc_types_summary_text_outer: str,
    doc_type_details_dict_outer: dict,   # <-- batched structure
    overall_topic_outer: str,
    section_title_outer: str,
    store_only: bool,
    read: bool,
    use_cache: bool,
):
    import html, hashlib
    # Cost accumulator for the whole doc-types section
    _cost = {"input_tokens": 0, "output_tokens": 0, "usd": 0.0}

    def _bump_cost(d):
        if not isinstance(d, dict):
            return
        _cost["input_tokens"] += int(d.get("input_tokens", 0))
        _cost["output_tokens"] += int(d.get("output_tokens", 0))
        c = d.get("cost_usd")
        if c is None and "usd" in d:
            c = d["usd"]
        if c is not None:
            _cost["usd"] += float(c)


    def _sanitize(s: str, default: str = "x") -> str:
        import re as _re
        s = (s or default).strip()
        s = _re.sub(r'[^A-Za-z0-9_.-]+', '_', s)
        return s.strip('_') or default

    def _extract_raw_text(resp) -> str:
        """Robustly extract plain text from call_models read/store responses."""
        if not resp:
            return ""

        def _from_choices(d: dict) -> str:
            # OpenAI-style: {'choices':[{'message':{'content':'...'}}]} or {'choices':[{'text':'...'}]}
            ch = d.get("choices")
            if isinstance(ch, list) and ch:
                out = []
                for c in ch:
                    if isinstance(c, dict):
                        msg = c.get("message") or {}
                        if isinstance(msg, dict) and isinstance(msg.get("content"), str):
                            out.append(msg["content"].strip())
                        elif isinstance(c.get("text"), str):
                            out.append(c["text"].strip())
                return "\n\n".join([t for t in out if t]) or ""

            # Alt shapes sometimes seen
            if isinstance(d.get("content"), str):
                return d["content"].strip()
            if isinstance(d.get("output_text"), str):
                return d["output_text"].strip()
            return ""

        if isinstance(resp, dict):
            if resp.get("raw_text"):
                return str(resp["raw_text"]) or ""
            # try common API shapes
            txt = _from_choices(resp)
            if txt:
                return txt

            # Some readers return a list in 'batch_results'
            br = resp.get("batch_results")
            if isinstance(br, list) and br:
                texts = []
                for r in br:
                    if isinstance(r, dict) and r.get("raw_text"):
                        texts.append(str(r["raw_text"]).strip())
                if texts:
                    return "\n\n".join(texts)

        if isinstance(resp, list):
            texts = []
            for r in resp:
                if isinstance(r, dict):
                    if r.get("raw_text"):
                        texts.append(str(r["raw_text"]).strip())
                    else:
                        t2 = _from_choices(r)
                        if t2:
                            texts.append(t2.strip())
                elif isinstance(r, str):
                    texts.append(r.strip())
            if texts:
                return "\n\n".join(texts)

        return str(resp)

    # --- API cost accumulator (doc-types section) ---
    _cost = {"input_tokens": 0, "output_tokens": 0, "usd": 0.0}
    _batch_cost_seen = set()  # avoid double-counting batch file totals

    def _bump_cost(pkg: dict | None):
        """Add a usage/cost dict into the section accumulator."""
        if not isinstance(pkg, dict):
            return
        _cost["input_tokens"] += int(pkg.get("input_tokens", 0))
        _cost["output_tokens"] += int(pkg.get("output_tokens", 0))
        if pkg.get("cost_usd") is not None:
            _cost["usd"] += float(pkg["cost_usd"])

    cb_inner_scope(
        f"R0 Draft: Starting per-type detailed analysis for '{section_title_outer}' using batched item groups (<=20 each)..."
    )

    total_n = len(df_full_scope) if isinstance(df_full_scope, pd.DataFrame) else 0
    all_prompts_used: list[str] = []
    parts: list[str] = [f"<h2>{html.escape(section_title_outer)} for '{html.escape(overall_topic_outer)}'</h2>"]

    if doc_types_summary_text_outer:
        parts.append(
            "<h3>Overall Distribution</h3>"
            f"<pre style='white-space:pre-wrap;border:1px solid #eee;background:#f9f9f9;padding:6px;'>"
            f"{html.escape(doc_types_summary_text_outer)}</pre>"
        )

    # Prompt template
    specific_prompt_key = "bReview_analyze_specific_doc_type_with_examples"
    prompt_template, model_resolved, max_t, _ ,effort= _get_prompt_details(
        specific_prompt_key, apk_inner_scope, model_api_name_scope
    )
    if "Fallback" in prompt_template or "Error" in prompt_template:
        parts.append("<p style='color:red'><em>Prompt misconfiguration for type-specific analysis.</em></p>")
        return {
            "type": "html_section",
            "data": {
                "response_html": "\n".join(parts),
                "initial_draft_html_response": "\n".join(parts),
                "prompt_sent": "\n".join(all_prompts_used),
                "initial_draft_prompt_sent": "\n".join(all_prompts_used),
                "doc_type_summary_input_str": doc_types_summary_text_outer,
                "doc_type_details_input_dict": doc_type_details_dict_outer,
            },
            "description": f"Initial Draft (Per-Type Batched): {section_title_outer}",
        }

    # Per-type stats for subtitles
    def _type_total_count(type_key: str) -> int:
        batches = doc_type_details_dict_outer.get(type_key) or []
        return sum(b.get("count", 0) for b in batches)

    def _type_stats_str(type_key: str) -> str:
        c = _type_total_count(type_key)
        pct = (100.0 * c / total_n) if total_n else 0.0
        return f"{c} ({pct:.1f}%)"

    analysis_suffix = "bReview_doc_types_analysis_initial"
    base_out_dir = rsf_inner_scope.get("base_output_dir")

    # Cache bucket for batch reads (all types)
    batch_cache_root = rsf_inner_scope.setdefault("ai_doc_types_batch_cache", {})
    batch_cache_for_section = batch_cache_root.setdefault(section_title_outer, {})

    # Helper to run one pass (store or read) over a list of batches
    def process_batch(type_key: str, batches: list, *, do_read: bool = False, do_store: bool = False):
        """Run store or read for all batches of a given doc type; return list of response dicts on read."""
        assert do_read ^ do_store, "process_batch must be called with exactly one of do_read/do_store=True"
        collected = []

        for b_index, batch in enumerate(batches, start=1):
            items = batch.get("items") or []
            if not items:
                continue

            label = batch.get("label", f"{type_key} • batch {b_index}")
            ct = batch.get("contribution_type", "Unspecified")

            # Build examples block
            ex_lines = []
            for i, it in enumerate(items, start=1):
                intext_cit = it.get("intext_citation_apa") or it.get("citation_apa") or ""
                lines = [
                    f"item: {i}",
                    f"intext_citation_apa: {intext_cit}",
                    f"Key: {it.get('key','N/A')}",
                    f"Title: {it.get('title','N/A')}",
                    f"Authors: {it.get('authors','N/A')}",
                    f"Year: {it.get('year','N/A')}",
                ]
                for k in [
                    "attribution_lens_focus", "contribution_type", "controlled_vocabulary_terms", "citations",
                    "epistemology", "evidence_source_base", "framework_model", "method_type", "methods", "ontology"
                ]:
                    v = it.get(k)
                    if v not in (None, "", "None", "nan"):
                        lines.append(f"{k}: {v}")
                if it.get("abstract"):
                    lines.append(f"Abstract: {it['abstract']}")
                lines.append("---")
                ex_lines.append("\n".join(lines))

            examples_block = "\n".join(ex_lines).strip()

            current_prompt = prompt_template.format(
                overall_topic=overall_topic_outer,
                document_type_name=type_key,
                document_type_overall_stats=_type_stats_str(type_key),
                formatted_example_items=examples_block,
                overall_context_from_structured_analysis=(
                    "Per-type batches are built by contribution_type and limited to 20 items each."
                ),
            )
            all_prompts_used.append(f"--- Prompt: {label} ---\n{current_prompt}\n---")

            # Deterministic custom_id per batch
            h = hashlib.md5(current_prompt.encode("utf-8")).hexdigest()[:10]
            custom_id = f"{_sanitize(type_key)}:{_sanitize(ct)}:b{b_index}:{h}"

            # Perform store or read
            if do_store:
                _ = call_models(
                    ai_provider_key=apk_inner_scope,
                    model_api_name=model_resolved,
                    prompt_text=current_prompt,
                    analysis_key_suffix=analysis_suffix,
                    max_tokens=max_t,
                    vision=False,
                    use_cache=False,
                    base_output_dir_for_logs=base_out_dir,
                    store_only=True,
                    read=False,
                    section_title=STEP__TIMELINE,
                    custom_id=custom_id,
                    overall_topic=overall_topic_outer  # new

                )
                # nothing to collect on store pass

            else:  # do_read
                resp = call_models(
                    ai_provider_key=apk_inner_scope,
                    model_api_name=model_resolved,
                    prompt_text=current_prompt,   # parity/logging
                    analysis_key_suffix=analysis_suffix,

                    max_tokens=max_t,
                    vision=False,
                    use_cache=False,
                    base_output_dir_for_logs=base_out_dir,
                    store_only=False,
                    read=True,
                    section_title=STEP__TIMELINE,
                    custom_id=custom_id,
                    overall_topic=overall_topic_outer #new
                )
                # Accumulate batch cost ONCE per read file (helper provides an aggregate summary)
                if isinstance(resp, dict) and resp.get("batch_cost_summary"):
                    _bump_cost(resp["batch_cost_summary"])



                collected.append({
                    "label": label,
                    "custom_id": custom_id,
                    "response": resp,
                    "raw_text": (_extract_raw_text(resp) or "").strip(),
                })

        return collected  # list of dicts (empty for store pass)

    # Iterate by doc type; for each, do store → process → read; render + cache
    for type_key, batches in (doc_type_details_dict_outer or {}).items():
        if not isinstance(batches, list) or not batches:
            continue

        parts.append(f"<h3>{html.escape(type_key)} — {html.escape(_type_stats_str(type_key))}</h3>")

        # 1) STORE pass (queue all requests)
        cb_inner_scope(f"Queuing {len(batches)} batches for '{type_key}' (store_only=True).")
        _ = process_batch(type_key, batches, do_read=False, do_store=True)

        # 2) Trigger batch processing
        try:
            # This should run your batch job and produce the *_output.jsonl file
            ok = _process_batch_for(analysis_key_suffix=analysis_suffix, section_title=STEP__TIMELINE)
            cb_inner_scope(f"Batch runner returned: {ok}")
        except Exception as e:
            ok = False
            cb_inner_scope(f"[ERROR] _process_batch_for failed for '{type_key}': {e}")

        # 3) READ pass (collect responses) if processing succeeded
        read_payloads = []
        # 3b) if processing said OK but nothing was read, note it
        if ok and not read_payloads:
            parts.append("<p><em>No batch outputs found yet for this type; try a subsequent read pass.</em></p>")

        # 4) Render and cache
        cache_list = []

        if ok:
            cb_inner_scope(f"Reading {len(batches)} batch responses for '{type_key}'.")
            read_payloads = process_batch(type_key, batches, do_read=True, do_store=False)


        else:
            cb_inner_scope(f"[WARN] Skipping read for '{type_key}' because processing did not succeed.")
            parts.append("<p><em>Batch was queued but output file was not found/created yet.</em></p>")
            continue  # go to next type

        # 4) Render and cache
        cache_list = []
        for entry in read_payloads:
            parts.append(f"<h4>{html.escape(entry['label'])}</h4>")
            raw = entry.get("raw_text", "") or ""
            if raw:
                parts.extend([f"<p>{html.escape(p.strip())}</p>" for p in raw.splitlines() if p.strip()])
            else:
                parts.append("<p><em>No AI text returned for this batch (output not found yet).</em></p>")

            cache_list.append({
                "label": entry["label"],
                "custom_id": entry["custom_id"],
                "raw_text": raw,
                "model_used": (entry["response"] or {}).get("model_used"),
            })

        # Save to section/type cache
        batch_cache_for_section[type_key] = cache_list

    consolidation_key = "doc_types_consolidation_from_batches"
    cons_prompt_tmpl, cons_model,  cons_max_t, _, effort = _get_prompt_details(
        consolidation_key, apk_inner_scope, model_api_name_scope
    )

    # Flatten per-type cache into a readable block for the LLM
    lines = []
    for tkey, entries in (batch_cache_for_section or {}).items():
        lines.append(f"[[TYPE: {tkey}]]")
        for e in entries:
            label = e.get("label", "batch")
            raw = (e.get("raw_text") or "").strip()
            if raw:
                lines.append(f"--- {label} ---")
                lines.append(raw)
        lines.append("")  # spacer
    per_type_batches_text = "\n".join(lines).strip()

    consolidation_prompt = cons_prompt_tmpl.format(
        overall_topic=overall_topic_outer,
        doc_types_summary=doc_types_summary_text_outer or "",
        per_type_batches_text=per_type_batches_text or "(No batch text available)"
    )


    # Make one Responses call; keep store/read flags aligned with the rest of the pipeline
    cons_resp = call_models(
        ai_provider_key=apk_inner_scope,
        model_api_name=cons_model,
        prompt_text=consolidation_prompt,
        analysis_key_suffix="bReview_doc_types_consolidation",

        max_tokens=cons_max_t,
        store_only=store_only,
        read=read,
        use_cache=use_cache,
        section_title=STEP__TIMELINE,
        overall_topic=overall_topic_outer
    )

    # bump consolidation usage/cost now that cons_resp exists
    if isinstance(cons_resp, dict) and cons_resp.get("usage"):
        one_cost = dict(cons_resp.get("usage", {}))
        one_cost["cost_usd"] = cons_resp.get("cost_usd", 0.0)
        _bump_cost(one_cost)

    # Prefer consolidation prose for the initial draft; keep the per-batch HTML as 'response_html' for traceability
    html_out = "\n".join(parts)
    consolidated_text = (cons_resp or {}).get("raw_text") or ""
    escaped_text = html.escape(consolidated_text)
    escaped_text = escaped_text.replace("\r\n", "\n")
    escaped_text = escaped_text.replace("\n\n", "</p><p>")
    escaped_text = escaped_text.replace("\n", "</p><p>")

    consolidated_html = (
        f"<h3>Document Types</h3>\n<p>{escaped_text}</p>"
        if consolidated_text else html_out
    )

    # Track prompts sent
    all_prompts_used.append(f"--- Prompt: CONSOLIDATION ---\n{consolidation_prompt}\n---")

    api_cost_html = (
        f"<details><summary>API Cost Summary</summary>"
        f"<p><b>Input tokens:</b> {_cost['input_tokens']:,}<br>"
        f"<b>Output tokens:</b> {_cost['output_tokens']:,}<br>"
        f"<b>Total (USD):</b> ${_cost['usd']:.4f}</p></details>"
    )

    return {
        "type": "html_section",
        "data": {
            # Keep the detailed per-batch rendering for review/debug
            "response_html": html_out,
            # But expose a single polished draft to the caller
            "initial_draft_html_response": consolidated_html,
            "prompt_sent": "\n".join(all_prompts_used),
            "initial_draft_prompt_sent": "\n".join(all_prompts_used),
            "doc_type_summary_input_str": doc_types_summary_text_outer,
            "doc_type_details_input_dict": doc_type_details_dict_outer,
            "ai_doc_types_batch_cache": batch_cache_for_section,
            "api_cost_summary_html": api_cost_html,
            "api_cost_summary": {
                "input_tokens": _cost["input_tokens"],
                "output_tokens": _cost["output_tokens"],
                "total_tokens": _cost["input_tokens"] + _cost["output_tokens"],
                "cost_usd": round(_cost["usd"], 6),
            },
        },
        "description": f"Initial Draft (Per-Type Batched + Consolidation): {section_title_outer}",
    }


# Fallback function (signature needs to match the lambda in generate_ai_doc_types_analysis)
def _generate_initial_draft_doc_types_FALLBACK_NESTED(
    store_only: bool,
    read: bool,
    use_cache: bool,
    df_full_scope: pd.DataFrame,
    rsf_inner_scope: dict,
    cb_inner_scope,
    apk_inner_scope: str,
    model_api_name_inner_scope: str,  # Renamed from model_api_name_scope for clarity
    # From outer scope
    doc_types_summary_from_data_proc_outer: str,
    overall_topic_outer: str,
    section_title_outer: str,
    reason_for_fallback_outer: str  # Explicitly pass the reason
):
    cb_inner_scope(
        f"R0 Draft: Using FALLBACK single-pass generation for {section_title_outer}. "
        f"Reason: {reason_for_fallback_outer}"
    )

    r0_package = _generate_initial_draft_figure_analysis(
        df_full=df_full_scope,
        results_so_far=rsf_inner_scope,
        progress_callback=cb_inner_scope,
        ai_provider_key=apk_inner_scope,
        model_api_name=model_api_name_inner_scope,

        # <<< pass the batching/cache flags >>>
        store_only=store_only,
        read=read,
        use_cache=use_cache,

        section_step_key=STEP_AI_DOC_TYPES_ANALYSIS,
        initial_prompt_key="bReview_doc_types_analysis_initial",  # The fallback prompt
        descriptive_data_figure=doc_types_summary_from_data_proc_outer,
        figure_specific_extra_vars={"overall_topic": overall_topic_outer},
    )

    data_from_generic = r0_package.get("data", {})
    final_data_block = {
        "response_html": data_from_generic.get(
            "response_html", f"<p>Fallback R0 for {section_title_outer} failed.</p>"
        ),
        "initial_draft_html_response": data_from_generic.get(
            "response_html", f"<p>Fallback R0 for {section_title_outer} failed.</p>"
        ),
        "prompt_sent": data_from_generic.get("prompt_sent", "N/A for fallback R0."),
        "initial_draft_prompt_sent": data_from_generic.get("prompt_sent", "N/A for fallback R0."),
        "structured_doc_type_info_json": None,
        "raw_llm_response": str(data_from_generic.get("ai_response_raw", "N/A for fallback R0.")),
        "ai_response_raw": data_from_generic.get("ai_response_raw", "N/A for fallback R0."),
        "fallback_reason": reason_for_fallback_outer,
        "original_input_summary_for_fallback": doc_types_summary_from_data_proc_outer,
    }
    r0_package["data"] = final_data_block

    original_desc = r0_package.get("description", section_title_outer)
    r0_package["description"] = f"{original_desc} (Fallback)"

    return r0_package


# Main function updated
def generate_ai_doc_types_analysis(
        df_full: pd.DataFrame,
        results_so_far: dict,
        progress_callback,
        ai_provider_key: str,
        model_api_name: str,
        store_only,
        use_cache,
        read
):
    def _cb(msg):
        if progress_callback: progress_callback(msg)
        logging.info(msg)

    section_step_key = STEP_AI_DOC_TYPES_ANALYSIS
    section_title = "Document Types Analysis"
    _cb(f"--- Orchestrating {section_title} Generation (New Per-Type with Dict) ---")

    overall_topic = results_so_far.get(STEP_LOAD_DATA, {}).get("collection_name_for_title", "the research topic")

    # --- 1. Get summary string AND detailed data dictionary ---
    doc_types_summary_str = None
    doc_type_details_dict = None

    # Use a distinct key for caching this richer package from _summarise_doc_types_and_collect_details
    summary_package_cache_key = "analyzed_doc_types_summary_and_details_package"
    cached_summary_package = results_so_far.get(summary_package_cache_key)

    if cached_summary_package and isinstance(cached_summary_package, dict):
        doc_types_summary_str = cached_summary_package.get("summary_string")
        doc_type_details_dict = cached_summary_package.get("details_by_type")
        _cb("Loaded document type summary and details from cache.")

    if not doc_types_summary_str or not isinstance(doc_type_details_dict, dict):  # Recompute if not fully cached
        doc_types_summary_str, doc_type_details_dict = _summarise_doc_types_and_collect_details(
            df_full=df_full,

        )
        if results_so_far is not None:
            results_so_far[summary_package_cache_key] = {  # Cache the tuple/package
                "summary_string": doc_types_summary_str,
                "details_by_type": doc_type_details_dict
            }
    _cb(f"Document types summary string for R0 process:\n{doc_types_summary_str}")
    # _cb(f"Collected item details for {len(doc_type_details_dict)} document types: {list(doc_type_details_dict.keys())}")

    initial_draft_func_to_use = None
    # This is supplementary context for R1 review; R1 reviews the R0 draft's HTML.
    descriptive_data_for_r1_context = doc_types_summary_str

    can_do_per_type_detailed_drafting = bool(
        doc_types_summary_str and
        doc_type_details_dict and  # Ensure we have the details dictionary
        "No data available" not in doc_types_summary_str and  # Check for "no data" messages
        "column not found" not in doc_types_summary_str and
        "no specific document types" not in doc_types_summary_str.lower() and
        len(doc_type_details_dict) > 0  # Ensure there are types with details
    )

    if can_do_per_type_detailed_drafting:
        _cb("Sufficient document type summary and details found. Proceeding with PER-TYPE detailed R0 draft.")
        initial_draft_func_to_use = lambda df_i, rsf_i, cb_i, apk_i, man_i: \
            _generate_initial_draft_doc_types_PER_TYPE_ANALYSIS_NESTED(
                df_full_scope=df_i,
                rsf_inner_scope=rsf_i,
                cb_inner_scope=cb_i,
                apk_inner_scope=apk_i,
                model_api_name_scope=man_i,
                doc_types_summary_text_outer=doc_types_summary_str,
                doc_type_details_dict_outer=doc_type_details_dict,
                overall_topic_outer=overall_topic,
                section_title_outer=section_title,
                read=read,
                store_only=store_only,
                use_cache=use_cache,
            )

def generate_ai_author_graph_analysis(store_only,read, use_cache, df_full, results_so_far, progress_callback, ai_provider_key, model_api_name):
    top_auth_df = results_so_far.get(STEP_ANALYZE_AUTHORS, {}).get("raw_df_table", pd.DataFrame())
    topic_title = results_so_far.get(STEP_LOAD_DATA, {}).get('collection_name_for_title', 'the topic')
    desc_data = f"Author productivity analysis for '{topic_title}'. "
    if top_auth_df is not None and not top_auth_df.empty:
        desc_data += f"Lead: {top_auth_df.iloc[0].get('Author', 'N/A')} ({top_auth_df.iloc[0].get('Count', 'N/A')} pubs)."
    else:
        desc_data += "No specific top author data available for summary."
    auth_kws_map_data = results_so_far.get(STEP_AI_AUTHOR_FOCUS_KEYWORDS, {}).get("data")
    auth_kws_map_override = auth_kws_map_data if isinstance(auth_kws_map_data, dict) else None
    if auth_kws_map_override: progress_callback(
        f"Author Graph: Using pre-computed author focus KWs for {len(auth_kws_map_override)} items.")
    fig_specific_vars = {
        "author_graph_description": desc_data,
        "top_authors_summary": "Top Authors:\n" + ("\n".join([f"- {r.get('Author')}: {r.get('Count')}" for i, r in
                                                              top_auth_df.head(
                                                                  3).iterrows()]) if top_auth_df is not None and not top_auth_df.empty else "N/A"),
        "coded_notes_summary": "Contextual notes to be integrated after review."
    }


    figure_specific_extra_vars = None
    return generate_final_draft(
        lambda df_full, results_so_far, progress_callback, ai_provider_key, model_api_name: _generate_initial_draft_figure_analysis(df_full=df_full,
        results_so_far=results_so_far,
        ai_provider_key=ai_provider_key,
        model_api_name=model_api_name,
        progress_callback=progress_callback,
        section_step_key=STEP_AI_AUTHOR_GRAPH_ANALYSIS,
        initial_prompt_key="author_graph_content_analysis",
        descriptive_data_figure=desc_data,
        figure_specific_extra_vars=fig_specific_vars,
        store_only=store_only,read=read, use_cache=use_cache
),
        section_step_key=STEP_AI_AUTHOR_GRAPH_ANALYSIS, df_full=df_full, results_so_far=results_so_far, ai_provider_key=ai_provider_key, model_api_name=model_api_name, progress_callback=progress_callback,
        descriptive_data_for_section=desc_data[:1500], items_to_code_map_override=auth_kws_map_override, store_only=store_only, read=read,
            use_cache=use_cache,
        enable_note_extraction=bool(auth_kws_map_override))

def generate_ai_keyword_graph_analysis(store_only,read, use_cache, df_full, results_so_far, progress_callback, ai_provider_key, model_api_name):
    # Guards without altering your logic
    from collections import defaultdict as _dd
    results_so_far = results_so_far or {}
    progress_callback = progress_callback if callable(progress_callback) else (lambda *_args, **_kw: None)

    # Accept either the old or new storage keys for clusters info
    kw_net_data = (
        results_so_far.get(STEP__KEYWORD_COOCCURRENCE_NET)
        or results_so_far.get(f"{STEP__KEYWORD_COOCCURRENCE_NET}_clusters_info")
        or {}
    )

    # Safe nested access (keeps your default string)
    desc_data = ((kw_net_data.get("keyword_clusters_data") or {}).get("summary_text")
                 or "Keyword network details & clusters.")

    items_map_kw_cluster_notes_override = None

    # Cluster search terms result, with type gate preserved
    cluster_terms_result = results_so_far.get(STEP_AI_KEYWORD_CLUSTER_SEARCH_TERMS) or {}
    cluster_search_terms_map = (
        cluster_terms_result.get("data")
        if cluster_terms_result.get("type") == "keyword_cluster_search_terms_map"
        else {}
    )

    raw_clusters_details = (kw_net_data.get("keyword_clusters_data") or {}).get("clusters", [])

    # DataFrame/columns sanity without changing behaviour
    has_df = isinstance(df_full, pd.DataFrame) and hasattr(df_full, "columns")
    has_cols = has_df and ("key" in df_full.columns and "keywords" in df_full.columns)

    if cluster_search_terms_map and raw_clusters_details and has_cols:
        temp_map = _dd(set)
        try:
            df_len = len(df_full)
        except Exception:
            df_len = 0
        df_to_scan_for_kw_notes = df_full.head(100) if df_len > 100 else df_full

        for _, row in df_to_scan_for_kw_notes.iterrows():
            try:
                item_key = row["key"]
            except Exception:
                continue
            item_kws_str = str(row.get("keywords", ""))
            item_kws_set = {k.strip().lower() for k in item_kws_str.split(";") if k.strip()}
            if not item_kws_set:
                continue
            for cluster_info in raw_clusters_details:
                cluster_name = cluster_info.get("name")
                cluster_defining_kws = {k.lower() for k in cluster_info.get("keywords", [])}
                if cluster_name in cluster_search_terms_map and not item_kws_set.isdisjoint(cluster_defining_kws):
                    temp_map[item_key].update(cluster_search_terms_map[cluster_name])

        if temp_map:
            items_map_kw_cluster_notes_override = {k: sorted(v) for k, v in temp_map.items() if v}
            progress_callback(f"KW Graph: Prepared specific note map for {len(items_map_kw_cluster_notes_override)} items.")
        else:
            progress_callback("KW Graph: No items mapped for specific cluster note extraction.")
    else:
        if not cluster_search_terms_map:
            progress_callback("KW Graph: AI-suggested cluster search terms N/A.")
        if not raw_clusters_details:
            progress_callback("KW Graph: Raw cluster details N/A from graph generation.")

    fig_specific_vars = {
        "keyword_graph_description": desc_data,
        "coded_notes_summary_for_keywords": "Notes to be added post-review."
    }

    return generate_final_draft(
        initial_draft_func=lambda df_full, results_so_far, progress_callback, ai_provider_key,
                                  model_api_name: _generate_initial_draft_figure_analysis(
            df_full=df_full,
            results_so_far=results_so_far,
            progress_callback=progress_callback,
            ai_provider_key=ai_provider_key,
            model_api_name=model_api_name,
            section_step_key=STEP_AI_KEYWORD_GRAPH_ANALYSIS,
            initial_prompt_key="bReview_keyword_network_analysis_with_notes",
            descriptive_data_figure=desc_data,
            figure_specific_extra_vars=fig_specific_vars,store_only=store_only,
        read=read,
        use_cache=use_cache,
        ),
        section_step_key=STEP_AI_KEYWORD_GRAPH_ANALYSIS,
        df_full=df_full,
        results_so_far=results_so_far,
        ai_provider_key=ai_provider_key,
        model_api_name=model_api_name,
        progress_callback=progress_callback,
        store_only=store_only,
        read=read,
        use_cache=use_cache,
        descriptive_data_for_section=desc_data,
        items_to_code_map_override=items_map_kw_cluster_notes_override,
        enable_note_extraction=bool(items_map_kw_cluster_notes_override),
    )


# --- Stubs for other new figure analysis functions ---
def generate_ai_affiliations_analysis(store_only,read, use_cache, df_full, results_so_far, progress_callback, ai_provider_key, model_api_name):
    desc = results_so_far.get("top_affiliations_summary_text", "Top affiliations analysis.")

    return generate_final_draft(
        lambda df, rsf, cb, apk, man:
        _generate_initial_draft_figure_analysis(
            initial_prompt_key="bReview_affiliations_analysis_initial",
            df_full=df, results_so_far=rsf, progress_callback=cb, ai_provider_key=apk, model_api_name=man,
                                                                              section_step_key=STEP_AI_AFFILIATIONS_ANALYSIS,
                                                                              store_only=store_only,read=read,use_cache=use_cache,
                                                                              descriptive_data_figure=desc)
        , STEP_AI_AFFILIATIONS_ANALYSIS,
        df_full, results_so_far, ai_provider_key, model_api_name, progress_callback, descriptive_data_for_section=desc,
        enable_note_extraction=False,        store_only=store_only,read=read, use_cache=use_cache
)


def generate_ai_countries_analysis(store_only,read, use_cache, df_full, results_so_far, progress_callback, ai_provider_key, model_api_name):
    desc = results_so_far.get("top_countries_summary_text", "Top countries analysis.")
    return generate_final_draft(
        lambda df, rsf, cb, apk, man: _generate_initial_draft_figure_analysis(
            df_full=df, results_so_far=rsf, progress_callback=cb, ai_provider_key=apk, model_api_name=man,
                                                                              section_step_key=STEP_AI_COUNTRIES_ANALYSIS,
                                                                              store_only=store_only, read=read,
                                                                              use_cache=use_cache,

                                                                              initial_prompt_key="bReview_countries_analysis_initial",
                                                                              descriptive_data_figure=desc), STEP_AI_COUNTRIES_ANALYSIS,
        df_full, results_so_far, ai_provider_key, model_api_name, progress_callback, descriptive_data_for_section=desc,
        enable_note_extraction=False)


def generate_ai_general_keyword_themes_analysis(store_only,read, use_cache, df_full, results_so_far, progress_callback, ai_provider_key,
                                                model_api_name):
    desc = results_so_far.get("general_keywords_summary_text", "Overall keyword themes (wordcloud/top N).")
    return generate_final_draft(
        lambda df, rsf, cb, apk, man: _generate_initial_draft_figure_analysis(
            df_full=df, results_so_far=rsf, progress_callback=cb, ai_provider_key=apk, model_api_name=man,
                                                                              section_step_key=STEP_AI_GENERAL_KEYWORD_THEMES_ANALYSIS,
                                                                              initial_prompt_key="bReview_general_keyword_themes_initial",
                                                                              descriptive_data_figure=desc,
                                                                              store_only=store_only, read=read,
                                                                              use_cache=use_cache,

                                                                              ),
        store_only=store_only, read=read,
        use_cache=use_cache,
        section_step_key=STEP_AI_GENERAL_KEYWORD_THEMES_ANALYSIS, df_full=df_full, results_so_far=results_so_far, ai_provider_key=ai_provider_key, model_api_name=model_api_name,
        progress_callback=progress_callback, descriptive_data_for_section=desc)


def generate_ai_coauthorship_network_analysis(store_only,read, use_cache, df_full, results_so_far, progress_callback, ai_provider_key,
                                              model_api_name):
    desc = results_so_far.get("coauthorship_network_summary_text", "Co-authorship network analysis.")
    return generate_final_draft(
        lambda df, rsf, cb, apk, man: _generate_initial_draft_figure_analysis(
            df_full=df, results_so_far=rsf, progress_callback=cb, ai_provider_key=apk, model_api_name=man,
            store_only=store_only, read=read,
            use_cache=use_cache,
            section_step_key= STEP_AI_COAUTHORSHIP_NETWORK_ANALYSIS,
                                                                              initial_prompt_key="bReview_coauthorship_network_analysis_initial",
                                                                              descriptive_data_figure=desc),
        store_only=store_only, read=read,
        use_cache=use_cache,
        section_step_key=STEP_AI_COAUTHORSHIP_NETWORK_ANALYSIS,
        df_full=df_full, results_so_far=results_so_far, ai_provider_key=ai_provider_key, model_api_name=model_api_name,
        progress_callback=progress_callback, descriptive_data_for_section=desc)


def generate_ai_sources_analysis(store_only,read, use_cache, df_full, results_so_far, progress_callback, ai_provider_key, model_api_name):
    desc = results_so_far.get("top_sources_summary_text", "Top publication sources analysis.")
    return generate_final_draft(
        lambda df, rsf, cb, apk, man: _generate_initial_draft_figure_analysis(
            df_full=df, results_so_far=rsf, progress_callback=cb, ai_provider_key=apk, model_api_name=man,

            store_only=store_only, read=read,
            use_cache=use_cache,
            section_step_key=STEP_AI_SOURCES_ANALYSIS,
                                                                              initial_prompt_key="bReview_sources_analysis_initial", descriptive_data_figure=desc),
        section_step_key=STEP_AI_SOURCES_ANALYSIS,
        store_only=store_only, read=read,use_cache=use_cache, progress_callback=progress_callback,df_full=df_full, results_so_far=results_so_far, ai_provider_key=ai_provider_key, model_api_name=model_api_name,
        descriptive_data_for_section=desc, enable_note_extraction=False)


def generate_ai_citation_table_analysis(store_only,read, use_cache, df_full, results_so_far, progress_callback, ai_provider_key, model_api_name):
    desc = results_so_far.get("top_cited_papers_summary_text", "Top cited papers analysis.")
    return generate_final_draft(
        lambda df, rsf, cb, apk, man: _generate_initial_draft_figure_analysis(
            df_full=df, results_so_far=rsf, progress_callback=cb, ai_provider_key=apk, model_api_name=man,

            store_only=store_only, read=read,
            use_cache=use_cache,
            section_step_key=STEP_AI_CITATION_TABLE_ANALYSIS,
                                                                              initial_prompt_key="bReview_citation_table_analysis_initial",
                                                                              descriptive_data_figure=desc),
        section_step_key=STEP_AI_CITATION_TABLE_ANALYSIS,
        store_only=store_only, read=read, use_cache=use_cache, progress_callback=progress_callback, df_full=df_full,
        results_so_far=results_so_far, ai_provider_key=ai_provider_key, model_api_name=model_api_name,

        descriptive_data_for_section=desc,
        enable_note_extraction=False)


def generate_ai_funders_analysis(
    store_only: bool,
    read: bool,
    use_cache: bool,
    df_full: pd.DataFrame,
    results_so_far: dict,
    progress_callback,
    ai_provider_key: str,
    model_api_name: str,
):
    """
    Orchestrated 2-round section for Top Funders. Writes to batch (store_only) or
    reads from batch (read) when those flags are set; otherwise calls live.
    """
    desc = results_so_far.get("top_funders_summary_text", "Funding organizations analysis.")

    return generate_final_draft(
        initial_draft_func=(
            # Robust to either {df_full,results_so_far,progress_callback,ai_provider_key,model_api_name}
            # or short aliases {df,rsf,cb,apk,man} depending on the caller.
            lambda **kw: _generate_initial_draft_figure_analysis(
                df_full=kw.get("df_full", kw.get("df")),
                results_so_far=kw.get("results_so_far", kw.get("rsf")),
                progress_callback=kw.get("progress_callback", kw.get("cb")),
                ai_provider_key=kw.get("ai_provider_key", kw.get("apk")),
                model_api_name=kw.get("model_api_name", kw.get("man")),

                store_only=kw.get("store_only", store_only),
                read=kw.get("read", read),
                use_cache=kw.get("use_cache", use_cache),

                section_step_key=STEP_AI_FUNDERS_ANALYSIS,
                initial_prompt_key="bReview_funders_analysis_initial",
                descriptive_data_figure=desc,
            )
        ),
        section_step_key=STEP_AI_FUNDERS_ANALYSIS,
        df_full=df_full,
        results_so_far=results_so_far,
        ai_provider_key=ai_provider_key,
        model_api_name=model_api_name,
        progress_callback=progress_callback,

        # ← these three are the ones that were missing
        store_only=store_only,
        read=read,
        use_cache=use_cache,

        descriptive_data_for_section=desc,
        enable_note_extraction=False,
    )

def generate_ai_pdf_content_summary(
    store_only: bool,
    read: bool,
    use_cache: bool,
    df_full: pd.DataFrame,
    results_so_far: dict,
    progress_callback,
    ai_provider_key: str,
    model_api_name: str,
):
    """
    Single-round summary of all extracted PDF notes. Respects batch/cache flags.
    """
    # Gather notes from any step that returned a coded_notes_list
    all_notes = []
    for k, v_dict in (results_so_far or {}).items():
        if isinstance(v_dict, dict) and v_dict.get("type") == "coded_notes_list":
            all_notes.extend(v_dict.get("data", []))
        elif k.endswith("_ExtractedNotesPkg") and isinstance(v_dict, dict) and v_dict.get("type") == "coded_notes_list":
            all_notes.extend(v_dict.get("data", []))

    notes_summary_for_prompt = "No relevant PDF notes extracted for general summary."
    if all_notes:
        parts = ["Highlights from extracted PDF content across various analyses:"]
        for i, note in enumerate(all_notes[:10]):
            parts.append(
                f"- Note (Src:'{note.get('source_title', 'N/A')}', "
                f"KW:'{note.get('keyword_found', '?')}'): "
                f"\"{(note.get('original_paragraph', '...') or '')[:80]}...\""
            )
        if len(all_notes) > 10:
            parts.append(f"...and {len(all_notes) - 10} more notes.")
        notes_summary_for_prompt = "\n".join(parts)

    return _generate_initial_draft_generic(
        store_only=store_only,
        read=read,
        use_cache=use_cache,
        prompt_key_for_initial_draft="bReview_pdf_content_summary_initial",
        section_step_key_for_context=STEP_AI_PDF_CONTENT_SUMMARY,
        df_full=df_full,
        results_so_far=results_so_far,
        progress_callback=progress_callback,
        ai_provider_key=ai_provider_key,
        model_api_name=model_api_name,
        extra_context_vars={"descriptive_data": notes_summary_for_prompt},
    )

def generate_ai_keyword_cluster_search_terms(
        read,
        store_only,
        use_cache,
    overall_topic: str,
    kw_cluster_summary: str,
    df_sample: pd.DataFrame,
    ai_provider_key: str,
    model_api_name: str,
    progress_callback=None,
    results_so_far: dict | None = None,
):
    """
    Creates a prompt asking the LLM to propose full-text search terms for
    each keyword-cluster and parses the JSON map returned by the model.

    ▸ Fixes the KeyError that appeared whenever the template itself
      contained un-escaped braces (the example JSON block).

    ▸ Adds protective escaping for any brace characters in
      user-supplied strings.
    """

    # ───────────────────────────────────────────────────────── helpers
    def _cb(msg: str) -> None:                # progress / log helper
        if progress_callback:
            progress_callback(msg)
        logging.info(msg)
    json_map={
  "Cluster 1: Legal and Temporal Analysis": [
    "temporal orientation",
    "policy engagement",
    "state analysis",
    "legal focus",
    "archival documents",
    "explicit intensity",
    "doctrinal lens",
    "contemporary policy",
    "evidence sources",
    "attribution mechanisms",
    "legal frameworks",
    "state-level focus",
    "evidence-based analysis",
    "policy implications",
    "temporal context",
    "legal doctrines",
    "analysis level",
    "explicit engagement",
    "archival evidence"
  ],
  "Cluster 2: Responsibility and Norm Development": [
    "state responsibility",
    "evidentiary standards",
    "response options",
    "sanction measures",
    "diplomatic responses",
    "kinetic actions",
    "norms development",
    "legal norms",
    "policy norms",
    "cyber operations",
    "international law",
    "normative frameworks",
    "accountability mechanisms",
    "cybersecurity norms",
    "legal accountability",
    "policy responses",
    "evidence requirements",
    "normative standards",
    "state obligations"
  ]
}

    return {
        "type": "keyword_cluster_search_terms_map",
        "data": json_map,  # This is the AI-generated map of ClusterName -> [SearchTerm1, SearchTerm2]
        "description": "AI Suggested Cluster Search Terms",
        "prompt_sent": "cache",
        "raw_llm_response": json_map # Added for traceability
    }
    def _escape_braces(text: str | None) -> str:
        """Double every { or } so .format() does not treat it as a field."""
        if text is None:
            return ""
        return text.replace("{", "{{").replace("}", "}}")

    def _protect_template(raw_tpl: str, allowed_fields: list[str]) -> str:
        """
        Double-escapes *every* brace pair *except* those that wrap the
        placeholders in `allowed_fields`.

          – We temporarily swap each valid placeholder with a sentinel,
            escape the whole template, then restore the sentinels.
        """
        sentinel_map = {
            f"{{{field}}}": f"__PLACEHOLDER_{field.upper()}__"
            for field in allowed_fields
        }
        safe_tpl = raw_tpl
        for ph, sentinel in sentinel_map.items():
            safe_tpl = safe_tpl.replace(ph, sentinel)

        # now escape every remaining brace
        safe_tpl = safe_tpl.replace("{", "{{").replace("}", "}}")

        # bring valid placeholders back
        for ph, sentinel in sentinel_map.items():
            safe_tpl = safe_tpl.replace(sentinel, ph)

        return safe_tpl

    # ───────────────────────────────────────────────────── prompt build
    prompt_key = "bReview_keyword_cluster_search_terms"
    template_raw, model, max_toks , json_schema,effort= _get_prompt_details(
        prompt_key, ai_provider_key,  model_api_name,section_id=section_title,results_so_far=results_so_far
    )

    if "Fallback" in template_raw:
        _cb(f"Warning: Fallback prompt used for {prompt_key}")

    _cb(
        f"AI: Suggesting search terms for KW clusters "
        f"(Model: {model}, Prompt: {prompt_key})..."
    )

    # tiny sample block ---------------------------------------------------------
    samples_str = "No samples."
    if df_sample is not None and not df_sample.empty:
        rows = df_sample.head(min(2, len(df_sample)))
        snippets = []
        for _, r in rows.iterrows():
            snippets.append(
                f"T:{r.get('title', 'N/A')}\n"
                f"A:{(r.get('abstract', '')[:150]) + '...' if r.get('abstract') else 'N/A'}"
            )
        samples_str = "\n---\n".join(snippets)

    # context for .format() ------------------------------------------------------
    context = {
        "overall_topic": _escape_braces(overall_topic),
        "keyword_clusters_summary_text": _escape_braces(kw_cluster_summary),
        "sample_data_context": _escape_braces(samples_str),
    }

    # escape accidental braces *inside the template itself*
    template_safe = _protect_template(
        template_raw,
        allowed_fields=[
            "overall_topic",
            "keyword_clusters_summary_text",
            "sample_data_context",
        ],
    )

    try:
        formatted_prompt = template_safe.format(**context)
    except KeyError as e:
        return {
            "type": "error",
            "data": {
                "prompt_sent": "N/A",
                "error_message": f"Prompt error: {e}",
            },
            "description": f"Prompt Error for {prompt_key}",
        }

    # ──────────────────────────────────────────────── send to the model
    log_dir = results_so_far.get("base_output_dir") if results_so_far else None
    try:
        resp_dict = call_models(store_only=store_only,read=read,
            ai_provider_key=ai_provider_key,
            model_api_name=model,
            prompt_text=formatted_prompt,
            analysis_key_suffix="bRev_kw_cluster_terms",

            max_tokens=max_toks,
            base_output_dir_for_logs=log_dir,
                                overall_topic=overall_topic,

        )

        if resp_dict.get("error"):
            return {
                "type": "error",
                "data": resp_dict,
                "description": "AI Error in Cluster Terms",
            }

        raw_resp = resp_dict.get("raw_text", "{}")


        # ────────────────────────────── try to extract a JSON object/map
        import json, re

        json_map: dict[str, list[str]] = {}
        try:
            # some models wrap the JSON in markdown fences – strip them
            fenced = re.sub(r"```json|```", "", raw_resp).strip()

            # grab the *first* {...} block to be safe
            match = re.search(r"\{\s*\".*", fenced, flags=re.DOTALL)
            json_str = match.group(0) if match else fenced
            json_map = json.loads(json_str)

            if not (
                isinstance(json_map, dict)
                and all(
                    isinstance(v, list) and all(isinstance(x, str) for x in v)
                    for v in json_map.values()
                )
            ):
                raise ValueError("Invalid structure")
        except (json.JSONDecodeError, ValueError) as exc:
            return {
                "type": "error",
                "data": {
                    "prompt_sent": formatted_prompt,
                    "raw_response": raw_resp,
                    "error_message": f"AI non-JSON map: {exc}",
                },
                "description": "AI Format Error Cluster Terms",
            }

        _cb(f"AI suggested search terms for {len(json_map)} clusters.")
        if json_map and df_sample is not None and not df_sample.empty and 'key' in df_sample.columns and 'keywords' in df_sample.columns:
            _cb("Proceeding with note extraction for keyword cluster search terms based on df_sample...")

            # 1. Parse kw_cluster_summary to get defining keywords for each cluster name
            parsed_cluster_definitions = {}  # "Cluster Name": [defining_kw1, defining_kw2,...]
            # Regex to find "Cluster X (Size: Y): keyword1, keyword2, ..."
            # This regex assumes keywords are comma-separated after the colon. Adjust if format differs.
            # Example kw_cluster_summary format assumed:
            # "- Cluster 1 (Size: N): kwA, kwB, kwC\n- Cluster 2 (Size: M): kwD, kwE"
            cluster_pattern = re.compile(r"-\s*(Cluster\s*\d+\b(?:\s*:[^:]+)??)\s*\(Size:\s*\d+\):\s*([^\n]+)",
                                         re.IGNORECASE)

            # Simpler pattern if cluster names are just "Cluster X" from the LLM's output keys
            # If kw_cluster_summary is just text, we need to be more robust.
            # Let's assume kw_cluster_summary provides the defining keywords.
            # The prompt to generate kw_cluster_summary should ensure it's parsable or we need structured input here.

            # For this example, let's refine the parsing based on a plausible format of kw_cluster_summary.
            # Assuming kw_cluster_summary might be like:
            # "Identified Clusters:\nCluster 1: Top terms are X, Y, Z.\nCluster Alpha: Characterized by A, B, C."
            # This is very hard to parse robustly without a fixed format for kw_cluster_summary.

            # Let's try a simplified approach: The keys of json_map ARE the cluster names.
            # We need the *original keywords that formed these clusters* from kw_cluster_summary.
            # Parsing kw_cluster_summary to get defining_kws_per_cluster_name:
            defining_kws_per_cluster_name = {}
            # This example regex assumes a structure like "- Cluster 1 (details): kw1, kw2"
            # or "Cluster Name: kw1, kw2" in the kw_cluster_summary string.
            # This part is FRAGILE and highly dependent on kw_cluster_summary's exact format.
            try:
                for line in kw_cluster_summary.splitlines():
                    match = re.match(r".*?(Cluster\s*\d+(?:\s*:\s*[\w\s-]+)?)\s*(?:\(Size:\s*\d+\))?:\s*(.*)", line,
                                     re.IGNORECASE)
                    if match:
                        cluster_name_from_summary = match.group(1).strip()
                        # Normalize the cluster name from summary to match keys in json_map if possible
                        normalized_name = re.sub(r'\s*:\s*.*', '',
                                                 cluster_name_from_summary).strip()  # "Cluster 1: Main Theme" -> "Cluster 1"

                        defining_kws_str = match.group(2).strip()
                        # Split keywords, assuming comma, semicolon, or "and" as separators, and handling "term:modifier"
                        defining_kws_list = [kw.split(':')[0].strip().lower() for kw in
                                             re.split(r'[,;&]|\s+and\s+', defining_kws_str) if kw.strip()]
                        if normalized_name and defining_kws_list:
                            # Find the corresponding key in json_map (which is the LLM-returned cluster name)
                            # This assumes json_map keys are simple like "Cluster 1", "Cluster 2"
                            for llm_cluster_key in json_map.keys():
                                if normalized_name.lower() in llm_cluster_key.lower() or llm_cluster_key.lower() in normalized_name.lower():
                                    defining_kws_per_cluster_name[llm_cluster_key] = defining_kws_list
                                    _cb(f"Parsed defining KWs for '{llm_cluster_key}': {defining_kws_list[:3]}")
                                    break  # Found a match
            except Exception as e_parse_summary:
                _cb(f"Could not effectively parse defining keywords from kw_cluster_summary: {e_parse_summary}. Note extraction will be less targeted.")

            if not defining_kws_per_cluster_name:
                _cb(f"Warning: Could not parse defining keywords for any cluster from kw_cluster_summary. Notes might not be extracted or might use all terms for all items.")
                # Fallback: apply all generated search terms from all clusters to all items in df_sample if no definitions found.
                # This is broad but ensures some notes are attempted if parsing fails.
                all_ai_generated_search_terms = [term for terms_list in json_map.values() for term in terms_list]
                if not all_ai_generated_search_terms:
                    _cb("No AI-generated search terms to use as fallback. Skipping note extraction.")
                    # Return original success package for keyword terms here, as notes can't be done
                    return {
                        "type": "keyword_cluster_search_terms_map",
                        "data": json_map,  # The AI-generated search terms per cluster
                        "description": "AI Suggested Cluster Search Terms (Note extraction skipped due to parsing issues)",
                        "prompt_sent": formatted_prompt,
                        "raw_llm_response": raw_resp
                    }
                items_to_code_for_notes_map = {
                    item_row['key']: list(set(all_ai_generated_search_terms))
                    for _, item_row in df_sample.iterrows() if item_row.get('key')
                }
                _cb(f"Using fallback: applying all {len(all_ai_generated_search_terms)} AI-generated search terms to {len(items_to_code_for_notes_map)} items in df_sample.")

            else:  # Successfully parsed defining_kws_per_cluster_name
                items_to_code_for_notes_map = {}  # {item_key: [ai_generated_search_terms_for_its_cluster]}
                for _, item_row in df_sample.iterrows():
                    item_key = item_row['key']
                    item_keywords_str = item_row.get('keywords', '')
                    item_kws_set = set(k.strip().lower() for k in str(item_keywords_str).split(';') if k.strip())

                    if not item_kws_set:
                        continue

                    matched_cluster_search_terms = []
                    for cluster_name_key, defining_kws in defining_kws_per_cluster_name.items():
                        if not item_kws_set.isdisjoint(set(defining_kws)):  # Check for intersection
                            if cluster_name_key in json_map:
                                matched_cluster_search_terms.extend(json_map[cluster_name_key])

                    if matched_cluster_search_terms:
                        items_to_code_for_notes_map[item_key] = sorted(list(set(matched_cluster_search_terms)))
                _cb(f"Built specific items_to_code_map for notes: {len(items_to_code_for_notes_map)} items from df_sample matched to clusters.")

            if items_to_code_for_notes_map:
                current_overall_topic = results_so_far.get(STEP_LOAD_DATA, {}).get("collection_name_for_title",
                                                                                   "unknown_collection")
                current_base_output_dir = results_so_far.get("base_output_dir", "output_default")
                notes_section_context_title = "KeywordClusterSearchTermNotes"

                sanitized_collection_name_for_path = re.sub(r'[^\w\-]+', '_', current_overall_topic.strip())[:50]
                sanitized_notes_section_title_for_path = re.sub(r'[^\w\-]+', '_', notes_section_context_title.strip())[
                                                         :50]

                notes_cache_dir = Path(
                    current_base_output_dir) / sanitized_collection_name_for_path / "notes_cache" / sanitized_notes_section_title_for_path
                notes_cache_dir.mkdir(parents=True, exist_ok=True)

                # Hash based on the items_to_code_for_notes_map, as this defines the exact search parameters
                map_str_for_hash = json.dumps(items_to_code_for_notes_map, sort_keys=True)
                cache_hash_input_string = f"section:{notes_section_context_title}|map:{map_str_for_hash}"
                cache_filename_hash_value = hashlib.md5(cache_hash_input_string.encode('utf-8')).hexdigest()
                notes_cache_file_path = notes_cache_dir / f"notes_cache_{cache_filename_hash_value}.json"

                cluster_notes_pkg = None
                if notes_cache_file_path.exists():
                    _cb(f"Found cached notes for cluster search terms at {notes_cache_file_path}. Loading...")
                    try:
                        with open(notes_cache_file_path, 'r', encoding='utf-8') as f_cached_notes:
                            cluster_notes_pkg = json.load(f_cached_notes)
                        _cb(f"Successfully loaded {len(cluster_notes_pkg.get('data', []))} cluster search term notes from cache.")
                    except Exception as e_load_cached_notes:
                        _cb(f"Error loading cached cluster search term notes: {e_load_cached_notes}. Will attempt fresh extraction.")
                        cluster_notes_pkg = None

                if not cluster_notes_pkg:
                    _cb(f"Cache not found or loading failed. Extracting notes for cluster search terms...")
                    zot_client_instance = zot

                    # Filter df_sample to only include keys present in our map
                    items_for_extraction_df = df_sample[
                        df_sample['key'].isin(items_to_code_for_notes_map.keys())].copy()

                    if not items_for_extraction_df.empty:
                        cluster_notes_pkg = extract_content_for_keywords(
                            full_df=items_for_extraction_df,
                            items_to_code_with_keywords_map=items_to_code_for_notes_map,
                            zotero_client_instance=zot_client_instance,
                            globally_suggested_keywords=[],  # Keywords are targeted per item-cluster link
                            progress_callback=_cb
                        )

                        if cluster_notes_pkg and cluster_notes_pkg.get("type") == "coded_notes_list":
                            _cb(f"Cluster search term notes extraction successful ({len(cluster_notes_pkg.get('data', []))} notes). Saving to cache: {notes_cache_file_path}")
                            try:
                                with open(notes_cache_file_path, 'w', encoding='utf-8') as f_save_cache:
                                    json.dump(cluster_notes_pkg, f_save_cache, indent=2)
                            except Exception as e_save_cached_notes:
                                _cb(f"Error saving cluster search term notes to cache: {e_save_cached_notes}")
                        elif cluster_notes_pkg:
                            _cb(f"Cluster search term notes extraction returned package of type '{cluster_notes_pkg.get('type')}'. Details: {cluster_notes_pkg.get('data')}")
                        else:
                            _cb(f"Cluster search term notes extraction did not return a package.")
                    else:
                        _cb(f"No items from df_sample matched for cluster search term note extraction after filtering.")
                        cluster_notes_pkg = {"type": "coded_notes_list", "data": [],
                                             "description": "No df_sample items for cluster search term notes."}

                if cluster_notes_pkg and results_so_far is not None:
                    results_so_far[f"{STEP_AI_KEYWORD_CLUSTER_SEARCH_TERMS}_ExtractedNotesPkg"] = cluster_notes_pkg
                    _cb(f"Cluster search term notes package (type: {cluster_notes_pkg.get('type')}) stored in results_so_far.")
                elif results_so_far is None:
                    _cb("Warning: results_so_far is None. Cannot store cluster search term notes package.")
                else:
                    _cb("No cluster search term notes package was generated/loaded for storage in results_so_far.")
            else:  # if items_to_code_for_notes_map was empty
                _cb("No items from df_sample could be mapped to clusters for note extraction based on kw_cluster_summary.")
        else:  # if json_map or df_sample was unsuitable
            _cb("Skipping note extraction for cluster search terms due to missing json_map, df_sample, or necessary columns ('key', 'keywords').")

        return {
            "type": "keyword_cluster_search_terms_map",
            "data": json_map,  # This is the AI-generated map of ClusterName -> [SearchTerm1, SearchTerm2]
            "description": "AI Suggested Cluster Search Terms",
            "prompt_sent": formatted_prompt,
            "raw_llm_response": raw_resp  # Added for traceability
        }

    except Exception as exc:
        return {
            "type": "error",
            "data": {
                "prompt_sent": formatted_prompt,
                "error_message": f"General error: {exc}",
            },
            "description": "General Error Cluster Terms AI",
        }
#
#
# def generate_ai_author_focus_keywords(top_auth_df: pd.DataFrame, full_df: pd.DataFrame, ai_provider_key: str,
#                                       model_api_name: str, progress_callback=None, results_so_far=None):
#     def _cb(m):
#         if progress_callback:
#             progress_callback(m)
#         logging.info(m)
#
#     _cb("AI: Suggesting focus KWs for top authors using item_key as identifier...")
#     if top_auth_df.empty or full_df.empty:
#         return {"type": "error",
#                 "data": {"prompt_sent": "N/A", "error_message": "Missing top_auth_df or full_df data"},
#                 "description": "Missing data for Author KWs"}
#
#     prompt_key = "author_focus_keyword_generation_custom"  # This now refers to the new prompt
#     prompt_template, model, max_t, json_schema ,effort= _get_prompt_details(prompt_key, ai_provider_key, model_api_name)
#
#     if "Fallback" in prompt_template:  # Check if the specific key was found
#         _cb(f"Warning: Using a fallback or default prompt template for {prompt_key} as it might not be specifically defined with the new 'item_key' structure.")
#         # Define a robust fallback prompt string here if _get_prompt_details doesn't error out but returns a generic fallback
#         # For this example, we'll assume prompt_template is the new one. If not, this would be critical.
#         # A truly robust fallback would be:
#         # prompt_template = "You are an expert research analyst... (rest of the new prompt definition)"
#
#     auth_ctxs = []
#     item_map = {}  # Maps original author name to list of all their Zotero item keys
#     author_block_key_to_name_map = {}  # Maps AuthorBlockKey (a representative item_key) back to original author name
#
#     num_auth_to_process = min(3, len(top_auth_df))  # Process up to 3 authors as in original logic
#     _cb(f"Preparing context for top {num_auth_to_process} authors.")
#
#     authors_processed_for_prompt = 0
#     for _, row in top_auth_df.head(num_auth_to_process).iterrows():
#         name = row.get('Author', 'UnknownAuthor')
#         if name == 'UnknownAuthor':
#             _cb("Skipping an author with an unknown name.")
#             continue
#
#         try:
#             # Using the author's name to find their publications in full_df
#             # Ensure the regex is safe and handles special characters in names if necessary
#             author_name_for_regex = re.escape(str(name).split(',')[0].strip())
#         except Exception as e_regex:
#             _cb(f"Cannot process author name '{name}' for regex: {e_regex}, skipping.")
#             continue
#
#         if 'authors' not in full_df.columns:
#             return {"type": "error",
#                     "data": {"prompt_sent": "N/A", "error_message": "'authors' column missing in full_df"},
#                     "description": "'authors' column missing"}
#
#         # Find publications by this author
#         # Ensure 'authors' column is string type for str.contains
#         pubs = full_df[full_df['authors'].astype(str).str.contains(author_name_for_regex, case=False, na=False)]
#
#         if pubs.empty:
#             _cb(f"No publications found for author '{name}' (regex: '{author_name_for_regex}'), skipping.")
#             continue
#
#         if 'key' not in pubs.columns:  # 'key' should be the Zotero item key
#             _cb(f"Item key column ('key') missing in publications DataFrame for author '{name}', skipping.")
#             continue
#
#         author_publication_keys = pubs['key'].dropna().unique().tolist()
#         if not author_publication_keys:
#             _cb(f"No valid publication keys found for author '{name}', skipping.")
#             continue
#
#         item_map[name] = author_publication_keys  # Store all unique pub keys for this author
#
#         # Use the first publication key as the unique identifier for this author's block in the prompt
#         author_block_identifier_key = author_publication_keys[0]
#
#         # Ensure this identifier key is unique for the map, though it should be if tied to the first pub of distinct authors
#         if author_block_identifier_key in author_block_key_to_name_map:
#             _cb(f"Warning: AuthorBlockKey '{author_block_identifier_key}' already mapped. This might happen if different authors' first pubs (by chance) are the same, or if an author appears multiple times in top_auth_df with overlapping pubs. Skipping this instance for '{name}'.")
#             # Or handle by creating a truly unique ID if needed, but for now, we link it to the author's name
#             # If this author was already processed, we might skip to avoid redundant prompt sections.
#             # However, top_auth_df should ideally list unique authors.
#             continue
#
#         author_block_key_to_name_map[author_block_identifier_key] = name
#
#         ctx_s = f"AuthorBlockKey: {author_block_identifier_key}\nAuthorNameForContext: {name}\nRepresentative Publications:\n"
#         # Include a few representative publications in the context
#         for _, p_row in pubs.head(min(2, len(pubs))).iterrows():  # e.g., top 2 pubs
#             title = p_row.get('title', 'N/A')
#             abstract_full = p_row.get('abstract', '')
#             abstract_snippet = (abstract_full[:250] + '...') if len(abstract_full) > 250 else abstract_full
#             ctx_s += f"  - Title: {title}\n    Abstract Snippet: {abstract_snippet}\n"
#         auth_ctxs.append(ctx_s)
#         authors_processed_for_prompt += 1
#
#     if not auth_ctxs:
#         return {"type": "error",
#                 "data": {"prompt_sent": "N/A",
#                          "error_message": "No valid author publication data to build context for LLM"},
#                 "description": "No pub data for top authors"}
#
#     _cb(f"Generated context for {authors_processed_for_prompt} authors to send to LLM.")
#
#     final_prompt_string = "Error generating prompt"
#     try:
#         final_prompt_string = prompt_template.format(author_data_formatted="\n---\n".join(auth_ctxs))
#     except KeyError as e:
#         _cb(f"KeyError formatting prompt: {e}. Using basic fallback prompt structure.")
#         # This basic fallback should align with the NEW AuthorBlockKey/item_key structure
#         author_data_joined = "\n---\n".join(auth_ctxs)
#         final_prompt_string = (
#             "Suggest 3-5 keywords for each author block based on their representative publications. "
#             f"Input provides 'AuthorBlockKey' and 'AuthorNameForContext'. Output ONLY JSON list of objects: "
#             f"[{{'item_key': 'AuthorBlockKey_value', 'suggested_keywords_for_author': ['kw1', ...]}}].\n"
#             f"Author Data:\n---\n{author_data_joined}\n---\nJSON Output:"
#         )
#
#     log_dir_path = results_so_far.get("base_output_dir") if results_so_far else None
#
#     try:
#         resp_dict = call_models(store_only=store_only,read=read,ai_provider_key, model, final_prompt_string,
#                                 "bRev_auth_focus_kws_itemkey",  # Slightly new log prefix
#                                 temp, max_t, base_output_dir_for_logs=log_dir_path)
#
#         if resp_dict.get("error"):
#             return {"type": "error", "data": resp_dict, "description": "AI Error Author Focus KWs (item_key)"}
#
#         raw_llm_response = resp_dict.get("raw_text", "")
#         parsed_keyword_list = []
#
#         # Enhanced cleaning and parsing logic (as established previously)
#         cleaned_response_text = raw_llm_response
#         markdown_block_match = re.match(r'^\s*```(?:json)?\s*(.*?)\s*```\s*$', raw_llm_response,
#                                         re.DOTALL | re.IGNORECASE)
#         if markdown_block_match:
#             cleaned_response_text = markdown_block_match.group(1).strip()
#             _cb("Extracted content from a single Markdown JSON block.")
#         else:
#             temp_text = re.sub(r'^\s*```(?:json)?\s*\n?', '', raw_llm_response, flags=re.MULTILINE | re.IGNORECASE)
#             cleaned_response_text = re.sub(r'\n?\s*```\s*$', '', temp_text, flags=re.MULTILINE).strip()
#             cleaned_response_text = cleaned_response_text.replace("```", "\n").strip()
#             if cleaned_response_text != raw_llm_response.strip() and not markdown_block_match:
#                 _cb("Cleaned potential multiple Markdown/JSON markers.")
#
#         try:  # Attempt 1: Parse as a single JSON array or object
#             parsed_json_data = json.loads(cleaned_response_text)
#             if isinstance(parsed_json_data, list):
#                 parsed_keyword_list = parsed_json_data
#             elif isinstance(parsed_json_data, dict) and "item_key" in parsed_json_data:  # Expecting item_key now
#                 parsed_keyword_list = [parsed_json_data]
#             else:
#                 raise ValueError("Parsed JSON is not a list or a single expected object with 'item_key'.")
#             _cb(f"Successfully parsed LLM output as a single JSON structure (count: {len(parsed_keyword_list)}).")
#
#         except json.JSONDecodeError as e_json_primary:
#             _cb(f"Could not parse as single JSON (Error: {e_json_primary}). Trying stream parse.")
#             parsed_keyword_list = []
#             object_json_strings = [match.group(1) for match in
#                                    re.finditer(r'(\{.*?\})(?=\s*\{|\s*$)', cleaned_response_text, re.DOTALL)]
#             if not object_json_strings and cleaned_response_text.startswith('{') and cleaned_response_text.endswith(
#                     '}'):
#                 object_json_strings.append(cleaned_response_text)
#
#             if object_json_strings:
#                 _cb(f"Found {len(object_json_strings)} potential JSON objects in stream.")
#                 for obj_s in object_json_strings:
#                     try:
#                         parsed_keyword_list.append(json.loads(obj_s))
#                     except json.JSONDecodeError:
#                         _cb(f"Failed to parse object in stream: {obj_s[:100]}...")
#
#             if not parsed_keyword_list:
#                 _cb("Stream parsing also failed to yield valid JSON objects.")
#                 return {"type": "error", "data": {"prompt_sent": final_prompt_string, "raw_response": raw_llm_response,
#                                                   "error_message": "Failed all JSON parsing attempts."},
#                         "description": "AI KWs: JSON parsing failed completely"}
#
#         # Validation of parsed_keyword_list structure
#         if not isinstance(parsed_keyword_list, list):  # Should be a list by now
#             return {"type": "error", "data": {"prompt_sent": final_prompt_string, "raw_response": raw_llm_response,
#                                               "error_message": "Final parsed data not a list."},
#                     "description": "AI KWs: Final structure not list"}
#
#         final_author_keywords_map = {}  # Maps actual Zotero item keys (of publications) to keywords
#         processed_author_blocks_count = 0
#
#         valid_entries_from_llm = []
#         for entry_idx, entry_data in enumerate(parsed_keyword_list):
#             if isinstance(entry_data,
#                           dict) and "item_key" in entry_data and "suggested_keywords_for_author" in entry_data:
#                 valid_entries_from_llm.append(entry_data)
#             else:
#                 _cb(f"Entry #{entry_idx} from LLM is invalid or missing keys: {str(entry_data)[:100]}")
#
#         if not valid_entries_from_llm and authors_processed_for_prompt > 0:
#             _cb("LLM response parsed, but no valid entries with 'item_key' and 'suggested_keywords_for_author' found.")
#             return {"type": "error", "data": {"prompt_sent": final_prompt_string, "raw_response": raw_llm_response,
#                                               "parsed_data": parsed_keyword_list,
#                                               "error_message": "No valid keyword entries in LLM response."},
#                     "description": "AI KWs: No valid entries"}
#
#         for entry_data in valid_entries_from_llm:
#             returned_author_block_key = entry_data["item_key"]
#             suggested_kws = entry_data["suggested_keywords_for_author"]
#
#             if not isinstance(suggested_kws, list) or not all(isinstance(k, str) for k in suggested_kws):
#                 _cb(f"Invalid keyword structure for block key '{returned_author_block_key}': {suggested_kws}")
#                 continue
#
#             original_author_name = author_block_key_to_name_map.get(returned_author_block_key)
#
#             if original_author_name:
#                 if original_author_name in item_map:
#                     processed_author_blocks_count += 1
#                     # Apply these author-focused keywords to all publications of this author
#                     for actual_publication_key in item_map[original_author_name]:
#                         final_author_keywords_map.setdefault(actual_publication_key, []).extend(suggested_kws)
#                         # Deduplicate keywords for this specific publication
#                         seen_kws = set()
#                         final_author_keywords_map[actual_publication_key] = [
#                             kw for kw in final_author_keywords_map[actual_publication_key] if
#                             not (kw in seen_kws or seen_kws.add(kw))
#                         ]
#                 else:  # Should not happen if logic is correct, means author_block_key_to_name_map had a name not in item_map
#                     _cb(f"Logic Error: Author '{original_author_name}' (from key '{returned_author_block_key}') not in item_map.")
#             else:
#                 _cb(f"LLM returned item_key '{returned_author_block_key}' not found in author_block_key_to_name_map.")
#
#         if not final_author_keywords_map and processed_author_blocks_count == 0 and valid_entries_from_llm:
#             _cb("LLM keywords returned, but item_keys did not match any processed author blocks or no authors processed.")
#             return {"type": "error",
#                     "data": {"prompt_sent": final_prompt_string, "raw_response": raw_llm_response,
#                              "parsed_llm_entries": valid_entries_from_llm,
#                              "error_message": "LLM item_keys mismatched."},
#                     "description": "AI KWs: Item_key mismatch"}
#
#         _cb(f"AI focus KWs for {processed_author_blocks_count} author blocks mapped to publications. Total entries in final_map: {len(final_author_keywords_map)}.")
#         return {"type": "author_keywords_map",
#                 "data": final_author_keywords_map,
#                 "description": "AI Suggested Author Focus Keywords (item_key based)",
#                 "prompt_sent": final_prompt_string,
#                 "raw_llm_response": raw_llm_response,
#                 "llm_parsed_entry_count": len(valid_entries_from_llm)}
#
#     except Exception as e_general:
#         _cb(f"General error in generate_ai_author_focus_keywords: {str(e_general)}\n{traceback.format_exc()}")
#         current_prompt_text = final_prompt_string if 'final_prompt_string' in locals() else "Prompt not fully generated"
#         return {"type": "error",
#                 "data": {"prompt_sent": current_prompt_text, "error_message": f"General error: {str(e_general)}"},
#                 "description": "Error suggesting author KWs (item_key based)"}

# DUMMY_IMAGE_FILENAME_INTEGRATION = r"C:\Users\luano\Downloads\Picture2.png"
#
# # At the end of ai_services.py
#
# if __name__ == "__main__":
#     logging.basicConfig(level=logging.INFO)  # Enable logging to see output
#
#     # --- Configuration for the Vision Test ---
#     # 1. Define a prompt key that exists in your prompts.json
#     #    This prompt should be suitable for a vision task.
#     #    Example: "Please describe this image in detail."
#     #    Or a more complex one using placeholders like {topic}.
#     test_vision_prompt_key = "bReview_timeline_analyze_for_structured_trends"  # MAKE SURE THIS KEY EXISTS IN YOUR JSON
#     # OR CREATE A NEW ONE
#
#     # Ensure PROMPTS_CONFIG is loaded. If it's not, _get_prompt_details will use fallbacks.
#     # For this test, let's manually add a test prompt to PROMPTS_CONFIG if it's not in your file,
#     # or ensure your file has it. This is just for self-contained testing here.
#     # In a real scenario, your prompts.json should be correctly loaded.
#     if test_vision_prompt_key not in PROMPTS_CONFIG:
#         logging.warning(f"'{test_vision_prompt_key}' not in PROMPTS_CONFIG. Adding a temporary test entry.")
#         PROMPTS_CONFIG[test_vision_prompt_key] = {
#             "prompt": "Analyze the provided image. The overall research topic is '{topic}'. What elements in the image are relevant to '{focus_area}'?",
#             "default_model": {"OpenAI": "gpt-4o"},  # Use a vision-capable model
#             "temperature": 0.3,
#             "max_tokens": 500
#         }
#
#     # 2. Specify your AI provider and model (model can be overridden by prompt config)
#     test_ai_provider = "OpenAI"
#     # test_model_api_name = "gpt-4o" # This will be overridden by default_model in PROMPTS_CONFIG if present
#
#     # 3. Path to your test image - REPLACE WITH AN ACTUAL IMAGE PATH ON YOUR SYSTEM
#     #    The user previously specified: DUMMY_IMAGE_FILENAME = r"C:\Users\luano\Downloads\Picture1.png"
#     test_image_path = r"C:\Users\luano\Downloads\Picture2.png" # <--- !!! REPLACE WITH YOUR IMAGE PATH !!!
#
#     # 4. Context variables for formatting the prompt template (if your prompt has placeholders)
#     prompt_context_vars = {
#         "topic": "Bibliometric Analysis of Climate Change Research",
#         "focus_area": "collaboration patterns shown in a graph"
#     }
#     # --- End of Configuration ---
#
#     if not Path(test_image_path).is_file():
#         logging.error(f"Test image not found at: {test_image_path}")
#         logging.error("Please update 'test_image_path' in the script with a valid path to an image.")
#     elif not PROMPTS_CONFIG.get(test_vision_prompt_key):
#         logging.error(f"Test prompt key '{test_vision_prompt_key}' is not configured in PROMPTS_CONFIG.")
#     else:
#         logging.info(f"--- Running Vision Test for call_models using prompt key: {test_vision_prompt_key} ---")
#
#         # a. Get prompt details from PROMPTS_CONFIG
#         prompt_template, model_from_config, temp_from_config, \
#             max_t_from_config, schema_from_config ,effort= _get_prompt_details(
#             prompt_key=test_vision_prompt_key,
#             ai_provider_key=test_ai_provider,
#             # default_model_override=test_model_api_name # Let config decide model
#         )
#
#         if "Fallback" in prompt_template or "Error: Prompt for" in prompt_template:
#             logging.error(f"Failed to load a valid prompt template for key '{test_vision_prompt_key}'. Aborting test.")
#         else:
#             # b. Format the prompt template
#             try:
#                 final_prompt_text = prompt_template.format(**prompt_context_vars)
#             except KeyError as e:
#                 logging.error(f"KeyError formatting prompt template for '{test_vision_prompt_key}': Missing key {e}")
#                 logging.error(f"Template was: {prompt_template}")
#                 final_prompt_text = "Error: Could not format prompt. " + prompt_template  # Send template as is on error
#
#             logging.info(f"Using Model: {model_from_config}, Temp: {temp_from_config}, MaxTokens: {max_t_from_config}")
#             logging.info(f"Formatted Prompt Text for LLM: {final_prompt_text}")
#
#             # c. Call call_models with vision enabled
#             result = call_models(store_only=store_only,read=read,
#                 ai_provider_key=test_ai_provider,
#                 model_api_name=model_from_config,  # Use model from config
#                 prompt_text=final_prompt_text,
#                 analysis_key_suffix="direct_vision_test",
#                 temperature=temp_from_config,  # Use temp from config
#                 max_tokens=max_t_from_config,  # Use max_tokens from config (note: call_models calls it max_tokens)
#                 vision=True,
#                 dynamic_image_path=test_image_path,
#                 base_output_dir_for_logs="./test_api_logs",  # Optional: specify log dir
#                 json_schema=schema_from_config  # Pass schema if defined
#             )
#
#             # d. Print the result
#             logging.info("\n--- Result from call_models (Vision Test) ---")
#             if result.get("error"):
#                 logging.error(f"Error: {result.get('error')}")
#                 logging.error(f"Raw Text: {result.get('raw_text')}")
#                 logging.error(f"Prompt Sent: {result.get('prompt_sent')}")
#                 if "input_payload_sent" in result:  # If using the newer client.responses.create
#                     logging.error(
#                         f"Input Payload Sent: {json.dumps(result.get('input_payload_sent'), indent=2) if not isinstance(result.get('input_payload_sent'), str) else result.get('input_payload_sent')}")
#
#             else:
#                 logging.info(f"Model Used: {result.get('model_used')}")
#                 logging.info(f"Raw Output Text:\n{result.get('raw_text')}")
#
#             logging.info(
#                 f"\nFull Result Dictionary:\n{json.dumps(result, indent=2, default=str)}")  # Use default=str for non-serializable


def _alias_or_none(name):
    try:
        return globals()[name]
    except KeyError:
        return None
from collections import OrderedDict
from typing import Any, Dict, List, Iterable, Optional

# ---- save aliases to existing implementations ----
_impl_generate_ai_doc_types_analysis            = _alias_or_none("generate_ai_doc_types_analysis")
_impl_generate_ai_author_graph_analysis         = _alias_or_none("generate_ai_author_graph_analysis")
_impl_generate_ai_affiliations_analysis         = _alias_or_none("generate_ai_affiliations_analysis")
_impl_generate_ai_countries_analysis            = _alias_or_none("generate_ai_countries_analysis")
_impl_generate_ai_general_keyword_themes_analysis = _alias_or_none("generate_ai_general_keyword_themes_analysis")
_impl_generate_ai_coauthorship_network_analysis = _alias_or_none("generate_ai_coauthorship_network_analysis")
_impl_generate_ai_keyword_graph_analysis        = _alias_or_none("generate_ai_keyword_graph_analysis")
_impl_generate_ai_sources_analysis              = _alias_or_none("generate_ai_sources_analysis")
_impl_generate_ai_citation_table_analysis       = _alias_or_none("generate_ai_citation_table_analysis")
_impl_generate_ai_funders_analysis              = _alias_or_none("generate_ai_funders_analysis")
_impl_generate_ai_pdf_content_summary           = _alias_or_none("generate_ai_pdf_content_summary")
_impl_generate_ai_literature_review_summary     = _alias_or_none("generate_ai_literature_review_summary")
_impl_generate_ai_discussion                    = _alias_or_none("generate_ai_discussion")
_impl_generate_ai_limitations                   = _alias_or_none("generate_ai_limitations")
_impl_generate_ai_introduction                  = _alias_or_none("generate_ai_introduction")
_impl_generate_ai_abstract                      = _alias_or_none("generate_ai_abstract")
_impl_generate_ai_conclusion                    = _alias_or_none("generate_ai_conclusion")

def generate_ai_literature_review_summary(
    df,
    results_so_far,
    progress_callback,
    provider_key: str,
    model_name: str,
    mode: str = "chronological",

):
    """
    Draft an HTML literature review section.
    Mode: "chronological" or "thematic".
    Returns dict with keys: response_html, initial_draft_prompt_sent
    """
    try:
        import pandas as pd
        import textwrap

        n = 0 if df is None else int(getattr(df, "shape", [0])[0] or 0)
        years = []
        if df is not None and "year" in df.columns:
            try:
                years = sorted([int(y) for y in df["year"].dropna().astype(int).tolist()])
            except Exception:
                years = []

        topic = (results_so_far.get("base_topic") or
                 results_so_far.get("research_topic") or
                 results_so_far.get("collection_name_for_title") or
                 (results_so_far.get("STEP_LOAD_DATA", {}) or {}).get("collection_name_for_title") or
                 "literature review topic")

        if mode == "chronological":
            outline = [
                f"<p><strong>Scope.</strong> {n} items on <em>{topic}</em>{' spanning ' + str(min(years)) + ' to ' + str(max(years)) if years else ''}.</p>",
                "<p><strong>Trend.</strong> Periodise the field into initiation, consolidation, and maturation phases. Identify peaks and plateaus.</p>",
                "<p><strong>Milestones.</strong> Highlight cornerstone works and shifts in method, theory, and evidence.</p>",
                "<p><strong>Gaps.</strong> Note blind spots and contested claims.</p>",
            ]
            html_block = "<h3>Chronological Synthesis</h3>" + "\n".join(outline)
        else:
            top_kw = None
            if results_so_far.get("STEP_ANALYZE_KEYWORDS", {}).get("raw_df_table") is not None:
                try:
                    tab = results_so_far["STEP_ANALYZE_KEYWORDS"]["raw_df_table"]
                    top_kw = ", ".join(map(str, tab.head(10).iloc[:, 0].tolist()))
                except Exception:
                    top_kw = None
            outline = [
                f"<p><strong>Scope.</strong> {n} items on <em>{topic}</em>.</p>",
                f"<p><strong>Themes.</strong> {top_kw or 'Thematic clusters derived from co-occurrence graph'}.</p>",
                "<p><strong>Linkages.</strong> Explain how themes relate and where they diverge.</p>",
                "<p><strong>Gaps.</strong> Underdeveloped or conflicting areas.</p>",
            ]
            html_block = "<h3>Thematic Synthesis</h3>" + "\n".join(outline)

        prompt_echo = f"[provider={provider_key} model={model_name} mode={mode}] seed-only – replace with real LLM call if desired"
        return {"response_html": html_block, "initial_draft_prompt_sent": prompt_echo}
    except Exception as e:
        if progress_callback:
            try:
                progress_callback(f"generate_ai_literature_review_summary failed: {e}")
            except Exception:
                pass
        return {"response_html": "<p class='placeholder-text'>[AI summary unavailable]</p>",
                "initial_draft_prompt_sent": f"[error mode={mode}] {e}"}

def generate_ai_thematic_analaysis(
    store_only: bool,
    read: bool,
    use_cache: bool,
    df_full: pd.DataFrame,
    results_so_far: dict,
    progress_callback,
    ai_provider_key: str,
    model_api_name: str,
    q_terms: list[str] | None = None,
        review=False
):
    """
    Orchestrator. If q_terms exist → dispatch to thematic_analaysis_keywords (extract→batch→consolidate),
    else fall back to general keyword-themes single-pass via _generate_initial_draft_figure_analysis.
    Runs Review R1 + R2 via generate_final_draft.
    """
    # sanitize q_terms once
    sentinels = {"none", "n/a", "na", "null", "nil", "-", "—", ""}
    q_terms_clean: list[str] = []
    for t in (q_terms or []):
        s = "" if t is None else str(t).strip()
        if s and s.lower() not in sentinels and s not in q_terms_clean:
            q_terms_clean.append(s)

    section_step_key = STEP_AI_GENERAL_KEYWORD_THEMES_ANALYSIS
    section_title = "Thematic Analysis (query-term guided)"

    if q_terms_clean:
        desc = f"Thematic synthesis guided by query terms: {', '.join(q_terms_clean[:8])}."
        return generate_final_draft(
            initial_draft_func=lambda df, rsf, cb, apk, man: thematic_analaysis_keywords(
                df_full=df,
                results_so_far=rsf,
                progress_callback=cb,
                ai_provider_key=apk,
                model_api_name=man,
                q_terms=q_terms_clean,
                store_only=store_only,
                read=read,
                use_cache=use_cache,
            ),
            section_step_key=section_step_key,
            df_full=df_full,
            results_so_far=results_so_far,
            ai_provider_key=ai_provider_key,
            model_api_name=model_api_name,
            progress_callback=progress_callback,
            descriptive_data_for_section=desc,
            enable_review_round1=True,
            enable_note_extraction=False,   # evidence already curated via consolidation
            enable_review_round2=True,
            note_extraction_sample_size=0,
            store_only=store_only,
            read=read,
            use_cache=use_cache,
        )

    # Otherwise, reuse the generic keyword-themes path
    desc = results_so_far.get("general_keywords_summary_text", "Overall keyword themes (wordcloud/top-N).")
    return generate_final_draft(
        initial_draft_func=lambda df, rsf, cb, apk, man: _generate_initial_draft_figure_analysis(
            df_full=df,
            results_so_far=rsf,
            progress_callback=cb,
            ai_provider_key=apk,
            model_api_name=man,
            section_step_key=section_step_key,
            initial_prompt_key="bReview_general_keyword_themes_initial",
            descriptive_data_figure=desc,
            store_only=store_only,
            read=read,
            use_cache=use_cache,
        ),
        section_step_key=section_step_key,
        df_full=df_full,
        results_so_far=results_so_far,
        ai_provider_key=ai_provider_key,
        model_api_name=model_api_name,
        progress_callback=progress_callback,
        descriptive_data_for_section=desc,
        enable_note_extraction=False,
        enable_review_round1=True,
        enable_review_round2=True,
        note_extraction_sample_size=0,
        store_only=store_only,
        read=read,
        use_cache=use_cache,
    )
def _generate_initial_draft_thematic_keyword(
    *,
    kw_batches: List[Dict[str, List[str]]],         # [{keyword: [HTML batch, ...]}, ...]
    ai_provider_key: str,
    model_api_name: str,
    results_so_far: Optional[dict] = None,
    progress_callback=None,
    use_cache: bool = True,
    section_step_key: str = STEP_AI_GENERAL_KEYWORD_THEMES_ANALYSIS,
) -> Dict[str, Any]:
    """
    Concurrently consolidate each keyword's HTML batches into polished paragraphs using
    `consolidate_revision_payload_batches`, and return an HTML block per keyword.

    Returns:
      {
        "type": "keyword_initial_draft_html",
        "data": { <keyword>: "<p>…</p>…", ... },
        "meta": { <keyword>: {"batch_count": n, "para_estimate": m}, ... },
        "description": "thematic_keyword_html_v1",
      }
    """
    import re
    from concurrent.futures import ThreadPoolExecutor, as_completed
    from typing import Dict, Any, List

    # ── tiny logger/callback shim ────────────────────────────────────────────
    def _cb(msg: str):
        if progress_callback:
            try:
                progress_callback(msg)
            except Exception:
                pass

    def _slug(s: str) -> str:
        return re.sub(r"[^A-Za-z0-9_.-]+", "_", str(s or "")).strip("_") or "kw"

    # optional local context
    section_text_ctx = str(
        (results_so_far or {}).get("current_section_text")
        or (results_so_far or {}).get("section_text")
        or ""
    ).strip()

    # guards
    if not isinstance(kw_batches, list) or not kw_batches:
        return {
            "type": "keyword_initial_draft_html",
            "data": {},
            "meta": {},
            "description": "thematic_keyword_html_v1",
        }

    # build job list
    jobs: List[Dict[str, Any]] = []
    for entry in kw_batches:
        if not isinstance(entry, dict) or not entry:
            continue
        kw, batches = next(iter(entry.items()))
        kw_str = str(kw or "").strip()
        if not kw_str:
            continue
        payloads = list(batches or [])
        ns = f"{section_step_key}_{_slug(kw_str)}"
        rev_text = (
            f"Synthesize thematic evidence for '{kw_str}'. "
            f"Write 2–4 concise academic paragraphs tied to the anchors. Avoid duplication."
        )
        jobs.append({
            "keyword": kw_str,
            "namespace": ns,
            "revision": rev_text,
            "batches": payloads,
        })

    if not jobs:
        return {
            "type": "keyword_initial_draft_html",
            "data": {},
            "meta": {},
            "description": "thematic_keyword_html_v1",
        }

    # worker to consolidate one keyword
    def _do_consolidate(job: Dict[str, Any]) -> Dict[str, Any]:
        kw = job["keyword"]
        ns = job["namespace"]
        rev = job["revision"]
        payloads: List[str] = job["batches"]
        overall_topic = results_so_far.get(STEP_LOAD_DATA, {}).get("collection_name_for_title", "the research topic")

        html_out = ""
        html_out = consolidate_revision_payload_batches(
            section_text=section_text_ctx,
            revision=rev,
            batches=payloads,  # list[str] of HTML batch fragments
            ai_provider_key=ai_provider_key,
            model_api_name=model_api_name,
            results_so_far=results_so_far,
            progress_callback=_cb,
            use_cache=use_cache,
            section_step_key=ns,
            overall_topic=overall_topic,

            # namespace per keyword/section
        ) or ""

        # always emit a monitor card if we have batches (even if html_out == "")
        try:
            para_est = len(re.findall(r"<p[\s>]", "\n".join(payloads)))
            emit_revisions_batches(
                results_so_far=results_so_far,
                revisions_map=[{
                    "keyword": kw,
                    "consolidated_html": html_out or "",
                    "batches": payloads,
                    "revision": rev,
                    "raw_count": para_est,
                }],

                section_title=STEP_AI_GENERAL_KEYWORD_THEMES_ANALYSIS,
            )
        except Exception as _e:
            _cb(f"[WARN] emit_revisions_batches failed for keyword '{kw}': {_e}")

        return {
            "keyword": kw,
            "namespace": ns,
            "html": html_out,
            "batch_count": len(payloads),
            "para_estimate": len(re.findall(r"<p[\s>]", html_out or "")),
        }

    # run concurrently
    data_map: Dict[str, str] = {}
    meta_map: Dict[str, Dict[str, Any]] = {}

    with ThreadPoolExecutor(max_workers=min(8, len(jobs))) as ex:
        fut_map = {ex.submit(_do_consolidate, j): j["keyword"] for j in jobs}
        for fut in as_completed(fut_map):
            res = fut.result()
            kw = res["keyword"]
            data_map[kw] = res.get("html", "") or ""
            meta_map[kw] = {
                "namespace": res.get("namespace", ""),
                "batch_count": res.get("batch_count", 0),
                "para_estimate": res.get("para_estimate", 0),
            }

    return {
        "type": "keyword_initial_draft_html",
        "data": data_map,    # {keyword: "<p>…</p>…"}
        "meta": meta_map,    # counts, namespace used
        "description": "thematic_keyword_html_v1",
    }
def thematic_analaysis_keywords(
    df_full: pd.DataFrame,
    results_so_far: dict,
    progress_callback,
    ai_provider_key: str,
    model_api_name: str,
    *,
    q_terms: list[str],
    store_only: bool = False,
    read: bool = False,
    use_cache: bool = True,
        review=False

):
    """
    Keyword-guided thematic initial draft (single extraction, per-keyword batching):
      1) Call extract_content_for_keywords ONCE with all q_terms.
      2) Build list[{keyword: [HTML payload batch, ...]}] via creating_batches().
      3) Consolidate ALL keywords concurrently via _generate_initial_draft_thematic_keyword (HTML consolidation).
      4) For each keyword, render ONE subsection from the consolidated HTML; fallback to raw batches if empty.
      5) Return a single html_section payload that concatenates all subsections (in the order of q_terms).
    """
    # Local imports only
    import re
    import html as _html
    import logging
    from typing import Dict, Any, List, Optional

    # ── callback shim ────────────────────────────────────────────────────────
    def _cb(msg: str):
        try:
            if progress_callback:
                progress_callback(msg)
        except Exception:
            pass
        try:
            logging.info(msg)
        except Exception:
            pass

    # ── helpers ─────────────────────────────────────────────────────────────
    def _sanitize_terms(terms: Optional[List[str]]) -> List[str]:
        sentinels = {"none", "n/a", "na", "null", "nil", "-", "—", ""}
        out, seen = [], set()
        for t in (terms or []):
            s = "" if t is None else str(t).strip()
            if not s or s.lower() in sentinels:
                continue
            if s not in seen:
                seen.add(s)
                out.append(s)
        return out

    def _slug(s: str) -> str:
        return re.sub(r"[^A-Za-z0-9_.-]+", "_", str(s or "")).strip("_") or "kw"

    # ── setup ────────────────────────────────────────────────────────────────
    terms = _sanitize_terms(q_terms)
    section_step_key = STEP_AI_GENERAL_KEYWORD_THEMES_ANALYSIS
    section_title = "Thematic Analysis (query-term guided)"
    _cb(f"--- Building {section_title} from {len(terms)} query terms ---")

    # ── single extraction for ALL keywords ───────────────────────────────────
    extractor_res: Dict[str, Any] = {"type": "coded_notes_list", "data": []}
    if terms:
        try:
            extractor_res = extract_content_for_keywords(
                full_df=df_full,
                items_to_code_with_keywords_map={},        # scan everything
                zotero_client_instance=zotero_client,
                globally_suggested_keywords=terms,         # ALL q_terms at once
                progress_callback=_cb,
                max_items=None,                            # None → no cap
                cache=True,
            ) or {"type": "coded_notes_list", "data": []}
        except Exception as e:
            _cb(f"[extract] ALL terms failed: {e!r}")
            extractor_res = {"type": "coded_notes_list", "data": []}
    else:
        _cb("[extract] No q_terms provided after sanitization.")

    # ── build requested batches structure via creating_batches() ─────────────
    try:
        kw_batches: List[Dict[str, List[str]]] = creating_batches(
            extractor_res,
            batch_size=8,
            terms_order=terms,
            q_terms_filter=terms,
            progress_callback=_cb,
            zot_client=zotero_client

        )
    except Exception as e:
        _cb(f"[batches] creating_batches failed: {e!r}")
        kw_batches = []

    # expose batches for monitor
    try:
        results_so_far.setdefault("payload", {}).setdefault("keyword_batches", []).extend(kw_batches)
    except Exception:
        pass

    if not kw_batches:
        _cb("[batches] No keyword batches created; returning empty section.")
        return {
            "type": "html_section",
            "data": {
                "initial_draft_html_response": '<p class="placeholder-text">[No keyword batches created]</p>',
                "response_html": '<p class="placeholder-text">[No keyword batches created]</p>',
                "initial_draft_prompt_sent": "[no keyword batches created]",
            },
            "description": section_step_key,
        }

    # ── consolidate ALL keywords concurrently (correct call signature) ──────
    try:
        initial_draft = _generate_initial_draft_thematic_keyword(
            kw_batches=kw_batches,
            ai_provider_key=ai_provider_key,
            model_api_name=model_api_name,
            results_so_far=results_so_far,
            progress_callback=_cb,
            use_cache=use_cache,
            section_step_key=section_step_key,   # namespace base; function will suffix per-keyword internally
        ) or {}
    except Exception as e:
        _cb(f"[consolidate] thematic keyword consolidation failed: {e!r}")
        initial_draft = {}

    # initial_draft is expected as:
    # { "type": "keyword_initial_draft_html",
    #   "data": { <keyword>: "<p>…</p>…" },
    #   "meta": { <keyword>: {...} },
    #   "description": "thematic_keyword_html_v1" }
    html_map: Dict[str, str] = {}
    if isinstance(initial_draft, dict):
        html_map = initial_draft.get("data") or {}

    # ── render ONE subsection per keyword (preserve input order) ────────────
    per_kw_sections: List[str] = []

    # lookup for raw batches in case consolidation is empty
    raw_batches_by_kw: Dict[str, List[str]] = {}
    for d in kw_batches:
        if isinstance(d, dict) and d:
            k, v = next(iter(d.items()))
            raw_batches_by_kw[str(k)] = list(v or [])

    for kw in terms:
        body_html = ""
        if isinstance(html_map, dict):
            body_html = str(html_map.get(kw, "") or "").strip()
        if not body_html:
            # Fallback to raw evidence batches if no consolidated result
            fallback_batches = raw_batches_by_kw.get(kw, [])
            body_html = "\n".join(fallback_batches) if fallback_batches else '<p class="muted">No snippets found.</p>'
        per_kw_sections.append(f'<section data-kw="{_slug(kw)}">\n<h3>{_html.escape(kw)}</h3>\n{body_html}\n</section>')

    final_html = "\n\n".join(per_kw_sections).strip()

    return {
        "type": "html_section",
        "data": {
            "initial_draft_html_response": final_html,
            "response_html": final_html,
            "initial_draft_prompt_sent": "[thematic per-keyword HTML consolidation]",
        },
        "description": section_step_key,
    }

