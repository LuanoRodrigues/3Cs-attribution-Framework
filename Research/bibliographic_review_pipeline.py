from __future__ import annotations

import argparse
import base64
import html
import io
import json
import math
import os
import re
import sys
import hashlib
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any

from jinja2 import Environment, FileSystemLoader, select_autoescape

_THIS_FILE = Path(__file__).resolve()
_REPO_ROOT = _THIS_FILE.parents[1]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))
if not os.environ.get("MPLCONFIGDIR"):
    _mpl_cfg = _REPO_ROOT / ".mplconfig"
    _mpl_cfg.mkdir(parents=True, exist_ok=True)
    os.environ["MPLCONFIGDIR"] = str(_mpl_cfg)

from Research.systematic_review_pipeline import (
    _anchor_plain_author_year_citations,
    _assert_non_placeholder_html,
    _assert_reference_and_postprocess_integrity,
    _build_dqid_evidence_payload,
    _build_reference_items,
    _citation_style_instruction,
    _clean_and_humanize_section_html,
    _clean_llm_html,
    _compute_theme_counts,
    _enrich_dqid_anchors,
    _extract_llm_text,
    _humanize_theme_tokens,
    _load_call_models_zt,
    _load_json,
    _load_section_cache,
    _make_cache_entry,
    _normalize_citation_style,
    _repo_root,
    _resolve_collection_label,
    _rq_findings_lines,
    _safe_int,
    _safe_name,
    _strict_dqid_citation_rules_text,
    _stable_section_custom_id,
    _svg_bar_chart,
    _validate_dqid_quote_page_integrity,
    _validate_section_citation_integrity,
    _validate_generated_section,
    _write_section_cache,
)
from Research.pipeline.plotly_static_figures import write_bar_chart_svg, write_network_svg
from Research.summary_utils import resolve_summary_path

_NGRAM_SOURCE_WEIGHTS = {
    "title": 4,
    "abstract": 5,
    "tags": 2,
    "evidence_quote": 1,
    "evidence_paraphrase": 1,
}

_NGRAM_STOPWORDS = {
    "the", "and", "for", "with", "that", "this", "from", "into", "their", "there", "where", "which", "while",
    "were", "have", "has", "had", "being", "been", "than", "then", "they", "them", "will", "would", "could",
    "should", "about", "under", "over", "after", "before", "between", "among", "across", "toward", "within",
    "without", "because", "through", "using", "used", "use", "also", "such", "more", "most", "many", "much",
    "some", "any", "each", "per", "via", "may", "might", "can", "cannot", "not", "its", "our", "your", "his",
    "her", "who", "whom", "whose", "what", "when", "why", "how", "all", "both", "other", "others", "new",
    "based", "paper", "study", "article", "research", "result", "finding", "findings", "approach", "method",
    "analysis", "model", "framework", "data", "author", "or", "text", "relevant", "assert", "argue", "contend",
}

_NGRAM_DOMAIN_STOPWORDS = {
    "cyber", "cyberspace", "attribution", "attack", "attacks", "attacker", "attackers", "threat",
}

_NON_NOUN_HINTS = {
    "is", "are", "was", "were", "be", "being", "been", "do", "does", "did", "done", "make", "made",
    "show", "shows", "shown", "find", "found", "use", "used", "using", "improve", "improved", "improves",
    "support", "supports", "supported", "propose", "proposed", "analyze", "analyzed", "analyses", "argue",
    "argues", "argued", "evaluate", "evaluated", "assess", "assessed",
}

_SCIENCE_MAPPING_TERMS = [
    "science mapping",
    "thematic map",
    "strategic diagram",
    "co-word analysis",
    "co word analysis",
    "cluster analysis",
    "keyword co-occurrence",
    "callon centrality",
    "callon density",
]

_NGRAM_PHRASE_BLACKLIST = {
    "author argue",
    "author assert",
    "author contend",
    "paper discuss",
    "study show",
    "study examine",
    "text assert",
    "state or",
}


def _iter_items(summary: dict[str, Any]) -> dict[str, dict[str, Any]]:
    out = summary.get("output", {}) if isinstance(summary.get("output"), dict) else {}
    npath = Path(str(out.get("normalized_results_path") or "")).expanduser()
    if not npath.is_file():
        raise RuntimeError("Missing normalized_results_path for bibliographic pipeline.")
    raw = json.loads(npath.read_text(encoding="utf-8"))
    if not isinstance(raw, dict) or not raw:
        raise RuntimeError("No normalized results available for bibliographic pipeline.")
    return raw


def _year_key(value: str) -> str:
    s = str(value or "").strip()
    if not s:
        return "Unknown"
    m = re.search(r"(19|20)\d{2}", s)
    return m.group(0) if m else s


def _extract_counters(items: dict[str, dict[str, Any]]) -> dict[str, Counter[str]]:
    years: Counter[str] = Counter()
    item_types: Counter[str] = Counter()
    authors: Counter[str] = Counter()
    affiliations: Counter[str] = Counter()
    for payload in items.values():
        md = payload.get("metadata", {}) if isinstance(payload.get("metadata"), dict) else {}
        zot = md.get("zotero_metadata", {}) if isinstance(md.get("zotero_metadata"), dict) else {}
        years[_year_key(str(md.get("year") or zot.get("date") or ""))] += 1
        item_types[_normalize_doc_type_label(str(zot.get("item_type") or "unknown"))] += 1
        first_author = str(md.get("first_author_last") or "").strip()
        if first_author:
            authors[first_author] += 1
        else:
            creators = zot.get("creators")
            if isinstance(creators, list) and creators:
                c0 = creators[0]
                if isinstance(c0, dict):
                    last = str(c0.get("lastName") or c0.get("name") or "").strip()
                    if last:
                        authors[last] += 1
        for k in ("affiliations", "affiliation"):
            vals = md.get(k)
            if isinstance(vals, list):
                for v in vals:
                    sv = str(v).strip()
                    if sv:
                        affiliations[sv] += 1
            elif isinstance(vals, str):
                sv = vals.strip()
                if sv:
                    affiliations[sv] += 1
        creators = zot.get("creators")
        if isinstance(creators, list):
            for c in creators:
                if not isinstance(c, dict):
                    continue
                for k in ("affiliation", "institution", "organization"):
                    sv = str(c.get(k) or "").strip()
                    if sv:
                        affiliations[sv] += 1
    return {
        "years": years,
        "item_types": item_types,
        "authors": authors,
        "affiliations": affiliations,
    }


def _normalize_doc_type_label(raw: str) -> str:
    s = str(raw or "").strip()
    if not s:
        return "Unknown"
    token = re.sub(r"[^a-zA-Z0-9]+", " ", s).strip()
    mapped = {
        "journalarticle": "Journal Article",
        "conferencepaper": "Conference Paper",
        "booksection": "Book Section",
        "book": "Book",
        "report": "Report",
        "thesis": "Thesis",
    }
    k = token.replace(" ", "").lower()
    if k in mapped:
        return mapped[k]
    # handle camelCase Zotero style
    token = re.sub(r"([a-z])([A-Z])", r"\1 \2", token)
    return token.title()


def _plotly_svg_inline_bar(title: str, labels: list[str], values: list[int], *, width: int = 900, height: int = 440) -> str | None:
    tmp = _repo_root() / "tmp" / f"blr_plot_{_safe_name(title)}_{width}x{height}.svg"
    try:
        tmp.parent.mkdir(parents=True, exist_ok=True)
        ok = write_bar_chart_svg(
            output_path=tmp,
            title=title,
            labels=labels,
            values=values,
            width=width,
            height=height,
        )
        if not ok or not tmp.is_file():
            return None
        return tmp.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return None


def _plotly_svg_inline_figure(fig: Any, *, width: int, height: int) -> str | None:
    try:
        import plotly.io as pio  # type: ignore
    except Exception:
        return None
    # Mirror logic used in static figure utility.
    if not str(os.environ.get("BROWSER_PATH") or "").strip():
        repo_root = _repo_root()
        for c in (
            repo_root / ".chrome-for-kaleido" / "chrome-linux64" / "chrome",
            repo_root / ".chrome-for-kaleido" / "chrome" / "chrome",
        ):
            if c.is_file():
                os.environ["BROWSER_PATH"] = str(c)
                break
    try:
        svg = pio.to_image(fig, format="svg", width=width, height=height)
        return svg.decode("utf-8", errors="ignore") if isinstance(svg, (bytes, bytearray)) else str(svg)
    except Exception:
        return None


def _demote_invalid_dqid_anchors(html_text: str) -> str:
    s = str(html_text or "")

    def _repl(match: re.Match[str]) -> str:
        tag = match.group(0)
        inner = re.sub(r"<[^>]+>", "", str(match.group(1) or "")).strip()
        href_m = re.search(r'\bhref="([^"]*)"', tag, flags=re.IGNORECASE)
        href = html.unescape(str(href_m.group(1) if href_m else "")).strip()
        if not re.match(r"^(https?|file)://", href, flags=re.IGNORECASE):
            return html.escape(inner)
        return tag

    return re.sub(
        r"<a[^>]*class=\"[^\"]*dqid-cite[^\"]*\"[^>]*>(.*?)</a>",
        _repl,
        s,
        flags=re.IGNORECASE | re.DOTALL,
    )


def _figure_embed_tag(filename: str, alt: str) -> str:
    return f"<img src=\"assets/{html.escape(filename)}\" alt=\"{html.escape(alt)}\" loading=\"lazy\" decoding=\"async\">"


def _repair_lexical_artifacts(text: str) -> str:
    s = str(text or "")
    replacements = {
        r"\bchalleng\b": "challenge",
        r"\bcountermeasur\b": "countermeasure",
        r"\bauthor argu\b": "author argue",
        r"\bauthor assert\b": "author asserts",
        r"\bauthor contend\b": "author contends",
    }
    for pat, rep in replacements.items():
        s = re.sub(pat, rep, s, flags=re.IGNORECASE)
    return s


def _clean_display_term(term: str) -> str:
    s = _repair_lexical_artifacts(_humanize_theme_tokens(str(term or "").strip()))
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _assert_bibliographic_visual_qa(assets_dir: Path, rendered_html: str) -> None:
    expected = [
        "figure_year_trends.svg",
        "figure_doc_types.svg",
        "figure_top_authors.svg",
        "figure_top_affiliations.svg",
        "figure_top_ngrams.svg",
        "figure_ngram_evolution.svg",
        "figure_corpus_terms_evolution.svg",
        "figure_corpus_term_network.svg",
        "figure_wordcloud.svg",
        "figure_theme_keywords.svg",
        "figure_strategic_diagram.svg",
    ]
    missing = [f for f in expected if not (assets_dir / f).is_file()]
    if missing:
        raise RuntimeError(f"Bibliographic visual QA failed: missing figures {missing}")
    plotly_must = [
        "figure_year_trends.svg",
        "figure_doc_types.svg",
        "figure_top_authors.svg",
        "figure_top_ngrams.svg",
        "figure_theme_keywords.svg",
        "figure_corpus_terms_evolution.svg",
        "figure_corpus_term_network.svg",
    ]
    for fn in plotly_must:
        txt = (assets_dir / fn).read_text(encoding="utf-8", errors="ignore")
        if 'class="main-svg"' not in txt:
            raise RuntimeError(f"Bibliographic visual QA failed: expected Plotly SVG for {fn}")
    wc = (assets_dir / "figure_wordcloud.svg").read_text(encoding="utf-8", errors="ignore")
    # Works for both custom SVG text cloud and image-backed wordcloud.
    text_nodes = len(re.findall(r"<text\\b", wc))
    has_img = "data:image/png;base64," in wc
    if (not has_img) and text_nodes < 20:
        raise RuntimeError("Bibliographic visual QA failed: wordcloud has too few placed terms.")
    lowered = str(rendered_html).lower()
    if re.search(r"challeng<|\bcountermeasur\b", lowered):
        raise RuntimeError("Bibliographic visual QA failed: malformed stem tokens leaked to output.")


def _svg_html_from_counter(title: str, data: Counter[str], limit: int = 12) -> str:
    if not data:
        plotly_svg = _plotly_svg_inline_bar(title, ["No data"], [0], width=900, height=440)
        if plotly_svg:
            return plotly_svg
        return _svg_bar_chart(title, ["No data"], [0], width=900, height=440)
    rows = sorted(data.items(), key=lambda kv: (-kv[1], kv[0]))[:limit]
    labels = [k for k, _ in rows]
    values = [int(round(v)) for _, v in rows]
    plotly_svg = _plotly_svg_inline_bar(title, labels, values, width=900, height=440)
    if plotly_svg:
        return plotly_svg
    return _svg_bar_chart(title, labels, values, width=900, height=440)


def _svg_html_from_year_counter(title: str, data: Counter[str], limit: int = 20) -> str:
    year_rows: list[tuple[str, int]] = []
    for k, v in data.items():
        m = re.fullmatch(r"(19|20)\d{2}", str(k).strip())
        if not m:
            continue
        year_rows.append((m.group(0), int(v)))
    if not year_rows:
        return _svg_html_from_counter(title, data, limit=limit)
    year_rows = sorted(year_rows, key=lambda kv: int(kv[0]))[-limit:]
    labels = [k for k, _ in year_rows]
    values = [v for _, v in year_rows]
    plotly_svg = _plotly_svg_inline_bar(title, labels, values, width=900, height=440)
    if plotly_svg:
        return plotly_svg
    return _svg_bar_chart(title, labels, values, width=900, height=440)


def _light_lemma(token: str) -> str:
    t = str(token or "").lower().strip("-_'")
    if len(t) <= 3:
        return t
    canonical = {
        "defence": "defense",
        "countermeasures": "countermeasure",
        "countermeasure": "countermeasure",
        "jurisprudential": "jurisprudence",
    }
    if t in canonical:
        return canonical[t]
    # Keep lexical quality high: only minimal plural handling.
    if t.endswith("ies") and len(t) > 5:
        return t[:-3] + "y"
    if t.endswith("s") and len(t) > 5 and not t.endswith("ss") and not t.endswith("us"):
        return t[:-1]
    return t


def _is_likely_noun(token: str) -> bool:
    t = str(token or "").strip().lower()
    if not t or t in _NGRAM_STOPWORDS or t in _NGRAM_DOMAIN_STOPWORDS or t in _NON_NOUN_HINTS:
        return False
    noun_suffixes = ("tion", "sion", "ment", "ness", "ity", "ship", "age", "ence", "ance", "ism", "ist", "or", "er")
    if t.endswith(noun_suffixes):
        return True
    if len(t) >= 4 and re.fullmatch(r"[a-z][a-z0-9\-]+", t):
        return True
    return False


def _optional_pos_nouns(tokens: list[str]) -> list[str]:
    # Optional POS filter: use NLTK if available, otherwise return input unchanged.
    try:
        import nltk  # type: ignore

        tagged = nltk.pos_tag(tokens)
        out = [tok for tok, pos in tagged if str(pos).startswith("NN")]
        return out or tokens
    except Exception:
        return tokens


def _tokenize_for_ngram_context_refined(text: str) -> list[str]:
    s = str(text or "").lower()
    if not s:
        return []
    out: list[str] = []
    for raw in re.findall(r"[a-z][a-z0-9\-']{1,}", s):
        tok = _light_lemma(raw)
        if len(tok) < 2 or tok.isdigit():
            continue
        if tok in _NGRAM_STOPWORDS or tok in _NGRAM_DOMAIN_STOPWORDS:
            continue
        out.append(tok)
    out = _optional_pos_nouns(out)
    return out


def _get_ngrams_from_text(text_content: str, ngram_n: int) -> list[str]:
    """Extract n-grams from a text string."""
    if not str(text_content or "").strip() or ngram_n < 1:
        return []
    tokens = _tokenize_for_ngram_context_refined(text_content)
    if len(tokens) < ngram_n:
        return []
    out: list[str] = []
    for i in range(0, len(tokens) - ngram_n + 1):
        window = tokens[i : i + ngram_n]
        noun_hits = sum(1 for tok in window if _is_likely_noun(tok))
        if noun_hits < ngram_n:
            continue
        phrase = " ".join(window)
        if phrase in _NGRAM_PHRASE_BLACKLIST:
            continue
        out.append(phrase)
    return out


def _extract_item_text_for_ngrams(payload: dict[str, Any], max_evidence_rows: int = 60) -> list[tuple[str, int]]:
    md = payload.get("metadata", {}) if isinstance(payload.get("metadata"), dict) else {}
    parts: list[tuple[str, int]] = []
    # Intentionally use corpus full-text evidence only (no title/abstract/tags).
    section_sources = []
    if isinstance(payload.get("code_pdf_page"), list):
        section_sources.extend(payload.get("code_pdf_page") or [])
    if isinstance(payload.get("section_open_coding"), list):
        section_sources.extend(payload.get("section_open_coding") or [])
    for section in section_sources:
        if not isinstance(section, dict):
            continue
        ev = section.get("evidence")
        if not isinstance(ev, list):
            continue
        for row in ev[:max_evidence_rows]:
            if not isinstance(row, dict):
                continue
            q = row.get("quote")
            p = row.get("paraphrase")
            if isinstance(q, str) and q.strip():
                parts.append((q.strip(), _NGRAM_SOURCE_WEIGHTS["evidence_quote"]))
            if isinstance(p, str) and p.strip():
                parts.append((p.strip(), _NGRAM_SOURCE_WEIGHTS["evidence_paraphrase"]))
    return parts


def _corpus_term_data_by_year(items: dict[str, dict[str, Any]]) -> dict[int, Counter[str]]:
    out: dict[int, Counter[str]] = defaultdict(Counter)
    for payload in items.values():
        if not isinstance(payload, dict):
            continue
        md = payload.get("metadata", {}) if isinstance(payload.get("metadata"), dict) else {}
        zot = md.get("zotero_metadata", {}) if isinstance(md.get("zotero_metadata"), dict) else {}
        yraw = str(md.get("year") or zot.get("date") or "")
        m = re.search(r"(19|20)\d{2}", yraw)
        if not m:
            continue
        year = int(m.group(0))
        sources = _extract_item_text_for_ngrams(payload, max_evidence_rows=120)
        item_counter: Counter[str] = Counter()
        for text_content, weight in sources:
            toks = _tokenize_for_ngram_context_refined(text_content)
            for tok in toks:
                t = _light_lemma(tok)
                if not _is_likely_noun(t):
                    continue
                if t in _NGRAM_STOPWORDS or t in _NGRAM_DOMAIN_STOPWORDS:
                    continue
                if t == "author":
                    continue
                item_counter[t] += max(1, int(weight))
        for tok, score in item_counter.items():
            out[year][tok] += min(int(score), 20)
    return out


def _corpus_term_counter(items: dict[str, dict[str, Any]]) -> Counter[str]:
    by_year = _corpus_term_data_by_year(items)
    out: Counter[str] = Counter()
    for c in by_year.values():
        out.update(c)
    # remove reporting-artifact terms that are not corpus concepts.
    for bad in ("author", "assert", "argue", "contend"):
        out.pop(bad, None)
    return out


def _corpus_term_network(items: dict[str, dict[str, Any]], *, top_terms: set[str], max_edges: int = 120) -> tuple[dict[str, int], dict[tuple[str, str], int]]:
    node_weights: Counter[str] = Counter()
    edge_weights: Counter[tuple[str, str]] = Counter()
    for payload in items.values():
        sources = _extract_item_text_for_ngrams(payload, max_evidence_rows=120)
        bag: set[str] = set()
        for text_content, _weight in sources:
            toks = _tokenize_for_ngram_context_refined(text_content)
            for tok in toks:
                t = _light_lemma(tok)
                if t not in top_terms:
                    continue
                bag.add(t)
        if not bag:
            continue
        for t in bag:
            node_weights[t] += 1
        vals = sorted(bag)
        for i in range(len(vals)):
            for j in range(i + 1, len(vals)):
                edge_weights[(vals[i], vals[j])] += 1
    edge_items = sorted(edge_weights.items(), key=lambda kv: int(kv[1]), reverse=True)[:max_edges]
    return dict(node_weights), dict(edge_items)


def _get_ngram_data_by_year(
    items: dict[str, dict[str, Any]],
    ngram_n_size: int,
) -> dict[int, Counter[str]]:
    """
    Group extracted n-grams by document year.
    Returns {year: [ngram, ...]}.
    """
    ngrams_by_year: dict[int, Counter[str]] = defaultdict(Counter)
    for payload in items.values():
        if not isinstance(payload, dict):
            continue
        md = payload.get("metadata", {}) if isinstance(payload.get("metadata"), dict) else {}
        zot = md.get("zotero_metadata", {}) if isinstance(md.get("zotero_metadata"), dict) else {}
        yraw = str(md.get("year") or zot.get("date") or "")
        m = re.search(r"(19|20)\d{2}", yraw)
        if not m:
            continue
        year = int(m.group(0))
        sources = _extract_item_text_for_ngrams(payload)
        if not sources:
            continue
        item_counter: Counter[str] = Counter()
        for text_content, weight in sources:
            if not text_content.strip():
                continue
            for ng in _get_ngrams_from_text(text_content, ngram_n_size):
                item_counter[ng] += max(1, int(weight))
        for ng, score in item_counter.items():
            # Keep document-level influence bounded to avoid single-record over-amplification.
            ngrams_by_year[year][ng] += min(int(score), 12)
    return ngrams_by_year


def _plot_ngram_evolution(
    ngrams_by_year: dict[int, Counter[str]],
    top_ngrams: list[str],
    ngram_n_size: int,
) -> str:
    """SVG line chart for yearly evolution of selected n-grams."""
    try:
        import plotly.graph_objects as go  # type: ignore
    except Exception:
        go = None

    if go is not None and ngrams_by_year and top_ngrams:
        years = sorted(ngrams_by_year.keys())
        fig = go.Figure()
        palette = ["#1d4ed8", "#059669", "#d97706", "#7c3aed", "#dc2626", "#0891b2", "#65a30d"]
        for i, ng in enumerate(top_ngrams):
            yvals = [int(ngrams_by_year[y].get(ng, 0)) for y in years]
            fig.add_trace(
                go.Scatter(
                    x=years,
                    y=yvals,
                    mode="lines+markers",
                    name=ng,
                    line=dict(color=palette[i % len(palette)], width=2.5),
                    marker=dict(size=5),
                    hovertemplate=f"{html.escape(ng)}<br>Year=%{{x}}<br>Count=%{{y}}<extra></extra>",
                )
            )
        fig.update_layout(
            template="plotly_white",
            title=dict(text=f"Evolution of Top {len(top_ngrams)} {ngram_n_size}-grams Over Time", x=0.5, xanchor="center"),
            width=980,
            height=620,
            margin=dict(l=70, r=30, t=70, b=120),
            legend=dict(orientation="h", yanchor="bottom", y=-0.34, xanchor="left", x=0.0, font=dict(size=10)),
            xaxis=dict(title="Year", tickmode="linear"),
            yaxis=dict(title="Weighted frequency", rangemode="tozero"),
            font=dict(family="Arial", size=12, color="#1F2937"),
        )
        plotly_svg = _plotly_svg_inline_figure(fig, width=980, height=620)
        if plotly_svg:
            return plotly_svg

    width, height = 980, 620
    pad_l, pad_r, pad_t, pad_b = 70, 30, 60, 165
    chart_w = width - pad_l - pad_r
    chart_h = height - pad_t - pad_b
    years = sorted(ngrams_by_year.keys())
    if not years or not top_ngrams:
        return (
            f"<svg xmlns='http://www.w3.org/2000/svg' width='{width}' height='{height}' viewBox='0 0 {width} {height}'>"
            f"<rect width='100%' height='100%' fill='#f8fafc'/>"
            f"<text x='{width/2}' y='34' text-anchor='middle' font-size='22' fill='#0f172a' font-weight='600'>Evolution of Top {ngram_n_size}-grams Over Time</text>"
            f"<text x='{width/2}' y='{height/2}' text-anchor='middle' font-size='16' fill='#475569'>No n-gram evolution data available.</text>"
            "</svg>"
        )
    per_year_counts = {y: ngrams_by_year[y] for y in years}
    max_v = max((per_year_counts[y].get(ng, 0) for y in years for ng in top_ngrams), default=1)
    if max_v < 1:
        max_v = 1
    palette = ["#1d4ed8", "#059669", "#d97706", "#7c3aed", "#dc2626", "#0891b2", "#65a30d"]
    x_span = max(len(years) - 1, 1)
    y_ticks = 5
    rows: list[str] = []
    for i in range(y_ticks + 1):
        yv = int(round((max_v * i) / y_ticks))
        y = pad_t + chart_h - int((yv / max_v) * chart_h) if max_v else pad_t + chart_h
        rows.append(f"<line x1='{pad_l}' y1='{y}' x2='{pad_l + chart_w}' y2='{y}' stroke='#e2e8f0' stroke-width='1'/>")
        rows.append(f"<text x='{pad_l - 10}' y='{y + 4}' text-anchor='end' font-size='11' fill='#475569'>{yv}</text>")
    year_tick_step = max(1, len(years) // 12)
    for idx, year in enumerate(years):
        x = pad_l + int((idx / x_span) * chart_w)
        rows.append(f"<line x1='{x}' y1='{pad_t}' x2='{x}' y2='{pad_t + chart_h}' stroke='#f1f5f9' stroke-width='1'/>")
        if idx % year_tick_step == 0 or idx == len(years) - 1:
            rows.append(f"<text x='{x}' y='{pad_t + chart_h + 22}' text-anchor='middle' font-size='11' fill='#475569'>{year}</text>")
    rows.append(f"<line x1='{pad_l}' y1='{pad_t + chart_h}' x2='{pad_l + chart_w}' y2='{pad_t + chart_h}' stroke='#334155' stroke-width='1.2'/>")
    rows.append(f"<line x1='{pad_l}' y1='{pad_t}' x2='{pad_l}' y2='{pad_t + chart_h}' stroke='#334155' stroke-width='1.2'/>")

    legend_rows: list[str] = []
    legend_cols = 2 if len(top_ngrams) > 4 else 1
    legend_col_w = 420
    for i, ng in enumerate(top_ngrams):
        color = palette[i % len(palette)]
        points: list[str] = []
        for idx, year in enumerate(years):
            x = pad_l + int((idx / x_span) * chart_w)
            v = per_year_counts[year].get(ng, 0)
            y = pad_t + chart_h - int((v / max_v) * chart_h) if max_v else pad_t + chart_h
            points.append(f"{x},{y}")
            rows.append(f"<circle cx='{x}' cy='{y}' r='2.8' fill='{color}'/>")
        rows.append(
            f"<polyline fill='none' stroke='{color}' stroke-width='2.2' points='{' '.join(points)}'/>"
        )
        row_idx = i // legend_cols
        col_idx = i % legend_cols
        lx = pad_l + 8 + (col_idx * legend_col_w)
        ly = pad_t + chart_h + 42 + (row_idx * 18)
        label = ng if len(ng) <= 42 else f"{ng[:39]}..."
        if ly < height - 6:
            legend_rows.append(f"<rect x='{lx}' y='{ly - 9}' width='10' height='10' fill='{color}'/>")
            legend_rows.append(
                f"<text x='{lx + 16}' y='{ly}' font-size='11' fill='#0f172a'>{html.escape(label)}</text>"
            )

    return (
        f"<svg xmlns='http://www.w3.org/2000/svg' width='{width}' height='{height}' viewBox='0 0 {width} {height}'>"
        f"<rect width='100%' height='100%' fill='#f8fafc'/>"
        f"<text x='{width/2}' y='34' text-anchor='middle' font-size='22' fill='#0f172a' font-weight='600'>Evolution of Top {len(top_ngrams)} {ngram_n_size}-grams Over Time</text>"
        + "".join(rows)
        + "".join(legend_rows)
        + "</svg>"
    )


def _theme_token_counter(theme_counts: dict[str, int]) -> Counter[str]:
    out: Counter[str] = Counter()
    for raw_theme, weight in theme_counts.items():
        label = str(raw_theme or "").strip().lower().replace("_", " ")
        if not label:
            continue
        for tok in re.findall(r"[a-z][a-z0-9\-]{2,}", label):
            stem = _light_lemma(tok)
            if stem in _NGRAM_STOPWORDS or stem in _NGRAM_DOMAIN_STOPWORDS:
                continue
            out[stem] += int(weight)
    return out


def _svg_wordcloud_from_counter(title: str, data: Counter[str], width: int = 980, height: int = 520, max_terms: int = 40) -> str:
    items = data.most_common(max_terms)
    if not items:
        return (
            f"<svg xmlns='http://www.w3.org/2000/svg' width='{width}' height='{height}' viewBox='0 0 {width} {height}'>"
            f"<rect width='100%' height='100%' fill='#f8fafc'/>"
            f"<text x='{width/2}' y='{height/2}' text-anchor='middle' font-size='16' fill='#475569'>No wordcloud data available.</text>"
            "</svg>"
        )
    # True wordcloud packing when library is available.
    try:
        from wordcloud import WordCloud  # type: ignore

        freqs = {k: int(v) for k, v in items if int(v) > 0}
        if freqs:
            wc = WordCloud(
                width=width,
                height=height - 36,
                background_color="#f8fafc",
                max_words=max_terms,
                random_state=42,
                collocations=False,
                prefer_horizontal=0.82,
            ).generate_from_frequencies(freqs)
            img = wc.to_image()
            bio = io.BytesIO()
            img.save(bio, format="PNG")
            payload = base64.b64encode(bio.getvalue()).decode("ascii")
            return (
                f"<svg xmlns='http://www.w3.org/2000/svg' width='{width}' height='{height}' viewBox='0 0 {width} {height}'>"
                f"<rect width='100%' height='100%' fill='#f8fafc'/>"
                f"<text x='{width/2}' y='30' text-anchor='middle' font-size='22' fill='#0f172a' font-weight='600'>{html.escape(title)}</text>"
                f"<image href='data:image/png;base64,{payload}' x='0' y='36' width='{width}' height='{height-36}' preserveAspectRatio='xMidYMid meet'/>"
                "</svg>"
            )
    except Exception:
        pass

    max_v = max(v for _, v in items) or 1
    min_v = min(v for _, v in items) or 1
    palette = ["#1d4ed8", "#0f766e", "#7c3aed", "#b45309", "#be123c", "#0369a1", "#4f46e5", "#0f766e"]
    nodes: list[str] = [
        f"<rect width='100%' height='100%' fill='#f8fafc'/>",
        f"<text x='{width/2}' y='32' text-anchor='middle' font-size='22' fill='#0f172a' font-weight='600'>{html.escape(title)}</text>",
    ]

    placed: list[tuple[float, float, float, float]] = []
    cx = width / 2.0
    cy = (height + 60) / 2.0
    margin = 10.0
    max_radius = min(width, height) * 0.52

    def _collides(box: tuple[float, float, float, float]) -> bool:
        x0, y0, x1, y1 = box
        for bx0, by0, bx1, by1 in placed:
            if not (x1 < bx0 or x0 > bx1 or y1 < by0 or y0 > by1):
                return True
        return False

    for idx, (term, score) in enumerate(items):
        norm = 0.0 if max_v == min_v else (score - min_v) / (max_v - min_v)
        fs = int(11 + (norm ** 0.78) * 28)
        rotate = 0 if (idx % 6) else -14
        est_w = max(22.0, len(term) * fs * (0.54 if rotate == 0 else 0.46))
        est_h = max(14.0, fs * (1.12 if rotate == 0 else 1.35))

        chosen: tuple[float, float] | None = None
        for step in range(0, 2400):
            a = 0.35 * step
            r = 2.1 * math.sqrt(step)
            if r > max_radius:
                break
            x = cx + r * math.cos(a)
            y = cy + r * math.sin(a)
            box = (x - est_w / 2.0, y - est_h / 2.0, x + est_w / 2.0, y + est_h / 2.0)
            if box[0] < margin or box[1] < 48 or box[2] > (width - margin) or box[3] > (height - margin):
                continue
            if _collides(box):
                continue
            chosen = (x, y)
            placed.append(box)
            break
        if chosen is None:
            # Controlled fallback near lower band for terms that couldn't be placed.
            x = margin + ((idx % 10) + 0.5) * ((width - (2 * margin)) / 10.0)
            y = height - 18 - (idx // 10) * 16
            if y < 58:
                continue
            chosen = (x, y)
        x, y = chosen
        clr = palette[idx % len(palette)]
        transform = f" transform='rotate({rotate} {x:.1f} {y:.1f})'" if rotate else ""
        nodes.append(
            f"<text x='{x:.1f}' y='{y:.1f}' text-anchor='middle' font-size='{fs}' fill='{clr}' opacity='0.92'{transform}>{html.escape(term)}</text>"
        )
    return f"<svg xmlns='http://www.w3.org/2000/svg' width='{width}' height='{height}' viewBox='0 0 {width} {height}'>" + "".join(nodes) + "</svg>"


def _extract_theme_sets(items: dict[str, dict[str, Any]]) -> list[set[str]]:
    sets: list[set[str]] = []
    for payload in items.values():
        if not isinstance(payload, dict):
            continue
        bag: set[str] = set()
        def _collect_from_evidence_row(ev: dict[str, Any]) -> None:
            themes = ev.get("potential_themes")
            if isinstance(themes, list):
                for t in themes:
                    s = str(t or "").strip().lower()
                    if s:
                        bag.add(s)
        for ev in payload.get("evidence_list", []) if isinstance(payload.get("evidence_list"), list) else []:
            if isinstance(ev, dict):
                _collect_from_evidence_row(ev)
        for section in payload.get("code_pdf_page", []) if isinstance(payload.get("code_pdf_page"), list) else []:
            if not isinstance(section, dict):
                continue
            rows = section.get("evidence")
            if not isinstance(rows, list):
                continue
            for ev in rows:
                if isinstance(ev, dict):
                    _collect_from_evidence_row(ev)
        if bag:
            sets.append(bag)
    return sets


def _compute_callon_metrics(theme_counts: Counter[str], theme_sets: list[set[str]]) -> list[dict[str, float | str]]:
    cooc: Counter[tuple[str, str]] = Counter()
    for tset in theme_sets:
        vals = sorted([t for t in tset if t in theme_counts])
        for i in range(len(vals)):
            for j in range(i + 1, len(vals)):
                cooc[(vals[i], vals[j])] += 1
    metrics: list[dict[str, float | str]] = []
    for theme, size in theme_counts.items():
        neighbors: list[tuple[str, int]] = []
        for (a, b), w in cooc.items():
            if a == theme:
                neighbors.append((b, w))
            elif b == theme:
                neighbors.append((a, w))
        centrality = float(sum(w for _, w in neighbors))
        if neighbors:
            density = float(sum(w for _, w in neighbors) / len(neighbors))
        else:
            density = 0.0
        metrics.append(
            {
                "theme": theme,
                "size": float(size),
                "centrality": centrality,
                "density": density,
            }
        )
    return sorted(metrics, key=lambda x: float(x["size"]), reverse=True)


def _svg_strategic_diagram(metrics: list[dict[str, float | str]], width: int = 980, height: int = 560) -> str:
    if not metrics:
        return (
            f"<svg xmlns='http://www.w3.org/2000/svg' width='{width}' height='{height}' viewBox='0 0 {width} {height}'>"
            f"<rect width='100%' height='100%' fill='#f8fafc'/>"
            f"<text x='{width/2}' y='{height/2}' text-anchor='middle' font-size='16' fill='#475569'>No strategic mapping data available.</text>"
            "</svg>"
        )
    try:
        import plotly.graph_objects as go  # type: ignore
    except Exception:
        go = None
    if go is not None:
        xs = [float(m.get("centrality") or 0.0) for m in metrics[:20]]
        ys = [float(m.get("density") or 0.0) for m in metrics[:20]]
        ss = [float(m.get("size") or 1.0) for m in metrics[:20]]
        labels = [str(m.get("theme") or "") for m in metrics[:20]]
        max_s = max(ss) if ss else 1.0
        marker_sizes = [12.0 + 34.0 * (s / max_s) for s in ss]
        avg_x = sum(xs) / max(len(xs), 1)
        avg_y = sum(ys) / max(len(ys), 1)
        fig = go.Figure(
            data=[
                go.Scatter(
                    x=xs,
                    y=ys,
                    text=labels,
                    mode="markers+text",
                    textposition="top center",
                    marker=dict(size=marker_sizes, color=ss, colorscale="Blues", showscale=True, colorbar=dict(title="Theme size"), line=dict(color="#1E3A8A", width=0.8), opacity=0.75),
                    hovertemplate="Theme=%{text}<br>Centrality=%{x:.2f}<br>Density=%{y:.2f}<extra></extra>",
                )
            ]
        )
        fig.add_vline(x=avg_x, line_dash="dash", line_color="#94A3B8")
        fig.add_hline(y=avg_y, line_dash="dash", line_color="#94A3B8")
        fig.update_layout(
            template="plotly_white",
            title=dict(text="Thematic Strategic Diagram (Callon Centrality vs Density)", x=0.5, xanchor="center"),
            width=width,
            height=height,
            margin=dict(l=70, r=40, t=70, b=60),
            xaxis=dict(title="Centrality"),
            yaxis=dict(title="Density"),
            font=dict(family="Arial", size=12, color="#1F2937"),
        )
        plotly_svg = _plotly_svg_inline_figure(fig, width=width, height=height)
        if plotly_svg:
            return plotly_svg

    pad_l, pad_r, pad_t, pad_b = 80, 40, 60, 90
    chart_w = width - pad_l - pad_r
    chart_h = height - pad_t - pad_b
    max_c = max(float(x["centrality"]) for x in metrics) or 1.0
    max_d = max(float(x["density"]) for x in metrics) or 1.0
    avg_c = sum(float(x["centrality"]) for x in metrics) / max(len(metrics), 1)
    avg_d = sum(float(x["density"]) for x in metrics) / max(len(metrics), 1)
    nodes: list[str] = [
        f"<rect width='100%' height='100%' fill='#f8fafc'/>",
        "<text x='490' y='34' text-anchor='middle' font-size='22' fill='#0f172a' font-weight='600'>Thematic Strategic Diagram (Callon Centrality vs Density)</text>",
        f"<rect x='{pad_l}' y='{pad_t}' width='{chart_w}' height='{chart_h}' fill='#ffffff' stroke='#cbd5e1'/>",
    ]
    x_mid = pad_l + int((avg_c / max_c) * chart_w) if max_c else pad_l + chart_w // 2
    y_mid = pad_t + chart_h - int((avg_d / max_d) * chart_h) if max_d else pad_t + chart_h // 2
    nodes.append(f"<line x1='{x_mid}' y1='{pad_t}' x2='{x_mid}' y2='{pad_t + chart_h}' stroke='#94a3b8' stroke-dasharray='5,5'/>")
    nodes.append(f"<line x1='{pad_l}' y1='{y_mid}' x2='{pad_l + chart_w}' y2='{y_mid}' stroke='#94a3b8' stroke-dasharray='5,5'/>")
    nodes.append(f"<text x='{pad_l + chart_w - 8}' y='{pad_t + chart_h + 26}' text-anchor='end' font-size='12' fill='#334155'>Centrality</text>")
    nodes.append(f"<text x='{pad_l - 56}' y='{pad_t + 16}' text-anchor='start' font-size='12' fill='#334155'>Density</text>")
    palette = ["#1d4ed8", "#059669", "#d97706", "#7c3aed", "#dc2626", "#0891b2", "#65a30d", "#be123c"]
    max_s = max(float(x["size"]) for x in metrics) or 1.0
    for idx, row in enumerate(metrics[:20]):
        c = float(row["centrality"])
        d = float(row["density"])
        s = float(row["size"])
        x = pad_l + int((c / max_c) * chart_w) if max_c else pad_l
        y = pad_t + chart_h - int((d / max_d) * chart_h) if max_d else pad_t + chart_h
        r = 6 + int((s / max_s) * 18)
        clr = palette[idx % len(palette)]
        label = str(row["theme"])
        nodes.append(f"<circle cx='{x}' cy='{y}' r='{r}' fill='{clr}' fill-opacity='0.28' stroke='{clr}' stroke-width='1.4'/>")
        nodes.append(f"<text x='{x + r + 4}' y='{y + 4}' font-size='11' fill='#0f172a'>{html.escape(label)}</text>")
    nodes.append(f"<text x='{pad_l + 12}' y='{pad_t + 20}' font-size='11' fill='#334155'>Niche themes</text>")
    nodes.append(f"<text x='{pad_l + chart_w - 120}' y='{pad_t + 20}' font-size='11' fill='#334155'>Motor themes</text>")
    nodes.append(f"<text x='{pad_l + 12}' y='{pad_t + chart_h - 10}' font-size='11' fill='#334155'>Emerging/declining</text>")
    nodes.append(f"<text x='{pad_l + chart_w - 170}' y='{pad_t + chart_h - 10}' font-size='11' fill='#334155'>Basic/transversal</text>")
    return f"<svg xmlns='http://www.w3.org/2000/svg' width='{width}' height='{height}' viewBox='0 0 {width} {height}'>" + "".join(nodes) + "</svg>"


def _extract_science_mapping_mentions(items: dict[str, dict[str, Any]]) -> list[str]:
    corpus: list[str] = []
    for payload in items.values():
        md = payload.get("metadata", {}) if isinstance(payload.get("metadata"), dict) else {}
        zot = md.get("zotero_metadata", {}) if isinstance(md.get("zotero_metadata"), dict) else {}
        for key in ("title", "abstract"):
            v = zot.get(key) or md.get(key)
            if isinstance(v, str) and v.strip():
                corpus.append(v.lower())
    full = "\n".join(corpus)
    hits = [term for term in _SCIENCE_MAPPING_TERMS if term in full]
    return hits


def _discover_summary_for_collection(collection_name: str, *, search_roots: list[Path] | None = None) -> Path | None:
    name = str(collection_name or "").strip()
    if not name:
        return None
    safe = _safe_name(name).lower()
    roots = search_roots or [
        _repo_root() / "Research" / "outputs",
        _repo_root() / "tmp" / "systematic_review" / "synthesis",
        _repo_root() / "tmp" / "systematic_review" / "synthesis_auto",
    ]
    candidates: list[Path] = []
    for root in roots:
        if not root.is_dir():
            continue
        for fp in root.rglob("*summary*.json"):
            if fp.is_file():
                candidates.append(fp)
        for fp in root.rglob("synthesis_summary.json"):
            if fp.is_file():
                candidates.append(fp)
    best: Path | None = None
    best_mtime = -1.0
    for fp in candidates:
        try:
            payload = json.loads(fp.read_text(encoding="utf-8"))
        except Exception:
            continue
        if not isinstance(payload, dict):
            continue
        cname = str(payload.get("collection_name") or "").strip()
        if not cname:
            continue
        match = cname.lower() == name.lower() or _safe_name(cname).lower() == safe
        if not match:
            continue
        mtime = fp.stat().st_mtime
        if mtime > best_mtime:
            best = fp
            best_mtime = mtime
    return best


def _build_summary_from_coded_dir(
    *,
    collection_name: str,
    coded_dir: Path,
    outputs_root: Path,
    model: str,
) -> Path:
    from Research.sinthesis_legacy.synthesis import run_synthesis  # type: ignore

    if not coded_dir.is_dir():
        raise FileNotFoundError(f"Coded directory not found: {coded_dir}")
    out_dir = _repo_root() / "tmp" / "systematic_review" / "synthesis_auto" / _safe_name(collection_name)
    result = run_synthesis(
        collection_name=collection_name,
        output_dir=out_dir,
        results_by_item_path=None,
        coded_dir=coded_dir,
        batch_size=50,
        top_n_per_score=50,
        score_key_format="int",
        cache=False,
        min_relevance=1,
        require_quote=False,
        dedupe=True,
        template_path=_repo_root() / "Research" / "templates" / "systematic_review.html",
        outputs_root=outputs_root,
        use_llm_sections=False,
        llm_model=model,
    )
    path = Path(str(result.get("summary_path") or "")).expanduser().resolve()
    if not path.is_file():
        raise RuntimeError("Auto-built summary did not produce a valid summary_path.")
    return path


def _run_grouped_batch_sections(
    *,
    collection_name: str,
    model: str,
    function_name: str,
    section_prompts: list[tuple[str, str]],
) -> dict[str, str]:
    if not os.getenv("BATCH_ROOT"):
        os.environ["BATCH_ROOT"] = str((_repo_root() / "tmp").resolve())
    call_models_zt = _load_call_models_zt()
    llms_dir = _repo_root() / "python_backend_legacy" / "llms"
    if str(llms_dir) not in sys.path:
        sys.path.insert(0, str(llms_dir))
    import calling_models as cm  # type: ignore

    safe_collection = cm.safe_name(collection_name) if hasattr(cm, "safe_name") else _safe_name(collection_name)
    safe_function = cm.safe_name(function_name) if hasattr(cm, "safe_name") else _safe_name(function_name)
    batch_root = cm.get_batch_root() if hasattr(cm, "get_batch_root") else (_repo_root() / "tmp" / "batching_files" / "batches")
    func_dir = Path(batch_root) / safe_function
    func_dir.mkdir(parents=True, exist_ok=True)
    input_file = func_dir / f"{safe_collection}_{safe_function}_input.jsonl"
    output_file = func_dir / f"{safe_collection}_{safe_function}_output.jsonl"
    meta_file = func_dir / f"{safe_collection}_{safe_function}_batch_metadata.json"
    sig_file = func_dir / f"{safe_collection}_{safe_function}_request_signature.json"

    expected_jobs: list[tuple[str, str, str]] = []
    expected_ids: list[str] = []
    for section_name, prompt in section_prompts:
        cid = _stable_section_custom_id(collection_name, section_name, prompt)
        expected_jobs.append((section_name, prompt, cid))
        expected_ids.append(cid)
    sig_payload = {"custom_ids": expected_ids}
    sig_hash = hashlib.sha256(json.dumps(sig_payload, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()

    reuse_existing = False
    if input_file.exists() and meta_file.exists() and sig_file.exists():
        try:
            old_sig = json.loads(sig_file.read_text(encoding="utf-8"))
            if str(old_sig.get("signature") or "") == sig_hash:
                reuse_existing = True
        except Exception:
            reuse_existing = False
    if not reuse_existing:
        for fp in (input_file, output_file, meta_file, sig_file):
            if fp.exists():
                fp.unlink()
        sig_file.write_text(json.dumps({"signature": sig_hash, **sig_payload}, ensure_ascii=False, indent=2), encoding="utf-8")

    pending: list[tuple[str, str]] = []
    for section_name, prompt, custom_id in expected_jobs:
        pending.append((section_name, custom_id))
        if reuse_existing:
            continue
        _ = call_models_zt(
            text=prompt,
            function=function_name,
            custom_id=custom_id,
            collection_name=collection_name,
            model=model,
            ai="openai",
            read=False,
            store_only=True,
            cache=False,
        )

    ok = cm._process_batch_for(analysis_key_suffix=function_name, section_title=safe_collection, poll_interval=30)
    if ok is not True:
        raise RuntimeError(f"Grouped batch failed for collection={collection_name}, function={function_name}")

    out: dict[str, str] = {}
    for section_name, custom_id in pending:
        response = cm.read_completion_results(custom_id=custom_id, path=str(output_file), function=function_name)
        out[section_name] = _extract_llm_text(response)
    return out


def _rewrite_section_prompt(
    *,
    section_name: str,
    base_instruction: str,
    payload: dict[str, Any],
    citation_instruction: str,
    strict_rules: str,
    validation_error: str,
    previous_output: str,
) -> str:
    return (
        f"SECTION_NAME\n{section_name}\n\n"
        f"INSTRUCTION\n{base_instruction}\n\n"
        f"CONTEXT_JSON\n{json.dumps(payload, ensure_ascii=False, indent=2)}\n\n"
        f"PREVIOUS_OUTPUT\n{previous_output}\n\n"
        f"VALIDATION_ERROR\n{validation_error}\n\n"
        "REVISION_RULES\nRewrite the section to satisfy validation constraints and preserve evidence grounding.\n"
        "If a citation cannot be mapped to provided evidence_payload dqids, remove that citation and rewrite the sentence.\n"
        "Never invent author-year citations.\n\n"
        f"{strict_rules}\n\n"
        "STYLE_GUARD\nWrite formal publication prose only. Do not mention prompts/context JSON/AI.\n\n"
        f"CITATION_STYLE\n{citation_instruction}\n\n"
        "Return only raw HTML snippets, no markdown fences."
    )


def render_bibliographic_review_from_summary(
    *,
    summary: dict[str, Any],
    template_path: Path,
    outputs_root: Path,
    model: str = "gpt-5-mini",
    citation_style: str = "apa",
) -> dict[str, str]:
    raw_collection_name = str(summary.get("collection_name") or "").strip()
    if not raw_collection_name:
        raise ValueError("summary.collection_name is required")
    collection_name = _resolve_collection_label(raw_collection_name)
    output_dir = outputs_root / _safe_name(collection_name) / "BLR"
    output_dir.mkdir(parents=True, exist_ok=True)
    assets_dir = output_dir / "assets"
    assets_dir.mkdir(parents=True, exist_ok=True)
    section_cache_path = output_dir / "section_generation_cache.json"
    section_cache_entries, section_cache, cache_dirty = _load_section_cache(section_cache_path)
    if cache_dirty:
        _write_section_cache(section_cache_path, section_cache_entries)

    citation_style = _normalize_citation_style(citation_style)
    ev_stats = (((summary.get("input") or {}).get("evidence_normalization") or {}) if isinstance(summary.get("input"), dict) else {})
    item_count = _safe_int(((summary.get("input") or {}).get("item_count") if isinstance(summary.get("input"), dict) else 0), 0)
    rq_lines = _rq_findings_lines(summary)
    theme_counts = _compute_theme_counts(summary)
    dq_payload, dq_lookup = _build_dqid_evidence_payload(summary, max_rows=350)
    items = _iter_items(summary)
    counters = _extract_counters(items)

    year_labels = [y for y in counters["years"].keys() if re.fullmatch(r"(19|20)\d{2}", y)]
    years_sorted = sorted(year_labels)
    date_range = f"{years_sorted[0]}-{years_sorted[-1]}" if years_sorted else "N/A"

    year_svg = _svg_html_from_year_counter("Annual publication output", counters["years"], limit=20)
    doc_svg = _svg_html_from_counter("Document type distribution", counters["item_types"], limit=12)
    author_svg = _svg_html_from_counter("Top authors", counters["authors"], limit=12)
    aff_svg = _svg_html_from_counter("Top affiliations", counters["affiliations"], limit=12)
    ngram_n_size = 2
    ngrams_by_year = _get_ngram_data_by_year(items, ngram_n_size)
    ngram_counts: Counter[str] = Counter()
    for bucket in ngrams_by_year.values():
        ngram_counts.update(bucket)
    ngram_counts = Counter({k: v for k, v in ngram_counts.items() if v >= 4})
    ngram_counts = Counter({k: v for k, v in ngram_counts.items() if not str(k).lower().startswith("author ")})
    top_ngrams = [k for k, _ in ngram_counts.most_common(12)]
    top_ngrams_for_evo = [k for k, _ in ngram_counts.most_common(6)]
    ngram_svg = _svg_html_from_counter(f"Top {ngram_n_size}-gram keyword phrases", ngram_counts, limit=12)
    ngram_evolution_svg = _plot_ngram_evolution(ngrams_by_year, top_ngrams_for_evo, ngram_n_size)
    corpus_term_counts = _corpus_term_counter(items)
    corpus_terms_by_year = _corpus_term_data_by_year(items)
    top_corpus_terms_for_evo = [k for k, _ in corpus_term_counts.most_common(6)]
    top_corpus_terms_for_network = {k for k, _ in corpus_term_counts.most_common(20)}
    corpus_node_weights, corpus_edges = _corpus_term_network(items, top_terms=top_corpus_terms_for_network, max_edges=120)
    corpus_terms_evolution_svg = _plot_ngram_evolution(corpus_terms_by_year, top_corpus_terms_for_evo, 1)
    theme_token_counts = corpus_term_counts
    wordcloud_svg = _svg_wordcloud_from_counter("Corpus Text Wordcloud (Full-Text Evidence)", theme_token_counts, max_terms=56)
    theme_keywords_svg = _svg_html_from_counter("Corpus Term Frequency (Full-Text Evidence)", theme_token_counts, limit=16)
    theme_sets = _extract_theme_sets(items)
    top_theme_counts = Counter(dict(Counter(theme_counts).most_common(14)))
    strategic_metrics = _compute_callon_metrics(top_theme_counts, theme_sets)
    strategic_diagram_svg = _svg_strategic_diagram(strategic_metrics)
    co_word_links = []
    for row in strategic_metrics[:10]:
        co_word_links.append(f"{row['theme']} (centrality={int(float(row['centrality']))}, density={float(row['density']):.1f})")
    mapping_mentions = _extract_science_mapping_mentions(items)
    (assets_dir / "figure_year_trends.svg").write_text(year_svg, encoding="utf-8")
    (assets_dir / "figure_doc_types.svg").write_text(doc_svg, encoding="utf-8")
    (assets_dir / "figure_top_authors.svg").write_text(author_svg, encoding="utf-8")
    (assets_dir / "figure_top_affiliations.svg").write_text(aff_svg, encoding="utf-8")
    (assets_dir / "figure_top_ngrams.svg").write_text(ngram_svg, encoding="utf-8")
    (assets_dir / "figure_ngram_evolution.svg").write_text(ngram_evolution_svg, encoding="utf-8")
    (assets_dir / "figure_corpus_terms_evolution.svg").write_text(corpus_terms_evolution_svg, encoding="utf-8")
    corpus_network_path = assets_dir / "figure_corpus_term_network.svg"
    ok_corpus_net = write_network_svg(
        output_path=corpus_network_path,
        title="Corpus Term Co-occurrence Network (Full-Text Evidence)",
        node_weights=corpus_node_weights,
        edges=corpus_edges,
        width=980,
        height=620,
    )
    if not ok_corpus_net:
        fallback_net = (
            "<svg xmlns='http://www.w3.org/2000/svg' width='980' height='620' viewBox='0 0 980 620'>"
            "<rect width='100%' height='100%' fill='#f8fafc'/>"
            "<text x='490' y='42' text-anchor='middle' font-size='22' fill='#0f172a' font-weight='600'>Corpus Term Co-occurrence Network (Full-Text Evidence)</text>"
            "<text x='490' y='316' text-anchor='middle' font-size='16' fill='#475569'>Network rendering unavailable in this environment.</text>"
            "</svg>"
        )
        corpus_network_path.write_text(fallback_net, encoding="utf-8")
    (assets_dir / "figure_wordcloud.svg").write_text(wordcloud_svg, encoding="utf-8")
    (assets_dir / "figure_theme_keywords.svg").write_text(theme_keywords_svg, encoding="utf-8")
    (assets_dir / "figure_strategic_diagram.svg").write_text(strategic_diagram_svg, encoding="utf-8")

    payload_base = {
        "collection_name": collection_name,
        "overarching_theme": collection_name,
        "item_count": item_count,
        "evidence_kept": _safe_int(ev_stats.get("evidence_kept"), 0),
        "rq_findings": [_humanize_theme_tokens(x) for x in rq_lines],
        "top_themes": [{_humanize_theme_tokens(k): v} for k, v in list(theme_counts.items())[:20]],
        "citation_style": citation_style,
        "evidence_payload": dq_payload,
        "figures": {
            "years_top": counters["years"].most_common(10),
            "item_types_top": counters["item_types"].most_common(10),
            "authors_top": counters["authors"].most_common(10),
            "affiliations_top": counters["affiliations"].most_common(10),
            "ngrams_top": ngram_counts.most_common(10),
            "theme_keywords_top": theme_token_counts.most_common(12),
            "corpus_terms_top": theme_token_counts.most_common(12),
            "corpus_term_network_nodes_top": sorted(corpus_node_weights.items(), key=lambda kv: kv[1], reverse=True)[:12],
            "strategic_metrics_top": strategic_metrics[:10],
        },
    }
    citation_instruction = _citation_style_instruction(citation_style)
    strict_rules = _strict_dqid_citation_rules_text(citation_style)

    section_specs = {
        "methodology_review": {"min": 160, "max": 900},
        "results_overview": {"min": 200, "max": 1200},
        "discussion": {"min": 220, "max": 1200},
        "limitations": {"min": 140, "max": 900},
        "ai_timeline_analysis": {"min": 80, "max": 500},
        "ai_analyzed_doc_types_analysis": {"min": 80, "max": 500},
        "ai_author_graph_analysis": {"min": 80, "max": 500},
        "ai_top_affiliations_analysis": {"min": 80, "max": 500},
        "ai_ngram_keywords_analysis": {"min": 80, "max": 500},
        "ai_theme_keywords_analysis": {"min": 80, "max": 500},
        "ai_corpus_text_analysis": {"min": 80, "max": 600},
        "ai_science_mapping_analysis": {"min": 80, "max": 500},
        "introduction": {"min": 200, "max": 1200},
        "conclusion": {"min": 180, "max": 900},
        "abstract": {"min": 180, "max": 420, "forbid_h4": True},
    }

    phase1_instructions = {
        "methodology_review": "Write bibliographic methodology prose covering dataset origin, coding basis, and how figures summarize the coded corpus. Formal publication prose only.",
        "results_overview": "Write a results overview integrating trends, document types, and author/institution concentration from coded metadata. Use 1-3 evidence anchors per paragraph.",
        "discussion": "Write discussion interpreting bibliographic patterns and implications for the theme. Use 1-3 evidence anchors per paragraph.",
        "limitations": "Write limitations tied to metadata quality, coverage, and coding constraints. Use 1-2 evidence anchors per paragraph.",
        "ai_timeline_analysis": "Write a short interpretation of temporal publication trend figure. Use concise paragraph prose.",
        "ai_analyzed_doc_types_analysis": "Write a short interpretation of document type distribution figure. Use concise paragraph prose.",
        "ai_author_graph_analysis": "Write a short interpretation of author concentration figure. Use concise paragraph prose.",
        "ai_top_affiliations_analysis": "Write a short interpretation of affiliation concentration figure. Use concise paragraph prose.",
        "ai_ngram_keywords_analysis": "Write a short interpretation of n-gram keyword frequency and temporal evolution figures. Use concise paragraph prose.",
        "ai_theme_keywords_analysis": "Write a short interpretation of theme keyword frequency and wordcloud figures. Use concise paragraph prose.",
        "ai_corpus_text_analysis": "Write a short interpretation of full-corpus text lexical figures (term evolution, co-occurrence network, wordcloud, term frequency). Emphasize that these are from full-text coded evidence, not titles/abstracts.",
        "ai_science_mapping_analysis": "Write a short interpretation of strategic diagram (Callon centrality/density), co-word clusters, and research-area quadrants. Use concise paragraph prose.",
    }

    llm_sections: dict[str, str] = {}
    phase1_prompts: list[tuple[str, str]] = []
    phase1_payload_by_section: dict[str, dict[str, Any]] = {}
    evidence_heavy_sections = {"methodology_review", "results_overview", "discussion", "limitations"}
    for section_name, instruction in phase1_instructions.items():
        if section_name in section_cache:
            cached = _enrich_dqid_anchors(_clean_and_humanize_section_html(section_cache[section_name]), dq_lookup, citation_style=citation_style)
            cached = _repair_lexical_artifacts(cached)
            cached = _demote_invalid_dqid_anchors(cached)
            try:
                cached = _validate_section_citation_integrity(section_name, cached, dq_lookup, citation_style=citation_style)
                _validate_generated_section(section_name, cached, section_specs[section_name])
                llm_sections[section_name] = cached
                continue
            except Exception:
                section_cache.pop(section_name, None)
                section_cache_entries.pop(section_name, None)
        section_payload = dict(payload_base)
        if section_name not in evidence_heavy_sections:
            section_payload["evidence_payload"] = []
        phase1_payload_by_section[section_name] = section_payload
        prompt = (
            f"SECTION_NAME\n{section_name}\n\n"
            f"INSTRUCTION\n{instruction}\n\n"
            f"CONTEXT_JSON\n{json.dumps(section_payload, ensure_ascii=False, indent=2)}\n\n"
            f"{strict_rules}\n\n"
            "STYLE_GUARD\nWrite formal publication prose only. Do not mention prompts/context JSON/AI.\n\n"
            f"CITATION_STYLE\n{citation_instruction}\n\n"
            "Return only raw HTML snippets, no markdown fences."
        )
        phase1_prompts.append((section_name, prompt))
    if phase1_prompts:
        phase1_raw = _run_grouped_batch_sections(
            collection_name=collection_name,
            model=model,
            function_name="bibliographic_review_section_writer",
            section_prompts=phase1_prompts,
        )
        for section_name, raw_html in phase1_raw.items():
            cleaned = _enrich_dqid_anchors(_clean_and_humanize_section_html(_clean_llm_html(raw_html)), dq_lookup, citation_style=citation_style)
            cleaned = _repair_lexical_artifacts(cleaned)
            cleaned = _demote_invalid_dqid_anchors(cleaned)
            cleaned = _validate_section_citation_integrity(section_name, cleaned, dq_lookup, citation_style=citation_style)
            try:
                _validate_generated_section(section_name, cleaned, section_specs[section_name])
            except Exception as exc:
                last_err = str(exc)
                prev = cleaned
                ok = False
                section_payload = phase1_payload_by_section.get(section_name, payload_base)
                for attempt in range(2, 4):
                    retry_prompt = _rewrite_section_prompt(
                        section_name=section_name,
                        base_instruction=phase1_instructions.get(section_name, ""),
                        payload=section_payload if isinstance(section_payload, dict) else payload_base,
                        citation_instruction=citation_instruction,
                        strict_rules=strict_rules,
                        validation_error=last_err,
                        previous_output=prev,
                    )
                    retry_raw = _run_grouped_batch_sections(
                        collection_name=f"{collection_name}_retry_{section_name}_a{attempt}",
                        model=model,
                        function_name="bibliographic_review_section_writer",
                        section_prompts=[(section_name, retry_prompt)],
                    ).get(section_name, "")
                    prev = _enrich_dqid_anchors(
                        _clean_and_humanize_section_html(_clean_llm_html(retry_raw)),
                        dq_lookup,
                        citation_style=citation_style,
                    )
                    prev = _repair_lexical_artifacts(prev)
                    prev = _demote_invalid_dqid_anchors(prev)
                    prev = _validate_section_citation_integrity(section_name, prev, dq_lookup, citation_style=citation_style)
                    try:
                        _validate_generated_section(section_name, prev, section_specs[section_name])
                        cleaned = prev
                        ok = True
                        break
                    except Exception as retry_exc:
                        last_err = str(retry_exc)
                if not ok:
                    raise RuntimeError(f"Section {section_name} failed after retries: {last_err}")
            llm_sections[section_name] = cleaned
            section_cache[section_name] = cleaned
            section_cache_entries[section_name] = _make_cache_entry(
                section_name=section_name,
                html_text=cleaned,
                model=model,
            )
        _write_section_cache(section_cache_path, section_cache_entries)

    whole_paper_payload = {
        **payload_base,
        "draft_sections_html": {k: llm_sections[k] for k in phase1_instructions if k in llm_sections},
        "draft_sections_text": {k: re.sub(r"<[^>]+>", " ", llm_sections[k]) for k in phase1_instructions if k in llm_sections},
    }
    phase2_instructions = {
        "introduction": "Write the bibliographic introduction focused on the overarching theme and why bibliographic mapping is needed. Paragraph prose only.",
        "conclusion": "Write the bibliographic conclusion with concrete takeaways and next-step implications. Paragraph prose only.",
        "abstract": "Write a professional single-block abstract paragraph covering background, methods, results, and conclusions. Paragraph prose only.",
    }
    phase2_prompts: list[tuple[str, str]] = []
    for section_name, instruction in phase2_instructions.items():
        if section_name in section_cache:
            cached = _enrich_dqid_anchors(_clean_and_humanize_section_html(section_cache[section_name]), dq_lookup, citation_style=citation_style)
            cached = _repair_lexical_artifacts(cached)
            cached = _demote_invalid_dqid_anchors(cached)
            try:
                cached = _validate_section_citation_integrity(section_name, cached, dq_lookup, citation_style=citation_style)
                _validate_generated_section(section_name, cached, section_specs[section_name])
                llm_sections[section_name] = cached
                continue
            except Exception:
                section_cache.pop(section_name, None)
                section_cache_entries.pop(section_name, None)
        prompt = (
            f"SECTION_NAME\n{section_name}\n\n"
            f"INSTRUCTION\n{instruction}\n\n"
            f"WHOLE_PAPER_CONTEXT_JSON\n{json.dumps(whole_paper_payload, ensure_ascii=False, indent=2)}\n\n"
            f"{strict_rules}\n\n"
            "STYLE_GUARD\nWrite formal publication prose only. Do not mention prompts/context JSON/AI.\n\n"
            f"CITATION_STYLE\n{citation_instruction}\n\n"
            "Return only raw HTML snippets, no markdown fences."
        )
        phase2_prompts.append((section_name, prompt))
    if phase2_prompts:
        phase2_raw = _run_grouped_batch_sections(
            collection_name=f"{collection_name}_whole_paper",
            model=model,
            function_name="bibliographic_review_section_writer",
            section_prompts=phase2_prompts,
        )
        for section_name, raw_html in phase2_raw.items():
            cleaned = _enrich_dqid_anchors(_clean_and_humanize_section_html(_clean_llm_html(raw_html)), dq_lookup, citation_style=citation_style)
            cleaned = _repair_lexical_artifacts(cleaned)
            cleaned = _demote_invalid_dqid_anchors(cleaned)
            cleaned = _validate_section_citation_integrity(section_name, cleaned, dq_lookup, citation_style=citation_style)
            try:
                _validate_generated_section(section_name, cleaned, section_specs[section_name])
            except Exception as exc:
                last_err = str(exc)
                prev = cleaned
                ok = False
                for attempt in range(2, 4):
                    retry_prompt = _rewrite_section_prompt(
                        section_name=section_name,
                        base_instruction=phase2_instructions.get(section_name, ""),
                        payload=whole_paper_payload,
                        citation_instruction=citation_instruction,
                        strict_rules=strict_rules,
                        validation_error=last_err,
                        previous_output=prev,
                    )
                    retry_raw = _run_grouped_batch_sections(
                        collection_name=f"{collection_name}_whole_retry_{section_name}_a{attempt}",
                        model=model,
                        function_name="bibliographic_review_section_writer",
                        section_prompts=[(section_name, retry_prompt)],
                    ).get(section_name, "")
                    prev = _enrich_dqid_anchors(
                        _clean_and_humanize_section_html(_clean_llm_html(retry_raw)),
                        dq_lookup,
                        citation_style=citation_style,
                    )
                    prev = _repair_lexical_artifacts(prev)
                    prev = _demote_invalid_dqid_anchors(prev)
                    prev = _validate_section_citation_integrity(section_name, prev, dq_lookup, citation_style=citation_style)
                    try:
                        _validate_generated_section(section_name, prev, section_specs[section_name])
                        cleaned = prev
                        ok = True
                        break
                    except Exception as retry_exc:
                        last_err = str(retry_exc)
                if not ok:
                    raise RuntimeError(f"Section {section_name} failed after retries: {last_err}")
            llm_sections[section_name] = cleaned
            section_cache[section_name] = cleaned
            section_cache_entries[section_name] = _make_cache_entry(
                section_name=section_name,
                html_text=cleaned,
                model=model,
            )
        _write_section_cache(section_cache_path, section_cache_entries)

    refs_html = _build_reference_items(summary, citation_style=citation_style)
    top_keywords_display = [_clean_display_term(k) for k, _ in theme_token_counts.most_common(24)]
    top_keywords_display = [k for k in top_keywords_display if k and not k.lower().startswith("author ")]
    top_theme_keywords_display = [_clean_display_term(k) for k, _ in theme_token_counts.most_common(30)]
    top_theme_keywords_display = [k for k in top_theme_keywords_display if k and not k.lower().startswith("author ")]
    top_ngrams_display = [_clean_display_term(k) for k in top_ngrams[:20]]
    top_ngrams_display = [k for k in top_ngrams_display if k and not k.lower().startswith("author ")]
    context = {
        "topic": collection_name,
        "authors_list": "Automated TEIA pipeline",
        "affiliation": "TEIA Research",
        "generation_date": datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC"),
        "data_source_name": "Zotero coded corpus",
        "date_range": date_range,
        "analyzed_docs_count": item_count,
        "total_docs_found": item_count,
        "ai_models_used": model,
        "top_keywords_list_str": ", ".join(top_keywords_display[:12]),
        "top_authors_list_str": ", ".join([k for k, _ in counters["authors"].most_common(12)]) or "Not available in metadata",
        "top_affiliations_list_str": ", ".join([k for k, _ in counters["affiliations"].most_common(12)]) or "Not available in metadata",
        "top_ngrams_list_str": _repair_lexical_artifacts(", ".join(top_ngrams_display[:12])),
        "top_theme_keywords_list_str": _repair_lexical_artifacts(", ".join(top_theme_keywords_display[:20])),
        "science_mapping_tools_list_str": "Thematic map, strategic diagram, co-word analysis, clusters",
        "science_mapping_mentions_list_str": ", ".join(mapping_mentions[:12]),
        "co_word_clusters_list_str": "; ".join(co_word_links[:10]),
        "ai_abstract": llm_sections.get("abstract", ""),
        "ai_introduction": llm_sections.get("introduction", ""),
        "ai_methodology_review": llm_sections.get("methodology_review", ""),
        "ai_discussion": llm_sections.get("discussion", ""),
        "ai_conclusion": llm_sections.get("conclusion", ""),
        "ai_limitations": llm_sections.get("limitations", ""),
        "year_trends_plot_html": _figure_embed_tag("figure_year_trends.svg", "Annual publication output"),
        "analyzed_doc_types_plot_html": _figure_embed_tag("figure_doc_types.svg", "Document type distribution"),
        "top_authors_plot_html": _figure_embed_tag("figure_top_authors.svg", "Top authors"),
        "top_affiliations_plot_html": _figure_embed_tag("figure_top_affiliations.svg", "Top affiliations"),
        "top_ngram_plot_html": _figure_embed_tag("figure_top_ngrams.svg", "Top n-gram keyword phrases"),
        "ngram_evolution_plot_html": _figure_embed_tag("figure_ngram_evolution.svg", "N-gram evolution over time"),
        "corpus_terms_evolution_plot_html": _figure_embed_tag("figure_corpus_terms_evolution.svg", "Corpus term evolution over time"),
        "corpus_term_network_plot_html": _figure_embed_tag("figure_corpus_term_network.svg", "Corpus term co-occurrence network"),
        "theme_wordcloud_plot_html": _figure_embed_tag("figure_wordcloud.svg", "Theme keyword wordcloud"),
        "theme_keywords_plot_html": _figure_embed_tag("figure_theme_keywords.svg", "Theme keyword frequency"),
        "science_mapping_plot_html": _figure_embed_tag("figure_strategic_diagram.svg", "Thematic strategic diagram"),
        "ai_timeline_analysis": llm_sections.get("ai_timeline_analysis", ""),
        "ai_analyzed_doc_types_analysis": llm_sections.get("ai_analyzed_doc_types_analysis", ""),
        "ai_author_graph_analysis": llm_sections.get("ai_author_graph_analysis", ""),
        "ai_top_affiliations_analysis": llm_sections.get("ai_top_affiliations_analysis", ""),
        "ai_ngram_keywords_analysis": llm_sections.get("ai_ngram_keywords_analysis", ""),
        "ai_theme_keywords_analysis": llm_sections.get("ai_theme_keywords_analysis", ""),
        "ai_corpus_text_analysis": llm_sections.get("ai_corpus_text_analysis", ""),
        "ai_science_mapping_analysis": llm_sections.get("ai_science_mapping_analysis", ""),
        "references_list": [{"html_string": s[4:-5] if s.startswith("<li>") and s.endswith("</li>") else s} for s in refs_html],
        "REFERENCE_LIMIT": 200,
    }

    env = Environment(loader=FileSystemLoader(str(template_path.parent)), autoescape=select_autoescape(["html", "htm", "xml"]))
    template = env.get_template(template_path.name)
    rendered = template.render(**context)
    rendered = _repair_lexical_artifacts(rendered)
    rendered = _demote_invalid_dqid_anchors(rendered)
    rendered = _anchor_plain_author_year_citations(rendered, dq_lookup, citation_style=citation_style)
    rendered_for_validation = re.sub(r"<!--.*?-->", "", rendered, flags=re.DOTALL)
    _assert_non_placeholder_html(rendered_for_validation)
    _assert_reference_and_postprocess_integrity(rendered_for_validation, citation_style=citation_style)
    _validate_dqid_quote_page_integrity(rendered_for_validation, dq_lookup, citation_style=citation_style, context_label="Bibliographic review")
    _assert_bibliographic_visual_qa(assets_dir, rendered_for_validation)

    output_html_path = output_dir / "bibliographic_review.html"
    output_html_path.write_text(rendered, encoding="utf-8")
    context_path = output_dir / "bibliographic_review_context.json"
    context_path.write_text(json.dumps(context, ensure_ascii=False, indent=2), encoding="utf-8")
    manifest = {
        "status": "ok",
        "collection_name": collection_name,
        "output_html_path": str(output_html_path),
        "context_json_path": str(context_path),
        "phase_batches": 2,
        "phase1_sections": list(phase1_instructions.keys()),
        "phase2_sections": list(phase2_instructions.keys()),
    }
    (output_dir / "bibliographic_manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return manifest


def run_pipeline(
    *,
    summary_path: Path | None,
    template_path: Path,
    outputs_root: Path,
    model: str = "gpt-5-mini",
    citation_style: str = "apa",
    collection_name: str = "",
    coded_dir: Path | None = None,
    build_summary_if_missing: bool = False,
) -> dict[str, str]:
    resolved_summary_path = resolve_summary_path(
        summary_path=summary_path,
        collection_name=str(collection_name),
        coded_dir=coded_dir,
        outputs_root=outputs_root,
        model=model,
        build_summary_if_missing=bool(build_summary_if_missing),
    )
    summary = _load_json(resolved_summary_path)
    return render_bibliographic_review_from_summary(
        summary=summary,
        template_path=template_path,
        outputs_root=outputs_root,
        model=model,
        citation_style=citation_style,
    )


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Render bibliographic review from coded summary in two grouped batches.")
    parser.add_argument("--summary-path", default="")
    parser.add_argument("--collection-name", default="")
    parser.add_argument("--coded-dir", default="")
    parser.add_argument("--build-summary-if-missing", action="store_true")
    parser.add_argument("--template-path", default=str(_repo_root() / "Research" / "templates" / "bibliographic.html"))
    parser.add_argument("--outputs-root", default=str(_repo_root() / "Research" / "outputs"))
    parser.add_argument("--model", default="gpt-5-mini")
    parser.add_argument("--citation-style", default="apa")
    return parser


def main() -> int:
    args = _build_parser().parse_args()
    summary_path = Path(args.summary_path).resolve() if str(args.summary_path).strip() else None
    coded_dir = Path(args.coded_dir).resolve() if str(args.coded_dir).strip() else None
    result = run_pipeline(
        summary_path=summary_path,
        template_path=Path(args.template_path).resolve(),
        outputs_root=Path(args.outputs_root).resolve(),
        model=str(args.model),
        citation_style=str(args.citation_style),
        collection_name=str(args.collection_name),
        coded_dir=coded_dir,
        build_summary_if_missing=bool(args.build_summary_if_missing),
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
