# src/core/utils/report_generation.py
import json
import logging
from typing import Dict, Any

import pandas as pd
from datetime import datetime
import re
from pathlib import Path
from jinja2 import Environment, FileSystemLoader, select_autoescape, BaseLoader, Template  # Crucial import
import html  # For escaping
# ─── add two std-lib helpers ─────────────────────────────────────────────
import shutil                      # NEW
from urllib.parse import quote     # NEW (for safe img URLs)

# Import constants that might be used as keys in results_so_far
from bibliometric_analysis_tool.core.app_constants  import (
    STEP_LOAD_DATA, STEP_AI_ABSTRACT, STEP_AI_INTRODUCTION,
    STEP_AI_LITERATURE_REVIEW_SUMMARY, STEP_AI_METHODOLOGY_REVIEW,
    STEP_ANALYZE_AUTHORS, STEP_ANALYZE_KEYWORDS, STEP_ANALYZE_CITATIONS,
    STEP__TIMELINE, STEP__COAUTHORSHIP_NET,
    STEP__KEYWORD_COOCCURRENCE_NET, STEP_AI_DISCUSSION,
    STEP_AI_CONCLUSION, STEP_AI_LIMITATIONS,
    STEP_AI_AUTHOR_GRAPH_ANALYSIS, STEP_AI_KEYWORD_GRAPH_ANALYSIS, STEP_AI_TIMELINE_ANALYSIS,
    # Import ALL new STEP_AI_... constants for figure analyses
    STEP_AI_DOC_TYPES_ANALYSIS, STEP_AI_AFFILIATIONS_ANALYSIS, STEP_AI_COUNTRIES_ANALYSIS,
    STEP_AI_GENERAL_KEYWORD_THEMES_ANALYSIS, STEP_AI_COAUTHORSHIP_NETWORK_ANALYSIS,
    STEP_AI_SOURCES_ANALYSIS, STEP_AI_CITATION_TABLE_ANALYSIS, STEP_AI_FUNDERS_ANALYSIS,
    STEP_AI_PDF_CONTENT_SUMMARY,
    TOP_N_DEFAULT, MIN_COAUTH_COLLABORATIONS, REFERENCE_LIMIT
)


def assemble_report_html(df_full, results_so_far, progress_callback=None, theme_name="light"):
    def _callback(msg):
        if progress_callback: progress_callback(msg)
        logging.info(msg)

    _callback(f"Assembling Full HTML Report with theme: {theme_name}...")

    def _flatten_results(rsf: dict) -> dict:
        flat = {}
        for k, v in (rsf or {}).items():
            step_key = k[1] if isinstance(k, tuple) and len(k) >= 2 else k
            flat[step_key] = v
        return flat

    rsf_flat = _flatten_results(results_so_far)

    load_data_info = rsf_flat.get(STEP_LOAD_DATA, {})

    report_topic = load_data_info.get("collection_name_for_title", "N/A")
    generation_date_str = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

    is_dark = theme_name == "dark"
    theme_values = {
        "theme_body_bg": "#282c34" if is_dark else "#fdfdfd",
        "theme_text_color": "#abb2bf" if is_dark else "#333333",
        "theme_h1_color": "#7CB9E8" if is_dark else "#0D47A1",
        "theme_h2_color": "#61afef" if is_dark else "#1A237E",
        "theme_h3_color": "#528bff" if is_dark else "#1E88E5",
        "theme_h4_color": "#4b8cdc" if is_dark else "#42A5F5",
        "theme_link_color": "#61afef" if is_dark else "#1E88E5",
        "theme_link_hover_color": "#82c0ff" if is_dark else "#0D47A1",
        "theme_border_color": "#444851" if is_dark else "#d0d0d0",
        "theme_section_bg": "#21252b" if is_dark else "#ffffff",
        "theme_subsection_border": "#3b4048" if is_dark else "#E3F2FD",
        "theme_table_header_bg": "#2c313a" if is_dark else "#f0f4f8",
        "theme_table_header_text": "#c8cdd3" if is_dark else "#2c3e50",
        "theme_table_row_even_bg": "#252930" if is_dark else "#f9f9f9",
        "theme_table_row_hover_bg": "#323842" if is_dark else "#e6e6fa",
        "theme_figure_bg": "#2c313a" if is_dark else "#ffffff",
        "theme_ai_analysis_bg": "#252930" if is_dark else "#f0f4f8",
        "theme_ai_analysis_border": "#528bff" if is_dark else "#7aa0c2",
        "theme_ai_analysis_text_color": "#dadfe8" if is_dark else "#222",
        "theme_placeholder_text_color": "#777" if is_dark else "#7f8c8d",
        "theme_placeholder_border_color": "#555" if is_dark else "#bdc3c7",
    }

    # --- Prepare Jinja2 Context ---
    template_context = {
        'topic': report_topic,
        'authors_list': results_so_far.get("report_authors", "[Review Author Placeholder]"),
        'affiliation': results_so_far.get("report_affiliation", "[Review Affiliation Placeholder]"),
        'generation_date': generation_date_str,
        'data_source_name': load_data_info.get("data_source_name_for_prompt", "N/A"),
        'date_range': load_data_info.get("date_range", "N/A"),
        'analyzed_docs_count': load_data_info.get("analyzed_docs_count",
                                                  len(df_full) if df_full is not None else "N/A"),
        'total_docs_found': load_data_info.get("total_docs_found", len(df_full) if df_full is not None else "N/A"),
        'ai_models_used': results_so_far.get("ai_models_used_for_report", "N/A"),
        'top_keywords_list_str': ", ".join([
    str(x) for x in (
        (lambda df: (df.head(5)['Keyword'].tolist() if isinstance(df, pd.DataFrame) and 'Keyword' in df.columns else []))
        (rsf_flat.get(STEP_ANALYZE_KEYWORDS, {}).get("raw_df_table"))
    )
]),
        'TOP_N_DEFAULT': TOP_N_DEFAULT,
        'MIN_COAUTH_COLLABORATIONS': MIN_COAUTH_COLLABORATIONS,  # Ensure this is in results_so_far or defined
        'REFERENCE_LIMIT': REFERENCE_LIMIT,  # Ensure this is in results_so_far or defined
        'references_list': rsf_flat.get("references_list_for_template", [])

    }
    template_context.update(theme_values)  # Add all theme variables directly

    # Helper to safely get HTML data from results_so_far for AI sections
    # ------------------------------------------------------------------
    # 1.  Small helper – fetch an AI-generated HTML snippet for a step
    # ------------------------------------------------------------------
    def get_ai_section_html(step_key: str) -> str:
        """
        Fetch AI narrative HTML. If the stored content is Markdown, convert it here.
        """
        raw = (
                results_so_far.get(step_key, {}).get("data", {}).get("response_html")
                or results_so_far.get(step_key, {}).get("data", {}).get("initial_draft_html_response")
                or ""
        )
        if not isinstance(raw, str) or not raw.strip():
            return f'<p class="placeholder-text">[{step_key.replace("STEP_AI_", "").replace("_", " ")} N/A]</p>'

        # If it looks like Markdown rather than HTML, convert.
        import re
        looks_like_md = ("<" not in raw[:200]) and bool(re.search(r"(^|\n)[#>\-\*`]|(\*\*|__)", raw))
        if looks_like_md:
            try:
                import markdown as _md
                return _md.markdown(raw, extensions=["extra", "sane_lists", "tables"])
            except Exception:
                # very small fallback to avoid raw MD in the final HTML
                from html import escape as _esc
                t = raw.replace("\r\n", "\n")
                t = re.sub(r"```(.*?)```", lambda m: f"<pre><code>{_esc(m.group(1))}</code></pre>", t, flags=re.S)
                for i in range(6, 0, -1):
                    t = re.sub(rf"(?m)^{('#' * i)}\s+(.*)$", rf"<h{i}>\1</h{i}>", t)
                t = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", t)
                t = re.sub(r"\*(.+?)\*", r"<em>\1</em>", t)
                t = "\n".join(f"<p>{line}</p>" if not line.startswith("<") else line for line in t.split("\n\n"))
                return t

        return raw

    # ------------------------------------------------------------------
    # 2.  Core narrative sections – single-point assignment to template
    # ------------------------------------------------------------------
    template_context.update({
        'ai_abstract': get_ai_section_html(STEP_AI_ABSTRACT),
        'ai_introduction': get_ai_section_html(STEP_AI_INTRODUCTION),
        'ai_methodology_review': get_ai_section_html(STEP_AI_METHODOLOGY_REVIEW),
        'ai_discussion': get_ai_section_html(STEP_AI_DISCUSSION),
        'ai_conclusion': get_ai_section_html(STEP_AI_CONCLUSION),
        'ai_limitations': get_ai_section_html(STEP_AI_LIMITATIONS),
        'ai_literature_review_summary': get_ai_section_html(STEP_AI_LITERATURE_REVIEW_SUMMARY),
    })

    # ------------------------------------------------------------------
    # 3.  Map every plotting / image-producing step to template vars
    # ------------------------------------------------------------------
    plot_and_analysis_map = {
        # step-key                          → destination vars in template
        STEP__TIMELINE: dict(plot_var='year_trends_plot_html',
                                     caption_var='year_trends_caption',
                                     ai_var='ai_timeline_analysis',
                                     ai_step=STEP_AI_TIMELINE_ANALYSIS),

        "analyzed_doc_types_plot": dict(plot_var='analyzed_doc_types_plot_html',
                                        caption_var='analyzed_doc_types_caption',
                                        ai_var='ai_analyzed_doc_types_analysis',
                                        ai_step=STEP_AI_DOC_TYPES_ANALYSIS),

        f"{STEP_ANALYZE_AUTHORS}_plot": dict(plot_var='top_authors_plot_html',
                                             caption_var='top_authors_caption',
                                             ai_var='ai_author_graph_analysis',
                                             ai_step=STEP_AI_AUTHOR_GRAPH_ANALYSIS),

        "top_affiliations_plot": dict(plot_var='top_affiliations_plot_html',
                                      caption_var='top_affiliations_caption',
                                      ai_var='ai_top_affiliations_analysis',
                                      ai_step=STEP_AI_AFFILIATIONS_ANALYSIS),

        "top_countries_plot": dict(plot_var='top_countries_plot_html',
                                   caption_var='top_countries_caption',
                                   ai_var='ai_top_countries_analysis',
                                   ai_step=STEP_AI_COUNTRIES_ANALYSIS),

        "keyword_wordcloud_plot": dict(plot_var='keyword_wordcloud_plot_html',
                                       caption_var='keyword_wordcloud_caption',
                                       ai_var=None, ai_step=None),

        f"{STEP_ANALYZE_KEYWORDS}_plot": dict(plot_var='top_keywords_plot_html',
                                              caption_var='top_keywords_caption',
                                              ai_var='ai_keyword_analysis',
                                              ai_step=STEP_AI_GENERAL_KEYWORD_THEMES_ANALYSIS),

        STEP__COAUTHORSHIP_NET: dict(plot_var='coauthorship_network_plot_html',
                                             caption_var='coauthorship_network_caption',
                                             ai_var='ai_coauthorship_network_analysis',
                                             ai_step=STEP_AI_COAUTHORSHIP_NETWORK_ANALYSIS),

        STEP__KEYWORD_COOCCURRENCE_NET
        : dict(plot_var='keyword_cooccurrence_network_plot_html',
               caption_var='keyword_cooccurrence_network_caption',
               ai_var='ai_keyword_cooccurrence_network_analysis',
               ai_step=STEP_AI_KEYWORD_GRAPH_ANALYSIS),

        "top_sources_plot": dict(plot_var='top_sources_plot_html',
                                 caption_var='top_sources_caption',
                                 ai_var='ai_top_sources_analysis',
                                 ai_step=STEP_AI_SOURCES_ANALYSIS),

        "top_funders_plot": dict(plot_var='top_funders_plot_html',
                                 caption_var='top_funders_caption',
                                 ai_var='ai_top_funders_analysis',
                                 ai_step=STEP_AI_FUNDERS_ANALYSIS),
    }

    # ------------------------------------------------------------------
    # 4.  Iterate over every possible figure / image and populate context
    # ------------------------------------------------------------------
    fig_counter = 1
    from difflib import SequenceMatcher
    from urllib.parse import quote

    def _norm_key(s: str) -> str:
        s = (s or "").lower().strip()
        # remove very weak tokens that ruin similarity
        for t in ("plot", "figure", "fig", "graph", "plotly", "network", "chart", "_html", "_plot", "_div"):
            s = s.replace(t, " ")
        return " ".join(s.split())

    def _first_html(pkg: dict) -> str | None:
        if not isinstance(pkg, dict):
            return None
        # 1) explicit html fragment commonly saved by your steps
        v = pkg.get("data_html_fragment")
        if isinstance(v, str) and "<" in v:
            return v
        # 2) type marker + usual keys
        if pkg.get("type") == "plotly_html_summary":
            for k in ("data", "plot_html", "html", "plot_div"):
                v = pkg.get(k)
                if isinstance(v, str) and "<" in v:
                    return v
                if isinstance(v, dict):
                    cand = v.get("div") or v.get("html") or v.get("plot_html")
                    if isinstance(cand, str) and "<" in cand:
                        return cand
        # 3) common raw keys
        for k in ("plot_html", "html", "plot_div"):
            v = pkg.get(k)
            if isinstance(v, str) and "<" in v:
                return v
            if isinstance(v, dict):
                cand = v.get("div") or v.get("html") or v.get("plot_html")
                if isinstance(cand, str) and "<" in cand:
                    return cand
        # 4) nested under data.*
        if isinstance(pkg.get("data"), dict):
            v = pkg["data"]
            cand = v.get("plot_html") or v.get("html") or v.get("plot_div")
            if isinstance(cand, str) and "<" in cand:
                return cand
        return None



    def _image_to_img_tag(pd_pkg: dict, base_out: str | Path) -> str | None:
        try:
            img_key = "image_file_path" if isinstance(pd_pkg.get("image_file_path"), (str, Path)) else \
                "image_path" if isinstance(pd_pkg.get("image_path"), (str, Path)) else None
            if not img_key:
                return None
            img_path = Path(str(pd_pkg[img_key])).expanduser()
            if img_path.exists():
                # Inline as base64 so the image survives anywhere (HTML/DOCX/PDF)
                import base64
                ext = img_path.suffix.lower()
                mime = "image/png" if ext == ".png" else "image/jpeg" if ext in {".jpg", ".jpeg"} \
                    else "image/svg+xml" if ext == ".svg" else "application/octet-stream"
                with open(img_path, "rb") as f:
                    b64 = base64.b64encode(f.read()).decode("ascii")
                alt_text = html.escape(pd_pkg.get("description", "Figure"))
                return f'<img src="data:{mime};base64,{b64}" alt="{alt_text}" />'
            return None
        except Exception as e:
            _callback(f"Warning: failed to embed static image: {e}")
            return None

    def _fuzzy_fetch_pkg(target_key: str, rsf: dict, need_plot_like: bool = True) -> tuple[str, dict]:
        """
        Find the best key in results dict for a requested target.
        When need_plot_like=True, avoid 'AI Analyze ...' narrative-only packages.
        """
        target_norm = _norm_key(target_key)
        best_k, best_score = None, -1.0

        for k, v in rsf.items():
            if not isinstance(v, dict):
                continue
            k_norm = _norm_key(str(k))
            # skip obvious AI-only packages if we need plots
            if need_plot_like and (str(k).startswith("AI ") or "InitialDraftFullPkg" in str(k)):
                continue
            score = SequenceMatcher(a=target_norm, b=k_norm).ratio()
            # small boost if this candidate actually looks like a plot bundle
            if need_plot_like and isinstance(v, dict) and any(
                    kk in v for kk in
                    ("data_html_fragment", "figure", "plotly_fig", "image_file_path", "plot_html", "html")
            ):
                score += 0.05
            if score > best_score:
                best_k, best_score = k, score

        # Fall back to exact target if present
        if target_key in rsf:
            best_k = target_key
            best_score = 1.0

        if best_k is None:
            return target_key, {}
        if best_k != target_key:
            _callback(f"Report: matched '{target_key}' → '{best_k}' (score={best_score:.2f}).")
        return best_k, rsf.get(best_k, {})

    for step_key, map_info in plot_and_analysis_map.items():
        resolved_key, plot_data_pkg = _fuzzy_fetch_pkg(step_key, rsf_flat, need_plot_like=True)
        pd_pkg = plot_data_pkg if isinstance(plot_data_pkg, dict) else {}

        # visibility: what did we actually receive?
        _callback(
            f"Report: keys for '{resolved_key}': {list(pd_pkg.keys())}; data.keys: {list(pd_pkg.get('data', {}).keys() if isinstance(pd_pkg.get('data'), dict) else [])}")

        plot_html = None

        # 1) try direct html fragments first (what your steps often save)
        plot_html = None
        for k in ("figure", "plotly_fig", "fig"):
            if k in pd_pkg and pd_pkg[k] is not None:
                try:
                    plot_html = pd_pkg[k].to_html(full_html=False, include_plotlyjs=False)
                    break
                except Exception as e:
                    _callback(f"Warning: failed to render Plotly figure for '{resolved_key}' ({k}): {e}")

        # 2) then prefer image files (now inlined as base64 to avoid broken paths)
        if plot_html is None:
            base_out = rsf_flat.get("base_output_dir", ".")
            plot_html = _image_to_img_tag(pd_pkg, base_out)

        # 3) finally fall back to stored HTML fragments (data_html_fragment/plot_html/html/plot_div)
        if plot_html is None:
            plot_html = _first_html(pd_pkg)

        # 4) FINAL FALLBACKS (section-specific)
        if plot_html is None and step_key == "analyzed_doc_types_plot":
            # synthesize a bar chart from df_full['item_type'] if available
            try:
                import plotly.express as px
                if df_full is not None:
                    doc_type_col_candidates = ["item_type", "itemType", "document_type", "doc_type", "type"]
                    dt_col = next((c for c in doc_type_col_candidates if c in df_full.columns), None)
                    if dt_col:
                        vc = df_full[dt_col].fillna("Unspecified").astype(str).value_counts().reset_index()
                        vc.columns = ["Type", "Count"]
                        if not vc.empty:
                            fig = px.bar(vc.head(20), x="Type", y="Count", title="Analyzed Document Types")
                            plot_html = fig.to_html(full_html=False, include_plotlyjs=False)

            except Exception as e:
                _callback(f"Warning: fallback doc-types plot failed: {e}")

        # 5) store into template context
        template_context[map_info['plot_var']] = plot_html

        # Caption bookkeeping
        default_caption_title = (
            map_info['caption_var']
            .replace("_caption", "")
            .replace("top_", "")
            .replace("_plot", "")
            .replace("_html", "")
            .replace("_", " ")
            .title()
        )
        if plot_html:
            template_context[map_info['caption_var']] = (
                f"<strong>Figure {fig_counter}.</strong> "
                f"{pd_pkg.get('description', default_caption_title)}."
            )
            # Optional paired AI analysis for this figure
            if map_info.get('ai_var') and map_info.get('ai_step'):
                template_context[map_info['ai_var']] = get_ai_section_html(map_info['ai_step'])
        else:
            # if we truly have nothing to show, keep placeholder + clear any paired AI note
            if map_info.get('ai_var'):
                template_context[map_info['ai_var']] = None
            template_context[map_info['caption_var']] = (
                f"<strong>Figure {fig_counter}.</strong> ({default_caption_title} – Data N/A)."
            )

        fig_counter += 1
    templates_dir = Path(__file__).resolve().parents[1] / "templates"
    print("templates")
    print(templates_dir)

    # Prefer one of the candidate filenames; fall back if not found
    candidate_templates = ["bibliiographuc.html", "bibliographic.html"]
    template_name = None
    for _name in candidate_templates:
        if (templates_dir / _name).exists():
            template_name = _name
            break

    if not template_name:
        # Hard fallback: emit a simple inline HTML
        _callback("WARNING: No report template found in templates/. Returning a minimal HTML stub.")
        minimal = f"""<!DOCTYPE html><html><head><meta charset='utf-8'><title>Report</title></head>
           <body><h1>Bibliometric Review: {template_context.get('topic', 'N/A')}</h1>
           <p>[No template found in {templates_dir} — showing minimal output]</p></body></html>"""
        return minimal

    env = Environment(
        loader=FileSystemLoader(str(templates_dir)),
        autoescape=select_autoescape(["html", "htm", "xml"])
    )
    try:
        template = env.get_template(template_name)
        rendered_html = template.render(**template_context)  # <-- fixed to use template_context
    except Exception as e_render:
        _callback(f"ERROR: Failed to render template '{template_name}': {e_render}")
        rendered_html = f"""<!DOCTYPE html><html><head><meta charset='utf-8'><title>Report Render Error</title></head>
           <body><h1>Bibliometric Review: {template_context.get('topic', 'N/A')}</h1>
           <pre style="white-space:pre-wrap">{html.escape(str(e_render))}</pre></body></html>"""

    return rendered_html



# create_html_table and format_reference_html functions remain the same as user provided
def create_html_table(df_series_or_df, title, add_rank_col=True):
    if isinstance(df_series_or_df, pd.Series):
        df = df_series_or_df.reset_index();
        df.columns = [str(df_series_or_df.name) or 'Item', 'Count']
    elif isinstance(df_series_or_df, pd.DataFrame):
        df = df_series_or_df.copy();
        df.columns = [str(col) for col in df.columns]
    else:
        return f"<p><i>Error: Invalid data type for table '{title}'.</i></p>"
    if df.empty: return f"<h3>{title}</h3><p><i>No data available for this table.</i></p>"
    if add_rank_col and 'Rank' not in df.columns: df.insert(0, 'Rank', range(1, len(df) + 1))
    return f"<h3>{title}</h3>{df.to_html(index=False, classes='dataframe data-table', escape=False)}"


def format_reference_html(row_dict):
    authors = row_dict.get('authors', 'N/A') if pd.notna(row_dict.get('authors')) else 'N/A'
    year = row_dict.get('year', 'N/A') if pd.notna(row_dict.get('year')) else 'N/A'
    title_text = row_dict.get('title', 'N/A') if pd.notna(row_dict.get('title')) else 'N/A'
    journal = row_dict.get('journal', '') if pd.notna(row_dict.get('journal')) else ''
    year_str = str(int(year)) if isinstance(year, (float, int)) and pd.notna(year) else str(year)
    return f"{authors} ({year_str}). <strong>{html.escape(title_text)}</strong>. <em>{html.escape(journal)}</em>."





# ___________________________________________________________________________________________________________
def _load_template_text_literature(template_path: str | Path | None = None) -> str:
    if template_path and Path(template_path).exists():
        return Path(template_path).read_text(encoding="utf-8")
    # Fallback embedded template identical to src/templates/literature_review.html
    return """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Literature Review: {{ topic | default('N/A') }}</title>
  <style>
    :root{
      --body-bg: {{ theme_body_bg | default('#fdfdfd') }};
      --text-color: {{ theme_text_color | default('#333') }};
      --h1-color: {{ theme_h1_color | default('#0D47A1') }};
      --h2-color: {{ theme_h2_color | default('#1A237E') }};
      --h3-color: {{ theme_h3_color | default('#1E88E5') }};
      --h4-color: {{ theme_h4_color | default('#42A5F5') }};
      --link-color: {{ theme_link_color | default('#1E88E5') }};
      --link-hover: {{ theme_link_hover_color | default('#0D47A1') }};
      --border: {{ theme_border_color | default('#d0d0d0') }};
      --section-bg: {{ theme_section_bg | default('#fff') }};
      --subsection-border: {{ theme_subsection_border | default('#E3F2FD') }};
      --table-header-bg: {{ theme_table_header_bg | default('#f0f4f8') }};
      --table-header-text: {{ theme_table_header_text | default('#2c3e50') }};
      --row-even: {{ theme_table_row_even_bg | default('#f9f9f9') }};
      --row-hover: {{ theme_table_row_hover_bg | default('#e6e6fa') }};
      --figure-bg: {{ theme_figure_bg | default('#fff') }};
      --placeholder-text: {{ theme_placeholder_text_color | default('#7f8c8d') }};
      --placeholder-border: {{ theme_placeholder_border_color | default('#bdc3c7') }};
    }
    html,body{margin:0;padding:0}
    body{font-family:"Georgia","Times New Roman",Times,serif;line-height:1.75;color:var(--text-color);background:var(--body-bg);max-width:900px;margin:0 auto;padding:30px}
    h1,h2,h3,h4{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Oxygen-Sans,Ubuntu,Cantarell,"Helvetica Neue",sans-serif;font-weight:600;line-height:1.25;margin:0 0 .8em}
    h1{color:var(--h1-color);font-size:2.2rem;text-align:center;margin-top:0}
    h2{color:var(--h2-color);font-size:1.75rem;border-bottom:2px solid var(--h2-color);padding-bottom:10px;margin-top:2rem}
    h3{color:var(--h3-color);font-size:1.35rem;border-bottom:1px solid var(--h3-color);padding-bottom:6px;margin-top:1.5rem}
    h4{color:var(--h4-color);font-size:1.1rem;margin-top:1.1rem}
    p{margin:.9em 0;text-align:justify}
    a{color:var(--link-color);text-decoration:none}
    a:hover{color:var(--link-hover);text-decoration:underline}
    .metadata-block{text-align:center;font-size:.95rem;color:#666;border-bottom:1px solid var(--border);padding-bottom:1rem;margin-bottom:2rem}
    .metadata-block p{margin:.3em 0}
    .report-section{margin-bottom:2rem}
    .sub-section{border-left:4px solid var(--subsection-border);padding-left:14px;margin:1.2rem 0}
    figure{background:var(--figure-bg);border:1px solid var(--border);box-shadow:0 3px 6px rgba(0,0,0,.07);padding:14px;margin:1.2rem auto;max-width:100%}
    .plot-container{width:100%;overflow-x:auto}
    .plot-container > div,.plot-container > iframe{border:1px solid var(--border);margin:0 auto!important}
    figure img{max-width:100%;height:auto;display:block;margin:0 auto 10px;border:1px solid var(--border)}
    figcaption{font-size:.9rem;opacity:.9}
    table.data-table{width:100%;border-collapse:collapse;margin:1.2rem 0;font-size:.95rem;border:1px solid var(--border)}
    table.data-table th,table.data-table td{border:1px solid var(--border);padding:10px 12px;vertical-align:top}
    table.data-table th{background:var(--table-header-bg);color:var(--table-header-text)}
    table.data-table tr:nth-child(even){background:var(--row-even)}
    table.data-table tr:hover{background:var(--row-hover)}
    .placeholder-text{font-style:italic;color:var(--placeholder-text);border:1px dashed var(--placeholder-border);background:var(--section-bg);padding:14px;text-align:center}
    @media print{a{text-decoration:none}.metadata-block{page-break-after:avoid}figure{page-break-inside:avoid}}
    .mode-badge{display:inline-block;padding:4px 8px;border:1px solid var(--border);border-radius:6px;margin-top:.4rem;background:var(--row-even);color:#555;font-size:.85rem}
  </style>
</head>
<body>
  <h1>Literature Review: {{ topic | default('N/A') }}</h1>
  <div class="metadata-block">
    <p><strong>Authors:</strong> {{ authors_list | default('[Author Name(s) Placeholder]') }}</p>
    <p><strong>Affiliation(s):</strong> {{ affiliation | default('[Affiliation Placeholder]') }}</p>
    <p><em>Generated:</em> {{ generation_date | default('N/A') }}</p>
    <p>Data Source: {{ data_source_name | default('N/A') }} | Period: {{ date_range | default('N/A') }} |
       Items Analysed: {{ analyzed_docs_count | default('N/A') }} / {{ total_docs_found | default('N/A') }}</p>
    <p class="mode-badge">Review Mode: {{ review_mode | default('chronological') }}</p>
  </div>
  <div class="report-section">
    <h2>Abstract</h2>
    <div>{{ ai_abstract | default('<p class="placeholder-text">[Abstract pending.]</p>') | safe }}</div>
    {% if top_keywords_list_str %}
      <p><strong>Keywords:</strong> <em class="keywords-list">{{ top_keywords_list_str }}</em></p>
    {% endif %}
  </div>
  <div class="report-section">
    <h2>1. Introduction</h2>
    <div>{{ ai_introduction | default('<p class="placeholder-text">[Introduction pending.]</p>') | safe }}</div>
  </div>
  <div class="report-section">
    <h2>2. Methodology</h2>
    <div>{{ ai_methodology_review | default('<p class="placeholder-text">[Methodology pending.]</p>') | safe }}</div>
  </div>
  {% if review_mode == 'chronological' %}
    <div class="report-section">
      <h2>3. Chronological Findings</h2>
      <div class="sub-section">
        <h3>3.1 Temporal Trend and Phases</h3>
        <figure>
          <div class="plot-container">
            {% if year_trends_plot_html %}{{ year_trends_plot_html | safe }}{% else %}
              <p class="placeholder-text">[Annual Trend Plot Unavailable]</p>
            {% endif %}
          </div>
          <figcaption>{{ year_trends_caption | default('<strong>Figure&nbsp;1.</strong> Annual publication output and phase markers.') | safe }}</figcaption>
        </figure>
        <div>{{ ai_timeline_analysis | default('<p class="placeholder-text">[Timeline analysis pending.]</p>') | safe }}</div>
      </div>
      <div class="sub-section">
        <h3>3.2 Milestones and Pivotal Contributions</h3>
        <div>{{ ai_chronological_review | default('<p class="placeholder-text">[Chronological synthesis pending.]</p>') | safe }}</div>
      </div>
    </div>
  {% else %}
    <div class="report-section">
      <h2>3. Thematic Findings</h2>
      <div class="sub-section">
        <h3>3.1 Keyword Themes</h3>
        <figure>
          <div class="plot-container">
            {% if top_keywords_plot_html %}{{ top_keywords_plot_html | safe }}{% else %}
              <p class="placeholder-text">[Top Keywords Plot Unavailable]</p>
            {% endif %}
          </div>
          <figcaption>{{ top_keywords_caption | default('<strong>Figure&nbsp;1.</strong> Top keywords in the corpus.') | safe }}</figcaption>
        </figure>
        <figure>
          <div class="plot-container">
            {% if keyword_cooccurrence_network_plot_html %}{{ keyword_cooccurrence_network_plot_html | safe }}{% else %}
              <p class="placeholder-text">[Keyword Co-occurrence Network Unavailable]</p>
            {% endif %}
          </div>
          <figcaption>{{ keyword_cooccurrence_network_caption | default('<strong>Figure&nbsp;2.</strong> Keyword co-occurrence clusters.') | safe }}</figcaption>
        </figure>
      </div>
      <div class="sub-section">
        <h3>3.2 Thematic Synthesis</h3>
        <div>{{ ai_thematic_review | default('<p class="placeholder-text">[Thematic synthesis pending.]</p>') | safe }}</div>
      </div>
    </div>
  {% endif %}
  <div class="report-section">
    <h2>4. Discussion</h2>
    <div>{{ ai_discussion | default('<p class="placeholder-text">[Discussion pending.]</p>') | safe }}</div>
  </div>
  <div class="report-section">
    <h2>5. Conclusion</h2>
    <div>{{ ai_conclusion | default('<p class="placeholder-text">[Conclusion pending.]</p>') | safe }}</div>
  </div>
  <div class="report-section">
    <h2>6. Limitations</h2>
    <div>{{ ai_limitations | default('<p class="placeholder-text">[Limitations pending.]</p>') | safe }}</div>
  </div>
  <div id="references-section" class="report-section">
    <h2>7. References</h2>
    <p>Representative list (up to {{ REFERENCE_LIMIT | default(20) }} records):</p>
    <ol>
      {% for ref in references_list %}
        <li>{{ ref.html_string | safe }}</li>
      {% else %}
        <li>No reference data compiled for this review.</li>
      {% endfor %}
    </ol>
  </div>
</body>
</html>
"""

def assemble_report_html(
    df,
    results_so_far: dict,
    progress_callback=None,
    theme_name: str = "dark",
    template_kind: str = "bibliographic",
    review_mode: str | None = None,
    template_override_path: str | Path | None = None
) -> str:
    """
    Extended assembler.
    If template_kind == 'literature_review', render literature_review.html
    Otherwise, fall back to existing bibliographic behaviour if available,
    or render a minimal assembled HTML from captured sections.
    """
    def _emit(msg: str):
        if progress_callback:
            try:
                progress_callback(msg)
            except Exception:
                pass

    # Map common fields
    topic = (results_so_far.get("research_topic")
             or results_so_far.get("base_topic")
             or (results_so_far.get("STEP_LOAD_DATA", {}) or {}).get("collection_name_for_title")
             or "literature review topic")

    # References list normalisation
    references_list = results_so_far.get("references_list") or []
    if not isinstance(references_list, list):
        references_list = []

    # Pull common AI sections if present
    ai_sections = {
        "ai_abstract": results_so_far.get("STEP_AI_ABSTRACT", {}).get("data", {}).get("response_html"),
        "ai_introduction": results_so_far.get("STEP_AI_INTRODUCTION", {}).get("data", {}).get("response_html"),
        "ai_methodology_review": results_so_far.get("STEP_AI_METHODOLOGY_REVIEW", {}).get("data", {}).get("response_html"),
        "ai_discussion": results_so_far.get("STEP_AI_DISCUSSION", {}).get("data", {}).get("response_html"),
        "ai_conclusion": results_so_far.get("STEP_AI_CONCLUSION", {}).get("data", {}).get("response_html"),
        "ai_limitations": results_so_far.get("STEP_AI_LIMITATIONS", {}).get("data", {}).get("response_html"),
    }

    # Visuals
    year_trends_plot_html = (
        results_so_far.get("STEP__TIMELINE", {}).get("data_html_fragment")
        or results_so_far.get("Timeline & Trends")
        or None
    )
    top_keywords_plot_html = (
        results_so_far.get("STEP_ANALYZE_KEYWORDS", {}).get("data_html_fragment")
        or None
    )
    keyword_cooccurrence_network_plot_html = (
        results_so_far.get("STEP__KEYWORD_COOCCURRENCE_NET", {}).get("data_html_fragment")
        or None
    )

    # Mode specific AI blocks
    ai_chronological_review = results_so_far.get("STEP_AI_LR_CHRONOLOGICAL", {}).get("data", {}).get("response_html")
    ai_timeline_analysis = results_so_far.get("STEP_AI_TIMELINE_ANALYSIS", {}).get("data", {}).get("response_html")
    ai_thematic_review = results_so_far.get("STEP_AI_LR_THEMATIC", {}).get("data", {}).get("response_html")

    # Theme defaults
    theme_vars = {
        "theme_body_bg": "#0b0e11" if theme_name == "dark" else "#fdfdfd",
        "theme_text_color": "#e6edf3" if theme_name == "dark" else "#333",
        "theme_h1_color": "#9CDCFE" if theme_name == "dark" else "#0D47A1",
        "theme_h2_color": "#CE9178" if theme_name == "dark" else "#1A237E",
        "theme_h3_color": "#4FC3F7" if theme_name == "dark" else "#1E88E5",
        "theme_h4_color": "#42A5F5" if theme_name == "dark" else "#42A5F5",
        "theme_link_color": "#4e94ce",
        "theme_link_hover_color": "#82b1ff",
        "theme_border_color": "#2b2b2b" if theme_name == "dark" else "#d0d0d0",
        "theme_section_bg": "#11161b" if theme_name == "dark" else "#fff",
        "theme_subsection_border": "#263238" if theme_name == "dark" else "#E3F2FD",
        "theme_table_header_bg": "#222a31" if theme_name == "dark" else "#f0f4f8",
        "theme_table_header_text": "#e6edf3" if theme_name == "dark" else "#2c3e50",
        "theme_table_row_even_bg": "#0f1419" if theme_name == "dark" else "#f9f9f9",
        "theme_table_row_hover_bg": "#17202a" if theme_name == "dark" else "#e6e6fa",
        "theme_figure_bg": "#0f1419" if theme_name == "dark" else "#fff",
        "theme_placeholder_text_color": "#7f8c8d",
        "theme_placeholder_border_color": "#3a3a3a" if theme_name == "dark" else "#bdc3c7",
    }

    if template_kind == "literature_review":
        review_mode_value = (review_mode or "chronological").lower()
        template_text = _load_template_text_literature(template_override_path)

        ctx = {
            "topic": topic,
            "authors_list": results_so_far.get("authors_list") or "[Author Name(s) Placeholder]",
            "affiliation": results_so_far.get("affiliation") or "[Affiliation Placeholder]",
            "generation_date": datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC"),
            "data_source_name": results_so_far.get("data_source_name") or "N/A",
            "date_range": results_so_far.get("date_range") or "N/A",
            "analyzed_docs_count": results_so_far.get("analyzed_docs_count") or (df.shape[0] if df is not None else "N/A"),
            "total_docs_found": results_so_far.get("total_docs_found") or "N/A",
            "review_mode": review_mode_value,
            "references_list": references_list,
            "REFERENCE_LIMIT": results_so_far.get("REFERENCE_LIMIT", 20),
            "year_trends_plot_html": year_trends_plot_html,
            "top_keywords_plot_html": top_keywords_plot_html,
            "keyword_cooccurrence_network_plot_html": keyword_cooccurrence_network_plot_html,
            "ai_chronological_review": ai_chronological_review,
            "ai_timeline_analysis": ai_timeline_analysis,
            "ai_thematic_review": ai_thematic_review,
            **ai_sections,
            **theme_vars,
            "year_trends_caption": "<strong>Figure 1.</strong> Annual publication output.",
            "top_keywords_caption": "<strong>Figure 1.</strong> Top keywords in the corpus.",
            "keyword_cooccurrence_network_caption": "<strong>Figure 2.</strong> Keyword co-occurrence clusters."
        }

        if Template is None:
            # Minimal fallback without Jinja2
            sections = results_so_far.get("_assembled_sections", [])
            body = "\n".join(sections) if sections else "<p>No sections assembled.</p>"
            return f"<!DOCTYPE html><html><head><meta charset='utf-8'><title>Literature Review</title></head><body>{body}</body></html>"

        return Template(template_text).render(**ctx)

    # Fallback behaviour for bibliographic reports
    # If the calling code still expects the old assemble_report_html to work for bibliographic,
    # try to stitch together whatever sections are present.
    sections = results_so_far.get("_assembled_sections", [])
    if sections:
        stitched = "\n".join(sections)
        return f"<!DOCTYPE html><html><head><meta charset='utf-8'><title>Bibliographic Report</title></head><body>{stitched}</body></html>"

    # Last resort
    return "<!DOCTYPE html><html><head><meta charset='utf-8'><title>Report</title></head><body><p>No content.</p></body></html>"