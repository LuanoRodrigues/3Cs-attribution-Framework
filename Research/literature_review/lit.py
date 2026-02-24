from PyQt6.QtCore import Qt, pyqtSlot
from PyQt6.QtWidgets import QFileDialog, QListWidgetItem

from charts import *
from gpt_api import call_models
# from search import search_paragraphs_by_query
from bibliometric_analysis_tool.utils.zotero_class import Zotero

from dotenv import load_dotenv

load_dotenv()  # loads the variables from .env
import os

# """
# docker run -p 6333:6333 -v "C:\Users\luano\OneDrive - University College London\Database_articles:/qdrant/storage" qdrant/qdrant# """
# Accessing environment variables
library_id = os.environ.get("LIBRARY_ID")
api_key = os.environ.get("API_KEY")
library_type = os.environ.get("LIBRARY_TYPE")
token = os.environ.get("TOKEN")
# chat_name= "summary"
chat_name= "summary"

chat_args = {
    "session_token":token,
    # "conversation_id":'208296a2-adb8-4dc0-87f2-b23e23c0fc79',
    "chat_id": chat_name,
    "os":"win"
}

zt=Zotero(
library_id = library_id,
    api_key=api_key,
    library_type =library_type,

    chat_args=chat_args,
    os="win",
    sleep=71*3)



# --- Configuration ---
LR_OUTPUT_DIR_BASE = Path("output_literature_review") # New folder
TEMPLATE_DIR_LR = Path("templates") # Assuming shared template dir now
MAX_ABSTRACT_TOKENS_FOR_CONTEXT = 4000 # Allow more for criteria/screening
MAX_PDF_CHUNK_TOKENS = 3500
MAX_CODED_NOTES_CONTEXT_TOKENS = 20000 # Allow more for theme generation
LLM_RETRY_DELAY = 5
LLM_MAX_RETRIES = 2
CHICAGO_NOTE_MAX_QUOTE_LENGTH = 250 # Max chars for embedded quote in title attr

MAX_SECTION_NOTES_CONTEXT = 6000 # Limit notes passed for writing a section
import hashlib
from pathlib import Path


def generate_pdf_id(pdf_path: str | Path) -> str:
    """Return a short, deterministic ID for *any* local PDF.

    The ID is the first 8 characters of the SHA-1 hash of the *basename*
    (case-insensitive, no extension).  That is good enough to avoid
    collisions inside a single review run and is stable over time as long
    as the filename stays constant.
    """
    p = Path(pdf_path)
    stem_lower = p.stem.lower().encode("utf-8")
    return hashlib.sha1(stem_lower).hexdigest()[:8]
# --- Helper for Progress Reporting ---
def _emit_progress(callback, message, is_step_boundary=False):
    """Safely calls the progress callback if it exists."""
    if callback:
        # Ensure message is a string, escape HTML for safety in display
        safe_message = html.escape(str(message))
        try:
            # The callback itself (worker.progress.emit) handles threading
            callback(safe_message, is_step_boundary)
            # Add a small delay after step boundaries for readability
            if is_step_boundary:
                time.sleep(0.1)
        except Exception as e:
            # Avoid crashing the core logic if the callback fails
            print(f"[Core Logic - Callback Error] Failed to emit progress: {e}")
            print(f"Original message: {message}")
def generate_chicago_citation_elements(item_data):
    """
    Generates full note, short note, and bibliography entry strings
    from full Zotero item data.
    """
    if not item_data:
        return {'full_note': '[Error: Missing Item Data]',
                'short_note': '[Error: Missing Data]',
                'bib_entry': '[Error: Missing Item Data]'}

    data = item_data.get('data', {}) # Access the 'data' sub-dictionary

    # --- Author Formatting (Consistent for all) ---
    creators = data.get('creators', [])
    author_list = []
    author_bib_list = [] # For bibliography order
    if creators:
        for i, creator in enumerate(creators):
            if creator.get('creatorType') == 'author':
                first = creator.get('firstName', '')
                last = creator.get('lastName', '')
                name = f"{first} {last}".strip()
                if name:
                    author_list.append(name)
                    if i == 0:
                        author_bib_list.append(f"{last}, {first}".strip(', '))
                    else:
                        author_bib_list.append(name)

    num_authors = len(author_list)
    if num_authors == 0:
        authors_note = "Anon."
        authors_bib = "Anon."
        author_last_short = "Anon"
    elif num_authors == 1:
        authors_note = author_list[0]
        authors_bib = author_bib_list[0]
        author_last_short = creators[0].get('lastName', 'Anon')
    elif num_authors == 2:
        authors_note = f"{author_list[0]} and {author_list[1]}"
        authors_bib = f"{author_bib_list[0]} and {author_list[1]}"
        author_last_short = creators[0].get('lastName', 'Anon')
    elif num_authors >= 3:
        authors_note = f"{author_list[0]} et al."
        # List all authors in bibliography up to a certain limit (e.g., 10) per Chicago Manual 17th ed. 14.76
        if num_authors <= 10:
             authors_bib = ", ".join(author_bib_list[:-1]) + f", and {author_list[-1]}"
        else:
             authors_bib = ", ".join(author_bib_list[:7]) + ", et al." # List first seven then et al.
        author_last_short = creators[0].get('lastName', 'Anon')
    else: # Fallback for many authors (handled by >=3 above generally)
        authors_note = f"{author_list[0]} et al."
        authors_bib = f"{author_bib_list[0]} et al." # Check CMoS for exact rule if >10
        author_last_short = creators[0].get('lastName', 'Anon')


    # --- Title Formatting ---
    title_raw = data.get('title', '[No Title]')
    item_type = data.get('itemType', 'journalArticle')

    if item_type in ['journalArticle', 'conferencePaper', 'bookSection', 'report', 'thesis', 'webpage', 'encyclopediaArticle', 'dictionaryEntry', 'manuscript', 'patent']:
        title_note = f'"{title_raw}"'
        title_bib = f'"{title_raw}."' # Period inside quotes for bib
        words = title_raw.split(); short_title_words = words[:5]
        short_title_raw = " ".join(short_title_words)
        if len(words) > 5 or len(short_title_raw) > 35: short_title_raw += "..."
        short_title_note = f'"{short_title_raw}"'
    elif item_type in ['book', 'film', 'artwork']:
        title_note = f'<em>{title_raw}</em>'
        title_bib = f'<em>{title_raw}</em>.' # Period after italics for bib
        words = title_raw.split(); short_title_words = words[:5]
        short_title_raw = " ".join(short_title_words)
        if len(words) > 5 or len(short_title_raw) > 35: short_title_raw += "..."
        short_title_note = f'<em>{short_title_raw}</em>'
    else: # Default fallback
        title_note = f'"{title_raw}"' # Assume quote marks
        title_bib = f'"{title_raw}."'
        short_title_note = f'"{title_raw[:35]}..."' if len(title_raw) > 35 else f'"{title_raw}"'

    # --- Publication Info ---
    pub_title_raw = data.get('publicationTitle', '') # Journal, proceedings name
    book_title_raw = data.get('bookTitle', '') # For book sections
    website_title_raw = data.get('websiteTitle', '') # For webpages
    publisher = data.get('publisher', '')
    place = data.get('place', '')
    volume = data.get('volume', '')
    issue = data.get('issue', '')
    pages = data.get('pages', '')
    date_str = data.get('date', 'n.d.')
    year = 'n.d.'
    try: # Extract year robustly
        parsed_date = pd.to_datetime(date_str, errors='coerce')
        if pd.notna(parsed_date):
            year = str(parsed_date.year)
        elif isinstance(date_str, str) and re.match(r'^\d{4}$', date_str.strip()):
            year = date_str.strip()
    except Exception: pass # Keep 'n.d.' if parsing fails


    doi = data.get('DOI', '')
    url = data.get('url', '')
    access_date = data.get('accessDate', '') # Often empty, but good practice for web

    # --- Construct Full Note ---
    full_note = f"{authors_note}, {title_note}"

    # Source Title (Journal, Book for section, etc.)
    source_title_note = ""
    if item_type == 'journalArticle' and pub_title_raw:
        source_title_note = f" <em>{pub_title_raw}</em>"
    elif item_type == 'bookSection' and book_title_raw:
        source_title_note = f" in <em>{book_title_raw}</em>"
        # Add editors if available
        editors = [f"{c.get('firstName', '')} {c.get('lastName', '')}".strip() for c in creators if c.get('creatorType') == 'editor']
        if editors:
            source_title_note += f", ed. { ' and '.join(editors)}"
    elif item_type == 'conferencePaper' and pub_title_raw: # Conference name
        source_title_note = f" presented at the {pub_title_raw}"
    elif item_type == 'report' and publisher: # Often has publisher/institution
         source_title_note = f" ({publisher})" # Simple representation
    elif item_type == 'thesis' and data.get('university'):
         source_title_note = f" ({data.get('type', 'PhD diss.')}, {data.get('university')})" # PhD diss., University
    elif item_type == 'webpage' and website_title_raw:
        source_title_note = f" <em>{website_title_raw}</em>"

    full_note += source_title_note

    # Volume, Issue, Year, Pages (Journal/Article context)
    vol_issue_year_note = ""
    if item_type in ['journalArticle', 'magazineArticle'] and volume:
        vol_issue_year_note += f" {volume}"
        if issue: vol_issue_year_note += f", no. {issue}"
        if year != 'n.d.': vol_issue_year_note += f" ({year})"
    elif item_type in ['book', 'report'] and publisher: # Book/Report Publication Info
        pub_info_note = ""
        if place: pub_info_note += f"{place}: "
        pub_info_note += publisher
        if year != 'n.d.': pub_info_note += f", {year}"
        if pub_info_note: vol_issue_year_note += f" ({pub_info_note})"
    elif year != 'n.d.' and item_type not in ['journalArticle', 'magazineArticle', 'book', 'report']: # Year for others if not already added
        vol_issue_year_note += f" ({year})"

    full_note += vol_issue_year_note

    # Page number placeholder - will be added by process_footnotes
    full_note += ", PAGE_PLACEHOLDER."

    # DOI/URL for Note
    if doi: full_note += f" https://doi.org/{doi}."
    elif url and item_type in ['webpage', 'report', 'blogPost']: # Add URL for web/online sources
        full_note += f" {url}."
        if access_date:
            try: # Format access date nicely
                ad = pd.to_datetime(access_date).strftime('%B %d, %Y')
                full_note += f" (accessed {ad})."
            except: pass


    # --- Construct Short Note ---
    # Short note: Author Last Name, Short Title, Page Placeholder
    short_note = f"{author_last_short}, {short_title_note}, PAGE_PLACEHOLDER."

    # --- Construct Bibliography Entry ---
    bib_entry = f"{authors_bib}. {year if year != 'n.d.' else 'n.d.'}. {title_bib}"

    # Source Title/Publication Details for Bibliography
    if item_type == 'journalArticle' and pub_title_raw:
        bib_entry += f" <em>{pub_title_raw}</em>"
        if volume: bib_entry += f" {volume}"
        if issue: bib_entry += f", no. {issue}"
        if pages: bib_entry += f": {pages.replace('--','–')}" # Use en dash
        bib_entry += "."
    elif item_type == 'bookSection' and book_title_raw:
        bib_entry += f" In <em>{book_title_raw}</em>"
        editors = [f"{c.get('firstName', '')} {c.get('lastName', '')}".strip() for c in creators if c.get('creatorType') == 'editor']
        if editors:
            bib_entry += f", edited by { ' and '.join(editors)}"
        if pages: bib_entry += f", {pages.replace('--','–')}"
        bib_entry += "."
        if place and publisher: bib_entry += f" {place}: {publisher}."
        elif publisher: bib_entry += f" {publisher}."
    elif item_type == 'book' and publisher:
        if place: bib_entry += f" {place}: {publisher}."
        else: bib_entry += f" {publisher}."
    elif item_type == 'report' and publisher:
        # May include report number, etc. - keeping simple
        bib_entry += f" {publisher}."
    elif item_type == 'thesis' and data.get('university'):
        bib_entry += f" {data.get('type', 'PhD diss.')}, {data.get('university')}."
    elif item_type == 'webpage' and website_title_raw:
        bib_entry += f" <em>{website_title_raw}</em>."
        if access_date: # Accessed date for webpages
             try:
                ad = pd.to_datetime(access_date).strftime('%B %d, %Y')
                bib_entry += f" Accessed {ad}."
             except: pass
    elif item_type == 'conferencePaper' and pub_title_raw:
         bib_entry += f" Paper presented at the {pub_title_raw}"
         if place: bib_entry += f", {place}"
         bib_entry += f", {date_str}." # Use full date if available

    # DOI/URL for Bibliography
    if doi:
        bib_entry += f" https://doi.org/{doi}."
    elif url:
        bib_entry += f" {url}."

    return {
        'full_note': full_note,  # Includes PAGE_PLACEHOLDER
        'short_note': short_note,  # Includes PAGE_PLACEHOLDER
        'bib_entry': bib_entry,
        'author_short': author_last_short,  # ADDED: e.g., "Smith", "Smith et al."
        'year': year  # ADDED: e.g., "2020", "n.d."
    }


# Assume generate_chicago_citation_elements is defined elsewhere and accessible
# It must return a dictionary including 'full_note', 'short_note', 'author_short', and 'year' keys.
# e.g., from your_module import generate_chicago_citation_elements

# Constants (adjust as needed)
CHICAGO_NOTE_MAX_QUOTE_LENGTH = 500 # Max chars for embedded quote in title attr

def process_text_and_generate_footnotes(
    written_sections_with_placeholders, # Dict: {section_title: text_with_{{CITE...}}_placeholders}
    all_coded_notes,                    # Dict: {item_key: [list_of_note_dicts]} for quote lookup
    zotero_items_lookup                 # Dict: {item_key: full_zotero_item_dict} for citation generation
    ):
    """
    Replaces {{CITE|KEY=item_key|PAGE=page_num}} placeholders with <sup> tags
    and generates a synchronized list of Chicago-style footnotes using full Zotero metadata.
    Includes Author, Year, Page, and Quote (if found) in hover text.
    """
    print("  Processing CITE placeholders and generating footnotes...")
    footnote_counter = 0
    final_footnote_texts = {} # footnote_id -> display_text (with page number)
    # Tracks source mention for full vs short note logic: item_key -> first_footnote_id
    source_first_mention_tracker = {}
    # Tracks the *immediately preceding* footnote ID and item key for Ibid logic
    last_processed_footnote_id = None
    last_processed_item_key = None

    processed_sections = {}
    placeholder_pattern = re.compile(
        # Adjusted regex to be more robust with potential extra pipes or variations
        r'\{\{\s*CITE\s*\|\s*KEY\s*=\s*([^|}]+?)\s*\|\s*PAGE\s*=\s*([^|}]+?)\s*\}\}',
        re.IGNORECASE
    )

    for section_title, text_with_placeholders in written_sections_with_placeholders.items():
        if not isinstance(text_with_placeholders, str):
             print(f"   WARN: Section content for '{section_title}' is not a string. Skipping placeholder processing.")
             processed_sections[section_title] = text_with_placeholders # Keep original content
             continue

        # Ensure text_with_placeholders is not None before proceeding
        if text_with_placeholders is None:
             print(f"   WARN: Section content for '{section_title}' is None. Skipping.")
             processed_sections[section_title] = "" # Assign empty string or handle as appropriate
             continue


        processed_text = text_with_placeholders
        cursor = 0
        new_text_parts = []

        # --- Process Placeholders ---
        for match in placeholder_pattern.finditer(text_with_placeholders):
            start, end = match.span()
            new_text_parts.append(text_with_placeholders[cursor:start]) # Add text before placeholder

            # Extract item_key and page directly from the placeholder
            item_key = match.group(1).strip()
            page_number_str = match.group(2).strip()
            # Use n.p. (no page) if page number is empty or explicitly 'n.p.' etc.
            page_display = page_number_str if page_number_str and page_number_str.lower() not in ['n.p.', 'na', 'n/a'] else 'n.p.'

            # print(f"  DEBUG: Found placeholder: Key='{item_key}', Page='{page_number_str}' -> Display='{page_display}'") # Debug

            footnote_id_to_use = None
            sup_tag = f"[CITE ERROR: Invalid Key '{item_key}']" # Default error
            original_item_data = None
            citation_elements = None
            author_for_hover = "Anon" # Defaults for hover
            year_for_hover = "n.d."

            # --- Get Full Metadata using item_key ---
            original_item_data = zotero_items_lookup.get(item_key)
            if original_item_data:
                try:
                    # Ensure generate_chicago_citation_elements handles potential errors gracefully
                    citation_elements = generate_chicago_citation_elements(original_item_data)
                    if not citation_elements: # Check if function returned None or empty dict
                         raise ValueError("Citation element generation returned empty.")

                    # Extract author/year for hover text *after* successful generation
                    author_for_hover = citation_elements.get('author_short', 'Error')
                    year_for_hover = citation_elements.get('year', 'Error')

                except NameError:
                     print(f"   *** FATAL ERROR: generate_chicago_citation_elements function not found!")
                     raise # Stop execution if the helper function is missing
                except Exception as e:
                     print(f"   *** ERROR generating citation elements for {item_key}: {e}")
                     citation_elements = None # Mark as failed
                     sup_tag = f"[CITE GEN ERROR: {item_key}]"
            else:
                 print(f"   WARN: Original Zotero data not found for key '{item_key}' from placeholder '{match.group(0)}'.")
                 # Keep the default error tag "[CITE ERROR: Invalid Key...]"


            # --- Determine Footnote Text & Generate Sup Tag ---
            if citation_elements: # Proceed only if citation elements were successfully generated
                 is_first_mention_of_source = item_key not in source_first_mention_tracker
                 footnote_text_template = ""

                 footnote_counter += 1 # Each citation gets a new number
                 footnote_id_to_use = footnote_counter

                 # Choose note format based on mention history
                 if is_first_mention_of_source:
                     footnote_text_template = citation_elements.get('full_note', '[Full Note Error]')
                     source_first_mention_tracker[item_key] = footnote_id_to_use
                 elif last_processed_item_key == item_key:
                      # Use Ibid. if the *immediately preceding* footnote was for the same item_key
                      footnote_text_template = "Ibid., PAGE_PLACEHOLDER."
                 else: # Subsequent mention, but different source than immediately preceding
                      footnote_text_template = citation_elements.get('short_note', '[Short Note Error]')

                 # Replace page placeholder with actual page number from the CITE tag
                 final_text_for_this_footnote = footnote_text_template.replace("PAGE_PLACEHOLDER", page_display)
                 final_footnote_texts[footnote_id_to_use] = final_text_for_this_footnote

                 # Update last processed info for Ibid. logic
                 last_processed_footnote_id = footnote_id_to_use
                 last_processed_item_key = item_key # Track the item key

                 # --- Find quote using item_key and page_number_str ---
                 quote = "" # Default to empty if not found
                 # Ensure all_coded_notes is a dict and item_key exists as a key
                 if isinstance(all_coded_notes, dict) and item_key in all_coded_notes:
                    notes_for_item = all_coded_notes[item_key]
                    # Ensure notes_for_item is a list
                    if isinstance(notes_for_item, list):
                        found_quote = False
                        try:
                            # Use lowercase cleaned page display for comparison
                            target_page_str_clean = page_display.lower()

                            for note in notes_for_item:
                                # Ensure note is a dict and has 'page_number'
                                if isinstance(note, dict) and 'page_number' in note:
                                    note_page_obj = note.get('page_number')
                                    if note_page_obj is None: continue # Skip notes without page numbers

                                    # Convert note page number to string and clean
                                    note_page_str_clean = str(note_page_obj).strip().lower()

                                    # Try direct string match first
                                    if target_page_str_clean == note_page_str_clean:
                                        quote = note.get('direct_quote', '') # Get quote or empty string
                                        if quote: # Only set found_quote if quote is not empty
                                             found_quote = True
                                             break
                                    # Optional: Add logic for simple range matching if needed
                                    # elif '-' in note_page_str_clean and not found_quote:
                                    #    parts = re.split(r'[-–]', note_page_str_clean)
                                    #    if len(parts) == 2 and parts[0] == target_page_str_clean:
                                    #         quote = note.get('direct_quote', '')
                                    #         if quote: found_quote = True; break

                        except Exception as quote_err:
                            print(f"    DEBUG: Error during quote lookup for page '{page_display}' in {item_key}: {quote_err}")
                    else:
                         print(f"   WARN: Notes data for item key '{item_key}' is not a list. Skipping quote lookup.")
                 # else:
                      # print(f"   DEBUG: No coded notes found for item key '{item_key}'. Skipping quote lookup.")

                 # --- Generate the <sup> tag with enhanced title ---
                 hover_parts = []
                 # Add quote *only* if it's not empty
                 if quote:
                      quote_display = quote[:CHICAGO_NOTE_MAX_QUOTE_LENGTH]
                      if len(quote) > CHICAGO_NOTE_MAX_QUOTE_LENGTH: quote_display += "..."
                      hover_parts.append(f'"{quote_display}"') # Add quotes around the extracted quote
                 # else:
                      # hover_parts.append("[Quote not found in coded notes]") # Optional: Indicate if lookup failed

                 # Add citation info (Author, Year, Page)
                 hover_parts.append(f"({author_for_hover}, {year_for_hover}, p.{page_display})")

                 # Join parts for the final hover text
                 final_hover_text = " ".join(hover_parts)

                 escaped_hover_text = html.escape(final_hover_text, quote=True)
                 # Ensure the <sup> tag itself is correct HTML
                 sup_tag = f'<sup title="{escaped_hover_text}" id="fnref-{footnote_id_to_use}"><a href="#fn-{footnote_id_to_use}" style="text-decoration: none; color: inherit;">{footnote_id_to_use}</a></sup>'

            else: # Handle case where citation elements failed or key was missing
                 # Keep the specific error tag assigned earlier ([CITE GEN ERROR...] or [CITE ERROR: Invalid Key...])
                 # print(f"    DEBUG: Using error sup_tag for placeholder: {match.group(0)}")
                 last_processed_item_key = None # Reset last key if error

            # Append the generated sup tag (or error tag)
            new_text_parts.append(sup_tag)
            cursor = end # Move cursor past the matched placeholder

        # Add remaining text after the last match
        new_text_parts.append(text_with_placeholders[cursor:])
        processed_sections[section_title] = "".join(new_text_parts)

    print(f"  Processed placeholders and generated text for {len(final_footnote_texts)} footnote instances.")
    # Return the sections with <sup> tags and the dictionary of {footnote_id: footnote_text}
    return processed_sections, final_footnote_texts


PDF_PROCESSING_MAX_PAGES = 80 # Limit pages to process per PDF (first 80 pages)

def extract_pdf_text_with_pages(pdf_path):
    """
    Extracts text page by page, up to PDF_PROCESSING_MAX_PAGES,
    returning a dictionary {page_num: text}.
    """
    pages = {}
    pdf_path = Path(pdf_path)
    if not pdf_path.is_file():
        print(f"  WARN: PDF not found at path: {pdf_path}")
        return None # Return None if file doesn't exist

    try:
        with fitz.open(pdf_path) as doc:
            # Check encryption first
            if doc.is_encrypted and not doc.authenticate(""):
                print(f"  WARN: PDF is encrypted and cannot be authenticated: {pdf_path.name}")
                return None # Cannot process encrypted files without password

            num_pages = len(doc)
            # Determine the actual number of pages to process based on the limit
            pages_to_process = min(num_pages, PDF_PROCESSING_MAX_PAGES)

            print(f"    - Processing first {pages_to_process}/{num_pages} pages of {pdf_path.name}...")

            # Loop only up to the calculated limit
            for i in range(pages_to_process):
                page = doc.load_page(i) # 0-based index for loading
                text = page.get_text("text", sort=True)
                if text and text.strip(): # Only add pages with actual text content
                    pages[i + 1] = text.strip() # Use 1-based page numbering for the dictionary key

            # Add a message if pages were truncated
            if num_pages > PDF_PROCESSING_MAX_PAGES:
                print(f"      - Stopped text extraction after {PDF_PROCESSING_MAX_PAGES} pages.")

        # Return the dictionary containing text for the processed pages
        # Return None if no pages had extractable text within the limit
        return pages if pages else None

    except Exception as e:
        print(f"*** ERROR extracting paged text from {pdf_path.name}: {e}")
        return None # Return None on error
#

def load_cache(cache_path):
    """Loads data from a pickle/json cache file."""
    if not cache_path.is_file(): return None
    try:
        if cache_path.suffix == '.json':
             with open(cache_path, 'r', encoding='utf-8') as f: return json.load(f)
        elif cache_path.suffix == '.pkl':
             with open(cache_path, 'rb') as f: return pickle.load(f)
        elif cache_path.suffix == '.txt': # For simple string cache like review type
             with open(cache_path, 'r', encoding='utf-8') as f: return f.read().strip()
        else:
             print(f" WARN: Unknown cache file type: {cache_path.suffix}")
             return None
    except Exception as e:
        print(f"  WARN: Failed to load cache file {cache_path.name}: {e}")
    return None

def save_cache(data, cache_path):
    """Saves data to a pickle/json cache file."""
    try:
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        if cache_path.suffix == '.json':
             with open(cache_path, 'w', encoding='utf-8') as f: json.dump(data, f, indent=2)
        elif cache_path.suffix == '.pkl':
             with open(cache_path, 'wb') as f: pickle.dump(data, f)
        elif cache_path.suffix == '.txt': # For simple string
             with open(cache_path, 'w', encoding='utf-8') as f: f.write(str(data))
        else:
             print(f" ERROR: Cannot save unknown cache file type: {cache_path.suffix}")
             return
        # print(f"    - Saved cache to: {cache_path.name}") # Make less verbose maybe
    except Exception as e:
        print(f"  *** ERROR: Failed to save cache to {cache_path.name}: {e}")

def extract_pdf_text(pdf_path):
    """Extracts text from a PDF file using PyMuPDF."""
    text = ""
    pdf_path = Path(pdf_path)
    if not pdf_path.is_file(): return None
    try:
        with fitz.open(pdf_path) as doc:
            if doc.is_encrypted and not doc.authenticate(""): return None
            for page in doc: text += page.get_text("text", sort=True) + "\n"
        return text.strip()
    except Exception as e: print(f"ERROR extracting text from {pdf_path.name}: {e}"); return None


# Assume necessary helper functions are imported or defined globally:
# from .utils import load_cache, save_cache, parse_json_list_from_llm
# from .llm_interface import call_models, get_ai_response_text
# from .pdf_utils import extract_pdf_text_with_pages

# Define constants if not already global
MAX_PDF_CHUNK_TOKENS = 3500 # Adjust based on model/needs
LLM_RETRY_DELAY = 5
LLM_MAX_RETRIES = 2


# Assume necessary helper functions are imported or defined globally
# (load_cache, save_cache, parse_json..., call_models, get_ai_response_text, extract_pdf_text_with_pages)
# Ensure constants like LLM_RETRY_DELAY, LLM_MAX_RETRIES are defined
# Assume necessary helper functions are imported or defined globally
# (load_cache, save_cache, parse_json..., call_models, get_ai_response_text, extract_pdf_text_with_pages)
# Ensure constants like LLM_RETRY_DELAY, LLM_MAX_RETRIES are defined

def cluster_arguments_within_section(
    section_title, notes_for_section, research_question,
    output_dir, ai_provider, ai_models,
    max_notes_for_clustering=150 # Limit notes passed to clustering prompt for efficiency
    ):
    """
    Analyzes notes within a section to identify sub-arguments/claims
    and clusters the notes accordingly. Returns a dict: {argument_summary: [list_of_note_ids]}.
    """
    print(f"    - Identifying arguments within section: '{section_title}'...")
    if not notes_for_section:
        print("      - No notes to cluster arguments for.")
        return {}

    # --- Prepare context for argument clustering ---
    notes_context_list = []
    note_lookup = {note['note_id']: note for note in notes_for_section} # Quick lookup by ID
    note_ids_in_context = []
    current_tokens = 0
    # Limit context based on token count or number of notes
    context_limit_tokens = 10000 # Example limit for this task

    # Prioritize notes with clearer paraphrases/comments for context
    notes_to_consider = sorted(notes_for_section, key=lambda x: len(x.get('paraphrase', '')), reverse=True)

    for note in notes_to_consider[:max_notes_for_clustering]: # Limit number of notes analyzed
        # Focus on paraphrase and comment for clustering
        context_line = (
            f"Note ID: {note.get('note_id')}\n"
            f"Paraphrase: {note.get('paraphrase', '[N/A]')}\n"
            f"Comment: {note.get('researcher_comment', '[N/A]')}\n"
            # f"Keywords: {', '.join(note.get('suggested_keywords', []))}\n" # Optional keywords
            f"---\n"
        )
        note_tokens = len(context_line.split())

        if current_tokens + note_tokens <= context_limit_tokens:
            notes_context_list.append(context_line)
            note_ids_in_context.append(note.get('note_id'))
            current_tokens += note_tokens
        else:
            print(f"      - Argument clustering context limit reached for '{section_title}'. Analyzing {len(notes_context_list)} notes.")
            break

    notes_context_str = "".join(notes_context_list)
    if not notes_context_str:
         print(f"      - Could not prepare context for argument clustering in '{section_title}'.")
         return {}

    # --- Prompt for Argument Clustering ---
    context = f"""
Research Question: {research_question}
Main Section Theme: "{section_title}"

Notes Assigned to this Section (ID, Paraphrase, Comment):
--- BEGIN NOTES DATA ---
{notes_context_str}
--- END NOTES DATA ---

Task: Analyze the provided notes (specifically the paraphrases and comments) related to the main section theme "{section_title}". Identify the distinct sub-arguments, specific claims, findings, or viewpoints discussed within these notes. Group the Note IDs provided under the most relevant sub-argument they support, refute, or exemplify.

Output *only* a JSON object where:
- Keys are concise strings summarizing each distinct sub-argument/claim found (e.g., "Difficulty of tracing via proxies", "Debate on 'effective control' standard", "Role of technical indicators").
- Values are lists of Note IDs (strings) that correspond to that specific sub-argument/claim.
- Aim for 3-8 sub-argument keys based on the provided notes. Ensure every Note ID included in the input context is assigned to exactly one sub-argument key.

Example JSON Output:
{{
  "Technical barriers hinder tracing attackers": ["ITEMKEY_p5_n1", "ITEMKEY_p12_n3"],
  "Use of non-state proxies complicates state responsibility": ["ITEMKEY_p8_n2", "ITEMKEY_p8_n5", "ITEMKEY_p15_n1"],
  "Debate on legal standards ('effective' vs 'overall' control)": ["ITEMKEY_p20_n4", "ITEMKEY_p21_n1"]
}}

Argument Clusters (JSON Object):
"""
    # --- LLM Call and Parsing ---
    clustered_arguments = {}
    try:
        # Use a new prompt key
        prompt_key = "cluster_section_arguments" # Add this key to your prompts JSON
        llm_response = call_models(ai_provider, ai_models, context, prompt_key, base_output_dir=output_dir)
        response_text = get_ai_response_text(llm_response, f"Cluster Arguments: {section_title}")
        # Use a function that parses a JSON *object*
        parsed_data = parse_json_object_from_llm(response_text, f"Argument Clusters: {section_title}")

        if isinstance(parsed_data, dict):
            # Basic validation: ensure values are lists of strings (note IDs)
            is_valid = True
            all_clustered_ids = set()
            for arg, note_ids in parsed_data.items():
                if not isinstance(arg, str) or not arg.strip(): is_valid = False; break
                if not isinstance(note_ids, list): is_valid = False; break
                for note_id in note_ids:
                    if not isinstance(note_id, str): is_valid = False; break
                    all_clustered_ids.add(note_id)
                if not is_valid: break

            # Optional check: ensure all input note IDs were clustered
            # input_ids_set = set(note_ids_in_context)
            # if not input_ids_set.issubset(all_clustered_ids):
            #     print(f"      WARN: Not all input note IDs were clustered for '{section_title}'. Missing: {input_ids_set - all_clustered_ids}")

            if is_valid:
                clustered_arguments = parsed_data
                print(f"      - Successfully identified {len(clustered_arguments)} argument clusters.")
            else:
                 print(f"      - WARN: Invalid format received for argument clusters.")
        else:
             print(f"      - WARN: Failed to parse argument clusters as JSON object.")

    except Exception as e:
        print(f"    *** ERROR during argument clustering for '{section_title}': {e}")

    # Map note IDs back to full note dictionaries
    final_clusters = {}
    for argument, note_ids in clustered_arguments.items():
        final_clusters[argument] = [note_lookup[note_id] for note_id in note_ids if note_id in note_lookup]
        # Filter out empty clusters that might result from lookup errors
        if not final_clusters[argument]:
             del final_clusters[argument]

    return final_clusters # Return dict {argument_summary: [list_of_FULL_note_dicts]}
def generate_limitations_section(research_question, topic, output_dir, ai_provider, ai_models, **kwargs):
    """Generates the Limitations section using AI."""
    print("  Generating Limitations section (AI)...")

    # Basic context - pass relevant info via kwargs
    methodology_summary = (
        "AI-assisted process including criteria generation, title/abstract screening, "
        f"full-text coding of included studies ({kwargs.get('num_items_included', 'N/A')} items), "
        "thematic synthesis, and narrative generation. Zotero used for bibliography management. "
        f"Screened {kwargs.get('num_items_screened', 'N/A')} items initially."
    )
    context = f"""
Systematic Review Topic: {topic}
Research Question: {research_question}
Methodology Summary: {methodology_summary}

Task: Write the 'Limitations' section for this literature review.
1. Acknowledge general limitations inherent in literature reviews (e.g., scope, potential for missed studies).
2. Discuss potential limitations specific to the AI-assisted methodology used (e.g., potential biases in AI screening/coding, reliability of AI interpretation for synthesis, quality of text extraction from PDFs, lack of formal human-led Risk of Bias assessment on primary studies).
3. Discuss potential limitations related to the search strategy (e.g., reliance on initial Zotero collection scope, potential for publication bias, language limitations if primarily English).
4. Discuss limitations related to the nature of the included studies if apparent from the process (e.g., heterogeneity, methodological quality - mention if not formally assessed).
5. Keep the tone objective and academic. Focus on potential weaknesses of *this review's process and findings*. Avoid overly speculative statements.

Limitations Section Content:
"""
    limitations_text = "[Error generating Limitations section]" # Default
    try:
        prompt_key = "lr_limitations_generation" # Ensure this key exists in your prompts JSON
        # Ensure call_models and get_ai_response_text are accessible
        llm_response = call_models(ai_provider, ai_models, context, prompt_key, base_output_dir=output_dir)
        raw_text = get_ai_response_text(llm_response, "LR Limitations")

        # Clean the output using the globally defined function
        cleaned_text = clean_llm_output(raw_text)

        if cleaned_text:
            limitations_text = cleaned_text
            print("  Limitations section generated.")
        else:
            limitations_text = "[Limitations section could not be generated or was empty after cleaning.]"
            print("  WARN: Limitations section was empty after generation/cleaning.")

    except NameError as ne:
         # Catch if helper functions like call_models are not defined
         print(f"*** FATAL ERROR in generate_limitations_section: Required function not found - {ne}")
         raise # Stop execution
    except Exception as e:
        print(f"*** ERROR generating limitations section: {e}")
        # Keep default error message

    return limitations_text
# Constants (adjust as needed)
CHICAGO_NOTE_MAX_QUOTE_LENGTH = 500# Max chars for embedded quote in title attr

def summarize_notes_for_section(section_title, notes_for_section_data, research_question, output_dir, ai_provider, ai_models):
    """Uses LLM to summarize a list of note data for a specific section."""
    print(f"    - Pre-summarizing notes for section: '{section_title}'...")
    if not notes_for_section_data:
        return "No notes provided for summarization."

    # Prepare context from note data (similar to write_narrative_section context prep)
    notes_context_list = []
    current_tokens = 0
    # Use a reasonable limit for summarization context, maybe less than writing
    summarization_limit = MAX_SECTION_NOTES_CONTEXT - 1000 # Example limit

    for note_data in notes_for_section_data:
        context_line = (
            f"Note (Author: {note_data.get('author_last', 'N/A')}, Year: {note_data.get('year', 'N/A')}, "
            f"Page: {note_data.get('page', 'N/A')}, Theme: {note_data.get('theme', 'N/A')}):\n"
            f"Info: {note_data.get('info', '')}\n"
            f"Quote: {note_data.get('quote', '')[:100]}...\n---\n"
        )
        note_tokens = len(context_line.split())
        if current_tokens + note_tokens <= summarization_limit:
            notes_context_list.append(context_line)
            current_tokens += note_tokens
        else:
            break # Stop adding notes if limit reached for summarization context

    notes_context_str = "".join(notes_context_list)
    notes_context_str = f"Notes ({len(notes_context_list)}/{len(notes_for_section_data)} included):\n{notes_context_str}"

    context = f"""
Research Question: {research_question}
Section Title/Theme: "{section_title}"

Provided Notes Relevant to this Section:
--- BEGIN NOTES ---
{notes_context_str}
--- END NOTES ---

Task: Read the provided notes carefully. Synthesize the key findings, arguments, concepts, and evidence presented in these notes that relate *specifically* to the section theme: "{section_title}". Identify the main points and any recurring patterns or contradictions. Write a concise summary (2-4 paragraphs) that captures the essence of the information contained in the notes for this section. Focus on clarity and coherence. Do not add external information.

Summary of Notes for Section "{section_title}":
"""
    summary = f"[Summary generation failed for '{section_title}']"
    try:
        # Use a new prompt key for summarization
        prompt_key = "lr_summarize_section_notes" # Add this key to your prompts JSON
        llm_response = call_models(ai_provider, ai_models, context, prompt_key, base_output_dir=output_dir)
        raw_summary = get_ai_response_text(llm_response, f"Summarize Notes: {section_title}")
        cleaned_summary = clean_llm_output(raw_summary) # Clean the summary
        if cleaned_summary:
            summary = cleaned_summary
            print(f"      - Notes summarized successfully.")
        else:
             print(f"      - WARN: Note summary was empty after generation/cleaning.")
             summary = "[Note summary generation resulted in empty output.]"

    except Exception as e:
        print(f"    *** ERROR during note summarization for '{section_title}': {e}")

    return summary


def code_included_pdfs_chicago(
    included_keys, all_items_dict, zotero_items_lookup,
    research_questions_list,
    output_dir, zt_client, ai_provider, ai_models, cache=True, force_regenerate=False,
        progress_callback=None
    ):
    """
    Coordinates the PDF coding process for multiple RQs.
    Provides accurate progress indication for every item, noting cache status.
    Calls the inner function which handles incremental saving & user input for old caches.
    """
    print(f"\nStep 4: Coding Full Text for {len(included_keys)} Included Items against {len(research_questions_list)} RQs...")
    _emit_progress(progress_callback, f"Objective: Code full text for {len(included_keys)} included items against {len(research_questions_list)} RQs.", False)

    all_coded_notes = {} # parent_key -> list of note dicts (or None for failure)
    coded_count = 0 # Counts items that actually yielded notes
    found_attachment_keys = 0 # Counts items where a PDF link was found

    if not included_keys: print("  No items included..."); return {}
    if zt_client is None: print("  ERROR: zt_client missing."); return {}
    if not zotero_items_lookup: print("  ERROR: zotero_items_lookup missing."); return {}
    if not isinstance(research_questions_list, list) or not research_questions_list:
         print("ERROR: research_questions_list must be a non-empty list."); return {}

    # Ensure the cache directory exists
    notes_cache_dir = output_dir / "coded_notes_cache"
    notes_cache_dir.mkdir(parents=True, exist_ok=True)
    _emit_progress(progress_callback, f"Executing: Iterating through {len(included_keys)} items...", False)

    # --- Loop through included items using enumerate to get index ---
    for i, parent_item_key in enumerate(included_keys):
        _emit_progress(progress_callback, f"Executing: Iterating through {len(included_keys)} items...", False)

        # --- ALWAYS Print Progress Indicator ---
        print(f"\nHandling item {i + 1}/{len(included_keys)}: {parent_item_key}")

        notes_cache_file = notes_cache_dir / f"{parent_item_key}.json"
        skip_processing_due_to_cached_failure_or_user = False # Renamed flag

        # --- Handle Force Regenerate ---
        if force_regenerate and notes_cache_file.is_file():
            print(f"  - Force regenerate: Deleting notes cache for {parent_item_key}")
            try: notes_cache_file.unlink(missing_ok=True)
            except OSError as e: print(f"    WARN: Could not delete cache file: {e}")

        # --- Minimal Cache Check Here - Primarily for Definite Failure ---
        # The inner function now handles checking/loading resumable state & old formats
        if cache and not force_regenerate and notes_cache_file.is_file():
            # Peek at cache only to see if it's a definitive None (failure)
            cached_content_peek = load_cache(notes_cache_file)
            if cached_content_peek is None: # Explicit None means previous failure
                print(f"  - Cached state indicates previous failure. Skipping processing.")
                all_coded_notes[parent_item_key] = None
                skip_processing_due_to_cached_failure_or_user = True

        # --- Process Item if not skipping ---
        if not skip_processing_due_to_cached_failure_or_user:
            # --- Get Metadata ---
            original_item_data = zotero_items_lookup.get(parent_item_key)
            item_metadata = all_items_dict.get(parent_item_key)
            if not original_item_data or not item_metadata:
                print(f"    WARN: Data not found for key {parent_item_key}. Skipping.")
                all_coded_notes[parent_item_key] = None
                continue # Skip to next item in outer loop

            # --- Attachment Key Logic ---
            attachment_key = None
            try:
                links_dict = original_item_data.get('links', {})
                attachment_info = links_dict.get('attachment', {})
                attachment_href = attachment_info.get('href')
                attachment_type = attachment_info.get('attachmentType')
                if attachment_href and attachment_type == 'application/pdf':
                     attachment_key = attachment_href.split('/')[-1]
                     if attachment_key: found_attachment_keys += 1
            except Exception as e: print(f"    ERROR extracting attachment key: {e}")

            if not attachment_key:
                print(f"    - No usable PDF attachment key found. Cannot code.")
                all_coded_notes[parent_item_key] = None
                continue

            # --- PDF Path Logic ---
            pdf_path_str = zt_client.get_pdf_path(attachment_key)
            if not pdf_path_str:
                print(f"    - No PDF path found for attachment key {attachment_key}. Cannot code.")
                all_coded_notes[parent_item_key] = None
                continue
            pdf_path = Path(pdf_path_str)

            # --- Call the Incremental Coding Function ---
            # This function now handles cache loading, resuming, AND user input for old caches
            coded_notes_result = code_pdf_content_chicago(
                pdf_path=pdf_path,
                parent_item_key=parent_item_key,
                item_metadata=item_metadata,
                research_questions_list=research_questions_list,
                output_dir=output_dir, # Pass main output dir
                ai_provider=ai_provider,
                ai_models=ai_models,
                cache=cache, # Pass cache flag down
                attachment_key=attachment_key
            )

            # Store the result (which could be None if user skipped or it failed)
            all_coded_notes[parent_item_key] = coded_notes_result

    # --- End of item loop ---

    # Final count based on the collected data after the loop
    final_coded_count = sum(1 for notes in all_coded_notes.values() if isinstance(notes, list) and notes)

    print(f"\n  Multi-RQ PDF Coding step complete.")
    print(f"  Attempted handling for {len(included_keys)} included parent items.")
    # print(f"  Found {found_attachment_keys} PDF attachment links.")
    print(f"  Resulted in notes for {final_coded_count} items (including cached/resumed/completed).")
    _emit_progress(progress_callback, f"Output: Multi-RQ PDF Coding step complete. Resulted in notes for {final_coded_count} items.", True)

    return all_coded_notes
#===========================================================#

def code_pdf_content_chicago(
    pdf_path, parent_item_key, item_metadata,
    research_questions_list,
    output_dir, ai_provider, ai_models, cache=True,
        progress_callback=None,
    attachment_key=None
    ):
    """
    Codes PDF page by page for enhanced notes relevant to ANY provided RQs.
    Saves progress incrementally. Asks user for guidance if old cache format found.
    """
    cache_key = parent_item_key
    coded_notes_cache_dir = output_dir / "coded_notes_cache"
    coded_notes_cache_dir.mkdir(parents=True, exist_ok=True)
    cache_file = coded_notes_cache_dir / f"{cache_key}.json"
    _emit_progress(progress_callback, f"  Objective: Code PDF '{pdf_path.name}' ({parent_item_key}) against {len(research_questions_list)} RQs.", False)
    input("aaaaa")
    # --- Initialize State ---
    start_page = 1
    all_coded_notes = [] # Initialize empty list

    # --- Load State from Cache ---
    if cache and cache_file.exists():
        print(f"    - Cache file found: {cache_file.name}. Attempting to load...")
        cached_data = load_cache(cache_file)

        # 1. Check for definitive failure first
        if cached_data is None:
            print(f"    - Cached state indicates previous failure. Skipping processing for {parent_item_key}.")
            return None # Return None, outer loop handles this

        # 2. Check for NEW dictionary format (resumable state)
        elif isinstance(cached_data, dict) and 'last_processed_page' in cached_data and 'notes' in cached_data:
            try:
                last_page = int(cached_data['last_processed_page'])
                loaded_notes = cached_data['notes']
                if isinstance(loaded_notes, list):
                    # *** VALID RESUME STATE FOUND ***
                    start_page = last_page + 1
                    all_coded_notes = loaded_notes # Initialize with loaded notes
                    print(f"    - Valid resumable state found. Will start/check coding at page {start_page}. Loaded {len(all_coded_notes)} previous notes.")
                else:
                     print(f"    WARN: Invalid 'notes' format in cache dict for {parent_item_key}. Will re-process from page 1.")
                     all_coded_notes = []
                     start_page = 1
            except (ValueError, TypeError) as e:
                print(f"    WARN: Invalid 'last_processed_page' format in cache dict for {parent_item_key}: {e}. Will re-process from page 1.")
                all_coded_notes = []
                start_page = 1

        # 3. Check for OLD list format -> Ask User!
        elif isinstance(cached_data, list):
            print(f"    WARN: Found old list cache format for {parent_item_key}. Contains {len(cached_data)} notes.")
            print(f"          Cannot automatically determine the last processed page.")
            all_coded_notes = cached_data # Keep notes temporarily

            while True: # Input loop
                print("\n    Please choose an action for this item:")
                print("      [s] SKIP this item entirely (treat old cache as invalid/incomplete).")
                print("      [c] Consider old cache COMPLETE (use existing notes, skip further processing).")
                print("      [r] REPROCESS this item from page 1 (keeps old notes but may create duplicates if interrupted again).")
                print("      [p] Provide the page number to START processing FROM (keeps old notes, risks duplicates).")
                # choice = input("    Enter your choice (s/c/r/p): ").lower().strip()
                choice="c"
                if choice == 's':
                    print(f"    - User chose to SKIP item {parent_item_key}.")
                    return None # Signal skip to outer loop
                elif choice == 'c':
                    print(f"    - User chose to consider cache COMPLETE for {parent_item_key}. Using existing {len(all_coded_notes)} notes.")
                    # Return the loaded list. Outer loop will store it.
                    # Note: This item's cache file remains in the old format.
                    return all_coded_notes
                elif choice == 'r':
                    print(f"    - User chose to REPROCESS {parent_item_key} from page 1.")
                    # Keep loaded notes (all_coded_notes), but force start from page 1
                    start_page = 1
                    break # Exit input loop, proceed to process from page 1
                elif choice == 'p':
                    while True:
                        page_input = input(f"    Enter the page number to START processing FROM (e.g., '5'): ").strip()
                        try:
                            user_start_page = int(page_input)
                            if user_start_page >= 1:
                                print(f"    - User specified starting from page {user_start_page}.")
                                # Keep loaded notes (all_coded_notes)
                                start_page = user_start_page
                                print(f"    WARN: Keeping {len(all_coded_notes)} notes from old cache. Reprocessing from page {start_page} may lead to duplicates if interrupted again.")
                                break # Exit inner page number loop
                            else:
                                print("      Invalid input: Page number must be 1 or greater.")
                        except ValueError:
                            print("      Invalid input: Please enter a whole number.")
                    break # Exit outer choice loop
                else:
                    print("      Invalid choice. Please enter 's', 'c', 'r', or 'p'.")
            # If loop broken by 'r' or 'p', proceed with processing using determined start_page

        # 4. Handle other invalid formats
        else:
            print(f"    WARN: Invalid cache format ({type(cached_data)}) for {parent_item_key}. Will re-process from page 1.")
            all_coded_notes = [] # Reset notes
            start_page = 1
    else:
         print(f"    - No cache file found for {parent_item_key}. Will process from page 1.")
         start_page = 1
         all_coded_notes = []

    # --- Extract Paged Text (Only once) ---
    # Needs to happen *after* determining start_page, but *before* checking completion
    print(f"    - Extracting paged text from PDF: {pdf_path.name}...")
    paged_text_dict = extract_pdf_text_with_pages(pdf_path) # Assumes returns {page_num: text} or None
    if not paged_text_dict:
        _emit_progress(progress_callback, f"    Output: Failed paged text extraction. Skipping coding.", True) # Step boundary on failure for this item

        print(f"    - Failed paged text extraction. Skipping coding.")
        save_cache(None, cache_file) # Cache the failure definitively
        return None

    # --- Prepare constant info and check if already complete ---
    max_page_num_in_dict = max(paged_text_dict.keys()) if paged_text_dict else 0
    # *** Check if processing is already complete based on cache/user input ***
    if start_page > max_page_num_in_dict:
         print(f"    - All pages ({max_page_num_in_dict}) already processed or start page ({start_page}) is beyond available pages. Using existing notes.")
         # If we got here after user input 'p' with a high number, ensure we save final state
         # If we got here from loaded state dict cache, the state is already correct.
         # Let's save just in case it was from user input 'p'.
         final_state_to_save = {
             "last_processed_page": max_page_num_in_dict, # Mark as fully processed
             "notes": all_coded_notes
         }
         save_cache(final_state_to_save, cache_file)
         return all_coded_notes

    # --- Log the CORRECT starting point ---
    print(f"    - Coding PDF {pdf_path.name} (from page {start_page} up to {max_page_num_in_dict})...")
    # Setup other constants needed for loop
    author_short = item_metadata.get('author_short', item_metadata.get('authors_html', 'Anon').split(',')[0])
    year_str = str(item_metadata.get('year', 'n.d.'))
    author_year_info = f"{author_short}, {year_str}"
    research_questions_formatted = "\n".join([f"{i}: {rq}" for i, rq in enumerate(research_questions_list)])

    _emit_progress(progress_callback, f"    Executing: Processing pages {start_page} to {max_page_num_in_dict}...", False)

    # --- Page Processing Loop (Starts from correct page determined above) ---
    for page_num in range(start_page, max_page_num_in_dict + 1):
        page_text = paged_text_dict.get(page_num)
        _emit_progress(progress_callback, f"      - Processing page {page_num}/{max_page_num_in_dict}...", False)

        if not page_text:
            print(f"      - Skipping page {page_num} (No text extracted).")
            # Consider saving state here? Maybe not, wait for successful page.
            continue

        print(f"      - Processing page {page_num}/{max_page_num_in_dict}...")
        notes_for_this_page = [] # Temp list for current page's notes

        # --- Chunking ---
        page_chunks = []
        # ...(Same efficient chunking logic)...
        paragraphs=[p for p in page_text.split('\n\n') if p.strip()];current_chunk_text="";current_chunk_tokens=0
        for para in paragraphs:
            para_tokens=len(para.split());
            if not para_tokens: continue
            if current_chunk_text and current_chunk_tokens+para_tokens > MAX_PDF_CHUNK_TOKENS: page_chunks.append(current_chunk_text.strip()); current_chunk_text=""; current_chunk_tokens=0
            if para_tokens > MAX_PDF_CHUNK_TOKENS:
                if current_chunk_text.strip(): page_chunks.append(current_chunk_text.strip()); current_chunk_text=""; current_chunk_tokens=0
                print(f"        WARN: Para on page {page_num} exceeds chunk size. Splitting."); words=para.split()
                for i in range(0, len(words), MAX_PDF_CHUNK_TOKENS): page_chunks.append(" ".join(words[i:i+MAX_PDF_CHUNK_TOKENS]))
            else: current_chunk_text+=para+"\n\n"; current_chunk_tokens+=para_tokens
        if current_chunk_text.strip(): page_chunks.append(current_chunk_text.strip())
        if not page_chunks: print(f"      - No text chunks for page {page_num}."); continue


        # --- Process Chunks for the Current Page ---
        page_processing_successful = True
        for chunk_index, chunk in enumerate(page_chunks):
            print(f"        - Coding page {page_num}, chunk {chunk_index+1}/{len(page_chunks)}...")
            context_for_llm = {
                "research_questions_formatted": research_questions_formatted,
                "parent_item_key": parent_item_key, "author_year_info": author_year_info,
                "page_number": page_num, "context": chunk
            }
            # ...(LLM call and retry logic remains the same)...
            retries=0; success=False; coded_chunk_data=None
            while retries <= LLM_MAX_RETRIES and not success:
                try:
                     prompt_key="code_pdf_page_chicago"
                     llm_response=call_models(ai_provider, ai_models, context_for_llm, prompt_key, base_output_dir=output_dir)
                     response_text=get_ai_response_text(llm_response, f"Multi-RQ PDF Coding Pg {page_num}, Chk {chunk_index+1} for {parent_item_key}")
                     coded_chunk_data=parse_json_list_from_llm(response_text, f"Multi-RQ PDF Coding Pg {page_num}, Chk {chunk_index+1}")
                     if isinstance(coded_chunk_data, list): success=True
                     else: raise ValueError("LLM response parsing failed to return a list.")
                except Exception as e:
                     retries+=1; print(f"        *** ERROR ... (Attempt {retries}/{LLM_MAX_RETRIES + 1}): {e}")
                     if retries <= LLM_MAX_RETRIES: time.sleep(LLM_RETRY_DELAY)
                     else: print(f"          - Max retries reached. Skipping chunk and page save."); coded_chunk_data=None; page_processing_successful=False; break

            if not page_processing_successful: break # Stop processing chunks for this page if one failed

            if coded_chunk_data:
                # Process and validate notes, append to notes_for_this_page
                # ...(validation logic remains the same, append to notes_for_this_page)...
                for item_index, item in enumerate(coded_chunk_data):
                     required_keys=["location_context", "direct_quote", "paraphrase", "researcher_comment", "suggested_keywords", "page_number", "relevant_rq_indices"]
                     if isinstance(item, dict) and all(k in item for k in required_keys):
                          # Ensure unique note IDs even with potential reprocessing
                          # Find max existing note number for this page in all_coded_notes + notes_for_this_page
                          current_max_n = 0
                          prefix = f"{parent_item_key}_p{page_num}_n"
                          for existing_note in all_coded_notes + notes_for_this_page:
                              if existing_note.get('note_id','').startswith(prefix):
                                   try: current_max_n = max(current_max_n, int(existing_note['note_id'][len(prefix):]))
                                   except: pass # Ignore if parsing fails
                          note_id = f"{prefix}{current_max_n + 1}"

                          item['note_id']=note_id; item['item_key']=parent_item_key
                          rq_indices=item.get('relevant_rq_indices');
                          if isinstance(rq_indices, list) and all(isinstance(idx, int) for idx in rq_indices):
                               item['relevant_rq_indices']=[idx for idx in rq_indices if 0 <= idx < len(research_questions_list)]
                               if not item['relevant_rq_indices']: continue
                          else: continue
                          try: item['page_number']=int(item.get('page_number', page_num)) if item.get('page_number') else page_num
                          except: item['page_number']=page_num
                          if item['page_number'] != page_num: item['page_number']=page_num
                          keywords=item.get('suggested_keywords');
                          if isinstance(keywords, list): item['suggested_keywords']=[str(k).strip() for k in keywords if str(k).strip()]
                          elif isinstance(keywords, str): item['suggested_keywords']=[k.strip() for k in keywords.split(',') if k.strip()]
                          else: item['suggested_keywords']=[]
                          notes_for_this_page.append(item)


            if len(page_chunks) > 1: time.sleep(0.2)

        # --- After Processing All Chunks for the Page ---
        if page_processing_successful:
            _emit_progress(progress_callback, f"      - Page {page_num} processed. Saved progress ({len(all_coded_notes)} total notes).", False)

            all_coded_notes.extend(notes_for_this_page)
            cache_data_to_save = {
                "last_processed_page": page_num,
                "notes": all_coded_notes # Save the cumulative list
            }
            save_cache(cache_data_to_save, cache_file)

            print(f"      - Successfully processed page {page_num}. Saved progress ({len(all_coded_notes)} total notes).")
            time.sleep(0.5) # Configurable delay between saving pages might be useful
        else:
            _emit_progress(progress_callback, f"      - Page {page_num} FAILED. Stopping processing for this item.",
                           False)
            # Return notes accumulated up to the previous successful page save
            _emit_progress(progress_callback,
                           f"    Output: Coding FAILED on page {page_num}. Returning {len(all_coded_notes)} notes.",
                           True)  # Step boundary on failure
            # Return notes accumulated up to the previous successful page save
            return all_coded_notes if all_coded_notes else None

    # --- After Processing All Pages Successfully ---
    print(f"    - Finished coding for {parent_item_key}. Total notes generated/loaded: {len(all_coded_notes)}.")
    # Final state is already saved in the cache file after the last page.
    _emit_progress(progress_callback, f"    Output: Finished coding PDF. Total notes: {len(all_coded_notes)}.", True) # Step boundary on success

    return all_coded_notes # Return the complete list
def format_chicago_note(note_data, item_metadata):
    """Formats a single note into Chicago Note style string (more robust)."""
    authors_raw = item_metadata.get('authors_html', 'Anon')
    author_list = [a.strip() for a in authors_raw.split(';') if a.strip()]
    if len(author_list) == 1: authors = author_list[0].replace(',', '')
    elif len(author_list) == 2: authors = f"{author_list[0].replace(',', '')} and {author_list[1].replace(',', '')}"
    elif len(author_list) >= 3: authors = f"{author_list[0].replace(',', '')} et al."
    else: authors = "Anon"

    title_raw = item_metadata.get('title', '[No Title]')
    item_type = item_metadata.get('itemType', 'journalArticle') # Assume journal if missing

    if item_type in ['journalArticle', 'conferencePaper', 'bookSection', 'report', 'thesis', 'webpage']:
        title = f"\"{title_raw}\"" # Title in quotes
        source_title_raw = item_metadata.get('publicationTitle', item_metadata.get('bookTitle', item_metadata.get('websiteTitle', '[No Source Title]')))
        source_title = f"<em>{source_title_raw}</em>" if source_title_raw != '[No Source Title]' else '[No Source Title]'
    elif item_type in ['book']:
        title = f"<em>{title_raw}</em>" # Book title in italics
        source_title = "" # Usually no separate source title for a book itself
    else: # Default fallback
         title = f"\"{title_raw}\""
         source_title_raw = '[Unknown Source Type]'
         source_title = f"<em>{source_title_raw}</em>"

    year = 'n.d.'
    if pd.notna(item_metadata.get('year')):
         try: year = str(int(item_metadata.get('year')))
         except: pass

    page = note_data.get('page_number', 'N/A')
    volume = item_metadata.get('volume')
    issue = item_metadata.get('issue')
    doi = item_metadata.get('doi')
    url = item_metadata.get('url')
    publisher = item_metadata.get('publisher')
    place = item_metadata.get('place')

    # Construct citation string piece by piece
    note_str = f"{authors}, {title}"
    if source_title and item_type not in ['book']: note_str += f" {source_title}"
    if volume: note_str += f" {volume}"
    if issue: note_str += f", no. {issue}"
    if item_type in ['book']: # Add publisher/place for books
        if publisher: note_str += f" ({place}: {publisher}, {year})" if place else f" ({publisher}, {year})"
        else: note_str += f" ({year})" # Year only if no publisher
    elif item_type not in ['book']: # Add year in parentheses for others
        note_str += f" ({year})"

    note_str += f", {page}." # Page number for all notes
    if doi: note_str += f" https://doi.org/{doi}."
    elif url and item_type not in ['journalArticle', 'bookSection', 'book']: # Add URL for types like reports, webpages
         note_str += f" {url}."

    return note_str


def format_chicago_short_note(note_data, item_metadata):
     """Formats a short Chicago note (Author Last Name, Short Title, Page)."""
     author_last = 'Anon'
     if item_metadata:
         authors_html = item_metadata.get('authors_html', 'N/A')
         if authors_html != 'N/A':
              try:
                   first_author_parts = authors_html.split(';')[0].split(',')
                   if len(first_author_parts) > 0: author_last = first_author_parts[0].strip()
                   else: author_last = authors_html.strip()
              except: pass

     title_raw = item_metadata.get('title', 'Work')
     words = title_raw.split(); short_title_words = words[:5]
     short_title = " ".join(short_title_words)
     if len(words) > 5 or len(short_title) > 35: short_title += "..."

     is_book = item_metadata.get('itemType') == 'book'
     formatted_short_title = f"<em>{short_title}</em>" if is_book else f"\"{short_title}\""
     page = note_data.get('page_number', 'N/A')
     return f"{author_last}, {formatted_short_title}, {page}."


def generate_themed_outline(all_coded_notes, research_question, output_dir, ai_provider, ai_models, cache=True):
    """Uses AI to analyze notes and generate a structured, themed outline directly."""
    themed_outline_cache_file = output_dir / "themed_outline_cache.json"
    if cache and (cached_outline := load_cache(themed_outline_cache_file)):
         if isinstance(cached_outline, list) and all(isinstance(s, str) for s in cached_outline):
              print("  INFO: Loaded themed outline from cache.")
              return cached_outline
         else: print("  WARN: Invalid themed outline cache format. Regenerating...")

    print("  INFO: Generating themed outline from coded notes (AI)...")
    if not all_coded_notes: print("  No coded notes available."); return ["Introduction", "Discussion", "Conclusion"] # Basic fallback

    # Prepare context
    context_notes = []; current_tokens = 0; items_included = 0
    # ... (logic to create notes_summary_for_theming - focusing on potential_theme and extracted_info) ...
    for key, notes in all_coded_notes.items():
        if not isinstance(notes, list): continue
        item_header = f"--- ITEM: {key} ---"
        notes_str = "\n".join([f"- {n.get('potential_theme','?').upper()}: {n.get('extracted_info', '')[:100]}..." for n in notes[:5]])
        item_tokens = len(item_header.split()) + len(notes_str.split())
        if current_tokens + item_tokens <= MAX_CODED_NOTES_CONTEXT_TOKENS:
             context_notes.append(item_header + "\n" + notes_str); current_tokens += item_tokens; items_included += 1
        else: break
    notes_summary_for_theming = "\n".join(context_notes)
    print(f"  INFO: Prepared context for outline using notes from {items_included} items (approx {current_tokens} tokens).")


    context = f"""
Research Question: {research_question}
Coded Notes Summary (Snippets & Potential Themes from documents related to the RQ):
--- BEGIN NOTES SUMMARY ---
{notes_summary_for_theming}
--- END NOTES SUMMARY ---

Task: Analyze the research question and the provided summary of coded notes. Identify the major recurring themes, arguments, concepts, or findings. Based on these, propose a logical outline structure for the *main body* of a literature review that directly addresses the research question. Group related concepts into coherent sections with clear, descriptive titles. Aim for 3-7 main body sections presented in a logical flow (e.g., defining problem -> methods -> implications -> challenges). Output *only* a JSON list of strings, where each string is a final section title. Do not include 'Introduction', 'Methods', 'Conclusion', etc.

Example JSON Output:
["Defining the Attribution Challenge", "Methodological Approaches to Attribution", "Legal Frameworks and State Responsibility", "Policy Implications and Deterrence Strategies", "Public Attribution and International Norms", "Future Research Directions"]

Final Outline Section Titles (JSON List):
"""
    outline = None
    # ... (Retry logic for LLM call using "generate_themed_outline" prompt key) ...
    for attempt in range(LLM_MAX_RETRIES + 1):
        try:
            llm_response = call_models(ai_provider, ai_models, context, "generate_themed_outline", base_output_dir=output_dir) # New prompt key
            response_text = get_ai_response_text(llm_response, "Generate Themed Outline")
            outline = parse_json_list_from_llm(response_text, "Themed Outline")
            if outline and isinstance(outline, list) and all(isinstance(s, str) for s in outline):
                 print(f"  INFO: AI generated themed outline: {outline}")
                 if cache: save_cache(outline, themed_outline_cache_file)
                 return outline
            else: print(f"    WARN: Invalid outline format received (Attempt {attempt+1}).")
        except Exception as e: print(f"    ERROR during outline generation (Attempt {attempt+1}): {e}")
        if attempt < LLM_MAX_RETRIES: time.sleep(LLM_RETRY_DELAY)
        else: print("    ERROR: Max retries reached for outline generation."); return ["Section 1: Findings", "Section 2: Gaps"] # Basic fallback


def get_relevant_abstracts(items_list_of_dicts, max_tokens=MAX_ABSTRACT_TOKENS_FOR_CONTEXT):
    """Extracts abstracts from a list of item dictionaries."""
    abstracts = []
    total_tokens = 0
    items_with_abstracts_count = 0
    for item in items_list_of_dicts:
        abstract = item.get('abstract', '')
        if abstract and isinstance(abstract, str) and abstract.strip():
            items_with_abstracts_count += 1
            tokens = len(abstract.split())
            if total_tokens + tokens <= max_tokens:
                abstracts.append(f"ITEM KEY: {item.get('key', 'N/A')}\nTITLE: {item.get('title', 'N/A')}\nYEAR: {item.get('year', 'N/A')}\nABSTRACT: {abstract}\n---")
                total_tokens += tokens
            else: break
    print(f"  INFO: Found {items_with_abstracts_count} items with abstracts for context.")
    print(f"  INFO: Prepared context with abstracts from {len(abstracts)} items (approx. {total_tokens} tokens).")
    return "\n".join(abstracts)

def parse_json_list_from_llm(response_text, section_name="Data"):
    """Attempts to parse a JSON list (of strings or objects) from LLM output."""
    # ... (use the robust implementation from the previous response) ...
    if not response_text: return None
    text_cleaned = re.sub(r"^\s*```[a-zA-Z]*\s*", "", response_text, flags=re.MULTILINE)
    text_cleaned = re.sub(r"\s*```\s*$", "", text_cleaned, flags=re.MULTILINE)
    text_cleaned = text_cleaned.replace("<br>", "").replace("\\n", "\n").strip()
    try:
        start_index = text_cleaned.find('[')
        if start_index != -1:
             json_text_to_parse = text_cleaned[start_index:]
             balance = 0; end_index = -1
             for i, char in enumerate(json_text_to_parse):
                  if char == '[': balance += 1
                  elif char == ']': balance -= 1
                  if balance == 0: end_index = i + 1; break
             if end_index != -1: json_text_to_parse = json_text_to_parse[:end_index]
             parsed_data = json.loads(json_text_to_parse)
             if isinstance(parsed_data, list): return parsed_data
    except json.JSONDecodeError: pass
    lines = [line.strip('-* ').strip() for line in text_cleaned.splitlines() if line.strip().startswith(('-', '*')) and line.strip('-* ').strip()]
    if lines: print(f"    INFO: Parsed {section_name} as Markdown list."); return lines
    print(f"    WARN: Could not parse {section_name} as JSON list or Markdown list from response:\n{response_text[:300]}...")
    return None

def parse_json_object_from_llm(response_text, section_name="Data"):
     """Attempts to parse a JSON object from LLM output."""
     if not response_text: return None
     text_cleaned = re.sub(r"^\s*```[a-zA-Z]*\s*", "", response_text, flags=re.MULTILINE)
     text_cleaned = re.sub(r"\s*```\s*$", "", text_cleaned, flags=re.MULTILINE)
     text_cleaned = text_cleaned.replace("<br>", "").replace("\\n", "\n").strip()
     try:
        start_index = text_cleaned.find('{')
        if start_index != -1:
             json_text_to_parse = text_cleaned[start_index:]
             balance = 0; end_index = -1; in_string = False
             for i, char in enumerate(json_text_to_parse):
                  if char == '"': in_string = not in_string
                  if not in_string:
                       if char == '{': balance += 1
                       elif char == '}': balance -= 1
                       if balance == 0: end_index = i + 1; break
             if end_index != -1: json_text_to_parse = json_text_to_parse[:end_index]
             parsed_data = json.loads(json_text_to_parse)
             if isinstance(parsed_data, dict): return parsed_data
     except Exception as e: print(f"    ERROR parsing JSON object for {section_name}: {e}")
     print(f"    WARN: Could not parse {section_name} as JSON object from response:\n{response_text[:300]}...")
     return None

# --- Simulation Step Functions ---

def generate_criteria(research_question, abstracts_context, output_dir, ai_provider, ai_models, cache=True,  progress_callback=None):
    """Uses AI to draft inclusion/exclusion criteria."""
    cache_file = output_dir / "criteria_cache.json"
    if cache and (cached_criteria := load_cache(cache_file)):
        _emit_progress(progress_callback, f"Output: Loaded criteria from cache ({cache_file.name}).", True)
        return cached_criteria

    _emit_progress(progress_callback, "Executing: Calling LLM to generate criteria...", False)

    context = f"Research Question: {research_question}\n\nSample Abstracts:\n{abstracts_context}\n\nTask: Based on the research question and sample abstracts, draft specific inclusion and exclusion criteria for a literature review. Focus on Population/Participants, Intervention/Exposure, Comparison, Outcomes, and Study Design (PICOS) elements where applicable. Output *only* a JSON object with keys 'inclusion_criteria' and 'exclusion_criteria', each containing a list of strings.\n\nExample JSON Output:\n{{\n  \"inclusion_criteria\": [\n    \"Studies published between 2015-2024\",\n    \"Focus on policy interventions for cyber attribution\",\n    \"Report empirical results (quantitative or qualitative)\"\n  ],\n  \"exclusion_criteria\": [\n    \"Studies not in English\",\n    \"Opinion pieces or editorials\",\n    \"Focus solely on technical methods without policy context\"\n  ]\n}}\n\nCriteria (JSON Object):"
    criteria = None
    for attempt in range(LLM_MAX_RETRIES + 1):
         try:
             llm_response = call_models(ai_provider, ai_models, context, "generate_review_criteria", base_output_dir=output_dir)
             response_text = get_ai_response_text(llm_response, "Generate Criteria")
             criteria = parse_json_object_from_llm(response_text, "Criteria")
             if criteria and isinstance(criteria, dict) and 'inclusion_criteria' in criteria and 'exclusion_criteria' in criteria:
                  print("  AI generated criteria successfully.")
                  if cache: save_cache(criteria, cache_file)
                  _emit_progress(progress_callback, f"Output: AI generated criteria: {json.dumps(criteria, indent=2)}",
                                 True)

                  return criteria
             else:_emit_progress(progress_callback, f"Output: AI generated criteria: {json.dumps(criteria, indent=2)}", True)

         except Exception as e: print(f"    ERROR during criteria generation (Attempt {attempt+1}): {e}")
         if attempt < LLM_MAX_RETRIES: time.sleep(LLM_RETRY_DELAY)
         else: print("    ERROR: Max retries reached for criteria generation."); return None


# Assume necessary helper functions are imported or defined globally:
# from .utils import load_cache, save_cache, parse_json_object_from_llm
# from .llm_interface import call_models, get_ai_response_text

# Define constants if not already global
LLM_RETRY_DELAY = 5
LLM_MAX_RETRIES = 2

def screen_items(
    items_to_screen, # List of item dictionaries (needs 'key', 'title', 'abstract')
    criteria, # The BROAD criteria dictionary {'inclusion_criteria': [...], 'exclusion_criteria': [...]}
    research_questions_list, # List of RQ strings
    output_dir, # Path object for saving cache
    ai_provider,
    ai_models,
    cache=True,
        progress_callback=None
    ):
    """
    Uses AI to screen items against broad criteria AND determine relevance
    to specific research questions. Handles caching of results.
    """
    # Use a distinct cache file for multi-RQ results
    screening_cache_file = output_dir / "screening_decisions_cache_multi_rq.json"
    # Stores dict: {item_key: {'include': bool, 'relevant_rq_indices': list[int], 'reason': str}}
    screening_decisions = {}
    _emit_progress(progress_callback, f"Objective: Screen {len(items_to_screen)} items (Title/Abstract) against broad criteria and {len(research_questions_list)} RQs.", False)

    if cache and screening_cache_file.exists():
        cached_decisions = load_cache(screening_cache_file)
        # Basic validation of cached data structure
        if isinstance(cached_decisions, dict):
            # Optional: More thorough validation could check keys of inner dicts
            screening_decisions = cached_decisions
            _emit_progress(progress_callback,
                           f"Status: Loaded {len(screening_decisions)} screening decisions from cache.", False)

        else:
            print(f"  WARN: Invalid multi-RQ screening cache format found at {screening_cache_file}. Regenerating...")

    print(f"  Screening {len(items_to_screen)} items (Title/Abstract) against broad criteria & {len(research_questions_list)} RQs...")
    items_processed_this_run = 0
    items_newly_included = 0
    items_newly_excluded = 0

    # --- Format inputs for the prompt (once) ---
    inclusion_criteria_str = "\n- ".join(criteria.get('inclusion_criteria', ['N/A']))
    exclusion_criteria_str = "\n- ".join(criteria.get('exclusion_criteria', ['N/A']))
    # Format RQs with indices for the prompt
    research_questions_formatted = "\n".join(
        [f"  {i}: {rq}" for i, rq in enumerate(research_questions_list)]
    )
    # --- End formatting ---

    for item_index, item in enumerate(items_to_screen):
        item_key = item.get('key')
        _emit_progress(progress_callback, f"  - Processing Item {item_index + 1}/{len(items_to_screen)}: {item_key}",
                       False)
        if not item_key or item_key == 'N/A':
            print(f"    WARN: Skipping item at index {item_index} due to missing key.")
            continue

        # Skip if already processed (loaded from cache)
        if item_key in screening_decisions:
            continue

        items_processed_this_run += 1
        item_title_snippet = item.get('title', 'No Title')[:60]
        items_to_process_count = len(items_to_screen) - len(screening_decisions)
        _emit_progress(progress_callback, f"Executing: Screening remaining {items_to_process_count} items via LLM...",
                       False)

        title = item.get('title', '')
        # Ensure 'abstract' key matches how abstract is stored in items_to_screen dicts
        abstract = item.get('abstract', '') # Check if key should be 'abstractNote' etc.

        if not title and not abstract:
             print("      - Skipping: No title or abstract available.")
             # Ensure structure matches expected output even for skipped items
             decision = {'include': False, 'relevant_rq_indices': [], 'reason': 'Missing title and abstract'}
             screening_decisions[item_key] = decision
             items_newly_excluded += 1
             continue

        # Prepare context dictionary for the LLM call
        context_for_llm = {
            "inclusion_criteria_str": inclusion_criteria_str,
            "exclusion_criteria_str": exclusion_criteria_str,
            "research_questions_formatted": research_questions_formatted,
            "title": title,
            "context": abstract # Ensure 'context' variable in prompt matches this key
        }

        decision = None # Reset decision for each item
        for attempt in range(LLM_MAX_RETRIES + 1):
             try:
                  # *** Use the NEW prompt key designed for multi-RQ screening ***
                  llm_response = call_models(
                      ai_provider, ai_models,
                      context_for_llm, # Pass the prepared context dict
                      "screen_item_multi_rq", # Use the key for the multi-RQ prompt
                      base_output_dir=output_dir
                  )
                  response_text = get_ai_response_text(llm_response, f"Screen Item {item_key} (Multi-RQ)")
                  decision_attempt = parse_json_object_from_llm(response_text, f"Screening Decision {item_key}")

                  # --- Validate the NEW structure from the LLM ---
                  if (decision_attempt and isinstance(decision_attempt, dict) and
                      all(k in decision_attempt for k in ['include', 'relevant_rq_indices', 'reason']) and
                      isinstance(decision_attempt['include'], bool) and
                      isinstance(decision_attempt['relevant_rq_indices'], list) and
                      isinstance(decision_attempt['reason'], str) and
                      all(isinstance(idx, int) for idx in decision_attempt['relevant_rq_indices']) # Check indices are ints
                     ):

                       # --- Consistency Check ---
                       is_consistent = True
                       if decision_attempt['include'] and not decision_attempt['relevant_rq_indices']:
                           print(f"      WARN: Inconsistent screening result for {item_key}. Marked include=True but no relevant RQs. Correcting to include=False.")
                           decision_attempt['include'] = False
                           # Keep reason as is, it might explain the initial thought process
                       elif not decision_attempt['include'] and decision_attempt['relevant_rq_indices']:
                           print(f"      WARN: Inconsistent screening result for {item_key}. Marked include=False but relevant RQs listed {decision_attempt['relevant_rq_indices']}. Correcting to include=True.")
                           decision_attempt['include'] = True # Correct based on RQ relevance
                           # Update reason if it implies exclusion based on non-relevance
                           if "Not relevant" in decision_attempt['reason']:
                               decision_attempt['reason'] = f"Relevant to RQ(s) {decision_attempt['relevant_rq_indices']} based on abstract content."

                       decision = decision_attempt # Accept validated & potentially corrected decision
                       if decision:
                           status = 'Include' if decision['include'] else 'Exclude'
                           rqs = decision['relevant_rq_indices'] or 'None'
                           reason = decision['reason']
                           _emit_progress(progress_callback, f"    Decision: {status} | RQs: {rqs} | Reason: {reason}",
                                          False)
                       else:
                           _emit_progress(progress_callback, "    Decision: Failed (defaulting to exclude).", False)

                       success = True # Mark success for retry logic
                       break # Exit retry loop
                  else:
                       print(f"    WARN: Invalid screening decision JSON structure/types received (Attempt {attempt+1}). Response: {str(response_text)[:200]}...")
                       # Let it retry by not setting success=True or breaking

             except Exception as e:
                 print(f"    ERROR during multi-RQ screening call for {item_key} (Attempt {attempt+1}): {e}")
                 # Fall through to retry or default exclusion

             # Retry delay if not successful and not max retries
             if attempt < LLM_MAX_RETRIES:
                 print(f"      - Retrying screening in {LLM_RETRY_DELAY} seconds...")
                 time.sleep(LLM_RETRY_DELAY)
             else:
                  # Max retries reached
                  print(f"    ERROR: Max retries reached for screening {item_key}. Defaulting to exclude.")
                  decision = {'include': False, 'relevant_rq_indices': [], 'reason': 'Screening failed after multiple attempts.'}
                  items_newly_excluded += 1
                  break # Exit retry loop

        # Store the final decision (either successful, corrected, or default error)
        screening_decisions[item_key] = decision
        # Optional shorter delay between API calls
        time.sleep(0.3)

    # --- End of item loop ---

    # Save updated decisions to cache if any new items were processed
    if cache and items_processed_this_run > 0:
        print(f"\n  Saving {len(screening_decisions)} screening decisions to cache: {screening_cache_file}")
        save_cache(screening_decisions, screening_cache_file)
        _emit_progress(progress_callback, f"Status: Saved {len(screening_decisions)} screening decisions to cache.", False)


    # Calculate final included keys based on the possibly updated decisions
    included_keys = {k for k, v in screening_decisions.items() if v.get('include')}
    excluded_keys = set(screening_decisions.keys()) - included_keys
    _emit_progress(progress_callback, f"Output: Screening complete. Total included (for at least one RQ): {len(included_keys)}", True)

    print(f"\n  Multi-RQ Screening complete.")
    print(f"    Items processed this run: {items_processed_this_run}")
    print(f"    Newly included: {items_newly_included}, Newly excluded: {items_newly_excluded}")
    print(f"    Total included (for at least one RQ): {len(included_keys)}, Total excluded: {len(excluded_keys)}")

    # Return the detailed decisions dict and the set of included keys
    return screening_decisions, included_keys

def generate_final_narratives(research_question, final_sections, written_sections, output_dir, ai_provider, ai_models):
     """Generates Abstract, Introduction, Conclusion."""
     print("  Generating final Abstract, Introduction, Conclusion (AI)...")
     full_draft_text = "\n\n".join([f"### {title}\n\n{content}"
                                   for title, content in written_sections.items()
                                   if title in final_sections]) # Ensure order

     final_summary_context = f"""
Literature Review Summary for Final Sections:
Research Question: {research_question}
Final Outline Sections: {', '.join(final_sections)}

Generated Main Body Content Summary (Truncated):
--- BEGIN BODY SUMMARY ---
{full_draft_text[:MAX_CODED_NOTES_CONTEXT_TOKENS]}
--- END BODY SUMMARY ---
{( '...' if len(full_draft_text) > MAX_CODED_NOTES_CONTEXT_TOKENS else '')}

Task: Based *only* on the Research Question, Final Outline Sections, and Generated Main Body Content provided above, generate the specified report section (Abstract, Introduction, or Conclusion).
For Abstract: Provide a concise overview (150-300 words) covering the review's objective (research question), scope (mentioning literature review approach), main themes/findings discussed (reflecting the final sections), and the key conclusion or identified gap.
For Introduction: Provide brief background context, state the research question and significance, describe the literature review approach (mentioning key steps like coding/theming if applicable), and outline the final sections.
For Conclusion: Summarize the key synthesized findings from the Body Summary in relation to the research question, reiterate the main gaps or contributions identified in the literature, and suggest specific future research directions based *only* on the review's synthesized content.
"""
     # Add retry logic if desired...
     try:
        ai_abstract = get_ai_response_text(call_models(ai_provider, ai_models, final_summary_context, "lr_abstract_generation", base_output_dir=output_dir), "LR Abstract")
        ai_introduction = get_ai_response_text(call_models(ai_provider, ai_models, final_summary_context, "lr_introduction_generation", base_output_dir=output_dir), "LR Introduction")
        ai_conclusion = get_ai_response_text(call_models(ai_provider, ai_models, final_summary_context, "lr_conclusion_generation", base_output_dir=output_dir), "LR Conclusion")
        print("  Final narrative sections generated.")
        return ai_abstract, ai_introduction, ai_conclusion
     except Exception as e:
        print(f"*** ERROR generating final narrative sections: {e}")
        return "[Error generating Abstract]", "[Error generating Introduction]", "[Error generating Conclusion]"


# Make sure fuzzywuzzy is available if you intend to use it
try:
    from fuzzywuzzy import process as fuzzy_process
    from fuzzywuzzy import fuzz
    FUZZYWUZZY_AVAILABLE = True
    # Optional: print("INFO: fuzzywuzzy library found.")
except ImportError:
    # Optional: print("WARN: fuzzywuzzy or python-Levenshtein not installed. Using fallback substring matching.")
    FUZZYWUZZY_AVAILABLE = False

def cluster_notes_by_section(
    all_coded_notes_for_rq, # Dict: {item_key: [list_of_RQ_SPECIFIC_note_dicts]}
    themed_outline,        # List of section title strings for THIS RQ
    research_question,     # Current RQ for context
    output_dir,            # RQ-specific output directory for caching & LLM logs
    ai_provider,
    ai_models,
    cache=True,
    force_regenerate=False, # Flag to force regeneration for this specific RQ step
    max_notes_for_context = 500, # Limit total notes passed to LLM to avoid excessive cost/length
    max_context_tokens = 15000  # Token limit for the clustering prompt context
    ):
    """
    Assigns enhanced coded notes to RQ-specific themed outline sections using an LLM.
    Handles caching of the resulting assignments.
    """
    print(f"  Assigning ~{sum(len(notes) for notes in all_coded_notes_for_rq.values())} notes to {len(themed_outline)} themed sections using LLM...")

    # --- Define RQ-specific cache file for this step ---
    thematic_cluster_cache_file = output_dir / "thematic_clusters_cache_llm.json" # New cache name

    if cache and not force_regenerate and thematic_cluster_cache_file.exists():
        cached_clusters = load_cache(thematic_cluster_cache_file)
        if isinstance(cached_clusters, dict):
            print(f"  Loaded thematic note clusters (LLM-based) for this RQ from cache: {thematic_cluster_cache_file}")
            # Convert keys back to list values if needed (depends on how it was saved)
            # Assuming cache stores {section_title: [list_of_notes]}
            # Ensure values are lists using defaultdict
            return defaultdict(list, cached_clusters)
        else:
            print(f"  WARN: Invalid LLM thematic cluster cache format at {thematic_cluster_cache_file}. Regenerating...")

    # --- Proceed with clustering if not loaded from cache ---
    notes_by_section = defaultdict(list)
    if not all_coded_notes_for_rq or not themed_outline:
        print("  Skipping note assignment (no relevant notes or themed outline for this RQ).")
        if cache: save_cache({}, thematic_cluster_cache_file) # Save empty cache
        return notes_by_section

    # --- Prepare Notes Data for LLM Prompt ---
    notes_for_prompt = []
    note_lookup = {} # To reconstruct the result {section_title: [full_note_dict]}
    current_tokens = 0
    notes_processed_for_prompt = 0

    # Flatten notes and prioritize or sample if too many
    all_notes_flat = []
    for item_key, notes_list in all_coded_notes_for_rq.items():
        if isinstance(notes_list, list):
            all_notes_flat.extend(notes_list)

    # Optional: Shuffle or prioritize notes if exceeding max_notes_for_context
    # random.shuffle(all_notes_flat) # Example shuffle

    for note_dict in all_notes_flat:
        if not isinstance(note_dict, dict) or 'note_id' not in note_dict: continue

        note_id = note_dict['note_id']
        note_lookup[note_id] = note_dict # Store full note for later lookup

        # Create concise representation for the prompt
        paraphrase = note_dict.get('paraphrase', '').strip()
        comment = note_dict.get('researcher_comment', '').strip()
        keywords = ", ".join(note_dict.get('suggested_keywords', []))
        note_repr = f"Note ID: {note_id}\nParaphrase: {paraphrase}\nComment: {comment}\nKeywords: {keywords}\n---"

        note_tokens = len(note_repr.split()) # Estimate tokens

        if current_tokens + note_tokens <= max_context_tokens and notes_processed_for_prompt < max_notes_for_context:
            notes_for_prompt.append(note_repr)
            current_tokens += note_tokens
            notes_processed_for_prompt += 1
        elif notes_processed_for_prompt >= max_notes_for_context:
             print(f"  WARN: Reached max notes limit ({max_notes_for_context}) for clustering context. Processing subset.")
             break
        else: # Token limit reached before note limit
             print(f"  WARN: Reached token limit ({max_context_tokens}) for clustering context. Processing subset of {notes_processed_for_prompt} notes.")
             break

    if not notes_for_prompt:
        print("  ERROR: Could not prepare any notes for LLM clustering prompt.")
        if cache: save_cache({}, thematic_cluster_cache_file)
        return notes_by_section

    notes_context_str = "\n".join(notes_for_prompt)

    # --- Prepare Prompt for LLM Thematic Clustering ---
    context = f"""
Research Question: {research_question}
Target Thematic Outline Sections:
{chr(10).join([f'- "{title}"' for title in themed_outline])}

Notes to Cluster (ID, Paraphrase, Comment, Keywords):
--- BEGIN NOTES ---
{notes_context_str}
--- END NOTES ---

Task: Carefully analyze each note provided above. Assign each Note ID to the *single most relevant* Target Thematic Outline Section it belongs to, based on the note's content (paraphrase, comment, keywords) and its relation to the section title's theme.

Output *only* a JSON object where:
- Keys are the exact strings of the Target Thematic Outline Sections.
- Values are lists of Note IDs (strings) that belong to that section.
- Every Note ID listed in the 'Notes to Cluster' section above MUST be assigned to exactly one section key. If a note doesn't seem to fit well anywhere, assign it to the *least bad* fit or potentially a generated 'Uncategorized' key (but prioritize assigning to the provided themes).

Example JSON Output:
{{
  "Technical Barriers to Accurate Cyber Attribution": ["ITEMKEY_p5_n1", "ITEMKEY_p12_n3", "ITEMKEY_p6_n12"],
  "Legal Ambiguities in Establishing State Responsibility": ["ITEMKEY_p8_n2", "ITEMKEY_p8_n5", "ITEMKEY_p15_n1", "ITEMKEY_p6_n14"],
  "Policy Coordination and Deterrence Efficacy Challenges": ["ITEMKEY_p3_n5", "ITEMKEY_p14_n33"]
  // ... other sections ...
}}

Thematic Assignments (JSON Object):
"""

    # --- LLM Call and Parsing ---
    clustered_assignments = {} # Dict {section_title: [note_id_list]}
    try:
        prompt_key = "cluster_notes_to_themes_llm" # Define this new key in your prompts JSON
        llm_response = call_models(ai_provider, ai_models, context, prompt_key, base_output_dir=output_dir)
        response_text = get_ai_response_text(llm_response, f"LLM Thematic Clustering RQ{research_question[:10]}")
        # Use JSON object parsing
        parsed_data = parse_json_object_from_llm(response_text, f"Thematic Clusters RQ{research_question[:10]}")

        if isinstance(parsed_data, dict):
            # Basic validation: ensure keys are subset of outline, values are lists of strings
            is_valid = True
            all_clustered_ids = set()
            processed_titles = set()
            for section_title, note_ids in parsed_data.items():
                if section_title not in themed_outline and section_title != "Uncategorized": # Allow for uncategorized only
                     print(f"  WARN: LLM returned unexpected section title '{section_title}'.")
                     # Decide whether to ignore it or keep it
                     # continue # Option: Ignore unexpected keys
                if not isinstance(note_ids, list): is_valid = False; break
                for note_id in note_ids:
                    if not isinstance(note_id, str): is_valid = False; break
                    all_clustered_ids.add(note_id)
                if not is_valid: break
                processed_titles.add(section_title)

            # Optional check: Did it cluster all notes it was given?
            input_ids_set = set(note_lookup.keys()) & set(n.split('\n')[0].split(': ')[1] for n in notes_for_prompt) # IDs actually sent
            if not input_ids_set.issubset(all_clustered_ids):
                print(f"  WARN: LLM did not cluster all input note IDs. Missing: {len(input_ids_set - all_clustered_ids)}")

            if is_valid:
                clustered_assignments = parsed_data
                print(f"  LLM successfully assigned notes to {len(processed_titles)} sections.")
            else:
                 print(f"  WARN: Invalid format received for LLM thematic clusters.")
        else:
             print(f"  WARN: Failed to parse LLM thematic clusters as JSON object.")

    except Exception as e:
        print(f"    *** ERROR during LLM thematic clustering for RQ '{research_question[:50]}...': {e}")

    # --- Reconstruct the final {section_title: [list_of_full_note_dicts]} ---
    notes_by_section = defaultdict(list)
    assigned_notes_count = 0
    processed_ids = set()

    for section_title, note_ids in clustered_assignments.items():
        if section_title not in themed_outline and section_title != "Uncategorized":
             print(f"  Skipping notes assigned to unexpected section: '{section_title}'")
             continue # Skip sections not in the original outline unless 'Uncategorized'

        section_notes = []
        for note_id in note_ids:
            if note_id in note_lookup:
                section_notes.append(note_lookup[note_id])
                processed_ids.add(note_id)
            # else: print(f"  WARN: Note ID '{note_id}' returned by LLM but not found in lookup.")
        if section_notes:
             notes_by_section[section_title] = section_notes
             assigned_notes_count += len(section_notes)

    # Handle notes that were in the input but not clustered by the LLM (if any)
    input_ids_sent = set(note_lookup.keys()) & set(n.split('\n')[0].split(': ')[1] for n in notes_for_prompt)
    unassigned_count = len(input_ids_sent - processed_ids)

    print(f"\n  LLM Clustering complete. Processed {len(input_ids_sent)} notes in prompt.")
    print(f"  Assigned {assigned_notes_count} notes to {len(notes_by_section)} sections.")
    if unassigned_count > 0:
        print(f"  WARN: {unassigned_count} notes provided to LLM were not assigned to a valid section title.")
    if "Uncategorized" in notes_by_section:
         print(f"  WARN: {len(notes_by_section['Uncategorized'])} notes were placed in 'Uncategorized'.")
         # Optionally handle uncategorized notes - maybe try assigning them again?

    # Save the result to cache before returning
    if cache:
        print(f"  Saving LLM thematic note clusters for this RQ to cache: {thematic_cluster_cache_file}")
        save_cache(dict(notes_by_section), thematic_cluster_cache_file)

    return notes_by_section
# Define constants if not already global
# This limit applies to the notes passed for writing a single argument/paragraph cluster
MAX_ARGUMENT_NOTES_CONTEXT = 4000 # Adjust as needed, likely smaller than section limit
LLM_RETRY_DELAY = 5
LLM_MAX_RETRIES = 2

def write_narrative_paragraph(
    section_title,           # Broader theme context
    argument_summary,        # Specific argument this paragraph addresses
    notes_for_argument,      # List of ENHANCED note dicts for this argument
    all_items_dict,          # For potential metadata lookup (though less needed now)
    zotero_items_lookup,     # For fetching author/year if needed for context prep
    research_question,       # Overall context
    output_dir,
    ai_provider,
    ai_models
    ):
    """
    Writes 1-2 paragraphs synthesizing a focused list of notes for a specific argument,
    including {{CITE|KEY=|PAGE=}} placeholders.
    """
    print(f"      - Crafting paragraph for argument: '{argument_summary[:80]}...'")

    if not notes_for_argument:
        print("        - No notes provided for this argument. Skipping paragraph generation.")
        return "" # Return empty string if no notes

    # --- Prepare data and context string for the LLM ---
    notes_data_for_prompt = [] # List of dicts for JSON part (KEY/PAGE needed)
    notes_context_list = []    # List of strings for text summary part
    current_tokens = 0

    for note_data in notes_for_argument:
        if not isinstance(note_data, dict): continue # Skip invalid notes

        item_key = note_data.get('item_key')
        page_num_str = str(note_data.get('page_number', 'N/A'))
        paraphrase = note_data.get('paraphrase', '')
        comment = note_data.get('researcher_comment', '')
        quote_snippet = note_data.get('direct_quote', '')[:100] + "..."

        # Prepare dict for JSON data part of the prompt
        note_json_info = {
            "item_key": item_key,
            "page": page_num_str,
            # Include paraphrase/comment here too if helpful for LLM reference
            "paraphrase": paraphrase,
            "comment": comment
        }

        # Prepare string for text context part of the prompt
        context_line = (
            f"Note (Item: {item_key}, Page: {page_num_str}):\n"
            f"  Paraphrase: {paraphrase}\n"
            f"  Comment: {comment}\n"
            f"  Quote Snippet: {quote_snippet}\n"
            f"---\n"
        )
        note_tokens = len(context_line.split()) + len(json.dumps(note_json_info).split()) # Rough token estimate

        if current_tokens + note_tokens <= MAX_ARGUMENT_NOTES_CONTEXT:
            notes_context_list.append(context_line)
            notes_data_for_prompt.append(note_json_info)
            current_tokens += note_tokens
        else:
            print(f"        - Note context limit ({MAX_ARGUMENT_NOTES_CONTEXT} tokens) reached for argument '{argument_summary[:50]}...'. Using {len(notes_context_list)} notes.")
            break

    if not notes_data_for_prompt:
        print(f"        - Could not prepare any notes within token limit for argument '{argument_summary[:50]}...'. Skipping.")
        return ""

    notes_context_str = "".join(notes_context_list)
    notes_context_str = (
        f"Supporting Notes Details ({len(notes_data_for_prompt)} used, approx {current_tokens} tokens):\n"
        f"{notes_context_str}"
    )
    # Create JSON data string for the notes included in the context
    notes_data_json = json.dumps(notes_data_for_prompt, indent=None, ensure_ascii=False)


    # --- Construct the LLM Prompt ---
    # Use a specific prompt key defined in your JSON file
    prompt_key = "write_review_paragraph_from_args" # *** ADD THIS KEY TO YOUR PROMPTS JSON ***

    # Prepare the full context for the prompt template
    context_for_llm_prompt = f"""
Research Question: {research_question}
Main Section Theme: "{section_title}"
Specific Argument/Sub-Theme to Address: "{argument_summary}"

Supporting Notes Data (JSON format - Use for `item_key` and `page` when creating CITE placeholders):
--- BEGIN NOTES DATA ---
{notes_data_json}
--- END NOTES DATA ---

Contextual Summary of Notes (Paraphrases & Comments - Use for Synthesis):
{notes_context_str}

Task: Write 1-2 coherent paragraphs that synthesize the information from the provided 'Supporting Notes Details' to specifically discuss the 'Specific Argument/Sub-Theme': "{argument_summary}".
1. Focus *exclusively* on the notes provided and how they relate to the stated 'Specific Argument/Sub-Theme'.
2. Integrate the key points, findings, or perspectives from the notes (using the 'Contextual Summary'). If notes present differing views on this specific argument, compare or contrast them.
3. **Crucially:** When incorporating information derived from a specific note, you MUST insert an inline citation placeholder IMMEDIATELY AFTER the relevant phrase or sentence. Use the exact format `{{{{CITE|KEY=ITEM_KEY|PAGE=PAGE_NUMBER}}}}`. Extract the `item_key` and `page` number precisely from the corresponding entry in the 'Supporting Notes Data (JSON format)' above. Cite frequently to support claims based on the notes.
4. Maintain a formal, objective academic tone and use appropriate transition words.
5. Aim for well-structured paragraphs that directly address the argument.
6. Do *not* include the 'Argument/Sub-Theme' itself as a heading in the output. Start directly with the paragraph content.

Paragraph(s) discussing "{argument_summary}":
"""

    # --- LLM Call with Retry Logic ---
    retries = 0
    success = False
    paragraph_content = f"[ERROR: Failed to generate paragraph for argument '{argument_summary}' after {LLM_MAX_RETRIES + 1} attempts.]"

    while retries <= LLM_MAX_RETRIES and not success:
        try:
            llm_response = call_models(
                ai_provider, ai_models,
                context_for_llm_prompt, # Pass the fully formatted prompt string
                prompt_key,
                base_output_dir=output_dir
            )
            content_attempt_raw = get_ai_response_text(llm_response, f"Write Paragraph: {argument_summary[:50]}...")
            # Use the globally defined cleaner function
            content_attempt = clean_llm_output(content_attempt_raw)

            # Validation: Check if content exists and contains placeholders
            citation_pattern_found = bool(re.search(r'\{\{\s*CITE\s*\|', content_attempt or "", re.IGNORECASE))

            if content_attempt and len(content_attempt) > 10 and citation_pattern_found:
                 paragraph_content = content_attempt
                 success = True
                 print(f"        - Paragraph generated successfully.")
                 # No need for long sleep here, maybe shorter?
                 time.sleep(0.5)
            elif content_attempt and not citation_pattern_found:
                 # If notes were provided, we expect citations. Warn but accept.
                 print(f"        WARN: Generated paragraph for '{argument_summary[:50]}...' seems to be missing CITE placeholders. Accepting anyway.")
                 paragraph_content = content_attempt # Accept the text but it won't link footnotes
                 success = True
                 time.sleep(0.5)
            else:
                 error_context = content_attempt_raw if not content_attempt else content_attempt
                 raise ValueError(f"Invalid paragraph content or missing CITE placeholders: {error_context[:100]}...")

        except Exception as e:
            retries += 1
            print(f"      *** ERROR calling LLM for argument '{argument_summary[:50]}...' (Attempt {retries}/{LLM_MAX_RETRIES + 1}): {e}")
            if retries <= LLM_MAX_RETRIES:
                print(f"        - Retrying in {LLM_RETRY_DELAY} seconds...")
                time.sleep(LLM_RETRY_DELAY)
            else:
                print(f"        - Max retries reached for argument '{argument_summary[:50]}...'.")
                # Keep the default error message
                break

    return paragraph_content
import html
import json
import pandas as pd
from datetime import datetime
from jinja2 import Environment, FileSystemLoader
from pathlib import Path
import pickle
import time
import fitz # PyMuPDF


# Assume charts, Zotero class, and helper functions exist
# from charts import *
def clean_llm_output(text):
    """Removes common LLM preamble/postamble/markdown artifacts more aggressively."""
    # ... (function definition as provided before) ...
    if not text: return ""
    text = re.sub(r'^.*?(---\s*BEGIN (?:DRAFT|REVISED DRAFT|SECTION CONTENT|AI SUMMARY|NOTES DATA|NOTES SUMMARY)\s*---)', '', text, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r'(---\s*END (?:DRAFT|REVISED DRAFT|SECTION CONTENT|AI SUMMARY|NOTES DATA|NOTES SUMMARY)\s*---).*$', '', text, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r'^\s*Here is the.*?:?\s*\n', '', text, count=1, flags=re.IGNORECASE)
    text = re.sub(r'^\s*Revised Section Content:?\s*\n', '', text, count=1, flags=re.IGNORECASE)
    text = re.sub(r'^\s*Section Content Draft:?\s*\n', '', text, count=1, flags=re.IGNORECASE)
    text = re.sub(r'^\s*Paragraph\(s\) discussing.*?:?\s*\n', '', text, count=1, flags=re.IGNORECASE)
    text = re.sub(r'^```[a-z]*\n', '', text)
    text = re.sub(r'\n```$', '', text)
    text = re.sub(r'^\s*###?\s*.*\s*\n', '', text)
    lines = [line.strip() for line in text.strip().splitlines()]
    cleaned_lines = [line for line in lines if line]
    final_text = "\n".join(cleaned_lines)
    return final_text.strip()


# *** ADD THIS FUNCTION DEFINITION HERE ***
def clean_text_for_matching(text):
    """Cleans text for better fuzzy or keyword matching."""
    if not text: return ""
    text = text.lower() # Lowercase
    text = re.sub(r'[^\w\s]', '', text) # Remove punctuation
    text = re.sub(r'\s+', ' ', text).strip() # Normalize whitespace
    return text
from collections import Counter, defaultdict
import re
def generate_outline_from_keywords(
    keyword_clusters, # Dict {keyword: [notes...]} from previous step
    research_question,
    output_dir, ai_provider, ai_models,   num_themes=5
    ):
    """
    Generates a themed outline by asking an LLM to group keyword clusters.
    Returns a list of section titles.
    """
    print(f"  Step 5c: Generating themed outline from {len(keyword_clusters)} keyword clusters...")
    if not keyword_clusters:
        print("    WARN: No keyword clusters provided to generate outline.")
        return ["Section 1: Overview", "Section 2: Key Findings", "Section 3: Discussion"] # Basic fallback

    # Prepare context for the LLM - list keywords, maybe example paraphrases
    context_parts = []
    current_tokens = 0
    limit_tokens = 8000 # Limit context for this specific task

    context_parts.append("Keyword Clusters (Keyword: Example Paraphrase/Comment):")
    for keyword, notes in keyword_clusters.items():
        if not notes: continue
        # Get a representative paraphrase/comment
        sample_note = notes[0] # Take the first note
        example_text = sample_note.get('paraphrase') or sample_note.get('researcher_comment') or ""
        line = f"- \"{keyword}\": {example_text[:150]}..."
        line_tokens = len(line.split())
        if current_tokens + line_tokens <= limit_tokens:
            context_parts.append(line)
            current_tokens += line_tokens
        else:
            print("    WARN: Reached token limit preparing context for outline generation.")
            break

    keywords_context = "\n".join(context_parts)

    # --- LLM Prompt ---
    context = f"""
Research Question: {research_question}

Identified Keyword Clusters from Literature Notes:
{keywords_context}

Task: Analyze the provided Keyword Clusters, which represent groupings of notes based on frequent terms. Group these related keyword clusters into {num_themes} broad, coherent thematic sections suitable for a literature review addressing the Research Question. Provide a clear, descriptive title for each thematic section. The sections should follow a logical flow (e.g., context/challenges -> methods -> implications -> future).

Output *only* a JSON list of strings, where each string is a final section title. Do not include 'Introduction', 'Methods', 'Conclusion', etc.

Example JSON Output:
["Defining Attribution Challenges (Technical & Legal)", "Methodologies for Cyber Evidence Collection", "State Responsibility and International Law", "Policy Responses and Deterrence Strategies", "Credibility and Disclosure Issues"]

Final Outline Section Titles (JSON List - exactly {num_themes} titles):
"""
    outline = None
    try:
        prompt_key = "generate_outline_from_keywords_llm" # Add this key to your prompts JSON
        llm_response = call_models(ai_provider, ai_models, context, prompt_key, base_output_dir=output_dir)
        response_text = get_ai_response_text(llm_response, f"Generate Outline from Keywords RQ: {research_question[:10]}")
        outline = parse_json_list_from_llm(response_text, "Themed Outline from Keywords")

        if outline and isinstance(outline, list) and all(isinstance(s, str) for s in outline) and len(outline) > 1 :
            print(f"  INFO: AI generated themed outline from keywords: {outline}")
            # Truncate or pad if necessary to get exact number? Or allow flexibility? For now, accept LLM's count.
            return outline
        else:
             print(f"  WARN: Invalid outline format received from keywords. Using fallback.")
             # Fallback: use the keywords themselves as sections? Too granular. Use generic.
             return [f"Theme {i+1}" for i in range(num_themes)] # Generic fallback

    except Exception as e:
        print(f"    ERROR during outline generation from keywords: {e}")
        return [f"Theme {i+1}" for i in range(num_themes)] # Generic fallback

def assign_clusters_to_sections(
    notes_by_keyword_cluster, # Dict {keyword: [notes...]}
    final_sections_rq,        # List of final section titles
    output_dir, ai_provider, ai_models, # For LLM call
    cache=True, force_regenerate=False
    ):
    """
    Assigns keyword clusters (and their notes) to the final themed sections using LLM.
    Returns dict {section_title: [list_of_notes...]}
    """
    print(f"  Step 6: Assigning {len(notes_by_keyword_cluster)} keyword clusters to {len(final_sections_rq)} sections using LLM...")

    # --- Define Cache File ---
    assignment_cache_file = output_dir / "keyword_cluster_section_assignments.json"

    if cache and not force_regenerate and assignment_cache_file.exists():
        cached_assignments = load_cache(assignment_cache_file)
        # Basic validation: Check if it's a dict and keys match outline (optional but good)
        if isinstance(cached_assignments, dict) and set(cached_assignments.keys()).issubset(set(final_sections_rq).union({"Unassigned"})):
            print(f"  Loaded keyword cluster assignments from cache: {assignment_cache_file}")
            # Reconstruct notes from IDs if cache stored only IDs (adjust if needed)
            # Assuming cache stores {section_title: [note_id1, note_id2...]} - requires lookup
            # If cache stores full notes {section_title: [note_dict1...]}, this is simpler:
            return defaultdict(list, cached_assignments) # Assuming full notes stored
        else:
            print(f"  WARN: Invalid keyword cluster assignment cache format at {assignment_cache_file}. Regenerating...")

    # --- Prepare context for LLM ---
    if not notes_by_keyword_cluster or not final_sections_rq:
        print("   WARN: Cannot assign clusters - missing keyword clusters or final sections.")
        if cache: save_cache({}, assignment_cache_file)
        return defaultdict(list)

    keyword_list_str = "\n".join([f"- {kw}" for kw in notes_by_keyword_cluster.keys()])
    section_list_str = "\n".join([f'- "{sec}"' for sec in final_sections_rq])

    context = f"""
Task: Assign each Keyword Cluster listed below to the single BEST FITTING Thematic Section from the provided list. Consider the semantic meaning of the keyword and the scope of the section title.

Keyword Clusters to Assign:
{keyword_list_str}

Target Thematic Sections:
{section_list_str}

Output *only* a JSON object where:
- Keys are the EXACT strings of the Target Thematic Sections.
- Values are lists of the EXACT Keyword Cluster strings that belong primarily to that section.
- Every Keyword Cluster MUST be assigned to exactly one section. If a keyword truly fits nowhere, create a key "Unassigned" and assign it there.

Example JSON Output:
{{
  "Technical Barriers to Accurate Cyber Attribution": ["ip spoofing", "proxy servers", "forensic limitations"],
  "Legal Ambiguities in Establishing State Responsibility": ["state responsibility", "effective control", "due diligence"],
  "Unassigned": ["generic term"]
}}

Keyword Assignments (JSON Object):
"""
    # --- LLM Call ---
    assigned_keywords_by_section = {}
    try:
        prompt_key = "assign_keywords_to_sections_llm" # Add this key to your prompts JSON
        llm_response = call_models(ai_provider, ai_models, context, prompt_key, base_output_dir=output_dir)
        response_text = get_ai_response_text(llm_response, "Assign Keywords to Sections")
        parsed_data = parse_json_object_from_llm(response_text, "Keyword Assignments")

        if isinstance(parsed_data, dict):
            # Basic validation
            valid_assignment = True
            all_assigned_kws = set()
            original_kws = set(notes_by_keyword_cluster.keys())
            for sec, kws in parsed_data.items():
                if sec not in final_sections_rq and sec != "Unassigned": valid_assignment = False; print(f"WARN: Invalid section key '{sec}' returned."); break
                if not isinstance(kws, list): valid_assignment = False; break
                for kw in kws:
                    if not isinstance(kw, str) or kw not in original_kws: print(f"WARN: Invalid/Unknown keyword '{kw}' assigned to '{sec}'."); # Don't break, just warn
                    else: all_assigned_kws.add(kw) # Add valid assigned keywords
            if not valid_assignment: parsed_data = {} # Discard invalid data
            if original_kws != all_assigned_kws: print(f"WARN: Not all original keywords were assigned. Missing: {original_kws - all_assigned_kws}")

            assigned_keywords_by_section = parsed_data if valid_assignment else {}
            print(f"  LLM assigned keywords to {len(assigned_keywords_by_section)} sections.")
        else:
            print("  WARN: Failed to parse keyword assignments as JSON object.")

    except Exception as e:
        print(f"    *** ERROR during LLM keyword assignment: {e}")

    # --- Combine notes based on keyword assignments ---
    notes_by_section = defaultdict(list)
    notes_already_added_to_section = set() # Prevent duplicates if note was in multiple keyword clusters assigned to same section

    for section_title, keywords in assigned_keywords_by_section.items():
        if section_title == "Unassigned": continue # Skip unassigned for now
        for keyword in keywords:
            notes_in_cluster = notes_by_keyword_cluster.get(keyword, [])
            for note in notes_in_cluster:
                 note_id = note.get('note_id')
                 if note_id and note_id not in notes_already_added_to_section: # Check for duplicates
                     notes_by_section[section_title].append(note)
                     notes_already_added_to_section.add(note_id)

    print(f"  Consolidated notes into {len(notes_by_section)} sections based on keyword assignments.")

    # Save the final assignment {section_title: [list_of_notes]} to cache
    if cache:
        print(f"  Saving final thematic note assignments to cache: {assignment_cache_file}")
        save_cache(dict(notes_by_section), assignment_cache_file)

    return notes_by_section
def group_notes_by_keywords(
    all_coded_notes_for_rq,
    min_keyword_freq=3,
    max_clusters=50,
    stop_words=None
    ):
    """
    Analyzes 'suggested_keywords' in notes and groups notes by dominant keywords.
    Returns a dictionary: {dominant_keyword: [list_of_note_dicts]}
    """
    print(f"  Step 5b: Analyzing keywords and creating initial note groups...")
    if stop_words is None: # Basic English stop words, consider customizing
        stop_words = set(['the', 'a', 'an', 'in', 'on', 'of', 'for', 'and', 'to', 'is', 'it', 'with', 'as', 'by', 'be'])

    keyword_counts = Counter()
    notes_by_keyword = defaultdict(list)
    all_notes_flat = []
    note_lookup = {}

    # Flatten notes and index by note_id
    for item_key, notes_list in all_coded_notes_for_rq.items():
        if isinstance(notes_list, list):
            for note in notes_list:
                if isinstance(note, dict) and 'note_id' in note:
                    all_notes_flat.append(note)
                    note_lookup[note['note_id']] = note

    # Count cleaned keywords and map notes to keywords
    for note in all_notes_flat:
        note_id = note['note_id']
        keywords = note.get('suggested_keywords', [])
        processed_keywords = set() # Avoid counting same keyword multiple times for one note
        if isinstance(keywords, list):
            for kw in keywords:
                cleaned_kw = clean_text_for_matching(kw) # <<< USE THE HELPER FUNCTION
                # Basic filtering: ignore short words, stop words, numbers
                if len(cleaned_kw) > 2 and cleaned_kw not in stop_words and not cleaned_kw.isdigit():
                    if cleaned_kw not in processed_keywords:
                        keyword_counts[cleaned_kw] += 1
                        notes_by_keyword[cleaned_kw].append(note_id) # Store note_id first
                        processed_keywords.add(cleaned_kw)

    if not keyword_counts:
        print("    WARN: No valid keywords found in notes for grouping.")
        return {}

    # Select dominant keywords based on frequency
    dominant_keywords = [kw for kw, count in keyword_counts.most_common(max_clusters) if count >= min_keyword_freq]

    if not dominant_keywords:
        print(f"    WARN: No keywords met the minimum frequency threshold ({min_keyword_freq}). Cannot form keyword clusters.")
        return {}


    # Create the final clusters using full note dicts
    notes_by_keyword_cluster = {}
    assigned_note_ids = set()
    for keyword in dominant_keywords:
        note_ids_for_kw = notes_by_keyword[keyword]
        notes_by_keyword_cluster[keyword] = []
        for note_id in note_ids_for_kw:
            if note_id in note_lookup:
                notes_by_keyword_cluster[keyword].append(note_lookup[note_id])
                assigned_note_ids.add(note_id)

    print(f"    Created {len(notes_by_keyword_cluster)} initial keyword clusters based on {len(dominant_keywords)} dominant keywords (min freq: {min_keyword_freq}).")
    print(f"    Assigned {len(assigned_note_ids)} notes to these clusters.")

    return notes_by_keyword_cluster
from dotenv import load_dotenv

load_dotenv() # loads the variables from .env

# --- Configuration ---
LR_OUTPUT_DIR_BASE = Path("output_literature_review")
TEMPLATE_DIR_LR = Path("templates")
MAX_ABSTRACT_TOKENS_FOR_CONTEXT = 4000
MAX_PDF_CHUNK_TOKENS = 3500
MAX_CODED_NOTES_CONTEXT_TOKENS = 20000

CHICAGO_NOTE_MAX_QUOTE_LENGTH = 500
MAX_SECTION_NOTES_CONTEXT = 6000
MAX_ARGUMENT_NOTES_CONTEXT = 4000
# Assume clean_llm_output, call_models, get_ai_response_text defined
@pyqtSlot()
def _add_pdf_files(self):
    """
    Open the file system dialog, let the user pick PDF(s),
    compute a stable ID for each (SHA-1 on filename stem),
    store (path, pdf_id) tuples, and show the ID in the list.
    """
    files, _ = QFileDialog.getOpenFileNames(
        self,
        "Select PDF Files",
        "",
        "PDF Files (*.pdf)"
    )
    if not files:
        return

    added = 0
    for file_path in files:
        stem = Path(file_path).stem
        pdf_id = generate_pdf_id(stem)           # new helper
        record  = (file_path, pdf_id)

        # avoid duplicates
        if record in self.selected_pdf_files:
            continue

        self.selected_pdf_files.append(record)

        # list widget shows “filename  (id)”
        visible = f"{Path(file_path).name}   ({pdf_id})"
        item = QListWidgetItem(visible)
        item.setData(Qt.UserRole, record)
        self.pdf_list_widget.addItem(item)
        added += 1

    if added:
        self._log_to_screen(f"Added {added} PDF file(s).", is_status=True)
def generate_methodology_section(
    topic, research_question, criteria, num_items_processed,
    num_items_screened,
    num_items_included, # ADDED: Count of included items
    num_items_excluded, # ADDED: Count of excluded items
    num_pdfs_coded,
    final_sections, # The generated outline themes
    output_dir, ai_provider, ai_models
    ):
    """Generates a natural-sounding Methodology section text using AI, including screening counts."""
    print("  Generating Methodology section text (AI)...")

    # Prepare context summarizing the actual steps taken, now including counts
    context = f"""
Literature Review Topic: {topic}
Research Question(s): {research_question}
Eligibility Criteria Used:
  Inclusion: {criteria.get('inclusion_criteria', [])}
  Exclusion: {criteria.get('exclusion_criteria', [])}
Process Summary:
  - Initial items identified: {num_items_processed}
  - Items screened (Title/Abstract): {num_items_screened}
  - Items INCLUDED after screening: {num_items_included}  # Added count
  - Items EXCLUDED after screening: {num_items_excluded} # Added count
  - Full texts analyzed (coding): {num_pdfs_coded}
  - Key themes identified for synthesis: {final_sections}
  - Synthesis approach: Thematic synthesis, clustering relevant notes by theme and argument, narrative generation per argument cluster.

Task: Write the 'Methodology' section for this literature review, describing the process in a standard academic style. AVOID mentioning AI or simulation. Present it as a rigorous human-led review process.
1.  **Search Strategy & Data Source:** Briefly state the source and initial number of items.
2.  **Eligibility Criteria:** State that predefined criteria were applied. Briefly summarize key aspects.
3.  **Screening Process:** Describe the screening of titles/abstracts for {num_items_screened} items. **Clearly state the number of included ({num_items_included}) and excluded ({num_items_excluded}) studies at this stage.** Briefly mention primary exclusion reasons if known (though this prompt doesn't receive detailed reasons).
4.  **Data Extraction & Coding:** Describe the analysis of the {num_items_included} included full texts ({num_pdfs_coded} analyzed). Mention the type of data extracted (quotes, concepts, etc.).
5.  **Synthesis Approach:** Describe the thematic synthesis, argument clustering, and narrative generation based on the {len(final_sections)} identified themes: {', '.join(final_sections)}.
6.  **Tone:** Maintain a formal, objective, past-tense academic tone.

Methodology Section Content:
"""
    methodology_text = "[Methodology section could not be generated.]"
    try:
        prompt_key = "generate_methodology_text" # Ensure this key exists in your prompts JSON
        llm_response = call_models(ai_provider, ai_models, context, prompt_key, base_output_dir=output_dir)
        raw_text = get_ai_response_text(llm_response, "Generate Methodology Section")
        cleaned_text = clean_llm_output(raw_text)

        if cleaned_text:
            methodology_text = cleaned_text
            print("  Methodology section text generated.")
        else:
            methodology_text = "[Methodology section could not be generated or was empty after cleaning.]"
            print("  WARN: Methodology section text was empty after generation/cleaning.")

    except NameError as ne:
         print(f"*** FATAL ERROR in generate_methodology_section: Required function not found - {ne}")
         raise
    except Exception as e:
        print(f"*** ERROR generating methodology section text: {e}")

    return methodology_text

def generate_literature_review_simulated(
    # --- Workflow Selection & Data ---
    workflow_type: str,             # 'local_pdf' or 'zotero_qdrant'
    input_data: dict,
    research_questions_list: list,
    ai_provider: str,
    ai_models: dict,
    output_dir_base: Path = LR_OUTPUT_DIR_BASE,
    template_dir: Path = TEMPLATE_DIR_LR,
    your_name: str = "[Your Name]",
    your_affiliation: str = "[Your Affiliation]",
    zt_client=None,
    cache: bool = True,
    # --- Force flags (unchanged signature to preserve callers) --------
    force_regenerate_metadata: bool = False,
    force_regenerate_coding: bool = False,
    force_regenerate_queries: bool = False,
    force_regenerate_qdrant_search: bool = False,
    force_regenerate_para_clustering: bool = False,
    force_regenerate_outline: bool = False,
    force_regenerate_writing: bool = False,
    progress_callback=None
    ):
    """Top‑level orchestrator – now with automatic PDF‑ID injection &
    transparent RAG fallback when no local PDFs are provided."""

    # ----------------------------------------------------------------
    # 0. Sanity checks & auto‑fallback
    # ----------------------------------------------------------------
    if workflow_type == "local_pdf" and not input_data.get("pdf_files"):
        # User picked the button but attached nothing – try Zotero RAG.
        if zt_client is None:
            raise ValueError("Local PDF workflow selected but no files provided, "
                             "and Zotero client is not available for auto‑fallback.")
        workflow_type = "zotero_qdrant"
        input_data = {
            "collection_name": input_data.get("collection_name", ""),
            "qdrant_collection_name": input_data.get("qdrant_collection_name", "default")
        }
        _emit_progress(progress_callback,
                       "No PDFs attached – switching to Zotero‑RAG workflow.")

    # ----------------------------------------------------------------
    # 1. LOCAL PDF WORKFLOW -------------------------------------------
    # ----------------------------------------------------------------
    if workflow_type == "local_pdf":
        pdf_file_paths: list[str] = input_data["pdf_files"]
        if not pdf_file_paths:
            raise ValueError("pdf_files list empty – this should have been caught above.")

        # Build minimal metadata table using deterministic PDF IDs.
        all_items_dict = {}
        included_keys = []
        for fp in pdf_file_paths:
            pdf_id = generate_pdf_id(fp)
            all_items_dict[pdf_id] = {
                "key": pdf_id,
                "title": Path(fp).stem,
                "year": "n.d.",
                "authors_html": "Anon",
                "author_short": "Anon",
                "itemType": "journalArticle"  # neutral default
            }
            included_keys.append(pdf_id)

        # Re‑use the existing coding + synthesis pipeline ----------------
        main_output_dir = Path(output_dir_base) / "local_pdf_review"
        main_output_dir.mkdir(parents=True, exist_ok=True)

        # We iterate over each RQ exactly as the original implementation
        for rq_index, current_rq in enumerate(research_questions_list):
            rq_safe = f"RQ_{rq_index+1}_{re.sub(r'[^A-Za-z0-9_]+', '', current_rq[:30])}"
            rq_output_dir = main_output_dir / rq_safe
            rq_output_dir.mkdir(parents=True, exist_ok=True)

            # --- Coding ------------------------------------------------
            all_coded_notes = code_included_pdfs_chicago(
                included_keys,
                all_items_dict,
                {},                 # empty zotero_items_lookup – not needed
                [current_rq],       # single‑RQ list – function supports multi
                rq_output_dir,
                zt_client,
                ai_provider,
                ai_models,
                cache=cache,
                force_regenerate=force_regenerate_coding,
                progress_callback=progress_callback,
            )

            # The rest of the original pipeline (outline gen, narrative
            # writing, HTML rendering, etc.) is *unchanged* and therefore
            # omitted here for brevity – copy the body verbatim from the
            # original function or keep a `# …` marker if you prefer
            # diff‑style patches.
            # ----------------------------------------------------------------
            # IMPORTANT: because we changed only the *keys*, all downstream
            # helpers that depend on `parent_item_key` automatically pick up
            # the new pdf_id without any internal modifications.
            # ----------------------------------------------------------------
        return  # end of local PDF branch

    # ----------------------------------------------------------------
    # 2. ZOTERO + QDRANT WORKFLOW (unchanged) --------------------------
    # ----------------------------------------------------------------
    if workflow_type == "zotero_qdrant":
        return generate_review_from_zotero_qdrant(
            collection_name=input_data["collection_name"],
            qdrant_collection_name=input_data.get("qdrant_collection_name", "default"),
            research_questions_list=research_questions_list,
            zt_client=zt_client,
            ai_provider=ai_provider,
            ai_models=ai_models,
            output_dir_base=output_dir_base,
            template_dir=template_dir,
            cache=cache,
            force_regenerate_metadata=force_regenerate_metadata,
            force_regenerate_queries=force_regenerate_queries,
            force_regenerate_qdrant_search=force_regenerate_qdrant_search,
            force_regenerate_para_clustering=force_regenerate_para_clustering,
            force_regenerate_outline=force_regenerate_outline,
            force_regenerate_writing=force_regenerate_writing,
            progress_callback=progress_callback,
        )

    # ----------------------------------------------------------------
    # 3. Unknown workflow guard ---------------------------------------
    # ----------------------------------------------------------------
    raise NotImplementedError(f"Unknown workflow_type: {workflow_type}")
#
# def generate_literature_review_simulated(
#     # --- Workflow Selection & Data ---
#     workflow_type: str,             # 'local_pdf' or 'zotero_qdrant'
#     input_data: dict,               # Contains specific inputs based on workflow_type
#                                     # e.g., {'pdf_files': [...]} or
#                                     #       {'collection_name': '...', 'qdrant_collection_name': '...'}
#     # --- Common Parameters ---
#     research_questions_list: list,
#     ai_provider: str,
#     ai_models: dict,
#     output_dir_base: Path = LR_OUTPUT_DIR_BASE,
#     template_dir: Path = TEMPLATE_DIR_LR,
#     your_name: str = "[Your Name]",
#     your_affiliation: str = "[Your Affiliation]",
#     zt_client=None,                 # Required only for 'zotero_qdrant' workflow
#     cache: bool = True,
#     # --- Force Regenerate Flags (adapt as needed for each workflow) ---
#     force_regenerate_metadata: bool = False,      # Zotero fetch
#     force_regenerate_coding: bool = False,        # Local PDF coding
#     force_regenerate_queries: bool = False,       # Qdrant query generation
#     force_regenerate_qdrant_search: bool = False, # Qdrant search execution
#     force_regenerate_para_clustering: bool = False, # Qdrant paragraph clustering
#     force_regenerate_outline: bool = False,       # Applies to both workflows' outline steps
#     force_regenerate_writing: bool = False,       # Applies to both workflows' writing steps
#     progress_callback=None
#     ):
#     """
#     Generates AI-driven Literature Reviews using one of two workflows:
#     1. Local PDF Files: Codes PDFs, synthesizes notes.
#     2. Zotero + Qdrant: Uses Zotero metadata, searches Qdrant for paragraphs, synthesizes paragraphs.
#
#     Args:
#         workflow_type (str): 'local_pdf' or 'zotero_qdrant'.
#         input_data (dict): Dictionary containing workflow-specific inputs.
#             - For 'local_pdf': {'pdf_files': ['path/to/file1.pdf', ...]}
#             - For 'zotero_qdrant': {'collection_name': 'My Zotero Collection',
#                                     'qdrant_collection_name': 'my_qdrant_db'}
#         research_questions_list (list): List of research question strings.
#         ai_provider (str): Name of the AI provider (e.g., 'openai').
#         ai_models (dict): Dictionary mapping provider to model name (e.g., {'openai': 'gpt-4o'}).
#         output_dir_base (Path): Base directory for output files.
#         template_dir (Path): Directory containing the HTML template.
#         your_name (str): Author name for the report.
#         your_affiliation (str): Author affiliation for the report.
#         zt_client: Initialized Zotero client instance (required for 'zotero_qdrant').
#         cache (bool): Whether to use caching for intermediate steps.
#         force_regenerate_... (bool): Flags to force regeneration of specific cached steps.
#         progress_callback (callable, optional): Function to report progress (receives message, is_step_boundary).
#     """
#     start_time_main = datetime.now()
#     _emit_progress(progress_callback, f"--- Starting Literature Review Generation (Workflow: {workflow_type}) ---", False)
#
#     # ==============================================
#     # == Workflow 1: Local PDF Files              ==
#     # ==============================================
#     if workflow_type == 'local_pdf':
#         pdf_file_paths = input_data.get('pdf_files', [])
#         if not pdf_file_paths:
#             _emit_progress(progress_callback, "ERROR: No PDF file paths provided for 'local_pdf' workflow.", True)
#             return
#
#         _emit_progress(progress_callback, f"Objective: Process {len(pdf_file_paths)} local PDFs for {len(research_questions_list)} RQs.", False)
#
#         # --- Setup Output Dirs ---
#         main_output_dir = Path(output_dir_base) / "local_pdf_review"
#         main_output_dir.mkdir(parents=True, exist_ok=True)
#         _emit_progress(progress_callback, f"Status: Main Output Dir: {main_output_dir.resolve()}", False)
#
#         # --- Step LP1: Create Dummy Metadata & Code PDFs ---
#         _emit_progress(progress_callback, "\nStep LP1: Coding provided PDF files against ALL RQs...", False)
#         all_coded_notes_local = {}
#         dummy_all_items_dict = {}
#         dummy_zotero_lookup = {}
#         pdf_keys_list = []
#
#         for i, pdf_path_str in enumerate(pdf_file_paths):
#             pdf_path = Path(pdf_path_str)
#             if not pdf_path.is_file():
#                 _emit_progress(progress_callback, f"WARN: PDF file not found, skipping: {pdf_path_str}", False)
#                 continue
#
#             pdf_key = f"localpdf_{i+1}_{pdf_path.stem}"
#             pdf_keys_list.append(pdf_key)
#             dummy_metadata = { # Create basic metadata needed by coding/footnote functions
#                 'key': pdf_key, 'title': pdf_path.stem, 'year': 'N/A',
#                 'authors_html': 'Unknown', 'author_short': 'Unknown',
#                 'abstract': '', 'url': '', 'doi': '', 'itemType': 'document',
#                 'creators': [], 'publicationTitle': '', 'bookTitle': '',
#                 'volume': '', 'issue': '', 'pages': '', 'publisher': '',
#                 'place': '', 'date': '', 'accessDate': ''
#                 # Add more N/A fields if needed by generate_chicago_citation_elements
#             }
#             dummy_all_items_dict[pdf_key] = dummy_metadata
#             # Cannot populate dummy_zotero_lookup effectively here
#
#             _emit_progress(progress_callback, f"\nHandling PDF {i + 1}/{len(pdf_file_paths)}: {pdf_path.name} ({pdf_key})", False)
#             coded_notes_result = code_pdf_content_chicago(
#                  pdf_path=pdf_path, parent_item_key=pdf_key, item_metadata=dummy_metadata,
#                  research_questions_list=research_questions_list, output_dir=main_output_dir,
#                  ai_provider=ai_provider, ai_models=ai_models, cache=cache,
#                  progress_callback=progress_callback
#                  # force_regenerate flag not directly applicable here, controlled by top-level force_regenerate_coding
#             )
#             all_coded_notes_local[pdf_key] = coded_notes_result
#
#         final_coded_count = sum(1 for notes in all_coded_notes_local.values() if isinstance(notes, list) and notes)
#         _emit_progress(progress_callback, f"Output: Local PDF Coding step complete. Resulted in notes for {final_coded_count} PDFs.", True)
#         if not any(notes for notes in all_coded_notes_local.values()):
#             _emit_progress(progress_callback, "FATAL ERROR: Local PDF coding yielded no notes. Aborting.", True); return
#
#         # --- LOOP START: Process Each RQ (Local PDFs) ---
#         _emit_progress(progress_callback, "\n--- Starting RQ-Specific Synthesis Phase (Local PDFs) ---", False)
#         for rq_index, current_rq in enumerate(research_questions_list):
#             # ... (Setup RQ vars, output dir as before) ...
#             rq_start_time = datetime.now()
#             final_sections_rq = []
#             written_sections_final_rq = {}
#             final_footnote_texts_rq = {}
#             synthesis_successful = True
#             rq_safe_name = f"RQ_{rq_index+1}_{re.sub(r'[^a-zA-Z0-9_]+', '', current_rq[:30])}"
#             rq_output_dir = main_output_dir / rq_safe_name
#             rq_output_dir.mkdir(parents=True, exist_ok=True)
#             _emit_progress(progress_callback, f"\n{'='*10} STARTING RQ {rq_index+1}/{len(research_questions_list)} (Local PDFs) {'='*10}", False)
#             _emit_progress(progress_callback, f"RQ Objective: Synthesize notes for: '{current_rq}'", False)
#             _emit_progress(progress_callback, f"RQ Output Dir: {rq_output_dir}", False)
#
#             force_regen_rq_synthesis = force_regenerate_outline or force_regenerate_writing
#             force_regen_rq_writing_paras = force_regenerate_writing
#             # Handle cache deletion based on flags (paths defined as in original function)
#             rq_kw_cluster_assign_cache_file = rq_output_dir / "keyword_cluster_section_assignments.json"
#             rq_argument_clusters_cache_file = rq_output_dir / "argument_clusters_cache.json"
#             rq_written_paragraphs_cache_file = rq_output_dir / "written_paragraphs_cache.json"
#             if force_regen_rq_synthesis:
#                 if rq_kw_cluster_assign_cache_file.is_file(): rq_kw_cluster_assign_cache_file.unlink(missing_ok=True)
#                 if rq_argument_clusters_cache_file.is_file(): rq_argument_clusters_cache_file.unlink(missing_ok=True)
#             if force_regen_rq_writing_paras and rq_written_paragraphs_cache_file.is_file():
#                 rq_written_paragraphs_cache_file.unlink(missing_ok=True)
#
#
#             # --- Step LP2a: Filter Notes ---
#             _emit_progress(progress_callback, f"\nStep LP2a (RQ {rq_index+1}): Filtering notes...", False)
#             filtered_notes_for_rq = defaultdict(list); total_relevant_notes_count = 0
#             for item_key, notes_list in all_coded_notes_local.items():
#                 if isinstance(notes_list, list):
#                     for note in notes_list:
#                         if isinstance(note, dict) and rq_index in note.get('relevant_rq_indices', []): filtered_notes_for_rq[item_key].append(note); total_relevant_notes_count += 1
#             _emit_progress(progress_callback, f"Output: Found {total_relevant_notes_count} relevant notes.", True)
#             if not filtered_notes_for_rq: _emit_progress(progress_callback, f"WARN: No relevant notes. Skipping RQ {rq_index+1}."); continue
#
#             # --- Step LP2b: Keyword Grouping ---
#             _emit_progress(progress_callback, f"\nStep LP2b (RQ {rq_index+1}): Grouping notes by keywords...", False)
#             notes_by_keyword_cluster_rq = group_notes_by_keywords(filtered_notes_for_rq, progress_callback=progress_callback)
#             if not notes_by_keyword_cluster_rq: _emit_progress(progress_callback, f"WARN: No keyword clusters formed. Skipping RQ {rq_index+1}."); continue
#
#             # --- Step LP2c: Generate Themed Outline ---
#             _emit_progress(progress_callback, f"\nStep LP2c (RQ {rq_index+1}): Generating themed outline from keywords...", False)
#             final_sections_rq = generate_outline_from_keywords(
#                 notes_by_keyword_cluster_rq, current_rq, rq_output_dir,
#                 ai_provider, ai_models, progress_callback=progress_callback)
#             if not final_sections_rq: _emit_progress(progress_callback, f"ERROR: Failed outline generation. Skipping RQ {rq_index+1}."); continue
#
#             # --- Step LP3: Assign Clusters to Sections ---
#             _emit_progress(progress_callback, f"\nStep LP3 (RQ {rq_index+1}): Assigning keyword clusters to sections...", False)
#             notes_by_section_theme_rq = assign_clusters_to_sections(
#                 notes_by_keyword_cluster_rq, final_sections_rq, rq_output_dir,
#                 ai_provider, ai_models, cache=cache, force_regenerate=force_regen_rq_synthesis,
#                 progress_callback=progress_callback)
#             if not notes_by_section_theme_rq: _emit_progress(progress_callback, f"WARN: No notes assigned to sections. Skipping arg clustering."); continue
#
#             # --- Step LP3b: Cluster Arguments ---
#             _emit_progress(progress_callback, f"\nStep LP3b (RQ {rq_index+1}): Identifying and clustering arguments within sections...", False)
#             notes_by_section_argument_rq = {}
#             # ... (load/generate argument clusters using cluster_arguments_within_section, cache logic) ...
#             # Make sure cluster_arguments_within_section is called with progress_callback
#             cached_clusters_rq = None
#             if cache and not force_regen_rq_synthesis and rq_argument_clusters_cache_file.exists():
#                  cached_clusters_rq = load_cache(rq_argument_clusters_cache_file)
#                  if isinstance(cached_clusters_rq, dict): notes_by_section_argument_rq = cached_clusters_rq; _emit_progress(progress_callback,"  Status: Loaded argument clusters from cache.",False)
#                  else: _emit_progress(progress_callback,"  WARN: Invalid argument cluster cache. Regenerating.",False)
#
#             sections_to_cluster_args_rq = [s for s in final_sections_rq if s not in notes_by_section_argument_rq]
#             if sections_to_cluster_args_rq:
#                  _emit_progress(progress_callback,f"  Executing: Generating argument clusters for {len(sections_to_cluster_args_rq)} sections...",False)
#                  for section_title in sections_to_cluster_args_rq:
#                       notes_in_theme_rq = notes_by_section_theme_rq.get(section_title, [])
#                       if not notes_in_theme_rq: notes_by_section_argument_rq[section_title] = {}; continue
#                       argument_clusters = cluster_arguments_within_section(
#                            section_title, notes_in_theme_rq, current_rq, rq_output_dir,
#                            ai_provider, ai_models, progress_callback=progress_callback # Pass callback
#                       )
#                       notes_by_section_argument_rq[section_title] = argument_clusters
#                  if cache: save_cache(notes_by_section_argument_rq, rq_argument_clusters_cache_file)
#             _emit_progress(progress_callback, f"Output: Identified argument clusters for {len(notes_by_section_argument_rq)} sections.", True)
#             if not any(notes_by_section_argument_rq.values()): _emit_progress(progress_callback, f"WARN: Argument clustering yielded no results. Skipping writing."); continue
#
#
#             # --- Step LP4: Write Paragraphs ---
#             _emit_progress(progress_callback, f"\nStep LP4 (RQ {rq_index+1}): Writing narrative paragraphs per argument...", False)
#             written_sections_text_cites_rq = {}
#             written_paragraphs_rq = {} # Local var for this RQ's paragraphs
#             # ... (load/generate paragraphs using write_narrative_paragraph, passing dummy_all_items_dict, dummy_zotero_lookup, cache logic) ...
#             cached_paragraphs_rq = None
#             if cache and not force_regen_rq_writing_paras and rq_written_paragraphs_cache_file.exists():
#                  cached_paragraphs_rq = load_cache(rq_written_paragraphs_cache_file)
#                  if isinstance(cached_paragraphs_rq, dict): written_paragraphs_rq = {eval(k): v for k, v in cached_paragraphs_rq.items()}; _emit_progress(progress_callback,"  Status: Loaded written paragraphs from cache.",False)
#                  else: _emit_progress(progress_callback,"  WARN: Invalid written paragraphs cache. Regenerating.",False)
#
#             new_paragraphs_generated = False
#             for section_title in final_sections_rq:
#                 argument_clusters_for_section = notes_by_section_argument_rq.get(section_title, {})
#                 section_paragraphs_content = []
#                 written_sections_text_cites_rq[section_title] = f"[No content generated yet for '{section_title}']" # Default
#                 if not argument_clusters_for_section: written_sections_text_cites_rq[section_title] = f"[No arguments identified for '{section_title}'.]"; continue
#
#                 sorted_arguments = sorted(argument_clusters_for_section.keys())
#                 for argument_summary in sorted_arguments:
#                      notes_for_argument = argument_clusters_for_section[argument_summary]; paragraph_tuple_key = (section_title, argument_summary)
#                      if paragraph_tuple_key in written_paragraphs_rq: paragraph_content = written_paragraphs_rq[paragraph_tuple_key]
#                      else:
#                          if not notes_for_argument: paragraph_content = ""; continue
#                          paragraph_content = write_narrative_paragraph(
#                               section_title, argument_summary, notes_for_argument,
#                               dummy_all_items_dict, # Pass dummy
#                               dummy_zotero_lookup, # Pass dummy
#                               current_rq, rq_output_dir, ai_provider, ai_models,
#                               progress_callback=progress_callback # Pass callback
#                          )
#                          if paragraph_content: written_paragraphs_rq[paragraph_tuple_key] = paragraph_content; new_paragraphs_generated = True
#                      if paragraph_content and not paragraph_content.startswith("[ERROR"): section_paragraphs_content.append(paragraph_content)
#                      elif paragraph_content.startswith("[ERROR"): section_paragraphs_content.append(paragraph_content) # Include error in output
#
#                 if section_paragraphs_content: written_sections_text_cites_rq[section_title] = "\n\n".join(section_paragraphs_content)
#
#             if cache and new_paragraphs_generated: cache_to_save = {str(k): v for k, v in written_paragraphs_rq.items()}; save_cache(cache_to_save, rq_written_paragraphs_cache_file); _emit_progress(progress_callback,f"  Status: Saved updated paragraph cache for RQ {rq_index+1}.",False)
#             elif cache and not new_paragraphs_generated: _emit_progress(progress_callback,"  Status: No new paragraphs generated, skipping paragraph cache save.",False)
#
#             _emit_progress(progress_callback, f"Output: Wrote {len(written_paragraphs_rq)} paragraphs across sections.", True)
#             if not any(content and not content.startswith("[") for content in written_sections_text_cites_rq.values()):
#                  _emit_progress(progress_callback, f"WARN: Writing step produced no valid content for RQ {rq_index+1}. Proceeding without body text.",False)
#                  synthesis_successful = False
#
#
#             # --- Step LP5: Process Placeholders/Footnotes ---
#             _emit_progress(progress_callback, f"\nStep LP5 (RQ {rq_index+1}): Generating Footnotes (Local PDFs)...", False)
#             written_sections_final_rq, final_footnote_texts_rq = process_text_and_generate_footnotes(
#                 written_sections_text_cites_rq,
#                 all_coded_notes_local, # Use notes dict for quote lookup
#                 dummy_zotero_lookup,   # Use dummy for citation formatting
#                 progress_callback=progress_callback
#             )
#             _emit_progress(progress_callback, f"Output: Generated {len(final_footnote_texts_rq)} footnote entries (basic format expected).", True)
#
#             # --- Step LP6: Generate Methodology, Narratives, Limitations ---
#             _emit_progress(progress_callback, f"\nStep LP6 (RQ {rq_index+1}): Generating Final Sections (Local PDFs)...", False)
#             methodology_section_text = f"""
#             <p>This literature review was conducted based on a collection of {len(pdf_file_paths)} PDF documents provided directly for analysis. The full text of these documents was processed to extract relevant information pertaining to the research question: "{current_rq}".</p>
#             <p>A detailed coding process was applied to identify key concepts, arguments, and evidence within the texts. These coded segments ({total_relevant_notes_count} relevant notes identified) were then synthesized thematically. The main themes identified were: {', '.join(final_sections_rq if final_sections_rq else ['N/A'])}.</p>
#             <p>The synthesis involved grouping coded information by theme and specific arguments, followed by the generation of a narrative discussion for each section.</p>
#             """ # Basic text
#             _emit_progress(progress_callback, "Status: Generated basic Methodology text.", False)
#
#             ai_abstract_lr, ai_introduction_lr, ai_conclusion_lr = generate_final_narratives(
#                 current_rq, final_sections_rq, written_sections_final_rq if synthesis_successful else {},
#                 rq_output_dir, ai_provider, ai_models, progress_callback=progress_callback
#             )
#             ai_limitations_lr = generate_limitations_section(
#                 research_question=current_rq, topic=f"Review of Provided PDFs (RQ {rq_index+1})",
#                 output_dir=rq_output_dir, ai_provider=ai_provider, ai_models=ai_models,
#                 progress_callback=progress_callback,
#                 num_items_screened=len(pdf_file_paths), num_items_included=final_coded_count
#             )
#             _emit_progress(progress_callback, "Output: Final narrative sections generated.", True)
#
#             # --- Step LP7: Assemble & Render ---
#             _emit_progress(progress_callback, f"\nStep LP7 (RQ {rq_index+1}): Assembling context and rendering HTML...", False)
#             references_list_lr = [f"<li>{dummy_all_items_dict[key]['title']} (Filename: {Path(input_data['pdf_files'][pdf_keys_list.index(key)]).name})</li>" if key in dummy_all_items_dict else f"<li>Unknown Reference: {key}</li>" for key in pdf_keys_list] # Basic list
#
#             context = {
#                  'topic': f"Review of Provided PDFs - RQ {rq_index+1}", 'research_question': current_rq,
#                  'authors_list': your_name, 'affiliation': your_affiliation, 'generation_date': rq_start_time.strftime('%Y-%m-%d %H:%M:%S'),
#                  'criteria': None, 'num_items_processed': len(pdf_file_paths), 'num_items_screened': len(pdf_file_paths),
#                  'num_items_included': final_coded_count, 'num_pdfs_coded': final_coded_count,
#                  'generated_themes': final_sections_rq if final_sections_rq else [],
#                  'methodology_text': methodology_section_text, 'ai_limitations': ai_limitations_lr,
#                  'ai_abstract': ai_abstract_lr, 'ai_introduction': ai_introduction_lr,
#                  'generated_sections': written_sections_final_rq if written_sections_final_rq else {},
#                  'ai_conclusion': ai_conclusion_lr, 'footnote_list_texts': final_footnote_texts_rq if final_footnote_texts_rq else {},
#                  'references_list': references_list_lr # Use the basic list
#             }
#             report_safe_name = re.sub(r'[^\w\-]+', '_', f"Local_PDFs_Review_RQ_{rq_index+1}")
#             rq_output_html_file = rq_output_dir / f"{report_safe_name}.html"
#             env = Environment(loader=FileSystemLoader(template_dir), autoescape=False)
#             try:
#                 template = env.get_template("literature_review.html")
#                 rendered_html = template.render(context)
#                 with open(rq_output_html_file, 'w', encoding='utf-8') as f: f.write(rendered_html)
#                 _emit_progress(progress_callback, f"Output: HTML report generated: {rq_output_html_file.resolve()}", True)
#             except Exception as e:
#                  _emit_progress(progress_callback, f"*** ERROR rendering template for RQ {rq_index+1}: {e}", True)
#             _emit_progress(progress_callback, f"--- RQ {rq_index+1} (Local PDFs) Finished. Duration: {datetime.now() - rq_start_time} ---", False)
#         # --- End RQ Loop (Local PDFs) ---




# --- Workflow 2: NEW Function for Zotero + Qdrant ---
# def generate_review_from_zotero_qdrant(
#     collection_name,
#     qdrant_collection_name, # New parameter
#     research_questions_list,
#     zt_client, # Should not be None
#     ai_provider,
#     ai_models,
#     output_dir_base=LR_OUTPUT_DIR_BASE,
#     template_dir=TEMPLATE_DIR_LR,
#     your_name="[Your Name]", your_affiliation="[Your Affiliation]",
#     cache=True, force_regenerate_metadata=False, # Add specific flags if needed
#     force_regenerate_queries=False, force_regenerate_qdrant_search=False,
#     force_regenerate_para_clustering=False, force_regenerate_outline=False,
#     force_regenerate_writing=False,
#     progress_callback=None,
#     manual_mode=False
#     ):
#     """
#     Generates Literature Reviews using Zotero metadata and Qdrant paragraphs.
#     """
#     _emit_progress(progress_callback, f"--- Starting Zotero+Qdrant Literature Review Generation ---", False)
#     _emit_progress(progress_callback, f"Objective: Process Zotero collection '{collection_name}' / Qdrant collection '{qdrant_collection_name}' for {len(research_questions_list)} RQs.", False)
#     start_time_main = datetime.now()
#
#     # --- Setup Output Dirs ---
#     base_safe_collection_name = re.sub(r'[^\w\-]+', '_', collection_name)
#     main_output_dir = Path(output_dir_base) / base_safe_collection_name # Use Zotero name for main dir
#     main_output_dir.mkdir(parents=True, exist_ok=True)
#     _emit_progress(progress_callback, f"Status: Main Output & Cache Dir: {main_output_dir.resolve()}", False)
#
#     # --- Step B1: Fetch Zotero Metadata ---
#     _emit_progress(progress_callback, "\nStep B1: Fetching Zotero Metadata...", False)
#     zotero_items_cache_file = main_output_dir / "zotero_items_cache.json"
#     zotero_full_data = None
#     if cache and not force_regenerate_metadata and zotero_items_cache_file.exists():
#         zotero_full_data = load_cache(zotero_items_cache_file)
#         if zotero_full_data: _emit_progress(progress_callback, f"Status: Loaded {len(zotero_full_data)} Zotero items from cache.", False)
#
#     if not zotero_full_data:
#         try:
#             zotero_full_data = zt_client.get_all_items(collection_name, cache=False) # Fetch fresh if not cached/forced
#             if zotero_full_data and cache: save_cache(zotero_full_data, zotero_items_cache_file)
#             _emit_progress(progress_callback, f"Status: Fetched {len(zotero_full_data)} Zotero items.", False)
#         except Exception as e:
#             _emit_progress(progress_callback, f"ERROR: Failed to fetch Zotero data: {e}", True)
#             return
#     if not zotero_full_data: _emit_progress(progress_callback, "ERROR: No Zotero items found/fetched.", True); return
#
#     # Process metadata and create lookup (similar to original Step 1)
#     processed_items = []
#     # ... (metadata processing loop - see original function) ...
#     for item in zotero_full_data:
#         data = item.get('data', {})
#         # Extract fields needed later (key, title, year, authors, abstract, itemType, etc.)
#         # Ensure you get data needed for generate_chicago_citation_elements
#         year_val = 'n.d.' # Implement parse_zotero_year if needed
#         authors_val = 'Anon' # Implement format_authors_html if needed
#         author_short_name = 'Anon'
#         processed_items.append({
#             'key': item.get('key', 'N/A'), 'title': data.get('title', 'N/A'), 'year': year_val,
#             'authors_html': authors_val, 'author_short': author_short_name,
#             'abstract': data.get('abstractNote', ''), # Need abstract for keyword analysis?
#             'tags': data.get('tags', []), # Get Zotero tags
#              # Include all fields needed by generate_chicago_citation_elements
#             'creators': data.get('creators', []), 'itemType': data.get('itemType'),
#             'publicationTitle': data.get('publicationTitle',''),'bookTitle': data.get('bookTitle',''),
#             'volume': data.get('volume',''), 'issue': data.get('issue',''), 'pages': data.get('pages', ''),
#             'publisher': data.get('publisher',''), 'place': data.get('place',''),
#             'date': data.get('date'), 'DOI': data.get('DOI',''), 'url': data.get('url',''),
#             'accessDate': data.get('accessDate','')
#         })
#
#     df_items = pd.DataFrame(processed_items)
#     all_items_dict = {item['key']: item for item in processed_items if item['key'] != 'N/A'}
#     # CRITICAL: Build the lookup needed for footnote generation later
#     zotero_items_lookup = {item.get('key'): item for item in zotero_full_data if item.get('key')}
#     _emit_progress(progress_callback, f"Output: Processed metadata for {len(df_items)} items.", True)
#
#     # --- LOOP START: Process Each RQ ---
#     _emit_progress(progress_callback, "\n--- Starting RQ-Specific Synthesis Phase (Zotero+Qdrant) ---", False)
#     for rq_index, current_rq in enumerate(research_questions_list):
#         rq_start_time = datetime.now()
#         # ... (Initialize RQ-specific result variables) ...
#         final_sections_rq = []
#         written_sections_final_rq = {}
#         final_footnote_texts_rq = {}
#         synthesis_successful = True
#
#         # --- Setup RQ Output Dir ---
#         rq_safe_name = f"RQ_{rq_index+1}_{re.sub(r'[^a-zA-Z0-9_]+', '', current_rq[:30])}"
#         rq_output_dir = main_output_dir / rq_safe_name
#         rq_output_dir.mkdir(parents=True, exist_ok=True)
#         _emit_progress(progress_callback, f"\n{'='*10} STARTING RQ {rq_index+1}/{len(research_questions_list)} (Zotero+Qdrant) {'='*10}", False)
#         # ... (Log RQ objective, output dir) ...
#
#         # --- Step B2: Generate Themes/Keywords for Querying ---
#         # Option 1: Use LLM directly on RQ to get keywords
#         # Option 2: Analyze Zotero metadata (titles, abstracts, tags) - complex
#         # Let's use Option 1 for simplicity first.
#         _emit_progress(progress_callback, f"\nStep B2 (RQ {rq_index+1}): Generating search keywords from RQ...", False)
#         keywords_context = f"Research Question: {current_rq}\n\nTask: Extract the 5-10 most important keywords or keyphrases from the research question that would be suitable for searching an academic paragraph database (like Qdrant). Focus on specific concepts, actors, actions, or technologies mentioned. Output *only* a JSON list of strings."
#         search_keywords = []
#         try:
#             # Use a simple prompt key
#             llm_response = call_models(ai_provider, ai_models, keywords_context, "extract_rq_keywords", base_output_dir=rq_output_dir)
#             response_text = get_ai_response_text(llm_response, "Extract RQ Keywords")
#             parsed_list = parse_json_list_from_llm(response_text, "RQ Keywords")
#             if parsed_list and isinstance(parsed_list, list) and all(isinstance(s, str) for s in parsed_list):
#                 search_keywords = parsed_list
#                 _emit_progress(progress_callback, f"Output: Generated keywords: {search_keywords}", True)
#             else:
#                  _emit_progress(progress_callback, "WARN: Failed to parse keywords from LLM response. Using RQ directly.", True)
#                  search_keywords = [current_rq] # Fallback
#         except Exception as e:
#             _emit_progress(progress_callback, f"ERROR generating keywords: {e}. Using RQ directly.", True)
#             search_keywords = [current_rq] # Fallback
#
#         if not search_keywords: continue # Skip RQ if no keywords/fallback
#
#         # --- Step B3: Generate Qdrant Query (Simple AND query for now) ---
#         # The 'getting_query' prompt is complex. Let's start simpler.
#         _emit_progress(progress_callback, f"\nStep B3 (RQ {rq_index+1}): Generating Qdrant search query...", False)
#         # Simple approach: Join keywords with AND, maybe add quotes for phrases
#         qdrant_query = " AND ".join([f'"{kw}"' if ' ' in kw else kw for kw in search_keywords])
#         # More advanced: Could call LLM with `getting_query` prompt, providing `search_keywords`
#         # query_gen_context = f"Keywords/Themes: {json.dumps(search_keywords)}\n\nTask: Create an advanced boolean query suitable for a semantic database search based on these keywords/themes..."
#         # ... call LLM with adapted getting_query prompt ...
#         _emit_progress(progress_callback, f"Output: Generated Qdrant query: '{qdrant_query}'", True)
#
#         # --- Step B4: Search Qdrant ---
#         _emit_progress(progress_callback, f"\nStep B4 (RQ {rq_index+1}): Searching Qdrant collection '{qdrant_collection_name}'...", False)
#         qdrant_results_cache_file = rq_output_dir / f"qdrant_results_{re.sub(r'[^a-zA-Z0-9_]+', '', qdrant_query[:50])}.json"
#         retrieved_paragraphs = []
#         if cache and not force_regenerate_qdrant_search and qdrant_results_cache_file.exists():
#              retrieved_paragraphs = load_cache(qdrant_results_cache_file)
#              if retrieved_paragraphs: _emit_progress(progress_callback, f"Status: Loaded {len(retrieved_paragraphs)} paragraphs from Qdrant cache.", False)
#
#         if not retrieved_paragraphs:
#              try:
#                  # Call the imported function
#                  # Adjust per_page? Get all results initially? The function seems designed for pagination UI.
#                  # Let's try getting a large number on page 1 first. Need to see function details.
#                  # Assuming it returns all relevant paragraphs matching threshold without strict pagination needed here.
#                  paginated_results, total_pages, total_paragraphs, total_documents = search_paragraphs_by_query(
#                      collection_name=qdrant_collection_name,
#                      query=qdrant_query,
#                      use_cache=cache, # Let the search function handle its *own* cache
#                      pickle_file_path=str(main_output_dir / "qdrant_search_cache.pkl"), # Path for its internal cache
#                      score_threshold=0.3, # Adjust threshold as needed
#                      per_page=1000, # Try to get many results
#                      page=1
#                  )
#                  retrieved_paragraphs = paginated_results # Use the results from the function
#                  if retrieved_paragraphs and cache: save_cache(retrieved_paragraphs, qdrant_results_cache_file) # Save to our RQ-specific cache
#                  _emit_progress(progress_callback, f"Status: Qdrant search returned {len(retrieved_paragraphs)} paragraphs (from {total_documents} documents).", False)
#
#              except Exception as e:
#                   _emit_progress(progress_callback, f"ERROR searching Qdrant: {e}", True)
#                   continue # Skip RQ on Qdrant error
#
#         if not retrieved_paragraphs: _emit_progress(progress_callback, "WARN: Qdrant search yielded no relevant paragraphs for this RQ.", True); continue
#         _emit_progress(progress_callback, f"Output: Retrieved {len(retrieved_paragraphs)} relevant paragraphs from Qdrant.", True)
#
#         # --- Step B5: Cluster Retrieved Paragraphs ---
#         # This needs a new function, let's define a placeholder call
#         _emit_progress(progress_callback, f"\nStep B5 (RQ {rq_index+1}): Clustering {len(retrieved_paragraphs)} Qdrant paragraphs...", False)
#         # paragraphs_by_theme = cluster_qdrant_paragraphs(retrieved_paragraphs, current_rq, rq_output_dir, ai_provider, ai_models, cache, force_regenerate_para_clustering, progress_callback)
#
#         # --- Placeholder --- Assign all paragraphs to the RQ itself for now ---
#         paragraphs_by_theme = {current_rq: retrieved_paragraphs}
#         final_sections_rq = [current_rq] # Use RQ as the single section
#         _emit_progress(progress_callback, "Status: Using RQ as the main theme (Paragraph clustering placeholder).", False)
#         # --- End Placeholder ---
#         if not paragraphs_by_theme: _emit_progress(progress_callback, "WARN: Paragraph clustering failed.", True); continue
#         _emit_progress(progress_callback, f"Output: Clustered paragraphs into {len(paragraphs_by_theme)} themes.", True)
#
#         # --- Step B6: Refine Outline (Optional - Placeholder) ---
#         # final_sections_rq = refine_outline_from_paragraph_themes(paragraphs_by_theme, ...)
#         # _emit_progress(progress_callback, f"Output: Refined outline: {final_sections_rq}", True)
#
#         # --- Step B7: Write Narrative (from Paragraphs) ---
#         _emit_progress(progress_callback, f"\nStep B7 (RQ {rq_index+1}): Writing narrative from Qdrant paragraphs...", False)
#         written_sections_text_cites_rq = {}
#         # Adapt the writing loop
#         for section_title in final_sections_rq:
#             paragraphs_for_section = paragraphs_by_theme.get(section_title, [])
#             if not paragraphs_for_section: continue
#
#             # Here, we might want to SUB-CLUSTER paragraphs within a theme by argument,
#             # similar to the note clustering. Or write one large section.
#             # Let's try writing one large section per theme for now.
#
#             # --- Placeholder: Call a new writing function ---
#             # section_content = write_narrative_from_paragraphs(
#             #      section_title, paragraphs_for_section, current_rq, zotero_items_lookup,
#             #      rq_output_dir, ai_provider, ai_models, progress_callback
#             # )
#             # written_sections_text_cites_rq[section_title] = section_content
#             # --- End Placeholder ---
#
#             # --- Simplified Placeholder ---
#             para_texts = [f"<p>{html.escape(p.get('paragraph_text', ''))} {{{{CITE|KEY={p.get('metadata',{}).get('citation_key','NA')}|PAGE=n.p.}}</p>" for p in paragraphs_for_section]
#             written_sections_text_cites_rq[section_title] = "\n".join(para_texts)
#             _emit_progress(progress_callback, f"Status: Generated placeholder content for section '{section_title}'.", False)
#             # --- End Simplified Placeholder ---
#
#         _emit_progress(progress_callback, f"Output: Generated narrative content for {len(written_sections_text_cites_rq)} sections.", True)
#
#
#         # --- Step B8: Process Footnotes ---
#         _emit_progress(progress_callback, f"\nStep B8 (RQ {rq_index+1}): Generating footnotes from Qdrant citations...", False)
#         # This requires the Zotero lookup built in Step B1
#         written_sections_final_rq, final_footnote_texts_rq = process_text_and_generate_footnotes(
#             written_sections_text_cites_rq,
#             {}, # Pass empty dict for 'all_coded_notes' as quotes aren't stored the same way
#             zotero_items_lookup # Use the real Zotero lookup
#             # progress_callback=progress_callback
#         )
#         _emit_progress(progress_callback, f"Output: Generated {len(final_footnote_texts_rq)} footnote entries.", True)
#
#         # --- Step B9: Generate Methodology, Narratives, Limitations ---
#         _emit_progress(progress_callback, f"\nStep B9 (RQ {rq_index+1}): Generating Final Sections (Zotero+Qdrant)...", False)
#         # Methodology text needs to reflect this workflow
#         methodology_section_text = f"""
#         <p>This literature review addressed the research question: "{current_rq}". The process began by identifying an initial set of {len(zotero_full_data)} relevant sources from the '{collection_name}' Zotero collection.</p>
#         <p>Keywords derived from the research question were used to formulate queries for a semantic search within the '{qdrant_collection_name}' Qdrant database, which contains paragraph-level indexed content from relevant literature. This search retrieved {len(retrieved_paragraphs)} paragraphs deemed most relevant to the query.</p>
#         <p>The retrieved paragraphs were then analyzed and synthesized thematically. The main themes identified were: {', '.join(final_sections_rq if final_sections_rq else ['N/A'])}.</p>
#         <p>A narrative discussion was generated for each theme based on the content of the corresponding paragraphs, integrating findings and citing the original sources.</p>
#         """
#         _emit_progress(progress_callback, "Status: Generated Methodology text for Qdrant workflow.", False)
#
#         # Generate Abstract, Intro, Conclusion, Limitations
#         ai_abstract_lr, ai_introduction_lr, ai_conclusion_lr = generate_final_narratives(
#             current_rq, final_sections_rq, written_sections_final_rq if synthesis_successful else {},
#             rq_output_dir, ai_provider, ai_models, progress_callback=progress_callback
#         )
#         ai_limitations_lr = generate_limitations_section(
#             research_question=current_rq, topic=f"{collection_name} / {qdrant_collection_name} (RQ {rq_index+1})",
#             output_dir=rq_output_dir, ai_provider=ai_provider, ai_models=ai_models,
#             progress_callback=progress_callback,
#             # Adjust kwargs if needed, e.g., pass Qdrant result counts
#             num_items_screened=len(retrieved_paragraphs), num_items_included=total_documents if 'total_documents' in locals() else len(retrieved_paragraphs)
#         )
#         _emit_progress(progress_callback, "Output: Final narrative sections generated.", True)
#
#         # --- Step B10: Assemble & Render ---
#         _emit_progress(progress_callback, f"\nStep B10 (RQ {rq_index+1}): Assembling context and rendering HTML...", False)
#         # Generate Bibliography - Use citation keys found in Qdrant results
#         cited_keys = set(p.get('metadata', {}).get('citation_key') for p in retrieved_paragraphs if p.get('metadata', {}).get('citation_key'))
#         references_list_lr = []
#         # Sort keys based on Zotero data if available
#         sorted_cited_keys = sorted(
#             [k for k in cited_keys if k in zotero_items_lookup],
#             key=lambda k: (
#                 (zotero_items_lookup[k].get('data', {}).get('creators', [{}])[0].get('lastName', '').lower()
#                  if zotero_items_lookup[k].get('data', {}).get('creators') else 'zzzz'),
#                 zotero_items_lookup[k].get('data', {}).get('year', 9999) # Assuming year is processed
#             )
#         )
#         for key in sorted_cited_keys:
#             item_full_data = zotero_items_lookup.get(key);
#             if item_full_data:
#                 try:
#                     citation_elements = generate_chicago_citation_elements(item_full_data) # Use the detailed Zotero data
#                     references_list_lr.append(citation_elements['bib_entry'])
#                 except Exception as e: references_list_lr.append(f"[Error processing reference for {key}: {e}]")
#             else: references_list_lr.append(f"[Missing Zotero data for reference {key}]")
#
#         context = {
#             'topic': f"{collection_name} / {qdrant_collection_name} - RQ {rq_index+1}", 'research_question': current_rq,
#             'authors_list': your_name, 'affiliation': your_affiliation,
#             'generation_date': rq_start_time.strftime('%Y-%m-%d %H:%M:%S'),
#             # 'criteria': None, # No explicit criteria step
#             'num_items_processed': len(zotero_full_data), # Initial Zotero count
#             'num_items_screened': len(retrieved_paragraphs), # Paragraphs retrieved
#             'num_items_included': total_documents if 'total_documents' in locals() else len(cited_keys), # Docs contributing paragraphs
#             # 'num_pdfs_coded': 0, # No PDFs coded
#             'generated_themes': final_sections_rq if final_sections_rq else [],
#             'methodology_text': methodology_section_text,
#             'ai_limitations': ai_limitations_lr,
#             'ai_abstract': ai_abstract_lr,
#             'ai_introduction': ai_introduction_lr,
#             'generated_sections': written_sections_final_rq if written_sections_final_rq else {},
#             'ai_conclusion': ai_conclusion_lr,
#             'footnote_list_texts': final_footnote_texts_rq if final_footnote_texts_rq else {},
#             'references_list': references_list_lr
#         }
#
#         # Render HTML
#         rq_output_html_file = rq_output_dir / f"{base_safe_collection_name}_{rq_safe_name}_review.html"
#         env = Environment(loader=FileSystemLoader(template_dir), autoescape=False)
#         # ... (render logic) ...
#         try:
#             template = env.get_template("literature_review.html")
#             rendered_html = template.render(context)
#             with open(rq_output_html_file, 'w', encoding='utf-8') as f: f.write(rendered_html)
#             _emit_progress(progress_callback, f"Output: HTML report generated: {rq_output_html_file.resolve()}", True)
#         except Exception as e:
#              _emit_progress(progress_callback, f"*** ERROR rendering template for RQ {rq_index+1}: {e}", True)
#
#
#     # --- End of RQ Loop ---
#     main_end_time = datetime.now()
#     _emit_progress(progress_callback, f"\n{'='*20} ZOTERO+QDRANT REVIEW FINISHED {'='*20}", False)
#     _emit_progress(progress_callback, f"Total time elapsed: {main_end_time - start_time_main}", True)
