import contextlib
import html
import os
import sys
from typing import Dict, Literal

import pyperclip
import requests
import os, re, time, requests, textwrap
import re
from pathlib import Path
from time import sleep
from typing import Dict
import fitz
import base64
import json
import logging
import random
import re
import shutil
import sys
from difflib import SequenceMatcher
from pathlib import Path
from typing import Optional, Dict, Any
from time import sleep
import pyperclip
import time
import undetected_chromedriver as uc
import os
import json
from typing import Optional, Dict, Any
import requests
import unicodedata
from requests.utils import requote_uri
from zeep import Client
from zeep.transports import Transport
from requests import Session
from thefuzz import fuzz
# Monkey-patch the buggy __del__ so it’s a no-op (suppresses WinError)
uc.Chrome.__del__ = lambda self: None
from weasyprint import HTML

from PyPDF2 import PdfReader
from bs4 import BeautifulSoup

from rapidfuzz import fuzz

import xml.etree.ElementTree as ET
import os
import requests
import xmltodict
from dotenv import load_dotenv
import os
import requests
import json
from time import sleep
from urllib.parse import urljoin, quote_plus, urlparse, quote, urlunparse
import json, random, re, os, requests
from urllib.parse import urljoin, quote_plus, urlparse
from typing import Dict, Any, List, Optional
from bs4 import BeautifulSoup                 # pip install beautifulsoup4 lxml
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from requests import HTTPError
from requests.adapters import HTTPAdapter
from selenium.webdriver.common.by import By
from selenium.webdriver.support.wait import WebDriverWait
from urllib3.util import Retry
import os
import pathlib

from urllib.parse import urljoin, unquote
import sys
import os
import re
from pathlib import Path
from urllib.parse import urlparse
import undetected_chromedriver as uc

import requests

import requests
from selenium.webdriver import Keys
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait
from selenium.common.exceptions import TimeoutException, WebDriverException, NoSuchWindowException
from selenium.webdriver.remote.webdriver import WebDriver
from selenium.common import NoSuchElementException, ElementClickInterceptedException, TimeoutException
from selenium.webdriver.common.by import By
from selenium.webdriver.support.wait import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
import shutil
import tempfile
from pathlib import Path
from typing import Optional, Dict, Union

import cloudscraper
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.wait import WebDriverWait

try:
    import pyautogui
except Exception:
    pyautogui = None

from scrapping.Data_collection_automation.constants import *
from scrapping.Data_collection_automation.constants import _wait_for_saved_pdf, _pdf_is_valid, HEIN_COOKIES, \
    _activate_chrome_window, RAW_COOKIE_JSTOR
from scrapping.Data_collection_automation.helpers import cookie_dict, _get_driver, _close_driver


def digital_commons_download_pdf(url: str, out_path: str):
    """Stream a PDF to *out_path* using the same cookies and UA as the crawler."""
    with requests.get(url, headers=HEADERS, cookies=COOKIES, stream=True, timeout=60) as r:
        r.raise_for_status()
        if not r.headers.get("Content-Type", "").lower().startswith("application/pdf"):
            raise RuntimeError(
                f"Unexpected content-type: {r.headers.get('Content-Type')}"
            )
        total = int(r.headers.get("Content-Length", 0))
        print(f"Downloading {total / 1024:.1f} KB …" if total else "Downloading …")
        with open(out_path, "wb") as f:
            for chunk in r.iter_content(chunk_size=8192):
                if chunk:
                    f.write(chunk)
    print(f"✓ saved → {os.path.abspath(out_path)}")
    return os.path.abspath(out_path)




RAW_COOKIE_HEADER= "cfid=2056f06e-4af6-45f3-8bec-0afa919fc4e7; cftoken=0; OptanonAlertBoxClosed=2024-10-28T23:41:56.789Z; _otor=1730197568915.https%3A%2F%2Fgithub.com%2FBitanDor%2FNIT-ZKP%3Ftab%3Dreadme-ov-file; _hjSessionUser_823431=eyJpZCI6ImVmODhiNzU3LTJkODctNTM3Yy1hYjczLTYzNDc3N2UwYTQ4YSIsImNyZWF0ZWQiOjE3MzAxOTc1NzAyMzksImV4aXN0aW5nIjp0cnVlfQ==; cf_clearance=NJIxQzCI94qSON0yg9l8Sq1UDmVfv5bHS1eNlgAhSeQ-1744732832-1.2.1.1-ph8G2IARhkI6CC00P2cgSqfHgpmThgclSrd4sBXPCU2Hx.cK9029CxUQvY0tSBS8J267DIq.Yo9jfqB45ZE2BfgbyR7m9IVqAVRjUi3cukDCLKZP5g5xVtyBsQvAiCoqvVODstP.K932E5AMQSlE21w5z0xhhPUikj48KhMIrZaKR5BwG0l9K3HSXNsd8XoJ9eOjmzC734Y1qqlZq0mM37D.lnDmSBD4h3dSd6V.EygrEZEJkdNbZbdJheOZW09jV6MwdvuuYkLlVoAyIF6hyzfPFhIHPJw_wseCYjRxF1MZw.NzO6A6S_B3xxC0Y0fA7ssMNOe449pS88x6S145I8TXJCtSSwXeLfvFOUEPazx9JAiHCC6YZetK33iKNbey; SITEID=en; CFID=2056f06e-4af6-45f3-8bec-0afa919fc4e7; CFTOKEN=0; at_check=true; AMCVS_4D6368F454EC41940A4C98A6%40AdobeOrg=1; AMCV_4D6368F454EC41940A4C98A6%40AdobeOrg=-1124106680%7CMCMID%7C17196978561961806920080893866762177441%7CMCAAMLH-1752754828%7C6%7CMCAAMB-1752754828%7CRKhpRz8krg2tLO6pguXWp5olkAcUniQYPHaMWWgdJ3xzPWQmdj0y%7CMCOPTOUT-1752157228s%7CNONE%7CMCAID%7CNONE%7CvVersion%7C5.2.0%7CMCIDTS%7C20280; _hjSession_823431=eyJpZCI6IjZhMTYxYzAzLWE4ZDItNGI3NS1iNjQ3LTBiOGQwOGFjMjM2ZSIsImMiOjE3NTIxNTAwMjg4NTgsInMiOjAsInIiOjAsInNiIjowLCJzciI6MCwic2UiOjAsImZzIjowfQ==; _otpe=https%3A%2F%2Fpapers.ssrn.com%2Fsol3%2Fpapers.cfm%3Fabstract_id%3D4580292; AWSELB=F583A35D06DDD1DDD942D6006B93D30F25C2908AFA33F84DA4C065BD3798C7A552F6A5D314673F981F37B12DCC98FDD1F63385B396161FD3249A57C94243B9CAF3088409436E833A0E0315B0EF9BD53B1D64C5005D; mbox=PC#123c4de6f11349bab9409660a17eb3fa.37_0#1815399469|session#aef498f6765b4f9b9ed24c9f06831c52#1752156253; ip4=82.13.63.56; _ots=29.1752150028541.1752154625704.1752154432371; _otui=1806205057.1730158912567.1751804333824.1752150028541.26.84.9607399; OptanonConsent=isGpcEnabled=0&datestamp=Thu+Jul+10+2025+14%3A37%3A49+GMT%2B0100+(British+Summer+Time)&version=202411.2.0&browserGpcFlag=0&isIABGlobal=false&hosts=&consentId=3235c98f-5e22-4dad-9af8-9f60f1295d2d&interactionCount=1&isAnonUser=1&landingPath=NotLandingPage&groups=1%3A1%2C3%3A1%2C2%3A1%2C4%3A1&geolocation=GB%3BENG&AwaitingReconsent=false; s_pers=%20v8%3D1752156363845%7C1846764363845%3B%20v8_s%3DLess%2520than%25207%2520days%7C1752158163845%3B%20c19%3Dss%253Apaper%253Aabstract-page%7C1752158163847%3B%20v68%3D1752154432058%7C1752158163848%3B; s_sess=%20s_cpc%3D0%3B%20s_sq%3D%3B%20c21%3Dattributing%2520cyber%252A%3B%20e13%3Dattributing%2520cyber%252A%253A%3B%20s_cc%3Dtrue%3B%20s_ppvl%3Dss%25253Apaper%25253Aabstract-page%252C77%252C77%252C1889.933349609375%252C1386%252C1051%252C2560%252C1440%252C1.88%252CP%3B%20e41%3D1%3B%20s_ppv%3Dss%25253Apaper%25253Aabstract-page%252C79%252C77%252C1927%252C1386%252C1051%252C2560%252C1440%252C1.88%252CP%3B"
def parse_cookie_header(header: str) -> Dict[str, str]:
    return {
        k.strip(): v.strip()
        for part in header.split(";") if "=" in part
        for k, v in [part.split("=",1)]
    }

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36"
    ),
    "Accept": "application/pdf,application/octet-stream;q=0.9,*/*;q=0.8",
    "Referer": "https://digital-commons.usnwc.edu/",
}

COOKIES = cookie_dict(RAW_COOKIE_HEADER)
RESULTS_PER_PAGE = 25                 #  <<<  ADD THIS LINE

COOKIES = parse_cookie_header(RAW_COOKIE_HEADER)
# ── basic UA / timeout settings ─────────────────────────────────────────
HEADERS_SSRN = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.8",
}
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36"
    ),
}

def _filename_from_url(u: str) -> str:
    name = os.path.basename(u.split("?", 1)[0])
    return re.sub(r"[^\w\.-]", "_", name) or "download.pdf"


def _download_with_cookies(pdf_url: str,
                           save_dir: str,
                           cookies: dict,
                           referer: str = "") -> str:
    """
    Download *pdf_url* using the cookies harvested from Selenium.
    If SSRN first serves an HTML wrapper page, dig out the real
    <embed src=…pdf> or <iframe src=…pdf> link and retry.
    """
    sess = requests.Session()
    sess.headers.update(HEADERS)
    if referer:
        sess.headers["Referer"] = referer
    sess.cookies.update(cookies)

    def _get(u):
        return sess.get(u, stream=True, timeout=60, allow_redirects=True)

    r = _get(pdf_url)
    r.raise_for_status()

    # HTML wrapper? → find the embedded PDF and refetch
    if "html" in r.headers.get("Content-Type", "").lower():
        soup = BeautifulSoup(r.text, "html.parser")
        src = ""
        emb = soup.find("embed", {"type": "application/pdf"})
        if emb and emb.get("src"):
            src = emb["src"]
        if not src:
            iframe = soup.find("iframe", src=True)
            if iframe:
                src = iframe["src"]
        if not src:
            raise RuntimeError("No PDF link found inside HTML wrapper")

        r = _get(urljoin(r.url, src))
        r.raise_for_status()

    if not r.headers.get("Content-Type", "").lower().startswith("application/pdf"):
        raise RuntimeError(f"Expected PDF, got {r.headers.get('Content-Type')}")

    os.makedirs(save_dir, exist_ok=True)
    file_path = os.path.join(save_dir, _filename_from_url(r.url))

    size = int(r.headers.get("Content-Length", 0))
    msg = f"{size/1024:.1f} KB" if size else "unknown size"
    print(f"↓ {msg}  {r.url}")

    with open(file_path, "wb") as fh:
        for chunk in r.iter_content(8192):
            fh.write(chunk)
    print("✓ saved →", file_path)
    return file_path

# -----------------------------------------------------------------------------
# main one-item scraper
# -----------------------------------------------------------------------------
def ssrn_downloader(browser, url: str, save_dir: str = "ssrn_pdfs"):
    """
    Parse a single SSRN abstract page *using the live Selenium driver*,
    return (pdf_path, metadata_dict)
    """
    print("Fetching", url)
    browser.get(url)
    wait = WebDriverWait(browser, 25)

    # wait until the abstract box is present
    wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, ".box-abstract-main")))

    # dismiss OneTrust banner if it blocks clicks
    try:
        browser.find_element(By.ID, "onetrust-accept-btn-handler").click()
        wait.until(EC.invisibility_of_element_located(
            (By.CSS_SELECTOR, ".onetrust-pc-dark-filter")))
    except NoSuchElementException:
        pass

    # collect metadata with BeautifulSoup
    soup = BeautifulSoup(browser.page_source, "html.parser")
    t = lambda sel: soup.select_one(sel).get_text(" ", strip=True) if soup.select_one(sel) else ""

    metadata = {
        "title":                t(".box-abstract-main h1"),
        "journal_info":         t(".reference-info p"),
        "pages":                "",
        "posted":               "",
        "date":         "",
        "authors":              [h.get_text(" ", strip=True) for h in soup.select(".authors-full-width h2")],
        "abstract":             t(".abstract-text"),
        "keywords":             t("p:contains('Keywords:')").replace("Keywords:", "").strip(),
        "jel":                  t("p:contains('JEL Classification:')").replace("JEL Classification:", "").strip(),
        "downloads":            "",
        "views":                "",
        "rank":                 "",
        "citation":             t(".suggested-citation"),
    }

    # pages / posted
    note = soup.select_one("p.note-list")
    if note:
        m = re.search(r"(\d+)\s*Pages", note.text);  metadata["pages"]  = m.group(1) if m else ""
        m = re.search(r"Posted:\s*(.+)",   note.text);  metadata["posted"] = m.group(1) if m else ""
    wd = soup.find("p", string=lambda x: x and x.startswith("Date Written"))
    if wd: metadata["written_date"] = wd.get_text(" ", strip=True).split(":",1)[-1].strip()

    # stats
    for stat in soup.select(".stats .stat"):
        label = t(".lbl")
        num   = t(".number").replace(",", "")
        if "download" in label:      metadata["downloads"] = num
        elif "abstract" in label:    metadata["views"] = num
        elif "rank" in label:        metadata["rank"] = num

    # locate *Open PDF in Browser* and capture href (no click needed)
    pdf_btn = browser.find_element(By.CSS_SELECTOR, "a.button-link.secondary[href*='.pdf']")
    pdf_url = urljoin(browser.current_url, pdf_btn.get_attribute("href"))
    print("→ PDF link:", pdf_url)

    # bring over Selenium cookies for authenticated download
    cookie_jar = {c["name"]: c["value"] for c in browser.get_cookies()}
    pdf_path   = _download_with_cookies(pdf_url, save_dir, cookie_jar, referer=url)

    metadata["pdf_path"] = pdf_path
    return pdf_path, metadata

# -----------------------------------------------------------------------------
# quick demo
# -----------------------------------------------------------------------------
def ssrn_main():

    drv = initiate_browser()
    try:
        pdf, meta = ssrn_downloader(drv, "https://papers.ssrn.com/sol3/papers.cfm?abstract_id=5219190",
                                    save_dir="ssrn_pdfs")
        print("\n--- extracted metadata ---")
        for k, v in meta.items():
            print(f"{k:15}: {textwrap.shorten(str(v), 120)}")
    finally:
        drv.quit()

ACADEMIA_START = ("")

# ────────── Raw cookie header copied from your browser ──────────
RAW_COOKIE_HEADER = (
    "request_id=kFhCsKvkkzA-PR6VCOqj8K12akWUV14gNUnJ5shKy-MuG6tsRM4lnQ%3D%3D; "
    "overridden_user_tests=%7B%22mobile_view_tools_menu_fix_july_2023%22%3A%22control%22%7D; "
    "yauic=eyJfcmFpbHMiOnsibWVzc2FnZSI6IkJBaEpJaVl4TkRZek16ZzJOanN6WTJFNU5ERTNOR"
    "GRtTWpNMk16WmxaRFJrWlRJNVpqSUdPZ1pGVkE9PSIsImV4cCI6IjIwMjYtMDctMDNUMTM6MTY6MjYu"
    "Njg5WiIsInB1ciI6ImNvb2tpZS55YXVpYyJ9fQ%3D%3D--24ad2aaeb8eab6c874fe15791cee0959"
    "b7ce0977; "
    "admin_unrecorded_tests=%7B%22auth_system_version%22%3A%7B%22bucket%22%3A%22y_cookie%22%2C"
    "%22buckets%22%3A%5B%22y_cookie%22%2C%22login_token_only%22%5D%7D%7D; "
    "user_id=14633866; "
    "cookie_test=14633866; "
    "single_request_tracker=null; "
    "_cookie_session=67SFme%2FRbu2rwSrEHiEERIE7UrVj7HmZhJVvOPwTmARD2OIIKsxBordBmzXwqszHr"
    "HVhyGSQ5OzXGuYTz03q3MjG7NEkotJ6aODMMqYyYJO%2Bmah88GrL0N44rzY7GvrfxA2aK3Z7Szmbdyf"
    "Wx9ipGTLSbT09oaiExHY4FCw0LNNlij1PZkWxEFQCMOJhsXWncNn1rklNJgMnF%2B%2FCq8a5xb1uT91w"
    "QRN6pgPq5WeqYl%2B9lnfikcl6JXWlOALR22I%2FgQMRPYo%2B7dHtVP6WpoWQFvYDdgcIfDGX98adI3yW"
    "jrqhuUA2W8QPfX6RajIUUi9B29gyJG%2F5g9cNAEgb31NDZ8Vn%2BpaU3m0vh2KfGgDvHiGVGECFax8gf"
    "I1whKBSbD2t7AgmvkXoqkF4tg8jcx0BF5uyl0C98A3uWthnX%2BMyvpQAsOzCMLGZb4onx4dcZYI8kJXGX"
    "PHvjkAsGy2DcRNqc7acv5%2B2zSHtF38EgKHmEEbsMorpoLW5MG%2Fca0vzsdWIoxNTCCw7qhLSqyldrw"
    "q2RtjCQQlKClzF5hU9rn8YhOi8OYzepaK7lOLZilNe%2F4aAb1L2vvFnfUQCMCghgM7APw0Reb95gh2WR"
    "60r--iWfXA898sYctTYBu--WyXwgaPIDf244vyUCkh2Aw%3D%3D"
)


def parse_cookie_header(raw: str) -> dict[str, str]:
    """Convert 'a=1; b=2' into {'a':'1','b':'2'}."""
    return dict(kv.split("=", 1) for kv in raw.split("; ") if "=" in kv)


def extract_pdf_href(html_text: str) -> str | None:
    """
    Look for a direct <a ... href="...pdf"> link in the HTML.
    """
    m = re.search(r'<a[^>]+href="([^"]+\.pdf)"', html_text, re.I)
    if m:  # ordinary “…/file.pdf” link
        return html.unescape(m.group(1))

    # academia now often hides the real link behind “download_file?”
    m = re.search(r'<a[^>]+href="([^"]+download_file\?[^"]+)"', html_text, re.I)
    return html.unescape(m.group(1)) if m else None


def download_academia_pdf(page_url: str, out_dir: str, out_name: str, browser=None) -> bool:
    """
    1) Try pure-HTTP: GET page, parse out direct PDF link, download via requests.
    2) If that fails, fall back to Selenium, click Download PDF, dismiss modal,
       and wait for the file to land in out_dir/out_name.pdf.
    """
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    dest = out_dir / f"{out_name}.pdf"

    # ─── 1) Pure HTTP attempt ───
    sess = requests.Session()
    sess.cookies.update(parse_cookie_header(RAW_COOKIE_HEADER))
    sess.headers.update({
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                      "AppleWebKit/537.36 (KHTML, like Gecko) "
                      "Chrome/138.0.0.0 Safari/537.36",
        "Referer": page_url,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    })
    try:
        print(f"→ Fetching page via HTTP: {page_url}")
        r = sess.get(page_url, timeout=30)
        r.raise_for_status()
        href = extract_pdf_href(r.text)
        if href:
            pdf_url = requests.compat.urljoin(page_url, href)
            print(f"→ Found direct PDF link: {pdf_url}")
            with sess.get(pdf_url, stream=True, timeout=60) as resp:
                resp.raise_for_status()
                total = 0
                with dest.open("wb") as f:
                    for chunk in resp.iter_content(8192):
                        if chunk:
                            f.write(chunk)
                            total += len(chunk)
            if total > 10_000:
                print(f"✓ Downloaded {total} bytes → {dest.resolve()}")
                return True
            print("× HTTP download was zero-byte or too small.")
    except Exception as e:
        print(f"× HTTP attempt failed: {e}")

    # ─── 2) Selenium fallback ───
    print("× Falling back to Selenium automation…")
    try:
        browser.get(page_url)
        wait = WebDriverWait(browser, 15)
        # code to be inserted (no prior code to replace)
        pdf_href = browser.execute_script(
            "const a=document.querySelector(\"a[href*='download_file']\");"
            "return a ? a.href : null;")
        if pdf_href:
            requests.get(pdf_href, stream=True, timeout=60).raise_for_status()
            with open(dest, 'wb') as f:
                f.write(requests.get(pdf_href).content)
            if dest.stat().st_size > 10_000:
                print('✓ Downloaded via JS extraction →', dest)
                return True

        # click the Download PDF button
        btn = wait.until(EC.element_to_be_clickable((
            By.XPATH,
            "//button[contains(translate(.,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'download pdf')]"
        )))
        browser.execute_script("arguments[0].scrollIntoView({block:'center'});", btn)
        btn.click()

        # dismiss upsell modal if it appears
        try:
            no_btn = WebDriverWait(browser, 5).until(EC.element_to_be_clickable((
                By.XPATH,
                "//button[contains(.,\"No thanks\") or contains(.,\"stay on the free tier\")]"
            )))
            no_btn.click()
        except TimeoutException:
            pass

        # wait for the PDF to arrive
        for _ in range(60):
            if dest.exists() and dest.stat().st_size > 10_000:
                print(f"✓ Downloaded via Selenium → {dest.resolve()}")
                return True
            time.sleep(1)
        print("× Selenium download timed out.")
        return False

    finally:
        try:
            pass
        except Exception:
            pass


def donwload_academia_main():
    url = "https://www.academia.edu/download/40986873/Peacetime-Regime_for_state_activities_in_cyberspace.pdf"
    odir = r"C:\Users\luano\PycharmProjects\Back_end_assis\scrapping\Zotero_download_pdfs\downloads"
    oname = "Peacetime_Regime_for_state_activities_in_cyberspace"
    browser = initiate_browser()
    success = download_academia_pdf(url, odir, oname, browser=browser)
    sys.exit(0 if success else 1)

ACADEMIA_END = ("")

CAMBRIDGE_start=""
try:  # optional, but helpful for Cloudflare-guarded PDFs
    import cloudscraper

    _SCRAPER = cloudscraper.create_scraper(
        browser={"browser": "chrome", "platform": "windows", "mobile": False}
    )
except ImportError:
    _SCRAPER = requests.Session()
import requests, re, sys, time
from bs4 import BeautifulSoup
from urllib.parse import urljoin, urlparse

BASE = "https://www.cambridge.org"
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/138.0.0.0 Safari/537.36"
    )
}

# ─────────────────────────────────── CONFIG ────────────────────────────────────
START_URL = "https://www.cambridge.org/core/search?q=ti%3A(attribution%20OR%20%26quot%3Bstate%20responsibility%26quot%3B%20OR%20%26quot%3Bdue%20diligence%26quot%3B%20OR%20deterrence%20OR%20%26quot%3Buse%20of%20force%26quot%3B%20OR%20%26quot%3Barmed%20attack%26quot%3B%20OR%20sovereignty%20OR%20proxy%20OR%20%26quot%3Bcyber%20operation*%26quot%3B%20OR%20%26quot%3Bcyber%20attack*%26quot%3B%20OR%20%26quot%3Bcyber%20deterrence%26quot%3B)%20AND%20(cyber%20AND%20attribution)&aggs%5BproductTypes%5D%5Bfilters%5D=JOURNAL_ARTICLE%2CBOOK_PART&aggs%5BproductSubject%5D%5Bfilters%5D=7C9FB6788DD8D7E6696263BC774F4D5B%2C3BF83347E5E456DAC34F3FABFC8BBF4E&pageNum=1"
OUTPUT_DIR = "downloads/cambridge"
PDF_NAME = "adc0f451a9b560d8a070a753e61e874f"


def parse_cookie_header(header: str) -> Dict[str, str]:
    """
    Return a clean name→value dict from a raw ‘;’-separated header string.
    """
    return {
        k.strip(): v.strip()
        for part in header.split(";")
        if part.strip() and "=" in part
        for k, v in [part.split("=", 1)]
    }


# Copy the exact contents of the "cookie:" header from your browser here:
RAW = "amp-access=amp-4tA31A1BSDI-CdL3qKxD5A; _hjSessionUser_2790984=eyJpZCI6IjE5MDA4OTNiLWI1MjctNTRkYi1hNjYxLWQ2MzRlNjViM2Y3MiIsImNyZWF0ZWQiOjE3MjY4MjU2NjY4ODcsImV4aXN0aW5nIjp0cnVlfQ==; _hjSessionUser_2580298=eyJpZCI6ImRmMjkzZTg3LWUxMDgtNTk3Ny04MDA4LTg2OTRhZDgyOTBiMiIsImNyZWF0ZWQiOjE3MzAxNDgxMzYwOTEsImV4aXN0aW5nIjp0cnVlfQ==; _ga_T0Z29X8SLH=GS1.1.1732539050.7.0.1732539050.60.0.0; _ga_C698Z7BSPE=GS1.2.1738603106.2.0.1738603106.0.0.0; _hjSessionUser_2794783=eyJpZCI6IjBjNzE4MWRkLTdjNTctNWQyZC1hNjcyLWUxYzlmMGY4MzRjMyIsImNyZWF0ZWQiOjE3MzAxNTgzOTgzMDYsImV4aXN0aW5nIjp0cnVlfQ==; _ga_V2ZPLZPB6Z=GS1.1.1738603106.2.0.1738603115.0.0.0; _ga_P7DT1QXXSK=deleted; EULAW=true; preferredCountry=GB; user_country_code=gb; vistaregion=C; locale=en_GB; preferredLocale=en_GB; _fbp=fb.1.1743678922226.693214122895261169; cto_bidid=9myhE19XbHJLSzNPbnpFb1o3dmZhbVZvMVRmZ1NmaGlLODIzeXBkdDI3YVNDdVpjV1YxbVFjakJmbEkzOUZwQWglMkIlMkJuNHJEdjJBWUZ5R1J2eldVeHFxQyUyQndNVFpFVEdJWllYVE5qSFhqcmNXTTVXOCUzRA; cto_dna_bundle=LyYhE19xVmlhOFZtV09xN2xpR3lCSVlCWTF4TjVJOUpPTmlNRSUyRnM1S1BydWg2aUZTNSUyQnZIREZjVDNnSWlrR05MU3BocUtqUjR5bklUZDdyeGh4MHlSME51SFElM0QlM0Q; FCNEC=%5B%5B%22AKsRol_kCml3ZRwTDK4xeexMAPKHU5A7u255zW_FFIaddUhqx6g6nlxcY0Dz1q_ve2vfuiMmfVPXs9bQU7AwydB3mGYGRit-LcCo5UpvgojbjccefCfBEr-RuV-OZXdmT4cHkZSdpCVgRb-mKv8B3K_RV6-Qb3YcoQ%3D%3D%22%5D%5D; cto_bundle=C71ZMV9xVmlhOFZtV09xN2xpR3lCSVlCWTE1QW1SdkFtaW9qTGpSJTJCY043aGdSZFFCVUczMUJZUjc3SFZKQlpGZ2dtM0YlMkJpJTJGWWpwdFhOR2Zha3Rsem85V05ndFdZZGJOUENGeTFKRlUwNktzSDFYVFlvMWJoMVUya245NE9jSFRaSzNBRyUyRkolMkJpZFFKT241TTh2OXV3NTdHOGJ3JTNEJTNE; __gads=ID=b0cb72dcb544c5dc:T=1743678924:RT=1745582506:S=ALNI_MaJcjO4Jm-DOJGi0YUz4GRGf531Hw; __gpi=UID=000010881b7bc13d:T=1743678924:RT=1745582506:S=ALNI_MZdZ-6woawV3X1yEIcy0qLPpalE8A; __eoi=ID=6c4d4c62e27db6d1:T=1743678924:RT=1745582506:S=AA-AfjZJVm94OuvDbS56rCfl-huQ; _sp_id.103f=10e3966d-1344-4f38-8770-a3b69b62d8e3.1745582505.1.1745582515..b8c49949-70b9-468d-8a02-37f5e630b327..35db790e-7d2f-4abc-8280-3fe24f9d83ba.1745582504745.2; _hjDonePolls=1565434%2C1612144; gig_bootstrap_3_ilxJxYRotasZ-TPa01uiX3b8mqBqCacWOQAwcXBW0942jFIXadk2WjeDMV0-Mgxv=login_ver4; SHR_E_ENC=8524ec01102526d7c0994a6a8db233870b102e6e7d0fa21eb93db95170dfaa2e3b7ed7725bcd98696bfc8dfb16ff022bc996a5b7a6b1fb23eeca163975c43db85149ab598d861ad9f373275d4a9f1170740ae0d68092c1ed555552c1a2b863707514f004631ecae0c2a4404a0b6a0fd6c14d7dcfd258de3b8ed9ed808b0ea42af80b96950435abce7fc55ec422503d96eeae17affcb063f38e77482bf94e8b0c54fd1a15f2e5433816d54bb31d6a405f4a7b5ef2f428cd1972bd04686a0cd53dd0227dcb2eff11669a80851d181bdf102c1472bd4cf8b3d6b251a81e345675290a8344af4bee7bf4d386f98f9707b4bbb1b045cf8943624cdeb024a87c6d8323; _gcl_au=1.1.1002158864.1746474406.1221988816.1749829987.1749830463; session=s%3A7H9jxIyolkBCzynrtNNrg0aaWCXeJkeP.U7pcR64MHgTeM7lvTw6X5xS%2F5cOjeQyu52IjKjK2MLM; _gid=GA1.2.963729389.1752053567; _hjSession_2580298=eyJpZCI6ImMyZTVkNDMyLTkxYWYtNGNmNy04YTAyLWFlODQ5N2YxNjdlOCIsImMiOjE3NTIwNTM1Njg0NDgsInMiOjAsInIiOjAsInNiIjowLCJzciI6MCwic2UiOjAsImZzIjowfQ==; KK_CUSTOMER_ID=-144331378; OptanonConsent=isGpcEnabled=0&datestamp=Wed+Jul+09+2025+10%3A33%3A47+GMT%2B0100+(British+Summer+Time)&version=202409.2.0&browserGpcFlag=0&isIABGlobal=false&hosts=&consentId=2650c0fa-8a7a-42c7-9309-5836f82ee9fc&interactionCount=1&landingPath=NotLandingPage&groups=C0001%3A1%2CC0003%3A0%2CC0002%3A0%2CC0004%3A0%2CC0005%3A0&AwaitingReconsent=false&isAnonUser=1; _ga_CK6Q1Q4L6H=GS2.1.s1752053646$o1$g1$t1752053689$j17$l0$h0; _ga_GB4G9R5CB9=GS2.1.s1752053646$o1$g1$t1752053689$j17$l0$h0; _shibsession_64656661756c7468747470733a2f2f73686962626f6c6574682e63616d6272696467652e6f72672f73686962626f6c6574682d7370=_9fc75db44a60b90063e57a04c70fe519; _ga_7PM892EE02=GS2.1.s1752061529$o71$g1$t1752062358$j60$l0$h0; _ga=GA1.1.1625766353.1730148136; cf_clearance=4nRdhAbisxFE.YL50pwU6g9T1h_Zi54CgInClxqvvW4-1752062358-1.2.1.1-jaLh3ly2Hpy9eqWytbXKI22coN0FJsCTdarHQ22Swwce9pw0qFLZSIr6Wjb2E3Ni088cFyH8.6SV0VtQxW8WGt38jtYcy9CCfkCJmuHzHhhTDrs1IRnGkwX8A5ur0UlBshbFgE0PKeZylkojAPxhrzxEYobEs97LdjsQoEsUYv1.CG_CPifB7UFFthkAJqvwWJ6Bg077Wb_ngq0g6elH7Ac3NgSCCHJ5iYPoio.7Y7k; _ga_T8K9FT0CMZ=GS2.2.s1752061529$o57$g1$t1752062359$j60$l0$h0; site24x7rumID=6684449176082267.1752061531833.1752062359469.0; _ga_P7DT1QXXSK=GS2.1.s1752061529$o71$g1$t1752062424$j60$l0$h0; _ga_ZYGQ8432T2=GS2.1.s1752061529$o71$g1$t1752062424$j60$l0$h0; __cf_bm=tTvMt_sSteakBl1NZZc85Csjchkwpw.WCImkqS5R3K4-1752063754-1.0.1.1-VRZVbNMbdQ.Z9hPg66QqRBmUfwv9okg.obJRlXZl1ypRFGHLXQatgeZAX7qschyH1B4RIs2zW0pnHGdJYYy5LrZlAmM6BKKsAUMIhKi5r1w; aca-session=Fe26.2**adec3a4c38cf4ad53f60b059f56276b93274b81298ffdc98c1d09a05a4a43220*vtijUwBWXrmXH8m4jwdgIA*RFiKVaCXDNflnZCqUaf20g3oo7R7sMzKEFMsukvFK2pt2tZM3BQmXFsABcXkX67KTu9EC2BoBXVFT7nK8LZE1znuIYL726o5rl1-zRUAtzs**2d3d70c9271f5d80398e5461ed4f4ad787750884c1d3b4b00a47645d7f24c2fb*SNpDSVuXvebL-1djhN1FuILvQudDsWGaktjVqwx-oMw"
RAW_COOKIE_HEADER = parse_cookie_header(RAW)


def bump_page(url: str) -> str:
    # if pageNum=### present, increment it
    if "pageNum=" in url:
        return re.sub(
            r"(pageNum=)(\d+)",
            lambda m: f"{m.group(1)}{int(m.group(2)) + 1}",
            url
        )
    # otherwise append pageNum=2
    sep = "&" if "?" in url else "?"
    return url + sep + "pageNum=2"


def clean(txt: str | None) -> str:
    return re.sub(r"\s+", " ", txt or "").strip()


def extract_entry(blk: BeautifulSoup) -> dict:
    d = {}
    a = blk.select_one("li.title a")
    d["title"] = clean(a.text) if a else ""
    d["url"] = urljoin(BASE, a["href"]) if a else ""
    part = blk.select_one("li.paragraph_05")
    d["part_of"] = clean(part.text) if part else ""
    d["authors"] = [clean(a.text) for a in blk.select("li.author a")]
    src = blk.select_one("dt.source + dd")
    d["source"] = clean(src.text) if src else ""
    pub = blk.select_one("dt.published + dd span.date")
    d["published_online"] = clean(pub.text) if pub else ""
    pages = blk.select_one(".pages")
    d["pages"] = clean(pages.text) if pages else ""
    ris = blk.select_one("a.export-citation-component")
    d["prod_id"] = ris["data-prod-id"] if ris else ""
    typ = blk.select_one("li.type")
    d["entry_type"] = clean(typ.text) if typ else ""
    abs_div = blk.select_one("div.abstract")
    d["abstract"] = clean(abs_div.text) if abs_div else ""
    pdf = blk.select_one("a[href$='.pdf']")
    d["pdf_link"] = urljoin(BASE, pdf["href"]) if pdf else ""
    return d


def to_ris(rec: dict) -> str:
    lines = []
    ty = "CHAP" if rec["entry_type"].lower().startswith("chapter") else "JOUR"
    lines.append(f"TY  - {ty}")
    for au in rec["authors"]:
        lines.append(f"AU  - {au}")
    lines.append(f"TI  - {rec['title']}")
    if ty == "JOUR":
        lines.append(f"JF  - {rec['source']}")
    else:
        lines.append(f"T2  - {rec['source']}")
    if m := re.search(r"\b(19|20)\d{2}\b", rec.get("published_online", "")):
        year = m.group(0)
        lines.append(f"PY  - {year}")
        lines.append(f"Y1  - {year}")
    if rec["pages"]:
        if "–" in rec["pages"] or "-" in rec["pages"]:
            start, end = re.split(r"[–-]", rec["pages"], 1)
            lines.append(f"SP  - {start.strip()}")
            lines.append(f"EP  - {end.strip()}")
        else:
            lines.append(f"SP  - {rec['pages']}")
    if rec["abstract"]:
        lines.append(f"AB  - {rec['abstract']}")
    lines.append(f"UR  - {rec['url']}")
    if rec.get("pdf_link"):
        lines.append(f"L2  - {rec['pdf_link']}")
    lines.append("ER  -")
    return "\n".join(lines)


# ───────────────────────────────── main crawl ─────────────────────────────────
def crawl_and_save_ris(start_url: str, cookies: RAW_COOKIE_HEADER):
    url = start_url
    ris_recs: list[str] = []
    page = 1

    while True:
        print(f"Page {page}: {url}")
        resp = requests.get(url, headers=HEADERS, cookies=cookies, timeout=30)
        if resp.status_code != 200:
            print("  ! HTTP", resp.status_code)
            break

        soup = BeautifulSoup(resp.text, "html.parser")
        blocks = soup.select("ul.details")
        if not blocks:
            print("  ! No more results, stopping.")
            break

        print(f"  → found {len(blocks)} hits")
        for blk in blocks:
            rec = extract_entry(blk)
            ris = to_ris(rec)
            ris_recs.append(ris)
            print("    ✓", rec["title"])

        page += 1
        url = bump_page(url)
        time.sleep(1.0)

    with open("../academic_databases/cambridge_results.ris", "w", encoding="utf-8") as fh:
        fh.write("\n\n".join(ris_recs))
    print(f"\nSaved {len(ris_recs)} records → cambridge_results.ris")


# if __name__ == "__main__":
#     try:
#         crawl_and_save_ris(START_URL, RAW_COOKIE_HEADER)
#     except KeyboardInterrupt:
#         sys.exit("\nInterrupted by user.")


# ─── STEP 1: discover real PDF URL ───────────────────────────────────────────
def extract_pdf_link(article_url: str, cookies: Dict[str, str]) -> Optional[str]:
    """
    Scrape the article page for its .pdf URL.
    Returns an absolute HTTPS URL or None.
    """
    r = requests.get(article_url, headers=HEADERS, cookies=cookies, timeout=30)
    r.raise_for_status()
    soup = BeautifulSoup(r.text, "html.parser")

    # 1) <meta name="citation_pdf_url" content="…pdf">
    m = soup.select_one('meta[name="citation_pdf_url"]')
    if m and m.get("content", "").endswith(".pdf"):
        return urljoin(BASE, m["content"])

    # 2) the core-services PDF download link
    a = soup.select_one('a[href^="/core/services/aop-cambridge-core/"][href$=".pdf"]')
    if a:
        return urljoin(BASE, a["href"])

    # 3) any other cambridge.org link ending in .pdf
    for a in soup.find_all("a", href=True):
        if a["href"].lower().endswith(".pdf"):
            full = urljoin(BASE, a["href"])
            if "cambridge.org" in full:
                return full

    return None


# ─── STEP 2: robust download of a known PDF URL ─────────────────────────────
def _sanitise_url(url: str) -> str:
    p = urlparse(url)
    if not p.scheme:
        url = "https://" + url
        p = urlparse(url)
    if p.scheme not in ("http", "https"):
        raise ValueError(f"Unsupported URL scheme: {p.scheme}")
    return url


def _save_via_pyautogui(abs_path: str):
    """Invoke Ctrl+S, type the absolute path, press Enter."""
    time.sleep(1)
    pyautogui.hotkey("ctrl", "s")
    time.sleep(0.5)
    pyautogui.typewrite(abs_path)
    time.sleep(0.2)
    pyautogui.press("enter")


def download_direct_pdf(
        browser,
        url: str,
        save_dir: Union[str, Path] = "downloads",
        filename: Optional[str] = None,
        timeout: int = 30,
        size_floor: int = 20_000
) -> Optional[str]:
    """
    Given a direct PDF URL, try HTTP GET (with browser cookies).
    If that fails, use Selenium + Save As via PyAutoGUI.
    Returns the absolute path to the saved .pdf, or None.
    """
    clean_url = _sanitise_url(url)
    out_dir = Path(save_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    # pick a local filename
    local_name = f"{filename}.pdf" if filename else Path(urlparse(clean_url).path).name
    if not local_name.lower().endswith(".pdf"):
        local_name += ".pdf"
    out_path = out_dir / local_name

    # a) try HTTP GET using browser cookies
    session = requests.Session()
    session.headers.update({
        "Accept": "application/pdf",
        "User-Agent": browser.execute_script("return navigator.userAgent;"),
        "Referer": clean_url
    })
    for ck in browser.get_cookies():
        session.cookies.set(ck["name"], ck["value"])

    try:
        resp = session.get(clean_url, stream=True, timeout=timeout)
        resp.raise_for_status()
        if "application/pdf" in resp.headers.get("Content-Type", ""):
            with open(out_path, "wb") as f:
                shutil.copyfileobj(resp.raw, f)
            if out_path.stat().st_size >= size_floor:
                # verify PDF header
                with open(out_path, "rb") as f:
                    if f.read(4) == b"%PDF":
                        print(f"✓ HTTP saved → {out_path.resolve()} ({out_path.stat().st_size // 1024} KB)")
                        return str(out_path.resolve())
            out_path.unlink(missing_ok=True)
    except Exception as e:
        print("⚠ HTTP fetch failed:", e)

    # b) Selenium fallback: open the PDF in‐browser
    browser.get(clean_url)
    WebDriverWait(browser, timeout).until(
        lambda d: d.execute_script("return document.readyState") == "complete"
    )

    # c) trigger Save As
    print("⚠ Falling back to Save As…")
    _save_via_pyautogui(str(out_path.resolve()))

    # wait for file to appear and be > size_floor
    for _ in range(timeout):
        if out_path.exists() and out_path.stat().st_size >= size_floor:
            # verify PDF header
            with open(out_path, "rb") as f:
                if f.read(4) == b"%PDF":
                    print(f"✓ Saved via Save As → {out_path.resolve()} ({out_path.stat().st_size // 1024} KB)")
                    return str(out_path.resolve())
            out_path.unlink(missing_ok=True)
            break
        time.sleep(1)

    print("× Save As fallback failed or file invalid")
    return None


# ─── STEP 3: top-level function ────────────────────────────────────────────
import os, time, tempfile, fitz, shutil, re
from pathlib import Path
from typing import Optional, Union
from urllib.parse import urljoin
from selenium.webdriver.common.by import By
from selenium.webdriver.support     import expected_conditions as EC
from selenium.webdriver.support.ui  import WebDriverWait

def direct_cambridge_download(
        browser,
        pdf_url: str,
        save_dir: Union[str, Path] = Path("downloads"),
        filename: Optional[str] = None,
        timeout: int = 30,
        size_floor: int = 20_000
) -> Optional[str]:
    """
    Try to fetch a Cambridge PDF by HTTP GET (with browser cookies),
    falling back to opening it in‑browser and invoking Save As.
    Returns the absolute path to the saved PDF on success, else None.
    """
    save_dir = Path(save_dir).expanduser().resolve()
    save_dir.mkdir(parents=True, exist_ok=True)

    # determine local filename
    local_name = f"{filename}.pdf" if filename else Path(urlparse(pdf_url).path).name
    if not local_name.lower().endswith(".pdf"):
        local_name += ".pdf"
    out_path = save_dir / local_name

    # a) HTTP GET with cookies
    session = requests.Session()
    session.headers.update({
        "Accept": "application/pdf",
        "User-Agent": browser.execute_script("return navigator.userAgent;"),
        "Referer": pdf_url,
    })
    for ck in browser.get_cookies():
        session.cookies.set(ck["name"], ck["value"])
    try:
        resp = session.get(pdf_url, stream=True, timeout=timeout)
        resp.raise_for_status()
        if "application/pdf" in resp.headers.get("Content-Type", "").lower():
            with open(out_path, "wb") as f:
                shutil.copyfileobj(resp.raw, f)
            if out_path.stat().st_size >= size_floor:
                with open(out_path, "rb") as f:
                    if f.read(4) == b"%PDF":
                        return str(out_path.resolve())
            out_path.unlink(missing_ok=True)
    except Exception:
        pass  # HTTP download failed, fall back

    # b) open in‑browser and Save As
    browser.get(pdf_url)
    WebDriverWait(browser, timeout).until(
        lambda d: d.execute_script("return document.readyState") == "complete"
    )
    # take snapshot of existing PDFs to detect the new one
    before = {p.resolve() for p in save_dir.glob("*.pdf")}

    # invoke Save As dialog
    saved = save_via_dialog(out_path, timeout=timeout)
    if saved:
        return str(saved)

    # c) wait for a new PDF in the folder
    deadline = time.time() + timeout
    while time.time() < deadline:
        for p in save_dir.glob("*.pdf"):
            if p.resolve() not in before and p.stat().st_size >= size_floor:
                try:
                    shutil.move(str(p), str(out_path))
                    if _pdf_is_valid(out_path):
                        return str(out_path.resolve())
                except Exception:
                    if _pdf_is_valid(p):
                        return str(p.resolve())
        time.sleep(0.5)

    return None


def download_cambridge_pdf(
        url: str,
        browser,
        output_folder: Union[str, Path] = Path("downloads"),
        filename: Optional[str] = None,
        timeout: int = 20
) -> str | None | Literal["no available"]:
    """
    Robust Cambridge‑Core PDF fetcher.
      • returns absolute path of a valid PDF
      • returns "no available" if the page is pay‑walled
      • returns None on failure
    """
    out_dir = Path(output_folder).expanduser().resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    fname   = f"{filename}.pdf" if filename else url.rstrip("/").split("/")[-1] + ".pdf"
    target  = (out_dir / fname).resolve()

    # early exit if already good
    if target.exists() and _pdf_is_valid(target):
        return str(target)

    browser.get(url)
    WebDriverWait(browser, timeout).until(
        lambda d: d.execute_script("return document.readyState") == "complete"
    )

    # pay‑wall?
    if browser.find_elements(By.CSS_SELECTOR, 'a.get-access-link[data-test-id="buttonGetAccess"]'):
        return "no available"

    # embedded PDF?
    if browser.find_elements(By.CSS_SELECTOR, 'embed[type="application/pdf"]'):
        saved = save_via_dialog(target, timeout=timeout)
        if saved:
            return str(saved)

    # “Save PDF” dropdown
    dropdown_btn = None
    for sel in (
        'button[data-test-id="buttonSavePDFOptions"]',
        'button#save-pdf-dropdown',
        'button.app-button.dropdown-menu-button',
        "//button[contains(., 'Save PDF')]",
    ):
        try:
            locator = (By.XPATH, sel) if sel.startswith("//") else (By.CSS_SELECTOR, sel)
            dropdown_btn = WebDriverWait(browser, 5).until(
                EC.element_to_be_clickable(locator)
            )
            break
        except TimeoutException:
            continue

    if dropdown_btn:
        browser.execute_script("arguments[0].click();", dropdown_btn)
        try:
            menu = WebDriverWait(browser, 5).until(
                EC.visibility_of_element_located((By.CSS_SELECTOR, "div.pdf-buttons"))
            )
            link = menu.find_element(By.CSS_SELECTOR, 'a[href$=".pdf"]')
            href = link.get_attribute("href")

            # delegate to our direct download helper
            return direct_cambridge_download(
                browser=browser,
                pdf_url=urljoin(browser.current_url, href),
                save_dir=out_dir,
                filename=filename,
                timeout=timeout
            )

        except Exception:
            pass

    # fallback: scrape for hidden PDF link
    try:
        pdf_url = extract_pdf_link(url, cookies={})
        if pdf_url:
            return direct_cambridge_download(
                browser=browser,
                pdf_url=pdf_url,
                save_dir=out_dir,
                filename=filename,
                timeout=timeout
            )
    except Exception:
        pass

    return None








# ─── DEMO ────────────────────────────────────────────────────────────────
def main_cambridge_download():
    test = [
        "https://www.cambridge.org/core/books/state-responsibility-in-the-international-legal-order/contemporary-challenges-to-state-responsibility/265DE66BB26315C6E8AF31C41D9A58D2",
        # "https://www.cambridge.org/core/books/state-responsibility-in-the-international-legal-order/contemporary-challenges-to-state-responsibility/265DE66BB26315C6E8AF31C41D9A58D2",
        # "https://www.cambridge.org/core/journals/icsid-reports/article/continental-casualty-company-v-argentine-republic/7435299678A3B0D247BA5089E3708674"
        #
        #
        # "https://www.cambridge.org/core/journals/asian-journal-of-international-law/article/european-commissions-glass-fibre-fabrics-investigation-and-the-boundaries-between-investment-and-trade/C9281DBAB601C306A5BD1ECDC68B139F",
        # "https://www.cambridge.org/core/journals/business-and-politics/article/statesponsored-cyber-attacks-and-comovements-in-stock-market-returns-evidence-from-us-cybersecurity-defense-contractors/27DEE23ADA7C62EBB8E1BA227BA171D2",
        # "https://www.cambridge.org/core/journals/european-business-organization-law-review-ebor/article/securitisation-the-financial-crisis-and-the-need-for-effective-risk-retention/3DB5A1A7C689A43C2155933F29E4E2A8"

        # "https://www.cambridge.org/core/journals/canadian-yearbook-of-international-law-annuaire-canadien-de-droit-international/article/state-responsibility-for-international-bail-jumping/439E3D3A6DB56941B0BEBF08C8E1CC32",
        # "https://www.cambridge.org/core/journals/leiden-journal-of-international-law/article/restrictivist-reasoning-on-the-ratione-personae-dimension-of-armed-attacks-in-the-post-911-world/65D7AAF6A64778939E522B1FD4C52DFA",
        #
        # "https://www.cambridge.org/core/journals/international-legal-materials/article/ilm-volume-55-issue-3-cover-and-back-matter/0434AF2196930AF5345CD55AA3AB3AD9",
        #
        # "https://www.cambridge.org/core/journals/leiden-journal-of-international-law/article/restrictivist-reasoning-on-the-ratione-personae-dimension-of-armed-attacks-in-the-post-911-world/65D7AAF6A64778939E522B1FD4C52DFA",
        # "https://www.cambridge.org/core/journals/data-and-policy/article/machine-learning-for-detecting-fake-accounts-and-genetic-algorithmbased-feature-selection/CFF82CBC152CDB4397FE9E6A6501915B",
        # "https://www.cambridge.org/core/journals/business-and-politics/article/is-china-responsible-for-its-maritime-militias-internationally-wrongful-acts-the-attribution-of-the-conduct-of-a-parastatal-entity-to-the-state/DE83C05914110C54F1E0E0B72EF61EC8",
        # "https://www.cambridge.org/core/journals/international-law-reports/article/aris-gloves-inc-v-united-states/82CDAA2E2AE12664384444747985ABAE",
        # "https://www.cambridge.org/core/journals/icsid-reports/article/firemans-fund-insurance-company-v-united-mexican-states/96DC75F5E35E587F531086A5A2576A30",
        # "https://www.cambridge.org/core/journals/international-law-reports/article/south-china-sea-arbitration/A946135C6C732F61D5AA78E87AF77C26",
        # "https://www.cambridge.org/core/journals/icsid-reports/article/gavrilovic-and-gavrilovic-doo-v-republic-of-croatia/E4F649381A56F4509A535DF384C3A816",
        # "https://www.cambridge.org/core/journals/international-law-reports/article/abs/h-v-france/5FCC803D740F86B0F51C8F8EA7A5E2EF",
        # "https://www.cambridge.org/core/journals/international-review-of-the-red-cross/article/some-legal-challenges-posed-by-remote-attack/97D7058FB2F1109D3F1D1AA2B9625AD1",
        # "https://www.cambridge.org/core/books/nuclear-weapons/concluding-remarks-on-the-future-of-nuclear-arms-control-and-disarmament/7C19C379BC2118A573106D2B73D5F954",
        # "https://www.cambridge.org/core/journals/international-organization/article/1-resolution-on-the-indonesian-question-adopted-by-the-security-council-january-28-19491/B55DA9D86899E4AB29E40DF4CD3EE2D1",
        # "https://www.cambridge.org/core/books/cyber-operations-and-international-law/measures-of-selfhelp-against-statesponsored-cyber-operations/9281E1AC57728E9D3AC62100B496B895",
        # "https://www.cambridge.org/core/books/states-firms-and-their-legal-fictions/introduction/A87B22AC24999B6B5D3F9DAF1DE06C90",
        # "https://www.cambridge.org/core/services/aop-cambridge-core/content/view/5FCC803D740F86B0F51C8F8EA7A5E2EF/S0309067100017391a.pdf/div-class-title-h-span-class-italic-v-span-france-div.pdf",
        #  "https://www.cambridge.org/core/services/aop-cambridge-core/content/view/93CDE4E4DA925DCD2A375C659DB45543/S0020818322000315a.pdf/div-class-title-free-riding-network-effects-and-burden-sharing-in-defense-cooperation-networks-div.pdf",
        # " https://www.cambridge.org/core/services/aop-cambridge-core/content/view/429B1E7B8AE7C597D33B60E9188186E2/S1532440000007040a.pdf/div-class-title-financial-incentives-in-vertical-diffusion-the-variable-effects-of-obama-s-race-to-the-top-initiative-on-state-policy-making-div.pdf",
        # "https://www.cambridge.org/core/services/aop-cambridge-core/content/view/B99DEC5E305AC88BE95584FD580B31A9/S0309067100042751a.pdf/div-class-title-eis-span-class-italic-et-al-span-claim-div.pdf",
        # "https://www.cambridge.org/core/services/aop-cambridge-core/content/view/80A53F6CED87BA65B100E7A03B00DC16/S1867299X25000315a.pdf/div-class-title-cybersecurity-and-the-fight-against-cybercrime-partners-or-competitors-div.pdf",
        # "https://www.cambridge.org/core/services/aop-cambridge-core/content/view/5BE3F304089907DF4A74EA0794552089/S0309067100040673a.pdf/div-class-title-chemical-natural-resources-span-class-italic-v-span-republic-of-venezuela-div.pdf",
        # "https://www.cambridge.org/core/services/aop-cambridge-core/content/view/D0A4CA2182FF151E8956AD3A568C931F/S0020818300012765a.pdf/div-class-title-cairo-conference-of-nonaligned-nations-div.pdf",
        # "https://www.cambridge.org/core/services/aop-cambridge-core/content/view/B7EC4E49EC58621DE91071942AB867CE/S2633900521000588a.pdf/div-class-title-ampal-american-israel-corp-egi-fund-08-10-investors-llc-egi-series-investments-llc-bss-emg-investors-llc-and-fischer-span-class-italic-v-span-arab-republic-of-egypt-div.pdf",
        # "https://www.cambridge.org/core/services/aop-cambridge-core/content/view/9592F0DE36AF559B2E5E773A1CC4F8BA/9781108494380c5_130-161.pdf/unacknowledged-operations.pdf",
    ]
    # your article URL:
    ARTICLE = "https://www.cambridge.org/core/books/borderless-wars/cyber-attacks-and-cyber-warfare-framing-the-issues/7397E6559636C6F7286E3F1B1240FE39"
    from scrapping.Data_collection_automation.helpers import  initiate_browser
    # you provide a shared browser instance:
    browser = initiate_browser()  # ensure chromedriver is on your PATH
    for url in test:
        try:
            saved = download_cambridge_pdf(url = url, browser=browser,  )
            if saved:
                print("✅ Download complete:", saved)
            else:
                print("❌ Download failed.")
        except Exception as e:
            print(f"⚠️ Error downloading {url}: {e}")
# main_cambridge_download()
CAMBRIDGE_end = ("")
GENERIC_DOWNLOAD_START = ""

def download_file(
    url: str,
    output_folder: Union[str, Path] = Path("downloads"),
    filename: Optional[str] = None
) -> bool:
    """
    Downloads the file at `url` into `output_folder`, saving it as
    `filename` if provided (otherwise uses the URL’s basename).
    Returns True on success, False on error.
    """
    try:
        # ensure output_folder is a Path
        output_folder = Path(output_folder)
        output_folder.mkdir(parents=True, exist_ok=True)

        # decide the local filename
        local_name = f"{filename}.pdf" if filename else Path(url).name
        local_path = output_folder / local_name

        print(f"Downloading {url}")
        with requests.get(url, stream=True, timeout=30) as r:
            r.raise_for_status()
            total = 0
            with open(local_path, "wb") as f:
                for chunk in r.iter_content(chunk_size=8192):
                    if chunk:
                        f.write(chunk)
                        total += len(chunk)

        if total == 0:
            print(f"× Downloaded zero bytes; aborting.")
            return False

        print(f"✓ Saved {total} bytes to {local_path.resolve()}")
        return True

    except requests.RequestException as e:
        print(f"× Error downloading {url}: {e}")
        return False


GENERIC_DOWNLOAD_END = ()

ECONSTOR_START = ()

# ---------------------------------------------------------------------------#
# 1)  perfectly-mirrored browser headers (incl. the full cookie)             #
# ---------------------------------------------------------------------------#
HEADERS = {
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,"
              "image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    "Accept-Encoding": "gzip, deflate, br, zstd",
    "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
    "Cache-Control": "max-age=0",
    "Connection": "keep-alive",
    "If-Modified-Since": "Tue, 05 Nov 2024 14:53:06 GMT",
    "Referer": "https://www.econstor.eu/handle/10419/305235",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-User": "?1",
    "Sec-CH-UA": "\"Not)A;Brand\";v=\"8\", \"Chromium\";v=\"138\", \"Google Chrome\";v=\"138\"",
    "Sec-CH-UA-Mobile": "?0",
    "Sec-CH-UA-Platform": "\"Windows\"",
    "Upgrade-Insecure-Requests": "1",
    "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                   "AppleWebKit/537.36 (KHTML, like Gecko) "
                   "Chrome/138.0.0.0 Safari/537.36"),
    "Cookie": (
        "JSESSIONID=20941E8F8C922C83227D789473B0D12D; "
        "techaro.lol-anubis-auth="
        "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhY3Rpb24iOiJDSEFMTEVOR0UiLCJjaGFsbGVuZ2UiOiI0"
        "YTlhODZlOWM0ZGJmYmY4IiwiZXhwIjoxNzUyMTU3NTM3LCJpYXQiOjE3NTE1NTI3MzcsIm1ldGhvZCI6ImZh"
        "c3QiLCJuYmYiOjE3NTE1NTI2NzcsInBvbGljeVJ1bGUiOiJhYzk4MGY0OWM0ZDM1ZmFiIn0."
        "rk2ElNGT-zB_6WprmD1DaiLaUaOCe285iAo8BWpyFAdMu-mxKj1PD8TzVr6BatrSrDgLhDysenA8vZkPt0nKDw"
    ),
}


# ---------------------------------------------------------------------------#
# 2)  internal helper to pull the *first* PDF URL we can locate              #
# ---------------------------------------------------------------------------#
def _extract_pdf_url(markup: str, response_link_header: Optional[str] = None) -> Optional[str]:
    # A) HTTP “Link:” header ⇒ rel="item" type="application/pdf"
    if response_link_header:
        m = re.search(r'<([^>]+\.pdf)>\s*;\s*rel="item"', response_link_header, re.I)
        if m:
            return html.unescape(m.group(1))

    # B) precise <h1 id="itemtitle"><a href="…pdf">
    m = re.search(
        r'<h1[^>]+id=["\']itemtitle["\'][^>]*>.*?<a[^>]+href=["\']([^"\']+\.pdf)',
        markup,
        re.I | re.S,
    )
    if not m:
        # C) bitstream link anywhere in the HTML
        m = re.search(r'href=["\']([^"\']*bitstream[^"\']+\.pdf)["\']', markup, re.I)

    if not m:
        # D) any anchor ending in .pdf (BeautifulSoup scan)
        soup = BeautifulSoup(markup, "html.parser")
        for a in soup.find_all("a", href=True):
            if a["href"].lower().endswith(".pdf"):
                return a["href"]
        return None

    return html.unescape(m.group(1))


# ---------------------------------------------------------------------------#
# 3)  public API – download_econstor_pdf                                      #
# ---------------------------------------------------------------------------#
def download_econstor_pdf(
        page_url: str,
        out_dir: str,
        out_name: str,
        allow_selenium: bool = False,
        browser=None
) -> Optional[str]:
    """Return absolute path to the saved PDF, or None on failure."""
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    # ── first, plain HTTP ----------------------------------------------------
    print(f"→ Fetching: {page_url}")
    resp = requests.get(page_url, headers=HEADERS, timeout=30)
    resp.raise_for_status()
    pdf_url = _extract_pdf_url(resp.text, resp.headers.get("Link"))

    # ── if still nothing and Selenium is allowed ----------------------------
    if not pdf_url and allow_selenium:
        print("→ PDF not found in raw HTML – trying Selenium …")
        try:

            try:
                browser.get(page_url)
                time.sleep(3)
                pdf_url = _extract_pdf_url(browser.page_source)
            finally:
                pass
        except Exception as e:
            print(f"× Selenium failed: {e}")

    if not pdf_url:
        print("× Could not find PDF link on the EconStor page.")
        return None

    if pdf_url.startswith("/"):
        pdf_url = "https://www.econstor.eu" + pdf_url
    print(f"→ PDF URL: {pdf_url}")

    r = requests.get(pdf_url, headers=HEADERS, stream=True, timeout=60)
    if (
            r.status_code != 200
            or not r.headers.get("Content-Type", "").lower().startswith("application/pdf")
    ):
        print(f"× Failed to download PDF, status={r.status_code}")
        return None

    out_path = out_dir / f"{out_name}.pdf"
    total = 0
    with out_path.open("wb") as fh:
        for chunk in r.iter_content(8192):
            if chunk:
                fh.write(chunk)
                total += len(chunk)

    if total == 0:
        print("× Zero-byte PDF – download failed.")
        return None

    print(f"✓ Saved as {out_path.resolve()}  ({total:,} bytes)")
    return str(out_path)


# ---------------------------------------------------------------------------#
def main_econstor_download() -> None:
    PAGE = "https://www.econstor.eu/handle/10419/305235"
    DEST = "downloads"
    NAME = "attribution_dividend"

    ok = download_econstor_pdf(PAGE, DEST, NAME, allow_selenium=False)
    sys.exit(0 if ok else 2)


ECONSTOR_END = ("")

ELGARONLINE_START = ()


def download_elgar_pdf(
        url: str,
        out_dir: str = ".",
        cookie_header: str = "",
        browser=None  # you won’t need Selenium here
) -> str | None:
    """
    Download a PDF from an Elgar Online chapter or abstract page.
    Args:
        url: the ElgarOnline page URL ending in .xml
        out_dir: directory to save the PDF into
        cookie_header: full Cookie header if authentication is required
    Returns:
        the full path to the saved PDF on success, or None on failure.
    """
    headers = {"User-Agent": "Mozilla/5.0"}
    if cookie_header:
        headers["Cookie"] = cookie_header

    # 1) fetch the page
    try:
        res = requests.get(url, headers=headers, timeout=30)
        res.raise_for_status()
    except Exception as e:
        print(f"× HTTP error fetching page: {e}")
        return None

    # 2) find the download link (it contains "downloadpdf")
    m = re.search(r'href="([^"]+downloadpdf[^"]+)"', res.text, re.I)
    if not m:
        print("× PDF download link not found on ElgarOnline page. Ensure you have access (cookie may be required).")
        return None

    pdf_url = m.group(1)
    if pdf_url.startswith("/"):
        pdf_url = "https://www.elgaronline.com" + pdf_url

    # 3) download the PDF
    try:
        pdf_res = requests.get(pdf_url, headers=headers, stream=True, timeout=60)
        pdf_res.raise_for_status()
    except Exception as e:
        print(f"× Failed to download Elgar PDF: {e}")
        return None

    # write it out
    out_path = Path(out_dir)
    out_path.mkdir(parents=True, exist_ok=True)
    filename = Path(pdf_url).name.split("?", 1)[0] or "ElgarChapter.pdf"
    full_path = out_path / filename

    total = 0
    with open(full_path, "wb") as f:
        for chunk in pdf_res.iter_content(8192):
            if chunk:
                f.write(chunk)
                total += len(chunk)

    if total == 0:
        print("× Zero-byte PDF – download failed.")
        return None

    print(f"✓ Saved Elgar Online PDF as {full_path.resolve()} ({total:,} bytes)")
    return str(full_path.resolve())


def main_elgaronline_download():
    # Example usage:
    page_url = "https://www.elgaronline.com/edcollchap/book/9781035308514/book-part-9781035308514-14.xml"
    # If the PDF is gated, paste your full browser Cookie header here:
    cookie = ""
    download_elgar_pdf(page_url, out_dir="downloads", cookie_header=cookie)

ELGARONLINE_END = ("")

HEIN_ONLINE_START = ()

def inject_hein_cookies(driver, cookies, domain="heinonline.org"):
    """
    • First navigates to https://{domain}/ so Chrome will accept the cookie.
    • Accepts either a raw header string or a dict.
    • Adds secure + SameSite=None so Chrome ≥80 won’t reject them.
    """
    # 0) Make sure we’re on the right domain
    root_url = f"https://{domain}/"
    if not driver.current_url.startswith(root_url):
        driver.get(root_url)

    # 1) Convert raw “;”-header → dict if needed
    if isinstance(cookies, str):
        pairs = (c.strip().split("=", 1) for c in cookies.split(";") if c.strip())
        cookies = {k: v for k, v in pairs}

    # 2) Feed each cookie.  If Chrome still balks, just skip that one.
    for name, value in cookies.items():
        try:
            driver.add_cookie(
                {
                    "name":     name,
                    "value":    value,
                    "domain":   domain,
                    "path":     "/",
                    "secure":   True,          # needed because Hein sets Secure
                    "sameSite": "None",        # avoid Chrome samesite‐by-default
                }
            )
        except Exception as exc:
            print(f"⚠️  cookie {name!r} skipped → {exc.__class__.__name__}")





# ───────────────────────────────────────── tab-safety helper ──────────────────────────────────────
def ensure_active_tab(driver: WebDriver) -> bool:
    """Switch to a live window handle if the current one is dead."""
    handles = driver.window_handles
    if not handles:
        return False
    try:
        # Touching current_url raises if the handle is invalid.
        _ = driver.current_url
        return True
    except Exception:
        driver.switch_to.window(handles[0])
        return True


def _copy_cookies_from_browser(driver, sess: requests.Session) -> None:
    """Dump *all* live cookies from Selenium → requests.Session()"""
    for ck in driver.get_cookies():
        sess.cookies.set(ck["name"], ck["value"],
                         domain=ck.get("domain", ".heinonline.org"),
                         path=ck.get("path", "/"))
# ───────────────────────────────────────── main download routine ───────────────────────────────────
def heinonline_download_pdf(
    driver: WebDriver,
    page_url: str,
    output_folder: str,
    pdf_filename: str,
) -> bool | str | pathlib.Path:
    """
    1. Load `page_url`
    2. If the page shows “Full Text Not Currently Available…”, grab the publisher link.
    3. Otherwise perform the MojoCallback (if present) to prime the tokens/cookies.
    4. Locate—or, as a fallback, *extract*—the PrintRequest URL
       and download the PDF that it yields.
    5. Save to `output_folder/pdf_filename.pdf`.
    """

    # ───── helper ────────────────────────────────────────────────────────────
    def _dest(name: str) -> pathlib.Path:
        return pathlib.Path(output_folder).expanduser().resolve() / f"{name}.pdf"

    # 0) prime a fresh session on the root domain and inject your cookies
    driver.get("https://heinonline.org")
    sleep(2)
    inject_hein_cookies(driver, HEIN_COOKIES)

    try:
        page_url = page_url.split("§", 1)[0]          # drop section anchors
        print("Navigating →", page_url)
        driver.get(page_url)
        sleep(2)

        # ───── 0·5) run MojoCallback once ­­­­­­­­­­­­­­­­­­­­­­­­­­­­­­­­­­­­­­
        src = driver.page_source
        if "/HOL/MojoCallback?" in src:
            cb_path = re.search(r"(/HOL/MojoCallback\?[^\"'>]+)", src).group(1)
            cb_url  = urljoin(driver.current_url, cb_path)
            print("▶ MojoCallback:", cb_url)
            driver.get(cb_url)
            WebDriverWait(driver, 10).until(lambda d: "/HOL/Page?" in d.current_url)
            driver.get(page_url)                      # back to real page
            sleep(2)

        # ───── 0·6) subscription guard ────────────────────────────────
        if driver.find_elements(By.XPATH, '//div[@class="col-xs-12"]/h2[normalize-space()="Not Subscribed"]'):
            print("× Subscription required: no PDF available")
            return "no available"

        # ───── 1) “Full text not available” guard ­­­­­­­­­­­­­­­­­­­­­­­­­­­­­
        if "Full Text Not Currently Available on HeinOnline" in driver.page_source:
            pub_link = driver.find_element(
                By.CSS_SELECTOR,
                "div.col-lg-6.col-md-8.col-sm-8.col-xs-12.thin-border.margin a"
            ).get_attribute("href")
            print("⚠ Not on HeinOnline → returning publisher URL:", pub_link)
            return pub_link

        wait = WebDriverWait(driver, 20)

        # ───── 2) robustly locate the toolbar PDF link ­­­­­­­­­­­­­­­­­­­­­­­
        try:
            pdf_link = wait.until(EC.presence_of_element_located((
                By.CSS_SELECTOR,
                # ① original selector
                "div.btn-toolbar.fa-20 a[title='Download PDF of This Section'],"
                # ② 2025 refresh selector (no title attr, but SVG icon present)
                "div.btn-toolbar.fa-20 a[href*='PrintRequest']",
            )))
            base_href = unquote(pdf_link.get_attribute("href"))
        except TimeoutException:
            # ── 2·b) toolbar never appeared – scan HTML for PrintRequest
            print("• Toolbar not rendered – falling back to HTML scrape")
            m = re.search(r"(/cgi-bin/PrintRequest[^\"'> ]+)", driver.page_source)
            if not m:
                print("× No PrintRequest link found; giving up.")
                return False
            base_href = unquote(m.group(1))

        # always strip any lingering &id=NN segment and add the correct page #
        base_href = re.sub(r"&id=\d+", "", base_href)
        current_id = driver.find_element(By.ID, "pageSelect").get_attribute("value") or "1"
        pdf_req_url = urljoin(driver.current_url, f"{base_href}&id={current_id}")
        print("PrintRequest URL:", pdf_req_url)

        # ───── 3) build headers & cookie jar for Requests ­­­­­­­­­­­­­­­­­­­
        cookies = {c["name"]: c["value"] for c in driver.get_cookies()}
        headers = {
            "User-Agent": driver.execute_script("return navigator.userAgent;"),
            "Referer": page_url,
            "Accept": "application/pdf,application/octet-stream;q=0.9,*/*;q=0.5",
        }
        if xsrf := cookies.get("XSRF-TOKEN"):
            headers["X-XSRF-TOKEN"] = xsrf

        def fetch(u: str) -> requests.Response:
            return requests.get(
                u, headers=headers, cookies=cookies,
                stream=True, allow_redirects=True, timeout=30
            )

        resp = fetch(pdf_req_url)

        # ───── 4) follow *one* client-side redirect, if any ­­­­­­­­­­­­­­­­­­
        if "pdf" not in resp.headers.get("Content-Type", "").lower():
            html = resp.text
            redir = (re.search(r'url[ ="\']+([^"\' >;]+)', html, re.I)
                     or re.search(r'window\.location(?:\.href)?[ ="\']+([^"\']+)', html, re.I))
            if redir:
                resp.close()
                redirect_url = urljoin(pdf_req_url, redir.group(1))
                print("↪ following redirect →", redirect_url)
                resp = fetch(redirect_url)

        if "pdf" not in resp.headers.get("Content-Type", "").lower():
            print("× Still not a PDF – abort.")
            return False

        # ───── 5) write the PDF ­­­­­­­­­­­­­­­­­­­­­­­­­­­­­­­­­­­­­­­­­­­­­­­
        out_path = _dest(pdf_filename)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        with out_path.open("wb") as fh:
            for chunk in resp.iter_content(8192):
                if chunk:
                    fh.write(chunk)
        size = out_path.stat().st_size
        resp.close()

        if size < 20_000:     # sanity: <20 KB is almost certainly an error page
            print("× File too small – probably not the article.")
            out_path.unlink(missing_ok=True)
            return False

        print(f"✓ Saved {size:,} bytes → {out_path}")
        return out_path

    except Exception as exc:
        print("× Unexpected error:", exc)
        import traceback; traceback.print_exc()
        return False



# ───────────────────────────────────────── driver bootstrap ───────────────────────────────────────

def main_heinonline_download():
    from scrapping.Data_collection_automation.helpers import initiate_browser
    driver = initiate_browser()
    try:


        heinonline_download_pdf(
            driver=driver,
            page_url="https://heinonline.org/HOL/Page?public=true&handle=hein.kluwer/eurofa0024&div=19&start_page=203&collection=kluwer&set_as_cursor=120&men_tab=srchresults",
            output_folder=r"C:\Users\luano\PycharmProjects\Back_end_assis\scrapping\Zotero_download_pdfs",
            pdf_filename="test_document",
        )
    finally:
        try:
            driver.quit()
        except Exception:
            pass
HEIN_ONLINE_END = ("")
IEEE_START = ()

BASE_DOMAIN = "ieeexplore.ieee.org"


# ─── CONFIGURE YOUR COOKIES HERE ───────────────────────────────────────────────
# Copy the "cookie:" header from your browser (everything after 'cookie: ')
RAW_COOKIE_HEADER = (
    "fp=3cfb96df9fc4fc341ccd70f7ee4084ce; "
    "s_ecid=MCMID%7C16591297131697904950127390734315358058; "
    "osano_consentmanager_uuid=186a9dd5-aa0a-42a7-9fc9-324c4e8a4492; "
    "osano_consentmanager=SrlplXImWjqIUMh8ZMStv4u3MzUA6bHvxvqQrHtKh6Vm_ozHGC77465RMqqCWWc2gMzzzFMeQtdSrQ11MjUEkGbFJqhxPvITmq4JjeMGLBfKAxGv5Qlrf34dd3-WU9izAAQDvapD5KOkUfy7CjOuZ8PM2Eul3NUWvf87q_W3PL-rBET8DGyS5H3xSzZaUSHPgyNmFZEb4IRwybFniRAe4DkrzIXNoOHa9D4sw_wfqDpSil29YGO405VkU9axB4tffFt60Tzt4_C4XC0NzGKyKjjT6IQggLM912itNXgag6smmtr3dCiX37QN2cPUgB9_; "
    "_zitok=7ac8159b81547bba0fd61743617460; "
    "AMCV_8E929CC25A1FB2B30A495C97%40AdobeOrg="
    "281789898%7CMCMID%7C16591297131697904950127390734315358058%7C"
    "MCIDTS%7C20253%7CMCAID%7C338A69942724F0C2-40001CF740554FF0%7C"
    "MCOPTOUT-1749833890s%7CNONE%7CMCAAMLH-1750431490%7C6%7C"
    "MCAAMB-1750431490%7Cj8Odv6LonN4r3an7LhD3WZrU1bUpAkFkkiY1ncBR96t2PTI%7C"
    "MCSYNCSOP%7C411-20260%7CvVersion%7C4.1.0; "
    "s_vi=[CS]v1|338A69942724F0C2-40001CF740554FF0[CE]; "
    "ipCheck=82.13.63.56; "
    "CloudFront-Key-Pair-Id=KBLQQ1K30MUFK; "
    "JSESSIONID=07FD73771E164AC1003CCA762797DDD5; "
    "ERIGHTS=OhB0Bpo3z9Jqg1z0fZRoV6pP0IUS4ktV-18x2dasBRsoPfMmvqaQSdx2FtgLIgx3Dx3Dx2F0FIAZVztxx3AC6IfrKMQkgx3Dx3D-kt9qdxxIkgOVRBopCx2FotxxXwx3Dx3D-fQSCesbSmuhiHx2Bdp5bwQwwx3Dx3D; "
    "WLSESSION=4177621514.47873.0000; "
    "TS016349ac=01f15fc87cd5669f5551db5e288dc6ff8d2c7fee50b791ebc25e18e8b1c3e7af1539fc429788e01ae610ba8e191b645e0bca58a473; "
    "CloudFront-Policy=eyJTdGF0ZW1lbnQiOiBbeyJSZXNvdXJjZSI6Imh0dHBzOi8vaWVlZXhwbG9yZS5pZWVlLm9yZy9tZWRpYXN0b3JlL0lFRUUv"
    "Y29udGVudC9tZWRpYS84NzUxOTQ3Lzg3NTY2MzMvODc1NzE0MS8qIiwiQ29uZGl0aW9uIjp7"
    "IkRhdGVMZXNzVGhhbiI6eyJBV1M6RXBvY2hUaW1lIjoxNzUxNDkwMzU4fSwiSXBBZGRyZXNzIjp7"
    "IkFXUzpTb3VyY2VJcCI6IjgyLjEzLjYzLjU2In19fV19; "
    "CloudFront-Signature=cjp~~CGk4kEwLXFTph90bMN4rr690MO6Qos7gdY92W5UdZ15nd81lpfOkDea5-OgTdx5rKY4I~rLgfhsDJfqhP6G1yql63OQMzMK4fzau9mrEMDGG~A6HrCKOwgUppLBnFh~tGGG5iJI0HpAglL7-95qzouV8FyaMKIeYJAlKGUMHKt742e-1D1Wv6L1oBEimZ3XYAhL4dplHu2HGEBc9fQoA-"
    "ivtDQqYJDGcBbOBMLvBHooqxz1qUNEE-rIq8AhOP-faCYHUUFxyVhJCXgquDO-b-k-oxXUD~V6ezGgvpNiWl8MOTLh3z98b2PP13Q9m9AFsrg2jhqfjOgM5SNIgg__; "
    "xpluserinfo=eyJpc0luc3QiOiJ0cnVlIiwiaW5zdE5hbWUiOiJVbml2ZXJzaXR5IENvbGxlZ2UgTG9uZG9uIiwicHJvZHVjdHMiOiJFQk9PS1M6MTk3NDoyMDIyfE1JVFA6MTk0MzoyMDIxfE5PV0NTRUM6MjAxODoyMDE4fFdJTEVZVEVMRUNPTToyMDE5OjIwMTl8SUJNOjE4NzI6MjAyMHxOT1dDU0VDOjIwMTk6MjAxOXxOT1dDU0VDOjIwMjA6MjAyMHxXSUxFWVRFTEVDT006MjAxNToyMDE2fFdJTEVZU0VNSUNPTkRVQ1RPUlM6MjAyNDoyMDI0fFBVUDoyMDI0OjIwMjR8"
    "V0lMRVlBSToyMDI0OjIwMjR8Tk9XQUlFQzoyMDI1OjIwMjV8Tk9LSUEgQkVMTCBMQUJTfElTT0w1NXxNQ0NJUzV8TUNTWU5USDF8TUNTWU5USDJ8TUNTWU5USDN8TUNTWU5USDR8TUNTWU5USDV8"
    "TUNTWU5USDZ8TUNTWU5USDd8TUNTWU5USDN8TUNDSVM2fE1DQ0lTN3xJU09MODV8TUNTWU5USDh8"
    "TUNDSVM4fE1DQ0lTOXxNQ1NZTlRIOXxNSVRQX0RJU0NPTlRJTlVFRHxNQ0NJUzR8TUNTWU5USDEwfE1DQ0lTNXxNQ1NZTlRIMTF8SUVMfElFTHxWREV8In0=; "
    "seqId=8191; "
    "AWSALBAPP-0=AAAAAAAAAAA8mdyayk0RQG75UYisd8GCc/YYHprdYieVoj8jdrMIje34Wy6jSz2PLLeAmP9bcBPFZeodH5rRjYzvzs0SxtD0iotcEAHns+bkYVZH+bOT0+Vy87AY0Itjqm/ZKytDtK6yYWh+qfx+s48HsDZQpc6lt7Fk4nModO8bQmKnbUkjKZp6tu46X24uLTwAGNhV/P5HzhrH1i6qkw==; "
    "TSaf720a17029=0807dc117eab28004391f0c2a153fdf190493adc4eac814569af2fc178d13f165476736f624377ede2810c0d93b61b6c; "
    "TS8b476361027=0807dc117eab20000cf93ce7fad97e0e7fe3472235939ccedecd49195230a52039e56a9bf959b7d3080cefefb4113000e39f17566720a86d41ef45b8599a272529fe4515212e52c77126cb2a23d06782801e0c654aaea93ab65ac39a7cbf70cd; "
    "utag_main=v_id:0192bf14c01c0015c8af89657eff0507d004007500fb8$_sn:33$_se:4$_ss:0$_st:1751490360528$vapi_domain:ieeexplore.ieee.org$ses_id:1751488415171%3Bexp-session$_pn:2%3Bexp-session"
)
def parse_cookies(raw: str) -> Dict[str, str]:
    out = {}
    for kv in raw.split(";"):
        if "=" in kv:
            k, v = kv.strip().split("=", 1)
            out[k] = v
    return out

COOKIES = parse_cookies(RAW_COOKIE_HEADER)

# ── tiny Chrome helpers ───────────────────────────────────────────────────
uc.Chrome.__del__ = lambda self: None

def launch_browser_copy(profile: str = "Profile 1",
                        download_dir: str | Path = None) -> uc.Chrome:
    """
    Copy your real Chrome 'profile' into a temp folder and launch Chrome
    pointed at that copy, with download directory set to `download_dir`.
    """
    opts = uc.ChromeOptions()
    opts.add_argument("--disable-blink-features=AutomationControlled")

    # copy profile
    if os.name == "nt":
        user_data = Path(os.environ["LOCALAPPDATA"]) / "Google/Chrome/User Data"
    else:
        user_data = Path.home() / ".config/google-chrome"
    src = user_data / profile
    temp_root = Path(tempfile.mkdtemp("selenium-profile-"))
    dst = temp_root / profile
    shutil.copytree(src, dst, dirs_exist_ok=True)

    # point Chrome there
    opts.add_argument(f"--user-data-dir={temp_root}")
    opts.add_argument(f"--profile-directory={profile}")

    # set download prefs
    if download_dir:
        download_dir = Path(download_dir).resolve()
        download_dir.mkdir(parents=True, exist_ok=True)
        prefs = {
            "download.default_directory": str(download_dir),
            "download.prompt_for_download": False,
            "plugins.always_open_pdf_externally": True,
        }
        opts.add_experimental_option("prefs", prefs)

    return uc.Chrome(options=opts)



def inject_cookies(driver: uc.Chrome, cookies: Dict[str, str]) -> None:
    for k, v in cookies.items():
        driver.add_cookie({
            "name": k, "value": v,
            "domain": BASE_DOMAIN, "path": "/",
            "secure": True, "httpOnly": False,
        })

# ── URL helpers ───────────────────────────────────────────────────────────
ARN_RE = re.compile(r"/document/(\d+)")
def build_stamp_url(abstract_url: str) -> str:
    m = ARN_RE.search(abstract_url)
    if not m:
        raise ValueError("Cannot extract arnumber from URL")
    ar = m.group(1)
    return f"https://{BASE_DOMAIN}/stamp/stamp.jsp?tp=&arnumber={ar}"

# ── HTML parsing fallback (no Selenium) ───────────────────────────────────
IFRAME_RE = re.compile(r'<iframe[^>]+src="([^"]*getPDF\.jsp[^"]+)"', re.I)
META_RE   = re.compile(r'http-equiv=["\']refresh["\'][^>]*url=([^"\' >;]+)', re.I)

def extract_pdf_from_html(html: str, base: str) -> str | None:
    m = IFRAME_RE.search(html)
    if m:
        return urljoin(base, m.group(1))
    m = META_RE.search(html)
    if m:
        return urljoin(base, m.group(1))
    return None

def resolve_pdf_fragment_selenium(driver: uc.Chrome,
                                   stamp_url: str,
                                   timeout: int = 20) -> str | None:
    driver.get(stamp_url)
    wait = WebDriverWait(driver, timeout)
    try:
        frame = wait.until(EC.presence_of_element_located(
            (By.CSS_SELECTOR, 'iframe[src*="getPDF.jsp"]')
        ))
        return frame.get_attribute("src")
    except TimeoutException:
        return None
def perform_institutional_login_steps(
    driver: WebDriver,
    institution_name: str = "University College London",
    timeout: int = 15,
    tiny_wait: float = 0.3,
) -> None:
    """
    0) If the Microsoft login page (id="i0116") appears, fill email + password + confirm.
    1) Otherwise, if the top‐bar “Institutional Sign In” link is clickable → click it.
    2) If a one‐click “Access Through <inst>” button appears → click → return.
    3) Else, type the inst name into the search box, wait, click the result.
    """
    wait = WebDriverWait(driver, timeout)

    # ───────────────────────────────────────────────── Microsoft login first ─────────
    try:
        # 0.a) email
        email = wait.until(EC.visibility_of_element_located((By.ID, "i0116")))
        email.clear()
        email.send_keys("ucablrs@ucl.ac.uk")
        email.send_keys(Keys.ENTER)
        print("Entered institutional email, submitted.")

        # 0.b) password
        pwd = wait.until(EC.visibility_of_element_located((By.ID, "i0118")))
        pwd.clear()
        pwd.send_keys(os.environ["UCL_PASSWORD"])
        pwd.send_keys(Keys.ENTER)
        print("Entered password, submitted.")

        # 0.c) "Yes"/"Sim" stay signed in button
        stay = wait.until(EC.element_to_be_clickable((By.ID, "idSIButton9")))
        stay.click()
        print("Confirmed stay signed in.")
        time.sleep(5)
        return

    except TimeoutException:
        # not on MS login page
        pass

    # ───────────────────────────────────────────────── Institutional Sign In ─────────
    short = WebDriverWait(driver, 3)
    try:
        sign_in = short.until(EC.element_to_be_clickable(
            (By.CSS_SELECTOR, "div.institution-container.hide-mobile a.inst-sign-in")
        ))
        time.sleep(tiny_wait)
        sign_in.click()
        print("Clicked header “Institutional Sign In”.")
    except TimeoutException:
        print("No header sign-in link (maybe already on login page or signed in).")

    # ──────────────────────────────────────────────── one-click “Access Through Your Institution”
    try:
        access_btn = short.until(EC.element_to_be_clickable(
            (By.CSS_SELECTOR, "div.seamless-access-btn-idp")
        ))
        label = access_btn.find_element(By.CLASS_NAME, "heading").text.strip()
        if institution_name.lower() in label.lower():
            time.sleep(tiny_wait)
            access_btn.click()
            print(f"Clicked one-click “Access Through {label}”.")
            return
        else:
            print("Found quick-access button for a different institution; skipping.")
    except TimeoutException:
        print("No quick-access institutional button; falling back to search.")

    # ────────────────────────────────────────────────────────────── search box fallback
    try:
        search = wait.until(EC.visibility_of_element_located(
            (By.XPATH, "//input[@aria-label='Search for your Institution']")
        ))
        search.clear()
        search.send_keys(institution_name)
        print(f"Typed “{institution_name}” into search box.")
    except TimeoutException as e:
        raise TimeoutException("Institution search input not found.") from e

    time.sleep(3)  # let React update results

    # click the first result by ID or text
    try:
        link = driver.find_element(By.ID, institution_name)
    except NoSuchElementException:
        link = wait.until(EC.element_to_be_clickable((
            By.XPATH,
            f"//a[normalize-space()='{institution_name}' or .//span[normalize-space()='{institution_name}']]"
        )))
    time.sleep(tiny_wait)
    link.click()
    print(f"Clicked search result for “{institution_name}”.")
    time.sleep(5)
# ── helpers that try pure-HTTP before Selenium ────────────────────────────
def try_direct_endpoint(sess: requests.Session, stamp_url: str) -> str | None:
    probe = stamp_url.replace("/stamp.jsp", "/stampPDF/getPDF.jsp")
    r = sess.get(probe,
                 stream=True,
                 timeout=15,
                 allow_redirects=False)

    loc = r.headers.get("Location") or r.headers.get("location")
    if loc and "getPDF.jsp" in loc and "login.jsp" not in loc:
        return urljoin(probe, loc)      # 3xx straight to a PDF

    if r.ok and _is_pdf(r):
        return probe                    # 200 OK and body is a PDF
    return None
def _is_pdf(resp: requests.Response) -> bool:
    """quick binary sniff – true only when file starts with %PDF-"""
    return resp.headers.get("Content-Type", "").startswith("application/pdf") \
        and resp.raw.read(5) == b"%PDF-"

def try_html_parse(sess: requests.Session, stamp_url: str) -> str | None:
    """
    Download stamp.jsp HTML and look for:
        • <iframe … getPDF.jsp …>
        • meta refresh with url=…getPDF.jsp
    """
    html = sess.get(stamp_url, timeout=15).text
    found = extract_pdf_from_html(html, stamp_url)
    return found


# ── public façade ─────────────────────────────────────────────────────────
def automate_save_dialog(filepath: str, delay: float = 0.5) -> None:
    """
    Simulate Ctrl+S, paste the given filepath into the Save dialog, and press Enter.

    Args:
        filepath: Absolute path (including filename and extension) to save to.
        delay:   Seconds to wait after each GUI action (adjust if your dialogs are slow).
    """
    # 1) Open Save dialog
    pyautogui.hotkey('ctrl', 's')
    time.sleep(delay)

    # 2) Clear any pre-filled name
    pyautogui.hotkey('ctrl', 'a')
    time.sleep(delay)

    # 3) Paste your path
    pyperclip.copy(filepath)
    pyautogui.hotkey('ctrl', 'v')
    time.sleep(delay)

    # 4) Confirm
    pyautogui.press('enter')
def download_ieee_pdf(abstract_url: str,
                      out_dir: str,
                      out_name: str,
                        browser: uc.Chrome | None = None,
                      institution_name: str = "University College London"
                      ) -> str | None:
    """
    Download IEEE Xplore PDF by driving Chrome—all your cookies, SSO, etc. are preserved.
    Returns the absolute path to the downloaded PDF on success, else None.
    """
    stamp_url = build_stamp_url(abstract_url)

    # 1) sketch directly
    sess = requests.Session()
    sess.cookies.update(COOKIES)
    pdf_direct = try_direct_endpoint(sess, stamp_url)
    if pdf_direct:
        pdf_url = pdf_direct
    else:
        # 2) fallback to Selenium to resolve & SSO if needed
        try:
            browser.get(f"https://{BASE_DOMAIN}")         # set domain
            # inject any cookies you still need
            for n, v in COOKIES.items():
                browser.add_cookie({"name":n,"value":v,"domain":BASE_DOMAIN,"path":"/"})
            # go get the PDF iframe src
            frag = resolve_pdf_fragment_selenium(browser, stamp_url)
            perform_institutional_login_steps(browser)
            if not frag:
                print("× could not find PDF iframe")
                return None

            pdf_url = urljoin(stamp_url, frag)

            browser.get(pdf_url)

            # wait for Chrome to drop the file in `out_dir`
            dest = Path(out_dir) / f"{out_name}.pdf"
            for _ in range(60):
                if dest.exists() and dest.stat().st_size > 10_000:
                    break
                time.sleep(1)
            else:
                print("× download timed out or zero-byte")
                return None

            return str(dest.resolve())

        finally:
            pass

    # 3) if we got here, we have pdf_url from direct endpoint
    #    fall back to requests
    out_path = Path(out_dir) / f"{out_name}.pdf"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    r = sess.get(pdf_url, stream=True, timeout=60)
    try:
        r.raise_for_status()
    except Exception as e:
        print(f"× HTTP error fetching PDF: {e}")
        return None

    # write to disk
    total = 0
    with open(out_path, "wb") as f:
        for chunk in r.iter_content(8192):
            if chunk:
                f.write(chunk)
                total += len(chunk)

    if total == 0:
        print("× zero-byte PDF")
        return None

    return str(out_path.resolve())



# ── quick smoke-test ─────────────────────────────────────────────────────
def main_ieee_download():
    URL   = "https://ieeexplore.ieee.org/abstract/document/8757141"
    DIR   = "downloads/ieee"
    NAME  = "8757141"
    ok = download_ieee_pdf(URL, DIR, NAME)
    exit(0 if ok else 1)

IEEE_END = ("")

JSTOR_START = ()

RAW_COOKIE_HEADER = (
    "UUID=d90c8171-a16e-4638-9cd3-62499788c273; "
    "_pxvid=65bcfbd1-9212-11ef-bf79-830bc5ec5483; "
    "__zlcmid=1OOn7N9jCFhritj; "
    "_ga=GA1.1.189524156.1729779332; "
    "_ga_JPYYW8RQW6=GS1.1.1729779332.1.0.1729779336.0.0.0; "
    "csrftoken=tKqjhhZkGuWNf6GZd66KaytaFuXYPLSo; "
    "pxcts=371b7a63-56c7-11f0-afa8-9d0c0f7120b9; "
    "_px2=eyJ1IjoiMzcxMzU1YTAtNTZjNy0xMWYwLTliMjQtNDcyNzBmYTYyMmY1IiwidiI6IjY1YmNmYmQxLTkyMTItMTFlZi1iZjc5LTgzMGJjNWVjNTQ4MyIsInQiOjE1Mjk5NzEyMDAwMDAsImgiOiIwYmRjZTZiOTQ3NGU1OTBlYjJlZTk0MmQyNDRkMTI3ZTc2YzljNDc4NjEzYmE2ZmQyM2U5NmM3YTdmNTMwNGRkIn0=; "
    "_pxhd=iCFxYL/mAeAeEC19hifqS3lCSo3rqNGISK-t4XQg9457ZCgWlzilq-1KrIFRdNQdANFcrwHj/I0JSFewRkFfxw==:IYXZuQY0zOF0gbvwzu7wMGLLqwPZe/ZTCZ94blhbn32sqkoDxHjdx-pA13dctprwqV5EayHSOdBL20cl3zu8WiW0eTMsAMslGQziPChRGsY=; "
    "AccessSessionTimedSignature=d66785c08bc69f6e2eaebf80ca55f5ba379e50b774e660f3354f6aafb38f39d6; "
    "OptanonConsent=isGpcEnabled=0&datestamp=Thu+Jul+03+2025+13%3A42%3A58+GMT%2B0100+(British+Summer+Time)&version=202505.1.0&browserGpcFlag=0&isIABGlobal=false&hosts=&consentId=80106167-0445-4764-a825-812c27ecaf3f&interactionCount=1&landingPath=NotLandingPage&groups=C0001%3A1%2CC0003%3A0%2CC0002%3A0%2CC0005%3A0%2CC0004%3A0&AwaitingReconsent=false&isAnonUser=1; "
    "AccessToken=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzZXNzaW9uSWQiOiIwMTk3ZDA0NzEzZjQ3OWQxYWY0OTk3NGRlZTQ3ZjAwZCIsInV1aWQiOiJkOTBjODE3MS1hMTZlLTQ2MzgtOWNkMy02MjQ5OTc4OGMyNzMiLCJ1c2VyIjp7ImlkIjoiIiwibG9nZ2VkSW4iOmZhbHNlLCJhZG1pbiI6ZmFsc2V9LCJpYXQiOjE3NTE1NDY1NzgsImV4cCI6MTc1MTU0Njg3OH0.cpglrfGCDfZURi8W0cpGOZlFHJ14BGEDh22TZlJKYNE; "
    "AccessSession=H4sIAAAAAAAA_4WT247TMBCG38XXdfBhfMpdqWBBiJvSvWDRauXakxLIplUOSFDtu2Mnpe0KxOZqNP48888_zpGMYx1JSaJjwXLDqecaKWhpqQtRUi3AOWNtEEaSBakPieUAhRUF51AIsDmbKzDuTGRguKzAuMh9lW9CRARTMRYT101gBVxuud5SpaOhUNnU1AFQdKhFVFvptElw44cECyYUZYYyueGilLIUtlAa7jIw_g2AKJUpQJgM9C8UGAIpK9_0uCA_fDNpu6bVuZrItB-GriflkaxWCXxzm1KrTYq-1-2uf-jqw7BvH1bLjzn_OeVvXqdovfoTfcrs-8275YcleUrVxuHrMoQhVfxyJMPPA-bjth_qYRzqfZvd2jeYj-8X5LFu68f6F75t_I6UQzfiyXSpgCuVNzPr55wxJpjUKqVwTllEFJWnlU3rBeYdtcIqWinAYDyTVkx2nzTUzzSEDuMscaoFQoOSAoBMlo14eQ1OF-wVd9nW0zCHtW93SOZZZ9VP909pGn-ee57BgBHSnQWLsA2yMoZGlOkpGs-pk0FRbQJHDojOqEubNe5mqf_yqDk1kJZJcTVkN1267bFLuzjJyM7JswiHlpmIgVbSbCkEo6gPVlAWuHVehS3z7CLiptuPh_9quO6-y_TcPLnxbf57Xvie2_gbYYK4krcDAAA; "
    "AccessSessionSignature=62f73564987eadf34779008d703a666be50ab7104a686b7d8b5c9bc6b2c4ef89; "
    "ReferringRequestId=fastly-default:d656d6d88aba2f80614479adebf7f27f"
)

def _js_click(browser, selector: str, timeout: int = 8) -> bool:
    """Find *selector* and fire a JS click on it (works for web‑components)."""
    try:
        host = WebDriverWait(browser, timeout).until(
            EC.element_to_be_clickable((By.CSS_SELECTOR, selector))
        )
        browser.execute_script("arguments[0].click()", host)
        return True
    except TimeoutException:
        return False

def _viewer_ready(browser, timeout: int = 12) -> bool:
    """
    Return **True** as soon as any <embed type="application/pdf"> is detected –
    either in the top document **or inside any iframe**.  Works with the
    full‑screen JSTOR viewer that lives in an <iframe>.
    """
    end = time.time() + timeout
    js = """
        const hasEmbed = () => {
            if (document.querySelector('embed[type="application/pdf"]')) return true;
            for (const f of document.querySelectorAll('iframe')) {
                try {
                    if (f.contentDocument &&
                        f.contentDocument.querySelector('embed[type="application/pdf"]')) return true;
                } catch(e) { /* cross‑origin iframe – ignore */ }
            }
            return false;
        };
        return hasEmbed();
    """
    while time.time() < end:
        try:
            if browser.execute_script(js):
                return True
        except Exception:
            pass
        time.sleep(0.4)
    return False

def _switch_to_pdf_tab(browser, wait_seconds: int = 10) -> None:
    """
    After clicking “Accept and download”, JSTOR opens the PDF in **a new tab**.
    Wait (≤ *wait_seconds*) for that extra tab and switch the driver into it.
    Falls back to the current tab if no new one appears.
    """
    start_handles = set(browser.window_handles)
    end_time = time.time() + wait_seconds
    while time.time() < end_time:
        now = set(browser.window_handles)
        new_tabs = now - start_handles
        if new_tabs:                                # found a fresh tab!
            browser.switch_to.window(new_tabs.pop())
            return
        time.sleep(0.25)
    # no extra tab → stay where we are
    return


def download_jstor_pdf(
    page_url: str,
    out_dir: Union[str, Path],
    out_name: str,
    browser,
    timeout: int = 25,
) -> Optional[str]:
    """
    Download a JSTOR PDF, coping with:
      • Access‑Check CAPTCHA
      • Terms‑and‑Conditions modal
      • PDF opening in a *new* tab (direct URL or Chrome viewer)
    """

    out_dir  = Path(out_dir).expanduser().resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    target   = out_dir / f"{out_name}.pdf"
    if target.exists() and _pdf_is_valid(target):
        return str(target)

    # ── load landing page ────────────────────────────────────────────────
    browser.get(page_url)
    WebDriverWait(browser, timeout).until(
        lambda d: d.execute_script("return document.readyState") == "complete"
    )

    # Access‑Check (CAPTCHA) page?
    if any(h.text.strip().lower() == "access check"
           for h in browser.find_elements(By.TAG_NAME, "h2")):
        print("× Solve the CAPTCHA, then hit Enter …")
        input()

    # dismiss cookie popup (may cover buttons)
    try:
        browser.find_element(By.ID, "onetrust-accept-btn-handler").click()
    except Exception:
        pass

    # click “Download” then “Accept and download”
    _js_click(browser, 'mfe-download-pharos-button[data-qa="download-pdf"]', 10)
    time.sleep(0.6)
    _js_click(browser,
              'mfe-download-pharos-button[data-qa="accept-terms-and-conditions-button"]',
              10)

    # **switch into the freshly‑opened PDF tab**
    _switch_to_pdf_tab(browser, wait_seconds=8)

    # ── branch A: direct .pdf URL (easy) ─────────────────────────────────
    end = time.time() + timeout
    pdf_url = None
    while time.time() < end:
        cur = browser.current_url
        if cur.lower().endswith(".pdf") or "/stable/pdf/" in cur:
            pdf_url = cur
            break
        time.sleep(0.3)

    if pdf_url:
        if _download_pdf_via_requests(browser, pdf_url, target, timeout):
            return str(target.resolve())

    # ── branch B: Chrome viewer (<embed>) → Save As … ────────────────────
    if _viewer_ready(browser, timeout=10):
        _activate_chrome_window(browser)
        saved = save_via_dialog(target)
        if saved:
            return str(saved)

    # last‑ditch: hit Save As anyway (sometimes still works)
    _activate_chrome_window(browser)
    saved = save_via_dialog(target)
    if saved:
        return str(saved)

    print("× JSTOR PDF could not be retrieved.")
    return None
def _download_pdf_via_requests(
    browser,
    pdf_url: str,
    target: Path,
    timeout: int = 20,
    size_floor: int = SIZE_FLOOR
) -> bool:
    """
    Download a PDF via HTTP GET using the browser's cookies.
    Writes to `target` and returns True on a valid PDF ≥ size_floor bytes.
    """
    from urllib.parse import urlparse
    import requests

    # prepare session with browser cookies and headers
    sess = requests.Session()
    sess.headers.update({
        "Accept": "application/pdf",
        "User-Agent": browser.execute_script("return navigator.userAgent;"),
        "Referer": f"{urlparse(pdf_url).scheme}://{urlparse(pdf_url).netloc}/"
    })
    for ck in browser.get_cookies():
        sess.cookies.set(ck["name"], ck["value"])

    print(f"→ Downloading via HTTP GET: {pdf_url}")
    try:
        resp = sess.get(pdf_url, stream=True, timeout=timeout)
        resp.raise_for_status()
        ctype = resp.headers.get("Content-Type", "")
        if "application/pdf" not in ctype.lower():
            print(f"× Unexpected Content-Type: {ctype}")
            return False

        # write file in chunks
        with open(target, "wb") as f:
            total = 0
            for chunk in resp.iter_content(8192):
                if chunk:
                    f.write(chunk)
                    total += len(chunk)

        # validate size and PDF integrity
        if total >= size_floor and _pdf_is_valid(target):
            print(f"✓ HTTP saved → {target.resolve()} ({total // 1024} KB)")
            return True
        else:
            print(f"× File too small or invalid PDF ({total} bytes)")
            try:
                target.unlink()
            except Exception:
                pass
            return False

    except Exception as e:
        print("⚠ HTTP fetch failed:", e)
        return False



def main_jstor_download():

    url = "https://www.jstor.org/stable/24872164?seq=1"
    odir = "downloads"
    oname = "autonomous_cyber"
    success = download_jstor_pdf(page_url=url, out_dir=odir, out_name=oname,browser=initiate_browser())
    sys.exit(0 if success else 2)

JSTOR_END = ("")

PROQUEST_START = ()

# ─────────────────────────────── CONFIG ────────────────────────────────
DOCVIEW_URL = "https://www.proquest.com/scholarly-journals/attribution-indictment/docview/2245995154/se-2?accountid=14511"
OUTPUT_DIR = Path("downloads/proquest")
PDF_NAME = "2535894734"

# Paste your full “cookie:” header here (everything after 'cookie:')
RAW_COOKIE_HEADER = (
    "OptanonAlertBoxClosed=2024-10-15T09:15:28.660Z; "
    "authenticatedBy=IP; "
    "authThrough=/yE5QVK4aTgrYbPVAvjT41GPGjjeMlJQlE+A16UfftPVu9oXq3enepV88gGmtrmDHxWC6JixwjQNrW1XtddaeoLVqAaNxQW071ps6u+AfDNT+y4fnnXQP4pyaZmsI2LD; "
    "availability-zone=; "
    "_cfuvid=7fxDcCu7C1rxfoCbOpp.gmQ9tGnweZ7gfjVa43EQuD4-1751455865049-0.0.1.1-604800000; "
    "SE=1800; authSub=1; AppVersion=r2025.6.0.8970; oneSearchTZ=60; fulltextShowAll=YES; "
    "JSESSIONID=AA0088DF804681ED3E1A6715238443BF.i-0bbddd5a309f2400f; "
    "AWSELB=B51D334F1C76A202F3414E63D3CD066F391F40C562C216CDB25009B0595651F7B58F73BECE40BE535884C9527CC77304C230CED4A0E5A67DF9EB4BB3F7E11F812C9357D4D09A3B022F882C04C764A0B9666D116A3E; "
    "SUSIC=\"HM3SVoPsIy8S9iM+fkBNNg640YiTQEUuLtNE2d1CWA5meXqHPTnKbRdyJyOxayrPJYJ7m0hFvNIfbKn+iCs5gA==\"; "
    "__cf_bm=XgT2xKg8B0JNaiierU0Tq9UNv5vOns3j26P0jxVliPg-1751489792-1.0.1.1-tF8MIkdiIRWAnEx9i5lgmz6R4Gniecpy3Yuy7RbaIsnJZe3VSlnKWLzC_HFNA9v2OS5F3GKCaLLXON1jfTjKPWK4U_u1mhjOi3vpHJqsqHc; "
    "OptanonConsent=isGpcEnabled=0&datestamp=Wed+Jul+02+2025+22%3A03%3A46+GMT%2B0100+(British+Summer+Time)&version=202403.1.0&browserGpcFlag=0&isIABGlobal=false&consentId=614b3dd9-e9be-4a16-8d06-47c7dca17a61&geolocation=GB%3BENG; "
    "osTimestamp=1751490226.271; ST=1751490248"
)
BASE_DOMAIN = "www.proquest.com"


# ────────────────────────────────────────────────────────────────────────
def parse_cookie_header(raw: str) -> dict[str, str]:
    return {k: v for k, v in (kv.split("=", 1) for kv in raw.split("; ") if "=" in kv)}


def extract_pdf_href(html_text: str) -> str | None:
    m = re.search(
        r'<a[^>]+class="[^"]*pdf-download[^"]*"[^>]+href="([^"]+)"',
        html_text, re.I
    )
    return html.unescape(m.group(1)) if m else None

proquest =[
    # "https://www.proquest.com/dissertations-theses/الدليل-الجنائي-الرقمي-وأهميته-في-الإثبات-والنفي/docview/2644059129/se-2?accountid=14511",
    #        "https://www.proquest.com/scholarly-journals/cyber-scares-prophylactic-policies-crossnational/docview/3052522241/se-2?accountid=14511",
    #        "https://www.proquest.com/dissertations-theses/comparison-study-job-satisfaction-cyberspace/docview/1504616386/se-2?accountid=14511",
    #        "https://www.proquest.com/scholarly-journals/national-resilience-̶-strategic-option-state/docview/2348381941/se-2?accountid=14511",
    #        "https://www.proquest.com/scholarly-journals/racism-behind-screen-examining-mediating/docview/2903926733/se-2?accountid=14511",
           "https://www.proquest.com/scholarly-journals/pharm-ing-cyberspace-internet-as-tool-evidence/docview/200493879/se-2?accountid=14511"

           ]

def download_proquest_pdf(
        url: str,
        out_dir: str,
        out_name: str,
        browser: uc.Chrome | None = None
):
    """
    Download a PDF from a ProQuest “docview” page.

    Strategy
    --------
    1.  Load the HTML via `requests` and try to pull a direct PDF link
        with `extract_pdf_href()`.
    2.  If that fails, fall back to Selenium:
        • first look for the ordinary “Download PDF” button
          (`a.pdf-download …href="…/pdf"`).
        • if not present, look for the *alternative* “Get full text” link
          that appears on some records
          (`a[title="Get full text"][href*=".pdf"]`).
    3.  Detect ProQuest’s “externallink:externallink” shenanigan and
        rewrite it into a real `https://…pdf` URL.
    4.  Stream–download whichever URL we discovered and save it to
        *out_dir* / *out_name*.pdf
    """
    # ————————————————————————————————————————————— network session
    cookies = parse_cookie_header(RAW_COOKIE_HEADER)
    sess = requests.Session()
    sess.cookies.update(cookies)
    sess.headers.update({
        "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                       "AppleWebKit/537.36 (KHTML, like Gecko) "
                       "Chrome/138.0.0.0 Safari/537.36"),
    })
    # ─── 0) CLEAN the URL (before using it anywhere) ───────────────────────
    # 1) decompose + drop all non‑spacing marks (Mn)
    url = unicodedata.normalize("NFD", url)
    url = "".join(ch for ch in url if unicodedata.category(ch) != "Mn")
    # 2) collapse any accidental “--” → “-”
    url = re.sub(r"-{2,}", "-", url)
    # 3) percent‑encode unsafe chars
    url = requote_uri(url)

    print(f"→ Fetching docview page: {url}")
    r = sess.get(url, timeout=30)
    r.raise_for_status()

    # ————————————————————————————————————————————— ① try plain HTML
    pdf_href = extract_pdf_href(r.text)
    if pdf_href:
        pdf_url = urljoin(url, pdf_href)
        print(f"→ Resolved PDF URL via HTTP: {pdf_url}")

    # ————————————————————————————————————————————— ② fall-back: Selenium
    else:
        print("× PDF link not found via HTTP; falling back to Selenium…")

        external_browser = browser is not None
        browser = browser or uc.Chrome()
        browser.get(url)

        wait = WebDriverWait(browser, 20)

        def _find_link(selector: str):
            try:
                wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, selector)))
                elem = wait.until(EC.element_to_be_clickable((By.CSS_SELECTOR, selector)))
                browser.execute_script("arguments[0].scrollIntoView({block:'center'})", elem)
                return elem.get_attribute("href")
            except Exception:
                return None

        selectors = [
            'a[download$=".pdf"]',
            'a.tool-option-link.pdf-download',
            'a.pdf-download',
            'a[id^="downloadPDFLink"]'
        ]
        pdf_url = None
        for sel in selectors:
            pdf_url = _find_link(sel)
            if pdf_url:
                break

        if not pdf_url:
            print("× couldn’t locate any PDF/full-text link on the page.")
            if not external_browser:
                pass
            return False

        if "externallink:externallink/" in pdf_url:
            raw = pdf_url.split("externallink:externallink/")[1].split("/MSTAR_")[0]
            pdf_url = raw.replace("$2f", "/").replace("$2F", "/")
            if not pdf_url.startswith("http"):
                pdf_url = "https://" + pdf_url.lstrip("/")
            print(f"→ Rewritten external PDF URL: {pdf_url}")

        print(f"→ Selenium found PDF URL: {pdf_url}")

        if not external_browser:
            pass

    # ————————————————————————————————————————————— ③ stream-download
    out_path = Path(out_dir) / f"{out_name}.pdf"
    out_path.parent.mkdir(parents=True, exist_ok=True)

    total = 0
    with sess.get(pdf_url, stream=True, timeout=60) as resp:
        resp.raise_for_status()
        with out_path.open("wb") as f:
            for chunk in resp.iter_content(8_192):
                if chunk:
                    f.write(chunk)
                    total += len(chunk)

    if total == 0:
        print("× zero-byte PDF – download failed.")
        return False

    print(f"✓ saved PDF → {out_path}")
    return str(out_path)

    print(f"✓ Saved {total} bytes → {out_path.resolve()}")
    return out_path.resolve()


def main_proquest_download():
    for url in proquest:
        print(f"Downloading ProQuest PDF from: {url}")
        success = download_proquest_pdf(url, OUTPUT_DIR, PDF_NAME)
        if not success:
            print(f"× Failed to download PDF from {url}")
            exit(1)


PROQUEST_END = ("")

SCIENCE_DIRECT_START = ()

# ────────── Paste your full “Cookie:” header value here ──────────
RAW_COOKIE_HEADER = "47ea1b3485178db4246e384892ff4gxrqb; id_ab=AEG; ANONRA_COOKIE=C3259D98D76BD53BF3050233CF0533FAEC60AFA30E38BEF3439742938639D5798A250EB722229626CF574233C590154347C4A34E15861E76; AMCVS_4D6368F454EC41940A4C98A6%40AdobeOrg=1; mbox=session%230f5183a9a26a49488c5ae07ba64be656%231751646806%7CPC%233d121a1ecbdf4c43b74cdb4f4ceca282.37_0%231814889746; MIAMISESSION=195e33af-b367-4a6f-8483-98bd89144f21:3929119317; SD_REMOTEACCESS=eyJhY2NvdW50SWQiOiIxMDE4MiIsInRpbWVzdGFtcCI6MTc1MTY2NjUxNzk2NCwiYXV0aGVudGljYXRpb25NZXRob2QiOiJJUCJ9; __cf_bm=WKDWLu4.9vYgeyee.t2F4.0uwrV57DeYQJJJekYhTUE-1751666518-1.0.1.1-xr183bURIwxsZMOH8Iwq.l0ex39m61m5puItd_9ZGIqAD.l7DR8IJg1md8bOje0xOBSg6QTF6EUq_7_rE1OhF3aRpDY6sSPM_iLoGbYF60g; cf_clearance=jUEk0frJ9jB7gMLFEWuyjmpTWV9NFQO_ZN4h3PdfQdo-1751666519-1.2.1.1-Uu8BF9CXOYMQqHQa7OUA7iUE5oEQ.sjz_zdA9PoaFwYI2hL0hp05pVFTVD9htm3jSuqs87kt5aWKziHI.jBgCUhJBRmRNPk7n3KIrTRANPWc6Q0s5E9ZbKRxLiB1IWHG.HwzpVuSYxhf4i7lS5a_076BWxibZzWvZ_7ewHH6EgHaf.bCrYZ78Vv7OPIC4CQOZ1LQEUArN4BX3wDdaPfTq2EqxBvyzjf4qLK_5DkYfcY; AMCV_4D6368F454EC41940A4C98A6%40AdobeOrg=179643557%7CMCIDTS%7C20273%7CMCMID%7C38263708940821633152479888500468916962%7CMCAID%7CNONE%7CMCOPTOUT-1751673719s%7CNONE%7CMCAAMLH-1752271319%7C6%7CMCAAMB-1752271319%7Cj8Odv6LonN4r3an7LhD3WZrU1bUpAkFkkiY1ncBR96t2PTI%7CMCCIDH%7C1599159451%7CvVersion%7C5.5.0; OptanonConsent=isGpcEnabled=0&datestamp=Fri+Jul+04+2025+23%3A01%3A59+GMT%2B0100+(British+Summer+Time)&version=202504.1.0&browserGpcFlag=0&isIABGlobal=false&hosts=&consentId=77668d56-e6b0-4e29-b9db-137700dc5346&interactionCount=1&isAnonUser=1&landingPath=NotLandingPage&groups=1%3A1%2C2%3A1%2C4%3A1&geolocation=GB%3BENG&AwaitingReconsent=false; s_pers=%20c19%3Dsd%253Aproduct%253Ajournal%253Aarticle%7C1751668319297%3B%20v68%3D1751666518073%7C1751668319299%3B%20v8%3D1751666751999%7C1846274751999%3B%20v8_s%3DLess%2520than%25201%2520day%7C1751668551999%3B; s_sess=%20s_cpc%3D0%3B%20c21%3Dqs%253Dcyber%2520attribution%3B%20e13%3Dqs%253Dcyber%2520attribution%253A1%3B%20c13%3Drelevance-desc%3B%20e78%3Dqs%253Dcyber%2520attribution%3B%20s_ppvl%3Dsd%25253Aproduct%25253Ajournal%25253Aarticle%252C3%252C3%252C1314%252C2552%252C1314%252C2560%252C1440%252C1.5%252CP%3B%20s_ppv%3Dsd%25253Aproduct%25253Ajournal%25253Aarticle%252C54%252C54%252C1314%252C2552%252C1314%252C2560%252C1440%252C1.5%252CP%3B%20e41%3D1%3B%20s_cc%3Dtrue%3B%20s_sq%3Delsevier-global-prod%253D%252526c.%252526a.%252526activitymap.%252526page%25253Dsd%2525253Aproduct%2525253Ajournal%2525253Aarticle%252526link%25253Droot%252526region%25253Droot%252526pageIDType%25253D1%252526.activitymap%252526.a%252526.c%252526pid%25253Dsd%2525253Aproduct%2525253Ajournal%2525253Aarticle%252526pidt%25253D1%252526oid%25253Dfunctionkd%25252528%25252529%2525257B%2525257D%252526oidt%25253D2%252526ot%25253DDIV%3B"
_PDF_MIN = 10_000               # bytes – sanity-check size

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/138.0.0.0 Safari/537.36"
    ),
    "Accept": "application/pdf,*/*;q=0.9",
}
def _stream_pdf(sess: requests.Session,
                pdfft_url: str,
                referer: str,
                dest_path: Path) -> None:
    """
    1) GET pdfft_url   (adds Referer + X-Requested-With)  →  302
    2) GET redirected Location                           →  200 application/pdf
    3) stream to *dest_path*
    """
    head = {
        "Referer": referer,
        "X-Requested-With": "XMLHttpRequest",   # unlocks 403
    }
    r1 = sess.get(pdfft_url, headers=head, allow_redirects=False, timeout=30)
    if r1.status_code not in (301, 302, 303, 307, 308):
        r1.raise_for_status()                   # will raise 403 if still blocked
    pdf_url = urljoin(pdfft_url, r1.headers["Location"])

    with sess.get(pdf_url, stream=True, timeout=120) as r2:
        r2.raise_for_status()
        if not r2.headers.get("Content-Type", "").lower().startswith("application/pdf"):
            raise RuntimeError(f"unexpected Content-Type: {r2.headers.get('Content-Type')}")
        with dest_path.open("wb") as fp:
            for chunk in r2.iter_content(8192):
                if chunk:
                    fp.write(chunk)
    if dest_path.stat().st_size < 20_000:
        raise RuntimeError("file too small – likely not a real PDF")


# ─────────────────────────────────────────────────────────────────────────────

def download_sciencedirect_pdf(page_url: str,
                               out_dir: str | os.PathLike,
                               out_name: str,
                               browser) -> str | None:
    """
    Use Selenium to obtain the *signed* ScienceDirectAssets URL,
    then stream-download the PDF.  Returns absolute path or None.
    """
    dest_path = Path(out_dir, f"{out_name}.pdf").resolve()
    dest_path.parent.mkdir(parents=True, exist_ok=True)

    try:
        # ── 1. open article page ────────────────────────────────────────────
        browser.get(page_url)
        WebDriverWait(browser, 25).until(
            EC.presence_of_element_located((By.CSS_SELECTOR, "div.accessbar"))
        )

        # close “other users also viewed” modal, if it pops
        with contextlib.suppress(Exception):
            browser.find_element(By.CSS_SELECTOR,
                                 ".EntitledRecommendationsModal "
                                 "button.modal-close-button").click()

        # ── 2. find the View-PDF anchor (contains `/pdfft`) ─────────────────
        link = WebDriverWait(browser, 15).until(
            EC.element_to_be_clickable((
                By.XPATH,
                "//a[contains(@href,'/pdfft') and contains(@aria-label,'PDF')]"
            ))
        )
        pdfft_url = urljoin(page_url, link.get_attribute("href"))
        print(f"→ `/pdfft` link: {pdfft_url}")

        # ── 3. open it in a new tab so we can grab the redirect ─────────────
        orig_tab = browser.current_window_handle
        browser.execute_script("window.open(arguments[0], '_blank');", pdfft_url)
        WebDriverWait(browser, 8).until(EC.number_of_windows_to_be(2))

        new_tab = [h for h in browser.window_handles if h != orig_tab][0]
        browser.switch_to.window(new_tab)

        # after JS redirects, either:
        #   • the tab URL *is already* the signed PDF  OR
        #   • an <embed src="…pdf"> is injected
        def _signed_url(drv):
            if drv.current_url.endswith(".pdf"):
                return drv.current_url
            tag = drv.find_elements(By.CSS_SELECTOR,
                                    'embed[type="application/pdf"]')
            return tag[0].get_attribute("src") if tag else False

        signed_pdf = WebDriverWait(browser, 20).until(_signed_url)
        print(f"→ signed PDF URL: {signed_pdf[:120]}…")

        # ── 4. stream download – signed URL works without cookies ───────────
        with requests.get(signed_pdf, stream=True, timeout=120) as r:
            r.raise_for_status()
            with dest_path.open("wb") as fp:
                for chunk in r.iter_content(8192):
                    if chunk:
                        fp.write(chunk)

        if dest_path.stat().st_size < 20_000:
            raise RuntimeError("File too small – download failed")

        print(f"✓ saved → {dest_path}")
        return str(dest_path)

    except Exception as exc:
        print(f"✗ ScienceDirect download failed: {exc}")
        return None

    finally:
        # tidy up extra tab
        with contextlib.suppress(Exception):
            if len(browser.window_handles) > 1:
                browser.close()
            browser.switch_to.window(orig_tab)

def main_science_direct_download():

    browser = initiate_browser()
    payload = {"page_url":"https://www.sciencedirect.com/science/article/pii/S0308596124000363","out_dir": "downloads", "out_name": "example_article",
               "browser": browser
               }
    success = download_sciencedirect_pdf(**payload)
    sys.exit(0 if success else 1)

# main_science_direct_download()

SCIENCE_DIRECT_END = ("")


MAIN_START = ()



HEADERS_commons = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36"
    ),
    "Accept": "application/pdf,application/octet-stream;q=0.9,*/*;q=0.8",
    "Referer": "https://digital-commons.usnwc.edu/",
}
RAW_COOKIE_HEADER_commons= "bp_visitor_id=wF1B0rSQ3CLxTpCPSYR8JT; _ga=GA1.1.1755000812.1752073716; OptanonAlertBoxClosed=2025-07-09T15:08:43.771Z; AMCVS_4D6368F454EC41940A4C98A6%40AdobeOrg=1; AMCV_4D6368F454EC41940A4C98A6%40AdobeOrg=1075005958%7CMCIDTS%7C20279%7CMCMID%7C08914953785732819630543495198793366719%7CMCAID%7CNONE%7CMCOPTOUT-1752080924s%7CNONE%7CMCAAMLH-1752678524%7C6%7CMCAAMB-1752678524%7Cj8Odv6LonN4r3an7LhD3WZrU1bUpAkFkkiY1ncBR96t2PTI%7CvVersion%7C4.4.1; bp_plack_session=98072a93de420dd295e8e7ee23290273bb186d8c; _ga_Z0LMJGHBJ7=GS2.1.s1752073715$o1$g1$t1752074048$j27$l0$h0; OptanonConsent=isGpcEnabled=0&datestamp=Wed+Jul+09+2025+16%3A14%3A08+GMT%2B0100+(British+Summer+Time)&version=202402.1.0&browserGpcFlag=0&isIABGlobal=false&hosts=&consentId=12042a4a-17de-4106-a260-e7469727949f&interactionCount=1&isAnonUser=1&landingPath=NotLandingPage&groups=1%3A1%2C3%3A1%2C2%3A1%2C4%3A1&geolocation=GB%3BENG&AwaitingReconsent=false; s_pers=%20v8%3D1752074051346%7C1846682051346%3B%20v8_s%3DFirst%2520Visit%7C1752075851346%3B%20c19%3Dbpdg%253Asearch%253Aquery_screen%7C1752075851346%3B%20v68%3D1752074048809%7C1752075851347%3B; s_sess=%20s_cpc%3D0%3B%20s_ppvl%3Dbpdg%25253Asearch%25253Aquery_screen%252C100%252C101%252C3859.333251953125%252C1733%252C1314%252C2560%252C1440%252C1.5%252CP%3B%20s_sq%3D%3B%20s_cc%3Dtrue%3B%20e41%3D1%3B%20s_ppv%3Dbpdg%25253Asearch%25253Aquery_screen%252C100%252C100%252C1714%252C1733%252C1314%252C2560%252C1440%252C1.5%252CP%3B"

RESULTS_PER_PAGE = 25

COOKIES = parse_cookie_header(RAW_COOKIE_HEADER_commons)
# ─── CONSTANTS ──────────────────────────────────────
def initiate_browser(headless=False):
    # Configure Chrome options
    options = uc.ChromeOptions()
    # Uncomment the next line only if you need headless mode:
    if headless:
        options.add_argument("--headless=new")

    # Add options to mimic a normal user browser.
    options.add_argument("--disable-blink-features=AutomationControlled")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    # options.add_argument("--user-data-dir=…")
    # options.add_argument("--profile-directory=…")

    # Initialize undetected ChromeDriver.
    driver = uc.Chrome(options=options
                       # , version_main=134
                       )
    return driver




load_dotenv()

api_key = os.environ.get("wos_api_key")
ser_api_key = os.environ.get("ser_api_key")
DPLA_key = os.environ.get("DPLA_key")
ELSEVIER_KEY = os.environ.get("ELSEVIER_KEY")
# Conditional import for dpla to avoid errors if not installed

from dpla.api import DPLA


# Conditional import for elsapy to avoid errors if not installed
try:
    from elsapy.elsclient import ElsClient
    # Initialize Elsevier client if key is available
    if ELSEVIER_KEY:
        client = ElsClient(ELSEVIER_KEY)
    else:
        client = None
except ImportError:
    print("elsapy library not found. Elsevier functions will not be available.")
    client = None

# At the top of your module, alongside the Crossref cache:
ELSEVIER_CACHE: dict = {}
ELSEVIER_CACHE_PATH = "elsevier_cache.json"

# Load existing cache if present
try:
    with open(ELSEVIER_CACHE_PATH, "r", encoding="utf-8") as _ecf:
        ELSEVIER_CACHE = json.load(_ecf)
except Exception:
    ELSEVIER_CACHE = {}


def get_document_info2(query, author=None):
    """
    Retrieves document information from Google Scholar via the SERP API.
    """
    if not ser_api_key:
        print("SERP API key not found.")
        return None
    url = "https://serpapi.com/search"
    params = {"engine": "google_scholar", "q": query, "api_key": ser_api_key}
    try:
        response = requests.get(url, params=params)
        response.raise_for_status()
        data = response.json()
        if 'organic_results' in data and data['organic_results']:
            hit = data['organic_results'][0]
            # Simple author check if provided
            if author and author.lower() not in str(hit.get('publication_info', {})).lower():
                return None
            return {
                'title': hit.get('title'),
                'author_info': hit.get('publication_info', {}).get('summary'),
                'link': hit.get('link'),
                'year': hit.get('publication_info', {}).get('summary', '')[-4:], # Attempt to parse year
                'total_cited': hit.get('inline_links', {}).get('cited_by', {}).get('total', 0),
                'database': 'Google Scholar (SerpApi)'
            }
        return None
    except requests.exceptions.RequestException as e:
        error_message = f"Request failed for get_document_info2: {e}"
        if e.response:
            error_message += f"\nResponse body: {e.response.text}"
        print(error_message)
        return None
# Shared Crossref session with retry/backoff (needed by fetch_crossref_data)
_crossref_session = requests.Session()
_retries = Retry(
    total=3,
    backoff_factor=1,
    status_forcelist=[429, 500, 502, 503, 504],
    allowed_methods=["GET"]
)
_crossref_session.mount("https://", HTTPAdapter(max_retries=_retries))

CROSSREF_MAILTO = [
    "luanorodrigues@yahoo.com.br",
    "luanorodriguessilva@gmail.com",
    "ucablrs@ucl.ac.uk",
]
_CALL_COUNT = 0          # global, reset each run
_CROSSREF_CACHE = {}     # in‐memory cache; ensure CACHE_PATH is defined elsewhere
CACHE_PATH = "crossref_cache.json"
LOG = logging.getLogger(__name__)

def _next_mailto() -> str:
    """Return one of three mailto addresses, rotate every 500 calls."""
    global _CALL_COUNT
    index = (_CALL_COUNT // 500) % len(CROSSREF_MAILTO)
    return CROSSREF_MAILTO[index]


def _write_references_ris(refs: list[dict], save_dir: str, base_name: str) -> str:
    """
    Given a list of Crossref reference dicts, filter out purely unstructured refs,
    and write a .ris file containing one record per reference.
    Returns the path to the .ris file.
    """
    os.makedirs(save_dir, exist_ok=True)
    ris_path = os.path.join(save_dir, f"{base_name}_refs.ris")
    with open(ris_path, "w", encoding="utf-8") as f:
        for ref in refs:
            # skip if only 'unstructured' present
            keys = set(ref.keys()) - {"key", "unstructured"}
            if not keys:
                continue
            f.write("TY  - JOUR\n")
            # if structured fields exist, write them
            if "author" in ref:
                f.write(f"AU  - {ref['author']}\n")
            if "volume-title" in ref:
                f.write(f"JO  - {ref['volume-title']}\n")
            if "journal-title" in ref:
                f.write(f"JO  - {ref['journal-title']}\n")
            if "year" in ref:
                f.write(f"PY  - {ref['year']}\n")
            if "volume" in ref:
                f.write(f"VL  - {ref['volume']}\n")
            if "first-page" in ref:
                f.write(f"SP  - {ref['first-page']}\n")
            if "DOI" in ref:
                f.write(f"DO  - {ref['DOI']}\n")
            f.write("ER  - \n\n")
    return ris_path


def fetch_crossref_meta(
    title: str = "",
    year: int | str | None = None,
    author: str | None = None,
    doi: str | None = None,
    min_similarity: float = 0.85
) -> dict:
    """
    Fetch Crossref metadata by DOI or by title/year/author search.

    Args:
      title:      Article title (used if doi is None)
      year:       Publication year (optional)
      author:     Last name of first author (optional)
      doi:        DOI string (highest priority)
      min_similarity: threshold for title-only matches

    Returns:
      The Crossref 'message' dict (possibly empty if no match).
    """
    global _CALL_COUNT

    # 1) If DOI given, fetch directly
    if doi:
        url = f"https://api.crossref.org/works/{doi}"
        try:
            resp = _crossref_session.get(url, timeout=10)
            _CALL_COUNT += 1
            resp.raise_for_status()
            msg = resp.json().get("message", {})
            return msg
        except Exception as exc:
            LOG.warning(f"Crossref DOI lookup failed ({doi}): {exc}")

    # Normalize inputs for key-based caching
    year_str = str(year) if year else ""
    auth_str = author or ""
    cache_key = f"{title}|{year_str}|{auth_str}"
    if cache_key in _CROSSREF_CACHE:
        return _CROSSREF_CACHE[cache_key]

    # Prepare headers
    mailto = _next_mailto()
    headers = {"User-Agent": f"RIS-merge/1.0 ({mailto})"}

    # Build search attempts
    attempts = []

    # A) Broad bibliographic search (title+author+year)
    bib_terms = " ".join(part for part in (title, author, year_str) if part)
    attempts.append({
        "params": {
            "query.bibliographic": bib_terms,
            "rows": 1,
            "mailto": mailto,
            **({"query.author": author.split(",")[0]} if author else {})
        },
        "filter": None
    })

    # B) Strict title + year
    p2 = {"query.title": title, "rows": 1, "mailto": mailto}
    if year_str:
        p2["filter"] = f"from-pub-date:{year_str},until-pub-date:{year_str}"
    if author:
        p2["query.author"] = author.split(",")[0]
    attempts.append({"params": p2, "filter": p2.get("filter")})

    # C) Title-only fallback
    p3 = {"query.title": title, "rows": 1, "mailto": mailto}
    if author:
        p3["query.author"] = author.split(",")[0]
    attempts.append({"params": p3, "filter": None})

    meta: dict = {}
    for attempt in attempts:
        try:
            resp = _crossref_session.get(
                "https://api.crossref.org/works",
                params=attempt["params"],
                headers=headers,
                timeout=5
            )
            _CALL_COUNT += 1
            resp.raise_for_status()
            message = resp.json().get("message", {})
            items = message.get("items", [])
            if not items:
                LOG.debug(f"No results for {resp.url}")
                continue

            candidate = items[0]
            # If this was a title‐only or title+year search, apply similarity
            if "query.title" in attempt["params"] and not doi:
                want = title.lower()
                returned = (candidate.get("title") or [""])[0].lower()
                sim = SequenceMatcher(None, want, returned).ratio()
                if sim < min_similarity:
                    LOG.warning(
                        f"Crossref mismatch (sim={sim:.2f}): '{returned[:60]}' vs '{want[:60]}' -- {resp.url}"
                    )
                    continue

            # Matched: use this candidate
            meta = candidate
            break

        except Exception as exc:
            LOG.warning(f"Crossref lookup error ({attempt['params']}): {exc}")

    # Cache & persist
    _CROSSREF_CACHE[cache_key] = meta
    try:
        with open(CACHE_PATH, "w", encoding="utf-8") as cf:
            json.dump(_CROSSREF_CACHE, cf, indent=2, ensure_ascii=False)
    except Exception as exc:
        LOG.warning(f"Failed to write Crossref cache: {exc}")

    return meta


def fetch_crossref_data(
        doi: str | None = None,
        title: str | None = None,
        author: str | None = None,
        year: int | None = None,
        save_dir: str = ".",
        references: bool = False
) -> dict:
    """
    Fetch Crossref metadata + PDF + RIS.

    Args:
      doi:        Direct DOI to fetch (skips discovery if given).
      title:      Article title for discovery (if doi None).
      author:     Author surname for discovery.
      year:       Publication year for discovery.
      save_dir:   Directory to save PDF and RIS.
      references: Whether to build a full .ris including references.

    Returns:
      {
        "metadata": { ... full Crossref fields ... },
        "pdf_path": (path_or_url, success_flag) | None,
        "ris_path": path to generated .ris or None
      }
    """
    os.makedirs(save_dir, exist_ok=True)

    # ── 1) Discover or fetch DOI & metadata ────────────────────────────────
    if doi:
        try:
            # Direct DOI fetch
            url = f"https://api.crossref.org/works/{doi}"
            resp = requests.get(url, timeout=10)
            resp.raise_for_status()
            msg = resp.json().get("message", {})
        except requests.exceptions.RequestException as exc:
            print("× Error fetching Crossref data:", exc)
            return {"metadata": {}, "pdf_path": None, "ris_path": None}

    else:
        # Must have title+author+year to discover
        if not (title and author and year):
            return {"metadata": {}, "pdf_path": None, "ris_path": None}
        bib = quote_plus(f"{title} {author} {year}")
        search_url = f"https://api.crossref.org/works?query.bibliographic={bib}&rows=1"
        r = requests.get(search_url, timeout=10)
        r.raise_for_status()
        items = r.json().get("message", {}).get("items", [])
        if not items:
            return {"metadata": {}, "pdf_path": None, "ris_path": None}
        cand = items[0]
        # quick fuzzy‐check
        returned = (cand.get("title") or [""])[0].lower()
        if SequenceMatcher(None, title.lower(), returned).ratio() < 0.7:
            return {"metadata": {}, "pdf_path": None, "ris_path": None}
        doi = cand.get("DOI")
        # now fetch full
        resp = requests.get(f"https://api.crossref.org/works/{doi}", timeout=10)
        resp.raise_for_status()
        msg = resp.json().get("message", {})

    # ── 2) Parse rich metadata ──────────────────────────────────────────────
    md = {
        "title": (msg.get("title") or [""])[0],
        "authors": [f"{a.get('given', '')} {a.get('family', '')}".strip()
                    for a in msg.get("author", [])],
        "journal": (msg.get("container-title") or [""])[0],
        "publisher": msg.get("publisher"),
        "year": None,
        "volume": msg.get("volume"),
        "issue": msg.get("issue"),
        "pages": msg.get("page"),
        "doi": msg.get("DOI"),
        "url": msg.get("URL"),
        "issn": msg.get("ISSN", []),
        "language": msg.get("language"),
        "abstract": msg.get("abstract"),
        "keywords": msg.get("subject", []),
        "reference_count": msg.get("reference-count"),
        "is_referenced_by": msg.get("is-referenced-by-count"),
        "license": msg.get("license", []),
        "funding": msg.get("funder", []),
        "orcid_ids": [a["ORCID"] for a in msg.get("author", []) if "ORCID" in a],
    }



    # extract numeric year if present
    pd = md.get("publication_date")
    if isinstance(pd, str) and "-" in pd:
        try:
            md["year"] = int(pd.split("-")[0])
        except ValueError:
            pass
    # pick year
    for k in ("issued", "published-print", "published-online"):
        parts = msg.get(k, {}).get("date-parts", [[None]])
        if parts and parts[0][0]:
            md["year"] = parts[0][0]
            break

    # ── 3) Download PDF or record fallback ──────────────────────────────────
    pdf_path = None
    for link in msg.get("link", []):
        url_pdf = link.get("URL", "")
        if not (url_pdf.lower().endswith(".pdf") or "/doi/pdf/" in url_pdf.lower()):
            continue
        hdrs = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/138.0.0.0 Safari/537.36"
            ),
            "Accept": "application/pdf,*/*;q=0.8",
            "Referer": f"https://doi.org/{doi}"
        }
        try:
            r3 = requests.get(url_pdf, headers=hdrs, stream=True, timeout=10)
            r3.raise_for_status()
            fn = doi.replace("/", "_") + ".pdf"
            full = os.path.join(save_dir, fn)
            with open(full, "wb") as f:
                for chunk in r3.iter_content(8192):
                    f.write(chunk)
            pdf_path = (full, True)
        except HTTPError as e:
            if e.response.status_code == 403:
                fb = url_pdf.replace("/doi/pdf/", "/doi/epdf/") + "?needAccess=true"
                pdf_path = (fb, False)
        break

    # ── 4) Generate comprehensive RIS ─────────────────────────────────────
    ris_path = None
    if references and msg.get("reference"):
        ris_fn = doi.replace("/", "_") + ".ris"
        ris_path = os.path.join(save_dir, ris_fn)

        # helper: page split
        def _write_pages(fh, ps):
            ps = ps.replace("–", "-")
            if "-" in ps:
                s, e = ps.split("-", 1)
                fh.write(f"SP  - {s}\nEP  - {e}\n")
            else:
                fh.write(f"SP  - {ps}\n")

        # helper: JSON→RIS
        def _write_ris(fh, rec, local=None):
            fh.write("TY  - JOUR\n")
            fh.write(f"TI  - {(rec.get('title') or [''])[0]}\n")
            if rec.get("container-title"):
                fh.write(f"T2  - {rec['container-title'][0]}\n")
            for a in rec.get("author", []):
                nm = f"{a.get('given', '')} {a.get('family', '')}".strip()
                fh.write(f"AU  - {nm}\n")
                if "ORCID" in a:
                    fh.write(f"ID  - {a['ORCID']}\n")
            if rec.get("issued", {}).get("date-parts"):
                fh.write(f"PY  - {rec['issued']['date-parts'][0][0]}\n")
            for tag, fld in [("VL", "volume"), ("IS", "issue")]:
                if rec.get(fld):
                    fh.write(f"{tag}  - {rec[fld]}\n")
            if rec.get("page"):
                _write_pages(fh, rec["page"])
            for sn in rec.get("ISSN", []):
                fh.write(f"SN  - {sn}\n")
            if rec.get("publisher"):
                fh.write(f"PB  - {rec['publisher']}\n")
            if rec.get("abstract"):
                fh.write(f"AB  - {rec['abstract']}\n")
            for kw in rec.get("subject", []):
                fh.write(f"KW  - {kw}\n")
            for lic in rec.get("license", []):
                fh.write(f"N1  - LICENSE={lic.get('URL')}\n")
            for fund in rec.get("funder", []):
                nm = fund.get("name")
                if nm: fh.write(f"C1  - FUNDING={nm}\n")
            if rec.get("DOI"):
                fh.write(f"DO  - {rec['DOI']}\n")
            if rec.get("URL"):
                fh.write(f"UR  - {rec['URL']}\n")
            if local:
                fh.write(f"L1  - {local}\n")
            fh.write("ER  - \n\n")

        # use tqdm if available
        try:
            from tqdm import tqdm
            refs = tqdm(msg["reference"], desc="Writing RIS")
        except ImportError:
            refs = msg["reference"]

        with open(ris_path, "w", encoding="utf-8") as fh:
            # main
            _write_ris(fh, msg, local=pdf_path[0] if pdf_path and pdf_path[1] else None)
            # each reference
            for ref in refs:
                ref_meta = None
                # DOI branch
                if ref.get("DOI"):
                    ref_meta = fetch_crossref_meta(doi=ref["DOI"])
                # fallback via bibliographic
                if not ref_meta and {"author", "year"}.issubset(ref) and (
                        ref.get("volume-title") or ref.get("journal-title")
                ):
                    terms = f"{ref.get('volume-title') or ref.get('journal-title')} " \
                            f"{ref['author']} {ref['year']}"
                    ref_meta = fetch_crossref_meta(title=terms)
                # write
                if ref_meta:
                    _write_ris(fh, ref_meta)
                else:
                    fh.write("TY  - JOUR\n")
                    if ref.get("volume-title") or ref.get("journal-title"):
                        fh.write(f"T2  - {ref.get('volume-title') or ref.get('journal-title')}\n")
                    if ref.get("author"):
                        fh.write(f"AU  - {ref['author']}\n")
                    if ref.get("year"):
                        fh.write(f"PY  - {ref['year']}\n")
                    if ref.get("DOI"):
                        fh.write(f"DO  - {ref['DOI']}\n")
                    fh.write("ER  - \n\n")

    return {"metadata": md, "pdf_path": pdf_path, "ris_path": ris_path}

def fetch_unpaywall(doi: str) -> str | None:
    """Return a direct PDF URL from Unpaywall for the given DOI, or None."""
    url = f"https://api.unpaywall.org/v2/{doi}"
    params = {"email": _next_mailto()}
    try:
        r = requests.get(url, params=params, timeout=5)
        r.raise_for_status()
        data = r.json()
        return data.get("best_oa_location", {}).get("url_for_pdf")
    except Exception:
        return None
def dpla_search(query):
    """
    Searches the Digital Public Library of America.
    """
    if not DPLA or not DPLA_key:
        print("DPLA client or API key not available.")
        return None
    try:
        dpla = DPLA(api_key=DPLA_key)
        result = dpla.search(q=query)
        cleaned_results = []
        for item in result.items:
            cleaned_results.append({
                "title": item.get("sourceResource", {}).get("title", "No Title Provided"),
                "year": item.get("sourceResource", {}).get("date", {}).get("begin"),
                "creator": item.get("sourceResource", {}).get("creator", "No Creator Provided"),
                "link": item.get("isShownAt"),
                'database': 'DPLA'
            })
        return cleaned_results
    except Exception as e:
        print(f"An error occurred with dpla_search: {e}")
        return None
def find_pdf_or_save(
    doi: str | None = None,
    title: str | None = None,
    author: str | None = None,
    year: int | None = None,
    save_dir: str = ".",
    ELSEVIER_KEY: str | None = None,
) -> str | None:
    if not ELSEVIER_KEY:
        print("Elsevier API key missing.")
        return None
    os.makedirs(save_dir, exist_ok=True)

    # direct DOI
    if doi:
        return download_full_elsevier_pdf(doi, save_dir, ELSEVIER_KEY)

    # metadata branch ➟ discover DOI first
    if title and year:
        meta = fetch_elsevier_pdf_by_metadata(
            title=title, author=author or "", year=year, api_key=ELSEVIER_KEY
        )
        doi_found = meta.get("doi")
        if doi_found:
            return download_full_elsevier_pdf(doi_found, save_dir, ELSEVIER_KEY)
        # Crossref→Unpaywall fallback
        cr = fetch_crossref_meta(title=title, year=year, author=author)
        if cr.get("DOI"):
            return fetch_unpaywall(cr["DOI"])
    else:
        print("Need DOI or (title + year) to proceed.")
    return None




def fetch_elsevier_pdf(
    doi: str,
    api_key: ELSEVIER_KEY,
    max_retries: int = 3,
    backoff_factor: float = 1.0,
) -> dict:
    """
    Call Elsevier Article-Retrieval API with httpAccept=application/pdf.
    If the user is entitled the call returns HTTP 307 → Location header.
    Otherwise it returns a preview (≈ first page) in the body.

    Returns a dict:
      status_code · headers · pdf_url · content  (exactly one of pdf_url/content
      will be populated – never both)
    """
    sess = requests.Session()
    retries = Retry(
        total=max_retries,
        backoff_factor=backoff_factor,
        status_forcelist=[429, 500, 502, 503, 504],
        allowed_methods=["GET"],
    )
    sess.mount("https://", HTTPAdapter(max_retries=retries))

    r = sess.get(
        f"https://api.elsevier.com/content/article/doi/{doi}",
        headers={"Accept": "application/pdf", "X-ELS-APIKey": api_key},
        params={"httpAccept": "application/pdf"},
        allow_redirects=False,
        timeout=10,
    )
    return {
        "status_code": r.status_code,
        "headers": dict(r.headers),
        "pdf_url": r.headers.get("Location") if r.status_code == 307 else None,
        "content": r.content if r.status_code != 307 else None,
    }

def fetch_elsevier_pdf_by_metadata(
    title: str,
    author: str,
    year: int,
    api_key: str,
    max_retries: int = 3,
    backoff_factor: float = 1.0
) -> dict:
    """
    1) Query Scopus Search API with:
         a) TITLE-ABS-KEY(title) AND AUTHLASTNAME(author) AND PUBYEAR IS year
         b) TITLE-ABS-KEY(title) AND PUBYEAR IS year
         c) TITLE-ABS-KEY(title)
    2) On first DOI hit, call fetch_elsevier_pdf to retrieve PDF.
    Returns: {
      "strategy": "scopus" | None,
      "query": str | None,
      "entry": dict | None,
      "doi": str | None,
      "pdf": dict | None,
      "error": str | None
    }
    """
    result = {
        "strategy": None,
        "query": None,
        "entry": None,
        "doi": None,
        "pdf": None,
        "error": None
    }

    def scopus_search(q: str):
        sess = requests.Session()
        retries = Retry(
            total=max_retries,
            backoff_factor=backoff_factor,
            status_forcelist=[429,500,502,503,504],
            allowed_methods=["GET"]
        )
        sess.mount("https://", HTTPAdapter(max_retries=retries))
        headers = {
            "Accept": "application/json",
            "X-ELS-APIKey": api_key
        }  # your API key must go in this header :contentReference[oaicite:5]{index=5}
        resp = sess.get(
            "https://api.elsevier.com/content/search/scopus",
            headers=headers,

            params={
                "query": q,
                "count": 1,
                "view": "COMPLETE"   # ensures DOI is returned :contentReference[oaicite:6]{index=6}
            },
            timeout=10
        )
        resp.raise_for_status()
        print(resp.json())
        return resp.json() \
                   .get("search-results", {}) \
                   .get("entry", [])

    # Strict→Loose search patterns
    patterns = [
        f'TITLE-ABS-KEY({title}) AND AUTHLASTNAME({author}) AND PUBYEAR IS {year}',
        f'TITLE-ABS-KEY({title}) AND PUBYEAR IS {year}',
        f'TITLE-ABS-KEY({title})'
    ]  # uppercase qualifiers required :contentReference[oaicite:7]{index=7}

    for pat in patterns:
        entries = scopus_search(pat)
        if not entries or entries[0].get("error"):
            continue
        doi_ = entries[0].get("prism:doi")
        if doi_:
            result.update({"doi": doi_})
            full_path = download_full_elsevier_pdf(doi_, save_dir="downloads", api_key=api_key)
            result["pdf"] = {"pdf_path": full_path} if full_path else None
            return result
            result["pdf"] = fetch_elsevier_pdf(
                doi=doi_,
                api_key=api_key,
                max_retries=max_retries,
                backoff_factor=backoff_factor
            )
            return result

    result["error"] = "No DOI found via Scopus Search"
    return result


# ── Path 1 only ──────────────────────────────────────────────────────────
def find_pdf_by_doi(
    doi: str,
    save_dir: str,
    ELSEVIER_KEY: str
) -> Optional[str]:
    """
    Given a DOI, try Elsevier → save bytes or return redirect URL.
    Fallback to Unpaywall if necessary.
    """
    os.makedirs(save_dir, exist_ok=True)
    payload = fetch_elsevier_pdf(doi, ELSEVIER_KEY)
    # 1a) raw bytes
    if payload.get("content"):
        ctype = payload["headers"].get("Content-Type","")
        if "application/pdf" in ctype:
            fn = doi.replace("/","_") + ".pdf"
            path = os.path.join(save_dir, fn)
            save_pdf(payload["content"], path)
            return path
    # 1b) redirect
    if payload.get("pdf_url"):
        return payload["pdf_url"]
    # 1c) Unpaywall
    return fetch_unpaywall(doi)

# ── Path 2 only ──────────────────────────────────────────────────────────
def find_pdf_by_metadata(
    title: str,
    author: str,
    year: int,
    save_dir: str,
    ELSEVIER_KEY: str
) -> Optional[str]:
    """
    Given title/author/year, discover DOI or PDF URL, then save or return URL.
    """
    meta = fetch_elsevier_pdf_by_metadata(title,author,year,ELSEVIER_KEY)
    # direct URL?
    pdf_meta = meta.get("pdf",{})
    if pdf_meta.get("pdf_url"):
        return pdf_meta["pdf_url"]
    # raw bytes?
    if pdf_meta.get("content"):
        fn = (meta.get("doi") or title).replace("/","_") + ".pdf"
        path = os.path.join(save_dir, fn)
        save_pdf(pdf_meta["content"], path)
        return path
    # DOI discovered?
    doi = meta.get("doi")
    if doi:
        full_path = download_full_elsevier_pdf(doi, save_dir, ELSEVIER_KEY)
        return full_path
    cr = fetch_crossref_data(title, str(year), author)
    if cr.get("DOI"):
        return fetch_unpaywall(cr["DOI"])
    return None

# ── Dispatch ─────────────────────────────────────────────────────────────
def find_pdf(
    doi: Optional[str] = None,
    title: Optional[str] = None,
    author: Optional[str] = None,
    year: Optional[int] = None,
    save_dir: str = ".",
    ELSEVIER_KEY: Optional[str] = ELSEVIER_KEY
) -> Optional[str]:
    """
    Dispatcher: if doi provided → Path 1, else → Path 2.
    Returns saved-path or URL or None.
    """
    if doi:
        return find_pdf_by_doi(doi, save_dir, ELSEVIER_KEY)
    if title and year:
        return find_pdf_by_metadata(title, author or "", year,
                                    save_dir, ELSEVIER_KEY)
    print("Must supply either a DOI or both title & year.")
    return None
def download_full_elsevier_pdf(
        doi: str,
        save_dir: str = ".",
        api_key: str = ELSEVIER_KEY,
        preview_threshold: int = 120_000,
        proxy_prefix: str = "http://libproxy.ucl.ac.uk/login?url=",
):
    """
    Save the *complete* PDF for `doi`.

    Strategy
    --------
    1. Article-Retrieval API → if 307 simply follow it (full text).
    2. If we get bytes but size < `preview_threshold`, treat as preview
       and re-query the ScienceDirect PII endpoint.
    3. If ScienceDirect still fails with 403, retry through UCL EZ-proxy.
    4. Last resort → Unpaywall OA PDF (may be None).
    """
    import os, requests, sys
    from urllib.parse import quote_plus

    os.makedirs(save_dir, exist_ok=True)

    def _stream_save(url: str, use_proxy: bool = False) -> str | None:
        if use_proxy:
            url = proxy_prefix + quote_plus(url)
        hdrs = {
            "X-ELS-APIKey": api_key,
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/138.0.0.0 Safari/537.36"
            ),
            "Accept": "application/pdf,*/*;q=0.8",
        }
        with requests.get(url, headers=hdrs, stream=True, timeout=30) as r:
            if r.status_code in (401, 403) and not use_proxy:
                # second chance via proxy
                return _stream_save(url, use_proxy=True)
            r.raise_for_status()
            fn = doi.replace("/", "_") + ".pdf"
            path = os.path.join(save_dir, fn)
            with open(path, "wb") as fh:
                for chunk in r.iter_content(8192):
                    fh.write(chunk)
            if os.path.getsize(path) <= preview_threshold and not use_proxy:
                # still a preview → proxy retry
                return _stream_save(url, use_proxy=True)
            return path

    # ― 1 initial call
    first = fetch_elsevier_pdf(doi, api_key)
    if first["pdf_url"]:                         # got redirect
        return _stream_save(first["pdf_url"])

    raw = first["content"] or b""
    if len(raw) > preview_threshold:             # full PDF already
        fn = doi.replace("/", "_") + ".pdf"
        full = os.path.join(save_dir, fn)
        with open(full, "wb") as fh:
            fh.write(raw)
        return full

    # ― 2 preview → need PII
    meta = requests.get(
        f"https://api.elsevier.com/content/abstract/doi/{doi}",
        headers={"Accept": "application/json", "X-ELS-APIKey": api_key},
        timeout=10,
    )
    if meta.ok:
        pii = (meta.json()
                  .get("abstracts-retrieval-response", {})
                  .get("coredata", {})
                  .get("pii"))
        if pii:
            sci_url = (
                f"https://api.elsevier.com/content/article/pii/{pii}"
                "?httpAccept=application/pdf"
            )
            try:
                return _stream_save(sci_url)
            except requests.HTTPError:
                pass

    # ― 3 OA fallback
    return fetch_unpaywall(doi)


# ── Globals & Cache Setup ────────────────────────────────────────────────
ELSEVIER_CACHE: dict = {}
ELSEVIER_CACHE_PATH = "elsevier_cache.json"

try:
    with open(ELSEVIER_CACHE_PATH, "r", encoding="utf-8") as _ecf:
        ELSEVIER_CACHE = json.load(_ecf)
except Exception:
    ELSEVIER_CACHE = {}

def _save_elsevier_cache():
    try:
        with open(ELSEVIER_CACHE_PATH, "w", encoding="utf-8") as _ecf:
            json.dump(ELSEVIER_CACHE, _ecf, indent=2, ensure_ascii=False)
    except Exception as exc:
        LOG.warning(f"Failed to write Elsevier cache: {exc}")

# ── Unified Elsevier Fetcher ─────────────────────────────────────────────
def fetch_elsevier_data(
    doi: str | None = None,
    title: str | None = None,
    author: str | None = None,
    year: int | None = None,
    save_dir: str = ".",
    references: bool = True,
    cache=False,
) -> dict:
    os.makedirs(save_dir, exist_ok=True)

    # Build cache key
    if doi:
        cache_key = f"doi|{doi}"
    else:
        cache_key = f"meta|{title or ''}|{author or ''}|{year or ''}"

    # Return cached result if available
    if cache_key in ELSEVIER_CACHE and cache:
        return ELSEVIER_CACHE[cache_key]

    result = {"metadata": {}, "pdf_path": None, "ris_path": None, "error": None}

    # ── 1) Discover or fetch DOI & metadata ────────────────────────────────
    if doi is None:
        if not (title and author and year):
            result["error"] = "Must supply DOI or title+author+year"
            ELSEVIER_CACHE[cache_key] = result
            _save_elsevier_cache()
            return result

        meta_search = fetch_elsevier_pdf_by_metadata(
            title=title, author=author, year=year, api_key=ELSEVIER_KEY
        ) or {}
        pdf_blk = meta_search.get("pdf", {}) or {}
        if pdf_blk.get("pdf_url") and meta_search.get("doi") is None:
            result["pdf_path"] = (pdf_blk["pdf_url"], False)

        doi = meta_search.get("doi")
        if doi is None:
            result["error"] = "Unable to discover DOI"
            ELSEVIER_CACHE[cache_key] = result
            _save_elsevier_cache()
            return result

    # ── 2) Fetch full Elsevier metadata ────────────────────────────────────
    session = requests.Session()
    session.mount("https://", HTTPAdapter(
        max_retries=Retry(total=3, backoff_factor=1,
                          status_forcelist=[429,500,502,503,504],
                          allowed_methods=["GET"])
    ))
    headers = {"Accept": "application/json", "X-ELS-APIKey": ELSEVIER_KEY}
    meta_url = f"https://api.elsevier.com/content/article/doi/{doi}"
    try:
        r_meta = session.get(meta_url, headers=headers,
                             params={"view": "FULL"}, timeout=10)
        r_meta.raise_for_status()
    except Exception as exc:
        result["error"] = f"Metadata fetch failed: {exc}"
        ELSEVIER_CACHE[cache_key] = result
        _save_elsevier_cache()
        return result

    full = r_meta.json().get("full-text-retrieval-response", {})
    core = full.get("coredata", {})

    # ── 3) Parse rich metadata ─────────────────────────────────────────────
    # ── 3) Parse rich metadata ─────────────────────────────────────────────
    authors_field = core.get("dc:creator")

    if isinstance(authors_field, list):
        # already a list of author strings
        authors_list = authors_field
    elif isinstance(authors_field, dict):
        # a single author object; try to extract the main string
        # common patterns: {'$': 'Name...'} or {'dc:creator': 'Name...'}
        if "$" in authors_field:
            authors_list = [authors_field["$"]]
        else:
            # fallback to any string values in the dict
            authors_list = [v for v in authors_field.values() if isinstance(v, str)]
    else:
        # a single string (semicolon-separated)
        authors_list = [a.strip() for a in (authors_field or "").split(";") if a.strip()]

    md = {
        "title": core.get("dc:title"),
        "authors": authors_list,
        "journal": core.get("prism:publicationName"),
        "publisher": core.get("dc:publisher"),
        "publication_date": core.get("prism:coverDate"),
        "year": None,
        "volume": core.get("prism:volume"),
        "issue": core.get("prism:issueIdentifier"),
        "pages": core.get("prism:pageRange"),
        "doi": core.get("prism:doi"),
    "url": (
        lambda u: f"https://www.sciencedirect.com/science/article/pii/{u.split('/pii/')[-1]}"
        if u and u.startswith("https://api.elsevier.com/content/article/pii/")
        else u
    )(core.get("prism:url")),


        "issn": core.get("prism:issn"),
        "eissn": core.get("prism:eIssn"),
        "language": core.get("dc:language"),
        "abstract": core.get("dc:description"),
        "keywords": [kw.get("$") for kw in full.get("authkeywords", []) if kw.get("$")],
        "reference_count": core.get("citedby-count"),
    }

    # extract numeric year if present
    pd = md["publication_date"]
    if isinstance(pd, str) and "-" in pd:
        try:
            md["year"] = int(pd.split("-")[0])
        except ValueError:
            pass

    result["metadata"] = md

    # ── 4) Download PDF or record fallback ──────────────────────────────────
    try:
        pdf_info = fetch_elsevier_pdf(doi=doi, api_key=ELSEVIER_KEY,)
        # Case A: raw bytes returned
        if pdf_info.get("content"):
            fn = doi.replace("/", "_") + ".pdf"
            local_path = os.path.join(save_dir, fn)
            with open(local_path, "wb") as f:
                f.write(pdf_info["content"])

            # Count pages
            try:
                reader = PdfReader(local_path)
                num_pages = len(reader.pages)
            except Exception:
                num_pages = None

            # If only 1 page (likely preview), discard local and treat as URL-only
            if num_pages == 1:
                os.remove(local_path)
                # if redirect URL was provided earlier, prefer that; else rebuild
                redirect_url = pdf_info.get("pdf_url") or f"{meta_url}?httpAccept=application/pdf"
                result["pdf_path"] = (redirect_url, False)
            else:
                result["pdf_path"] = (local_path, True)

        # Case B: redirect URL only
        elif pdf_info.get("pdf_url"):
            result["pdf_path"] = (pdf_info["pdf_url"], False)

    except Exception:
        # swallow download errors
        pass

    # # ── 5) Generate RIS via Crossref if requested ──────────────────────────
    # if references and md.get("doi"):
    #     cr = fetch_crossref_data(doi=md["doi"], save_dir=save_dir, references=True)
    #     result["ris_path"] = cr.get("ris_path")
    # ── 5) ensure fallback always uses metadata URL ────────────────────────
    if isinstance(result["pdf_path"], tuple) and result["pdf_path"][1] is False:
        result["pdf_path"] = (md["url"], False)

    # Cache & return
    ELSEVIER_CACHE[cache_key] = result
    _save_elsevier_cache()
    return result

def save_pdf(pdf_bytes: bytes, filename: str = 'article.pdf'):
    """
    Save raw PDF bytes to a file.

    Parameters:
    - pdf_bytes: The complete binary content of the PDF.
    - filename:  Path where the PDF will be saved.
    """
    with open(filename, 'wb') as f:
        f.write(pdf_bytes)
    print(f"Saved PDF to {filename}")

# Context-aware cyber-threat attribution based on hybrid features
# ICT Express, Vol.10 Issue 3 (Jun 2024), DOI:10.1016/j.icte.2024.04.005
# print(fetch_elsevier_pdf("10.1016/j.icte.2024.04.005", ELSEVIER_KEY))

# out = fetch_elsevier_pdf_by_metadata(
#     title="attributing cyberattacks",
#     author="rid",
#     year=2015,
#     api_key=ELSEVIER_KEY
# )


#
#
# if out["error"]:
#     print("❗Error:", out["error"])
# else:
#     print("✔ Strategy:", out["strategy"])
#     print("✔ DOI:", out["doi"])
#     pdf = out["pdf"]
#     if pdf.get("pdf_url"):
#         print("PDF URL:", pdf["pdf_url"])
#     elif pdf.get("content"):
#         save_pdf(pdf["content"], filename=f"{out['doi'].replace('/','_')}.pdf")
#     else:
#         print("No PDF found.")
# payload= {'doi': '10.1080/01402390.2014.977382' }
#
# resullt =fetch_crossref_data(**payload)
#
# print(resullt)
# payload = {"doi": "10.1016/j.icte.2024.04.005"}
# result = fetch_elsevier_data(**payload)
# print(result["metadata"])
# print("PDF:", result["pdf_path"])
# print("RIS:", result["ris_path"])
from selenium.webdriver.support import expected_conditions as EC

def download_from_scihub_selenium(
        browser,
    doi: str,
    save_dir: str = "downloads",
    timeout: int = 60,
    size_floor: int = 20_000,


) -> str | None:
    """
    Download a full multi-page PDF from Sci-Hub using undetected Selenium.

    • doi: a DOI (e.g. "10.1016/j.icte.2024.04.005") or full article URL
    • save_dir:   directory to write the .pdf
    • timeout:    seconds to wait for embeds
    • size_floor: minimum bytes to accept (otherwise discard as preview)

    Returns the absolute path to the saved PDF, or None on failure.
    """
    mirror = "https://sci-hub.st"
    # build landing URL (Sci-Hub wants the full URL if you pass one, else DOI alone)
    path = doi if doi.lower().startswith(("http://","https://")) else doi
    landing_url = f"{mirror}/{path}"

    # 1) launch browser
    try:
        # 2) visit mirror root to set any Cloudflare cookies
        browser.get(mirror)
        WebDriverWait(browser, timeout).until(
            lambda d: d.execute_script("return document.readyState") == "complete"
        )

        # 3) go to landing page
        browser.get(landing_url)

        # 4) wait for the PDF container (<embed> or <iframe> or <object>)
        wait = WebDriverWait(browser, timeout)
        pdf_elem = wait.until(EC.presence_of_element_located(
            (By.CSS_SELECTOR, "embed#pdf, iframe#pdf, embed, iframe, object")
        ))

        # extract the PDF src
        pdf_src = pdf_elem.get_attribute("src") or pdf_elem.get_attribute("data")
        if not pdf_src:
            print("❗ Couldn’t find PDF src on the page.")
            return None

        # normalize protocol-relative or root-relative URLs
        if pdf_src.startswith("//"):
            pdf_src = "https:" + pdf_src
        elif pdf_src.startswith("/"):
            pdf_src = mirror + pdf_src

        # 5) harvest cookies from Selenium
        session = requests.Session()
        for ck in browser.get_cookies():
            session.cookies.set(ck['name'], ck['value'])
        headers = {
            "Accept": "application/pdf",
            "User-Agent": browser.execute_script("return navigator.userAgent"),
            "Referer": landing_url
        }
        # 6) stream & save
        resp = session.get(pdf_src, headers=headers, stream=True, timeout=timeout)
        resp.raise_for_status()

        # ensure save_dir exists
        Path(save_dir).mkdir(parents=True, exist_ok=True)
        safe_name = re.sub(r"[^\w\-\.]", "_", doi) + ".pdf"
        out_path = Path(save_dir) / safe_name

        with open(out_path, "wb") as f:
            for chunk in resp.iter_content(64_000):
                if chunk:
                    f.write(chunk)

        # 7) sanity‐check file size & page count
        size = out_path.stat().st_size
        if size < size_floor:
            print(f"⚠ Tiny PDF ({size} bytes), likely preview → deleting.")
            out_path.unlink(missing_ok=True)
            return None

        try:
            pages = len(PdfReader(str(out_path)).pages)
            if pages == 1:
                print("⚠ Single‐page PDF, preview only → deleting.")
                out_path.unlink(missing_ok=True)
                return None
        except Exception:
            # ignore PDF parsing errors
            pass

        print(f"✓ Saved PDF to {out_path} ({size//1024} KB, ~{pages} pages)")
        return str(out_path.resolve())

    except Exception as e:
        print("❗ Error downloading from Sci-Hub:", e)
        return None



_DOI_PAT = re.compile(r"""
    10\.\d{4,9}           #  “10.” + 4-9 digits
    /
    (?:[\w.;()/:-]+)      #  the rest (no greedy white-space)
""", re.X | re.I)

def _extract_doi_from_url(url: str) -> str | None:
    """
    Quick DOI sniffer for arbitrary URLs.
    """
    m = _DOI_PAT.search(url)
    return m.group(0) if m else None
from typing import Optional, Dict, Any
import requests

def downloading_metadata(
    *,
    browser,
    url: Optional[str] = None,
    doi: Optional[str] = None,
    title: Optional[str] = None,
    author: Optional[str] = None,
    year: Optional[int] = None,
    save_dir: str = "downloads",
    want_ris: bool = False,
) -> Dict[str, Any]:
    """
    One-stop dispatcher for metadata + multi-page PDF retrieval.

    Returns dict:
      {
        "metadata": {...},
        "pdf_path": (path_or_url, downloaded_flag) | None,
        "ris_path": str | None,
        "source": str,
        "error": str | None,
      }
    """
    result: Dict[str, Any] = {
        "metadata": {},
        "pdf_path": None,
        "ris_path": None,
        "source": None,
        "error": None,
    }

    # 1) Normalize: extract DOI from URL if needed
    if not doi and url:
        doi = _extract_doi_from_url(url)
        print(f"-> extracted DOI from URL: {doi}")

    # ── A) DOI branch ────────────────────────────────────────────────────────
    if doi:
        print(f"=== DOI branch: {doi} ===")
        data: Dict[str, Any] = {}

        # 1⃣ libgen
        print("2) Trying Libgen…")
        try:
            print("1) Trying DOI-based fetch…")
            pdf= fetch_and_download_by_doi(doi=doi, save_dir=save_dir)
        except Exception as e:
            pdf = None
            print(f"  ❗ DOI fetch error: {e!r}")
        if pdf:
            print(f"  ✓ Sci-Hub PDF saved to {pdf}")
            result["pdf_path"] = (pdf, True)
            result["source"] = "libgen"
        # 1⃣ Sci-Hub via Selenium
        print("2) Trying Sci-Hub…")

        if not pdf:
            try:
                pdf = download_from_scihub_selenium(doi=doi, save_dir=save_dir, browser=browser)
            except Exception as exc:
                pdf = None
                print(f"  ❗ Sci-Hub error: {exc!r}")
            if pdf:
                print(f"  ✓ Sci-Hub PDF saved to {pdf}")
                result["pdf_path"] = (pdf, True)
                result["source"] = "scihub"

        # 2⃣ Elsevier fallback
        if not result["pdf_path"]:
            print("2) Trying Elsevier…")
            data = fetch_elsevier_data(doi=doi, save_dir=save_dir, references=want_ris)
            meta = data.get("metadata", {})
            print(f"  → Elsevier metadata keys: {list(meta.keys())}")
            result["metadata"].update(meta)
            if data.get("pdf_path"):
                print(f"  ✓ Elsevier PDF at {data['pdf_path']}")
                result["pdf_path"] = data["pdf_path"]
                result["source"] = (result["source"] or "") + "+elsevier"
            if data.get("ris_path"):
                print(f"  ✓ RIS saved to {data['ris_path']}")
                result["ris_path"] = data["ris_path"]

        # 3⃣ Crossref/Unpaywall fallback
        if not result["metadata"] or not result["pdf_path"]:
            print("3) Trying Crossref/Unpaywall…")
            try:
                cr = fetch_crossref_data(doi=doi, save_dir=save_dir, references=want_ris)
            except requests.exceptions.HTTPError as e:
                print(f"  ⚠ Crossref HTTP error: {e}")
                cr = {}
            cr_meta = cr.get("metadata", {})
            print(f"  → Crossref metadata keys: {list(cr_meta.keys())}")
            if not result["metadata"]:
                result["metadata"] = cr_meta
            if not result["pdf_path"] and cr.get("pdf_path"):
                print(f"  ✓ Crossref PDF at {cr['pdf_path']}")
                result["pdf_path"] = cr["pdf_path"]
                result["source"] = (result["source"] or "") + "+crossref"
            if not result["ris_path"] and cr.get("ris_path"):
                print(f"  ✓ Crossref RIS at {cr['ris_path']}")
                result["ris_path"] = cr["ris_path"]

        result["source"] = result["source"] or "fail"
        if result["source"] == "fail":
            result["error"] = "All DOI-based lookups failed"
        return result

    # ── B) URL-only branch ───────────────────────────────────────────────────
    if url:
        print(f"=== URL branch (no DOI): {url} ===")
        print("1) Trying Crossref URL lookup…")
        try:
            cr = fetch_crossref_data(title=url, save_dir=save_dir, references=want_ris)
        except requests.exceptions.HTTPError as e:
            print(f"  ⚠ Crossref (URL) error: {e}")
            cr = {}
        if cr.get("metadata"):
            print("  ✓ Crossref returned metadata")
            result["metadata"] = cr["metadata"]
            result["ris_path"] = cr.get("ris_path")
            doi = cr["metadata"].get("doi") or cr["metadata"].get("DOI")
            print(f"  → found DOI: {doi}")

        if doi:
            print("→ Recursing into DOI branch…")
            return downloading_metadata(
                browser=browser,
                doi=doi,
                title=title,
                author=author,
                year=year,
                save_dir=save_dir,
                want_ris=want_ris,
            )

        result["error"] = "URL present but no DOI could be parsed or found"
        result["source"] = "url_no_doi"
        return result

    # ── C) Metadata-only branch ─────────────────────────────────────────────
    if title and year:
        print(f"=== Metadata-only branch: {title} ({year}) ===")
        print("1) Trying Elsevier metadata search…")
        em = fetch_elsevier_data(
            title=title, author=author or "", year=year,
            save_dir=save_dir, references=want_ris
        )
        result["metadata"] = em.get("metadata", {})
        result["pdf_path"]  = em.get("pdf_path")
        result["ris_path"]  = em.get("ris_path")
        result["source"]    = "elsevier_meta"
        print(f"  → Elsevier found DOI: {result['metadata'].get('doi')}")

        doi = result["metadata"].get("doi")
        # 2) Crossref if Elsevier failed
        if not result["metadata"]:
            print("2) Elsevier metadata empty; trying Crossref metadata search…")
            cr = fetch_crossref_data(
                title=title, author=author, year=year,
                save_dir=save_dir, references=want_ris
            )
            result["metadata"] = cr.get("metadata", {})
            if not result["pdf_path"] and cr.get("pdf_path"):
                result["pdf_path"] = cr["pdf_path"]
            if not result["ris_path"]:
                result["ris_path"] = cr.get("ris_path")
            result["source"] = "crossref_meta"
            doi = doi or result["metadata"].get("doi")
            print(f"  → Crossref found DOI: {doi}")

        # 3) Sci-Hub as a last resort
        if doi and not (result["pdf_path"] and result["pdf_path"][1]):
            print("3) Trying Sci-Hub last-resort…")
            try:
                sp = download_from_scihub_selenium(doi=doi, save_dir=save_dir, browser=browser)
            except Exception as exc:
                sp = None
                print(f"  ❗ Sci-Hub error: {exc!r}")
            if sp:
                print(f"  ✓ Sci-Hub PDF saved to {sp}")
                result["pdf_path"] = (sp, True)
                result["source"] += "+scihub"

        if not result["metadata"]:
            result["error"] = "Nothing matched via Elsevier/Crossref"
            result["source"] = "fail_meta"

        return result

    # ── Nothing at all ───────────────────────────────────────────────────────
    result["error"] = "Need at least DOI, URL, or (title+year)"
    result["source"] = "fail_args"
    return result


def _sanitise_url(u: str) -> str:
    u = u.strip()
    parsed = urlparse(u)
    if parsed.scheme and parsed.scheme not in ("http", "https"):
        raise ValueError(f"Unsupported URL scheme: {parsed.scheme}")
    if not parsed.scheme:
        parsed = parsed._replace(scheme="https")
    safe_path = quote(parsed.path or "", safe="/:@")
    safe_query = quote(parsed.query or "", safe="=&")
    return urlunparse(parsed._replace(path=safe_path, query=safe_query))


def _find_explicit_download(driver, current_url: str) -> str | None:
    domain = urlparse(current_url).netloc.lower()
    # SSRN: "Open PDF in Browser"
    if "ssrn.com" in domain:
        try:
            a = driver.find_element(
                By.XPATH,
                '//a[contains(@class,"button-link") and contains(span/text(),"Open PDF in Browser")]'
            )
            return a.get_attribute("href")
        except:
            pass
    # Digital Commons (UConn)
    if "digitalcommons.lib.uconn.edu" in domain:
        try:
            a = driver.find_element(
                By.CSS_SELECTOR,
                "div.aside.download-button a.btn[href$='.pdf']"
            )
            return a.get_attribute("href")
        except:
            pass
    # RAND: "Download PDF" button
    if "rand.org" in domain:
        try:
            a = driver.find_element(
                By.CSS_SELECTOR,
                "a.btn.btn-md.icon-before-download[href$='.pdf'], a.btn.btn-md.icon-before[href*='download']"
            )
            return a.get_attribute("href")
        except:
            pass
    # Generic scan for any PDF link with download/pdf cues
    xpath_patterns = [
        '//a[contains(@class,"pdf") or contains(@class,"download")][@href]',
        '//a[normalize-space()="PDF" or contains(text(),"Download")][@href]',
        '//button[contains(text(),"PDF") or contains(text(),"Download")][@href]',
        '//a[img[contains(@src,"pdf")]][@href]'
    ]
    for xp in xpath_patterns:
        elems = driver.find_elements(By.XPATH, xp)
        if elems:
            return elems[0].get_attribute("href")
    return None


def _save_via_pyautogui(abs_path: str, wait: float = 1.0):
    """
    Fallback to Save As dialog:
      1) Copy abs_path to clipboard
      2) Press Ctrl+S
      3) Paste (Ctrl+V)
      4) Press Enter
    """
    pyperclip.copy(abs_path)  # copy target path :contentReference[oaicite:1]{index=1}
    pyautogui.hotkey("ctrl", "s")  # open Save As dialog :contentReference[oaicite:2]{index=2}
    time.sleep(wait)
    pyautogui.hotkey("ctrl", "v")  # paste path :contentReference[oaicite:3]{index=3}
    time.sleep(0.2)
    pyautogui.press("enter")  # confirm save :contentReference[oaicite:4]{index=4}

AUTO_DOWNLOAD_DOMAINS = {
    "lirias.kuleuven.be",
    "api.dpla.org",
    # add more domains here that always stream the PDF directly
}

def download_direct_pdf(
    browser,
    url: str,
    save_dir: str = "downloads",

    size_floor: int = 20_000,
) -> str | None:
    timeout=45
    """
    Download a PDF when you already have a candidate link.

    0) Auto‐download domains → direct requests
    1) URL sanitisation
    2) Domain-aware or generic explicit-link detection
    3) Embedded-viewer fallback
    4) PyAutoGUI Save As fallback with precise path
    5) HTTP download via requests
    """
    # ─── 0) Auto‐download domains ───────────────────────────
    try:
        clean_url = _sanitise_url(url)
    except ValueError as e:
        print("❗ Bad URL:", e)
        return None
    sleep(3)
    print("<UNK> URL:", clean_url)

    domain = urlparse(clean_url).netloc.lower()
    if any(d in domain for d in AUTO_DOWNLOAD_DOMAINS):
        print(f"⏭ Auto-download domain detected ({domain}); fetching directly.")
        Path(save_dir).mkdir(parents=True, exist_ok=True)
        fname = re.sub(r"[^\w\.-]", "_", clean_url.split("/")[-1])
        if not fname.lower().endswith(".pdf"):
            fname += ".pdf"
        out_path = Path(save_dir) / fname

        session = requests.Session()
        session.headers.update({
            "Accept": "application/pdf",
            "User-Agent": browser.execute_script("return navigator.userAgent;"),
            "Referer": clean_url
        })
        for ck in browser.get_cookies():
            session.cookies.set(ck["name"], ck["value"])

        try:
            resp = session.get(clean_url, stream=True, timeout=timeout)
            resp.raise_for_status()

            # pre‑check for Cambridge “Get access” blocker
            if "application/pdf" not in resp.headers.get("Content-Type", ""):
                if 'data-test-id="buttonGetAccess"' in resp.text:
                    print("× Access blocked: no PDF available")
                    return "no available"

            if "application/pdf" in resp.headers.get("Content-Type", ""):
                with open(out_path, "wb") as f:
                    shutil.copyfileobj(resp.raw, f)
                if out_path.stat().st_size >= size_floor:
                    with open(out_path, "rb") as f:
                        if f.read(4) == b"%PDF":
                            print(f"✓ HTTP saved → {out_path.resolve()} ({out_path.stat().st_size // 1024} KB)")
                            return str(out_path.resolve())
                out_path.unlink(missing_ok=True)
        except Exception as e:
            print("⚠ HTTP fetch failed:", e)

        # b) Selenium fallback: open the PDF in‑browser
        try:
            browser.get(clean_url)
        except WebDriverException as e:
            print("⚠ Selenium session error:", e)
            return None

        WebDriverWait(browser, timeout).until(
            lambda d: d.execute_script("return document.readyState") == "complete"
        )

        # DOM check for Cambridge “Get access” blocker
        if browser.find_elements(By.CSS_SELECTOR, 'a.get-access-link'):
            print("× Access blocked (Selenium): no PDF available")
            return "no available"

        # c) trigger Save As
        print("⚠ Falling back to Save As…")
        _save_via_pyautogui(str(out_path.resolve()))

    # ─── 1) Selenium navigation & wait ───────────────────────
    browser.get(clean_url)
    WebDriverWait(browser, timeout).until(
        lambda d: d.execute_script("return document.readyState") == "complete"
    )
    if browser.find_elements(By.CSS_SELECTOR, 'a[data-test-id="buttonGetAccess"]'):
        return "no available"
    # ─── 2) Explicit download‐link detection ─────────────────
    pdf_src = _find_explicit_download(browser, clean_url)

    # ─── 3) Embedded‐viewer fallback ────────────────────────
    if not pdf_src:
        try:
            elem = WebDriverWait(browser, timeout).until(
                EC.presence_of_element_located(
                    (By.CSS_SELECTOR, "embed#pdf, iframe#pdf, embed, iframe, object")
                )
            )
            pdf_src = elem.get_attribute("src") or elem.get_attribute("data")
        except:
            pdf_src = None

    # ─── 4) Save As dialog fallback ─────────────────────────
    if not pdf_src or pdf_src.startswith("about:"):
        Path(save_dir).mkdir(parents=True, exist_ok=True)
        fname = re.sub(r"[^\w\.-]", "_", clean_url.split("/")[-1])
        if not fname.lower().endswith(".pdf"):
            fname += ".pdf"
        abs_path = str((Path(save_dir) / fname).resolve())

        print("⚠ No direct link; invoking Save As dialog…")
        _save_via_pyautogui(abs_path)
        return abs_path

    # ─── 5) Normalize & HTTP‐download ───────────────────────
    if pdf_src.startswith("//"):
        pdf_src = "https:" + pdf_src
    elif pdf_src.startswith("/"):
        p = urlparse(clean_url)
        pdf_src = f"{p.scheme}://{p.netloc}{pdf_src}"

    session = requests.Session()
    for ck in browser.get_cookies():
        session.cookies.set(ck["name"], ck["value"])
    headers = {
        "Accept": "application/pdf",
        "User-Agent": browser.execute_script("return navigator.userAgent"),
        "Referer": clean_url
    }
    try:
        resp = session.get(pdf_src, headers=headers, stream=True, timeout=timeout)
        resp.raise_for_status()
    except Exception as e:
        print("❗ Error fetching PDF:", e)
        return None

    Path(save_dir).mkdir(parents=True, exist_ok=True)
    fname = re.sub(r"[^\w\.-]", "_", pdf_src.split("/")[-1])
    if not fname.lower().endswith(".pdf"):
        fname += ".pdf"
    out_path = Path(save_dir) / fname

    with open(out_path, "wb") as f:
        shutil.copyfileobj(resp.raw, f)

    size = out_path.stat().st_size
    if size < size_floor:
        print(f"⚠ Tiny PDF ({size} bytes); deleting.")
        out_path.unlink(missing_ok=True)
        return None

    print(f"✓ Saved PDF → {out_path.resolve()} ({size // 1024} KB)")
    return str(out_path.resolve())



# ── mirrors that expose both /json.php & /ads.php (July-2025) ──────────────
JSON_MIRRORS: List[str] = [
    "https://libgen.lc/",
    "https://gen.lib.rus.ec/",
    "https://libgen.gs/",
    "https://libgen.li/",
]

# HTML download fallbacks (no JSON here)
LANDING_MIRRORS: List[str] = [
    *JSON_MIRRORS,
    "https://library.lol/",                  # main landing page :contentReference[oaicite:1]{index=1}
]

SCIMAG_DIRECT = "http://books.ms/scimag/"   # DOI → PDF fallback :contentReference[oaicite:2]{index=2}

S = requests.Session()
S.headers.update({"User-Agent": "libgen-fetch/1.1"})
S.mount(
    ("https://", "http://"),
    HTTPAdapter(max_retries=Retry(total=2, backoff_factor=0.6,
                                  status_forcelist=[502, 503, 504],
                                  raise_on_status=False))
)


# ───────────────────────── internal helpers ───────────────────────────────
def _first_alive(roots: List[str]) -> str:
    for root in random.sample(roots, len(roots)):
        try:
            S.head(root, timeout=3)
            return root
        except requests.RequestException:
            continue
    raise RuntimeError("all mirrors seem offline")

def _json_by_doi(doi: str, root: str, timeout: int = 10) -> Dict[str, Any]:
    r = S.get(root + "json.php",
              params={"object": "e", "doi": doi, "fields": "*", "addkeys": "*"},
              timeout=timeout)
    if r.status_code == 404:                # some mirrors 404 on malformed doi
        raise LookupError("JSON endpoint 404")     # bubble to next mirror
    r.raise_for_status()
    data = r.json()
    if "error" in data:
        raise LookupError(data["error"])
    return next(iter(data.values()))        # first (only) record

def _normalize_href(h: str, root: str) -> str:
    if h.startswith("//"):
        return "https:" + h
    if h.startswith("http://") or h.startswith("https://"):
        return h
    if h.startswith("http:") and not h.startswith("http://"):
        return h.replace("http:", "http://", 1)
    return urljoin(root, h.lstrip("/"))

def _first_get_link(md5: str, root: str, timeout: int = 10) -> Optional[str]:
    ads_html = S.get(f"{root}ads.php?md5={md5}", timeout=timeout).text
    soup = BeautifulSoup(ads_html, "lxml")
    a = soup.find("a", href=re.compile(r"get\.php\?md5=", re.I))
    return _normalize_href(a["href"], root) if a else None

def _stream(url: str, out_path: str, timeout: int = 20) -> None:
    with S.get(url, stream=True, timeout=timeout) as r:
        r.raise_for_status()
        with open(out_path, "wb") as fh:
            for chunk in r.iter_content(1 << 16):
                fh.write(chunk)


# ───────────────────────── public one-shot helper ─────────────────────────
def fetch_and_download_by_doi(doi: str,
                              save_dir: str = ".",
                              timeout: int = 10) -> str:
    """
    Download the first LibGen file for *doi*; return local file path.

    Fallback chain:
      1. JSON → ads → get.php
      2. JSON → library.lol/main/<md5> → get.php
      3. books.ms/scimag/<doi>  (direct pdf for scimag)
    """
    # ── A. get MD5 via JSON ───────────────────────────────────────────────
    for jm in random.sample(JSON_MIRRORS, len(JSON_MIRRORS)):
        try:
            rec = _json_by_doi(doi, jm, timeout)
            md5 = next(iter(rec["files"].values()))["md5"]
            break
        except Exception:
            continue
    else:
        raise RuntimeError("no JSON mirror returned a record for that DOI")

    # ── B. resolve MD5 to download link ───────────────────────────────────
    dl_url = None
    for lm in random.sample(LANDING_MIRRORS, len(LANDING_MIRRORS)):
        try:
            dl_url = _first_get_link(md5, lm, timeout)
            if dl_url:
                break
        except Exception:
            continue

    # ── C. final fallbacks ────────────────────────────────────────────────
    if not dl_url:                         # try scimag direct
        dl_url = SCIMAG_DIRECT + quote_plus(doi)
        try:
            S.head(dl_url, timeout=5).raise_for_status()
        except Exception:
            raise RuntimeError("no working GET link found on any mirror")

    # ── D. download to disk ───────────────────────────────────────────────
    print(f"Downloading from {dl_url}")
    with S.get(dl_url, stream=True, timeout=20) as resp:
        resp.raise_for_status()
        fname_hdr = resp.headers.get("Content-Disposition", "")
        m = re.search(r'filename="?([^"]+)"?', fname_hdr)
        ext = os.path.splitext(m.group(1))[1].lstrip(".") if m else "pdf"
        fname = (quote_plus(rec["title"][:60]) + "." + ext).replace("%", "_")
        out_path = os.path.join(save_dir, fname)
        with open(out_path, "wb") as fh:
            for chunk in resp.iter_content(1 << 16):
                fh.write(chunk)
    print(f"✓ saved → {out_path}")
    return out_path

# ── helpers ──────────────────────────────────────────────────────────────
def _filename_from_url(u: str) -> str:
    base = os.path.basename(u.split("?", 1)[0])
    base = re.sub(r"[^\w\.-]", "_", base)     # safe for Windows / *nix
    return base if base.lower().endswith(".pdf") else base + ".pdf"

def _real_pdf_url(session: requests.Session, html: str, base_url: str) -> str | None:
    """Parse the wrapper page and pull out the first plausible PDF URL."""
    soup = BeautifulSoup(html, "html.parser")

    # 1) <meta http-equiv="refresh" content="0; url=FOO">
    meta = soup.find("meta", attrs={"http-equiv": "refresh"})
    if meta and "url=" in meta.get("content", ""):
        return requests.compat.urljoin(base_url, meta["content"].split("url=", 1)[1])

    # 2) <embed src="…pdf">
    emb = soup.find("embed", src=lambda x: x and x.lower().endswith(".pdf"))
    if emb:
        return requests.compat.urljoin(base_url, emb["src"])

    # 3) fallback: first <a class="pdf" href="…pdf">
    a = soup.find("a", href=lambda x: x and x.lower().endswith(".pdf"))
    if a:
        return requests.compat.urljoin(base_url, a["href"])
    return None

# ── main downloader ──────────────────────────────────────────────────────
def digital_commons_download_pdf(url: str, save_dir: str) -> str:
    """
    Download *url* (or whatever PDF it wraps / redirects to) and save it in *save_dir*.
    Uses HEADERS_commons + COOKIES that you already defined elsewhere.
    """
    print("digital_commons_download_pdf:", url)
    os.makedirs(save_dir, exist_ok=True)

    with requests.Session() as s:
        s.headers.update(HEADERS_commons)
        s.cookies.update(COOKIES)

        def fetch(u):
            r = s.get(u, stream=True, timeout=60, allow_redirects=True)
            r.raise_for_status()
            return r

        r = fetch(url)
        ctype = r.headers.get("Content-Type", "").lower()

        # -- if we hit HTML, dig for the embedded PDF ----------------------
        if "html" in ctype:
            html_text = r.text

            # first try JMU Commons direct PDF link
            jmu_match = re.search(r'<a[^>]+id="pdf"[^>]+href="([^"]+)"', html_text)
            if jmu_match:
                real_pdf = urljoin(r.url, html.unescape(jmu_match.group(1)))
            else:
                real_pdf = _real_pdf_url(s, html_text, r.url)

            if not real_pdf:
                raise RuntimeError(f"No PDF link found inside wrapper page: {url}")

            r = fetch(real_pdf)
            ctype = r.headers.get("Content-Type", "").lower()

        if not ctype.startswith("application/pdf"):
            raise RuntimeError(f"Unexpected content-type: {ctype}")

        size = int(r.headers.get("Content-Length", 0))
        print(f"Downloading {size/1024:.1f} KB…" if size else "Downloading…")

        fname = _filename_from_url(r.url)
        out_path = os.path.join(save_dir, fname)

        with open(out_path, "wb") as fh:
            for chunk in r.iter_content(8192):
                if chunk:
                    fh.write(chunk)

        print(f"✓ saved → {out_path}")
        return out_path

def download_paper(url: str,
                   out_dir: str,
                   filename: Optional[str] = None) -> Optional[str]:
    """
    Download *url* to *out_dir*, choosing the right backend automatically.
    Returns absolute path to the PDF on success, or None on failure.
    """
    os.makedirs(out_dir, exist_ok=True)
    lower = url.lower()

    def _dest(name: str) -> str:
        return os.path.abspath(os.path.join(out_dir, name + ".pdf"))

    # 1) direct PDF link
    if lower.endswith(".pdf"):
        name = filename or os.path.splitext(os.path.basename(url))[0]
        ok = download_file(url, out_dir, name)
        return _dest(name) if ok else None

    # 2) HeinOnline
    if "heinonline.org" in lower:
        name = filename or url.split("?", 1)[0].rstrip("/").split("/")[-1] or "page"
        driver = _get_driver()
        try:
            ok = heinonline_download_pdf(
                driver=driver,
                page_url=url,
                output_folder=out_dir,
                pdf_filename=name,
            )
        finally:
            _close_driver()
        return _dest(name) if ok else None

    # 3) IEEE Xplore
    if "ieeexplore.ieee.org" in lower:
        name = filename or url.rstrip("/").split("/")[-1]
        ok = download_ieee_pdf(url, out_dir, name)
        return _dest(name) if ok else None

    # 4) ProQuest
    if "proquest.com" in lower:
        name = filename or url.split("?", 1)[0].rstrip("/").split("/")[-1]
        ok = download_proquest_pdf(url, out_dir, name)
        return _dest(name) if ok else None

    # 5) Cambridge Core
    if "cambridge.org" in lower:
        name = filename or url.rstrip("/").split("/")[-1]
        ok = download_cambridge_pdf(url, out_dir, name)
        return _dest(name) if ok else None

    print(f"✗ unsupported URL pattern → {url}", file=sys.stderr)
    return None
# print(digital_commons_download_pdf("https://digital-commons.usnwc.edu/cgi/viewcontent.cgi?article=2932&context=ils",save_dir="downloads"))
# l= ["https://lirias.kuleuven.be/retrieve/761918"]
# browser = initiate_browser()
# DOIS= ["10.18449/2021rp11","10.5040/9798881815189.ch-009","10.1201/9781003314721-3/rules-retribution-nathan-downes-leandros-maglaras","10.1016/j.telpol.2024.102739","10.1007/978-3-031-15688-5_16","10.1007/978-3-030-48230-5_4"]
# # # downloading_metadata(browser=browser,doi=DOIS[0],save_dir="downloads", want_ris=False)
# for url in DOIS:
#     print(
#     fetch_crossref_data(doi=url, save_dir="downloads")
# )
#     input("Press Enter to continue...")
# for url in l:
#     print("Downloading from:", url)
#     pdf_path = download_direct_pdf(
#         browser=browser,
#         url=url,
#         save_dir="downloads",
#         timeout=30,
#         size_floor=20_000
#     )
#     if pdf_path:
#         print(f"PDF saved to: {pdf_path}")
#     else:
#         print("Failed to download PDF.")
# if __name__ == '__main__':
#     # --- Path 1: direct DOI lookup ---
#     doi_example = "10.1016/j.icte.2024.04.005"
#     print(f"\n>> Lookup via DOI: {doi_example}")
#     result1 = find_pdf(doi=doi_example, save_dir="downloads")
#     print("Result1:", result1)
#
#     print("\n" + "-"*60 + "\n")
#
#     # --- Path 2: metadata lookup (title/author/year) ---
#     title_example = "Law in orbit: international legal perspectives on cyberattacks targeting space systems"
#     author_example = "Bace"
#     year_example = 2024
#     print(f">> Lookup via metadata: {title_example} / {author_example} / {year_example}")
#     result2 = find_pdf(
#         title=title_example,
#         author=author_example,
#         year=year_example,
#         save_dir="downloads"
#     )
#     print("Result2:", result2)
#


RAW_COOKIES ="MAID=bk1MsLpnJiurwinNuwM9dw==; usprivacy=1N--; euconsent-v2=CQHncAAQHncAAAKA1AENBOFsAP_gAEPgAAwIKiNX_G__bWlr8X73aftkeY1P9_h77sQxBhfJE-4FzLvW_JwXx2ExNA36tqIKmRIAu3TBIQNlGJDURVCgaogVryDMaEiUoTNKJ6BkiFMRM2dYCF5vm4tj-QCY5vr991dx2B-t7dr83dzyy41Hn3a5_2a0WJCdA5-tDfv9bROb-9IOd_x8v4v8_F_pE2_eT1l_tWvp7D9-cts7_XW89_fff_9Pn_-uB_-_3_vBUAAkw0KiAMsiQkINAwggQAqCsICKBAAAACQNEBACYMCnYGAS6wkQAgBQADBACAAEGQAIAABIAEIgAgAKBAABAIFAAEABAMBAAwMAAYALAQCAAEB0DFMCCAQLABIzIiFMCEIBIICWyoQSAIEFcIQizwKIBETBQAAAkAFYAAgLBYHEkgJWJBAlxBtAAAQAIBBAAUIpOzAEEAZstReLJtGVpgWD5gue0wDJAiAA.eEAAACgAAAAA; addtl_consent=1~43.3.9.6.9.13.6.4.15.9.5.2.11.8.1.3.2.10.33.4.15.17.2.9.20.7.20.5.20.7.2.2.1.4.40.4.14.9.3.10.8.9.6.6.9.41.5.3.1.27.1.17.10.9.1.8.6.2.8.3.4.146.65.1.17.1.18.25.35.5.18.9.7.41.2.4.18.24.4.9.6.5.2.14.25.3.2.2.8.28.8.6.3.10.4.20.2.17.10.11.1.3.22.16.2.6.8.6.11.6.5.33.11.8.11.28.12.1.5.2.17.9.6.40.17.4.9.15.8.7.3.12.7.2.4.1.7.12.13.22.13.2.6.8.10.1.4.15.2.4.9.4.5.4.7.13.5.15.17.4.14.10.15.2.5.6.2.2.1.2.14.7.4.8.2.9.10.18.12.13.2.18.1.1.3.1.1.9.7.2.16.5.19.8.4.8.5.4.8.4.4.2.14.2.13.4.2.6.9.6.3.2.2.3.7.3.6.10.11.6.3.19.8.3.3.1.2.3.9.19.26.3.10.13.4.3.4.6.3.3.3.4.1.1.6.11.4.1.11.6.1.10.13.3.2.2.4.3.2.2.7.15.7.14.4.3.4.5.4.3.2.2.5.5.3.9.7.9.1.5.3.7.10.11.1.3.1.1.2.1.3.2.6.1.12.8.1.3.1.1.2.2.7.7.1.4.3.6.1.2.1.4.1.1.4.1.1.2.1.8.1.7.4.3.3.3.5.3.15.1.15.10.28.1.2.2.12.3.4.1.6.3.4.7.1.3.1.4.1.5.3.1.3.4.1.5.2.3.1.2.2.6.2.1.2.2.2.4.1.1.1.2.2.1.1.1.1.2.1.1.1.2.2.1.1.2.1.2.1.7.1.7.1.1.1.1.2.1.4.2.1.1.9.1.6.2.1.6.2.3.2.1.1.1.2.5.2.4.1.1.2.2.1.1.7.1.2.2.1.2.1.2.3.1.1.2.4.1.1.1.6.3.6.4.5.9.1.2.3.1.4.3.2.2.3.1.1.1.1.12.1.3.1.1.2.2.1.6.3.3.5.2.7.1.1.2.5.1.9.5.1.3.1.8.4.5.1.9.1.1.1.2.1.1.1.4.2.13.1.1.3.1.2.2.3.1.2.1.1.1.2.1.3.1.1.1.1.2.4.1.5.1.2.4.3.10.2.9.7.2.2.1.3.3.1.6.1.2.5.1.1.2.6.4.2.1.200.200.100.300.400.100.100.100.400.1700.304.596.100.1000.800.500.400.200.200.500.1300.801.99.506.95.1399.1100.100.4302.1798.2700.200.100.800.900.100.200.700.100.800.2000.900.1100.600.400.2200; __gads=ID=e2903238c02c4cea:T=1730830253:RT=1731937482:S=ALNI_MblG6lz7gVW-QT8-UjJTPcdy5T0ww; __gpi=UID=00000f6bc88d5844:T=1730830253:RT=1731937482:S=ALNI_MbXnx1bIZK3s9zJecdBRafg-7qIqA; _hjSessionUser_1283988=eyJpZCI6ImQ5MzNkMTcyLWUwZTUtNWJlYy1iNjYwLTI2MzZmNDYxMWIxYiIsImNyZWF0ZWQiOjE3MzE5Mzc1Njc1MzQsImV4aXN0aW5nIjp0cnVlfQ==; cf_clearance=S4j0gcm38PePP68cc4LqmdmXtNR6TbN6nVturZw7jsM-1743777282-1.2.1.1-mwh6EeD6FngBKRIVK1BSmHzvYvoWNTvwTWt7zYjNRphuf4x1RlfFLkQcYHAJAb4TcgROrinMIJR31PqA4Z3ExLJ7a.K5nLjLWMW3RC2oWv38qT.b8U1VLoAjNVdCNtbVl6yOAX6ju702TTWZgWMqYCkgHf.4npmlrdvn6UsTC2_0BOpbX2m0gd2IKRZ1c7rjhdcO8kydRzLWEfBvYJDd08G081BW8EapqH5TWv9PfHRur79SjM.xP7Q5rpHTH1ib1RkpCJyN8w2JKs_njoAo0HYf8q4sIhhKhEJZ.aKVUiLU4NDZIlQRRiefU1GMKc6W8ulw5IhQTZYHl9BdEL_zJYfWPNrIKis9NIglx5wHp_6RJu5soJmbXZJ7DhOcipif; dmd-tag=undefined; OptanonAlertBoxClosed=2025-07-05T21:46:51.716Z; dmd-sid4=undefined; MACHINE_LAST_SEEN=2025-07-14T15%3A21%3A59.554-07%3A00; JSESSIONID=5963646B506F0E29524818C95304197D; _hjSession_1283988=eyJpZCI6IjQ4YmNiODgwLTEyZmUtNDAxZC05NzJjLTVhMGNlYTY1YjM0NyIsImMiOjE3NTI1MzIwNjUyODcsInMiOjAsInIiOjAsInNiIjowLCJzciI6MCwic2UiOjAsImZzIjowfQ==; __cf_bm=p38XGbX26VSzos_3OjRov78tvBJP.zVpLIwlSFpepWc-1752532757-1.0.1.1-jszMYhuOR.cpZnR7Zt2ZL8CJBGq9ZbF_VHHatJYrJr9rHtv96auSz8Ym4bOg0FTEP.iMEfZqtjBjKToiNQ71p6tszZRFkDIs0kkkNG8VRio; __eoi=ID=b35fc7e96f1de934:T=1746474481:RT=1752532893:S=AA-AfjYQGCJs3EvzQTEPHv6ZNFBd; OptanonConsent=isGpcEnabled=0&datestamp=Mon+Jul+14+2025+23%3A44%3A33+GMT%2B0100+(British+Summer+Time)&version=202505.2.0&browserGpcFlag=0&isIABGlobal=false&hosts=&consentId=e2a7329b-2318-4fa1-9fa1-027157d3b59f&interactionCount=4&isAnonUser=1&landingPath=NotLandingPage&groups=C0002%3A0%2CC0003%3A0%2CC0001%3A1%2CC0004%3A0&AwaitingReconsent=false&intType=2&geolocation=GB%3BENG"
COOKIES = cookie_dict(RAW_COOKIES)
# A realistic desktop User-Agent
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/138.0.0.0 Safari/537.36"
)
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/138.0.0.0 Safari/537.36"
)

def _copy_cookies(driver, sess: requests.Session, sage_host: str) -> None:
    for ck in driver.get_cookies():
        # Chrome sometimes stores the leading dot in the domain – strip it
        dom = ck.get("domain", sage_host).lstrip(".")
        sess.cookies.set(
            ck["name"], ck["value"],
            domain=dom, path=ck.get("path", "/")
        )


def _extract_pdf_link(html: str, base_url: str) -> str | None:
    """Parse the EPUB page and return the signed PDF URL."""
    soup = BeautifulSoup(html, "html.parser")

    # 1) explicit download button
    tag = soup.select_one('a.download[href*="/pdf/"]')
    if tag and tag["href"]:
        return urljoin(base_url, tag["href"])

    # 2) fallback: look for any /pdf/<doi> in the markup
    m = re.search(r'href="(/doi/pdf/[^"]+)"', html)
    if m:
        return urljoin(base_url, m.group(1))

    return None


# ──────────────────────── main downloader ───────────────────────────────────

URL = "https://journals.sagepub.com/doi/10.1177/0022343313518940?icid=int.sj-full-text.similar-articles.1"
UA  = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
       "AppleWebKit/537.36 (KHTML, like Gecko) "
       "Chrome/118.0.5993.92 Safari/537.36")


def copy_cookies_from_browser(driver, sess: requests.Session) -> None:
    """Dump *all* cookies from Selenium → requests.Session()."""
    for ck in driver.get_cookies():
        sess.cookies.set(ck["name"], ck["value"],
                         domain=ck.get("domain") or ".sagepub.com",
                         path=ck.get("path", "/"))

# ──────────────────────────────────────────────────────────────────────





def scrape_sage_article_to_pdf(
    url: str,
    browser: uc.Chrome | None = None,
    out_dir: str = "sage_articles",
    fname: str | None = None,
    timeout: int = 60,
    references: bool = False
) -> str | None:
    """
    Scrape Sage’s “full” page → clean HTML → justified PDF.
    If `references=False`, chop off at the end of Conclusions.
    Returns absolute path to the PDF, or None on failure.
    """
    # -- prepare output path -----------------------------------------------
    safe = re.sub(r"[^\w\.-]+", "_", (fname or url.rsplit("/", 1)[-1]))
    out_path = Path(out_dir, f"{safe}.pdf").resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)

    # -- internal rendering helper ----------------------------------------
    def _render(html_frag: str, base: str):
        css = """
        <style>
          @page { margin: 2.5cm 2cm; }
          body { font-family: "Times New Roman", serif; line-height: 1.45; }
          p    { text-align: justify; hyphens: auto; }
          h1,h2,h3,h4,h5,h6 { text-align: left; font-weight:600; }
          a { color: inherit; text-decoration:none; }
        </style>"""
        doc = f"<!doctype html><meta charset='utf-8'><base href='{base}/'>{css}{html_frag}"
        HTML(string=doc, base_url=base).write_pdf(out_path)
        return str(out_path)

    # -- ensure we have a driver ------------------------------------------
    own_driver = False
    if  browser is None:
        opts = uc.ChromeOptions()
        opts.add_argument("--window-size=1600,1000")
        browser = uc.Chrome(options=opts)
        own_driver = True

    try:
        wait = WebDriverWait( browser, timeout)
        browser.get(url)

        # accept cookies if needed
        with contextlib.suppress(Exception):
            wait.until(EC.element_to_be_clickable(
                (By.ID, "onetrust-accept-btn-handler"))
            ).click()

        # wait for the live article element
        art = wait.until(EC.presence_of_element_located((
            By.CSS_SELECTOR, "article[data-type='research-article']"
        )))
        browser.execute_script("arguments[0].scrollIntoView();", art)

        # pull HTML + inline styles
        article_html = art.get_attribute("outerHTML")
        styles = "\n".join(
            s.get_attribute("outerHTML")
            for s in  browser.find_elements(By.TAG_NAME, "style")
            if s.get_attribute("outerHTML")
        )
        base_url =  browser.current_url

    except (TimeoutException, WebDriverException) as e:
        print("[!] Selenium trouble:", e.__class__.__name__, "→ aborting")
        return None

    finally:
        if own_driver:
            with contextlib.suppress(Exception):
                pass

    # -- clean & optionally remove references ----------------------------
    soup = BeautifulSoup(f"{styles}{article_html}", "html.parser")

    # remove unwanted bits
    for tag in soup.select("script, style, nav, aside, button, svg, .core-nav-wrapper, [data-id^='article-toolbar']"):
        tag.decompose()

    # unwrap stray spans
    for s in soup.find_all("span"):
        s.unwrap()

    if not references:
        # find the Conclusions section element
        concl = soup.find(id="sec-7")
        if concl:
            # take everything up to and including that <section>
            parent = concl.parent
            new_parent = BeautifulSoup("", "html.parser").new_tag(parent.name)
            for child in list(parent.children):
                new_parent.append(child)
                if child is concl:
                    break
            soup = BeautifulSoup(str(new_parent), "html.parser")

    # -- render to PDF ----------------------------------------------------
    try:
        return _render(soup.prettify(), base_url)
    except Exception as exc:
        print("✗ WeasyPrint failed:", exc)
        out_path.unlink(missing_ok=True)
        return None

def scrape_tand_article(
        url: str,
        browser: uc.Chrome | None = None,
        out_dir: str = "tand_articles",
        fname: str | None = None,
        timeout: int = 60,
        references: bool = False
) -> str | None:
    """
    Save the Taylor & Francis “Full Article” as a justified PDF.
    * When `references=False`   → everything from the first “References / Notes”
      heading downward is cut away.
    * When `references=True`    → that section plus the foot‑notes block
      (`<div class="summation-section"> …`) is kept.
    """
    base = "https://www.tandfonline.com/doi/full/"
    if "/doi/epdf/" in url:
        doi = url.split("/doi/epdf/")[1]
        url = f"{base}{doi}"
    # ---------- house‑keeping ----------
    safe = re.sub(r"[^\w.-]+", "_", (fname or url.rsplit("/", 1)[-1]))
    out_path = (Path(out_dir) / f"{safe}.pdf").resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)

    def write_pdf(html: str, base: str) -> str:
        css = """
        <style>
          @page { margin: 2.5cm 2cm; }
          body { font-family: 'Times New Roman', serif; line-height:1.45; }
          p    { text-align: justify; hyphens: auto; }
          h1,h2,h3,h4,h5,h6 { font-weight:600; }
          a    { color: inherit; text-decoration:none; }
        </style>"""
        HTML(string=f"<!doctype html><base href='{base}/'>{css}{html}",
             base_url=base).write_pdf(out_path)
        return str(out_path)

    own = False
    if browser is None:
        opts = uc.ChromeOptions()
        opts.add_argument("--window-size=1600,1000")
        browser, own = uc.Chrome(options=opts), True

    try:
        w = WebDriverWait(browser, timeout)
        browser.get(url)

        # dismiss cookie wall quickly
        with contextlib.suppress(Exception):
            w.until(EC.element_to_be_clickable(
                (By.ID, "onetrust-accept-btn-handler"))).click()

        # ── grab the **populated** full‑text block ─────────────────
        full = w.until(EC.presence_of_element_located(
            (By.CSS_SELECTOR, "div.hlFld-Fulltext")))
        w.until(lambda drv: full.text.strip() != "")       # wait for Ajax
        browser.execute_script("arguments[0].scrollIntoView();", full)

        # keep any runtime <style> so tables & floats don’t collapse
        styles = "\n".join(s.get_attribute("outerHTML") or ""
                           for s in browser.find_elements(By.TAG_NAME, "style"))

        html_raw = f"{styles}{full.get_attribute('outerHTML')}"
        base_url = browser.current_url

    except (TimeoutException, WebDriverException) as err:
        print("[!] Selenium trouble:", err)
        return None
    finally:
        if own:
            with contextlib.suppress(Exception):
                pass

    # ── tidy & reference handling ─────────────────────────────────
    soup = BeautifulSoup(html_raw, "html.parser")

    # strip UI chrome we don’t want in the PDF
    for tag in soup.select("script, style, nav, aside, button, svg,"
                           ".tableDownloadOption"):
        tag.decompose()

    # OPTION A – drop the reference block
    if not references:
        cut = (soup.find(id=re.compile(r"references", re.I)) or
               soup.find("h2", string=re.compile(r"references|notes", re.I)))
        if cut:
            for el in list(cut.find_all_next()):
                el.decompose()
            cut.decompose()
    # OPTION B – keep references **and** the foot‑note list
    else:
        # the foot‑notes live outside hlFld‑Fulltext → fetch & append
        try:
            foot = BeautifulSoup(
                browser.page_source, "html.parser"
            ).select_one("div.summation-section")
            if foot:
                soup.append(foot)
        except Exception:
            pass

    # ── final write‑out ───────────────────────────────────────────
    try:
        return write_pdf(soup.prettify(), base_url)
    except Exception as exc:
        print("✗ WeasyPrint failed:", exc)
        out_path.unlink(missing_ok=True)
        return None
def download_brill(url: str, out_dir: str, out_name: str, browser: uc.Chrome | None = None) -> str | bool:
    """
    Download a PDF from a Brill article page.

    Strategy
    --------
    1. Fetch HTML via requests and try to extract PDF href from
       <a data-service="download" data-datatype="pdf" href="...pdf">.
    2. If that fails, fall back to Selenium to locate the same link.
    3. Stream–download the PDF and save to out_dir/out_name.pdf.
    """
    session = requests.Session()
    session.headers.update({
        "User-Agent": "Mozilla/5.0",
        "Referer": url
    })

    # 1. HTTP fetch + regex
    resp = session.get(url, timeout=30)
    resp.raise_for_status()
    match = re.search(
        r'data-service="download"[^>]*data-datatype="pdf"[^>]*href="([^"]+\.pdf)"',
        resp.text
    )
    if match:
        pdf_url = urljoin("https://brill.com", match.group(1))
    else:
        # 2. Selenium fallback
        external = browser is not None
        browser = browser or uc.Chrome()
        browser.get(url)
        wait = WebDriverWait(browser, 20)
        try:
            elem = wait.until(EC.element_to_be_clickable((
                By.CSS_SELECTOR,
                'a[data-service="download"][data-datatype="pdf"]'
            )))
            pdf_url = urljoin("https://brill.com", elem.get_attribute("href"))
        except Exception:
            if not external:
                pass
            print("× couldn’t locate Brill PDF download link")
            return False
        if not external:
            pass

    # 3. Download PDF via HTTP
    out_path = Path(out_dir) / f"{out_name}.pdf"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with session.get(pdf_url, stream=True, timeout=60) as r2:
        r2.raise_for_status()
        with open(out_path, "wb") as f:
            for chunk in r2.iter_content(8192):
                if chunk:
                    f.write(chunk)

    print(f"✓ saved Brill PDF → {out_path}")
    return str(out_path)
# code to be replaced


def scrape_oup_article(
        url: str,
        browser: uc.Chrome | None = None,
        out_dir: str = "oup_articles",
        fname: str | None = None,
        timeout: int = 20,
        references: bool = False
) -> str | None:
    """
    Save an Oxford University Press article’s full text as a justified PDF.

    Parameters
    ----------
    url : str
        The canonical (HTML) article URL on academic.oup.com.
    browser : uc.Chrome | None
        Pass an existing undetected‑chromedriver instance or leave None to spawn
        a temporary one.
    out_dir : str
        Folder where the PDF will be written.
    fname : str | None
        Optional file stem.  Defaults to the final URL segment.
    timeout : int
        Max seconds to wait for dynamic content.
    references : bool
        If False, strip everything from the first “References / Notes” heading
        downward.  If True, keep references plus any foot‑note list.
    """

    # ---------- house‑keeping ----------
    safe = re.sub(r"[^\w.-]+", "_", (fname or url.rsplit("/", 1)[-1]))
    out_path = (Path(out_dir) / f"{safe}.pdf").resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)

    def write_pdf(html: str, base: str) -> str:
        css = """
        <style>
          @page { margin: 2.5cm 2cm; }
          body { font-family: 'Times New Roman', serif; line-height:1.45; }
          p    { text-align: justify; hyphens: auto; }
          h1,h2,h3,h4,h5,h6 { font-weight:600; }
          a    { color: inherit; text-decoration:none; }
        </style>"""
        HTML(string=f"<!doctype html><base href='{base}/'>{css}{html}",
             base_url=base).write_pdf(out_path)
        return str(out_path.resolve())

    own = browser is None
    if own:
        opts = uc.ChromeOptions()
        opts.add_argument("--window-size=1600,1000")
        browser = uc.Chrome(options=opts)

    try:
        w = WebDriverWait(browser, timeout)
        browser.get(url)

        # dismiss cookie wall quickly
        with contextlib.suppress(Exception):
            w.until(EC.element_to_be_clickable(
                (By.ID, "onetrust-accept-btn-handler"))).click()

        # ── grab the populated ArticleFulltext widget ──────────────
        full = w.until(EC.presence_of_element_located((
            By.CSS_SELECTOR,
            "div.widget-ArticleFulltext"
        )))
        w.until(lambda drv: full.text.strip() != "")        # wait for Ajax
        browser.execute_script("arguments[0].scrollIntoView();", full)

        # keep runtime <style> tags so that tables & floats stay intact
        styles = "\n".join(s.get_attribute("outerHTML") or ""
                           for s in browser.find_elements(By.TAG_NAME, "style"))

        html_raw = f"{styles}{full.get_attribute('outerHTML')}"
        base_url = browser.current_url

    except (TimeoutException, WebDriverException) as err:
        print("[!] Selenium trouble:", err)
        return None
    finally:
        if own:
            with contextlib.suppress(Exception):
                pass

    # ── tidy & reference handling ─────────────────────────────────
    soup = BeautifulSoup(html_raw, "html.parser")

    # strip chrome we don’t need
    for tag in soup.select("script, style, nav, aside, button, svg"):
        tag.decompose()

    # OPTION A – drop the reference block
    if not references:
        cut = (soup.find(id=re.compile(r"references", re.I)) or
               soup.find("h2", string=re.compile(r"references|notes", re.I)))
        if cut:
            for el in list(cut.find_all_next()):
                el.decompose()
            cut.decompose()
    # OPTION B – keep references plus foot‑notes (widget‑Footnotes)
    else:
        try:
            foot = BeautifulSoup(html_raw, "html.parser").select_one(
                "div.widget-Footnotes")
            if foot:
                soup.append(foot)
        except Exception:
            pass

    # ── final write‑out ───────────────────────────────────────────
    try:
        return write_pdf(soup.prettify(), base_url)
    except Exception as exc:
        print("✗ WeasyPrint failed:", exc)
        out_path.unlink(missing_ok=True)
        return None
def download_taylor_pdf(
    page_url: str,
    browser,
    output_folder: Union[str, Path] = Path("downloads"),
    filename: Optional[str] = None,
    timeout: int = 25,
) -> Optional[str]:
    """
    Fetch a Taylor & Francis chapter/article PDF.

    • tries direct “Download” buttons first
    • falls back to the Print dialog ➜ Save‑As
    • returns absolute path of the PDF or None
    """
    out_dir = Path(output_folder).expanduser().resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    base_name = filename or Path(urlparse(page_url).path).stem or "download"
    target = out_dir / f"{base_name}.pdf"
    if target.exists() and _pdf_is_valid(target):
        return str(target.resolve())

    # ── open page ─────────────────────────────────────────────────────────
    browser.get(page_url)
    WebDriverWait(browser, timeout).until(
        lambda d: d.execute_script("return document.readyState") == "complete"
    )

    # accept cookies if present
    try:
        WebDriverWait(browser, 3).until(
            EC.element_to_be_clickable((By.ID, "onetrust-accept-btn-handler"))
        ).click()
    except Exception:
        pass

    # helper: after *any* click, if a new tab appears → switch to it
    def _maybe_switch_to_new_tab(prev_handles):
        new_handles = browser.window_handles
        if len(new_handles) > len(prev_handles):
            browser.switch_to.window(new_handles[-1])

    # ── 1) primary “Download” button on product page ─────────────────────
    try:
        prev = browser.window_handles
        btn = WebDriverWait(browser, 7).until(
            EC.element_to_be_clickable((By.ID, "book_download"))
        )
        browser.execute_script("arguments[0].click();", btn)
        _maybe_switch_to_new_tab(prev)
    except Exception:
        pass

    # ── 2) second‑stage toolbar download / direct .pdf URL? ──────────────
    end = time.time() + timeout
    while time.time() < end:
        cur = browser.current_url
        if cur.lower().endswith(".pdf"):
            if _download_pdf_via_requests(browser, cur, target, timeout):
                return str(target.resolve())
            break
        if browser.find_elements(By.CSS_SELECTOR, 'embed[type="application/pdf"]'):
            _activate_chrome_window(browser)
            if save_via_dialog(target):
                return str(target.resolve())
            break
        time.sleep(0.4)

    # ── 3) toolbar “Download ▼” menu in reader view ──────────────────────
    try:
        prev = browser.window_handles
        dd = WebDriverWait(browser, 6).until(
            EC.element_to_be_clickable((By.CSS_SELECTOR,
                "button.mat-menu-trigger.download-container"))
        )
        browser.execute_script("arguments[0].click();", dd)
        link = WebDriverWait(browser, 5).until(
            EC.visibility_of_element_located((By.CSS_SELECTOR, "a[href$='.pdf']"))
        )
        href = link.get_attribute("href")
        if href and _download_pdf_via_requests(browser, href, target, timeout):
            return str(target.resolve())
        browser.execute_script("arguments[0].click();", link)  # open in new tab
        _maybe_switch_to_new_tab(prev)
    except Exception:
        pass

    # ── 4) Print‑dialog fallback (opens printable PDF) ───────────────────
    try:
        # open dropdown, choose “Print”
        _js_click(browser, "button.mat-menu-trigger.download-container", timeout=5)
        _js_click(browser, "//li[.//span[contains(.,'Print')]]", xpath=True, timeout=5)

        # click the “Print” confirmation button
        _js_click(browser, "button.print-btn, [data-gtm='gtm-print']", timeout=8)
        time.sleep(1)  # allow printable viewer to load
    except Exception:
        pass

    # viewer in same / new tab?
    _maybe_switch_to_new_tab([])
    if browser.find_elements(By.CSS_SELECTOR, 'embed[type="application/pdf"]'):
        _activate_chrome_window(browser)
        if save_via_dialog(target):
            return str(target.resolve())

    print("× Taylor & Francis PDF could not be retrieved.")
    return None
# ──────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    pass
    # scrape_oup_article(url="https://academic.oup.com/jicj/article/19/5/1133/6423114?searchresult=1",fname="downloads",browser=initiate_browser())

    # download_brill(url="https://brill.com/view/journals/nord/94/1/article-p7_002.xml",out_dir="downloads",out_name="adda.pdf",browser=initiate_browser())
    # print(scrape_tand_article(
    #
    #         url="https://www.tandfonline.com/doi/epdf/10.1080/0163660X.2022.2054123",
    # browser=initiate_browser()
    #                                    ))

    # print(scrape_sage_article_to_pdf(
    #
    #         url=URL,
    # browser=initiate_browser()
    #                                    ))
    # digital_commons_download_pdf(url="https://commons.lib.jmu.edu/ijr/vol1/iss2/4/",save_dir="downloads")
    # main_cambridge_download()
    # main_ieee_download()
    # 1) prepare download folder and target path
    # main_jstor_download()

    # download_taylor_pdf(page_url="https://www.taylorfrancis.com/chapters/edit/10.4324/9780429288654-5/international-law-new-challenges-democracy-digital-age-dominik-steiger",
    #                     browser=initiate_browser(),
    #                     )



    # main_econstor_download()
    # main_elgaronline_download()
    # main_ieee_download()
    # main_jstor_download()
    main_proquest_download()
    # main_science_direct_download()
    # donwload_academia_main()
    # ssrn_main()
    # print(downloading_metadata(browser=initiate_browser(),doi="10.1080/17538947.2024.2324959"))
    # main_heinonline_download()










    #
    #
    #
    #
    #
    #
    #
    #
    #
    #
    # out_dir = Path("downloads").expanduser().resolve()
    # out_dir.mkdir(parents=True, exist_ok=True)
    # filename = "adgg"
    # local_name = f"{filename}.pdf"
    # local_path = out_dir / local_name
    #
    # # 2) launch browser and navigate to embedded PDF URL
    # browser = initiate_browser()  # should return your uc.Chrome instance
    # url = (
    #     "https://www.cambridge.org/core/services/aop-cambridge-core/content/view/BB1C1D2844A8A0F2DB9FB0AF0418722E/9781009541329c6_130-155.pdf/the-interpretation-of-direction-or-control-in-investor-state-arbitration.pdf"
    # )
    # browser.get(url)
    # # give it a moment to load the <embed>
    # time.sleep(2)
    #
    # # 3) invoke our Save‑As helper
    # print(f"Saving PDF to: {local_path}")
    # save_via_dialog(dest=local_path)
    #
    # # 4) verify result
    # if local_path.exists():
    #     print("✅ File saved successfully:", local_path.resolve())
    # else:
    #     print("❌ File not found or too small:", local_path)
    # pass
    "https://api.taylorfrancis.com/content/chapters/edit/download?identifierName=doi&identifierValue=10.1201%2Fb15253-6&type=chapterpdf"
