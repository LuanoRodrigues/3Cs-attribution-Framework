from typing import List, Optional, Tuple, Set, Dict

import time
import re

from selenium.webdriver.chrome.webdriver import WebDriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException, ElementClickInterceptedException, \
    StaleElementReferenceException
from bs4 import BeautifulSoup, Comment, NavigableString, Tag
import undetected_chromedriver as uc
#
# def parse_nature_article(soup):
#     """
#     Parse a Nature-style article and return cleaned HTML.
#
#     The function performs the following steps:
#       1. Build a mapping from the footnotes section. Footnotes are expected
#          to be in a <div> whose class contains "Footnotes". Each <dl class="footnote">
#          should have a <dt> with a <sup> number and a corresponding <dd> with a <div>
#          whose id starts with "notep". The number is padded to 4 digits.
#       2. In the article body (assumed to be in the element with id="body"),
#          find all inline citation links (i.e. <a> tags with attribute
#          data-xocs-content-type="reference") and replace them with a clean
#          <sup><a> element. The new link’s href is set to "#notepXXXX" (XXXX being the padded number)
#          and its title is the corresponding footnote text.
#       3. Remove the footnotes container from the output.
#       4. Clean the entire article body by removing extra attributes. Only a limited set of
#          allowed attributes remain per tag (for example, for <a> only "href" and "title",
#          for <p> and <div> only "id", etc.). In addition, any <a> tag with class "topic-link"
#          will have its class removed and its title removed if it begins with "Learn more".
#       5. Unwrap redundant <span> tags.
#
#     Returns:
#         A string containing the cleaned HTML.
#     """
#     # STEP 1: Build the footnotes mapping.
#     footnotes_map = {}
#     footnotes_container = soup.find("div", class_=lambda c: c and "Footnotes" in c)
#     if footnotes_container:
#         for dl in footnotes_container.find_all("dl", class_=lambda c: c and "footnote" in c):
#             dt = dl.find("dt")
#             dd = dl.find("dd")
#             if dt and dd:
#                 sup = dt.find("sup")
#                 if sup:
#                     num_text = sup.get_text(strip=True)
#                     try:
#                         num_int = int(num_text)
#                     except ValueError:
#                         continue
#                     key = f"{num_int:04d}"  # e.g., 1 -> "0001"
#                     note_div = dd.find("div", id=re.compile(r"^notep", re.IGNORECASE))
#                     if note_div:
#                         note_text = note_div.get_text(" ", strip=True)
#                         footnotes_map[key] = note_text
#
#     # STEP 2: Replace inline citations in the article body.
#     article_body = soup.find("div", id="body")
#     if not article_body:
#         article_body = soup  # Fallback if not found
#
#     # Find inline citations (links with data-xocs-content-type="reference")
#     inline_citations = article_body.find_all("a", attrs={"data-xocs-content-type": "reference"})
#     for citation in inline_citations:
#         # Try to get the number from the text; if not, extract from the "name" attribute (e.g., "bcit_1")
#         num_text = citation.get_text(strip=True)
#         if not num_text:
#             name_attr = citation.get("name", "")
#             m = re.search(r"(\d+)", name_attr)
#             if m:
#                 num_text = m.group(1)
#         try:
#             num_int = int(num_text)
#         except ValueError:
#             continue
#         key = f"{num_int:04d}"
#         footnote_text = footnotes_map.get(key, f"No footnote text found for [{num_text}].")
#         # Create a new clean link with only href and title.
#         new_a = soup.new_tag("a", href=f"#notep{key}", title=footnote_text)
#         new_a.string = num_text
#         new_sup = soup.new_tag("sup")
#         new_sup.append(new_a)
#         citation.replace_with(new_sup)
#
#     # Remove the entire footnotes container so that it doesn't appear in the output.
#     if footnotes_container:
#         footnotes_container.decompose()
#
#     # STEP 3: Clean extra attributes from all tags.
#     # Allowed attributes per tag:
#     allowed_attributes = {
#         "a": ["href", "title"],
#         "p": ["id"],
#         "div": ["id"],
#         "sup": [],
#         "em": [],
#         "blockquote": [],
#         "h1": ["id"],
#         "h2": ["id"],
#         "h3": ["id"],
#         "h4": ["id"],
#         "h5": ["id"],
#         "h6": ["id"],
#         "ul": [],
#         "ol": [],
#         "li": [],
#         "figure": [],
#         "img": ["src", "alt"],
#         "section": [],
#         "header": [],
#         "footer": [],
#     }
#     # Traverse all tags in the article body.
#     for tag in article_body.find_all(True):
#         # Special handling: if the tag is <a> and has class "topic-link", remove the class;
#         # also, if its title attribute starts with "Learn more", remove the title.
#         if tag.name == "a":
#             if "topic-link" in tag.get("class", []):
#                 del tag["class"]
#                 if tag.get("title", "").startswith("Learn more"):
#                     del tag["title"]
#         # Remove any attribute not in the allowed list.
#         current_attrs = dict(tag.attrs)
#         for attr in current_attrs:
#             if attr not in allowed_attributes.get(tag.name, []):
#                 del tag.attrs[attr]
#
#     # STEP 4: Unwrap all <span> tags.
#     for span in article_body.find_all("span"):
#         span.unwrap()
#
#     return str(article_body)

import re
from bs4 import BeautifulSoup
def clean_html_sections(html_content: str) -> str:
    """
    Cleans HTML content by:
    1. Selecting only <section> tags whose 'id' attribute matches the
       regex pattern '^sec\\d+$'.
    2. For each selected section, removes comments, scripts, styles, and
       most attributes (except href, src, alt) from its *descendant* tags.
    3. Removes specific <!--?lit$...$--> patterns within the selected sections.

    Args:
        html_content: A string containing the raw HTML.

    Returns:
        A string containing the cleaned HTML of the selected sections,
        joined by newlines. Returns an empty string if no matching
        <section> tags are found.
    """
    soup = BeautifulSoup(html_content, 'lxml')

    # Regex to match section IDs like "sec1", "sec2", etc.
    # Anchored to ensure the entire ID matches.
    section_id_pattern = re.compile(r"^sec\d+$")

    selected_cleaned_sections: List[str] = []

    # Find all section tags anywhere in the document
    all_sections = soup.find_all('section')

    for section in all_sections:
        section_id: Optional[str] = section.get('id') # Use .get() for safety

        # --- Selection Step ---
        if section_id and section_id_pattern.match(section_id):
            # This section matches the ID pattern, proceed to clean its *contents*

            # --- Cleaning Step (Applied only to matching sections) ---

            # 1. Remove comments, scripts, styles from *within* this section
            for element in section.find_all(True, recursive=True):
                # Important: Check if the element is the section itself
                # to avoid modifying its own attributes (like ID) unintentionally
                # in the attribute removal step if recursive=True includes the start node.
                # However, the logic below only modifies descendants based on find_all results.
                # Let's proceed carefully.

                # Remove Comment nodes
                if isinstance(element, Comment):
                    element.extract()
                    continue

                # Remove script/style tags completely
                if element.name in ['script', 'style', 'noscript']:
                    element.extract()
                    continue

                # 2. Remove unwanted attributes from *descendant* tags
                # We keep the 'id' on the main section tag implicitly
                # because we don't process its attributes here.
                allowed_attrs = ['href', 'src', 'alt'] # Keep only these essential ones for descendants
                attrs_to_remove = []
                # Ensure we only modify attributes if the element is NOT the section itself
                if element != section:
                     for attr_name in element.attrs:
                         if attr_name not in allowed_attrs:
                             attrs_to_remove.append(attr_name)

                     for attr_name in attrs_to_remove:
                         # Use try-except in case the attribute was already removed by another operation
                         try:
                             del element[attr_name]
                         except KeyError:
                             pass # Attribute already gone

            # 3. Remove the specific <!--?lit$...$--> patterns (Regex Fallback)
            #    Apply this *after* BS4 manipulations for the current section
            section_str = str(section) # Get the current state of the cleaned section
            # Remove lit comments
            section_str = re.sub(r'<!--\?lit\$[0-9]+\$-->', '', section_str)
             # Remove empty standard comments that might remain if parsed as text nodes
            section_str = re.sub(r'<!--\s*-->', '', section_str)
            # Remove XML declaration sometimes added by regex step or parser
            section_str = re.sub(r'<\?xml.*?\?>', '', section_str).strip()


            # Append the cleaned section's *outer* HTML using prettify for nice formatting
            # Re-parse briefly to ensure we get a clean representation
            temp_soup = BeautifulSoup(section_str, 'lxml')

            # Find the section tag within the re-parsed structure
            final_section_tag = temp_soup.find('section', id=section_id) # Find by original ID
            if final_section_tag:
                 selected_cleaned_sections.append(final_section_tag.prettify())
            else:
                 # Fallback: if the section tag somehow got lost (unlikely but possible with heavy regex)
                 # try finding any section or just use the string.
                 final_section_tag = temp_soup.find('section')
                 if final_section_tag:
                     selected_cleaned_sections.append(final_section_tag.prettify())
                 elif section_str.startswith("<section"): # Basic check if the string still looks like a section
                     # Use a simple string formatter if prettify fails
                      selected_cleaned_sections.append(section_str)


    # Join the cleaned sections with a couple of newlines for separation
    return "\n\n".join(selected_cleaned_sections)

# def parse_ieee_article(url=False, driver=False, soup=None): # Renamed for clarity
#     """
#     Parses an article page (like IEEE Xplore).
#     1) Extracts reference text mapped by reference ID (e.g., "ref1").
#        Looks for <div id="refX-all-ref"> and extracts text from its next sibling div.
#     2) Finds in-text citations <a anchor="refX">[X]</a>.
#     3) Replaces them with <sup><a href="#refX" title="Reference Text">[X]</a></sup>.
#     4) Cleans HTML: keeps only <section> (renamed from div.section), <p>, <sup>, <a>.
#        Unwraps other tags. Removes unwanted attributes.
#     5) Removes <script> and <style> tags.
#     6) Returns cleaned HTML string containing only the <section> blocks.
#     """
#     if driver and url:
#         # print(f"Fetching HTML from URL: {url}") # Debugging
#         url=url+"references#references"
#         soup = get_html_from_url(driver=driver, url=url)
#     elif not soup:
#         raise ValueError("Either driver/url or soup must be provided.")
#
#     # -------------------------------------------------------
#     # STEP 1: Build a dictionary of reference IDs -> reference text
#     # -------------------------------------------------------
#     ref_map = {}
#     # Regex to find the div containing the reference number
#     ref_id_pattern = re.compile(r"^(ref\d+)-all-ref$")
#
#     # Find all divs that likely contain the reference number link
#     ref_number_divs = soup.find_all("div", id=ref_id_pattern)
#     # print(f"Found {len(ref_number_divs)} potential reference number divs.") # Debugging
#
#     for ref_num_div in ref_number_divs:
#         match = ref_id_pattern.match(ref_num_div.get("id", ""))
#         if not match:
#             continue
#         ref_id = match.group(1)  # e.g. "ref1"
#
#         # The actual text is expected in the *next sibling div*
#         ref_text_div = ref_num_div.find_next_sibling("div")
#
#         if ref_text_div:
#             # Extract text, handling potential internal tags if necessary
#             # .get_text() is usually robust here.
#             reference_text = ref_text_div.get_text(" ", strip=True)
#             # Minor cleanup: replace extra whitespace
#             reference_text = re.sub(r"\s+", " ", reference_text).strip()
#             if reference_text:
#                 ref_map[ref_id] = reference_text
#                 # print(f"Mapped {ref_id} to: {reference_text[:50]}...") # Debugging
#             else:
#                 print(f"Warning: Found ref_text_div for {ref_id}, but it contained no text.")
#         else:
#              print(f"Warning: Could not find reference text div sibling for {ref_id}")
#              # Fallback: try finding text within the parent reference-container if structure differs
#              parent_ref_container = ref_num_div.find_parent('div', class_='reference-container')
#              if parent_ref_container:
#                  ref_text_div_fallback = parent_ref_container.find('div', class_='col u-px-1')
#                  if ref_text_div_fallback:
#                       reference_text = ref_text_div_fallback.get_text(" ", strip=True)
#                       reference_text = re.sub(r"\s+", " ", reference_text).strip()
#                       if reference_text:
#                           ref_map[ref_id] = reference_text
#                           # print(f"Mapped {ref_id} (fallback) to: {reference_text[:50]}...") # Debugging
#                       else:
#                           print(f"Warning: Fallback ref_text_div for {ref_id} had no text.")
#
#
#     # print(f"Reference map contains {len(ref_map)} entries.") # Debugging
#
#     # -------------------------------------------------------
#     # STEP 2: Replace in-text citations with cleaned-up anchors inside <sup>
#     # -------------------------------------------------------
#     citation_links = soup.find_all("a", attrs={"anchor": re.compile(r"^ref\d+$")})
#     # print(f"Found {len(citation_links)} potential citation links.") # Debugging
#
#     for a_tag in citation_links:
#         anchor_val = a_tag.get("anchor", "")
#         # We already filtered by regex, but double-check
#         if re.match(r"^ref\d+$", anchor_val):
#             ref_text = ref_map.get(anchor_val) # Returns None if not found
#             anchor_text = a_tag.get_text(strip=True)
#
#             # Create the new <a> tag
#             new_a = soup.new_tag("a", href="#" + anchor_val) # Use # for fragment identifier
#             if ref_text:
#                 new_a["title"] = ref_text
#             else:
#                 # Add a default title if reference text wasn't found
#                 new_a["title"] = f"Reference {anchor_val} not found in bibliography"
#                 print(f"Warning: No reference text found in map for anchor {anchor_val}")
#
#             # Keep "[X]" as the link text, default to "[?]" if empty
#             new_a.string = anchor_text if anchor_text else "[?]"
#
#             # Create the <sup> tag and wrap the new <a> tag
#             new_sup = soup.new_tag("sup")
#             new_sup.append(new_a)
#
#             # Replace the original <a> tag with the new <sup><a>...</a></sup> structure
#             # Need to be careful if the original 'a' is already inside a 'sup'
#             parent = a_tag.parent
#             if parent and parent.name == 'sup':
#                 parent.replace_with(new_sup)
#             else:
#                  a_tag.replace_with(new_sup)
#             # print(f"Replaced citation for {anchor_val}") # Debugging
#
#     # -------------------------------------------------------
#     # STEP 3: Clean HTML - Keep only specific tags and attributes.
#     # -------------------------------------------------------
#     ALLOWED_TAGS = {"section", "p", "sup", "a"} # Added sup
#     ALLOWED_ATTRS = {
#         "section": ["id"],
#         "p": [],
#         "sup": [], # No attributes needed for sup generally
#         "a": ["href", "title"]
#     }
#
#     # Remove <style> and <script> blocks entirely first
#     for tag_name in ["style", "script", "noscript", "meta", "link", "header", "footer", "nav", "iframe", "form"]: # Added more common noise tags
#         for tag in soup.find_all(tag_name):
#             tag.decompose()
#
#     # Rename <div class="section"> to <section> before the main cleanup loop
#     for div_tag in soup.find_all("div", class_="section"):
#         div_tag.name = "section"
#         # Clean attributes specifically for these renamed tags *now*
#         allowed_section_attrs = ALLOWED_ATTRS.get("section", [])
#         current_attrs = list(div_tag.attrs.keys())
#         for attr in current_attrs:
#             # Keep 'class' temporarily if needed for finding, then remove if not in allowed
#              if attr not in allowed_section_attrs and attr != 'class': # Keep class for now if needed, but remove later if not allowed
#                  del div_tag.attrs[attr]
#         # Remove class if not explicitly allowed
#         if 'class' not in allowed_section_attrs and 'class' in div_tag.attrs:
#              del div_tag.attrs['class']
#
#
#     # Use a safer loop for unwrapping/cleaning attributes
#     # Find all tags *once* and convert to a list to avoid iterator issues
#     all_tags = list(soup.find_all(True))
#
#     for tag in all_tags:
#         # Check if the tag still exists in the tree (it might have been unwrapped by a parent's unwrap)
#         if not tag.parent:
#             continue
#
#         if tag.name not in ALLOWED_TAGS:
#             # Unwrap the tag (remove tag, keep content)
#             # We should only unwrap if it has content or siblings, otherwise decompose
#             if tag.contents:
#                  tag.unwrap()
#             else:
#                  tag.decompose() # Remove empty, disallowed tags
#
#         else:
#             # Tag is allowed, clean its attributes
#             allowed_attrs = ALLOWED_ATTRS.get(tag.name, [])
#             current_attrs = list(tag.attrs.keys()) # Iterate over a copy of keys
#             for attr in current_attrs:
#                 if attr not in allowed_attrs:
#                     del tag.attrs[attr]
#
#     # -------------------------------------------------------
#     # STEP 4: Return the cleaned HTML (only content within <section> tags).
#     # -------------------------------------------------------
#     final_sections = soup.find_all("section")
#     if not final_sections:
#          # Fallback: If no <section> tags were found/created, return the whole body content or relevant part
#          body = soup.find('body')
#          if body:
#              # Attempt further cleaning on body if needed, or just return its string
#              # This part might need adjustment based on pages without 'div.section'
#               print("Warning: No <section> tags found after cleaning. Returning body content.")
#               # Optional: Further cleanup on body here if desired
#               return str(body)
#          else:
#               print("Warning: No <section> or <body> tags found. Returning string of the whole soup.")
#               return str(soup) # Or perhaps "" or None depending on desired behavior
#     article_sections = soup.find_all('section', id=re.compile(r"^sec\d+$"))
#
#
#     # Pretty print can make output more readable but adds whitespace
#     return " ".join(sec.prettify() for sec in article_sections)

# --- click_reference_section Helper Function (Revised Wait Locator) ---
def click_expand_section(driver: WebDriver, section_type: str, wait_time: int = 12, view_more_wait_time: int = 18) -> bool: # Slightly longer waits
    """ Clicks a specific section and expands 'View More'. """
    wait = WebDriverWait(driver, wait_time)
    view_more_wait = WebDriverWait(driver, view_more_wait_time)
    clicked = False
    section_name = section_type
    print(f"--- Attempting to click and expand: {section_name} ---")
    locators = { # Prioritize buttons within headers
        "References": [(By.XPATH, "//div[@id='references-header']//button[contains(@class,'accordion-link')]|//a[contains(@href, '/references') and normalize-space(.)='References']|//button[@id='references']") ],
        "Footnotes": [(By.XPATH, "//div[@id='footnotes-header']//button[contains(@class,'accordion-link')]|//a[contains(@href, '/footnotes') and normalize-space(.)='Footnotes']|//button[@id='footnotes']") ],
        "Notes": [(By.LINK_TEXT, "Notes"), (By.XPATH, "//*[normalize-space(.)='Notes' and (self::a or self::button or contains(@id,'notes-header'))]")]
    }
    if section_name not in locators: print(f"ERROR: Invalid section_type '{section_name}'."); return False
    element_to_click = None
    for locator_type, locator_value in locators[section_name]:
        try:
            elements = driver.find_elements(locator_type, locator_value)
            if elements:
                for el in elements:
                    try:
                        if el.is_displayed() and el.is_enabled(): element_to_click = el; break
                    except StaleElementReferenceException: continue
                if not element_to_click and elements: element_to_click = elements[0];
                break
        except Exception as find_e: print(f"WARN: Error finding {section_name} with {locator_type}: {find_e}")
    if element_to_click:
        print(f"Found '{section_name}'. Clicking with JS...")
        try:
            driver.execute_script("arguments[0].scrollIntoView({block: 'center', inline: 'nearest'});", element_to_click); time.sleep(0.7)
            driver.execute_script("arguments[0].click();", element_to_click); print(f"Clicked '{section_name}'."); clicked = True
        except Exception as click_e: print(f"ERROR: Failed to click '{section_name}': {click_e}"); return False
    else: print(f"INFO: '{section_name}' element not found or not interactable."); return False

    print(f"Waiting for {section_name} content...")
    # Wait for specific content element within the section body/container
    if section_name == "References":
        content_locator = (By.CSS_SELECTOR, "div#references-section-container .reference-container div.number[id^='ref'], div#references.accordion-body .reference-container div.number[id^='ref']") # More specific wait
    elif section_name == "Footnotes":
        content_locator = (By.CSS_SELECTOR, "div[id^='footnotes-desktop-fn'], dl.footnote dt") # Wait for specific fn div or dl>dt
    else:
        content_locator = (By.XPATH, f"//section[contains(@id,'{section_name.lower()}-anchor')]//p") # Generic guess

    try:
        wait.until(EC.visibility_of_element_located(content_locator)); print(f"Initial {section_name} content likely visible."); time.sleep(2.0) # Longer post-wait delay

        # --- Handle "View More" ---
        view_more_locator = (By.XPATH, f"//div[contains(@id,'{section_name.lower()}-section-container')]//button[.//span[normalize-space(.)='View More']] | //section[contains(@id,'{section_name.lower()}-anchor')]//button[.//span[normalize-space(.)='View More']] | //div[contains(@class, 'load-more-container')]//button[.//span[normalize-space(.)='View More']]") # More general View More
        attempts = 0; max_attempts = 25
        while attempts < max_attempts:
            attempts += 1; print(f"Checking for '{section_name} View More' ({attempts})...")
            view_more_button = None
            try:
                buttons = driver.find_elements(*view_more_locator)
                for btn in buttons:
                    try:
                        if btn.is_displayed() and btn.is_enabled(): view_more_button = btn; break
                    except StaleElementReferenceException: continue
            except Exception as e: print(f"WARN: Error finding {section_name} View More: {e}"); break
            if view_more_button:
                print(f"Found '{section_name} View More'. Clicking...");
                try: initial_count = len(driver.find_elements(content_locator)) # Use specific content locator for count
                except Exception: initial_count = -1
                try:
                    driver.execute_script("arguments[0].scrollIntoView({block: 'center', inline: 'nearest'});", view_more_button); time.sleep(0.5)
                    driver.execute_script("arguments[0].click();", view_more_button); print(f"Clicked '{section_name} View More'. Waiting...")
                    view_more_wait.until(lambda d: (not d.find_elements(*view_more_locator)) or (initial_count != -1 and len(d.find_elements(content_locator)) > initial_count))
                    if not driver.find_elements(*view_more_locator): print(f"'{section_name} View More' button disappeared."); break
                    current_count = len(driver.find_elements(content_locator));
                    if initial_count != -1 and current_count > initial_count: print(f"More {section_name} items loaded. Count: {current_count}"); time.sleep(1.5)
                    else: print(f"WARN: '{section_name} View More' clicked, but count didn't increase or button still present."); break
                except (TimeoutException): print(f"WARN: Timeout waiting for more {section_name} items."); break
                except StaleElementReferenceException: print(f"WARN: Stale element during {section_name} 'View More'. Retrying check."); time.sleep(1); continue
                except Exception as e: print(f"ERROR: Clicking/Waiting {section_name} 'View More' failed: {e}"); break
            else: print(f"No active '{section_name} View More' button found."); break
    except TimeoutException: print(f"WARN: Initial {section_name} content did not appear after click.")
    except Exception as e: print(f"ERROR: Waiting for {section_name} content failed: {e}")
    return True
# ---------------------------------------------------------


def parse_ieee_article(url=False, driver=False, soup=None) -> Tuple[str, bool]:
    """ Parses IEEE article with sequential section processing. """
    ref_map = {}
    all_refs_mapped_successfully = True
    if driver and url:
        print(f"Loading URL: {url}"); time.sleep(0.5)
        try:
            driver.get(url); time.sleep(2)
            if 'perform_institutional_login_steps' in globals() and callable(perform_institutional_login_steps):
                print("Login..."); perform_institutional_login_steps(driver=driver); print("Login done."); time.sleep(0.5)
            else: print("WARN: Login func skipped.")
        except Exception as load_err: return f"Selenium error loading page: {load_err}", False

        # --- Process sections sequentially ---


        # Process References Section
        if click_expand_section(driver, section_type="References", wait_time=10, view_more_wait_time=20):
            time.sleep(2.0) # Wait after potential expansion
            print("Parsing page source after clicking References...")
            soup_refs = BeautifulSoup(driver.page_source, 'lxml')
            ref_map_refs, _ = build_ref_map_from_section(soup_refs, "References") # Ignore success flag for now
            ref_map.update(ref_map_refs) # Add refs to main map
        else:
            print("INFO: References section not clicked/found or failed to expand.")

        # Process Footnotes Section
        if click_expand_section(driver, section_type="Footnotes", wait_time=10, view_more_wait_time=15):
            time.sleep(2.0) # Wait after potential expansion
            print("Parsing page source after clicking Footnotes...")
            soup_fns = BeautifulSoup(driver.page_source, 'lxml')
            ref_map_fns, _ = build_ref_map_from_section(soup_fns, "Footnotes") # Ignore success flag
            ref_map.update(ref_map_fns) # Add footnotes to main map
        else:
            print("INFO: Footnotes section not clicked/found or failed to expand.")

        # Get final soup *after* all interactions
        print("Getting final soup for citation replacement and cleaning...")
        final_soup = BeautifulSoup(driver.page_source, 'lxml')

    elif soup:
        print("Parsing provided Soup object (Selenium interactions skipped).")
        final_soup = soup # Use the provided soup for everything
        # Build map from static soup (might miss dynamic content)
        ref_map_refs, _ = build_ref_map_from_section(final_soup, "References")
        ref_map_fns, _ = build_ref_map_from_section(final_soup, "Footnotes")
        ref_map.update(ref_map_refs)
        ref_map.update(ref_map_fns)
    else:
        raise ValueError("Driver/URL or Soup required.")

    print(f"--- Final Reference Map Size ({len(ref_map)} entries) ---")

    # --- STEP 2: Replace citations (Using final_soup and combined ref_map) ---
    print("Replacing citations...")
    replacements_needed = []; processed_parents = set()
    main_text_area = final_soup.find("div", id="full-text-section") or \
                     final_soup.find('div', id='article') or \
                     final_soup.find('div', class_='article') or \
                     final_soup.find('body') or \
                     final_soup
    if main_text_area == final_soup: print("WARN: Searching whole soup for citations.")
    else: print(f"INFO: Searching for citations within final: <{main_text_area.name}> {main_text_area.attrs.get('id','')} {main_text_area.attrs.get('class','')}")

    citation_links = main_text_area.find_all("a", attrs={"anchor": re.compile(r"^(ref|fn)\d+$")})
    print(f"Found {len(citation_links)} potential citation links *within main text area*.")
    # Collect
    for a_tag in citation_links:
        anchor_val = a_tag.get("anchor", "");
        if anchor_val:
            anchor_text = a_tag.get_text(strip=True) or "[?]";
            if anchor_val not in ref_map:
                 print(f"Validation FAIL: Anchor '{anchor_val}' in text MISSING from final ref_map.")
                 all_refs_mapped_successfully = False; title = f"Content for {anchor_val} not found"
            else: ref_text = ref_map[anchor_val]; title = ref_text
            replacements_needed.append({"original_tag": a_tag, "anchor_val": anchor_val, "anchor_text": anchor_text, "title": title})
    # Replace
    for item in replacements_needed:
        original_tag = item["original_tag"]
        if not original_tag.find_parent(final_soup.name): continue # Check attachment to final soup
        parent = original_tag.parent
        if parent and parent in processed_parents: continue
        new_a = final_soup.new_tag("a", href="#" + item["anchor_val"], title=item["title"]); new_a.string = item["anchor_text"]
        new_sup = final_soup.new_tag("sup"); new_sup.append(new_a)
        target_to_replace = parent if (parent and parent.name == 'sup') else original_tag
        try:
            # Ensure target exists in the final soup before replacing
            if target_to_replace.find_parent(final_soup.name):
                 target_to_replace.replace_with(new_sup)
                 if target_to_replace == parent: processed_parents.add(parent)
        except Exception as e: print(f"WARN: Error replacing {item['anchor_val']}: {e}")
    print("Citation replacement finished.")

    # --- STEP 3: Clean HTML (Using final_soup) ---
    # ... (Cleaning logic remains the same, applied to main_content_area_clean found in final_soup) ...
    print("Cleaning HTML structure...")
    main_content_area_clean = main_text_area # Use the same area identified for citation search
    if not main_content_area_clean or main_content_area_clean == final_soup: # Re-find if needed
         main_content_area_clean = final_soup.find("div", id="full-text-section") or final_soup.find('div', id='article') or final_soup.find('div', class_='article') or final_soup.find("body") or final_soup
         print("INFO: Refining main_content_area_clean scope.")
    if not main_content_area_clean: return "Error: Could not find content area for cleaning.", False
    tags_to_decompose = ['script', 'style', 'noscript', 'button', 'input', 'form', 'label', 'select', 'iframe', 'meta', 'link', 'header', 'footer', 'nav', 'aside', re.compile(r'^xpl-.*')]
    for tag_pattern in tags_to_decompose:
        tags_found = main_content_area_clean.find_all(tag_pattern, recursive=True)
        for tag in tags_found: tag.decompose()
    for comment in main_content_area_clean.find_all(string=lambda t: isinstance(t, Comment)): comment.extract()
    for header_div in main_content_area_clean.find_all('div', class_='header article-hdr'):
        kicker_tag = header_div.find('div', class_='kicker'); title_tag = header_div.find(['h1','h2','h3','h4','h5','h6']); kicker_text = kicker_tag.get_text(strip=True) if kicker_tag else ""
        if title_tag:
            if kicker_text: title_tag.insert(0, NavigableString(f"{kicker_text} "));
            if kicker_tag: kicker_tag.decompose()
            header_div.replace_with(title_tag)
        elif kicker_tag: new_heading = final_soup.new_tag('h4'); new_heading.string = kicker_text; header_div.replace_with(new_heading) # Use final_soup
        else: header_div.unwrap()
    img_counter = 0; item_containers = main_content_area_clean.find_all(['figure', 'div'], class_=lambda c: c and any(cls in c for cls in ['figure', 'table', 'img-wrap']))
    for container in item_containers: # Image/Table handling
        if not container.parent: continue
        img = container.find('img', class_='document-ft-image'); table = container.find('table'); element_found = img or table
        if not element_found: continue
        img_counter += 1; wrapper_div = final_soup.new_tag('div', id=f'embedded-paragraphs-{img_counter}') # Use final_soup
        caption_tag = container.find('figcaption') or container.find('div', class_='figcaption')
        if not caption_tag: caption_tag = container.find_next_sibling('div', class_='figcaption')
        for tag_context in [container, caption_tag]: # Remove Show All
            if not tag_context: continue
            for sibling_type in ['next_sibling', 'previous_sibling']:
                 sibling = getattr(tag_context, sibling_type, None);
                 if sibling and sibling.name == 'p' and 'links' in sibling.get('class', []) and "Show All" in sibling.get_text(): sibling.decompose(); break
            for link in container.find_all('a', string=re.compile(r"Show All", re.I), recursive=False):
                 link_parent = link.find_parent(['p', 'div']);
                 if link_parent and len(link_parent.get_text(strip=True)) < 15: link_parent.decompose()
                 else: link.decompose()
        if img: # Clear img src/alt
            img['src'] = ''; img_alt = img.get('alt', ''); caption_text_start = caption_tag.get_text(" ", strip=True)[:30] if caption_tag else ""
            if img_alt and caption_text_start and (img_alt in caption_text_start or caption_text_start in img_alt):
                 if 'alt' in img.attrs: del img['alt']
        prev_p = container.find_previous_sibling('p'); next_p = container.find_next_sibling('p'); container_parent = container.parent
        if container_parent: # Assemble wrapper
            try: container_idx = container_parent.contents.index(container); container_parent.insert(container_idx, wrapper_div)
            except (ValueError, IndexError): container_parent.append(wrapper_div); print("WARN: Appending wrapper.")
            if prev_p and prev_p.parent == container_parent and wrapper_div.parent and container_parent.contents.index(prev_p) < container_parent.contents.index(wrapper_div): wrapper_div.append(prev_p.extract())
            wrapper_div.append(container.extract()) # Move container
            if caption_tag and caption_tag.parent != container: # If caption was sibling
                 if caption_tag.parent == container_parent and wrapper_div.parent and container_parent.contents.index(caption_tag) > container_parent.contents.index(wrapper_div): wrapper_div.append(caption_tag.extract())
                 elif caption_tag.parent != wrapper_div: wrapper_div.append(caption_tag.extract())
            if next_p and next_p.parent == container_parent and wrapper_div.parent:
                 try:
                     if container_parent.contents.index(next_p) > container_parent.contents.index(wrapper_div): wrapper_div.append(next_p.extract())
                 except ValueError: pass
    FINAL_ALLOWED_TAGS = {"section", "p", "sup", "sub", "a", "small", "h1", "h2", "h3", "h4", "h5", "h6", "b", "strong", "i", "em", "u", "ul", "ol", "li", "table", "thead", "tbody", "tfoot", "tr", "th", "td", "br", "hr", "blockquote", "figure", "figcaption", "img", "pre", "code", "span", "div"}
    FINAL_ALLOWED_ATTRS = {"section": ["id"], "a": ["href", "title"], "img": ["src", "alt", "width", "height"], "table": ["border"], "th": ["colspan", "rowspan", "scope"], "td": ["colspan", "rowspan"], "span": ["class"], "div": ["id"], "figcaption": [], "figure": [], "b":[]}
    elements_to_process_final = list(main_content_area_clean.find_all(True, recursive=True))
    for element in elements_to_process_final: # Final clean/unwrap
        if not element.parent: continue
        if element.name not in FINAL_ALLOWED_TAGS:
            if element.name not in ['html', 'body']:
                 try:
                     if any(c for c in element.contents if not (isinstance(c, NavigableString) and not c.strip())): element.unwrap()
                     else: element.decompose()
                 except Exception: element.decompose()
        else:
            allowed_attrs = FINAL_ALLOWED_ATTRS.get(element.name, [])
            current_attrs = list(element.attrs.keys())
            for attr in current_attrs:
                if attr not in allowed_attrs:
                    try: del element[attr]
                    except KeyError: pass
    print("HTML cleaning finished.")


    # --- STEP 4: Extract Final Sections and Return ---
    print("Extracting final sections...")
    # Use the cleaned area consistently
    article_sections = main_content_area_clean.find_all('section', id=re.compile(r"^sec\d+$"))
    if not article_sections:
         article_container = main_content_area_clean.find('div', id='article') or main_content_area_clean.find('div', class_='article')
         if article_container: article_sections = [article_container]; print("INFO: Using div#article or div.article.")
         elif main_content_area_clean.name == 'section': article_sections = [main_content_area_clean]; print("INFO: Using main area (section).")
         elif main_content_area_clean.name == 'body': article_sections = [main_content_area_clean]; print("Warning: Returning body.")
         else: article_sections = []; print("Warning: No specific article sections found.")

    if article_sections:
        final_html_parts = []
        for sec in article_sections:
             try: temp_soup = BeautifulSoup(str(sec), 'lxml'); main_element = temp_soup.contents[0] if temp_soup.contents else None; final_html_parts.append(str(main_element) if main_element else '')
             except Exception: final_html_parts.append(str(sec))
        cleaned_html_string = "\n\n".join(filter(None, final_html_parts)); cleaned_html_string = re.sub(r'\n\s*\n', '\n\n', cleaned_html_string).strip()
        # Final check
        # Count citations found in the final main text area again for accurate comparison
        final_main_text_area = final_soup.find("div", id="full-text-section") or final_soup.find('div', id='article') or final_soup.find('div', class_='article') or final_soup.find('body') or final_soup
        final_citation_count = 0
        if final_main_text_area:
            final_citation_count = len(final_main_text_area.find_all("a", attrs={"anchor": re.compile(r"^(ref|fn)\d+$")}))

        if len(ref_map) < final_citation_count: # Compare map size to citations found in text
             print(f"FINAL WARNING: Mapped {len(ref_map)} items but found {final_citation_count} citation anchors in text. Validation likely failed.")
             all_refs_mapped_successfully = False # Ensure flag is false if counts mismatch

        return cleaned_html_string, all_refs_mapped_successfully
    else:
        print("Critical Warning: No content identified. Returning cleaned main area."); cleaned_html_string = str(main_content_area_clean); cleaned_html_string = re.sub(r'\n\s*\n', '\n\n', cleaned_html_string).strip()
        # Final check
        final_main_text_area = final_soup.find("div", id="full-text-section") or final_soup.find('div', id='article') or final_soup.find('div', class_='article') or final_soup.find('body') or final_soup
        final_citation_count = 0
        if final_main_text_area:
             final_citation_count = len(final_main_text_area.find_all("a", attrs={"anchor": re.compile(r"^(ref|fn)\d+$")}))

        if len(ref_map) < final_citation_count:
             print(f"FINAL WARNING: Mapped {len(ref_map)} items but found {final_citation_count} citation anchors in text. Validation likely failed.")
             all_refs_mapped_successfully = False
        return cleaned_html_string, all_refs_mapped_successfully
def build_ref_map_from_section(section_soup: BeautifulSoup, section_type: str) -> Tuple[dict, bool]:
    """
    Extracts references or footnotes from a given BeautifulSoup object
    representing a specific section's content.

    Args:
        section_soup: BeautifulSoup object containing the HTML of the section.
        section_type: String, either "References" or "Footnotes".

    Returns:
        A tuple containing:
        - A dictionary mapping IDs ('refX' or 'fnX') to text.
        - A boolean indicating if any items were successfully found and parsed.
    """
    local_ref_map = {}
    items_found = False
    ref_id_pattern = re.compile(r"^(ref\d+)-all-ref$")
    fn_id_pattern_div = re.compile(r"footnotes-(?:desktop|mobile)-fn(\d+)$")

    print(f"Building map for section: {section_type}")

    if section_type == "References":
        # Look for reference items within the provided soup
        ref_items = section_soup.find_all(
            lambda tag: tag.name == 'div' and ('reference-container' in tag.get('class', []) or 'reference' in tag.get('class', []))
        )
        print(f"  Found {len(ref_items)} potential reference items.")
        for item in ref_items:
            ref_id = None; reference_text = ""
            number_div = item.find(['div', 'span', 'b'], class_='number', id=ref_id_pattern)
            text_div = item.find('div', class_='col u-px-1')
            if not text_div: text_div = item.find(lambda t: t.name in ['div','p'] and t != number_div and 'number' not in t.get('class',[]), recursive=False)
            if number_div:
                 id_match = ref_id_pattern.match(number_div.get("id", ""));
                 if id_match and text_div:
                     ref_id = id_match.group(1); reference_text = text_div.get_text(" ", strip=True)
                     if reference_text:
                         reference_text = re.sub(r"\s+", " ", reference_text).strip()
                         reference_text = re.sub(r'(Show in Context|CrossRef|Google Scholar|View Article|\[?\d*\]?\.?)', '', reference_text, flags=re.IGNORECASE).strip()
                         reference_text = re.sub(r'\s+\.$', '.', reference_text)
                         if reference_text: local_ref_map[ref_id] = reference_text; items_found = True; # print(f"    -- Mapped Ref: {ref_id}")

    elif section_type == "Footnotes":
        # Look for footnote items using div ID pattern
        fn_items_div = section_soup.select('div[id^="footnotes-desktop-fn"], div[id^="footnotes-mobile-fn"]')
        print(f"  Found {len(fn_items_div)} potential footnote items (div ID pattern).")
        if fn_items_div: # Only proceed if items were found
            items_found = True # Mark that we found footnote items
            for item in fn_items_div:
                ref_id = None; reference_text = ""
                id_match = fn_id_pattern_div.search(item.get("id", ""))
                if id_match:
                    num_text = id_match.group(1)
                    ref_id = f"fn{num_text}" # Key is "fnX"
                    text_container = item.find('div', class_='col-23-24')
                    if text_container:
                        text_span = text_container.find('span', class_='description')
                        reference_text = text_span.get_text(" ", strip=True) if text_span else text_container.get_text(" ", strip=True)
                    else: # Fallback if structure is simpler
                        reference_text = item.get_text(" ", strip=True)
                        # --- FIX: Initialize leading_b before find ---
                        leading_b = None
                        leading_b = item.find('b', recursive=False); # Try to find leading bold number
                        # -----------------------------------------------
                        if leading_b and reference_text.startswith(leading_b.get_text(strip=True)):
                             reference_text = reference_text[len(leading_b.get_text(strip=True)):].strip()

                    if reference_text: # Cleanup and Map only if text exists
                        reference_text = re.sub(r"\s+", " ", reference_text).strip()
                        if reference_text:
                            if ref_id not in local_ref_map: # Use local map here
                                local_ref_map[ref_id] = reference_text
                                print(f"    -- Mapped Footnote: {ref_id} (via div#id)")
                            # else: print(f"  WARN: Footnote ID {ref_id} already exists in map.")

        # Fallback for dl.footnote ONLY if the div search yielded nothing AT ALL
        if not items_found:
             fn_items_dl = section_soup.find_all('dl', class_=lambda c: c and 'footnote' in c)
             if fn_items_dl:
                 items_found = True # Mark found via dl
                 print(f"  Processing {len(fn_items_dl)} dl.footnote items as fallback...")
                 for item in fn_items_dl:
                     ref_id = None; reference_text = ""
                     dt = item.find("dt", recursive=False); dd = item.find("dd", recursive=False)
                     if dt and dd:
                         num_text = None; sup = dt.find("sup");
                         if sup: num_text = sup.get_text(strip=True)
                         else: dt_text = dt.get_text(strip=True).replace('.','').strip();
                         if re.match(r"^\d+$", dt_text): num_text = dt_text
                         if num_text and num_text.isdigit(): ref_id = f"fn{num_text}"
                         note_div = dd.find("div", id=re.compile(r"^notep", re.IGNORECASE)); reference_text = note_div.get_text(" ", strip=True) if note_div else dd.get_text(" ", strip=True)
                         if ref_id and reference_text:
                             reference_text = re.sub(r"\s+", " ", reference_text).strip();
                             if reference_text and ref_id not in local_ref_map: # Check local map
                                 local_ref_map[ref_id] = reference_text; print(f"    -- Mapped Footnote: {ref_id} (via dl)")

    print(f"Finished building map for {section_type}, found {len(local_ref_map)} entries.")
    return local_ref_map, items_found

# def cambridge_parser(soup):
#     """
#     Parse Cambridge-style article content from a BeautifulSoup object.
#
#     Steps:
#       1. Build a mapping of footnotes from the endnotes widget or references-list.
#       2. Process inline citations:
#          - For each <a> that indicates a footnote (by classes like "xref", "related-object", etc.),
#            use its "legacysectionid" (or href) to determine the corresponding footnote key.
#          - Extract the citation number from its contained <sup>, and replace the anchor with a new
#            <sup><a> element whose "href" points to the footnote and whose "title" attribute holds the full reference text.
#          - Remove any adjacent modal/reveal elements.
#       3. Clean extraneous attributes:
#          - For <a> tags, only "href" and "title" are kept; for all other tags, only "id" is retained.
#       4. Extract the main content:
#          - Gather all headings (h1–h4) and paragraphs (<p>) in document order.
#          - Skip elements whose text includes unwanted phrases or that are clearly extraneous (e.g. empty jump-links).
#          - Join the remaining elements into a single HTML string wrapped in a <div class="parsed-article">.
#
#     Returns:
#       str: Cleaned HTML string of the main article content with inline citations replaced.
#     """
#     # --- Step 1: Build footnotes mapping ---
#     footnotes = {}
#     # Try to find the Cambridge endnotes widget first.
#     endnotes_container = soup.find("div", class_=re.compile(r"widget-items.*js-chapter-end-notes-items", re.IGNORECASE))
#     if endnotes_container:
#         for fn_div in endnotes_container.find_all("div", class_="footnote"):
#             # Use the content-id attribute if available; otherwise use the element's id.
#             content_id = fn_div.get("content-id", "").strip()
#             if content_id:
#                 key = "fn-" + content_id.lower()
#             else:
#                 key = fn_div.get("id", "").strip().lower()
#             # Remove any extra inline elements (e.g. those with classes "show-for-sr" or "close-reveal-modal")
#             for extra in fn_div.find_all(
#                     class_=re.compile(r"^(show-for-sr|close-reveal-modal|icon-general-close)$", re.IGNORECASE)):
#                 extra.decompose()
#             ref_content = fn_div.find("div", class_=re.compile(r"ref-content", re.IGNORECASE))
#             if ref_content:
#                 # Join all text parts, then remove any leading "Footnote" and trailing "Close" text.
#                 ref_text = " ".join(ref_content.stripped_strings)
#                 ref_text = re.sub(r"^[Ff]ootnote\s+", "", ref_text)
#                 ref_text = re.sub(r"\s+Close\s*$", "", ref_text)
#                 footnotes[key] = ref_text
#         # Remove the entire endnotes widget from the document.
#         endnotes_container.decompose()
#     else:
#         # Fallback: check for a container with id "references-list"
#         ref_list = soup.find("div", id="references-list")
#         if ref_list:
#             for ref_div in ref_list.find_all("div", id=re.compile(r"^(?i:fn\d+)$")):
#                 content_div = ref_div.find("div", class_=re.compile(r"grouped__content", re.IGNORECASE))
#                 if content_div:
#                     ref_text = " ".join(content_div.stripped_strings)
#                     ref_text = re.sub(r"^[Ff]ootnote\s+", "", ref_text)
#                     key = ref_div.get("id", "").strip().lower()
#                     footnotes[key] = ref_text
#             ref_list.decompose()
#
#     # --- Step 2: Process inline citations ---
#     inline_citations = soup.find_all("a", class_=re.compile(r"(related-object|js-related-object|xref)", re.IGNORECASE))
#     for a in inline_citations:
#         legacy_id = a.get("legacysectionid", "").strip()
#         if legacy_id:
#             key = "fn-" + legacy_id.lower()
#         else:
#             href = a.get("href", "").strip()
#             if href.startswith("#"):
#                 key = "fn-" + href.lstrip("#").lower()
#             else:
#                 continue  # Skip if no valid reference key is found.
#         # Extract citation number from contained <sup> (if exists); otherwise, use text.
#         sup = a.find("sup")
#         if sup and sup.string:
#             num = sup.string.strip()
#         else:
#             num = a.get_text(strip=True)
#         # Remove any "Footnote" prefix from the number.
#         num = re.sub(r"^[Ff]ootnote\s+", "", num)
#         full_ref = footnotes.get(key, "")
#         # Create new anchor: href points to "#" + key and title holds the full reference.
#         new_a = soup.new_tag("a", href="#" + key)
#         new_a.string = num
#         if full_ref:
#             new_a["title"] = full_ref
#         new_sup = soup.new_tag("sup")
#         new_sup.append(new_a)
#         a.replace_with(new_sup)
#         # Remove any immediately following modal/reveal elements.
#         next_elem = new_sup.find_next_sibling()
#         if next_elem and next_elem.get("class"):
#             if any(cls in next_elem["class"] for cls in ["footnote-modal", "close-reveal-modal"]):
#                 next_elem.decompose()
#     # Remove stray footnote jump links.
#     for span in soup.find_all("span", class_=re.compile(r"footnote-jump-link", re.IGNORECASE)):
#         span.decompose()
#
#     # --- Step 3: Clean extraneous attributes ---
#     for tag in soup.find_all():
#         if tag.name == "a":
#             allowed_attrs = {"href", "title"}
#         else:
#             allowed_attrs = {"id"}
#         for attr in list(tag.attrs):
#             if attr not in allowed_attrs:
#                 del tag[attr]
#
#     # --- Step 4: Extract main article content ---
#     # List unwanted phrases that signal extraneous end matter.
#     unwanted_phrases = [
#         "loading...", "google scholar citations", "kindle", "save to your dropbox",
#         "save to your google drive", "email alerts", "new journal issues alert",
#         "sign in", "personal account", "book activity alert", "export citation"
#     ]
#     main_parts = []
#     # Collect all headings (h1-h4) and paragraphs (<p>) in document order.
#     for el in soup.find_all(["h1", "h2", "h3", "h4", "p"]):
#         # Skip elements that are empty or are unwanted jump-links.
#         if el.name == "span" and el.get("id", "").startswith("jumplink-"):
#             continue
#         text = el.get_text(separator=" ", strip=True)
#         if not text:
#             continue
#         lower_text = text.lower()
#         if any(phrase in lower_text for phrase in unwanted_phrases):
#             continue
#         main_parts.append(str(el))
#
#     result_html = '<div class="parsed-article">' + "".join(main_parts) + "</div>"
#     return result_html

import re
from bs4 import BeautifulSoup
import json


def clean_cambridge_html(html):
    soup = BeautifulSoup(html, "html.parser")

    # Clean attributes from all tags except <a>
    for tag in soup.find_all(True):
        if tag.name != 'a':
            tag.attrs = {}

    # Handle <a> tags specifically
    for a_tag in soup.find_all('a'):
        href = a_tag.get('href', '')
        title = a_tag.get('title', '')

        if 'javascript' in href:
            # Replace <a> with its inner text only
            a_tag.replace_with(a_tag.get_text())
        else:
            # Keep only href and title attributes
            new_attrs = {}
            if href:
                new_attrs['href'] = href
            if title:
                new_attrs['title'] = title
            a_tag.attrs = new_attrs

    return str(soup)
def cambridge_parser(soup):
    """
    Parse Cambridge-style article content from a BeautifulSoup object.

    This function:
      1. Builds a mapping of numeric footnotes from the end-notes container.
      2. Processes inline citations: if an anchor’s key (from legacysectionid or href)
         contains “miscmatter” and its text is purely numeric, it is replaced by a
         <sup><a>…</a></sup> that has href="#" and a title attribute with the full note.
         (APA references, which use “bibItem” in their keys, are left unchanged.)
      3. Removes extraneous attributes from all tags.
      4. Extracts and returns only the main article content (headings and paragraphs)
         from the container with data-widgetname="BookSectionsText" (filtering out boilerplate).

    Returns:
      str: Cleaned HTML containing the article’s main content.
    """

    # --- Step 1: Build numeric footnote mapping ---
    footnotes = {}
    # Try to find a container that holds end-notes; here we assume a widget named "ChapterEndNotes"
    endnotes_container = soup.find("div", attrs={"data-widgetname": re.compile("ChapterEndNotes", re.IGNORECASE)})
    if endnotes_container:
        # Find all divs with class "footnote" inside the container
        for note_div in endnotes_container.find_all("div", class_="footnote"):
            # Try to get a key from the data-fn-id attribute on the <a> inside the label.
            a_label = note_div.find("a", attrs={"data-fn-id": True})
            if a_label:
                key = a_label["data-fn-id"].strip().lower()
                if not key.startswith("fn-"):
                    key = "fn-" + key
            else:
                # Fall back: try to find a preceding span with an id starting with "fn-"
                span_tag = note_div.find_previous("span", id=re.compile(r"^fn-", re.IGNORECASE))
                key = span_tag["id"].strip().lower() if span_tag else ""
            # Only process numeric (miscmatter) notes.
            if key and "miscmatter" in key:
                # Look for a descendant whose class contains "ref-content"
                ref_div = note_div.find(lambda tag: tag.has_attr("class") and any(
                    re.search(r"ref[-_]content", cls, re.IGNORECASE) for cls in tag["class"]))
                if ref_div:
                    ref_text = " ".join(ref_div.stripped_strings)
                else:
                    ref_text = " ".join(note_div.stripped_strings)
                # Remove any occurrences of "Footnote" or "Close"
                ref_text = re.sub(r"(?i)\bfootnote\b", "", ref_text)
                ref_text = re.sub(r"(?i)\bclose\b", "", ref_text)
                ref_text = ref_text.strip()
                footnotes[key] = ref_text
        # Remove the endnotes container so it isn’t included in the final output.
        endnotes_container.decompose()

    # --- Step 2: Process inline citations ---
    # Find anchors whose class contains citation-related keywords.
    citation_anchors = soup.find_all("a", class_=re.compile(r"(related-object|js-related-object|xref|footnote)",
                                                            re.IGNORECASE))
    for a in citation_anchors:
        # Derive a key from legacysectionid (preferred) or href.
        legacy = a.get("legacysectionid", "").strip()
        href = a.get("href", "").strip()
        key = None
        if legacy and "miscmatter" in legacy.lower():
            key = legacy.lower() if legacy.lower().startswith("fn-") else "fn-" + legacy.lower()
        elif href.startswith("#"):
            key_candidate = href.lstrip("#").lower()
            if "miscmatter" in key_candidate:
                key = key_candidate if key_candidate.startswith("fn-") else "fn-" + key_candidate
        # If we have a key and the anchor's text is purely numeric, process it.
        if key and re.fullmatch(r"\d+", a.get_text(strip=True)):
            citation_text = a.get_text(strip=True)
            full_ref = footnotes.get(key, "")
            new_a = soup.new_tag("a", href="#")
            new_a.string = citation_text
            if full_ref:
                new_a["title"] = full_ref
            new_sup = soup.new_tag("sup")
            new_sup.append(new_a)
            a.replace_with(new_sup)
            # Remove an immediately following modal/reveal span if present.
            next_sib = new_sup.find_next_sibling()
            if next_sib and next_sib.name == "span" and "footnote-modal" in " ".join(next_sib.get("class", [])):
                next_sib.decompose()
        # Otherwise, if the anchor text is not purely numeric (e.g. an APA citation), leave it unchanged.

    # Also remove stray jump-link spans.
    for span in soup.find_all("span", class_=re.compile(r"footnote-jump-link", re.IGNORECASE)):
        span.decompose()

    # --- Step 3: Clean extraneous attributes ---
    for tag in soup.find_all():
        if tag.name == "a":
            allowed_attrs = {"href", "title"}
        else:
            allowed_attrs = {"id"}
        for attr in list(tag.attrs):
            if attr not in allowed_attrs:
                del tag[attr]

    # --- Step 4: Extract main content ---
    main_container = soup.find("div", attrs={"data-widgetname": "BookSectionsText"})
    if not main_container:
        main_container = soup  # Fallback: use entire document
    main_elements = main_container.find_all(["h1", "h2", "h3", "h4", "p"])
    # Filter out boilerplate phrases.
    unwanted_phrases = [
        "loading...", "google scholar citations", "kindle", "save to your dropbox",
        "save to your google drive", "email alerts", "new journal issues alert",
        "sign in", "personal account", "book activity alert", "export citation"
    ]
    final_parts = []
    for el in main_elements:
        text = el.get_text(separator=" ", strip=True)
        if not text:
            continue
        if any(phrase in text.lower() for phrase in unwanted_phrases):
            continue
        final_parts.append(str(el))

    result = '<div class="parsed-article">' + "".join(final_parts) + "</div>"
    return clean_cambridge_html(result)
from selenium.webdriver.remote.webdriver import WebDriver # For type hinting
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException, NoSuchElementException

def perform_institutional_login_steps(driver: WebDriver, institution_name: str = "University College London", timeout: int = 10):
    """
    Automates clicking through an institutional login flow.

    Args:
        driver: An initialized Selenium WebDriver instance.
        institution_name: The name of the institution to search for.
        timeout: Maximum time in seconds to wait for elements (default: 10).

    Raises:
        TimeoutException: If an element is not found or interactable within the timeout period.
        NoSuchElementException: If an element cannot be located by the selector strategy.
        Exception: For other potential errors during interaction.
    """
    # --- Check if login is necessary ---
    needs_login = False
    # Define the locator for the sign-in button (same as in the function)
    sign_in_locator = (By.XPATH, "//a[contains(@class, 'inst-sign-in') and normalize-space()='Institutional Sign In']")

    print("Checking if login is required...")
    try:
        # Use a short wait to find the element. Doesn't need to be clickable, just present.
        # WebDriverWait(driver, 3).until(EC.presence_of_element_located(sign_in_locator))
        # A potentially slightly more robust check: find elements and see if the list is populated and the first element is displayed
        short_wait = WebDriverWait(driver, 3)  # Check for max 3 seconds
        sign_in_elements = short_wait.until(lambda d: d.find_elements(*sign_in_locator))  # Use * to unpack the tuple

        if len(sign_in_elements) > 0 and sign_in_elements[0].is_displayed():
            print("Login button found. Proceeding with login.")
            needs_login = True
        else:
            # Found elements list but it was empty, or the first element wasn't displayed
            print("Login button not found or not displayed. Assuming already logged in.")
            needs_login = False

    except TimeoutException:
        # The element was not found within the short wait period
        print("Login button not found within check timeout. Assuming already logged in.")
        needs_login = False
    except Exception as e:
        # Handle any other unexpected errors during the check
        print(f"An error occurred during login check: {e}")
        needs_login = False  # Play it safe, assume login not needed or possible if check fails

    # --- Execute login steps only if necessary ---
    if needs_login:

        wait = WebDriverWait(driver, timeout)
        print(f"Starting institutional login steps for: {institution_name}")

        try:
            # 1. Click on the "Institutional Sign In" link
            print("Step 1: Locating and clicking 'Institutional Sign In'...")
            # Using XPath to find the specific link by its text and class within the specific div structure
            # More robust XPath: Find the link within the specific bottom navbar div
            # sign_in_locator = (By.XPATH, "//div[contains(@class, 'bottom-navbar')]//a[contains(@class, 'inst-sign-in') and contains(normalize-space(), 'Institutional Sign In')]")
            # Simpler XPath based on the provided structure, relying on the text being unique enough:
            sign_in_locator = (By.XPATH, "//a[contains(@class, 'inst-sign-in') and normalize-space()='Institutional Sign In']")
            sign_in_button = wait.until(EC.element_to_be_clickable(sign_in_locator))
            sign_in_button.click()
            print("Step 1: Clicked 'Institutional Sign In'.")

            # 2. Wait for and click the "Access Through Your Institution" button
            print("Step 2: Locating and clicking 'Access Through Your Institution'...")
            # Using XPath to find the button containing the specific heading text
            access_button_locator = (By.XPATH, "//button[.//div[contains(@class, 'heading') and normalize-space()='Access Through Your Institution']]")
            access_button = wait.until(EC.element_to_be_clickable(access_button_locator))
            access_button.click()
            print("Step 2: Clicked 'Access Through Your Institution'.")

            # 3. Send the institution name to the search input field
            print(f"Step 3: Locating search input and sending keys '{institution_name}'...")
            # Using XPath to find the input field by its specific class or aria-label
            # search_input_locator = (By.XPATH, "//input[contains(@class, 'inst-typeahead-input')]")
            # Using aria-label is often more reliable if available:
            search_input_locator = (By.XPATH, "//input[@aria-label='Search for your Institution']")
            search_input = wait.until(EC.visibility_of_element_located(search_input_locator))
            search_input.clear() # Clear field first in case it has content
            search_input.send_keys(institution_name)
            print("Step 3: Sent institution name to search input.")

            # 4. Wait for and click the institution link from the results
            print(f"Step 4: Locating and clicking the '{institution_name}' link...")
            # Using By.ID is preferred if the ID is exactly the institution name and reliable
            # Note: IDs containing spaces might sometimes require CSS selectors or different XPath syntax
            # If By.ID fails, use XPath targeting the link text
            try:
                # Try By.ID first as it's specific in the example
                institution_link_locator = (By.ID, institution_name)
                institution_link = wait.until(EC.element_to_be_clickable(institution_link_locator))
            except TimeoutException:
                 print(f"Step 4: By.ID locator failed for '{institution_name}', trying XPath...")
                 # Fallback to XPath using the link text (adjust if structure is different)
                 # This XPath looks for an <a> tag that has the exact text or contains a <span> with the exact text
                 institution_link_locator = (
                     By.XPATH,
                     f"//a[normalize-space()='{institution_name}' or .//span[normalize-space()='{institution_name}']][contains(@class, 'stats-Global_Inst_auth_type_method_Inst')]"
                 )
                 institution_link = wait.until(EC.element_to_be_clickable(institution_link_locator))

            institution_link.click()
            print(f"Step 4: Clicked '{institution_name}' link.")

            print("Institutional login steps completed successfully.")

        except TimeoutException as e:
            print(f"Error: Timed out waiting for element after {timeout} seconds. Check element locator or page load state.")
            # Consider taking a screenshot here for debugging: driver.save_screenshot('error_screenshot.png')
            raise  # Re-raise the exception so the caller knows it failed
        except NoSuchElementException as e:
            print(f"Error: Element not found. Check the locator strategy. {e}")
            # driver.save_screenshot('error_screenshot_no_such_element.png')
            raise
        except Exception as e:
            print(f"An unexpected error occurred during the login steps: {e}")
            # driver.save_screenshot('error_screenshot_unexpected.png')
            raise
def initiate_browser():


    # Configure Chrome options
    options = uc.ChromeOptions()
    # Uncomment the next line only if you need headless mode, but note that it might trigger challenges.
    # options.headless = True
    # options.binary_location = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
    # Add options to mimic a normal user browser.
    # options.add_argument("--disable-blink-features=AutomationControlled")
    # options.add_argument("--no-sandbox")
    # options.add_argument("--disable-dev-shm-usage")
    # Uncomment and modify the following lines if you want to use a specific user profile:
    options.add_argument("--user-data-dir=C:\\Users\\luano\\AppData\\Local\\Google\\Chrome\\User Data")
    options.add_argument("--profile-directory=Profile 1")

    # Initialize undetected ChromeDriver.
    driver = uc.Chrome(
        # options=options,
                       driver_executable_path=r"C:\Users\luano\PycharmProjects\Back_end_assis\chromedriver.exe",
                       # version_main=138,  # ← set to your Chrome's major version
                       # use_subprocess=True  # sometimes helps on Windows
                       )
    return driver


def get_html_from_url(driver,url, journal="nature"):
    """
    Retrieve and parse HTML content from the given URL using undetected Selenium with Chrome,
    employing strategies to bypass Cloudflare's challenge.

    Parameters:
        url (str): The URL of the page to fetch.
        journal (str, optional): An optional parameter for logging or additional processing.

    Returns:
        A parsed BeautifulSoup object containing the HTML, or None if retrieval fails.
    """
    try:

        driver.get(url)

        # Wait for Cloudflare challenge resolution: wait until the challenge error text is absent.
        try:
            WebDriverWait(driver, 30).until_not(
                EC.presence_of_element_located((By.ID, "challenge-error-text"))
            )
        except TimeoutException:
            print("Timeout waiting for Cloudflare challenge resolution; proceeding with caution.")

        # Instead of a fixed sleep, wait for the body tag to be present as an indicator that the page has loaded.
        try:
            WebDriverWait(driver, 20).until(
                EC.presence_of_element_located((By.TAG_NAME, "body"))
            )
        except TimeoutException:
            print("Timeout waiting for the page body to load; page may be incomplete.")

        time.sleep(10)
        # Retrieve the page source and parse it.
        html = driver.page_source
        soup = BeautifulSoup(html, "html.parser")

        with open(fr"C:\Users\luano\Downloads\AcAssitant\data\journal_html\{url.replace('/','')}.html","w",encoding="utf-8") as f:
            f.write(str(soup))
        return soup
        # Process the soup with your custom parser.
        # if journal=="nature":
        #     return clean_html_sections(parse_nature_article(soup))
        # if journal=="cambridge":
        #     return cambridge_parser(soup)
    except Exception as e:
        print(f"Error retrieving page with undetected Selenium: {e}")
        return None


import re
import copy
from bs4 import BeautifulSoup, Tag, NavigableString, Comment
from typing import Dict, Optional, Tuple, Set, List


def check_full_article_tab_exists(driver: WebDriver) -> bool:
    """
    Checks if the 'Full Article' tab element exists and is active.

    The target element is an <li class="active"> containing an
    <a id="showFullText">.

    Args:
        driver: The Selenium WebDriver instance.

    Returns:
        True if the element matching the specific structure exists, False otherwise.
    """
    try:
        # Use find_elements (plural) which returns a list.
        # If the list is empty, the element wasn't found. No exception is raised.
        # We target the <a> tag within the active <li> as it's more specific with the ID.
        # If this specific anchor exists within an active li, our condition is met.
        target_elements = driver.find_elements(By.CSS_SELECTOR, "li.active a#showFullText")

        # Check if the list is not empty
        if len(target_elements) > 0:
            print("INFO: Found active 'Full Article' tab element.")
            return True
        else:
            # Element structure not found
            print("INFO: Active 'Full Article' tab element not found.")
            return False

    except Exception as e:
        # Catch potential unexpected errors during the find operation, though unlikely with find_elements
        print(f"WARN: An unexpected error occurred while checking for element: {e}")
        return False
# --- Refined build_tf_ref_map_tailor (Minimal Changes, Assumed Mostly Correct) ---
def build_tf_ref_map_tailor(soup: BeautifulSoup) -> Dict[str, str]:
    """
    Builds a map of reference/footnote IDs to their text content from T&F HTML.
    (Assumes previous version is generally functional for finding ref lists)
    """
    ref_map = {}
    print("--- Building T&F Reference/Footnote Map ---")

    # --- References (Bibliography) ---
    processed_ids = set() # Track IDs to avoid duplicates if found in multiple sections

    # Preferred order of checking for reference containers
    ref_containers = [
        soup.find('ul', class_='references'),
        soup.find('div', id='references'),
        soup.find('section', {'aria-labelledby': 'references'})
    ]
    ref_items = []
    container_desc = "N/A"

    for container in ref_containers:
        if container:
            current_items = []
            item_selector = 'li' # Default for ul
            if container.name == 'div':
                item_selector = 'div'
            elif container.name == 'section':
                # Look for direct div/p/li children with ID first
                current_items = container.find_all(lambda tag: tag.name in ['div', 'p', 'li'] and tag.get('id','').startswith('CIT'), recursive=False)
                if not current_items: # Fallback to any tag with CIT id within section
                    current_items = container.find_all(id=re.compile(r"^CIT\d+$"))
            else: # Assuming ul
                 current_items = container.find_all('li', id=re.compile(r"^CIT\d+$"), recursive=False)

            if current_items:
                 container_desc = f"{container.name}" + (f".{container.get('class','')[0]}" if container.get('class') else "") + (f"#{container.get('id')}" if container.get('id') else "")
                 ref_items = current_items
                 print(f"  Found reference container: <{container_desc}> with {len(ref_items)} potential items.")
                 break # Stop searching once a container is found and has items
    else:
         print("  WARN: Could not find standard reference list container (ul.references, div#references, section[aria-labelledby=references]).")


    for item in ref_items:
        ref_id = item.get('id')
        if ref_id and ref_id.startswith("CIT") and ref_id not in processed_ids:
            text_content = None
            try:
                temp_item_soup = BeautifulSoup(str(item), 'lxml')
                content_part = temp_item_soup.find(id=ref_id)
                if content_part:
                    # Noise removal (keep essentials)
                    for noisy_selector in [
                        {'name': ['a', 'button', 'span'], 'class_': re.compile(r'btn|link|google|extra|xlinks|label|access|badge', re.I)},
                        {'name': 'div', 'class_': re.compile(r'ref-links|reference-links|links|access', re.I)},
                        {'name': 'ul', 'class_': 'links'}
                        ]:
                        find_args = (); find_kwargs = {'recursive': True}
                        if isinstance(noisy_selector, str): find_args = (noisy_selector,)
                        elif isinstance(noisy_selector, dict): selector_copy = noisy_selector.copy(); tag_name = selector_copy.pop('name', True); find_args = (tag_name,); find_kwargs.update(selector_copy)
                        else: continue
                        for noisy_tag in content_part.find_all(*find_args, **find_kwargs):
                            if noisy_tag.parent: noisy_tag.decompose()

                    text_content = content_part.get_text(separator=' ', strip=True)
                    if text_content:
                        text_content = re.sub(r"^\s*\[?\d+\]?\.?\s*", "", text_content).strip()
                        noise_patterns = ['(open in a new window)', 'Crossref', 'PubMed', 'Google Scholar', 'Web of Science®?', 'View Article', 'Abstract', 'Full Text', 'Original Article:', 'Get Permissions']
                        for pattern in noise_patterns:
                            text_content = text_content.replace(pattern, '')
                        text_content = re.sub(r'\s+', ' ', text_content).strip()
                        if text_content:
                            ref_map[ref_id] = text_content
                            processed_ids.add(ref_id)
            except Exception as e:
                print(f"    ERROR processing reference item {ref_id}: {e!r}")


    # --- Footnotes (Endnotes) ---
    fn_section = soup.find('div', class_='summation-section') or soup.find('div', class_='footnote-section')
    fn_items = []
    container_desc = "N/A"

    if fn_section:
        fn_items = fn_section.find_all('div', id=re.compile(r"^EN\d+$"), recursive=False)
        container_desc = f"div.{fn_section.get('class', ['unknown'])[0]}"
        print(f"  Found {len(fn_items)} potential footnote items in <{container_desc}>")
        for item in fn_items:
            fn_id = item.get('id')
            if fn_id and fn_id.startswith("EN") and fn_id not in processed_ids:
                text_content = None
                try:
                    p_tag = item.find('p')
                    text_content = p_tag.get_text(separator=' ', strip=True) if p_tag else item.get_text(separator=' ', strip=True)
                    if text_content:
                        text_content = re.sub(r"^\s*\d+\.?\s*", "", text_content).strip()
                        text_content = text_content.replace('(open in a new window)', '').strip()
                        text_content = re.sub(r'\s+', ' ', text_content).strip()
                        if text_content:
                            ref_map[fn_id] = text_content
                            processed_ids.add(fn_id)
                except Exception as e:
                    print(f"    ERROR processing footnote item {fn_id}: {e!r}")
    else:
        print("  WARN: Could not find standard footnote container (div.summation-section or div.footnote-section).")

    print(f"--- Finished map building. Total unique entries: {len(ref_map)} ---")
    if not ref_map:
        print("  WARN: Reference map is empty. In-text citations will not have titles.")
    return ref_map
# ------------------------------------------------------
foot_index =1
# --- Corrected Recursive Copy and Transform Function (v6 - Class as List) ---
def copy_and_transform(original_element, new_parent, marker_map, soup_for_new_tags):
    """
    Recursively copies elements, transforming markers based on marker_map.
    Prepares generated <a> tags for sequential numbering by adding a class (using a list).
    Ensures original visible text (like year) for CIT references is preserved.
    Returns set of processed marker positions.
    """
    global foot_index
    processed_marker_positions = set()

    if isinstance(original_element, NavigableString):
        new_parent.append(NavigableString(str(original_element)))
        return processed_marker_positions

    if not isinstance(original_element, Tag):
        return processed_marker_positions

    current_pos = (getattr(original_element, 'sourceline', -1), getattr(original_element, 'sourcepos', -1))
    marker_info = marker_map.get(current_pos)

    # --- Check if the *current element* is the designated start of a marker ---
    if marker_info and marker_info.get('is_start_node', False):
        rid = marker_info['rid']
        cleaned_visible_text = marker_info['cleaned_visible_text']
        ref_map = marker_info['ref_map_ref']

        # --- Create the new standard marker structure: <sup><a href="#rid" title="..." class="sequential-marker">[#]</a></sup> ---
        full_ref_text = ref_map.get(rid, f"Details for {rid} not found in map.")
        title = full_ref_text

        new_sup = soup_for_new_tags.new_tag("sup")
        # *** MODIFIED LINE: Use a list for the class attribute ***
        new_a = soup_for_new_tags.new_tag("a", href=f"#{rid}", title=title)
        new_a.string = str(foot_index) # Placeholder text
        new_sup.append(new_a)
        foot_index=foot_index+1

        # --- Append transformed elements based on context ---
        if rid.startswith("CIT") and cleaned_visible_text:
            new_parent.append(NavigableString(cleaned_visible_text))
            if not cleaned_visible_text.endswith(' '):
                 new_parent.append(NavigableString(" "))
            new_parent.append(new_sup)
        else:
            new_parent.append(new_sup)

        processed_marker_positions.add(current_pos)
        # ** Skip recursion into the original marker's children **
        return processed_marker_positions

    else:
        # --- This element is NOT a marker start node OR is inside one already being processed ---
        new_tag = soup_for_new_tags.new_tag(original_element.name, **original_element.attrs)
        new_parent.append(new_tag)

        children_processed_positions = set()
        if hasattr(original_element, 'contents'):
            for child in original_element.contents:
                processed_in_child = copy_and_transform(child, new_tag, marker_map, soup_for_new_tags)
                children_processed_positions.update(processed_in_child)

        processed_marker_positions.update(children_processed_positions)
        return processed_marker_positions
# ---------------------------------------------


# --- Main Parser Function (v5 FINAL - Use with v6 copy_and_transform) ---
# No changes needed here compared to the previous version, but included for completeness.
def parse_taylor_article(url,driver):
    """
    Parses Taylor & Francis HTML, focusing on span > a[data-rid] markers.
    Builds a new tree, transforms markers, and renumbers them sequentially.
    Calls copy_and_transform v6.
    """
    global foot_index
    foot_index = 1
    soup = get_html_from_url(driver, url)
    full_article= check_full_article_tab_exists(driver)
    if not full_article:
        return False, False
    elif full_article:
        print("--- Starting Taylor & Francis Parser (v5 FINAL - Calls v6 transform) ---")
        overall_success = True

        original_main_content = soup.find('div', class_='hlFld-Fulltext')
        container_source = "div.hlFld-Fulltext"
        if not original_main_content:  # Fallback logic
            original_main_content = soup.find('article')
            container_source = "article"
            if not original_main_content:
                original_main_content = soup.body
                container_source = "body"
                if not original_main_content:
                    print("ERROR: Could not find any suitable main content container."); return None, False
                else:
                    print(f"WARN: Using fallback container <{container_source}>.")
            else:
                print(f"INFO: Using container <{container_source}>.")
        else:
            print(f"INFO: Found main content container <{container_source}>.")

        # --- STEP 2: Build Ref Map ---
        ref_map = build_tf_ref_map_tailor(soup)  # Use your full v3 code here

        # --- STEP 3 & 4: Gather and Validate Markers ---
        print("Gathering and validating span.ref-lnk > a[data-rid] markers...")
        rids_in_text: Set[str] = set();
        marker_map_for_build: Dict[Tuple[int, int], Dict] = {}
        marker_spans = original_main_content.find_all('span', class_=lambda c: c and 'ref-lnk' in c)
        for span_marker in marker_spans:  # Process markers
            rid = None;
            cleaned_visible_text = "";
            target_link = span_marker.find('a', recursive=False)
            if not target_link: continue
            rid = target_link.get('data-rid')
            if not rid or not re.match(r'^(CIT|EN)\d+$', rid):
                href = target_link.get('href', '');
                if href.startswith(('#CIT', '#EN')):
                    rid = href[1:]
                else:
                    continue
            try:  # Extract visible text
                link_content_copy = BeautifulSoup(target_link.decode_contents(), 'lxml');
                off_screen_span = link_content_copy.find('span', class_='off-screen')
                if off_screen_span: off_screen_span.decompose()
                sup_tag = link_content_copy.find('sup');
                cleaned_visible_text = str(
                    sup_tag.get_text(strip=True) if sup_tag else link_content_copy.get_text(strip=True))
            except Exception as e:
                cleaned_visible_text = ""
            marker_pos = (getattr(span_marker, 'sourceline', -1), getattr(span_marker, 'sourcepos', -1))
            if marker_pos != (-1, -1):  # Store marker info
                rids_in_text.add(rid)
                if marker_pos not in marker_map_for_build: marker_map_for_build[marker_pos] = {'rid': rid,
                                                                                               'type': 'span',
                                                                                               'cleaned_visible_text': cleaned_visible_text,
                                                                                               'ref_map_ref': ref_map,
                                                                                               'is_start_node': True}
        print(f"Finished validation. Identified {len(marker_map_for_build)} unique span marker positions.")
        print(f"Found {len(rids_in_text)} unique RIDs in text.")

        # --- Validation against Ref Map ---
        if rids_in_text:  # Check RIDs against map
            missing_rids_from_map = sorted([rid for rid in rids_in_text if rid not in ref_map]);
            if missing_rids_from_map:
                print(
                    f"VALIDATION FAIL: {len(missing_rids_from_map)} RIDs missing from map: {missing_rids_from_map[:10]}..."); overall_success = False
            else:
                print("VALIDATION PASS: All text RIDs found in map.")
            map_rids = set(ref_map.keys());
            map_rids_not_in_text = sorted(list(map_rids - rids_in_text));
            if map_rids_not_in_text: print(
                f"VALIDATION INFO: {len(map_rids_not_in_text)} map RIDs not in text: {map_rids_not_in_text[:10]}...")

        # --- STEP 5: Build New Tree with Transformations ---
        print("Building new content tree with transformed citations (marker prep)...")
        new_soup = BeautifulSoup('', 'lxml');
        new_main_content = new_soup.new_tag(original_main_content.name, **original_main_content.attrs);
        new_soup.append(new_main_content)
        processed_marker_count_build = 0
        if hasattr(original_main_content, 'contents'):  # Recursively copy/transform
            for element in original_main_content.contents:
                processed_positions_in_branch = copy_and_transform(element, new_main_content, marker_map_for_build,
                                                                   new_soup)  # Calls v6
                processed_marker_count_build += len(processed_positions_in_branch)
        print(f"New tree build finished. Processed {processed_marker_count_build} marker positions.")

        # --- STEP 5.5: Sequential Renumbering Pass ---
        print("Applying sequential numbering to markers...")
        sequential_counter = 1;
        markers_to_renumber = []
        if new_main_content:  # Renumber placeholders
            markers_to_renumber = new_main_content.find_all('a', class_='sequential-marker')
            if markers_to_renumber:
                for i, marker_link in enumerate(markers_to_renumber):
                    if not isinstance(marker_link, Tag): continue
                    try:
                        marker_link.string = str(sequential_counter);
                        current_classes = marker_link.get('class', [])
                        if 'sequential-marker' in current_classes:
                            current_classes.remove('sequential-marker');
                            if current_classes:
                                marker_link['class'] = current_classes
                            else:
                                del marker_link['class']
                        sequential_counter += 1
                    except Exception as e:
                        print(f"  ERROR during renumbering for marker {i + 1}: {e!r}")
                print(f"Finished renumbering {sequential_counter - 1} markers.")
            else:
                print("No markers found to renumber.")
        else:
            print("  ERROR: new_main_content is None, cannot renumber.")

        # --- STEP 5.7: Decompose Specific Sections ---
        print("Decomposing Abstract and Notes sections...")
        decomposed_count = 0
        if new_main_content:
            abstract_div = new_main_content.find('div', class_='hlFld-Abstract')  # Find abstract
            if abstract_div: abstract_div.decompose(); decomposed_count += 1; print("  Decomposed Abstract section.")
            notes_heading = new_main_content.find(['h2', 'h3'],
                                                  string=re.compile(r'^\s*Notes\s+on\s+contributor(s)?\s*$',
                                                                    re.I))  # Find notes heading
            if notes_heading: notes_heading.decompose(); decomposed_count += 1; print(
                "  Decomposed 'Notes on contributor' heading.")
        print(f"Finished decomposing {decomposed_count} specific sections.")

        # --- STEP 5.8: Add Introduction Heading (Corrected Logic) ---
        print("Adding Introduction heading...")
        introduction_added = False
        if new_main_content:
            # Find the first *significant* child tag (div, p, section, etc.)
            first_significant_tag = None
            for child in new_main_content.children:
                if isinstance(child, Tag) and child.name in ['div', 'p', 'section', 'ol',
                                                             'ul']:  # Add more block-level tags if needed
                    first_significant_tag = child
                    break  # Stop at the first one

            if first_significant_tag:
                try:
                    intro_h2 = new_soup.new_tag('h2')
                    intro_h2.string = "Introduction"
                    # Insert H2 right before this first significant tag
                    first_significant_tag.insert_before(intro_h2)
                    introduction_added = True
                    print("  Added 'Introduction' heading before first significant content tag.")
                except Exception as e:
                    print(f"  ERROR adding Introduction heading: {e!r}")
            else:
                print("  Introduction heading not added (no suitable first content tag found).")
        else:
            print("  Cannot add Introduction heading, new_main_content is None.")

        # --- STEP 5.9: Process Figures/Images (Optional - Use v6 code if needed) ---
        # print("Processing and wrapping figures/images...")
        # --- PASTE FIGURE HANDLING CODE (Step 5.7 from v6) HERE IF NEEDED ---

        # --- STEP 6: Basic HTML Cleaning ---
        print("Performing final HTML cleaning on the NEW tree...")
        # (Use the same comprehensive cleaning logic from v6)
        tags_to_decompose = [
            'script', 'style', 'noscript', 'meta', 'link',
            {'name': 'div', 'class_': 'widget'}, {'name': 'div', 'class_': 'pb-dropzone'},
            {'name': 'div', 'class_': 'abstractKeywords'}, {'name': 'div', 'class_': 'tableDownloadOption'},
            {'name': 'div', 'class_': 'footnote-section'}, {'name': 'div', 'class_': 'summation-section'},
            {'name': 'ul', 'class_': 'references'}, {'name': 'div', 'id': 'references'},
            {'name': 'section', 'aria-labelledby': 'references'}, {'name': 'div', 'class_': 'article-metadata'},
            {'name': 'div', 'class_': 'literatumPublicationKeywords'},
            {'name': 'section', 'id': 'related-article-section'},
            {'name': 'div', 'class_': 'module citations'}, {'name': 'div', 'class_': 'articleTools'},
            {'name': 'div', 'class_': 'response-feature'}, {'name': 'div', 'class_': 'permissions'},
            {'name': 'div', 'id': 'metrics'}, {'name': 'div', 'id': 'ack'}, {'name': 'div', 'id': 'coi-statement'},
            {'name': 'div', 'class_': 'supplemental-material-container'},
            {'name': 'div', 'class_': re.compile(r'ad-|banner|promo|marketing', re.I)},
            {'name': 'div', 'class_': 'hlFld-Abstract'},  # Cleanup
            {'name': ['h2', 'h3'], 'string': re.compile(r'^\s*Notes\s+on\s+contributor(s)?\s*$', re.I)}  # Cleanup
        ]
        elements_removed_count = 0;
        comments_removed_count = 0;
        attrs_removed_count = 0
        if new_main_content:
            # Decompose unwanted tags
            for selector in tags_to_decompose:
                try:
                    elements = [];
                    find_args = ();
                    find_kwargs = {'recursive': True}
                    if isinstance(selector, str):
                        find_args = (selector,)
                    elif isinstance(selector, dict):
                        selector_copy = selector.copy(); tag_name = selector_copy.pop('name', True); find_args = (
                        tag_name,); find_kwargs.update(selector_copy)
                    else:
                        continue
                    elements = new_main_content.find_all(*find_args, **find_kwargs)
                    for tag in elements:
                        if tag == new_main_content or (
                                hasattr(tag, 'get') and 'figure-wrapper' in tag.get('class', [])): continue
                        if tag.parent: tag.decompose(); elements_removed_count += 1
                except Exception as e:
                    print(f"  WARN: Error processing selector {selector} for decomposition: {e!r}")
            # Remove comments
            for comment in new_main_content.find_all(
                string=lambda t: isinstance(t, Comment)): comment.extract(); comments_removed_count += 1
            # Clean attributes
            allowed_attrs = {  # Keep strict attribute cleaning
                "*": ["id", "class"], "a": ["href", "title", "id", "class"],
                "img": ["src", "alt", "id", "width", "height", "class"],
                "table": ["id", "border", "summary", "class"],
                "th": ["id", "colspan", "rowspan", "scope", "headers", "abbr", "class"],
                "td": ["id", "colspan", "rowspan", "headers", "abbr", "class"], "sup": ["id", "class"],
                "sub": ["id", "class"],
                "ul": ["id", "class"], "ol": ["id", "class", "start", "type"], "li": ["id", "class", "value"],
                "p": ["id", "class"], "div": ["id", "class"], "span": ["id", "class"], "h1": ["id", "class"],
                "h2": ["id", "class"], "h3": ["id", "class"], "h4": ["id", "class"], "h5": ["id", "class"],
                "h6": ["id", "class"],
                "b": ["id", "class"], "strong": ["id", "class"], "i": ["id", "class"], "em": ["id", "class"],
                "u": ["id", "class"],
                "figure": ["id", "class"], "figcaption": ["id", "class"], "caption": ["id", "class"],
                "button": ["class", "data-id", "data-behaviour", "data-popup-event-type", "id", "role",
                           "aria-labelledby"], }
            for element in new_main_content.find_all(True, recursive=True):
                if not hasattr(element, 'attrs'): continue
                current_attrs = list(element.attrs.keys());
                allowed = allowed_attrs.get(element.name, allowed_attrs.get("*", []));
                attrs_to_remove = [attr for attr in current_attrs if attr not in allowed]
                if attrs_to_remove:
                    for attr in attrs_to_remove: del element[attr]; attrs_removed_count += 1
        print(
            f"HTML cleaning finished. Removed {elements_removed_count} tags, {comments_removed_count} comments. Removed {attrs_removed_count} attributes.")

        # --- STEP 7: Extract Final HTML ---
        final_html = None
        if not new_main_content or not new_main_content.contents: print(
            "ERROR: Cannot serialize empty NEW main_content."); overall_success = False; return None, overall_success
        try:
            final_html = new_main_content.decode_contents();
            final_html = re.sub(r'>\s+<', '><', final_html).strip();
            final_html = re.sub(r'\s+', ' ', final_html).strip();
            print("INFO: Final HTML serialization successful.")
        except Exception as e:
            print(f"ERROR: Failed final serialization: {e!r}"); final_html = None; overall_success = False

        print(f"--- Taylor & Francis Parser Finished --- Overall Success: {overall_success} ---")
        return final_html, overall_success
url="https://ieeexplore.ieee.org/document/5954702/references#references"

def oneTest():
    with open(fr"C:\Users\luano\Downloads\AcAssitant\file.html", "r", encoding="utf-8") as f:
        html = f.read()
    soup = BeautifulSoup(html, "html.parser")
    print("aaaa")
    # print(parse_taylor_article(driver))
# print(cambridge_parser(soup))
# oneTest()
def test():
    url_list = [
        "https://www.tandfonline.com/doi/abs/10.1111/j.1931-0846.1997.tb00068.x", "https://doi.org/10.1080/14751798.2017.1351142","https://www.tandfonline.com/doi/abs/10.1080/08850607.2020.1783877",
        "https://www.tandfonline.com/doi/full/10.1080/23738871.2022.2041061","https://www.tandfonline.com/doi/full/10.1080/01402390.2021.1895117"

    ]
    driver = initiate_browser()
    for url in url_list:
        # soup= get_html_from_url(driver,url)
        # print(soup)
        # print("_"*20)
        print(parse_taylor_article(url=url,driver=driver))
        input("Press Enter to continue...")


# test()
import undetected_chromedriver as uc
from selenium.webdriver.remote.webdriver import WebDriver
import os
import time
import pyautogui # For controlling native GUI dialogs
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException, NoSuchElementException
import pathlib # For easier path manipulation



def click_and_save_via_dialog(driver: WebDriver,
                              page_url: str,
                              output_folder: str,
                              pdf_filename: str) -> bool:
    """
    Navigates to a URL, clicks the specific HeinOnline download button,
    and uses pyautogui to interact with the expected 'Save As' dialog.

    Args:
        driver: The initialized Selenium WebDriver instance.
        page_url: The URL of the HeinOnline page to navigate to.
        output_folder: The path to the folder where the file should be saved
                       (e.g., "downloads/heinonline"). Will be created if needed.
        pdf_filename: The desired name for the PDF file (e.g., "document1.pdf").

    Returns:
        True if the process of clicking and interacting with the dialog
        (typing path + pressing Enter) was attempted, False otherwise.
        NOTE: This does NOT guarantee the download succeeded, only that the
        interaction was performed.
    """
    try:
        print(f"Navigating to: {page_url}")
        driver.get(page_url)

        # Wait for the download button/link to be present and clickable
        download_locator = (By.XPATH, "//a[@data-original-title='Download PDF of This Section' and contains(@href, 'PrintRequest')]")
        wait = WebDriverWait(driver, 20)
        print("Waiting for download link...")
        download_link = wait.until(EC.element_to_be_clickable(download_locator))
        print("Download link found and clickable.")

        # --- Click the download link (this should trigger the 'Save As' dialog) ---
        print("Clicking download link to trigger 'Save As' dialog...")
        download_link.click()

        # --- Give the 'Save As' dialog a moment to appear and gain focus ---
        # This delay is critical and might need adjustment based on system speed.
        time.sleep(3) # Adjust this pause as needed (2-5 seconds is common)

        # --- Prepare the full output path ---
        # Ensure the output folder exists
        pathlib.Path(output_folder).mkdir(parents=True, exist_ok=True)
        full_pdf_path = os.path.abspath(os.path.join(output_folder, pdf_filename))+".pdf"
        print(f"Target save path: {full_pdf_path}")
        time.sleep(3)
        # --- Use pyautogui to type the path and press Enter ---
        print("Typing path into 'Save As' dialog...")
        pyautogui.write(full_pdf_path, interval=0.05) # Type slowly to avoid issues
        time.sleep(0.5) # Short pause after typing

        print("Pressing Enter to confirm save...")
        pyautogui.press('enter')
        time.sleep(0.5) # Short pause after pressing Enter

        print("'Save As' dialog interaction complete (download initiated in background).")
        return True # Indicate that the interaction sequence was performed

    except TimeoutException:
        print("Error: Timed out waiting for the download link to appear or be clickable.")
        return False
    except NoSuchElementException:
        print("Error: Could not find the download link element using the specified locator.")
        return False
    except Exception as e:
        # Catch pyautogui errors or other issues
        print(f"An unexpected error occurred during the process: {e}")
        import traceback
        traceback.print_exc()
        return False

