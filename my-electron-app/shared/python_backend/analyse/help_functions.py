import html
import json
import os
import re
import sys
import traceback
from pathlib import Path
from types import TracebackType
from typing import Dict, List, Any, Tuple, Optional, Type

import pandas as pd
from PyQt6.QtCore import QMetaObject, Qt, Q_ARG
from PyQt6.QtWidgets import QApplication
from bs4 import BeautifulSoup, Tag

from Z_Corpus_analysis.help_widgets import GUIExceptionConfig, _GuiErrorBridge, _build_error_info
from general.app_constants import _item_db_path, _ref_cache_path


def install_runtime_error_hooks(*, enabled: bool) -> None:
    """
    ###1. Enable faulthandler and exception hooks only when requested
    ###2. Keep import-time side effects minimal for faster first paint
    """
    if not enabled:
        return

    import sys
    import threading
    import faulthandler

    faulthandler.enable(all_threads=True)
    os.environ["PYTHONFAULTHANDLER"] = "1"

    def _hard_excepthook(exctype, value, tb):
        traceback.print_exception(exctype, value, tb)
        sys.stderr.flush()

    sys.excepthook = _hard_excepthook

    install_global_excepthook(GUIExceptionConfig())

    def _threading_excepthook(args: threading.ExceptHookArgs) -> None:
        sys.excepthook(args.exc_type, args.exc_value, args.exc_traceback)

    threading.excepthook = _threading_excepthook



def install_global_excepthook(config: Optional[GUIExceptionConfig] = None) -> None:
    cfg = config or GUIExceptionConfig()

    # Persist the bridge on the QApplication to avoid globals and keep it alive.
    app = QApplication.instance() or QApplication(sys.argv)
    bridge_obj = app.property("_gui_error_bridge_obj")
    if not isinstance(bridge_obj, _GuiErrorBridge):
        bridge_obj = _GuiErrorBridge(app)
        app.setProperty("_gui_error_bridge_obj", bridge_obj)

    # Optional: disable tqdm's background monitor thread to avoid cross-thread UI surprises.
    try:
        from tqdm import tqdm as _tqdm  # type: ignore
        # no-op if tqdm is absent; attribute set is safe
        _tqdm.monitor_interval = 0  # type: ignore[attr-defined]
    except Exception:
        pass  # noqa: E701  (allowed here since it's not a try/except for program logic)

    def _gui_excepthook(exctype: Type[BaseException], exc: BaseException, tb: TracebackType) -> None:
        info = _build_error_info(exctype, exc, tb)

        # Trim formatted traceback to cfg.max_context_lines lines (tail) without lossy parsing.
        lines = info.formatted.splitlines()
        max_lines = int(cfg.max_context_lines)
        if max_lines > 0 and len(lines) > max_lines:
            trimmed = ["… (truncated) …"] + lines[-max_lines:]
        else:
            trimmed = lines
        formatted_md = "```\n" + "\n".join(trimmed) + "\n```"

        if cfg.show_dialog:
            loc = f"<code>{info.filename}</code>: line {info.lineno} in <code>{info.funcname}</code>"
            prev = f"<code>{info.prev_filename}</code>: line {info.prev_lineno} in <code>{info.prev_funcname}</code>"
            QMetaObject.invokeMethod(
                bridge_obj,
                "show_dialog",
                Qt.ConnectionType.QueuedConnection,
                Q_ARG(str, cfg.modal_title),
                Q_ARG(str, info.exc_type),
                Q_ARG(str, info.message),
                Q_ARG(str, loc),
                Q_ARG(str, prev),
                Q_ARG(str, formatted_md),
                Q_ARG(int, 900),
                Q_ARG(int, 520),
            )

        # Always also print to stderr so logs capture the full traceback.
        sys.__excepthook__(exctype, exc, tb)

    sys.excepthook = _gui_excepthook



def _sanitize_filename(s: str) -> str:
    s = s.strip() or "export"
    s = re.sub(r"[^\w\-. ]+", "_", s)
    return re.sub(r"\s+", "_", s)


def _escape(s: str) -> str:
    return html.escape(s or "", quote=True)


def _feather_available() -> bool:
    """Feather requires pyarrow."""
    return _find_spec("pyarrow") is not None

def load_sections_l3(themes_dir: Path) -> list[dict]:
    """
    Load L3 sections from Feather if present, otherwise from JSON.

    ###1. prefer pyr_l3_sections.feather when pyarrow is available
    ###2. fall back to pyr_l3_sections.json (already in UI shape)
    ###3. always return list[dict] with keys: custom_id, meta, section_html
    """
    fea_path = themes_dir / "pyr_l3_sections.feather"
    js_path = themes_dir / "pyr_l3_sections.json"

    rows: list[dict] = []

    # Feather fast-path (same layout as L2: custom_id, rq, gold_theme, ..., section_html, meta_json)
    if fea_path.exists() and _feather_available():
        import pandas as pd
        import json as _json

        df = pd.read_feather(fea_path)
        for _, r in df.iterrows():
            meta_raw = r.get("meta_json")
            meta = {}
            if isinstance(meta_raw, str) and meta_raw.strip():
                meta = _json.loads(meta_raw)

            if not isinstance(meta, dict):
                meta = {}

            rows.append(
                {
                    "custom_id": r.get("custom_id") or meta.get("custom_id") or "",
                    "meta": meta,
                    "section_html": r.get("section_html") or "",
                }
            )
        return rows

    # JSON fallback: already exported in hydrated L3 shape
    if js_path.exists():
        import json as _json

        with open(js_path, "r", encoding="utf-8") as f:
            data = _json.load(f)

        if isinstance(data, list):
            out: list[dict] = []
            for rec in data:
                if not isinstance(rec, dict):
                    continue
                meta = rec.get("meta") or {}
                if not isinstance(meta, dict):
                    meta = {}
                out.append(
                    {
                        "custom_id": rec.get("custom_id") or meta.get("custom_id") or "",
                        "meta": meta,
                        "section_html": rec.get("section_html") or "",
                    }
                )
            return out
        return []

    return []

def load_sections(themes_dir: Path) -> List[Dict[str, Any]]:
    """
    Load L1 sections from a Feather file if present (fast path), otherwise from JSON.
    Returns a list[dict] with the shape the UI expects.
    """
    fea_path = themes_dir / "pyr_l1_sections.feather"
    js_path = themes_dir / "pyr_l1_sections.json"

    # Prefer Feather if present and pyarrow is available
    if fea_path.exists():
        if not _feather_available():
            # Feather present but engine missing → graceful guidance or JSON fallback
            if js_path.exists():
                with open(js_path, "r", encoding="utf-8") as f:
                    return json.load(f)
            raise RuntimeError(
                "Found 'pyr_l1_sections.feather' but 'pyarrow' is not installed. "
                "Install 'pyarrow' to use Feather, or provide the JSON fallback."
            )

        df = pd.read_feather(fea_path)

        # Must contain per-section rows with 'section_html'
        if "section_html" not in set(map(str, df.columns)):
            # Not a per-section table → fall back to JSON if available
            if js_path.exists():
                with open(js_path, "r", encoding="utf-8") as f:
                    return json.load(f)
            return []

        def pick(row: dict, *names, default=""):
            for n in names:
                if n in row and pd.notna(row[n]):
                    return row[n]
            return default

        out: List[Dict[str, Any]] = []
        for _, s in df.iterrows():
            r = s.to_dict()

            route_val = pick(
                r,
                "route_value",
                "meta_route_value",
                default="",
            )

            meta_obj = {}
            mj = r.get("meta_json")
            if isinstance(mj, str) and mj.strip():
                parsed = json.loads(mj)
                if isinstance(parsed, dict):
                    meta_obj = parsed

            if not route_val and isinstance(meta_obj, dict):
                mv = meta_obj.get("route_value") or meta_obj.get("route")
                if mv is None:
                    route_val = ""
                elif isinstance(mv, str):
                    route_val = mv
                else:
                    route_val = str(mv)

            if isinstance(meta_obj, dict) and route_val and not meta_obj.get("route_value"):
                meta_obj["route_value"] = route_val

            section = {
                "custom_id": pick(r, "custom_id", "meta_custom_id"),
                "rq": pick(r, "rq", "meta_rq", default="—"),
                "gold_theme": pick(r, "gold_theme", "meta_gold_theme"),
                "potential_theme": pick(r, "potential_theme", "meta_potential_theme"),
                "evidence_type": pick(r, "evidence_type", "meta_evidence_type"),
                "route_value": route_val,
                "section_html": pick(r, "section_html", "html"),
                "meta": meta_obj,
            }
            out.append(section)
        return out

    # Fallback: JSON (original path)
    if js_path.exists():
        with open(js_path, "r", encoding="utf-8") as f:
            return json.load(f)

    return []


# --- robust author extractor ---
def _extract_author_summary_from_meta(md: dict) -> str:
    """
    Return a short author string from a variety of shapes:
    - md['author_summary'] (string)
    - md['authors'] as string, JSON-ish string, list[str], list[dict], or dict
    - md['authors_list'] as above
    - md['creator_summary'], md['creator'], md['creators']
    Fallback: md['title'] or "".
    """
    import json

    def _norm(s):
        return s.strip() if isinstance(s, str) else ""

    def _parse_jsonish(s):
        if not isinstance(s, str):
            return None
        t = s.strip()
        if t.startswith("[") or t.startswith("{"):
            try:
                return json.loads(t)
            except Exception:
                return None
        return None

    def _listify(value):
        # Turn various shapes into list of author names (strings)
        if value is None:
            return []
        # Already a list of strings?
        if isinstance(value, list) and all(isinstance(x, str) for x in value):
            return [x.strip() for x in value if _norm(x)]
        # List of dicts (CRediT/CrossRef-like)
        if isinstance(value, list) and any(isinstance(x, dict) for x in value):
            out = []
            for a in value:
                if not isinstance(a, dict):
                    continue
                # prefer full_name/name; else combine given/family or first/last
                full = _norm(a.get("full_name")) or _norm(a.get("name"))
                if not full:
                    given = _norm(a.get("given")) or _norm(a.get("first"))
                    family = _norm(a.get("family")) or _norm(a.get("last"))
                    if given and family:
                        full = f"{given} {family}"
                    else:
                        full = given or family
                if full:
                    out.append(full)
            return out
        # Single dict
        if isinstance(value, dict):
            full = _norm(value.get("full_name")) or _norm(value.get("name"))
            if not full:
                given = _norm(value.get("given")) or _norm(value.get("first"))
                family = _norm(value.get("family")) or _norm(value.get("last"))
                if given and family:
                    full = f"{given} {family}"
                else:
                    full = given or family
            return [full] if full else []
        # JSON-ish string?
        if isinstance(value, str):
            parsed = _parse_jsonish(value)
            if parsed is not None:
                return _listify(parsed)
            # Plain string — try to split semi-/comma; fall back to as-is
            if ";" in value:
                return [x.strip() for x in value.split(";") if _norm(x)]
            if "," in value and " et al" not in value.lower():
                # beware: commas can be within "Last, First"; keep simple:
                parts = [x.strip() for x in value.split(",") if _norm(x)]
                # if splitting produced too many tiny tokens, keep original
                if len(parts) > 1 and all(len(p) < 40 for p in parts):
                    return parts
            return [value.strip()] if _norm(value) else []
        return []

    # 1) direct author_summary
    s = _norm(md.get("author_summary"))
    if s:
        return s

    # 2) authors or authors_list
    for key in ("authors", "authors_list"):
        val = md.get(key)
        names = _listify(val)
        if names:
            if len(names) == 1:
                return names[0]
            if len(names) <= 3:
                return ", ".join(names)
            return f"{names[0]} et al."

    # 3) creator_summary / creator(s)
    s = _norm(md.get("creator_summary"))
    if s:
        return s
    for key in ("creator", "creators"):
        val = md.get(key)
        names = _listify(val)
        if names:
            if len(names) == 1:
                return names[0]
            if len(names) <= 3:
                return ", ".join(names)
            return f"{names[0]} et al."

    # 4) last resort: title
    t = _norm(md.get("title"))
    return t



















def _fix_html_for_tts(html: str) -> str:
    """
    ###1. Canonical HTML normalisation for TTS
    ###2. MUST be deterministic
    ###3. MUST return a BODY FRAGMENT (no <html>, no <body>)
    """
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "html.parser")

    # hard-strip head/html/body if present
    if soup.body is not None:
        soup = BeautifulSoup("".join(str(x) for x in soup.body.contents), "html.parser")

    # remove script/style
    for tag in soup(["script", "style"]):
        tag.decompose()

    return str(soup).strip()

def _clean_tts_text(raw_text: str, placeholder_meta) -> str:
    """
    ###1. Build an allowlist of known placeholders from placeholder_meta (blocks + anchors)
    ###2. Remove only bracket-style occurrences of those placeholders: "[A_01]" etc (legacy artifacts)
    ###3. Preserve everything else, including citations like "[1]" or "[Smith2020]"
    ###4. Normalise whitespace (without deleting meaningful punctuation)
    """
    import re as _re

    if type(raw_text) is not str:
        raise TypeError("raw_text must be str")

    known: set[str] = set()

    def _add_key(v) -> None:
        if type(v) is not str:
            return
        s = v.strip()
        if s == "":
            return
        # store both bare and bracketed variants
        known.add(s)
        if s.startswith("[") and s.endswith("]"):
            bare = s[1:-1].strip()
            if bare != "":
                known.add(bare)
        else:
            known.add("[" + s + "]")

    if type(placeholder_meta) is dict:
        blocks = placeholder_meta.get("blocks")
        anchors = placeholder_meta.get("anchors")

        if type(blocks) is list:
            i = 0
            while i < len(blocks):
                b = blocks[i]
                if type(b) is dict:
                    _add_key(b.get("placeholder"))
                    _add_key(b.get("id"))
                i = i + 1

        if type(anchors) is list:
            i = 0
            while i < len(anchors):
                a = anchors[i]
                if type(a) is dict:
                    _add_key(a.get("placeholder"))
                    _add_key(a.get("id"))
                    _add_key(a.get("anchor_id"))
                i = i + 1

    # If placeholder_meta is missing/unusable, do NOT run broad deletion.
    # Only do targeted deletion when we have a deterministic allowlist.
    cleaned = raw_text

    if known:
        # Only remove bracketed forms of known placeholders.
        # Example: if known contains "A_01", remove "[A_01]" but keep "[1]" etc.
        # Escape each key for regex safety.
        bracketed_keys: list[str] = []
        for k in known:
            if type(k) is str and k.strip() != "":
                kk = k.strip()
                if kk.startswith("[") and kk.endswith("]"):
                    kk = kk[1:-1].strip()
                if kk != "":
                    bracketed_keys.append(_re.escape(kk))

        if bracketed_keys:
            # Build pattern: \[(A_01|H3_01|P_02|LI_10)\]
            pattern = r"\[(?:" + "|".join(bracketed_keys) + r")\]"
            cleaned = _re.sub(pattern, " ", cleaned)

    # Whitespace normalisation (keep punctuation intact).
    # Keep newlines as spaces; do not remove punctuation.
    parts = str(cleaned or "").replace("\u2029", " ").replace("\u2028", " ").split()
    return " ".join(parts)

def build_tts_text_with_placeholders(html_raw: str) -> Tuple[str, Dict[str, Any]]:
    """
    ###1. Parse section_html and linearise into TTS-friendly text
    ###2. Do NOT emit structural placeholders (H*_**, P_**, LI_**) into tts_text
        so the TTS model never speaks them.
    ###3. Emit anchor INNER TEXT into tts_text so references are spoken.
    ###4. Record block + anchor metadata with stable ids AND tts_char spans
        (start/end offsets within the returned tts_text).
    ###5. Return (tts_text, placeholder_meta)
    """
    if type(html_raw) is not str or html_raw.strip() == "":
        meta_empty: Dict[str, Any] = {
            "blocks": [],
            "anchors": [],
            "num_blocks": 0,
        }
        print("[TTS][PLACEHOLDERS] empty HTML input")
        print("[TTS][PLACEHOLDERS] tts_text=''", "blocks=0", "anchors=0")
        return "", meta_empty

    soup = BeautifulSoup(html_raw, "html.parser")

    target_names = ("h1", "h2", "h3", "h4", "h5", "h6", "p", "li")

    counters: Dict[str, int] = {
        "h1": 0,
        "h2": 0,
        "h3": 0,
        "h4": 0,
        "h5": 0,
        "h6": 0,
        "p": 0,
        "li": 0,
        "a": 0,
    }

    fragments: List[str] = []
    fragments_marked: List[str] = []

    meta: Dict[str, Any] = {
        "blocks": [],
        "anchors": [],
        "num_blocks": 0,
        "tts_text_marked": "",
        "marker_prefix": "⟦",
        "marker_suffix": "⟧",
    }

    def _joiner_len(n: int) -> int:
        # joiner is "\n\n" between fragments
        if n <= 1:
            return 0
        return 2 * (n - 1)

    def _append_fragment(*, text: str, marker: str) -> Tuple[int, int, int, int]:
        """
        Append both:
          - plain fragment into fragments (spoken)
          - marked fragment into fragments_marked (not spoken)

        Returns:
          (plain_start, plain_end, marked_start, marked_end)
        """
        plain_start = 0
        marked_start = 0

        if fragments:
            j = 0
            while j < len(fragments):
                plain_start = plain_start + len(fragments[j])
                j = j + 1
            plain_start = plain_start + _joiner_len(len(fragments) + 1)

        if fragments_marked:
            j = 0
            while j < len(fragments_marked):
                marked_start = marked_start + len(fragments_marked[j])
                j = j + 1
            marked_start = marked_start + _joiner_len(len(fragments_marked) + 1)

        m = meta["marker_prefix"] + marker + meta["marker_suffix"] + " " + text

        fragments.append(text)
        fragments_marked.append(m)

        plain_end = plain_start + len(text)
        marked_end = marked_start + len(m)
        return plain_start, plain_end, marked_start, marked_end

    def _collect_block_text(tag: Tag) -> Tuple[str, List[Dict[str, Any]]]:
        """
        Collect visible text for a block.

        Rules:
          - Anchor inner text is spoken (included in block_text).
          - Anchor HTML is preserved in metadata.
          - Text that is inside an <a> is not duplicated (we do not also add it as plain string).
          - Offsets are computed against the exact block_text we build.
        """
        parts: List[str] = []
        anchors_local: List[Dict[str, Any]] = []

        cursor = 0

        def _append_token(tok: str) -> Tuple[int, int]:
            nonlocal cursor
            t = str(tok or "").strip()
            if t == "":
                return cursor, cursor
            if parts:
                parts.append(" " + t)
                start = cursor + 1
                end = start + len(t)
                cursor = end
                return start, end
            parts.append(t)
            start = cursor
            end = start + len(t)
            cursor = end
            return start, end

        # 1) Mark all anchor text spans by inserting them explicitly, and record their offsets.
        #    We iterate over anchor Tags directly, so the type checker knows these are Tags.
        #    We do NOT use tag.descendants for anchor detection.
        anchors = tag.find_all("a")
        anchors_by_text: List[Tuple[str, Tag]] = []
        i_a0 = 0
        while i_a0 < len(anchors):
            a_tag = anchors[i_a0]
            a_text = a_tag.get_text(" ", strip=True) or ""
            if type(a_text) is not str:
                a_text = ""
            a_text = a_text.strip()
            anchors_by_text.append((a_text, a_tag))
            i_a0 = i_a0 + 1

        # 2) Build a linear token stream from the block, skipping strings that are inside <a>.
        #    We use stripped_strings but filter out those that belong to anchors by checking parent chain via .find_parent.
        #    Note: .find_parent is on Tag, and the generator yields strings, not PageElements.
        for s in tag.stripped_strings:
            # if this string is inside an anchor, skip it here; it will be emitted when we encounter the anchor itself
            # We detect "inside anchor" by testing membership in any anchor's stripped_strings.
            inside_anchor = False
            j_a = 0
            while j_a < len(anchors_by_text):
                a_text, _a_tag = anchors_by_text[j_a]
                if a_text != "" and s == a_text:
                    inside_anchor = True
                    break
                j_a = j_a + 1

            if inside_anchor:
                # emit anchor text and metadata exactly once
                counters["a"] = counters["a"] + 1
                anchor_idx = counters["a"]
                anchor_id = "A_{:02d}".format(anchor_idx)

                start, end = _append_token(s)

                # find the matching anchor tag for HTML/href/title; take first match
                k_a = 0
                chosen = None
                while k_a < len(anchors_by_text):
                    if anchors_by_text[k_a][0] == s:
                        chosen = anchors_by_text[k_a][1]
                        break
                    k_a = k_a + 1

                anchors_local.append(
                    {
                        "placeholder": s,
                        "id": anchor_id,
                        "href": chosen.get("href") if chosen is not None else "",
                        "title": chosen.get("title") if chosen is not None else "",
                        "text": s,
                        "html": str(chosen) if chosen is not None else "",
                        "block_char_start": int(start),
                        "block_char_end": int(end),
                    }
                )

                continue

            _append_token(s)

        block_text = "".join(parts).strip()
        return block_text, anchors_local


    def _handle_heading(tag: Tag, level: int) -> None:
        key = "h" + str(level)
        if key not in counters:
            return
        counters[key] = counters[key] + 1
        idx = counters[key]
        block_id = "H{0}_{1:02d}".format(level, idx)

        text, anchors_local = _collect_block_text(tag)
        if text.strip() == "":
            return

        # Critical: DO NOT prepend placeholder into spoken stream.
        # We only speak the heading text.
        # Critical: DO NOT prepend placeholder into spoken stream.
        # We only speak the heading text (plain stream).
        tts_char_start, tts_char_end, tts_char_start_marked, tts_char_end_marked = _append_fragment(
            text=text,
            marker=block_id,
        )

        meta["blocks"].append(
            {
                "type": "heading",
                "level": level,
                "index": idx,
                "id": block_id,
                "placeholder": block_id,
                "text": text,
                "tts_char_start": int(tts_char_start),
                "tts_char_end": int(tts_char_end),
                "tts_char_start_marked": int(tts_char_start_marked),
                "tts_char_end_marked": int(tts_char_end_marked),
            }
        )

        # Promote local anchors to global anchors with absolute tts offsets.
        k = 0
        while k < len(anchors_local):
            a = anchors_local[k]
            meta["anchors"].append(
                {
                    "placeholder": a["placeholder"],
                    "id": a["id"],
                    "href": a["href"],
                    "title": a["title"],
                    "text": a["text"],
                    "html": a["html"],
                    "tts_char_start": int(tts_char_start + int(a["block_char_start"])),
                    "tts_char_end": int(tts_char_start + int(a["block_char_end"])),
                    "block_id": block_id,
                }
            )
            k = k + 1

    def _handle_paragraph(tag: Tag) -> None:
        counters["p"] = counters["p"] + 1
        idx = counters["p"]
        block_id = "P_{:02d}".format(idx)

        text, anchors_local = _collect_block_text(tag)
        if text.strip() == "":
            return

        tts_char_start, tts_char_end, tts_char_start_marked, tts_char_end_marked = _append_fragment(
            text=text,
            marker=block_id,
        )

        meta["blocks"].append(
            {
                "type": "paragraph",
                "index": idx,
                "id": block_id,
                "placeholder": block_id,
                "text": text,
                "tts_char_start": int(tts_char_start),
                "tts_char_end": int(tts_char_end),
                "tts_char_start_marked": int(tts_char_start_marked),
                "tts_char_end_marked": int(tts_char_end_marked),
            }
        )

        k = 0
        while k < len(anchors_local):
            a = anchors_local[k]
            meta["anchors"].append(
                {
                    "placeholder": a["placeholder"],
                    "id": a["id"],
                    "href": a["href"],
                    "title": a["title"],
                    "text": a["text"],
                    "html": a["html"],
                    "tts_char_start": int(tts_char_start + int(a["block_char_start"])),
                    "tts_char_end": int(tts_char_start + int(a["block_char_end"])),
                    "block_id": block_id,
                }
            )
            k = k + 1

    def _handle_list_item(tag: Tag) -> None:
        counters["li"] = counters["li"] + 1
        idx = counters["li"]
        block_id = "LI_{:02d}".format(idx)

        text, anchors_local = _collect_block_text(tag)
        if text.strip() == "":
            return

        tts_char_start, tts_char_end, tts_char_start_marked, tts_char_end_marked = _append_fragment(
            text=text,
            marker=block_id,
        )

        meta["blocks"].append(
            {
                "type": "list_item",
                "index": idx,
                "id": block_id,
                "placeholder": block_id,
                "text": text,
                "tts_char_start": int(tts_char_start),
                "tts_char_end": int(tts_char_end),
                "tts_char_start_marked": int(tts_char_start_marked),
                "tts_char_end_marked": int(tts_char_end_marked),
            }
        )

        k = 0
        while k < len(anchors_local):
            a = anchors_local[k]
            meta["anchors"].append(
                {
                    "placeholder": a["placeholder"],
                    "id": a["id"],
                    "href": a["href"],
                    "title": a["title"],
                    "text": a["text"],
                    "html": a["html"],
                    "tts_char_start": int(tts_char_start + int(a["block_char_start"])),
                    "tts_char_end": int(tts_char_start + int(a["block_char_end"])),
                    "block_id": block_id,
                }
            )
            k = k + 1

    for tag in soup.find_all(target_names):
        if type(tag) is not Tag:
            continue
        name = (tag.name or "").lower()
        if name.startswith("h"):
            ch = name[1:2]
            if ch.isdigit():
                level = int(ch)
                _handle_heading(tag, level)
            continue
        if name == "p":
            _handle_paragraph(tag)
            continue
        if name == "li":
            _handle_list_item(tag)
            continue

    tts_text = "\n\n".join(fragments).strip()
    meta["tts_text_marked"] = "\n\n".join(fragments_marked).strip()
    meta["num_blocks"] = len(meta["blocks"])

    print("[TTS][PLACEHOLDERS] built TTS text (NO structural placeholders)")
    print(tts_text)
    print("[TTS][PLACEHOLDERS] blocks=", meta["num_blocks"], "anchors=", len(meta["anchors"]))

    if meta["anchors"]:
        print("[TTS][PLACEHOLDERS] first anchors:")
        limit = len(meta["anchors"]) if len(meta["anchors"]) <= 3 else 3
        i = 0
        while i < limit:
            anchor = meta["anchors"][i]
            print(" ", i, anchor)
            i = i + 1

    return tts_text, meta




def _file_exists_any(run_dir: Path, candidates: List[str]) -> bool:
    for name in candidates:
        if (run_dir / name).is_file():
            return True
    return False


def resolve_sections_root(base_dir: str | Path | None) -> Path:
    """
    Decide which directory Dashboard should scan for Pyramid runs.

    Order:
      1. <base_dir>/thematics_outputs/sections
      2. <base_dir>/sections
      3. <base_dir> itself (final fallback)

    This fixes the case where your run folders (each containing
    pyr_l1_batches.json / pyr_l1_sections.json / pyr_l2_sections.json …)
    are stored directly under the THEMES root, not inside a 'sections' subdir.
    """
    if base_dir is None:
        base = Path(".").resolve()
    else:
        base = Path(base_dir).resolve()

    cand1 = base / "thematics_outputs" / "sections"
    cand2 = base / "sections"

    if cand1.is_dir():
        print(f"[resolve_sections_root] USING sections_root={cand1}")
        return cand1

    if cand2.is_dir():
        print(f"[resolve_sections_root] USING sections_root={cand2}")
        return cand2

    # real fallback: just use the THEMES base itself
    print(
        f"[resolve_sections_root] WARNING: neither {cand1} nor {cand2} exist; "
        f"falling back to base={base}"
    )
    return base



# ============================ DATA LOADING ============================

def load_batches_json(themes_dir: Path) -> List[Dict[str, Any]]:
    """
    Expects THEMES directory; loads pyr_l1_batches.json inside it.
    Entry form: [ {batch_obj}, "prompt string" ] or just {batch_obj}
    """
    path = themes_dir / "pyr_l1_batches.json"
    if not path.exists():
        raise FileNotFoundError(f"Missing file: {path}")

    with open(path, "r", encoding="utf-8") as f:
        raw = json.load(f)

    out: List[Dict[str, Any]] = []
    for entry in raw or []:
        bobj = None
        prompt = ""
        if isinstance(entry, list) and entry:
            bobj = entry[0] if isinstance(entry[0], dict) else None
            if len(entry) > 1 and isinstance(entry[1], str):
                prompt = entry[1]
        elif isinstance(entry, dict):
            bobj = entry

        if not isinstance(bobj, dict):
            continue

        out.append({
            "rq_question": bobj.get("rq_question", ""),
            "theme": bobj.get("theme", ""),
            "potential_theme": bobj.get("potential_theme", ""),
            "evidence_type": bobj.get("evidence_type", ""),
            "size": int(bobj.get("size", 0)) if str(bobj.get("size", "0")).isdigit() else 0,
            "payloads": bobj.get("payloads", []),
            "prompt": prompt,
        })
    return out

from importlib.util import find_spec as _find_spec


def _parquet_engine_or_none() -> str | None:
    # Prefer pyarrow for best interop; fall back to fastparquet.
    if _find_spec("pyarrow") is not None:
        return "pyarrow"
    if _find_spec("fastparquet") is not None:
        return "fastparquet"
    return None
def load_sections_l2(themes_dir: Path) -> List[Dict[str, Any]]:
    """
    ###1. choose source
    ###2. read frame or json
    ###3. normalise records and propagate route_value
    """

    def _feather_ok() -> bool:
        return _find_spec("pyarrow") is not None

    def _s(x: Any) -> str:
        if isinstance(x, tuple):
            return ""
        if isinstance(x, str):
            t = x.strip()
            if t == "(None, None)":
                return ""
            return t
        return ""

    def _normalize_section_html_l2(h: str) -> str:
        """
        ###1. empty guard
        ###2. soup parse
        ###3. enforce <section class="pdf-section">
        """
        if not isinstance(h, str) or not h.strip():
            return ""
        soup = BeautifulSoup(h, "html.parser")
        for sec_tag in soup.find_all("section"):
            cls = sec_tag.get("class")
            if not cls:
                sec_tag["class"] = ["pdf-section"]
        return str(soup)

    def _pick(row: dict, *names: str, default: str = "") -> str:
        for n in names:
            if n in row and pd.notna(row[n]):
                v = row[n]
                if isinstance(v, (str, tuple)):
                    return _s(v)
                if isinstance(v, str):
                    return v
                return default
        return default

    fea = themes_dir / "pyr_l2_sections.feather"
    jsn = themes_dir / "pyr_l2_sections.json"

    if fea.exists():
        if not _feather_ok():
            if jsn.exists():
                with open(jsn, "r", encoding="utf-8") as f:
                    return json.load(f)
            return []
        df = pd.read_feather(fea)
        cols = set(map(str, df.columns))
        if "section_html" not in cols and "html" not in cols:
            if jsn.exists():
                with open(jsn, "r", encoding="utf-8") as f:
                    return json.load(f)
            return []
        out: List[Dict[str, Any]] = []
        for _, s in df.iterrows():
            r = s.to_dict()
            sec_html_raw = _pick(r, "section_html", "html", default="")
            sec_html = _normalize_section_html_l2(_s(sec_html_raw))

            route_val = _pick(r, "route_value", "meta_route_value", default="")

            mj = r.get("meta_json")
            meta_json = {}
            if isinstance(mj, str) and mj.strip():
                parsed = json.loads(mj)
                if isinstance(parsed, dict):
                    meta_json = parsed

            if not route_val and isinstance(meta_json, dict):
                mv = meta_json.get("route_value")
                if isinstance(mv, str):
                    mv_str = mv.strip()
                    if mv_str:
                        route_val = mv_str

            base_meta = {
                "custom_id": _pick(r, "custom_id", "meta_custom_id", default=None),
                "rq": _pick(r, "rq", "meta_rq", default="—"),
                "gold_theme": _pick(r, "gold_theme", "meta_gold_theme", default=None),
                "potential_theme": _pick(r, "potential_theme", "meta_potential_theme", default=None),
                "evidence_type": _pick(r, "evidence_type", "meta_evidence_type", default=None),
                "route": _pick(r, "route", "meta_route", default=None),
            }

            if meta_json:
                final_meta = dict(meta_json)
                if "custom_id" not in final_meta:
                    final_meta["custom_id"] = base_meta["custom_id"]
                if "rq" not in final_meta:
                    final_meta["rq"] = base_meta["rq"]
                if "gold_theme" not in final_meta:
                    final_meta["gold_theme"] = base_meta["gold_theme"]
                if "potential_theme" not in final_meta:
                    final_meta["potential_theme"] = base_meta["potential_theme"]
                if "evidence_type" not in final_meta:
                    final_meta["evidence_type"] = base_meta["evidence_type"]
                if "route" not in final_meta:
                    final_meta["route"] = base_meta["route"]
            else:
                final_meta = dict(base_meta)

            if route_val and not final_meta.get("route_value"):
                final_meta["route_value"] = route_val

            section = {
                "custom_id": final_meta.get("custom_id"),
                "rq": final_meta.get("rq"),
                "gold_theme": final_meta.get("gold_theme"),
                "potential_theme": final_meta.get("potential_theme"),
                "evidence_type": final_meta.get("evidence_type"),
                "route": final_meta.get("route"),
                "route_value": route_val,
                "section_html": sec_html,
                "meta": final_meta,
            }
            out.append(section)
        return out
    if jsn.exists():
        with open(jsn, "r", encoding="utf-8") as f:
            raw = json.load(f)

        out2: List[Dict[str, Any]] = []

        if isinstance(raw, list):
            for rec in raw:
                if not isinstance(rec, dict):
                    continue

                h_raw = rec.get("section_html") or rec.get("html") or ""
                sec_html = _normalize_section_html_l2(_s(h_raw))

                meta_obj = rec.get("meta")
                if not isinstance(meta_obj, dict):
                    meta_obj = {}

                route_val = ""
                mv = meta_obj.get("route_value") or meta_obj.get("route")
                if isinstance(mv, str):
                    mv_s = mv.strip()
                    if mv_s:
                        route_val = mv_s

                if not route_val:
                    rv = rec.get("route_value")
                    if isinstance(rv, str):
                        rv_s = rv.strip()
                        if rv_s:
                            route_val = rv_s

                def _pick_json(*names: str, default: str | None = None) -> str | None:
                    for n in names:
                        if n in rec:
                            v = rec[n]
                            if isinstance(v, str) and v.strip():
                                return v
                        if n in meta_obj:
                            v = meta_obj[n]
                            if isinstance(v, str) and v.strip():
                                return v
                    return default

                base_meta = {
                    "custom_id": _pick_json("custom_id"),
                    "rq": _pick_json("rq", default="—"),
                    "gold_theme": _pick_json("gold_theme"),
                    "potential_theme": _pick_json("potential_theme"),
                    "evidence_type": _pick_json("evidence_type"),
                    "route": _pick_json("route"),
                }

                final_meta: dict[str, str] = {}
                for k, v in meta_obj.items():
                    final_meta[k] = v

                for k, v in base_meta.items():
                    if k not in final_meta and v is not None:
                        final_meta[k] = v

                if route_val and not final_meta.get("route_value"):
                    final_meta["route_value"] = route_val

                section = {
                    "custom_id": final_meta.get("custom_id"),
                    "rq": final_meta.get("rq"),
                    "gold_theme": final_meta.get("gold_theme"),
                    "potential_theme": final_meta.get("potential_theme"),
                    "evidence_type": final_meta.get("evidence_type"),
                    "route": final_meta.get("route"),
                    "route_value": route_val,
                    "section_html": sec_html,
                    "meta": final_meta,
                }
                out2.append(section)

        return out2

    return []



def _load_or_build_records(*, direct_quote_lookup_json: Path, collection_name: str) -> list[dict]:
    """
    Primary behaviour:
      - Prefer item-level DB at tiny_ref_item_db.json
      - Otherwise build item-level records from direct_quote_lookup.json (keyed by dqid payloads containing item_key)
      - Maintain a legacy cache file tiny_ref_cache.json to keep earlier flows working
    Output records are item-level dicts:
      { item_key, author_summary, first_author_last, year, title, source, url }
    """
    item_db = _item_db_path(collection_name)
    legacy_cache = _ref_cache_path(collection_name)

    if item_db.exists():
        raw = item_db.read_text(encoding="utf-8")
        obj = json.loads(raw)
        records = obj["items"]

        print("[TinyRef][ITEMDB] using:", str(item_db))
        print("[TinyRef][ITEMDB] items:", len(records))

        if not globals().get("_TINYREF_TOP10_LOGGED", False):
            globals()["_TINYREF_TOP10_LOGGED"] = True
            i = 0
            while i < len(records) and i < 10:
                pl = records[i]
                print(
                    "[TinyRef][TOP10]",
                    i + 1,
                    "item_key=",
                    str(pl["item_key"]),
                    "|",
                    str(pl.get("author_summary") or pl.get("first_author_last") or ""),
                    "|",
                    str(pl.get("year") or ""),
                    "|",
                    str(pl.get("title") or ""),
                    "|",
                    str(pl.get("source") or ""),
                )
                i += 1

        return records

    if legacy_cache.exists():
        raw = legacy_cache.read_text(encoding="utf-8")
        obj = json.loads(raw)
        records = obj["records"]

        # If legacy cache already contains item-level records, keep it.
        if len(records) > 0 and "item_key" in records[0] and "dqid" not in records[0]:
            print("[TinyRef][CACHE] using item-level cache:", str(legacy_cache))
            print("[TinyRef][CACHE] records:", len(records))

            if not globals().get("_TINYREF_TOP10_LOGGED", False):
                globals()["_TINYREF_TOP10_LOGGED"] = True
                i = 0
                while i < len(records) and i < 10:
                    pl = records[i]
                    print(
                        "[TinyRef][TOP10]",
                        i + 1,
                        "item_key=",
                        str(pl["item_key"]),
                        "|",
                        str(pl.get("author_summary") or pl.get("first_author_last") or ""),
                        "|",
                        str(pl.get("year") or ""),
                        "|",
                        str(pl.get("title") or ""),
                        "|",
                        str(pl.get("source") or ""),
                    )
                    i += 1

            return records

    print("[TinyRef][ITEMDB] missing; building from:", str(direct_quote_lookup_json))
    raw2 = direct_quote_lookup_json.read_text(encoding="utf-8")
    obj2 = json.loads(raw2)

    # If user passed an item-level DB file directly
    if obj2.get("schema") == "tiny_ref_item_db_v1":
        items = obj2["items"]

        records2: list[dict] = []
        k = 0
        while k < len(items):
            it = items[k]
            records2.append(
                {
                    "item_key": str(it["item_key"]),
                    "author_summary": str(it.get("author_summary") or ""),
                    "first_author_last": str(it.get("first_author_last") or ""),
                    "year": str(it.get("year") or ""),
                    "title": str(it.get("title") or ""),
                    "source": str(it.get("source") or ""),
                    "url": it.get("url"),
                }
            )
            k += 1

        item_db.parent.mkdir(parents=True, exist_ok=True)
        item_db.write_text(
            json.dumps({"schema": "tiny_ref_item_db_v1", "items": records2}, ensure_ascii=False),
            encoding="utf-8",
        )

        legacy_cache.parent.mkdir(parents=True, exist_ok=True)
        legacy_cache.write_text(
            json.dumps({"schema": "tiny_ref_item_cache_v1", "records": records2}, ensure_ascii=False),
            encoding="utf-8",
        )

        print("[TinyRef][ITEMDB] created:", str(item_db))
        print("[TinyRef][ITEMDB] items:", len(records2))

        if not globals().get("_TINYREF_TOP10_LOGGED", False):
            globals()["_TINYREF_TOP10_LOGGED"] = True
            j = 0
            while j < len(records2) and j < 10:
                pl2 = records2[j]
                print(
                    "[TinyRef][TOP10]",
                    j + 1,
                    "item_key=",
                    str(pl2["item_key"]),
                    "|",
                    str(pl2.get("author_summary") or pl2.get("first_author_last") or ""),
                    "|",
                    str(pl2.get("year") or ""),
                    "|",
                    str(pl2.get("title") or ""),
                    "|",
                    str(pl2.get("source") or ""),
                )
                j += 1

        return records2

    # Otherwise assume direct_quote_lookup.json keyed by dqid, each payload has item_key
    dq_db = obj2

    by_item_key: dict[str, dict] = {}
    for dqid, payload in dq_db.items():
        pl = dict(payload)
        item_key = str(pl["item_key"]).strip()

        if item_key not in by_item_key:
            by_item_key[item_key] = {
                "item_key": item_key,
                "author_summary": str(pl.get("author_summary") or ""),
                "first_author_last": str(pl.get("first_author_last") or ""),
                "year": str(pl.get("year") or ""),
                "title": str(pl.get("title") or ""),
                "source": str(pl.get("source") or ""),
                "url": pl.get("url"),
            }

    records3 = list(by_item_key.values())
    records3.sort(
        key=lambda r: (
            str(r.get("first_author_last") or r.get("author_summary") or "").lower(),
            str(r.get("year") or ""),
            str(r.get("title") or "").lower(),
        )
    )

    item_db.parent.mkdir(parents=True, exist_ok=True)
    item_db.write_text(
        json.dumps({"schema": "tiny_ref_item_db_v1", "items": records3}, ensure_ascii=False),
        encoding="utf-8",
    )

    legacy_cache.parent.mkdir(parents=True, exist_ok=True)
    legacy_cache.write_text(
        json.dumps({"schema": "tiny_ref_item_cache_v1", "records": records3}, ensure_ascii=False),
        encoding="utf-8",
    )

    print("[TinyRef][ITEMDB] created:", str(item_db))
    print("[TinyRef][ITEMDB] items:", len(records3))

    j2 = 0
    while j2 < len(records3) and j2 < 10:
        pl3 = records3[j2]
        print(
            "[TinyRef][TOP10]",
            j2 + 1,
            "item_key=",
            str(pl3["item_key"]),
            "|",
            str(pl3.get("author_summary") or pl3.get("first_author_last") or ""),
            "|",
            str(pl3.get("year") or ""),
            "|",
            str(pl3.get("title") or ""),
            "|",
            str(pl3.get("source") or ""),
        )
        j2 += 1

    return records3


def _apa_author_list(author_summary: str) -> str:
    s = (author_summary or "").strip()

    parts: list[str] = []
    for chunk in s.split(";"):
        c = chunk.strip()
        if c != "":
            parts.append(c)

    authors_out: list[str] = []
    i = 0
    while i < len(parts):
        raw = parts[i].strip()
        toks = raw.split()

        last = toks[-1].strip()
        first_bits = toks[:-1]

        initials: list[str] = []
        j = 0
        while j < len(first_bits):
            fb = first_bits[j].strip()
            if fb != "":
                initials.append(fb[0].upper() + ".")
            j += 1

        if len(initials) == 0:
            name = last
        else:
            name = last + ", " + " ".join(initials)

        authors_out.append(name)
        i += 1

    if len(authors_out) == 0:
        return ""

    if len(authors_out) == 1:
        return authors_out[0]

    if len(authors_out) == 2:
        return authors_out[0] + ", & " + authors_out[1]

    head = ", ".join(authors_out[:-1])
    tail = authors_out[-1]
    return head + ", & " + tail



def _ensure_bibliography_store_exists(store_path: Path) -> None:
    if store_path.exists():
        print("[TinyRef][BIB] using existing store:", str(store_path))
        return

    store_path.parent.mkdir(parents=True, exist_ok=True)
    store_path.write_text(
        json.dumps({"style": "apa", "items": [], "numeric_map": {}, "numeric_next": 1}, ensure_ascii=False),
        encoding="utf-8",
    )
    print("[TinyRef][BIB] created store:", str(store_path))


def _ensure_bib_bibliographic_exists(path: Path) -> None:
    if path.exists():
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"schema": "bib_bibliographic_v1", "items": []}, ensure_ascii=False), encoding="utf-8")


def _load_direct_quote_lookup(path: Path) -> dict:
    raw = path.read_text(encoding="utf-8")
    return json.loads(raw)
