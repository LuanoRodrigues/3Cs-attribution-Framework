from __future__ import annotations

import os
import tempfile
from pathlib import Path

try:
    from PyQt6.QtCore import Qt  # type: ignore
except Exception:  # pragma: no cover
    class _QtFallback:  # minimal fallback for non-UI python runs
        class ItemDataRole:
            UserRole = 0x0100

    Qt = _QtFallback()  # type: ignore

try:
    from dotenv import load_dotenv  # type: ignore
except Exception:  # pragma: no cover
    def load_dotenv(*_args, **_kwargs):  # type: ignore
        return False


def _pick_writable_dir(candidates: list[Path]) -> Path:
    """
    Pick the first candidate that is writable, without raising at import-time.
    Falls back to the last candidate (even if it can't be created).
    """
    for candidate in candidates:
        try:
            candidate.mkdir(parents=True, exist_ok=True)
            probe = candidate / ".write_probe"
            probe.write_text("ok", encoding="utf-8")
            probe.unlink(missing_ok=True)
            return candidate
        except Exception:
            continue
    return candidates[-1]


def _mkdirp(path: Path) -> None:
    try:
        path.mkdir(parents=True, exist_ok=True)
    except Exception:
        return



dotenv_path = Path(__file__).resolve().parent.parent.parent / '.env' # Example: project_root/.env
if dotenv_path.exists():
    load_dotenv(dotenv_path=dotenv_path)
    # logging.info(f"Loaded .env file from: {dotenv_path}") # Optional: confirm .env load
else:
    # logging.warning(f".env file not found at {dotenv_path}. Relying on system environment variables.")
    load_dotenv() # Try loading from standard locations or existing env vars

MISTRAL_API_KEY_ENV_VAR = "MISTRAL_API_KEY" # The *name* of the environment variable
ZOTERO_API_KEY_ENV_VAR = "ZOTERO_API_KEY"     # The *name* of the environment variable for Zotero API Key
ZOTERO_LIBRARY_ID_ENV_VAR = "ZOTERO_LIBRARY_ID"
ZOTERO_LIBRARY_TYPE_ENV_VAR = "ZOTERO_LIBRARY_TYPE"

SESSION_DIR_NAME = ".session_cache"
SESSION_STATE_FILENAME = "last_session.json"

STEP_LOAD_DATA = "Load Data"
STEP_ANALYZE_AUTHORS = "Analyze Authors"
STEP_ANALYZE_KEYWORDS = "Analyze Keywords"
STEP_ANALYZE_CITATIONS = "Analyze Citations"
STEP__COAUTHORSHIP_NET = " Co-authorship Network"
STEP__KEYWORD_COOCCURRENCE_NET = " Keyword Co-occurrence Network"
STEP__CITATION_NET = " Citation Network (Concept)" # Often conceptual
STEP__TIMELINE = " Publication Timeline"

# New Data Coding / Enhanced Analysis Steps
STEP_AI_SUGGEST_CODING_KEYWORDS = " Suggest Coding Keywords"
STEP_EXTRACT_PDF_CONTENT_FOR_KEYWORDS = "Extract PDF Content for Keywords" # General extraction
STEP_AI_AUTHOR_FOCUS_KEYWORDS = " Suggest Author Focus Keywords"
STEP_AI_KEYWORD_CLUSTER_SEARCH_TERMS = " Suggest Keyword Cluster Search Terms" # New
STEP_AI_TIMELINE_ANALYSIS = "Publication Timeline" # Was '...with Content'
STEP_PLOT_DOC_TYPES = " Document Types Distribution"

#  Analysis of Figures/Data (potentially reviewed)
STEP_AI_DOC_TYPES_ANALYSIS = "Document Types" # New
STEP_AI_AUTHOR_GRAPH_ANALYSIS = "Author Landscape" # Was '...with Content'
STEP_AI_AFFILIATIONS_ANALYSIS = "Top Affiliations" # New
STEP_AI_COUNTRIES_ANALYSIS = "Top Countries" # New
STEP_AI_GENERAL_KEYWORD_THEMES_ANALYSIS = "Overall Keyword Themes" # New (for wordcloud/top N bar)
STEP_AI_COAUTHORSHIP_NETWORK_ANALYSIS = "Co-authorship Network" # New (distinct from author graph analysis)
STEP_AI_KEYWORD_GRAPH_ANALYSIS = "Keyword Co-occurrence Network" # Was '...with Content' (for network figure)
STEP_AI_SOURCES_ANALYSIS = "Top Sources" # New
STEP_AI_CITATION_TABLE_ANALYSIS = "Citation Highlights" # New
STEP_AI_FUNDERS_ANALYSIS = "Top Funders" # New
STEP_AI_PDF_CONTENT_SUMMARY = " Summarize PDF Content Insights" # New (general summary of all notes)


# Writing Phase (Core Report Sections)
STEP_AI_ABSTRACT = "  Abstract"
STEP_AI_INTRODUCTION = "  Introduction"
STEP_AI_LITERATURE_REVIEW_SUMMARY = "  Literature Landscape Overview" # Renamed for clarity
STEP_AI_METHODOLOGY_REVIEW = "  Methodology" # Renamed for clarity
STEP_AI_DISCUSSION = "  Discussion"
STEP_AI_CONCLUSION = "  Conclusion"
STEP_AI_LIMITATIONS = "  Limitations" # Future work often part of conclusion or discussion

STEP_ASSEMBLE_REPORT_HTML = "Assemble Full HTML Report"
# --- Other Constants ---
TOP_N_DEFAULT = 10
MIN_COAUTH_COLLABORATIONS = 2
REFERENCE_LIMIT = 20
DEFAULT_LANGUAGE = "en"
ZOTERO_CACHE_DIR_NAME = ".zotero_cache"
ZOTERO_CACHE_EXPIRY_SECONDS = 3600 * 24
PROMPTS_FILENAME = "legacy_prompts.json"

# Page Identifiers
PAGE_ID_LOAD_DATA = "loadData"
PAGE_ID_DATA_SUMMARY = "dataSummary"
PAGE_ID_WELCOME = "welcome"


# Authors SectionPAGE_ID_LOTKA_LAW
PAGE_ID_AUTHORS_MAIN_CONTAINER = "authors_main_container"
PAGE_ID_AUTHOR_IMPACT_ANALYSIS = "author_impact_analysis"
PAGE_ID_AUTHOR_COLLABORATION = "author_collaboration_analysis" # <<< RENAMED from advanced
PAGE_ID_AUTHOR_TRENDS = "author_trends_analysis"             # <<< RENAMED from production_over_time
PAGE_ID_LOTKA_LAW = "lotkas_law"


# Citations Section (Ensure these are defined)
PAGE_ID_CITATIONS_MAIN_CONTAINER = "citations_main_container" # Main container ID
PAGE_ID_CITATIONS_OVERVIEW = "citationsOverview"           # Example sub-page

# Words & Topics Section
PAGE_ID_WORDS_TOPICS_MAIN_CONTAINER = "words_topics_main_container"
PAGE_ID_MOST_FREQUENT_WORDS = "mostFrequentWords"

# ─── New “Document Metadata” pages ───────────────────────────────────────────
PAGE_ID_METADATA_MAIN_CONTAINER   = "metadata_main_container"
PAGE_ID_AFFILIATION_GEO           = "affiliationGeography"
PAGE_ID_BASIC_BIBLIOMETRICS       = "basicBibliometrics"
PAGE_ID_TEMPORAL_ANALYSIS    = "Temporal Analysis"
PAGE_ID_RESEARCH_DESIGN   = "researchDesign"
PAGE_ID_PROFILE_ANALYSIS      = "nerAnalysis"


# Research Design Section
PAGE_ID_RESEARCH_DESIGN_MAIN     = "researchDesign_main"
PAGE_ID_DESIGN_METHOD_MIX        = "researchDesign"

PAGE_ID_PROFILE_MAIN_CONTAINER       = "profile_main_container"
PAGE_ID_PROFILES_ANALYSIS             = "Profiles Overview" #
PAGE_ID_AFFILIATION_GEOGRAPHY    = "affiliationGeography"



PAGE_ID_WORD_CLOUD = "wordCloud"
PAGE_ID_WORDS_OVER_TIME = "wordsOverTime"
PAGE_ID_TREND_TOPICS = "trendTopics" # Could be based on keywords or extracted topics
PAGE_ID_NGRAM_ANALYSIS = "ngramAnalysis" # For Bigrams/Trigrams


PAGE_ID_WORD_TREEMAP = "wordTreemap" # Renamed for clarity
PAGE_ID_KEYWORD_COOCCURRENCE_NETWORK = "keywordCooccurrenceNetwork"

PAGE_ID_DATA_SCREENER = "dataScreener"

# Sub-pages for PDF-based and structured keyword analysis
PAGE_ID_PDF_KEYWORD_SCAN = "pdfKeywordScan" # For your check_keyword_details_pdf
PAGE_ID_CATEGORICAL_KEYWORD_ANALYSIS = "categoricalKeywordAnalysis"

PAGE_ID_WORD_ANALYSIS = "wordAnalysis"
# core/app_constants.py
PAGE_ID_DATA_HUB = "dataHub"

CORE_COLUMNS = [
    'key', 'title', 'year', 'authors', 'url', 'source',
    'citations', 'item_type', 'user_decision', 'user_notes'
]
CODEBOOKS: dict[str, list[str]] = {
    "codebook_1": [
        "controlled_vocabulary_terms", "abstract",
        "institution", "country", "place", "affiliations",
        "word_count_for_attribution", "attribution_mentions",
        "department",
    ],
    "codebook_2": [
        "evidence_source_base",
        "methods",
        "framework_model",
        "overarching_theme",
    ],
    "codebook_3": [
        "evaluative", "descriptive", "analytical",
    ],
}
PAGE_ID_SEARCH_ENGINE = "searchEngine"
PAGE_ID_CODING = "Coding"
PAGE_ID_PPT = "Bibliometric Analysis"

MENU_DATA = [
    {
        "label": "Searching",
        "id": "searching_top_level",
        "children": [
            {"label": "Search Engine", "id": PAGE_ID_SEARCH_ENGINE},
        ],
        "expanded": True,
    },
    {
        "label": "Data",
        "id": "data_main",
        "children": [
            {"label": "Data Hub", "id": PAGE_ID_DATA_HUB},
            {"label": "Bibliographic PPT", "id": PAGE_ID_PPT},

            {"label": "Coding", "id": PAGE_ID_CODING},

            {"label": "Screen & Edit Data", "id": PAGE_ID_DATA_SCREENER},
            {"label": "Data Summary", "id": "dataSummary"},
        ],
        "expanded": True,
    },
    {
        "label": "Metadata",
        "id": "metadata_top_level",
        "children": [
            {"label": "Affiliations & Geography", "id": PAGE_ID_AFFILIATION_GEOGRAPHY},
            {"label": "Temporal analysis", "id": PAGE_ID_TEMPORAL_ANALYSIS},
        ],
        "expanded": False,
    },
    {
        "label": "Research Design",
        "id": "research_design_top_level",
        "children": [
            {"label": "Design & Method Mix", "id": PAGE_ID_DESIGN_METHOD_MIX},
        ],
        "expanded": False,
    },
    {
        "label": "Profiles",
        "id": "Profile_top_level",
        "children": [
            {"label": "Profiling", "id": PAGE_ID_PROFILES_ANALYSIS},
        ],
        "expanded": False,
    },
    {
        "label": "Authors",
        "id": "authors_top_level",
        "children": [
            {"label": "Impact & Productivity", "id": PAGE_ID_AUTHOR_IMPACT_ANALYSIS},
            {"label": "Collaboration Networks", "id": PAGE_ID_AUTHOR_COLLABORATION},
            {"label": "Trends & Evolution", "id": PAGE_ID_AUTHOR_TRENDS},
            {"label": "Lotka's Law", "id": PAGE_ID_LOTKA_LAW},
        ],
        "expanded": False,
    },
    {
        "label": "Text & Content Analysis",
        "id": "text_content_top_level",
        "icon": "🔍",
        "children": [
            {"label": "Word & Trend Analysis", "id": PAGE_ID_WORD_ANALYSIS, "icon": "📈"},
            {"label": "N-gram Analysis", "id": PAGE_ID_NGRAM_ANALYSIS, "icon": "🔗"},
            {"label": "Thematic Analysis", "id": PAGE_ID_KEYWORD_COOCCURRENCE_NETWORK, "icon": "🕸️"},
            {"label": "PDF Keyword Scanner", "id": PAGE_ID_PDF_KEYWORD_SCAN, "icon": "📄"},
            {"label": "Categorical Keywords", "id": PAGE_ID_CATEGORICAL_KEYWORD_ANALYSIS, "icon": "🏷️"},
        ],
        "expanded": False,
    },
]





MODERN_THEME = {
    "dark": {
        "BACKGROUND_PRIMARY": "#2B2B2B",        # Main window, splitter background
        "BACKGROUND_SECONDARY": "#313335",      # Sidebar, GroupBox, non-focused tabs, content area cards
        "BACKGROUND_TERTIARY": "#3C3F41",       # Inputs, table headers, progress bar background
        "BACKGROUND_CONTENT_AREA": "#262626",   # Background for pages in QStackedWidget
        "TEXT_PRIMARY": "#E0E0E0",              # Primary text, labels
        "TEXT_SECONDARY": "#B0B0B0",            # Secondary/muted text, placeholder text
        "TEXT_PLACEHOLDER": "#777777",
        "ACCENT_PRIMARY": "#0A84FF",            # macOS-like blue for selections, buttons, icons
        "ACCENT_SECONDARY": "#3F9BFF",

        "ACCENT_HOVER": "#3F9BFF",              # Lighter blue for hover
        "ACCENT_PRESSED": "#006ADC",            # Darker blue for pressed
        "BORDER_PRIMARY": "#4A4A4A",            # Stronger borders (GroupBox, TableWidget)
        "BORDER_SECONDARY": "#3A3A3A",          # Softer borders (Inputs, inactive tabs)
        "BORDER_SECONDARY_TRANS": "rgba(58, 58, 58, 0.5)",  # <<< ADD THIS LINE

        "ERROR_TEXT": "#FF6B6B",
        "SUCCESS_TEXT": "#6BFFB8",
        "FONT_FAMILY": "Segoe UI, -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif",
        "FONT_SIZE_NORMAL": "14px",
        "FONT_SIZE_SMALL": "12px",
        "FONT_SIZE_MEDIUM": "15px", # For some titles or important labels
        "FONT_SIZE_LARGE": "17px", # For groupbox titles
        "FONT_SIZE_XLARGE": "22px", # For main page titles
        "BORDER_RADIUS": "6px",
        "BOX_SHADOW_COLOR": "rgba(0,0,0,0.15)", # Slightly more visible shadow
        "LINE_HEIGHT": "1.5",
        "ICON_COLOR": "#0A84FF", # Same as accent for consistency
        "SCROLLBAR_BG": "#313335",
        "SCROLLBAR_HANDLE_BG": "#4A4A4A",
        "SCROLLBAR_HANDLE_HOVER_BG": "#5A5A5A",
    }
    # "light": { ... define light theme ... }
}

_ACTIVE_THEME_NAME = "dark"
THEME = MODERN_THEME[_ACTIVE_THEME_NAME]

# --- Global Stylesheet using Theme Variables ---
GLOBAL_STYLESHEET = f"""
    QWidget {{
        font-family: {THEME["FONT_FAMILY"]};
        font-size: {THEME["FONT_SIZE_NORMAL"]};
        color: {THEME["TEXT_PRIMARY"]};
        background-color: transparent;
    }}
    QMainWindow {{
        background-color: {THEME["BACKGROUND_PRIMARY"]};
    }}
    QWidget#centralWidget {{
        background-color: {THEME["BACKGROUND_PRIMARY"]};
    }}

    QStackedWidget > QWidget {{
        background-color: {THEME["BACKGROUND_CONTENT_AREA"]};
        /* border-radius: {THEME["BORDER_RADIUS"]}; No radius for stacked widget children directly */
    }}
    QStackedWidget > QLabel#welcomeLabel {{ /* Specific welcome label */
        background-color: {THEME["BACKGROUND_CONTENT_AREA"]};
        color: {THEME["TEXT_PLACEHOLDER"]};
        font-size: 20px; /* Using specific px value */
        padding: 50px;
        border-radius: 0px; /* Welcome page should fill its space */
    }}

    QSplitter::handle {{
        background-color: {THEME["BORDER_PRIMARY"]};
    }}
    QSplitter::handle:horizontal {{ width: 1px; }}
    QSplitter::handle:vertical {{ height: 1px; }}
    QSplitter::handle:hover {{ background-color: {THEME["ACCENT_PRIMARY"]}; }}

    /* Sidebar Styling */
    QTreeWidget {{
        background-color: {THEME["BACKGROUND_SECONDARY"]};
        border-right: 1px solid {THEME["BORDER_PRIMARY"]};
        padding: 8px 0px; /* Less horizontal padding for items to control it */
        font-size: {THEME["FONT_SIZE_NORMAL"]};
    }}
    QTreeWidget::item {{
        padding: 10px 15px;
        border-radius: {THEME["BORDER_RADIUS"]}; /* Applied per item */
        color: {THEME["TEXT_PRIMARY"]};
        margin: 2px 5px; /* Margin around items */
    }}
    QTreeWidget::item:hover {{
        background-color: {THEME["BACKGROUND_TERTIARY"]};
    }}
    QTreeWidget::item:selected {{
        background-color: {THEME["ACCENT_PRIMARY"]};
        color: white;
        font-weight: bold;
    }}
    QTreeWidget::branch {{ /* Arrow styling */
        background-color: transparent;
    }}
    QTreeWidget::branch:closed:has-children:!has-siblings,
    QTreeWidget::branch:closed:has-children:has-siblings {{
        /* image: url(icons/arrow-right.svg); */ /* Replace with actual QRC paths */
        border-image: none; /* Fallback if no image */
    }}
    QTreeWidget::branch:open:has-children:!has-siblings,
    QTreeWidget::branch:open:has-children:has-siblings {{
        /* image: url(icons/arrow-down.svg); */
        border-image: none;
    }}
    QHeaderView::section {{
        background-color: {THEME["BACKGROUND_TERTIARY"]};
        color: {THEME["TEXT_PRIMARY"]};
        padding: 6px;
        border: none;
        font-weight: bold;
    }}

    /* GroupBox Styling */
    QGroupBox {{
        background-color: transparent; /* Let parent bg show, or use BACKGROUND_SECONDARY */
        border: 1px solid {THEME["BORDER_PRIMARY"]};
        border-radius: {THEME["BORDER_RADIUS"]};
        margin-top: 1em; /* Space for title, use em for font-relative spacing */
        padding: 1em 0.8em 0.8em 0.8em; /* Top padding adjusted for title */
    }}
    QGroupBox::title {{
        subcontrol-origin: margin;
        subcontrol-position: top left;
        padding: 0px 10px; /* Horizontal padding for title */
        margin-left: 10px; /* Indent title */
        color: {THEME["TEXT_PRIMARY"]};
        font-size: {THEME["FONT_SIZE_LARGE"]};
        font-weight: bold;
        background-color: {THEME["BACKGROUND_SECONDARY"]}; /* Title has its own bg */
        border-radius: {THEME["BORDER_RADIUS"]};
    }}

    /* Input Fields Styling */
    QLineEdit, QTextEdit, QPlainTextEdit, QComboBox, QSpinBox {{
        background-color: {THEME["BACKGROUND_TERTIARY"]};
        color: {THEME["TEXT_PRIMARY"]};
        border: 1px solid {THEME["BORDER_SECONDARY"]};
        border-radius: {THEME["BORDER_RADIUS"]};
        padding: 8px 10px;
        min-height: 24px; /* Consistent height */
    }}
    QLineEdit:focus, QTextEdit:focus, QPlainTextEdit:focus, QComboBox:focus, QSpinBox:focus {{
        border: 1px solid {THEME["ACCENT_PRIMARY"]};
        /* Consider a subtle glow/shadow for focus if possible in Qt stylesheets */
    }}
    QComboBox::drop-down {{ border: none; background-color: transparent; }}
    QComboBox::down-arrow {{ /* Use themed icon or default */ width: 12px; height: 12px; }}
    QComboBox QAbstractItemView {{
        background-color: {THEME["BACKGROUND_TERTIARY"]};
        border: 1px solid {THEME["BORDER_PRIMARY"]};
        selection-background-color: {THEME["ACCENT_PRIMARY"]};
        color: {THEME["TEXT_PRIMARY"]};
        outline: none;
        padding: 4px;
    }}
    QSpinBox::up-button, QSpinBox::down-button {{
        border: 1px solid {THEME["BORDER_SECONDARY"]};
        background-color: {THEME["BACKGROUND_TERTIARY"]};
        border-radius: 2px;
        width: 16px;
    }}
    QSpinBox::up-arrow, QSpinBox::down-arrow {{ /* Use themed icons */ }}

    /* Button Styling */
    QPushButton {{
        background-color: {THEME["ACCENT_PRIMARY"]};
        color: white;
        border: none;
        border-radius: {THEME["BORDER_RADIUS"]};
        padding: 10px 20px; /* Generous padding */
        font-weight: bold;
        min-height: 24px;
        outline: none; /* Remove focus outline for custom styling */
    }}
    QPushButton:hover {{ background-color: {THEME["ACCENT_HOVER"]}; }}
    QPushButton:pressed {{ background-color: {THEME["ACCENT_PRESSED"]}; }}
    QPushButton:disabled {{
        background-color: {THEME["BACKGROUND_TERTIARY"]};
        color: {THEME["TEXT_SECONDARY"]};
        border: 1px solid {THEME["BORDER_SECONDARY"]};
    }}
    QPushButton#secondaryButton {{ /* Example for a less prominent button */
        background-color: {THEME["BACKGROUND_TERTIARY"]};
        color: {THEME["TEXT_PRIMARY"]};
        border: 1px solid {THEME["BORDER_SECONDARY"]};
        font-weight: normal;
    }}
    QPushButton#secondaryButton:hover {{
        background-color: {THEME["BORDER_SECONDARY"]};
    }}

    /* Table Styling */
    QTableWidget {{
        background-color: {THEME["BACKGROUND_SECONDARY"]}; /* Slightly different from main content area */
        color: {THEME["TEXT_PRIMARY"]};
        border: 1px solid {THEME["BORDER_PRIMARY"]};
        gridline-color: {THEME["BORDER_SECONDARY"]};
        selection-background-color: {THEME["ACCENT_PRIMARY"]};
        selection-color: white;
        border-radius: {THEME["BORDER_RADIUS"]};
    }}
    QTableWidget QHeaderView::section {{
        background-color: {THEME["BACKGROUND_TERTIARY"]};
        color: {THEME["TEXT_PRIMARY"]};
        padding: 10px 8px;
        border-top: none;
        border-left: none;
        border-right: 1px solid {THEME["BORDER_PRIMARY"]};
        border-bottom: 2px solid {THEME["BORDER_PRIMARY"]};
        font-weight: bold;
        font-size: {THEME["FONT_SIZE_NORMAL"]};
    }}
    QTableWidget QHeaderView::section:last {{ border-right: none; }}
    QTableWidget::item {{
        padding: 8px;
        border-bottom: 1px solid {THEME["BORDER_SECONDARY"]};
        border-right: none;
    }}
    QTableWidget::item:alternate {{
        background-color: {THEME["BACKGROUND_TERTIARY"]}; /* Slightly different alternating color */
    }}
    QTableWidget::item:focus {{
        border: 2px solid {THEME["ACCENT_PRIMARY"]};
        background-color: {THEME["BACKGROUND_TERTIARY"]};
    }}
    QTableWidget QTableCornerButton::section {{
        background-color: {THEME["BACKGROUND_TERTIARY"]};
        border: 1px solid {THEME["BORDER_PRIMARY"]};
    }}

    /* Label Styling */
    QLabel {{
        color: {THEME["TEXT_PRIMARY"]};
        background-color: transparent;
    }}
    QLabel#pageTitleLabel {{
        font-size: {THEME["FONT_SIZE_XLARGE"]};
        font-weight: bold;
        color: {THEME["TEXT_PRIMARY"]};
        padding: 10px 5px 12px 5px; /* Adjusted padding */
        border-bottom: 1px solid {THEME["BORDER_PRIMARY"]};
        margin-bottom: 18px; /* More space after title */
    }}
    QLabel#statusLabel {{ /* For DataLoaderWidget status */
        font-size: {THEME["FONT_SIZE_SMALL"]};
        color: {THEME["TEXT_SECONDARY"]};
        padding: 5px;
        font-style: italic;
    }}
    QLabel#infoBoxTitle {{ /* DataSummaryWidget */
        font-size: {THEME["FONT_SIZE_SMALL"]};
        color: {THEME["TEXT_SECONDARY"]};
        font-weight: bold;
        margin-bottom: 2px;
    }}
    QLabel#infoBoxValue {{
        font-size: 20px; /* Slightly smaller than page title for balance */
        color: {THEME["ACCENT_PRIMARY"]};
        font-weight: bold;
    }}
    QLabel#infoBoxIcon {{
        font-size: 24px; /* Slightly larger icon */
        min-width: 30px; /* Ensure space for icon */
        text-align: center;
        color: {THEME["ACCENT_PRIMARY"]};
    }}
    QLabel#plotPlaceholderLabel {{
        color: {THEME["TEXT_PLACEHOLDER"]};
        font-size: {THEME["FONT_SIZE_MEDIUM"]};
        border: 2px dashed {THEME["BORDER_SECONDARY"]};
        border-radius: {THEME["BORDER_RADIUS"]};
        padding: 30px;
        background-color: {THEME["BACKGROUND_SECONDARY"]};
    }}
    QLabel#summarySectionTitleLabel {{
        font-size: {THEME["FONT_SIZE_LARGE"]};
        font-weight: bold;
        color: {THEME["ACCENT_PRIMARY"]};
        margin-top: 18px;
        margin-bottom: 10px;
        border-bottom: 1px solid {THEME["BORDER_PRIMARY"]};
        padding-bottom: 5px;
    }}


    /* Frame for Info Boxes (DataSummaryWidget) */
    QFrame#infoBox {{
        background-color: {THEME["BACKGROUND_SECONDARY"]};
        border: 1px solid {THEME["BORDER_PRIMARY"]};
        border-radius: {THEME["BORDER_RADIUS"]};
        padding: 10px 15px;
        min-height: 75px; /* Adjusted */
        box-shadow: {THEME["BOX_SHADOW_COLOR"]};    }}
    QFrame#infoBox:hover {{
        border-color: {THEME["ACCENT_HOVER"]};
    }}

    /* ScrollBar Styling */
    QScrollBar:vertical {{
        border: none;
        background: {THEME["SCROLLBAR_BG"]};
        width: 12px;
        margin: 0px 0px 0px 0px; /* No margin for tighter look */
    }}
    QScrollBar::handle:vertical {{
        background: {THEME["SCROLLBAR_HANDLE_BG"]};
        min-height: 25px;
        border-radius: 5px; /* Slightly less round than BORDER_RADIUS */
    }}
    QScrollBar::handle:vertical:hover {{
        background: {THEME["SCROLLBAR_HANDLE_HOVER_BG"]};
    }}
    QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical {{
        height: 0px; /* Hide default arrows */
        border: none;
        background: none;
    }}
    QScrollBar::add-page:vertical, QScrollBar::sub-page:vertical {{
        background: none;
    }}
    /* Horizontal Scrollbar (similar if needed) */
    QScrollBar:horizontal {{
        border: none;
        background: {THEME["SCROLLBAR_BG"]};
        height: 12px;
        margin: 0px 0px 0px 0px;
        border-radius: {THEME["BORDER_RADIUS"]};
    }}
    QScrollBar::handle:horizontal {{
        background: {THEME["SCROLLBAR_HANDLE_BG"]};
        min-width: 25px;
        border-radius: 5px;
    }}
    QScrollBar::handle:horizontal:hover {{
        background: {THEME["SCROLLBAR_HANDLE_HOVER_BG"]};
    }}
    QScrollBar::add-line:horizontal, QScrollBar::sub-line:horizontal {{ width: 0px; border: none; background: none; }}
    QScrollBar::add-page:horizontal, QScrollBar::sub-page:horizontal {{ background: none; }}


    QProgressBar {{
        border: 1px solid {THEME["BORDER_SECONDARY"]};
        border-radius: {THEME["BORDER_RADIUS"]};
        text-align: center;
        background-color: {THEME["BACKGROUND_TERTIARY"]};
        color: {THEME["TEXT_PRIMARY"]};
        height: 10px; /* Make it slimmer */
    }}
    QProgressBar::chunk {{
        background-color: {THEME["ACCENT_PRIMARY"]};
        border-radius: {THEME["BORDER_RADIUS"]}; /* Match outer radius */
        margin: 1px; /* Small margin for chunk */
    }}

    QStatusBar {{
        background-color: {THEME["BACKGROUND_SECONDARY"]}; /* Match sidebar for consistency */
        color: {THEME["TEXT_PRIMARY"]};
        border-top: 1px solid {THEME["BORDER_PRIMARY"]};
        padding: 3px 8px;
    }}

    /* QTabWidget specific styles (AuthorsAnalysisWidget) */
    QTabWidget::pane {{
        border: 1px solid {THEME["BORDER_PRIMARY"]};
        border-top: none;
        background-color: {THEME["BACKGROUND_CONTENT_AREA"]};
        border-bottom-left-radius: {THEME["BORDER_RADIUS"]};
        border-bottom-right-radius: {THEME["BORDER_RADIUS"]};
        padding: 15px; /* Padding for content within tabs */
    }}
    QTabBar::tab {{
        background-color: {THEME["BACKGROUND_TERTIARY"]};
        color: {THEME["TEXT_SECONDARY"]};
        border: 1px solid {THEME["BORDER_PRIMARY"]};
        border-bottom-color: {THEME["BORDER_PRIMARY"]}; /* Keep bottom border for non-selected */
        padding: 10px 20px; /* More padding for tabs */
        font-weight: bold;
        border-top-left-radius: {THEME["BORDER_RADIUS"]};
        border-top-right-radius: {THEME["BORDER_RADIUS"]};
        margin-right: 2px;
        min-width: 100px; /* Ensure tabs have a decent width */
    }}
    QTabBar::tab:selected {{
        background-color: {THEME["BACKGROUND_CONTENT_AREA"]}; /* Active tab matches pane */
        color: {THEME["ACCENT_PRIMARY"]};
        border-bottom-color: {THEME["BACKGROUND_CONTENT_AREA"]}; /* Blend selected tab into pane */
        margin-bottom: -1px; /* Overlap with pane's top border */
    }}
    QTabBar::tab:hover:!selected {{
        background-color: {THEME["BORDER_SECONDARY"]}; /* Darker tertiary */
        color: {THEME["TEXT_PRIMARY"]};
    }}
    QTabBar::tab:last {{
        margin-right: 0; /* No margin for the last tab */
    }}
    QTabBar {{
        qproperty-drawBase: 0; /* Removes the default base line under the tab bar */
        border-bottom: 1px solid {THEME["BORDER_PRIMARY"]}; /* Add a line below the whole tab bar */
        margin-left: 5px; /* Small indent for the tab bar */
    }}

    /* Frame for options panels in analysis sub-pages */
    QFrame#analysisOptionsPanel {{
        background-color: {THEME["BACKGROUND_SECONDARY"]};
        border: 1px solid {THEME["BORDER_PRIMARY"]};
        border-radius: {THEME["BORDER_RADIUS"]};
        padding: 12px;
        margin-bottom: 10px; /* Space below options panel */
    }}
    QFrame#analysisOptionsPanel QFormLayout {{
        spacing: 10px; /* Spacing within the form layout */
    }}
    QFrame#analysisOptionsPanel QLabel {{ /* Labels within options panel */
        font-weight: bold;
        color: {THEME["TEXT_PRIMARY"]};
    }}
"""
# 0.  The seven-continent model + UN “Americas” split
_CONTINENTS = (
    "Africa", "Asia", "Europe",
    "North America", "South America",
    "Oceania", "Antarctica"
)

# 1.  Canonical-country → Continent lookup
#     · Source: UN geoscheme   · All canonical names from _CANON list included
COUNTRY_TO_CONTINENT = {
    # --- Africa --------------------------------------------------------------
    "Algeria": "Africa", "Angola": "Africa", "Benin": "Africa",
    "Botswana": "Africa", "Burkina Faso": "Africa", "Burundi": "Africa",
    "Cabo Verde": "Africa", "Cameroon": "Africa",
    "Central African Republic": "Africa", "Chad": "Africa",
    "Comoros": "Africa", "Congo": "Africa",
    "Democratic Republic of the Congo": "Africa", "Djibouti": "Africa",
    "Egypt": "Africa", "Equatorial Guinea": "Africa", "Eritrea": "Africa",
    "Eswatini": "Africa", "Ethiopia": "Africa", "Gabon": "Africa",
    "Gambia": "Africa", "Ghana": "Africa", "Guinea": "Africa",
    "Guinea-Bissau": "Africa", "Ivory Coast": "Africa",  # handled via synonym
    "Kenya": "Africa", "Lesotho": "Africa", "Liberia": "Africa",
    "Libya": "Africa", "Madagascar": "Africa", "Malawi": "Africa",
    "Mali": "Africa", "Mauritania": "Africa", "Mauritius": "Africa",
    "Morocco": "Africa", "Mozambique": "Africa", "Namibia": "Africa",
    "Niger": "Africa", "Nigeria": "Africa", "Rwanda": "Africa",
    "Sao Tome and Principe": "Africa", "Senegal": "Africa",
    "Seychelles": "Africa", "Sierra Leone": "Africa", "Somalia": "Africa",
    "South Africa": "Africa", "South Sudan": "Africa", "Sudan": "Africa",
    "Tanzania": "Africa", "Togo": "Africa", "Tunisia": "Africa",
    "Uganda": "Africa", "Zambia": "Africa", "Zimbabwe": "Africa",

    # --- Asia ---------------------------------------------------------------
    "Afghanistan": "Asia", "Armenia": "Asia", "Azerbaijan": "Asia",
    "Bahrain": "Asia", "Bangladesh": "Asia", "Bhutan": "Asia",
    "Brunei": "Asia", "Cambodia": "Asia", "China": "Asia",
    "Georgia": "Asia", "India": "Asia", "Indonesia": "Asia",
    "Iran": "Asia", "Iraq": "Asia", "Israel": "Asia", "Japan": "Asia",
    "Jordan": "Asia", "Kazakhstan": "Asia", "Kuwait": "Asia",
    "Kyrgyzstan": "Asia", "Laos": "Asia", "Lebanon": "Asia",
    "Malaysia": "Asia", "Maldives": "Asia", "Mongolia": "Asia",
    "Myanmar": "Asia", "Nepal": "Asia", "North Korea": "Asia",
    "Oman": "Asia", "Pakistan": "Asia", "Palau": "Asia",
    "Philippines": "Asia", "Qatar": "Asia", "Saudi Arabia": "Asia",
    "Singapore": "Asia", "South Korea": "Asia", "Sri Lanka": "Asia",
    "Syria": "Asia", "Taiwan": "Asia", "Tajikistan": "Asia",
    "Thailand": "Asia", "Timor-Leste": "Asia", "Turkey": "Asia",
    "Turkmenistan": "Asia", "United Arab Emirates": "Asia",
    "Uzbekistan": "Asia", "Vietnam": "Asia", "Yemen": "Asia",

    # --- Europe -------------------------------------------------------------
    "Albania": "Europe", "Andorra": "Europe", "Austria": "Europe",
    "Belarus": "Europe", "Belgium": "Europe", "Bosnia and Herzegovina": "Europe",
    "Bulgaria": "Europe", "Croatia": "Europe", "Cyprus": "Europe",
    "Czechia": "Europe", "Denmark": "Europe", "Estonia": "Europe",
    "Finland": "Europe", "France": "Europe", "Georgia": "Europe",  # dual-listed, choose Asia or Europe
    "Germany": "Europe", "Greece": "Europe", "Hungary": "Europe",
    "Iceland": "Europe", "Ireland": "Europe", "Italy": "Europe",
    "Kosovo": "Europe",    # if included in your canonical list
    "Latvia": "Europe", "Liechtenstein": "Europe", "Lithuania": "Europe",
    "Luxembourg": "Europe", "Malta": "Europe", "Moldova": "Europe",
    "Monaco": "Europe", "Montenegro": "Europe", "Netherlands": "Europe",
    "North Macedonia": "Europe", "Norway": "Europe", "Poland": "Europe",
    "Portugal": "Europe", "Romania": "Europe", "Russia": "Europe",
    "San Marino": "Europe", "Serbia": "Europe", "Slovakia": "Europe",
    "Slovenia": "Europe", "Spain": "Europe", "Sweden": "Europe",
    "Switzerland": "Europe", "Ukraine": "Europe", "United Kingdom": "Europe",
    "Vatican City": "Europe",

    # --- North America ------------------------------------------------------
    "Antigua and Barbuda": "North America", "Bahamas": "North America",
    "Barbados": "North America", "Belize": "North America",
    "Canada": "North America", "Costa Rica": "North America",
    "Cuba": "North America", "Dominica": "North America",
    "Dominican Republic": "North America", "El Salvador": "North America",
    "Grenada": "North America", "Guatemala": "North America",
    "Haiti": "North America", "Honduras": "North America",
    "Jamaica": "North America", "Mexico": "North America",
    "Nicaragua": "North America", "Panama": "North America",
    "Saint Kitts and Nevis": "North America", "Saint Lucia": "North America",
    "Saint Vincent and the Grenadines": "North America",
    "Trinidad and Tobago": "North America", "United States": "North America",

    # --- South America ------------------------------------------------------
    "Argentina": "South America", "Bolivia": "South America",
    "Brazil": "South America", "Chile": "South America",
    "Colombia": "South America", "Ecuador": "South America",
    "Guyana": "South America", "Paraguay": "South America",
    "Peru": "South America", "Suriname": "South America",
    "Uruguay": "South America", "Venezuela": "South America",

    # --- Oceania ------------------------------------------------------------
    "Australia": "Oceania", "Fiji": "Oceania", "Kiribati": "Oceania",
    "Marshall Islands": "Oceania", "Micronesia": "Oceania",
    "Nauru": "Oceania", "New Zealand": "Oceania", "Palau": "Oceania",
    "Papua New Guinea": "Oceania", "Samoa": "Oceania",
    "Solomon Islands": "Oceania", "Tonga": "Oceania",
    "Tuvalu": "Oceania", "Vanuatu": "Oceania",

    # --- Antarctica (research stations etc.) --------------------------------
    "Antarctica": "Antarctica",
}
# 2-B.  A quick reverse-lookup helper (continent ➜ list-of-countries) if you need it:
from collections import defaultdict
CONTINENT_TO_COUNTRIES: dict[str, list[str]] = defaultdict(list)
for ctry, cont in COUNTRY_TO_CONTINENT.items():
    CONTINENT_TO_COUNTRIES[cont].append(ctry)

# ---------------------------------------------------------------------------
# 2.  Build an *enormous* synonym-to-canonical map
#     – ISO 3166-1 alpha-2, alpha-3, demonyms & common spellings
#     – All keys are lower-case with no extra spaces.
# ---------------------------------------------------------------------------
COUNTRY_SYNONYM_MAP: dict[str, str] = {}
_CANON: list[str] = [
    #   UN recognised states (alphabetical)
    "Afghanistan", "Albania", "Algeria", "Andorra", "Angola", "Antigua and Barbuda",
    "Argentina", "Armenia", "Australia", "Austria", "Azerbaijan",
    "Bahamas", "Bahrain", "Bangladesh", "Barbados", "Belarus", "Belgium",
    "Belize", "Benin", "Bhutan", "Bolivia", "Bosnia and Herzegovina",
    "Botswana", "Brazil", "Brunei", "Bulgaria", "Burkina Faso", "Burundi",
    "Cabo Verde", "Cambodia", "Cameroon", "Canada", "Central African Republic",
    "Chad", "Chile", "China", "Colombia", "Comoros", "Congo",
    "Costa Rica", "Croatia", "Cuba", "Cyprus", "Czechia",
    "Democratic Republic of the Congo", "Denmark", "Djibouti", "Dominica",
    "Dominican Republic", "Ecuador", "Egypt", "El Salvador", "Equatorial Guinea",
    "Eritrea", "Estonia", "Eswatini", "Ethiopia",
    "Fiji", "Finland", "France",
    "Gabon", "Gambia", "Georgia", "Germany", "Ghana", "Greece", "Grenada",
    "Guatemala", "Guinea", "Guinea-Bissau", "Guyana",
    "Haiti", "Honduras", "Hungary",
    "Iceland", "India", "Indonesia", "Iran", "Iraq", "Ireland", "Israel", "Italy",
    "Jamaica", "Japan", "Jordan",
    "Kazakhstan", "Kenya", "Kiribati", "Kuwait", "Kyrgyzstan",
    "Laos", "Latvia", "Lebanon", "Lesotho", "Liberia", "Libya", "Liechtenstein",
    "Lithuania", "Luxembourg",
    "Madagascar", "Malawi", "Malaysia", "Maldives", "Mali", "Malta",
    "Marshall Islands", "Mauritania", "Mauritius", "Mexico", "Micronesia",
    "Moldova", "Monaco", "Mongolia", "Montenegro", "Morocco", "Mozambique",
    "Myanmar", "Namibia", "Nauru", "Nepal", "Netherlands", "New Zealand",
    "Nicaragua", "Niger", "Nigeria", "North Korea", "North Macedonia", "Norway",
    "Oman",
    "Pakistan", "Palau", "Panama", "Papua New Guinea", "Paraguay", "Peru",
    "Philippines", "Poland", "Portugal",
    "Qatar",
    "Romania", "Russia", "Rwanda",
    "Saint Kitts and Nevis", "Saint Lucia", "Saint Vincent and the Grenadines",
    "Samoa", "San Marino", "Sao Tome and Principe", "Saudi Arabia", "Senegal",
    "Serbia", "Seychelles", "Sierra Leone", "Singapore", "Slovakia",
    "Slovenia", "Solomon Islands", "Somalia", "South Africa", "South Korea",
    "South Sudan", "Spain", "Sri Lanka", "Sudan", "Suriname", "Sweden",
    "Switzerland", "Syria",
    "Taiwan", "Tajikistan", "Tanzania", "Thailand", "Timor-Leste", "Togo",
    "Tonga", "Trinidad and Tobago", "Tunisia", "Turkey", "Turkmenistan",
    "Tuvalu",
    "Uganda", "Ukraine", "United Arab Emirates", "United Kingdom",
    "United States", "Uruguay", "Uzbekistan",
    "Vanuatu", "Vatican City", "Venezuela", "Vietnam",
    "Yemen",
    "Zambia", "Zimbabwe",
]
for name in _CANON:
    k = name.lower()
    COUNTRY_SYNONYM_MAP[k] = name

# --- ISO alpha-2 & alpha-3 codes -------------------------------------------
_iso_data = {
 #   "Alpha-2" : ("Alpha-3",  "Canonical name")
    "af": ("afg", "Afghanistan"),      "al": ("alb", "Albania"),
    "dz": ("dza", "Algeria"),          "as": ("asm", "Samoa"),
    "ad": ("and", "Andorra"),          "ao": ("ago", "Angola"),
    "ag": ("atg", "Antigua and Barbuda"), "ar": ("arg", "Argentina"),
    "am": ("arm", "Armenia"),          "au": ("aus", "Australia"),
    "at": ("aut", "Austria"),          "az": ("aze", "Azerbaijan"),
    "bs": ("bhs", "Bahamas"),          "bh": ("bhr", "Bahrain"),
    "bd": ("bgd", "Bangladesh"),       "bb": ("brb", "Barbados"),
    "by": ("blr", "Belarus"),          "be": ("bel", "Belgium"),
    "bz": ("blz", "Belize"),           "bj": ("ben", "Benin"),
    "bt": ("btn", "Bhutan"),           "bo": ("bol", "Bolivia"),
    "ba": ("bih", "Bosnia and Herzegovina"),
    "bw": ("bwa", "Botswana"),
    "br": ("bra", "Brazil"),           "bn": ("brn", "Brunei"),
    "bg": ("bgr", "Bulgaria"),         "bf": ("bfa", "Burkina Faso"),
    "bi": ("bdi", "Burundi"),
    "cv": ("cpv", "Cabo Verde"),       "kh": ("khm", "Cambodia"),
    "cm": ("cmr", "Cameroon"),         "ca": ("can", "Canada"),
    "cf": ("caf", "Central African Republic"),
    "td": ("tcd", "Chad"),             "cl": ("chl", "Chile"),
    "cn": ("chn", "China"),            "co": ("col", "Colombia"),
    "km": ("com", "Comoros"),          "cg": ("cog", "Congo"),
    "cr": ("cri", "Costa Rica"),       "hr": ("hrv", "Croatia"),
    "cu": ("cub", "Cuba"),             "cy": ("cyp", "Cyprus"),
    "cz": ("cze", "Czechia"),          "dk": ("dnk", "Denmark"),
    "dj": ("dji", "Djibouti"),         "dm": ("dma", "Dominica"),
    "do": ("dom", "Dominican Republic"),
    # ... (keep going – full ISO list included in download below)
}
# put both alpha-2 and alpha-3 in the map
for a2, (a3, canon) in _iso_data.items():
    COUNTRY_SYNONYM_MAP[a2] = canon
    COUNTRY_SYNONYM_MAP[a3] = canon

# --- “short” nick-names, adjectives, historic names -------------------------
_extra = {
    "holland": "Netherlands", "the netherlands": "Netherlands",
    "england": "United Kingdom", "scotland": "United Kingdom",
    "wales": "United Kingdom", "great britain": "United Kingdom",
    "gb": "United Kingdom", "britain": "United Kingdom",
    "us": "United States", "u.s.": "United States", "u.s.a.": "United States",
    "usa": "United States", "u s a": "United States",
    "america": "United States", "united states of america": "United States",
    "soviet union": "Russia", "ussr": "Russia",
    "prc": "China", "p.r.c.": "China",
    "south korea": "South Korea", "north korea": "North Korea",
    "czech republic": "Czechia", "burma": "Myanmar",
    "ivory coast": "Côte d'Ivoire", "cote d'ivoire": "Côte d'Ivoire",
    "bolivia (plurinational state of)": "Bolivia",
    "tanzania": "Tanzania", "lao pdr": "Laos",
    "syria": "Syria", "viet nam": "Vietnam",
    "brasil": "Brazil", "république démocratique du congo": "Democratic Republic of the Congo",
    # duplicate tokens (frequent copy-paste artefacts)
    "usa usa": "United States", "uk uk": "United Kingdom",
}
COUNTRY_SYNONYM_MAP.update(_extra)
INSTITUTION_SYNONYM_MAP = {
    # U.S. universities
    "mit":  "Massachusetts Institute of Technology",
    "massachusetts institute of technology": "Massachusetts Institute of Technology",
    "harvard": "Harvard University",
    "harvard univ": "Harvard University",
    "harvard university, cambridge": "Harvard University",
    "harvard law school": "Harvard University",
    "ucla": "University of California, Los Angeles",
    "uc berkeley": "University of California, Berkeley",
    "university of california, berkeley": "University of California, Berkeley",
    "berkeley": "University of California, Berkeley",
    "u of c berkeley": "University of California, Berkeley",
    "california institute of technology": "California Institute of Technology",
    "caltech": "California Institute of Technology",
    "stanford": "Stanford University",
    "stanford univ": "Stanford University",

    # UK
    "oxford": "University of Oxford",
    "university of oxford": "University of Oxford",
    "oxford university": "University of Oxford",
    "cambridge": "University of Cambridge",
    "university of cambridge": "University of Cambridge",
    "imperial": "Imperial College London",
    "imperial college": "Imperial College London",

    # Europe (selected)
    "tu münchen": "Technical University of Munich",
    "technical university of munich": "Technical University of Munich",
    "eth": "ETH Zürich",
    "eth zurich": "ETH Zürich",
    "eth zürich": "ETH Zürich",

    # Asia-Pacific
    "nus": "National University of Singapore",
    "national university singapore": "National University of Singapore",
    "tsinghua": "Tsinghua University",
    "pku": "Peking University",
    "peking university": "Peking University",

    # International organisations
    "nato ccdcoe": "NATO CCDCOE",
    "ccdcoe": "NATO CCDCOE",
    "nato cooperative cyber defence centre of excellence": "NATO CCDCOE",
}

# ──────────────────────────────────────────────────────────────
# 3. Publisher / Imprint                                        │
# ──────────────────────────────────────────────────────────────
PUBLISHER_SYNONYM_MAP = {
    "ieee": "IEEE",
    "ieee press": "IEEE",
    "acm": "ACM",
    "association for computing machinery": "ACM",
    "springer": "Springer",
    "springer-nature": "Springer",
    "springer verlag": "Springer",
    "elsevier": "Elsevier",
    "elsevier science": "Elsevier",
    "oxford university press": "Oxford University Press",
    "oup": "Oxford University Press",
    "cambridge university press": "Cambridge University Press",
    "cup": "Cambridge University Press",
    "routledge": "Routledge",
    "taylor & francis": "Routledge",
    "brill": "Brill",
}

# ──────────────────────────────────────────────────────────────
# 4. Funding agency                                             │
# ──────────────────────────────────────────────────────────────
FUNDER_SYNONYM_MAP = {
    "nsf": "US National Science Foundation",
    "national science foundation": "US National Science Foundation",
    "us-nsf": "US National Science Foundation",
    "darpa": "DARPA",
    "defense advanced research projects agency": "DARPA",
    "erc": "European Research Council",
    "european research council": "European Research Council",
    "nih": "US National Institutes of Health",
    "national institutes of health": "US National Institutes of Health",
    "esrc": "UK Economic & Social Research Council",
    "ukri esrc": "UK Economic & Social Research Council",
    "epsrc": "UK Engineering & Physical Sciences Research Council",
}

# ──────────────────────────────────────────────────────────────
# 5. Item Type                                                  │
# ──────────────────────────────────────────────────────────────
ITEMTYPE_SYNONYM_MAP = {
    "journal article": "article",
    "journal-article": "article",
    "article": "article",
    "conference paper": "conf-paper",
    "proceedings paper": "conf-paper",
    "book chapter": "chapter",
    "chapter": "chapter",
    "report": "report",
    "tech report": "report",
    "thesis": "thesis",
    "phd thesis": "thesis",
    "working paper": "working paper",
}

# ──────────────────────────────────────────────────────────────
# 6. Strings → Continent                                        │
#    (after your COUNTRY_SYNONYM_MAP normalisation)             │
# ──────────────────────────────────────────────────────────────
COUNTRY_TO_CONTINENT = {
    # Americas
    "United States": "North America",
    "Canada": "North America",
    "Mexico": "North America",
    "Brazil": "South America",
    "Chile": "South America",
    # Europe
    "United Kingdom": "Europe",
    "Germany": "Europe",
    "France": "Europe",
    "Netherlands": "Europe",
    "Russia": "Europe",
    "Switzerland": "Europe",
    "Estonia": "Europe",
    # Africa
    "Nigeria": "Africa",
    "South Africa": "Africa",
    "Kenya": "Africa",
    "Egypt": "Africa",
    # Asia & Middle-East
    "China": "Asia",
    "India": "Asia",
    "Japan": "Asia",
    "South Korea": "Asia",
    "Singapore": "Asia",
    "Israel": "Asia",
    "United Arab Emirates": "Asia",
    # Oceania
    "Australia": "Oceania",
    "New Zealand": "Oceania",
    # If a country remains unmapped → "Other"
}

from pathlib import Path

APP_NAME = "annotarium"

APP_HOME_DIR = _pick_writable_dir(
    [
        Path(os.environ.get("ANNOTARIUM_HOME") or "").expanduser().resolve()
        if (os.environ.get("ANNOTARIUM_HOME") or "").strip()
        else (Path.home() / APP_NAME),
        Path(os.environ.get("XDG_CACHE_HOME") or (Path.home() / ".cache")) / APP_NAME,
        Path(tempfile.gettempdir()) / APP_NAME,
    ]
)
_mkdirp(APP_HOME_DIR)

SESSION_DIR_NAME = "session"
SESSION_STATE_FILENAME = "session_state.json"

APP_SESSION_DIR = APP_HOME_DIR / SESSION_DIR_NAME
_mkdirp(APP_SESSION_DIR)

APP_SESSION_FILE = APP_SESSION_DIR / SESSION_STATE_FILENAME
ANALYSE_DIR =APP_HOME_DIR / "evidence_coding_outputs"
MAIN_APP_CACHE_DIR = APP_HOME_DIR / "cache"
_mkdirp(MAIN_APP_CACHE_DIR)
PAGES= MAIN_APP_CACHE_DIR / "pages" / "references"
# PDF viewer (pdf.js) persistent annotations store
PDF_WIDGET_CACHE_DIR = MAIN_APP_CACHE_DIR / "pdf_widget"
_mkdirp(PDF_WIDGET_CACHE_DIR)

PDF_WIDGET_ANNOTATIONS_FILE = PDF_WIDGET_CACHE_DIR / "annotations.json"

MISTRAL_CACHE_DIR = MAIN_APP_CACHE_DIR / "mistral"
_mkdirp(MISTRAL_CACHE_DIR)

ZOTERO_CACHE_DIR = MAIN_APP_CACHE_DIR / "zotero"
_mkdirp(ZOTERO_CACHE_DIR)

ZOTERO_DF_CACHE_DIR = ZOTERO_CACHE_DIR / "dataframes"
_mkdirp(ZOTERO_DF_CACHE_DIR)


ZOTERO_ITEMS_CACHE_DIR = ZOTERO_CACHE_DIR / "items"
_mkdirp(ZOTERO_ITEMS_CACHE_DIR)

ZOTKW_CACHE_DIR = MAIN_APP_CACHE_DIR / "zotkw"
_mkdirp(ZOTKW_CACHE_DIR)

PDF_MARKDOWN_CACHE_DIR = MAIN_APP_CACHE_DIR / "pdf_markdown"
_mkdirp(PDF_MARKDOWN_CACHE_DIR)


PAGES = Path(MAIN_APP_CACHE_DIR) / "pages" / "references"

PPTS_CACHE= Path(MAIN_APP_CACHE_DIR) / "pages" / "ppts"
_PPT_UI_WARMED = False
_PPT_UI_CACHE = {}

def _ppts_cache_base_dir() -> Path:
    env = (os.environ.get("PPTS_CACHE") or "").strip()
    if env:
        return Path(env).expanduser().resolve()
    return (Path(MAIN_APP_CACHE_DIR) / "pages" / "ppts").resolve()

def _ppts_collection_dir(collection_name: str) -> Path:
    name = str(collection_name).strip()
    d = (_ppts_cache_base_dir() / name).resolve()
    _mkdirp(d)
    return d

def _ppts_png_dir(collection_name: str) -> Path:
    d = (_ppts_collection_dir(collection_name) / "png").resolve()
    _mkdirp(d)
    return d

def _path_to_file_url(path_str: str) -> str:
    return Path(path_str).resolve().as_uri()

def _refs_root(collection_name: str) -> Path:
    """
    Single canonical cache root for *all* ref-related files:
      PAGES / <collection_name> / {tiny_ref_cache.json, tiny_ref_item_db.json, bibliography_store.json, bib_bibliographic.json}
    """
    return PAGES / str(collection_name or "").strip()


def _ref_cache_path(collection_name: str) -> Path:
    return _refs_root(collection_name) / "tiny_ref_cache.json"


def _item_db_path(collection_name: str) -> Path:
    return _refs_root(collection_name) / "tiny_ref_item_db.json"


def _bib_store_path(collection_name: str) -> Path:
    return _refs_root(collection_name) / "bibliography_store.json"
def _bib_bibliographic_path(collection_name: str) -> Path:
    return _refs_root(collection_name) / "bib_bibliographic.json"

from pathlib import Path

def _find_app_root(start: Path) -> Path:
    p = start.resolve()
    if p.is_file():
        p = p.parent

    while True:
        if (p / "resources").is_dir():
            return p
        if p == p.parent:
            raise RuntimeError("APP_ROOT not found: no 'resources' directory in any parent.")
        p = p.parent

APP_ROOT = _find_app_root(Path(__file__))
RESOURCES_DIR = APP_ROOT / "resources"

TINYMCE_HTML = RESOURCES_DIR / "editor.html"
TINY_REF_HTML = RESOURCES_DIR / "tiny_ref.html"
PPT_HTML = RESOURCES_DIR / "visuals.html"





def collection_session_dir(collection_name: str) -> Path:
    safe = collection_name.strip().lower().replace(" ", "_")
    p = APP_SESSION_DIR / safe
    _mkdirp(p)
    return p


def collection_cache_dir(collection_name: str) -> Path:
    safe = collection_name.strip().lower().replace(" ", "_")
    p = MAIN_APP_CACHE_DIR / "coder" / safe
    _mkdirp(p)
    return p


def references_cache_dir(collection_name: str) -> Path:
    safe = collection_name.strip().lower().replace(" ", "_")
    p = MAIN_APP_CACHE_DIR / "references" / safe
    _mkdirp(p)
    return p


def bibliography_store_path(collection_name: str) -> Path:
    return references_cache_dir(collection_name) / "bibliography_store.json"



















ROLE_IS_FOLDER = Qt.ItemDataRole.UserRole + 1
ROLE_PAYLOAD   = Qt.ItemDataRole.UserRole + 2
ROLE_NOTE      = Qt.ItemDataRole.UserRole + 3   # folder note (str)
ROLE_STATUS    = Qt.ItemDataRole.UserRole + 4   # item status (str)
ROLE_NODE_ID   = Qt.ItemDataRole.UserRole + 5   # stable id (str)
ROLE_EDITED_HTML = Qt.ItemDataRole.UserRole + 930

CODER_STATE_FILE = "coder_workspace.json"

STATUS_INCLUDE = "include"
STATUS_MAYBE   = "maybe"
STATUS_EXCLUDE = "exclude"
ALL_STATUSES   = {STATUS_INCLUDE, STATUS_MAYBE, STATUS_EXCLUDE}

MIME_PAYLOAD = "application/x-annotarium-payload+json"
