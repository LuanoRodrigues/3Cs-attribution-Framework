# bibliographic_analyzer.py
# src/core/bibliographic_analyzer.py
import logging
import time
from pathlib import Path
import re
from datetime import datetime
import pandas as pd
import os  # For environment variables in __main__
import traceback  # For more detailed error logging

# Import from the new utility modules within the same 'core' package
from bibliometric_analysis_tool.core.app_constants import (
    STEP_LOAD_DATA, STEP_ANALYZE_AUTHORS, STEP_ANALYZE_KEYWORDS,
    STEP_ANALYZE_CITATIONS, STEP_GENERATE_TIMELINE,
    STEP_GENERATE_COAUTHORSHIP_NET, STEP_GENERATE_KEYWORD_COOCCURRENCE_NET,
    STEP_AI_SUGGEST_CODING_KEYWORDS, STEP_EXTRACT_PDF_CONTENT_FOR_KEYWORDS,
    STEP_AI_AUTHOR_FOCUS_KEYWORDS, STEP_AI_AUTHOR_GRAPH_ANALYSIS,
    STEP_AI_KEYWORD_GRAPH_ANALYSIS, STEP_AI_TIMELINE_ANALYSIS,  # New graph analysis steps
    STEP_AI_ABSTRACT, STEP_AI_INTRODUCTION, STEP_AI_LITERATURE_REVIEW_SUMMARY,
    STEP_AI_METHODOLOGY_REVIEW, STEP_AI_DISCUSSION, STEP_AI_CONCLUSION,
    STEP_AI_LIMITATIONS, TOP_N_DEFAULT, REFERENCE_LIMIT, MIN_COAUTH_COLLABORATIONS, STEP_AI_AFFILIATIONS_ANALYSIS,
    STEP_AI_GENERAL_KEYWORD_THEMES_ANALYSIS, STEP_AI_SOURCES_ANALYSIS, STEP_AI_PDF_CONTENT_SUMMARY,
    STEP_AI_FUNDERS_ANALYSIS, STEP_AI_CITATION_TABLE_ANALYSIS, STEP_AI_COAUTHORSHIP_NETWORK_ANALYSIS,
    STEP_AI_COUNTRIES_ANALYSIS, STEP_AI_DOC_TYPES_ANALYSIS, STEP_AI_KEYWORD_CLUSTER_SEARCH_TERMS
)
from src.core.utils.data_processing import (
    load_data_from_source_for_widget,  # Primarily for widget, but can be used by script
    analyze_authors_detailed_plotly,
    analyze_keywords_detailed_plotly,
    analyze_citations_data_plotly,
    generate_timeline_detailed_plotly,
    generate_network_graph_detailed_plotly,
    process_zotero_data,
    zot,  # Zotero instance from data_processing
    ZOTERO_CLASS_AVAILABLE,
    analyze_publication_trends,
    analyze_top_list,
    analyze_most_cited,
    describe_trend_data,
    describe_series_data
)
from src.core.utils.pdf_processing import (  # Assuming your PDF functions are here
    extract_content_for_keywords
)
from src.core.utils.ai_services import (
    generate_thematic_keywords_for_pdf_search,
    generate_ai_author_focus_keywords,
    generate_ai_author_graph_analysis,
    # New AI graph analysis functions to be added to ai_services.py
    # generate_ai_keyword_graph_analysis,
    # generate_ai_timeline_analysis_with_content,
    generate_ai_abstract,
    generate_ai_introduction,
    generate_ai_literature_review_summary,
    generate_ai_methodology_insights,
    generate_ai_discussion,
    generate_ai_conclusion,
    generate_ai_limitations,
    OPENAI_CLIENT_AVAILABLE, generate_ai_keyword_cluster_search_terms,
    generate_ai_timeline_analysis, generate_ai_doc_types_analysis,
    generate_ai_countries_analysis, generate_ai_affiliations_analysis,
    generate_ai_general_keyword_themes_analysis,
    generate_ai_coauthorship_network_analysis,
    generate_ai_keyword_graph_analysis, generate_ai_sources_analysis,
    generate_ai_citation_table_analysis, generate_ai_funders_analysis,
    generate_ai_pdf_content_summary  # To check if AI calls are likely to work
)
from src.core.utils.report_generation import (
    assemble_report_html,
    format_reference_html  # Used in this script for references
)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - [%(filename)s:%(lineno)d] - %(message)s')


def generate_bibliometric_report(
        input_dataframe: pd.DataFrame,
        collection_name_or_topic: str,
        output_dir_base: str = "output_reports_script",
        ai_provider_key: str = "OpenAI",
        ai_model_api_name: str = "gpt-4o-mini",  # Default model for AI services
        script_theme_name: str = "light",
        research_question_for_ai: str = None,
        run_pdf_content_extraction: bool = True,
        run_ai_analyses: bool = True  # Unified flag for all AI-driven text generation
):
    """
    Orchestrates the generation of a bibliometric report.
    """
    logging.info(f"--- Starting Report Generation for: '{collection_name_or_topic}' ---")
    start_time = datetime.now()

    def sanitize_for_path(name_str: str, max_len: int = 100) -> str:
        if not name_str: name_str = "untitled_report"
        name_str = str(name_str)
        name_str = re.sub(r'[<>:"/\\|?*\s&]', '_', name_str)
        name_str = re.sub(r'_+', '_', name_str).strip('_')
        return name_str[:max_len]

    safe_collection_folder_name = sanitize_for_path(collection_name_or_topic)
    current_run_output_dir = Path(output_dir_base) / safe_collection_folder_name
    current_run_output_dir.mkdir(parents=True, exist_ok=True)

    images_dir_for_run = current_run_output_dir / "images"
    images_dir_for_run.mkdir(parents=True, exist_ok=True)

    report_html_path = current_run_output_dir / f"{safe_collection_folder_name}_bibliometric_report.html"
    logging.info(f"Report outputs will be in: {current_run_output_dir.resolve()}")

    # --- Function to save plot image (specific to this script's context) ---
    def save_plot_image_script(fig, plot_name_identifier: str, target_images_dir: Path) -> str | None:
        image_file_path_str = None
        if fig is None:
            logging.warning(f"No figure object to save for '{plot_name_identifier}'.")
            return None
        try:
            target_images_dir.mkdir(parents=True, exist_ok=True)
            sanitized_plot_name = sanitize_for_path(plot_name_identifier)
            image_filename = f"{sanitized_plot_name}_plot.png"
            image_path_obj = target_images_dir / image_filename

            if image_path_obj.exists():
                logging.info(f"Using existing plot image for '{plot_name_identifier}': {image_path_obj}")
            else:
                logging.info(f"Attempting to save plot image for '{plot_name_identifier}' to {image_path_obj}...")
                try:
                    import kaleido  # Ensure kaleido is installed
                    fig.write_image(str(image_path_obj), scale=1.5)  # Using kaleido
                    logging.info(f"Successfully saved plot image: {image_path_obj}")
                except ImportError:
                    logging.error(
                        f"Could not save plot for '{plot_name_identifier}': 'kaleido' library not installed ('pip install -U kaleido').")
                    return None
                except Exception as e_write:
                    logging.error(f"Error writing plot image for '{plot_name_identifier}': {e_write}")
                    return None
            image_file_path_str = str(image_path_obj)
        except Exception as e_img_setup:
            logging.error(f"Error setting up to save plot image for '{plot_name_identifier}': {e_img_setup}")
        return image_file_path_str

    # 1. Process initial data
    logging.info("Processing input metadata...")
    df_processed, preliminary_results = process_zotero_data(input_dataframe)  # process_zotero_data can handle DFs too
    if df_processed.empty:
        logging.error("No processable data. Aborting.");
        return
    if 'key' not in df_processed.columns:  # Ensure 'key' for PDF steps
        df_processed['key'] = [f"script_item_key_{i}" for i in range(len(df_processed))]
    for col in ['authors', 'year', 'title', 'abstract', 'keywords']:  # Ensure common cols
        if col not in df_processed.columns: df_processed[col] = ""

    year_min = pd.to_numeric(df_processed['year'], errors='coerce').min()
    year_max = pd.to_numeric(df_processed['year'], errors='coerce').max()
    date_range = f"{int(year_min)}-{int(year_max)}" if pd.notna(year_min) and pd.notna(year_max) else "N/A"

    results_so_far = {
        STEP_LOAD_DATA: {
            "type": "raw_df_full_summary", "raw_df_full": df_processed.copy(),
            "data_html": df_processed.head(3).to_html(classes='dataframe data-table', escape=False, index=False),
            "description": f"Loaded Data: {collection_name_or_topic}",
            "collection_name_for_title": collection_name_or_topic,
            "full_df_shape": df_processed.shape, "date_range": date_range,
            "total_docs_found": preliminary_results.get('total_docs_found', len(df_processed)),
            "analyzed_docs_count": preliminary_results.get('analyzed_docs_count', len(df_processed)),
            "base_output_dir": str(current_run_output_dir)  # For use by AI services to save logs/images
        }
    }
    results_so_far["research_question"] = research_question_for_ai or \
                                          f"To conduct a comprehensive bibliometric analysis of '{collection_name_or_topic}'."

    # 2. Perform Core Analyses & Generate Visualizations
    logging.info("Generating core analyses and visualizations...")

    plot_data_steps = [
        (STEP_ANALYZE_AUTHORS, analyze_authors_detailed_plotly, "Author Productivity"),
        (STEP_ANALYZE_KEYWORDS, analyze_keywords_detailed_plotly, "Keyword Frequency"),
        (STEP_ANALYZE_CITATIONS, analyze_citations_data_plotly, "Top Cited Publications"),
        (STEP_GENERATE_TIMELINE, generate_timeline_detailed_plotly, "Publication Timeline"),
    ]
    network_plot_steps = [
        (STEP_GENERATE_COAUTHORSHIP_NET, lambda df, cb: generate_network_graph_detailed_plotly(df, "authors", cb),
         "Co-authorship Network"),
        (STEP_GENERATE_KEYWORD_COOCCURRENCE_NET,
         lambda df, cb: generate_network_graph_detailed_plotly(df, "keywords", cb), "Keyword Co-occurrence Network")
    ]

    for step_key, func, desc in plot_data_steps:
        try:
            logging.info(f"Running: {desc}")
            output = func(df_processed, logging.info)  # func might return (df, fig) or just fig

            fig_plotly = None
            df_res = None
            package_type = "plotly_html_summary"  # Default for fig-only

            if isinstance(output, tuple) and len(output) == 2:
                df_res, fig_plotly = output
                package_type = "plotly_graph_df"  # Contains both
            elif hasattr(output, 'to_html'):  # Is a Plotly figure
                fig_plotly = output
                package_type = "plotly_html_summary"
            elif isinstance(output, pd.DataFrame):  # Only DataFrame
                df_res = output
                package_type = "table_summary"

            step_package = {"type": package_type, "description": desc}
            if fig_plotly:
                step_package["data_html_fragment"] = fig_plotly.to_html(full_html=False, include_plotlyjs='cdn')
                img_path = save_plot_image_script(fig_plotly, step_key, images_dir_for_run)
                if img_path: step_package["image_file_path"] = img_path
            if df_res is not None:
                step_package["raw_df_table"] = df_res.copy()
                if step_key == STEP_ANALYZE_KEYWORDS and "top_keywords_list_str" not in results_so_far:
                    results_so_far["top_keywords_list_str"] = ", ".join(df_res.head(TOP_N_DEFAULT)['Keyword'].tolist())
                if step_key == STEP_ANALYZE_CITATIONS:
                    ref_sample_df = df_res.head(REFERENCE_LIMIT)
                    results_so_far["references_list_for_template"] = [format_reference_html(row_dict) for row_dict in
                                                                      ref_sample_df.to_dict(orient='records')]

            # Special handling for timeline summary text
            if step_key == STEP_GENERATE_TIMELINE:
                pub_trends_series = analyze_publication_trends(df_processed)
                step_package["_data_summary_text"] = describe_trend_data(
                    pub_trends_series) if not pub_trends_series.empty else "No trend data to summarize."

            results_so_far[step_key] = step_package

        except Exception as e:
            logging.error(f"Error in {desc}: {e}\n{traceback.format_exc()}")
            results_so_far[step_key] = {"type": "error", "description": f"{desc} Failed", "error_message": str(e)}

    for step_key, func, desc in network_plot_steps:
        try:
            logging.info(f"Running: {desc}")
            graph_package = func(df_processed, logging.info)  # Returns dict {"figure": fig, "aux_data":...}
            fig_plotly = graph_package.get("figure") if isinstance(graph_package, dict) else None

            step_package = {"type": "plotly_graph_dict", "description": desc}
            if fig_plotly:
                step_package["data_html_fragment"] = fig_plotly.to_html(full_html=False, include_plotlyjs='cdn')
                img_path = save_plot_image_script(fig_plotly, step_key, images_dir_for_run)
                if img_path: step_package["image_file_path"] = img_path
            if isinstance(graph_package, dict):  # Store other data from the package
                for k_aux, v_aux in graph_package.items():
                    if k_aux != "figure": step_package[k_aux] = v_aux  # e.g., "keyword_clusters_data"

            results_so_far[step_key] = step_package
        except Exception as e:
            logging.error(f"Error in {desc}: {e}\n{traceback.format_exc()}")
            results_so_far[step_key] = {"type": "error", "description": f"{desc} Failed", "error_message": str(e)}

    # 3. AI-Driven Utilities & PDF Content Extraction (if enabled)
    if run_ai_analyses or run_pdf_content_extraction:  # Combine conditions
        logging.info("Generating AI-driven utilities (keywords, PDF extraction)...")
        utility_ai_steps = [
            (STEP_AI_SUGGEST_CODING_KEYWORDS,
             lambda df, rsf, cb: generate_thematic_keywords_for_pdf_search(df.head(10), rsf["research_question"],
                                                                           ai_provider_key, ai_model_api_name, cb,
                                                                           rsf)),
            (STEP_AI_AUTHOR_FOCUS_KEYWORDS,
             lambda df, rsf, cb: generate_ai_author_focus_keywords(
                 rsf.get(STEP_ANALYZE_AUTHORS, {}).get("raw_df_table", pd.DataFrame()), df, ai_provider_key,
                 ai_model_api_name, cb, rsf)),
            (STEP_AI_KEYWORD_CLUSTER_SEARCH_TERMS,
             lambda df, rsf, cb: generate_ai_keyword_cluster_search_terms(
                 rsf.get(STEP_LOAD_DATA, {}).get("collection_name_for_title", "topic"),
                 rsf.get(STEP_GENERATE_KEYWORD_COOCCURRENCE_NET, {}).get("keyword_clusters_data", {}).get(
                     "summary_text", "No clusters."),
                 df.head(3), ai_provider_key, ai_model_api_name, cb, rsf))
        ]
        for step_key, ai_func in utility_ai_steps:
            try:
                logging.info(f"Running AI utility: {step_key}")
                result_package = ai_func(df_processed, results_so_far, logging.info)
                results_so_far[step_key] = result_package
            except Exception as e:
                logging.error(f"Error in AI utility {step_key}: {e}\n{traceback.format_exc()}")
                results_so_far[step_key] = {"type": "error", "description": f"{step_key} Failed",
                                            "error_message": str(e)}

        if run_pdf_content_extraction and ZOTERO_CLASS_AVAILABLE and zot:
            logging.info("Extracting PDF content based on AI suggested keywords...")
            # Example for Author Focus Keywords (notes are stored in results_so_far by generate_ai_author_focus_keywords)
            # If you have globally_suggested_kws from STEP_AI_SUGGEST_CODING_KEYWORDS:
            glob_kws_pkg = results_so_far.get(STEP_AI_SUGGEST_CODING_KEYWORDS, {})
            glob_kws = glob_kws_pkg.get("data") if glob_kws_pkg.get("type") == "keyword_list" else []
            if glob_kws:
                items_to_code_map = {key: glob_kws for key in
                                     df_processed['key'].dropna().sample(min(5, len(df_processed))).tolist()}
                if items_to_code_map:
                    coded_notes_result = extract_content_for_keywords(
                        df_processed[df_processed['key'].isin(items_to_code_map.keys())],
                        items_to_code_map, zot, None, logging.info)
                    results_so_far[STEP_EXTRACT_PDF_CONTENT_FOR_KEYWORDS] = coded_notes_result

    # 4. Generate Main AI Written Report Sections (if enabled)
    if run_ai_analyses:
        logging.info("Generating AI-written report sections...")
        # These functions from ai_services are orchestrators (use generate_section_with_ai_review)
        # They will internally fetch image_file_path and _data_summary_text from results_so_far
        ai_orchestrator_steps = [
            (STEP_AI_METHODOLOGY_REVIEW, generate_ai_methodology_insights),
            (STEP_AI_TIMELINE_ANALYSIS, generate_ai_timeline_analysis),
            (STEP_AI_DOC_TYPES_ANALYSIS, generate_ai_doc_types_analysis),
            (STEP_AI_AUTHOR_GRAPH_ANALYSIS, generate_ai_author_graph_analysis),
            (STEP_AI_AFFILIATIONS_ANALYSIS, generate_ai_affiliations_analysis),
            (STEP_AI_COUNTRIES_ANALYSIS, generate_ai_countries_analysis),
            (STEP_AI_GENERAL_KEYWORD_THEMES_ANALYSIS, generate_ai_general_keyword_themes_analysis),
            (STEP_AI_COAUTHORSHIP_NETWORK_ANALYSIS, generate_ai_coauthorship_network_analysis),
            (STEP_AI_KEYWORD_GRAPH_ANALYSIS, generate_ai_keyword_graph_analysis),
            (STEP_AI_SOURCES_ANALYSIS, generate_ai_sources_analysis),
            (STEP_AI_CITATION_TABLE_ANALYSIS, generate_ai_citation_table_analysis),
            (STEP_AI_FUNDERS_ANALYSIS, generate_ai_funders_analysis),
            (STEP_AI_PDF_CONTENT_SUMMARY, generate_ai_pdf_content_summary),
            (STEP_AI_LITERATURE_REVIEW_SUMMARY, generate_ai_literature_review_summary),
            (STEP_AI_DISCUSSION, generate_ai_discussion),
            (STEP_AI_LIMITATIONS, generate_ai_limitations),
            (STEP_AI_INTRODUCTION, generate_ai_introduction),
            (STEP_AI_ABSTRACT, generate_ai_abstract),
            (STEP_AI_CONCLUSION, generate_ai_conclusion),
        ]
        for step_key, ai_func in ai_orchestrator_steps:
            try:
                logging.info(f"Generating AI section: {step_key}")
                section_result = ai_func(df_processed, results_so_far, logging.info, ai_provider_key, ai_model_api_name)
                results_so_far[step_key] = section_result  # Store the entire package
            except Exception as e:
                logging.error(f"Error generating AI section {step_key}: {e}\n{traceback.format_exc()}")
                results_so_far[step_key] = {"type": "error", "data": {"error_message": str(e)},
                                            "description": f"{step_key} failed"}
    else:
        logging.info("Skipping AI-written report section generation.")
        # Add placeholders if AI analyses are skipped
        placeholder_text = "<p class='placeholder-text'>[AI analysis for this section was skipped]</p>"
        ai_step_keys_for_placeholders = [
            STEP_AI_METHODOLOGY_REVIEW, STEP_AI_TIMELINE_ANALYSIS, STEP_AI_DOC_TYPES_ANALYSIS,
            STEP_AI_AUTHOR_GRAPH_ANALYSIS, STEP_AI_AFFILIATIONS_ANALYSIS, STEP_AI_COUNTRIES_ANALYSIS,
            STEP_AI_GENERAL_KEYWORD_THEMES_ANALYSIS, STEP_AI_COAUTHORSHIP_NETWORK_ANALYSIS,
            STEP_AI_KEYWORD_GRAPH_ANALYSIS, STEP_AI_SOURCES_ANALYSIS, STEP_AI_CITATION_TABLE_ANALYSIS,
            STEP_AI_FUNDERS_ANALYSIS, STEP_AI_PDF_CONTENT_SUMMARY, STEP_AI_LITERATURE_REVIEW_SUMMARY,
            STEP_AI_DISCUSSION, STEP_AI_LIMITATIONS, STEP_AI_INTRODUCTION, STEP_AI_ABSTRACT, STEP_AI_CONCLUSION
        ]
        for key in ai_step_keys_for_placeholders:
            if key not in results_so_far:
                results_so_far[key] = {"type": "html_section", "data": {"response_html": placeholder_text},
                                       "description": key.replace("STEP_AI_", "").replace("_", " ")}

    # 5. Assemble Final HTML Report
    logging.info("Assembling final HTML report.")
    rendered_html = assemble_report_html(
        df_full=df_processed,
        results_so_far=results_so_far,
        progress_callback=logging.info,
        theme_name=script_theme_name
    )

    if isinstance(rendered_html, str) and rendered_html.strip():
        try:
            with open(report_html_path, 'w', encoding='utf-8') as f:
                f.write(rendered_html)
            logging.info(f"Bibliometric report successfully generated: {report_html_path.resolve()}")
        except Exception as e:
            logging.error(f"Error writing final HTML report to file: {e}")
    else:
        logging.error("assemble_report_html returned no HTML data.")

    end_time = datetime.now()
    logging.info(f"--- Report Generation Script Finished. Total Time: {end_time - start_time} ---")



if __name__ == "__main__":
    logging.getLogger().setLevel(logging.DEBUG)
    logging.info("Executing bibliographic_analyzer.py (refactored) as standalone script...")

    test_collection_name = "Test Script - AI Software Development v2"

    logging.warning("Using DUMMY DATA for __main__ test. Configure Zotero or file path for real data.")
    dummy_data = {
        'key': [f'dummy_key_{i}' for i in range(1, 8)],
        'title': [f'Scalable AI for Code Generation {i}' if i % 2 == 0 else f'Ethical Bugs in AI Systems {i}' for i in
                  range(1, 8)],
        'authors': ['Dev, Ada; Coder, Charles', 'Logic, Grace H.', 'Dev, Ada; Turing, Alan',
                    'Secure, Sam; Algorithm, Ada L.', 'Coder, Charles; Logic, Grace H.', 'Byte, Barry', 'AI, Alpha'],
        # Removed Test, Tess
        'year': [2022, 2023, 2021, 2024, 2023, 2022, 2024],
        'keywords': ['AI; Code Generation; Scalability', 'Ethics; AI Bugs; Software Testing',
                     'Deep Learning; Code Analysis', 'Security; Vulnerabilities; AI Ethics',
                     'Software Engineering; ML Ops', 'Testing; Automation; AI', 'AGI; Future of Code; AI'],
        'citations': [str(i * 7 + 12) for i in range(7)],
        'abstract': [
            f'This paper presents a novel framework for scalable AI in code generation task {i}. We discuss potential applications and limitations.'
            for i in range(1, 8)],
        'item_type': ['conferencePaper', 'journalArticle', 'journalArticle', 'report', 'journalArticle',
                      'conferencePaper', 'preprint'],
        # 'pdf_path': [None] * 7 # Add this if you want to test local PDF scanning with dummy data
    }
    test_df = pd.DataFrame(dummy_data)

    script_ai_provider = os.getenv("DEFAULT_AI_PROVIDER", "OpenAI")
    script_ai_model = os.getenv("DEFAULT_AI_MODEL", "gpt-5-m")

    logging.info(f"Script runner using AI Provider: {script_ai_provider}, Model: {script_ai_model}")

    # Check if the OPENAI_API_KEY is set, as it's used by default by the openai library
    # If you use provider-specific keys like DEEPSEEK_API_KEY, ensure call_models prioritizes them
    if OPENAI_CLIENT_AVAILABLE and os.getenv("OPENAI_API_KEY"):
        generate_bibliometric_report(
            input_dataframe=test_df.copy(),  # Pass a copy to avoid modification issues
            collection_name_or_topic=test_collection_name,
            ai_provider_key=script_ai_provider,
            ai_model_api_name=script_ai_model,
            run_pdf_content_extraction=True,  # Set to True to test this part (needs working PDF utils)
            # run_enhanced_graph_analysis=True  # Set to True to test this part
        )
    else:
        logging.error("OpenAI library not available or OPENAI_API_KEY not set. Cannot run report with real AI calls.")
        logging.info(
            "To run with real AI: 1. `pip install openai`. 2. Set OPENAI_API_KEY (and OPENAI_BASE_URL for custom endpoints).")
# import pickle
# from utils import *
# from charts import *
# from gpt_api import call_models
# from src.core.literature_review import zt
# from src.core.snippets import create_corpus_from_pdfs, analyze_keyword_frequency
#
# CACHE_DIR = 'cache'
# import os
# CORPUS_CACHE_FILE = os.path.join(CACHE_DIR, 'corpus_cache.pkl')
# PDF_PATHS_CACHE_FILE = os.path.join(CACHE_DIR, 'pdf_paths_cache.pkl')
# PREPROCESSED_CORPUS_CACHE_FILE = os.path.join(CACHE_DIR, 'preprocessed_corpus_cache.pkl')
# from datetime import datetime
#
# import os
# import pandas as pd
# import networkx as nx
# import matplotlib.pyplot as plt
# from collections import Counter
# import logging
#
# # Assuming zotero_class.py is in src.utils
# from src.utils.zotero_class import Zotero
#
# logging.basicConfig(level=logging.INFO)
#
#
# def load_data(source_type="file", file_path=None):
#     """
#     Load bibliographic data from Zotero or a file.
#
#     Args:
#         source_type (str): "zotero" or "file".
#         file_path (str, optional): Path to the file if source_type is "file".
#
#     Returns:
#         pd.DataFrame: DataFrame containing bibliographic data, or None on failure.
#     """
#     if source_type == "zotero":
#         logging.info("Loading data from Zotero...")
#         zot = Zotero()  # Assumes .env is configured
#         if not zot.is_connected():
#             logging.error("Zotero connection failed. Check .env file.")
#             return None
#         items = zot.get_all_items()
#         if items:
#             # Basic conversion to DataFrame - needs refinement for real data
#             data_list = []
#             for item in items:
#                 item_data = item.get("data", {})
#                 creators = item_data.get("creators", [])
#                 authors = "; ".join(
#                     [f"{c.get('lastName	', '')}	, {c.get('firstName	', '')}	" for c in creators if
#                      c.get("creatorType") == "author"])
#                 year = item_data.get("date", "")[:4]  # Simple year extraction
#                 keywords = "; ".join([tag["tag"] for tag in item_data.get("tags", [])])
#                 data_list.append({
#                     "key": item_data.get("key"),
#                     "title": item_data.get("title", "N/A"),
#                     "authors": authors,
#                     "year": year,
#                     "journal": item_data.get("publicationTitle", "N/A"),
#                     "abstract": item_data.get("abstractNote", ""),
#                     "keywords": keywords,
#                     # Add other relevant fields
#                 })
#             return pd.DataFrame(data_list)
#         else:
#             logging.warning("No items retrieved from Zotero.")
#             return None
#     elif source_type == "file":
#         if not file_path:
#             logging.error("File path is required for file source type.")
#             return None
#         logging.info(f"Loading data from file: {file_path}")
#         try:
#             if file_path.lower().endswith(".csv"):
#                 return pd.read_csv(file_path)
#             elif file_path.lower().endswith(".xlsx"):
#                 return pd.read_excel(file_path)
#             else:
#                 logging.error(f"Unsupported file format: {file_path}")
#                 return None
#         except Exception as e:
#             logging.error(f"Error loading file {file_path}: {e}")
#             return None
#     else:
#         logging.error(f"Invalid source_type: {source_type}")
#         return None
#
#
# def analyze_authors(df):
#     """
#     Analyze author productivity and collaboration (basic).
#
#     Args:
#         df (pd.DataFrame): Bibliographic data.
#
#     Returns:
#         pd.DataFrame: DataFrame with author counts.
#     """
#     if df is None or "authors" not in df.columns:
#         return pd.DataFrame(columns=["Author", "Count"])
#
#     author_list = []
#     for authors_str in df["authors"].dropna():
#         # Simple split - assumes semicolon separation
#         authors = [a.strip() for a in authors_str.split(";") if a.strip()]
#         author_list.extend(authors)
#
#     author_counts = Counter(author_list)
#     results_df = pd.DataFrame(author_counts.items(), columns=["Author", "Count"])
#     return results_df.sort_values(by="Count", ascending=False)
#
#
# def analyze_keywords(df):
#     """
#     Analyze keyword frequency.
#
#     Args:
#         df (pd.DataFrame): Bibliographic data.
#
#     Returns:
#         pd.DataFrame: DataFrame with keyword counts.
#     """
#     if df is None or "keywords" not in df.columns:
#         return pd.DataFrame(columns=["Keyword", "Count"])
#
#     keyword_list = []
#     for keywords_str in df["keywords"].dropna():
#         # Simple split - assumes semicolon separation
#         keywords = [k.strip().lower() for k in keywords_str.split(";") if k.strip()]
#         keyword_list.extend(keywords)
#
#     keyword_counts = Counter(keyword_list)
#     results_df = pd.DataFrame(keyword_counts.items(), columns=["Keyword", "Count"])
#     return results_df.sort_values(by="Count", ascending=False)
#
#
# def analyze_citations(df):
#     """
#     Analyze citation counts (placeholder).
#
#     Args:
#         df (pd.DataFrame): Bibliographic data.
#
#     Returns:
#         pd.DataFrame: Placeholder DataFrame.
#     """
#     # This requires actual citation data, which is often not in basic Zotero exports
#     # Placeholder implementation
#     logging.warning("Citation analysis requires citation count data, which is not implemented in this basic version.")
#     if df is not None and "title" in df.columns:
#         return pd.DataFrame({"Title": df["title"], "Citation Count": "N/A"})
#     else:
#         return pd.DataFrame(columns=["Title", "Citation Count"])
#
#
#
#
#
# def generate_network_graph(df, type="authors"):
#     """
#     Generate a network graph (co-authorship, keyword co-occurrence).
#
#     Args:
#         df (pd.DataFrame): Bibliographic data.
#         type (str): "authors", "keywords", or "citations".
#
#     Returns:
#         matplotlib.figure.Figure: Matplotlib figure object, or None on failure.
#     """
#     if df is None:
#         return None
#
#     G = nx.Graph()
#
#     if type == "authors" and "authors" in df.columns:
#         for authors_str in df["authors"].dropna():
#             authors = [a.strip() for a in authors_str.split(";") if a.strip()]
#             if len(authors) > 1:
#                 # Add edges between co-authors
#                 for i in range(len(authors)):
#                     for j in range(i + 1, len(authors)):
#                         if G.has_edge(authors[i], authors[j]):
#                             G[authors[i]][authors[j]]['weight'] += 1
#                         else:
#                             G.add_edge(authors[i], authors[j], weight=1)
#
#     elif type == "keywords" and "keywords" in df.columns:
#         for keywords_str in df["keywords"].dropna():
#             keywords = [k.strip().lower() for k in keywords_str.split(";") if k.strip()]
#             if len(keywords) > 1:
#                 # Add edges between co-occurring keywords
#                 for i in range(len(keywords)):
#                     for j in range(i + 1, len(keywords)):
#                         if G.has_edge(keywords[i], keywords[j]):
#                             G[keywords[i]][keywords[j]]['weight'] += 1
#                         else:
#                             G.add_edge(keywords[i], keywords[j], weight=1)
#
#     elif type == "citations":
#         # Placeholder for citation network
#         logging.warning(
#             "Citation network analysis requires citation data, which is not implemented in this basic version.")
#         return None
#
#     # Create visualization
#     if len(G.nodes()) == 0:
#         logging.warning(f"No {type} network data found.")
#         return None
#
#     try:
#         plt.figure(figsize=(12, 8))
#
#         # Limit to top nodes if too many
#         if len(G.nodes()) > 50:
#             # Keep only nodes with highest degree
#             degrees = dict(G.degree())
#             top_nodes = sorted(degrees.items(), key=lambda x: x[1], reverse=True)[:50]
#             top_node_names = [n[0] for n in top_nodes]
#             G = G.subgraph(top_node_names)
#
#         # Calculate node sizes based on degree
#         node_size = [300 * G.degree(node) for node in G.nodes()]
#
#         # Calculate edge widths based on weight
#         edge_width = [0.5 * G[u][v].get('weight', 1) for u, v in G.edges()]
#
#         # Layout
#         pos = nx.spring_layout(G, seed=42)
#
#         # Draw
#         nx.draw_networkx_nodes(G, pos, node_size=node_size, node_color='skyblue', alpha=0.8)
#         nx.draw_networkx_edges(G, pos, width=edge_width, alpha=0.5)
#         nx.draw_networkx_labels(G, pos, font_size=8)
#
#         plt.title(f"{type.capitalize()} Network")
#         plt.axis('off')
#
#         # Return the figure
#         return plt.gcf()
#     except Exception as e:
#         logging.error(f"Error generating network graph: {e}")
#         return None
#
#
# def generate_timeline(df):
#     """
#     Generate a publication timeline.
#
#     Args:
#         df (pd.DataFrame): Bibliographic data.
#
#     Returns:
#         matplotlib.figure.Figure: Matplotlib figure object, or None on failure.
#     """
#     if df is None or "year" not in df.columns:
#         return None
#
#     try:
#         # Extract years and count publications per year
#         years = df["year"].dropna()
#         years = pd.to_numeric(years, errors='coerce')
#         year_counts = years.value_counts().sort_index()
#
#         if len(year_counts) == 0:
#             logging.warning("No valid year data found.")
#             return None
#
#         # Create visualization
#         plt.figure(figsize=(12, 6))
#         year_counts.plot(kind='bar', color='skyblue')
#         plt.title('Publications by Year')
#         plt.xlabel('Year')
#         plt.ylabel('Number of Publications')
#         plt.xticks(rotation=45)
#         plt.tight_layout()
#
#         # Return the figure
#         return plt.gcf()
#     except Exception as e:
#         logging.error(f"Error generating timeline: {e}")
#         return None
#
#
# def generate_bibliometric_report(zotero_items, collection_name, # Pass zt_client
#                                  template_dir="templates", output_dir_base="output",
#                                  your_name="[Your Name]", your_affiliation="[Your Affiliation]",
#                                  ai_provider="mistral",
#                                  ai_models={"mistral": "mistral-large-latest"},
#                                  target_keyword="attribution",
#                                  cache=True,
#                                  plots_only=False):
#     """Generates the full bibliometric report with AI analysis per figure."""
#     print(f"--- Starting Report: '{collection_name}' ---")
#     if plots_only:
#         print("--- Running in PLOTS-ONLY mode: AI analysis will be skipped ---")
#     start_time = datetime.now()
#     safe_collection_name = re.sub(r'[^\w\-]+', '_', collection_name)
#     output_dir = Path(output_dir_base) / safe_collection_name
#     images_dir = output_dir / "images"
#     images_dir.mkdir(parents=True, exist_ok=True)
#     output_html_file = output_dir / f"{safe_collection_name}_report.html"
#     template_path = Path(template_dir) / "bibliographic.html"
#     pdf_paths_cache_file = output_dir / "pdf_paths_cache.pkl"
#     corpus_cache_file = output_dir / "corpus_cache.pkl"
#     preprocessed_corpus_cache_file = output_dir / "preprocessed_corpus_cache.pkl"
#     print(f"Cache files location: {output_dir.resolve()}")
#     if not template_path.is_file(): print(f"Error: Template file not found at {template_path}"); return
#     print(f"Output will be saved to: {output_dir.resolve()}")
#
#     # --- 1. Process Metadata ---
#     print("Step 1: Processing Zotero metadata...")
#     df_processed, preliminary_results = process_zotero_data(zotero_items)
#     analyzed_count = preliminary_results['analyzed_docs_count']
#     print(f"  Found {preliminary_results['total_docs_found']} items total.")
#     print(f"  Processed {analyzed_count} relevant items for analysis.")
#     if df_processed.empty: print("Error: No processable data found."); return
#     year_min, year_max = int(df_processed['year'].min()), int(df_processed['year'].max())
#     date_range_str = f"{year_min}-{year_max}"
#     print(f"  Analysis covers years: {date_range_str}")
#
#     # --- 1b. Load Cache OR Generate PDF Paths, Corpus, Preprocessed Data --- RESTRUCTURED ---
#     print("\nStep 1b: Loading cache or generating corpus data...")
#
#     # Initialize variables to None
#     pdf_paths_by_year = None
#     corpus_by_year = None
#     preprocessed_corpus = None
#
#     # --- Attempt to Load from Cache ---
#     if cache:
#         print("  Attempting to load data from cache...")
#         try:
#             if pdf_paths_cache_file.is_file():
#                 with open(pdf_paths_cache_file, 'rb') as f:
#                     pdf_paths_by_year = pickle.load(f)
#                 print(f"    - Loaded PDF paths from {pdf_paths_cache_file.name}")
#             else: print(f"    - PDF paths cache file not found.")
#
#             if corpus_cache_file.is_file():
#                 with open(corpus_cache_file, 'rb') as f:
#                     corpus_by_year = pickle.load(f)
#                 print(f"    - Loaded corpus from {corpus_cache_file.name}")
#             else: print(f"    - Corpus cache file not found.")
#
#             if preprocessed_corpus_cache_file.is_file():
#                  # Only load preprocessed if NLTK is actually enabled for the current run
#
#                  with open(preprocessed_corpus_cache_file, 'rb') as f:
#                      preprocessed_corpus = pickle.load(f)
#                  print(f"    - Loaded preprocessed corpus from {preprocessed_corpus_cache_file.name}")
#
#             else: print(f"    - Preprocessed corpus cache file not found.")
#
#         except Exception as e:
#             print(f"  *** Error loading from cache: {e}. Will proceed with generation if needed.")
#             # Reset potentially partially loaded variables on error
#             pdf_paths_by_year = None
#             corpus_by_year = None
#             preprocessed_corpus = None
#
#     # --- Generate Missing Data if Not Loaded from Cache ---
#
#     # 1. Generate PDF Paths if needed
#     if pdf_paths_by_year is None:
#         print("  PDF paths not loaded from cache. Retrieving from Zotero...")
#         pdf_paths_by_year = defaultdict(list) # Initialize fresh
#         found_pdf_links = 0
#         retrieved_pdf_paths = 0
#         pdf_paths_generated = False # Flag to check if we need to save
#
#         if zt is None:
#             print("    Warning: zt_client not provided. Cannot retrieve PDF paths.")
#             pdf_paths_by_year = None # Indicate failure
#         else:
#             print(f"    Iterating through {len(zotero_items)} original items...")
#             for item in zotero_items:
#                 try: # Add try-except around item processing
#                     attachment_info = item.get('links', {}).get('attachment', {})
#                     attachment_href = attachment_info.get('href')
#                     attachment_type = attachment_info.get('attachmentType')
#
#                     if attachment_href and attachment_type == 'application/pdf':
#                         found_pdf_links += 1
#                         attachment_key = attachment_href.split('/')[-1]
#                         item_data = item.get('data', {})
#                         year = parse_zotero_year(item_data.get('date'))
#
#                         if year and attachment_key:
#                             pdf_path = zt.get_pdf_path(attachment_key) # Use the passed client
#                             if pdf_path and Path(pdf_path).is_file():
#                                 pdf_paths_by_year[year].append(str(pdf_path))
#                                 retrieved_pdf_paths += 1
#                 except Exception as e:
#                      print(f"    Error processing item {item.get('key', 'N/A')} for PDF path: {e}") # Log errors
#
#
#             print(f"    Found {found_pdf_links} potential PDF links.")
#             print(f"    Retrieved {retrieved_pdf_paths} valid local PDF paths.")
#             if retrieved_pdf_paths > 0:
#                  pdf_paths_generated = True
#             else:
#                  print("    Warning: No valid local PDF paths found during retrieval.")
#                  pdf_paths_by_year = None # Ensure it's None if retrieval failed
#
#         # Save PDF Paths to Cache if generated and cache is enabled
#         if cache and pdf_paths_generated and pdf_paths_by_year is not None:
#             try:
#                 with open(pdf_paths_cache_file, 'wb') as f:
#                     pickle.dump(dict(pdf_paths_by_year), f) # Save as regular dict
#                 print(f"    - Saved PDF paths to {pdf_paths_cache_file.name}")
#             except Exception as e:
#                 print(f"    *** Error saving PDF paths to cache: {e}")
#
#     # 2. Generate Corpus if needed
#     if corpus_by_year is None:
#         print("  Corpus not loaded from cache. Generating from PDF paths...")
#         corpus_generated = False # Flag
#         if pdf_paths_by_year: # Check if we have paths (either from cache or generated)
#             try:
#                 corpus_by_year = create_corpus_from_pdfs(pdf_paths_by_year)
#                 if corpus_by_year:
#                     print("    Corpus created successfully.")
#                     corpus_generated = True
#                 else:
#                     print("    Warning: Corpus creation resulted in empty data.")
#                     corpus_by_year = None # Ensure it's None on failure
#             except Exception as e:
#                 print(f"  *** Error during corpus creation: {e}.")
#                 corpus_by_year = None
#         else:
#             print("    Skipping corpus creation (no PDF paths available).")
#
#         # Save Corpus to Cache if generated and cache is enabled
#         if cache and corpus_generated and corpus_by_year is not None:
#              try:
#                  with open(corpus_cache_file, 'wb') as f:
#                      pickle.dump(corpus_by_year, f)
#                  print(f"    - Saved corpus to {corpus_cache_file.name}")
#              except Exception as e:
#                  print(f"    *** Error saving corpus to cache: {e}")
#
#     # 3. Generate Preprocessed Corpus if needed
#     if preprocessed_corpus is None:
#         print("  Preprocessed corpus not loaded from cache. Generating...")
#         preprocessed_generated = False # Flag
#         if corpus_by_year : # Check if we have corpus and NLTK
#             try:
#                 print("    Preprocessing corpus text...")
#                 preprocessed_corpus = {year: preprocess_text(text) for year, text in corpus_by_year.items()}
#                 print("    Corpus preprocessing complete.")
#                 preprocessed_generated = True
#             except Exception as e:
#                 print(f"  *** Error during corpus preprocessing: {e}.")
#                 preprocessed_corpus = None
#         elif not corpus_by_year:
#             print("    Skipping preprocessing (corpus not available).")
#
#         # Save Preprocessed Corpus to Cache if generated and cache is enabled
#         if cache and preprocessed_generated and preprocessed_corpus is not None:
#              try:
#                  with open(preprocessed_corpus_cache_file, 'wb') as f:
#                      pickle.dump(preprocessed_corpus, f)
#                  print(f"    - Saved preprocessed corpus to {preprocessed_corpus_cache_file.name}")
#              except Exception as e:
#                  print(f"    *** Error saving preprocessed corpus to cache: {e}")
#
#     # --- End of Step 1b ---
#     print("Step 1b: Corpus processing complete.")
#     if not corpus_by_year:
#         print("  WARNING: Corpus is empty. Keyword frequency analysis will be skipped.")
#
#     # --- 2. Perform Core Analysis ---
#     print("Step 2: Performing core analysis...")
#     pub_trends = analyze_publication_trends(df_processed)
#     peak_year_val = pub_trends.idxmax() if not pub_trends.empty else 'N/A'
#     top_sources = analyze_top_list(df_processed, 'source', TOP_N_DEFAULT);
#     top_authors = analyze_top_list(df_processed, 'authors_list', TOP_N_DEFAULT, is_list_column=True);
#     top_keywords = analyze_top_list(df_processed, 'keywords', 15, is_list_column=True);
#     most_cited = analyze_most_cited(df_processed, TOP_N_DEFAULT);
#     top_analyzed_doc_types = analyze_top_list(df_processed, 'doc_type_readable', 5);
#     top_countries = analyze_top_list(df_processed, 'country', TOP_N_DEFAULT);
#     top_affiliations = analyze_top_list(df_processed, 'affiliation', TOP_N_DEFAULT);
#     top_funders = analyze_top_list(df_processed, 'funding_sponsor', TOP_N_DEFAULT);
#     print(f"  Core analysis complete.")
#     # --- Prepare common context elements ---
#     raw_data_sample_str = filter_zotero_for_prompt(df_processed, limit=5) # General sample
#
#     # --- 3. Generate Plots & Corresponding AI Analysis ---
#     print("Step 3: Generating plots and AI figure analysis...")
#     img_paths = {}
#     ai_figure_analysis = {}  # Store AI analysis text or placeholders
#     keyword_freq_series = None
#     actual_keyword_used = target_keyword
#     # Define placeholder text
#     ai_placeholder = "[AI Analysis Skipped (plots_only=True)]"
#
#     def run_ai_analysis(plot_key, context_text, analysis_key_suffix, vision_flag, base_output_dir, default_resp_title):
#         """ Helper to conditionally run AI analysis. """
#         if not plots_only:
#             # Only call AI if plots_only is False
#             if img_paths.get(plot_key):  # Check if the corresponding plot was generated
#                 print(f"  Calling AI for: {default_resp_title}")
#                 try:
#                     resp = call_models(ai_provider, ai_models, context_text, analysis_key_suffix,
#                                        vision=vision_flag, dynamic_image_path=img_paths[plot_key],
#                                        base_output_dir=base_output_dir)
#                     return get_ai_response_text(resp, default_resp_title)
#                 except Exception as e:
#                     print(f"  *** Error calling AI for {default_resp_title}: {e}")
#                     return f"[AI Analysis Failed: {e}]"
#             else:
#                 print(f"  Skipping AI for {default_resp_title} (required plot missing).")
#                 return "[AI Analysis Skipped (Plot Missing)]"
#         else:
#             # If plots_only is True, return placeholder
#             print(f"  Skipping AI call for {default_resp_title} (plots_only=True)")
#             return ai_placeholder
#         # 3.1 Overall Doc Types
#
#     doc_type_series = preliminary_results['doc_type_distribution'].set_index('Document Type')['Count']
#     img_paths['overall_doc_types_plot'] = plot_top_items_bar(doc_type_series.head(10),
#                                                              "Overall Document Type Distribution", "Type", "Count",
#                                                              "overall_doc_types", images_dir)
#     context_text = f"..."  # Build context as before
#     ai_figure_analysis['ai_overall_doc_types_analysis'] = run_ai_analysis(
#         'overall_doc_types_plot', context_text, "overall_doc_types_analysis", True, output_dir,
#         "Overall Doc Types Analysis"
#     )
#
#     # 3.2 Publication Trends (Line and Radar)
#     pub_trends_line_filename = "publication_trends_line"
#     pub_trends_radar_filename = "publication_trends_radar"
#     img_paths['year_trends_line_bar_plot'] = plot_publication_trends_line(pub_trends, images_dir,
#                                                                           title='Annual Publication Output',
#                                                                           filename=pub_trends_line_filename)
#     img_paths['year_trends_radar_plot'] = plot_publication_trends_radar(pub_trends, images_dir,
#                                                                         title='Publication Trend Radar',
#                                                                         filename=pub_trends_radar_filename)
#     context_text = f"..."  # Build context as before
#     ai_figure_analysis['ai_publication_trend_analysis'] = run_ai_analysis(
#         'year_trends_line_bar_plot', context_text, "publication_trend_analysis", True, output_dir,
#         "Publication Trend Analysis"
#     )
#
#     # 3.3 Top Countries
#     img_paths['top_countries_plot'] = plot_top_items_bar(top_countries, "Top Contributing Countries", "Country",
#                                                          "Count", "top_countries", images_dir)
#     context_text = f"..."  # Build context as before
#     ai_figure_analysis['ai_top_countries_analysis'] = run_ai_analysis(
#         'top_countries_plot', context_text, "top_countries_analysis", True, output_dir, "Top Countries Analysis"
#     )
#
#     # 3.4 Keywords (Cloud & Bar)
#     print("  Generating keyword analysis visuals...")
#     title_abstract_texts = df_processed['title_abstract_text'].dropna().tolist()
#     img_paths['keyword_wordcloud_plot'] = plot_word_cloud(title_abstract_texts, "title_abstract_wordcloud", images_dir)
#     img_paths['top_keywords_plot'] = plot_top_items_bar(top_keywords, "Top Keywords/Tags (from Zotero)", "Keyword/Tag",
#                                                         "Count", "top_keywords", images_dir)
#     # Determine primary image for AI vision call
#     primary_keyword_img_key = 'keyword_wordcloud_plot' if img_paths.get(
#         'keyword_wordcloud_plot') else 'top_keywords_plot'
#     context_text = f"..."  # Build context as before
#     ai_figure_analysis['ai_keyword_analysis'] = run_ai_analysis(
#         primary_keyword_img_key, context_text, "keyword_analysis", True, output_dir, "Keyword Analysis (Tags & Cloud)"
#     )
#
#     # 3.4b Keyword Frequency Trend
#     print(f"  Generating specific keyword frequency analysis for '{target_keyword}'...")
#     # ... (Your logic to get keyword_freq_series remains the same) ...
#     if corpus_by_year and target_keyword:
#         keyword_frequency_data, actual_keyword_used = analyze_keyword_frequency(corpus_by_year, preprocessed_corpus,
#                                                                                 target_keyword)
#         if keyword_frequency_data:  # Check if data was found
#             keyword_freq_series = pd.Series(keyword_frequency_data).sort_index()
#             keyword_freq_series = keyword_freq_series[keyword_freq_series.index >= year_min]
#             keyword_freq_series = keyword_freq_series[keyword_freq_series.index <= year_max]
#             if keyword_freq_series.empty: keyword_freq_series = None  # Reset if empty after filtering
#         else:
#             keyword_freq_series = None
#     else:
#         keyword_freq_series = None
#
#     # Generate plots if series exists
#     img_paths['keyword_trend_line_plot'] = None;
#     img_paths['keyword_trend_radar_plot'] = None
#     if keyword_freq_series is not None:
#         # ... (plot generation logic as before) ...
#         plot_title_line = f"Frequency Trend for Keyword: '{actual_keyword_used}'"
#         filename_base = f"keyword_trend_{re.sub(r'[^a-z0-9_]+', '', actual_keyword_used.lower())}"
#         keyword_line_filename = f"{filename_base}_line"
#         img_paths['keyword_trend_line_plot'] = plot_publication_trends_line(keyword_freq_series, images_dir,
#                                                                             title=plot_title_line,
#                                                                             filename=keyword_line_filename)
#         # (Add radar plot generation if needed)
#
#         context_text = f"..."  # Build context as before
#         ai_figure_analysis['ai_keyword_frequency_analysis'] = run_ai_analysis(
#             'keyword_trend_line_plot', context_text, "keyword_frequency_analysis", True, output_dir,
#             f"Keyword Frequency Analysis ({actual_keyword_used})"
#         )
#     else:
#         ai_figure_analysis[
#             'ai_keyword_frequency_analysis'] = "[Keyword Frequency Analysis Skipped (No Data)]"  # Placeholder if no data
#
#     # 3.4c Comparative Trend Plot
#     print(f"  Generating comparative trend plot for publications vs. '{actual_keyword_used}'...")
#     img_paths['comparative_trends_plot'] = None
#     if not pub_trends.empty and keyword_freq_series is not None:
#         # ... (plot generation logic as before) ...
#         comp_filename_base = f"comparative_trends_{re.sub(r'[^a-z0-9_]+', '', actual_keyword_used.lower())}"
#         img_paths['comparative_trends_plot'] = plot_comparative_trends_line(pub_trends, keyword_freq_series,
#                                                                             actual_keyword_used, images_dir,
#                                                                             title=f'Annual Publications vs. Frequency of "{actual_keyword_used}"',
#                                                                             filename=comp_filename_base)
#
#         context_text = f"..."  # Build context as before
#         ai_figure_analysis['ai_comparative_trends_analysis'] = run_ai_analysis(
#             'comparative_trends_plot', context_text, "comparative_trend_analysis", True, output_dir,
#             f"Comparative Trend Analysis (Pubs vs. {actual_keyword_used})"
#         )
#     else:
#         logging.warning("Skipping comparative trend plot/analysis: Missing necessary data.")
#         ai_figure_analysis['ai_comparative_trends_analysis'] = "[Comparative Analysis Skipped (Missing Data)]"
#
#     # 3.5 Co-Authorship Network
#     print("  Generating co-authorship network...")
#     coauth_graph = create_coauthorship_network(df_processed, min_collaborations=MIN_COAUTH_COLLABORATIONS)
#     img_paths['coauthorship_network_plot'] = plot_networkx_graph(coauth_graph, "Co-Authorship Network",
#                                                                  "coauthorship_network", images_dir)
#     context_text = f"..."  # Build context as before
#     ai_figure_analysis['ai_network_analysis'] = run_ai_analysis(
#         'coauthorship_network_plot', context_text, "network_analysis_coauthorship", True, output_dir, "Network Analysis"
#     )
#
#     # 3.6 Top Affiliations
#     img_paths['top_affiliations_plot'] = plot_top_items_bar(top_affiliations, "Top Contributing Affiliations",
#                                                             "Affiliation", "Count", "top_affiliations", images_dir)
#     context_text = f"..."  # Build context as before
#     ai_figure_analysis['ai_top_affiliations_analysis'] = run_ai_analysis(
#         'top_affiliations_plot', context_text, "top_affiliations_analysis", True, output_dir,
#         "Top Affiliations Analysis"
#     )
#
#     # 3.7 Top Authors (Frequency)
#     img_paths['top_authors_plot'] = plot_top_items_bar(top_authors, "Most Frequent Authors", "Author", "Count",
#                                                        "top_authors", images_dir)
#     context_text = f"..."  # Build context as before
#     ai_figure_analysis['ai_top_authors_analysis'] = run_ai_analysis(
#         'top_authors_plot', context_text, "top_authors_analysis", True, output_dir, "Top Authors Analysis"
#     )
#
#     # 3.8 Analyzed Doc Types
#     img_paths['analyzed_doc_types_plot'] = plot_top_items_bar(top_analyzed_doc_types, "Analyzed Document Types", "Type",
#                                                               "Count", "analyzed_doc_types", images_dir)
#     context_text = f"..."  # Build context as before
#     ai_figure_analysis['ai_analyzed_doc_types_analysis'] = run_ai_analysis(
#         'analyzed_doc_types_plot', context_text, "analyzed_doc_types_analysis", True, output_dir,
#         "Analyzed Doc Types Analysis"
#     )
#
#     # 3.9 Top Sources
#     img_paths['top_sources_plot'] = plot_top_items_bar(top_sources, "Top Publication Sources", "Source", "Count",
#                                                        "top_sources", images_dir)
#     context_text = f"..."  # Build context as before
#     ai_figure_analysis['ai_top_sources_analysis'] = run_ai_analysis(
#         'top_sources_plot', context_text, "top_sources_analysis", True, output_dir, "Top Sources Analysis"
#     )
#
#     # 3.10 Top Funders
#     img_paths['top_funders_plot'] = plot_top_items_bar(top_funders, "Top Funding Sponsors", "Sponsor", "Count",
#                                                        "top_funders", images_dir)
#     context_text = f"..."  # Build context as before
#     ai_figure_analysis['ai_top_funders_analysis'] = run_ai_analysis(
#         'top_funders_plot', context_text, "top_funders_analysis", True, output_dir, "Top Funders Analysis"
#     )
#
#     print("  Plot generation complete.")
#     if not plots_only:
#         print("  AI figure analysis generation phase complete.")
#     else:
#         print("  Skipped AI figure analysis generation.")
#
#     # --- 4. Generate HTML Tables --- (Keep as is, tables don't involve AI)
#     print("Step 4: Generating HTML tables...")
#     table_html = {}
#     table_html['languages_table'] = create_html_table(preliminary_results['language_distribution'],
#                                                       "Language Distribution (Initial)", add_rank_col=False)
#     table_html['top_cited_papers_table'] = create_html_table(most_cited, "Most Cited Publications (Estimated)")
#     table_html[
#         'search_strategy_table'] = "<p><i>Table 1 Placeholder: [Search strategy details need to be provided/parsed]</i></p>"
#     print("  HTML table generation complete.")
#
#     # --- 5. Prepare References List --- (Keep as is)
#     print("Step 5: Preparing references list...")
#     references_list_fmt = []
#     df_refs = pd.concat([most_cited, df_processed.sort_values('year', ascending=False)], ignore_index=True)
#     df_refs = df_refs.drop_duplicates(subset=['key']).head(REFERENCE_LIMIT)
#     for index, row in df_refs.iterrows(): references_list_fmt.append({'html_string': format_reference_html(row)})
#     print(f"  Formatted {len(references_list_fmt)} references.")
#
#     # --- 5b. Assemble Context & Generate Discussion --- Conditionally Skip AI ---
#     print("\nStep 5b: Assembling context and calling AI for Discussion section...")
#     ai_discussion = ai_placeholder  # Default to placeholder
#     if not plots_only:
#         # --- Build context (Helper and discussion_prompt_context definition needed here as before) ---
#         def get_ai_snippet(key, max_len=300):  # Define helper locally or import
#             text = ai_figure_analysis.get(key, '')  # Default to empty if placeholder
#             if text == ai_placeholder or text.startswith("[AI Analysis Skipped") or text.startswith(
#                 "[AI Analysis Failed"): return "N/A"
#             text = text.replace('<br>', ' ').replace('<i>', '').replace('</i>', '').replace('<p>', '').replace('</p>',
#                                                                                                                '').replace(
#                 '<h4>', '').replace('</h4>', '').strip()
#             return text[:max_len] + ('...' if len(text) > max_len else '')
#
#         discussion_prompt_context = f"""
#            Bibliometric Analysis Findings Summary for Discussion Generation:
#            Topic: {collection_name} ({date_range_str})
#            Data: {analyzed_count} analyzed items from Zotero Export.
#
#            Core Statistical Findings:
#            {describe_trend_data(pub_trends)} (Peak: {peak_year_val})
#            {describe_series_data(top_keywords, 'Keywords/Tags')}
#            Keyword Trend ('{actual_keyword_used}'): {describe_trend_data(keyword_freq_series) if keyword_freq_series is not None and not keyword_freq_series.empty else 'N/A'}
#            {describe_series_data(top_sources, 'Sources')}
#            {describe_series_data(top_authors, 'Authors')}
#            {describe_series_data(top_countries, 'Countries')}
#            {describe_series_data(top_affiliations, 'Affiliations')}
#            Most Cited: {most_cited['title'].iloc[0] if not most_cited.empty else 'N/A'} ({int(most_cited['citations'].iloc[0]) if not most_cited.empty else 0} citations)
#            Network: {coauth_graph.number_of_nodes()} authors, {coauth_graph.number_of_edges()} links.
#
#            AI Interpretations of Figures (Summarized - N/A if skipped):
#            - Pub Trends: {get_ai_snippet('ai_publication_trend_analysis')}
#            - Keywords: {get_ai_snippet('ai_keyword_analysis')}
#            - Keyword Freq: {get_ai_snippet('ai_keyword_frequency_analysis')}
#            - Comparative: {get_ai_snippet('ai_comparative_trends_analysis')}
#            - Network: {get_ai_snippet('ai_network_analysis')}
#            # ... Add other relevant get_ai_snippet calls ...
#
#            Sample Themes: {raw_data_sample_str}
#
#            Task: Write the 'Discussion' section... (Your full task prompt)
#            """
#         # Call AI for Discussion
#         print("  Calling AI for Discussion...")
#         try:
#             ai_discussion_response = call_models(ai_provider, ai_models, discussion_prompt_context,
#                                                  "discussion_generation", base_output_dir=output_dir)
#             ai_discussion = get_ai_response_text(ai_discussion_response, "Discussion")
#             print("  AI Discussion section generation complete.")
#         except Exception as e:
#             print(f"  *** Error calling AI for Discussion: {e}")
#             ai_discussion = "[AI Discussion Generation Failed]"
#     else:
#         print("  Skipping AI call for Discussion (plots_only=True)")
#
#     # --- 6. Assemble Full Report Context for Summary Sections --- Conditionally Skip AI ---
#     print("\nStep 6: Assembling context and calling AI for summary sections...")
#     # Set defaults first
#     ai_abstract = ai_placeholder
#     ai_introduction = ai_placeholder
#     ai_limitations = ai_placeholder
#     ai_conclusion = ai_placeholder
#
#     if not plots_only:
#         # --- Build full_report_context (as before, using get_ai_snippet) ---
#         discussion_summary_for_context = get_ai_snippet('ai_discussion',
#                                                         500) if ai_discussion != ai_placeholder else "N/A"  # Use get_ai_snippet logic
#
#         full_report_context = f"""
#            Comprehensive Bibliometric Analysis Summary for Final Sections:
#            Topic: {collection_name} ({date_range_str}) Data: {analyzed_count} items.
#            Findings Summary: Peak year {peak_year_val}. Top keywords {", ".join(top_keywords.head(3).index)}. Keyword '{actual_keyword_used}' trend analyzed. Network: {coauth_graph.number_of_nodes()} authors. Top source {top_sources.index[0] if not top_sources.empty else 'N/A'}.
#            Discussion Summary: {discussion_summary_for_context}...
#            Sample Themes: {raw_data_sample_str}
#            Task: Based ONLY on the summary, generate the specified report section...
#            """
#         # --- Call AI for Abstract, Introduction, Conclusion, Limitations ---
#         print("  Calling AI for Abstract, Introduction, Limitations, Conclusion...")
#         try:
#             ai_abstract = get_ai_response_text(
#                 call_models(ai_provider, ai_models, full_report_context, "abstract_generation",
#                             base_output_dir=output_dir), "Abstract")
#             ai_introduction = get_ai_response_text(
#                 call_models(ai_provider, ai_models, full_report_context, "introduction_generation",
#                             base_output_dir=output_dir), "Introduction")
#             # Limitations context can be static or built like others
#             limitations_context = f"Bibliometric analysis based on Zotero for '{collection_name}'. Analysis includes data completeness, potential bias, keyword limitations, network constraints."
#             ai_limitations = get_ai_response_text(
#                 call_models(ai_provider, ai_models, limitations_context, "limitations_generation",
#                             base_output_dir=output_dir), "Limitations")
#             ai_conclusion = get_ai_response_text(
#                 call_models(ai_provider, ai_models, full_report_context, "conclusion_generation",
#                             base_output_dir=output_dir), "Conclusion")
#             print("  AI summary sections generation complete.")
#         except Exception as e:
#             print(f"  *** Error calling AI for summary sections: {e}")
#             # Keep placeholders if errors occur
#             ai_abstract = ai_abstract or "[AI Abstract Generation Failed]"
#             ai_introduction = ai_introduction or "[AI Introduction Generation Failed]"
#             ai_limitations = ai_limitations or "[AI Limitations Generation Failed]"
#             ai_conclusion = ai_conclusion or "[AI Conclusion Generation Failed]"
#     else:
#         print("  Skipping AI calls for Abstract, Introduction, Limitations, Conclusion (plots_only=True)")
#
#     # --- 8. Prepare Final Template Context --- (Step numbers might shift)
#     print("\nStep X: Preparing final template context...")
#     context = {
#         # ... (metadata and basic results as before) ...
#         'topic': collection_name, 'authors_list': your_name, 'affiliation': your_affiliation,
#         'generation_date': start_time.strftime('%Y-%m-%d %H:%M:%S'),
#         'data_source_name': "Zotero Collection Export", 'date_range': date_range_str,
#         'ai_models_used': f"{ai_provider} ({ai_models.get(ai_provider, 'default')})" if not plots_only else "AI Skipped",
#         # Note if AI skipped
#         'keywords_list': ", ".join(top_keywords.head(10).index) if not top_keywords.empty else "N/A",
#         'total_docs_found': preliminary_results['total_docs_found'],
#         'analyzed_docs_count': analyzed_count, 'peak_year': peak_year_val,
#         'MIN_COAUTH_COLLABORATIONS': MIN_COAUTH_COLLABORATIONS,
#         'analyzed_keyword': actual_keyword_used,
#         'REFERENCE_LIMIT': REFERENCE_LIMIT,
#
#         # AI Content (will contain placeholders if plots_only=True)
#         'ai_abstract': ai_abstract,
#         'ai_introduction': ai_introduction,
#         'ai_discussion': ai_discussion,
#         'ai_limitations': ai_limitations,
#         'ai_conclusion': ai_conclusion,
#         **ai_figure_analysis,  # Contains placeholders or AI text
#
#         # Paths and Tables (generated regardless of plots_only)
#         **{k: str(v).replace('\\', '/') if v else None for k, v in img_paths.items()},
#         **table_html,
#
#         # Other variables
#         'geo_location_map_plot': "<p><i>[Geographical map visualization not implemented.]</i></p>",
#         'references_list': references_list_fmt, 'primary_language': DEFAULT_LANGUAGE.upper(),
#         'year_trends_table': "", 'top_authors_table': "", 'top_sources_table': "", 'doc_types_table': "",
#         'languages_table': ""
#     }
#     # Ensure all expected ai_figure_analysis keys exist in context, even if None/placeholder
#     expected_ai_keys = [
#         'ai_overall_doc_types_analysis', 'ai_publication_trend_analysis', 'ai_top_countries_analysis',
#         'ai_keyword_analysis', 'ai_keyword_frequency_analysis', 'ai_comparative_trends_analysis',
#         'ai_network_analysis', 'ai_top_affiliations_analysis', 'ai_top_authors_analysis',
#         'ai_analyzed_doc_types_analysis', 'ai_top_sources_analysis', 'ai_top_funders_analysis'
#     ]
#     for key in expected_ai_keys:
#         if key not in context:  # Add placeholder if missing after conditional logic
#             context[key] = ai_placeholder if plots_only else "[AI Analysis Not Generated]"
#
#     # --- 9. Render Template ---
#     print("Step 8: Rendering HTML report...")
#     try:
#
#         template = r"C:\Users\luano\Downloads\annotarium_package (1)\annotarium_package\src\templates\bibliographic.html"
#         rendered_html = template.render(context)
#     except Exception as e: print(f"Error rendering template: {e}"); import traceback; traceback.print_exc(); return
#
#     # --- 10. Save Output ---
#     print("Step 9: Saving final HTML file...")
#     try:
#         with open(output_html_file, 'w', encoding='utf-8') as f: f.write(rendered_html)
#         end_time = datetime.now(); print("-" * 40)
#         print(f"Report Generation Complete for '{collection_name}'")
#         print(f"  Time elapsed: {end_time - start_time}"); print(f"  HTML Report: {output_html_file.resolve()}")
#         print(f"  Images saved to: {images_dir.resolve()}"); print("-" * 40)
#     except Exception as e: print(f"Error writing HTML file: {e}")
#
#
#
# # --- Example Usage (Updated Sample Data) ---
# if __name__ == "__main__":
#
#
#     collection_name_input = "cyber attribution refined" # Or your specific topic
#     your_name_input = "Luano Rodrigues"
#     your_affiliation_input = "University College London"
#     zotero_full_data =zt.get_all_items(collection_name_input,
#                                        cache=False
#                                        )
#
#     if zotero_full_data:
#
#
#         # Call the main function, passing the zt client
#         generate_bibliometric_report(
#             zotero_items=zotero_full_data,
#             collection_name=collection_name_input,
#             ai_provider="openai",  # Or "mistral" etc.
#             # ai_models={"openai": "gpt-4-turbo-preview"},
#             your_name=your_name_input,
#             your_affiliation=your_affiliation_input,
#             target_keyword="attribution",
#             plots_only=True# Keyword for frequency analysis
#         )
#     else:
#         print("Report generation skipped due to data loading errors.")
