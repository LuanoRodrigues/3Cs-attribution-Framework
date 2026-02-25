from dataclasses import dataclass
from urllib.parse import urlparse, parse_qs, urlencode, urlunparse

from selenium.common import TimeoutException
from typing import Dict
import requests, re, sys, time, json
from bs4 import BeautifulSoup
from urllib.parse import urljoin
import html, random, re, sys, time
from pathlib import Path
from typing import Dict, List, Optional

import undetected_chromedriver as uc
from bs4 import BeautifulSoup
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from tqdm import tqdm
import math
import os
import re
import time
from pathlib import Path
from typing import List, Dict
from urllib.parse import quote_plus, quote

import requests
from bs4 import BeautifulSoup
from selenium.common import WebDriverException, NoSuchElementException, ElementClickInterceptedException
from selenium.webdriver.common.by import By
from selenium.webdriver.support.wait import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from urllib.parse import urljoin

from scrapping.Data_collection_automation.helpers import initiate_browser

"""
Cambridge-Core search crawler  →  JSON (one record per hit)
"""
CAMBRIDGE_start = ""


BASE = "https://www.cambridge.org"
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/138.0.0.0 Safari/537.36"
    )
}

# ──── ▼▼  EDIT THESE TWO CONSTANTS ONLY  ▼▼ ────
START_URL = (
    "https://www.cambridge.org/core/search?"
    "q=ti%3A(attribution%20OR%20%26quot%3Bstate%20responsibility%26quot%3B"
    "%20OR%20%26quot%3Bdue%20diligence%26quot%3B%20OR%20deterrence%20OR%20"
    "%26quot%3Buse%20of%20force%26quot%3B%20OR%20%26quot%3Barmed%20attack%26quot%3B"
    "%20OR%20sovereignty%20OR%20proxy%20OR%20%26quot%3Bcyber%20operation*%26quot%3B"
    "%20OR%20%26quot%3Bcyber%20attack*%26quot%3B%20OR%20%26quot%3Bcyber%20deterrence%26quot%3B)"
    "%20AND%20(cyber%20AND%20attribution)&aggs[productTypes][filters]=JOURNAL_ARTICLE%2CBOOK_PART&pageNum=1"
)

COOKIES_STRING ="amp-access=amp-4tA31A1BSDI-CdL3qKxD5A; _hjSessionUser_2790984=eyJpZCI6IjE5MDA4OTNiLWI1MjctNTRkYi1hNjYxLWQ2MzRlNjViM2Y3MiIsImNyZWF0ZWQiOjE3MjY4MjU2NjY4ODcsImV4aXN0aW5nIjp0cnVlfQ==; _hjSessionUser_2580298=eyJpZCI6ImRmMjkzZTg3LWUxMDgtNTk3Ny04MDA4LTg2OTRhZDgyOTBiMiIsImNyZWF0ZWQiOjE3MzAxNDgxMzYwOTEsImV4aXN0aW5nIjp0cnVlfQ==; _ga_T0Z29X8SLH=GS1.1.1732539050.7.0.1732539050.60.0.0; _ga_C698Z7BSPE=GS1.2.1738603106.2.0.1738603106.0.0.0; _hjSessionUser_2794783=eyJpZCI6IjBjNzE4MWRkLTdjNTctNWQyZC1hNjcyLWUxYzlmMGY4MzRjMyIsImNyZWF0ZWQiOjE3MzAxNTgzOTgzMDYsImV4aXN0aW5nIjp0cnVlfQ==; _ga_V2ZPLZPB6Z=GS1.1.1738603106.2.0.1738603115.0.0.0; _ga_P7DT1QXXSK=deleted; EULAW=true; preferredCountry=GB; user_country_code=gb; vistaregion=C; locale=en_GB; preferredLocale=en_GB; _fbp=fb.1.1743678922226.693214122895261169; cto_bidid=9myhE19XbHJLSzNPbnpFb1o3dmZhbVZvMVRmZ1NmaGlLODIzeXBkdDI3YVNDdVpjV1YxbVFjakJmbEkzOUZwQWglMkIlMkJuNHJEdjJBWUZ5R1J2eldVeHFxQyUyQndNVFpFVEdJWllYVE5qSFhqcmNXTTVXOCUzRA; cto_dna_bundle=LyYhE19xVmlhOFZtV09xN2xpR3lCSVlCWTF4TjVJOUpPTmlNRSUyRnM1S1BydWg2aUZTNSUyQnZIREZjVDNnSWlrR05MU3BocUtqUjR5bklUZDdyeGh4MHlSME51SFElM0QlM0Q; FCNEC=%5B%5B%22AKsRol_kCml3ZRwTDK4xeexMAPKHU5A7u255zW_FFIaddUhqx6g6nlxcY0Dz1q_ve2vfuiMmfVPXs9bQU7AwydB3mGYGRit-LcCo5UpvgojbjccefCfBEr-RuV-OZXdmT4cHkZSdpCVgRb-mKv8B3K_RV6-Qb3YcoQ%3D%3D%22%5D%5D; cto_bundle=C71ZMV9xVmlhOFZtV09xN2xpR3lCSVlCWTE1QW1SdkFtaW9qTGpSJTJCY043aGdSZFFCVUczMUJZUjc3SFZKQlpGZ2dtM0YlMkJpJTJGWWpwdFhOR2Zha3Rsem85V05ndFdZZGJOUENGeTFKRlUwNktzSDFYVFlvMWJoMVUya245NE9jSFRaSzNBRyUyRkolMkJpZFFKT241TTh2OXV3NTdHOGJ3JTNEJTNE; __gads=ID=b0cb72dcb544c5dc:T=1743678924:RT=1745582506:S=ALNI_MaJcjO4Jm-DOJGi0YUz4GRGf531Hw; __gpi=UID=000010881b7bc13d:T=1743678924:RT=1745582506:S=ALNI_MZdZ-6woawV3X1yEIcy0qLPpalE8A; __eoi=ID=6c4d4c62e27db6d1:T=1743678924:RT=1745582506:S=AA-AfjZJVm94OuvDbS56rCfl-huQ; _sp_id.103f=10e3966d-1344-4f38-8770-a3b69b62d8e3.1745582505.1.1745582515..b8c49949-70b9-468d-8a02-37f5e630b327..35db790e-7d2f-4abc-8280-3fe24f9d83ba.1745582504745.2; _hjDonePolls=1565434%2C1612144; gig_bootstrap_3_ilxJxYRotasZ-TPa01uiX3b8mqBqCacWOQAwcXBW0942jFIXadk2WjeDMV0-Mgxv=login_ver4; SHR_E_ENC=8524ec01102526d7c0994a6a8db233870b102e6e7d0fa21eb93db95170dfaa2e3b7ed7725bcd98696bfc8dfb16ff022bc996a5b7a6b1fb23eeca163975c43db85149ab598d861ad9f373275d4a9f1170740ae0d68092c1ed555552c1a2b863707514f004631ecae0c2a4404a0b6a0fd6c14d7dcfd258de3b8ed9ed808b0ea42af80b96950435abce7fc55ec422503d96eeae17affcb063f38e77482bf94e8b0c54fd1a15f2e5433816d54bb31d6a405f4a7b5ef2f428cd1972bd04686a0cd53dd0227dcb2eff11669a80851d181bdf102c1472bd4cf8b3d6b251a81e345675290a8344af4bee7bf4d386f98f9707b4bbb1b045cf8943624cdeb024a87c6d8323; _gcl_au=1.1.1002158864.1746474406.1221988816.1749829987.1749830463; session=s%3A7H9jxIyolkBCzynrtNNrg0aaWCXeJkeP.U7pcR64MHgTeM7lvTw6X5xS%2F5cOjeQyu52IjKjK2MLM; _gid=GA1.2.963729389.1752053567; _hjSession_2580298=eyJpZCI6ImMyZTVkNDMyLTkxYWYtNGNmNy04YTAyLWFlODQ5N2YxNjdlOCIsImMiOjE3NTIwNTM1Njg0NDgsInMiOjAsInIiOjAsInNiIjowLCJzciI6MCwic2UiOjAsImZzIjowfQ==; KK_CUSTOMER_ID=-144331378; OptanonConsent=isGpcEnabled=0&datestamp=Wed+Jul+09+2025+10%3A33%3A47+GMT%2B0100+(British+Summer+Time)&version=202409.2.0&browserGpcFlag=0&isIABGlobal=false&hosts=&consentId=2650c0fa-8a7a-42c7-9309-5836f82ee9fc&interactionCount=1&landingPath=NotLandingPage&groups=C0001%3A1%2CC0003%3A0%2CC0002%3A0%2CC0004%3A0%2CC0005%3A0&AwaitingReconsent=false&isAnonUser=1; _ga_CK6Q1Q4L6H=GS2.1.s1752053646$o1$g1$t1752053689$j17$l0$h0; _ga_GB4G9R5CB9=GS2.1.s1752053646$o1$g1$t1752053689$j17$l0$h0; _shibsession_64656661756c7468747470733a2f2f73686962626f6c6574682e63616d6272696467652e6f72672f73686962626f6c6574682d7370=_cc6ef92564b2b2e7b7a49d8f0d115951; __cf_bm=bLCc2WypfGWfon0XO0SHoEy8OYnX5S1EN1AshFbQaRY-1752054606-1.0.1.1-f4seguoKA.Pk7HTtpx9WfYn.hSDwvq5AgPahyaK0szwTD6z6S2GhrqHWlopPOJTbW5yvx6c6hwf8Zyj0XtJ55efLErsZCvzZonyhcaukFhk; cf_clearance=kgS0472uC84QW5nfZmzwZ6vN1DvTJtGTlXahw.ahqQA-1752054612-1.2.1.1-7YRbdI1lkXDjydk0cHEmJ4KpD2.QAgGA2ziak1R3.LogqvZwHQwXKFNl_vr.LXRgPxfgN_SPcqZ0F5ozxJjqj.7.Ky5XLda90n0c3P6AvEs7Nk20mMXxRERSMUl1MgdI5fw_sHGo22W.h_bBiF0OjCbt57F.Dx_KvgvLJsdu3BSZ1l.zwPrAI992ZmF6RcFY3M2ijlvs3Pjt4GP2qdu9xpehmApNKM3R60vtjr2_53s; _ga=GA1.1.1625766353.1730148136; _ga_T8K9FT0CMZ=GS2.2.s1752053568$o56$g1$t1752055285$j37$l0$h0; site24x7rumID=6684449176082267.1752054613820.1752055290372.0; _ga_P7DT1QXXSK=GS2.1.s1752053567$o70$g1$t1752055313$j4$l0$h0; _ga_7PM892EE02=GS2.1.s1752053567$o70$g1$t1752055313$j4$l0$h0; _ga_ZYGQ8432T2=GS2.1.s1752053567$o70$g1$t1752055313$j4$l0$h0; aca-session=Fe26.2**b51a0989fbc4ad99f6fcb88fdbc34f94d5db78506600a0b25f5fe7375ed441fa*87U5I0SKtg5Gjbn_DdmrCQ*X6BmqbH0HMVGmlIfmAKUyGoz7imyvcdFz40ePSeEG5BLVq7m5mKYziO9gg9PrmypjrZ7XjvfEdKj5b-1uoqkiVAy3LhfMhYQwfu_1L7fvZ4**51ed742323c7a02525a53c3f2c55e6c7d7e48c03f33a8af4489e5ec18a77ee21*Vk6zxwElGOSNQlZHbWBUD5rgT1nhiZYXxS0JCoOIThg"
# ──── ▲▲  EDIT THESE TWO CONSTANTS ONLY  ▲▲ ────


def clean(txt: str | None) -> str:
    return re.sub(r"\s+", " ", txt or "").strip()


def _cookie_dict(raw: str) -> dict[str, str]:
    return (
        dict(p.strip().split("=", 1) for p in raw.split(";") if "=" in p)
        if raw else {}
    )


def extract_entry_details(blk: BeautifulSoup) -> dict:
    """Turn one <ul class="details …"> block into a Python dict."""
    d: dict[str, str | list[str]] = {}

    # title + record URL
    a = blk.select_one("li.title a")
    d["title"] = clean(a.text) if a else ""
    d["url"]   = urljoin(BASE, a["href"]) if a else ""

    # optional “from Part II – …” line (chapters only)
    part = blk.select_one("li.paragraph_05")
    d["part_of"] = clean(part.text) if part else ""

    # authors
    d["authors"] = [
        clean(a.text) for a in blk.select("li.author a")
    ]

    # source line (Book / Journal etc.)
    src = blk.select_one("dt.source + dd")
    d["source"] = clean(src.text) if src else ""

    # published-online date
    pub = blk.select_one("dt.published + dd span.date")
    d["published_online"] = clean(pub.text) if pub else ""

    # pages
    pages = blk.select_one(".pages")
    d["pages"] = clean(pages.text) if pages else ""

    # RIS / product id
    ris = blk.select_one("a.export-citation-component")
    d["ris_id"] = ris["data-prod-id"] if ris else ""

    # badge: Article / Chapter / …
    typ = blk.select_one("li.type")
    d["entry_type"] = clean(typ.text) if typ else ""

    # abstract (if rendered inline)
    abs_div = blk.select_one("div.abstract")
    d["abstract"] = clean(abs_div.text) if abs_div else ""

    # PDF link
    pdf = blk.select_one("a[href$='.pdf']")
    d["pdf_link"] = urljoin(BASE, pdf["href"]) if pdf else ""

    # Altmetric score (if present)
    alt = blk.find_next("div", class_="altmetric-embed")
    if alt and (score_img := alt.select_one("img")):
        if m := re.search(r"score (\d+)", score_img.get("alt", "")):
            d["citation_score"] = m.group(1)

    return d


def crawl_all_pages(start_url: str, cookies_string: str | None = None) -> None:
    cookies = _cookie_dict(cookies_string or "")
    url = start_url
    all_entries = []

    while url:
        print(f"Fetching {url}")
        r = requests.get(url, headers=HEADERS, cookies=cookies, timeout=30)
        if r.status_code != 200:
            print("  ! HTTP", r.status_code)
            break

        soup = BeautifulSoup(r.text, "html.parser")
        blocks = soup.select("ul.details")
        if not blocks:
            print("  ! No results found, stopping.")
            break

        for blk in blocks:
            data = extract_entry_details(blk)
            all_entries.append(data)
            print("  ✓", data["title"])

        next_btn = soup.select_one("li.pagination-next a")
        url = urljoin(BASE, next_btn["href"]) if next_btn else None
        time.sleep(1.0)

    with open("cambridge_results.json", "w", encoding="utf-8") as fh:
        json.dump(all_entries, fh, ensure_ascii=False, indent=2)
    print(f"\nSaved {len(all_entries)} records → cambridge_results.json")

CAMBRIDGE_end = ""




GOOGLE_SCHOLAR_START = ()

# URL = ("https://scholar.google.co.uk/scholar?hl=en&as_sdt=0%2C5&as_vis=1&q=%28+intitle%3A%22cyber+attribution%22+OR+intitle%3A%22state+responsibility%22+OR+intitle%3A%22due+diligence%22+OR+intitle%3A%22cyber+deterrence%22+OR+intitle%3A%22use+of+force%22+OR+intitle%3A%22armed+attack%22+OR+intitle%3A%22international+law%22+OR+intitle%3Aattribution+%29+%28+%22cyber+attribution%22+OR+%22responsibility+for+cyber%22+OR+cyber+%22state+responsibility%22+OR+cyber+%22due+diligence%22+%29+-intitle%3A%22malware%22+-intitle%3A%22apt%22+-intitle%3A%22bullying%22+-intitle%3A%22authorship%22+-intitle%3A%22forensic%22+-intitle%3A%22honeypot%22+-intitle%3A%22detection%22+-intitle%3A%22ransomware%22+-intitle%3A%22algorithms%22+-intitle%3A%22machine+learning%22+-intitle%3A%22bayesian%22+-intitle%3A%22threat+intelligence%22+-intitle%3A%22argumentation-based%22+-intitle%3A%22commercial%22+-intitle%3A%22psy%22+-intitle%3A%22llm%22+-intitle%3A%22insurance%22+-intitle%3A%22insureance%22+-intitle%3A%22terrorism%22+-intitle%3A%22artificial+intelligence%22+-intitle%3A%22ai%22+-intitle%3A%22transactions%22&btnG=")
URL="https://scholar.google.co.uk/scholar?hl=en&as_sdt=0%2C5&as_ylo=2010&as_yhi=2025&as_vis=1&q=%28+++intitle%3A%22mission-oriented%22+OR+intitle%3A%22mission+driven%22+OR+intitle%3A%22mission-led%22+OR+intitle%3A%22policy+mission%22+OR+++intitle%3A%22grand+challenge%22+OR+intitle%3Amoonshot+OR+intitle%3A%22transformative+policy%22+OR+intitle%3A%22public+sector+innovation%22+%29+AND+%28+++%22public+sector%22+OR+%22civil+service%22+OR+%22public+administration%22+OR+%22public+management%22+OR+++%22policy+implementation%22+OR+%22policy+design%22+OR+%22policy+delivery%22+OR+%22policy+evaluation%22+%29+%28site%3Agov.uk+OR+site%3Agov+OR+site%3Aeuropa.eu+OR+site%3Aoecd.org+OR+site%3Aworldbank.org%29+-%22military+mission%22+-%22religious+mission%22+-missionary+-evangelical+-evangelism+-%22corporate+mission%22+-%22company+mission%22+-%22mission+statement%22+-%22diplomatic+mission%22+-embassy+-%22space+mission%22+-%22exploration+mission%22+-%22peacekeeping+mission%22+-%22mission+creep%22+-site%3Awebofscience.com+-site%3Awebofknowledge.com+-site%3Aproquest.com+-site%3Aclarivate.com&btnG="
RAW_cookie="HSID=AtsSevRi-NcCNtVzT; SSID=AqJThP7Vnj2xMuXrO; APISID=q8HsWNRJmPy6Qxpk/AQu5wq3VisvLGUxUq; SAPISID=Ztu0zY5ByGjDBDtV/Ag9LwAMR0ro0we5wY; __Secure-1PAPISID=Ztu0zY5ByGjDBDtV/Ag9LwAMR0ro0we5wY; __Secure-3PAPISID=Ztu0zY5ByGjDBDtV/Ag9LwAMR0ro0we5wY; SEARCH_SAMESITE=CgQIrp4B; NID=525=ljdwqeeewgF3XJVMrRZJb3pqaOUaZW3Z0kdcsown_FWSFv3uW3buozd5rWV80acsO09mG9BqG50FpJVr7g7rlisV3pT2XbVD4SZoj_NVv3mqo1Q2_jh-JBM8CROt24-n2boXVaLHLqFoZsSrirgjXNQtC3K_oS8XynQhIh-WkJFF-o7Dg_6p5PLa9CrDd_ffNpC88LDZuFiIBT_BaKG8bRVM-9-BrnYFS9VSjWf-QnBGqVJYgXm54sShNZdY2QRUbEQszcoIRWqeP5PPw8oZNYFdDbOKnJUF-eFIJaYluKeIMhGhikR1Di8KVv_QLVqaV-_3ijC2UwiibSWac4hcxRit80dlpzVcFfgGSpDEVA97hV3v27iL14diqYZWPGYtBwWxfhbdO-HCaDfASchH0bLGRZpmf3_TuXNhlasxMnudLh59ofTx4LJSXr20kuQgz6TX9xE22Ih2eveBk2-cfW2bW6_y3QhBQnKq6C679pjXpmGeLfkSlUFHk_DEBSrzv1ebuUW5ZZsG2rFOt2-QvRfFYZ4EKv_z88jA0oDmnVM0lHojq272hXOnPNLpFxYXEcELZcP84Uu8CwIBXYpLXKCKbqOvit94x-NxztVM-a1j1r6grZyLrDRSQWGFK5v1mG3eavMZh7ZHMYF-_2abS_d0Yka-vHeeaB20RouPYXbZnjx_ND_qSe_2RoxnvqasFUvORB2XeekHMAb5G6V8XcXq-CsJOUIsnyedL5PkjFL3aFuutjmXshLdmnYd2gALXoiUPb0NR44p7KIy3xnjSg41qLnRNX6-FHg_GLd750RFl8AhYzHqRde4V7QF379ESV-drHPa2ZJpP9oH7p8Ikga-93if1a_kTxl2B28QOv4c7C4iRnGBO-mNsrdqCaCKKQhU1fcFsRSCFwPuMBsXMQjZ6dwP0d-iXRPnqcix_dEN_y1OFd7v99aJ_LYhwJkMizRljt4XOI9Udyzmx_B2OuEZ; AEC=AVh_V2hFtkZeVbzynzuFgTXn9avBjQnpF6oraQESfvmU88tU5mPafcRn_w; SID=g.a0000wi_twSItwJ_O5jHIxcMB6N7BTYe2cn0wjMT2QtK9u4EpEZh9QWL_N73hDWSQOH-Oki_igACgYKAc8SARQSFQHGX2MiCcwlClfLQmdDBxA5IkHPqxoVAUF8yKpixumC6dB7Em5r1sOHz90C0076; __Secure-1PSID=g.a0000wi_twSItwJ_O5jHIxcMB6N7BTYe2cn0wjMT2QtK9u4EpEZhST9E76HUbIEEEj0IlDZBHwACgYKAcoSARQSFQHGX2Mi8zvWbAL8k_UH3xCfKBsaZBoVAUF8yKqKz-3AFcoYpBbMmhBiGLH_0076; __Secure-3PSID=g.a0000wi_twSItwJ_O5jHIxcMB6N7BTYe2cn0wjMT2QtK9u4EpEZhxvvCbJA0W1_tZntcdg5KJAACgYKAaISARQSFQHGX2MiZPQY6noLjOeFAdvjkOn18xoVAUF8yKoBrYmNwC-vgko0OzOOt3Oc0076; GSP=A=IWp4Jw:CPTS=1749823399:SRD=197920:RTS=20330:LM=1756578535:S=j_ncSMnoRDdvJHaO; __Secure-ENID=28.SE=n7I0SIQ5pw94KKcAGmVxOv0OKa6HALe0XiJOng04oOhfAQ4XMRFsAe-CasnZ7I9fOsa4qpcdymYMYtlujEoJuuEdV1bn9s33WkK7IolAnBllBH8xwvRU4obusNqe77Obebdzw2imkTq1I1fzecI_Xf3axy2FVkN0d_lbCHtNAClHlOGCD0lfpwdi3B-I2dT-8Ue6dqpAHES1fLLLYBq5nnfOqQb0R9WrvAg9TcWAvh05ExF-k3j19bsTTk6YGJqTuPPso-8ms4KkZEnPAE1EWC1ge9TGCmjaX6ooP3Zq3IWbA9eqXaOyYOsjss8_w9eBpsIq4aU6DXNVQla4fj8euNz8piTH52ewXEgUFQBDBKhgTZ8gUWlnyQNG4xnCGXE3olxta37iaahL5brISkoBpTutpA"
def parse_cookie_header(header: str) -> Dict[str, str]:
    return {
        k.strip(): v.strip()
        for part in header.split(";") if "=" in part
        for k, v in [part.split("=",1)]
    }
cookie= parse_cookie_header(RAW_cookie)
# referer="https://scholar.google.co.uk/scholar?start=20&q=site:ssrn.com+((%22attribution%22+OR+%22attributing%22++)+AND+(+%22cyber%22))&hl=en&as_sdt=0,5&as_vis=1"
HEADERS = {
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,"
              "image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    "Accept-Encoding": "gzip, deflate, br, zstd",
    "Accept-Language": "en-GB,en;q=0.9,pt-BR;q=0.8,pt;q=0.7,en-US;q=0.6,fr;q=0.5,fr-FR;q=0.4",
    "Cache-Control": "max-age=0",
    "Cookie": cookie,
    "DNT": "1",
    # "Referer": referer,
    "Sec-CH-UA": "\"Chromium\";v=\"137\", \"Not/A)Brand\";v=\"24\", \"Google Chrome\";v=\"137\"",
    "Sec-CH-UA-Mobile": "?0",
    "Sec-CH-UA-Platform": "\"Windows\"",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                  "AppleWebKit/537.36 (KHTML, like Gecko) "
                  "Chrome/137.0.0.0 Safari/537.36"
}




seen: set[str] = set()        #   ⇦ moved here

OUTFILE  = Path("policy.ris")
HEADLESS = False            # ← set True for silent browsing
INTERACTIVE = False         # ← wait for <Enter> after every page
SCROLL_BUMP = True          # ← tiny scroll to look “human”
MAX_HITS  = 1000            # Google’s hard internal cap anyway
# ─────────────────────────────────────────────────
@dataclass
class ScholarHit:
    cluster_id: str
    rank: int
    title: str
    url: str
    pdf_url: str | None
    authors: list[str]
    year: str
    venue: str
    publisher: str
    cited_by: int
    snippet: str

# ════════════════  browser helpers  ══════════════
def launch_driver() -> uc.Chrome:
    opts = uc.ChromeOptions()
    if HEADLESS:
        opts.add_argument("--headless=new")
    opts.add_argument("--disable-gpu")
    opts.add_argument("--window-size=1400,900")
    # ↓ _very_ light fingerprint-hiding
    opts.add_argument("--disable-blink-features=AutomationControlled")
    return uc.Chrome(options=opts)
def pause_for_captcha(driver: uc.Chrome):
    """Block until the user solves the CAPTCHA that’s showing in Chrome."""
    print("\n🛑  CAPTCHA detected – solve it in the Chrome window "
          "and press <Enter> when done.")
    input("      Waiting … ")
    # Give the page a moment to reload, then re-check
    time.sleep(1.5)
    while looks_like_captcha(driver.page_source):
        input("      Still seeing CAPTCHA – press <Enter> to re-check … ")
        time.sleep(1.0)
    print("✅  CAPTCHA solved, resuming crawl …")
def page_url(base: str, page_num: int, per_page: int = 10) -> str:
    parts = urlparse(base)
    qs = parse_qs(parts.query, keep_blank_values=True)
    qs["start"] = [str(page_num * per_page)]
    new_q = urlencode(qs, doseq=True)
    return urlunparse(parts._replace(query=new_q))

def looks_like_captcha(html_txt: str) -> bool:
    ltxt = html_txt.lower()
    markers = [
        "unusual traffic",               # classic
        "please show you're not a robot",
        "/sorry/",
        "g-recaptcha",                   # new, div class
        "data-sitekey",                  # present in recaptcha widget
        "captcha-form",                  # form id on challenge page
        "/recaptcha/",                   # any recaptcha iframe
    ]
    return any(m in ltxt for m in markers)
def parse_hit(div) -> Optional[Dict[str, str]]:
    """
    Robustly turn one <div class="gs_r …"> from Google Scholar
    into a metadata dict suitable for record_to_ris().
    Guarantees:
      • all stray 4-digit years are stripped from AU
      • PY is always a 4-digit year (or empty)
    """
    h3 = div.find("h3", class_="gs_rt")
    if not h3:
        return None                       # ads / metrics blocks

    a_main = h3.find("a")
    if not a_main:
        return None                       # title with no link
    title = html.unescape(a_main.get_text(" ", strip=True))
    title = re.sub(r"^\[PDF\]\s*", "", title)   # drop “[PDF] ”

    url   = a_main.get("href", "")

    pdf_a = div.select_one(".gs_or_ggsm a")
    pdf   = pdf_a["href"] if pdf_a else ""

    meta_raw = safe_text(div.select_one(".gs_a"))
    authors, year, venue, publisher, volume, issue, pages = split_meta(meta_raw)

    cite_a  = div.find("a", string=re.compile(r"^Cited by"))
    cite_n  = int(re.search(r"\d+", cite_a.text).group()) if cite_a else 0
    cite_u  = f"https://scholar.google.co.uk{cite_a['href']}" if cite_a else ""

    rel_a   = div.find("a", string="Related articles")
    rel_u   = f"https://scholar.google.co.uk{rel_a['href']}" if rel_a else ""

    auth_links = [
        f"https://scholar.google.co.uk{a['href']}"
        for a in div.select(".gs_a a[href^='/citations?']")
    ]

    return {
        "TI": title, "UR": url, "L1": pdf,
        "AU": authors, "PY": year, "JF": venue, "PB": publisher,
        "VL": volume, "IS": issue, "PG": pages,
        "CT": cite_n, "CU": cite_u, "RU": rel_u, "AP": auth_links
    }


def fetch_html(driver: uc.Chrome, url: str) -> str:
    """Load URL, wait for results *or* a CAPTCHA; never raise Timeout."""
    print(f"[info] GET {url}")
    driver.get(url)

    wait = WebDriverWait(driver, 20)
    try:
        wait.until(
            EC.any_of(
                EC.presence_of_element_located(
                    (By.CSS_SELECTOR, "#gs_res_ccl_mid .gs_r")),
                EC.presence_of_element_located(
                    (By.CSS_SELECTOR, "form[action='/sorry/']"))
            )
        )
    except TimeoutException:
        # Probably a modern reCAPTCHA page – just fall through
        pass

    if SCROLL_BUMP:
        driver.execute_script(
            "window.scrollBy(0, window.innerHeight / 2);")

    return driver.page_source

def looks_like_captcha(html_txt: str) -> bool:
    ltxt = html_txt.lower()
    return ("unusual traffic" in ltxt or
            "please show you're not a robot" in ltxt or
            "/sorry/" in ltxt)

# ════════════════  parsing helpers  ══════════════
def safe_text(tag) -> str:
    return tag.get_text(" ", strip=True) if tag else ""

def parse_result_div(div) -> Optional[Dict[str, str]]:
    """Convert one .gs_r block into a rich dict (may return None)."""
    h3 = div.find("h3", class_="gs_rt")
    if not h3:
        return None                      # ad / blank / metric card
    a_main = h3.find("a")
    if not a_main:
        return None
    title = html.unescape(a_main.get_text(" ", strip=True))
    url   = a_main.get("href", "")

    pdf_a = div.select_one(".gs_ggs a")
    pdf   = pdf_a["href"] if pdf_a else ""

    meta_raw = safe_text(div.select_one(".gs_a"))
    authors, year, journal, publisher = split_meta(meta_raw)

    cite_a  = div.find("a", string=re.compile(r"^Cited by"))
    cite_n  = int(re.search(r"\d+", cite_a.text).group()) if cite_a else 0
    cite_u  = f"https://scholar.google.co.uk{cite_a['href']}" if cite_a else ""

    rel_a   = div.find("a", string="Related articles")
    rel_u   = f"https://scholar.google.co.uk{rel_a['href']}" if rel_a else ""

    auth_links = [
        f"https://scholar.google.co.uk{a['href']}"
        for a in div.select(".gs_a a[href^='/citations?']")
    ]

    return {
        "TI": title,        "UR": url,     "L1": pdf,
        "AU": authors,      "PY": year,    "JF": journal, "PB": publisher,
        "CT": cite_n,       "CU": cite_u,  "RU": rel_u,   "AP": auth_links
    }
def split_meta(blob: str):
    """
    Return seven clean fields from a Google-Scholar meta string:
      authors, year, journal, publisher, volume, issue, pages
    Guarantees:
      • AU never contains a 4-digit year
      • PY is '' or exactly four digits
      • leading Google ellipsis (‘…’ / ‘...’) is stripped from the journal
    """
    # normalise odd whitespace and dashes
    blob = (blob or "").replace("\xa0", " ").strip()

    # 1) authors  –  venue+year  –  publisher
    parts = re.split(r"\s[–—\-]\s", blob, maxsplit=2)
    authors_s  = parts[0].strip()
    vy_string  = parts[1].strip() if len(parts) > 1 else ""
    publisher  = parts[2].strip() if len(parts) > 2 else ""

    # 2) authors list (strip stray years)
    authors = [
        re.sub(r"\b(19|20)\d{2}\b", "", a).strip(" ,;")
        for a in re.split(r",| and |;", authors_s)
    ]
    authors = [a for a in authors if a and not re.fullmatch(r"\d{4}", a)]

    # 3) pull out year
    year_m = re.search(r"\b(19|20)\d{2}\b", vy_string)
    year   = year_m.group(0) if year_m else ""
    if year:
        vy_string = vy_string.replace(year, "").strip(" ,")

    # 4) volume & issue (e.g. “32 (3)” or “32(3)”)
    vol, iss = "", ""
    vi_m = re.search(r"(\d+)\s*\((\d+)\)", vy_string)
    if vi_m:
        vol, iss  = vi_m.group(1), vi_m.group(2)
        vy_string = vy_string.replace(vi_m.group(0), "").strip(" ,")

    # 5) page range (e.g. “771–796”)
    pages = ""
    pg_m  = re.search(r"\d{1,5}\s*[-–]\s*\d{1,5}", vy_string)
    if pg_m:
        pages     = pg_m.group(0)
        vy_string = vy_string.replace(pages, "").strip(" ,")

    # 6) journal name – strip leading ellipsis and leftover punctuation
    journal = re.sub(r"^[.…\s]+|[.…\s]+$", "", vy_string).strip(" ,")

    return authors, year, journal, publisher, vol, iss, pages
def record_to_ris(rec: Dict[str, str]) -> str:
    out: List[str] = ["TY  - JOUR"]
    for a in rec["AU"]:
        out.append(f"AU  - {a}")
    if rec["TI"]: out.append(f"TI  - {rec['TI']}")
    if rec["JF"]: out.append(f"JF  - {rec['JF']}")
    if rec["PY"]: out.append(f"PY  - {rec['PY']}")
    if rec["PB"]: out.append(f"PB  - {rec['PB']}")
    if rec["UR"]: out.append(f"UR  - {rec['UR']}")
    if rec["L1"]: out.append(f"L1  - {rec['L1']}")

    notes = []
    if rec["CT"]: notes.append(f"Cited by {rec['CT']} :: {rec['CU']}")
    if rec["RU"]: notes.append(f"Related :: {rec['RU']}")
    if rec["AP"]: notes.append(f"AuthorProfiles :: {' ; '.join(rec['AP'])}")
    for n in notes:
        out.append(f"N1  - {n}")

    out.append("ER  -")
    return "\n".join(out)

# ════════════════  main crawl  ═══════════════════
START_PAGE = 1             # ← change here if you want a different page
MAX_HITS   = 4000              # or whatever limit you need
def main_google_scholar() -> None:
    """Crawl every Google-Scholar results page, then write one RIS file."""
    print("[stage] launching Chrome …")
    driver = launch_driver()

    ris_blocks: list[str] = []
    seen: set[str] = set()          # keeps URLs we have already stored
    try:
        page_no = 0                 # 0 → first page, 1 → second, …
        while True:
            link = page_url(URL, page_no)        # guarantees exactly one “start=”
            html = fetch_html(driver, link)

            if looks_like_captcha(html):
                pause_for_captcha(driver)
                html = driver.page_source

            soup = BeautifulSoup(html, "html.parser")
            hits = soup.select(
                "#gs_res_ccl_mid .gs_r, "
                "#gs_res_ccl_top .gs_r, "
                "#gs_res_ccl_bot .gs_r"
            )

            new_cnt = 0
            for div in hits:
                rec = parse_hit(div)
                if rec and rec["UR"] not in seen:
                    seen.add(rec["UR"])
                    ris_blocks.append(record_to_ris(rec))
                    new_cnt += 1
            print(f"• page {page_no + 1}: {new_cnt} new records")

            # stop if there is no “Next” control
            next_btn = soup.select_one(
                "#gs_n a[aria-label^='Next'], "
                "#gs_nm button[aria-label='Next']:not([disabled])"
            )
            if not next_btn:
                break

            page_no += 1
            time.sleep(random.uniform(2.0, 3.0))     # politeness / avoid CAPTCHA

        OUTFILE.write_text("\n\n".join(ris_blocks), encoding="utf-8")
        print(f"[✓] {len(ris_blocks)} unique records saved → {OUTFILE.resolve()}")

    finally:
        driver.quit()
main_google_scholar()
GOOGLE_SCHOLAR_END = ""
HEIN_ONLINE_START = ""
from urllib.parse import urljoin, parse_qs
"""
HeinOnline Lucene‐search crawler → RIS

Works the same way as the Google Scholar version you posted:
* headless/interactive switches
* explicit CAPTCHA detection (rare on Hein, but belt-and-braces)
* tiny scroll bump to look “human”
* tqdm progress bars
* writes one RIS record per result

Tested 17 Jun 2025 against the URL supplied in your request.
"""
# right after your imports
raw = "_ga_C1BKBM5WZK=GS1.1.1744303757.1.1.1744303824.60.0.0; _gid=GA1.2.467641904.1752213958; _ga_15XHDMF30Z=GS2.1.s1752213958$o22$g1$t1752213968$j50$l0$h0; PHPSESSID=1a3466e6f932a4264fb670b45280283f; session_id=eyJpdiI6ImVSM3RsUFhFUHRZa2JoMVNXdENvcGc9PSIsInZhbHVlIjoiMzZJQlpzYW9sRHpIb0hHc3R3eHM5WnB6MGl6R1AvMWJDcS9NU3RmMFFURFJsUXA4eUk5WnhVbm1YVWJOcjVORFZRTGJNVklyR3NFcUlZbDlBZlVHazhVeGhBZEZ3Q0s4SEkwa2JnZXVwdmd3aWFIQU11SlI2V1pWMzdsaGhIWnpSeElwNCs1S2JSUGZieGJ0WkFwNzh3PT0iLCJtYWMiOiJiMGQ2ODc0NjQ2YTg3MmQ3YzYzZTFmMWM3MjI3ZjBmYTlmM2JlZjg1Y2JiZGY1NDcyMWUzYmEwZTE5YjMzODEwIiwidGFnIjoiIn0%3D; ProprofsSessionbGVyU0VaaWdlR1pYcCtWNWRyaDQwdz09=49848zbsw2qwusdb5a7n0pmim385936; ProprofsTokenbGVyU0VaaWdlR1pYcCtWNWRyaDQwdz09=385936; BotStart=0; pp_bot_kb_detail=0; XSRF-TOKEN=eyJpdiI6InZvdVFIY1Q0RTJpSkdLK2tXaGNKQ2c9PSIsInZhbHVlIjoiOWJRdFYrOHJPQUg2citIb3J2MHZDVGg5MGhqeXZURVdBblVoSzJUVDViSDNBNmlmaGkzb0lOV0gweEM2YmttbVR3dW9kSzVTbUk2VFNONTM3WTJBSGxIRXQ1em9YN01QMG5pbm1oV3prWlVrRzhsNnc2L3BEVVhjdnVlNGx6L3IiLCJtYWMiOiIyNTE5MGZmYjIyMTM2NDdhZTcxZjE3NDdiNGEyMGYwNTdiZmUzNjlhZjE1NTllYTcwYWVmNjM0MGE0ZGYzM2ZkIiwidGFnIjoiIn0%3D; myhein_session=eyJpdiI6IkRQeUJOV1AxZ0t5KzhKZkR3V3c2M1E9PSIsInZhbHVlIjoidzd1WWR4a01uMEpaUGVhNERRY2RIa1BjVDBRNkpHYkxSaktVWFRibzZpQ1NVU3VGNFFDSlBMc2ZqZlRtRzM3N3dwd2ZMQU5WNDdHamRCRGtZOERkaUY5UnpYa21Kc2hVWFFhaDU5R0Z0VFovTkw1Sk1jQnVpR2lWa1pjcXZyYkEiLCJtYWMiOiI4MmJmMTQ3ZGQ1YTE5ZjU5MWU3YjBhYzc4MGY0OGQ1ZDE0ZWM0MGM2MGZhNTcyMzg1NDczYTU1NTdkZThmYjEzIiwidGFnIjoiIn0%3D; ipcheck_user=82.13.63.56; HeinSessionV45=session&NRIQD-1752213992-11770; _ga_DNNRRPT9DZ=GS2.1.s1752214009$o55$g1$t1752214697$j16$l0$h0; _ga=GA1.1.1285630196.1731871450; pp_cx_xtr=ZW80OWdFRXJhZ216N1VKeXFXUTROUnZPa3djN0NzS1lQWnJ5Q3c4VEhERXBQOTRMSnQzUWI4ZGhGaUMvblE1M2xKSWp0NCtFTlIxcHRzbGhxcFEvNXc9PQ=="
def parse_cookie_header(header: str) -> dict[str, str]:
    """Return a clean name→value dict from a raw ‘;’-separated header."""
    return {
        k.strip(): v.strip()
        for k, v in (
            part.split("=", 1) for part in header.split(";") if part.strip()
        )
    }

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
# 2) prepare the cookie dict (exactly as captured)
hein_cookies = parse_cookie_header(raw)

# ─────────────────────────  CONFIG  ──────────────────────────
# URL = ("https://heinonline.org/HOL/LuceneSearch?"
#        "face_quers=type%3Aarticle&face_quers=type%3Achapter&face_quers=moving_wall%3A0"
#        "&search_within=1&prev_q=%28%28%28%28cyber+%29+AND+%28attribution%29%29%29+AND+"
#        "%28title%3A%28+cyber+OR+cyberspace+OR+%22cyber+space%22+OR+%22computer+network%22+"
#        "OR+%22computer+networks%22+OR+%22information+operation%22+OR+%22information+operations%22+"
#        "OR+%22information+warfare%22+OR+attribution+OR+attributing+OR+%22state+responsibility%22+"
#        "OR+%22due+diligence%22+OR+evidence+OR+evidentiary+OR+proof+OR+%22standard+of+proof%22+"
#        "OR+sovereignty+OR+%22use+of+force%22+OR+%22armed+attack%22+OR+%22armed+attacks%22+"
#        "OR+%22armed+attackers%22+OR+%22jus+ad+bellum%22+OR+%22non-state+actor%22+OR+proxy+OR+proxies+"
#        "OR+%22international+law%22+OR+%22international+court%22+OR+%22international+courts%22+"
#        "OR+causality+OR+causal+OR+deterrence+%29+AND+text%3A%28+cyber+AND+%28attribution+OR+attributing%29%29%29%29"
#        "&prev_origterms=&typea=title&termsa=&operator=AND&typeb=text&termsb=cyber&operatorb=AND"
#        "&typec=text&termsc=attribution&operatorc=AND&typef=title&termsf=&yearlo=&yearhi="
#        "&searchtype=field&collection=all&submit=Go")

URL ="https://heinonline.org/HOL/LuceneSearch?terms=%28%28%28%22cyber%22%29+AND+%28%22attribution%22%29%29%29+AND+%28title%3A%28+%22cyber%22+OR+%22cyberspace%22+OR+%22cyber+space%22++OR+%22network*%22+OR+%22+operations%22+OR++%22warfare%22++OR+%22state+responsibility%22+OR+%22due+diligence%22+OR+%22eviden*%22+OR+%22proof%22+OR+%22use+of+force%22+OR+%22armed%22+++OR+%22jus+ad+bellum%22+OR+%22non-state%22+OR+%22proxy%22+OR+%22proxies%22+OR+%22international+law%22+OR+%22court*%22++OR+%22causal*%22+OR+%22deterr*%22+%29+AND+text%3A%28+cyber+AND+%28attribution+OR+attributing%29+NOT+title%3A%28+malware+OR+apt+OR+bullying+OR+forensic+OR+honeypot+OR+detection+OR+ransomware+OR+algorithms+OR+%22machine+learning%22+OR+bayesian+OR+%22threat+intelligence%22+OR+commercial+OR+terrorism+OR+transactions+OR+%22artificial+intelligence%22+OR+insurance+OR+ai+OR+%22threat+assessment%22+OR+cryptocurrency+OR+school+%29%29%29&collection=all&searchtype=advanced&typea=text&tabfrom=&submit=Go&sendit=&face_quers=type%3Aarticle&face_quers=type%3Achapter&yearlo=&yearhi="


OUTFILE   = Path("heinonline_results.ris")
HEADLESS  = False            # ← flip to True for silent browsing
INTERACTIVE = False          # ← wait <Enter> after every page
SCROLL_BUMP = True
MAX_PAGES = 300              # fail-safe; Hein cuts off at 3 000 hits

# ──────────────────────────  IMPORTS  ─────────────────────────
import html, random, re, sys, time
from pathlib import Path
from typing import Dict, List, Optional

import undetected_chromedriver as uc
from bs4 import BeautifulSoup
from selenium.common.exceptions import TimeoutException, NoSuchWindowException
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from tqdm import tqdm


# ═════════════════  browser helpers  ═════════════════════════
def launch_driver() -> uc.Chrome:
    opts = uc.ChromeOptions()
    if HEADLESS:
        opts.add_argument("--headless=new")
    opts.add_argument("--disable-gpu")
    opts.add_argument("--window-size=1400,900")
    opts.add_argument("--disable-blink-features=AutomationControlled")
    driver= uc.Chrome(options=opts)

    driver.get("https://heinonline.org")  # prime domain
    time.sleep(3)
    inject_hein_cookies(driver, hein_cookies)
    return driver

def looks_like_captcha(html_txt: str) -> bool:
    ltxt = html_txt.lower()
    return ("unusual traffic" in ltxt or
            "/sorry/" in ltxt or
            "data-sitekey" in ltxt or
            "g-recaptcha" in ltxt)

def pause_for_captcha(driver: uc.Chrome):
    print("\n🛑  CAPTCHA detected – solve it in the Chrome window "
          "and press <Enter> when done.")
    input("      Waiting … ")
    time.sleep(1.5)
    while looks_like_captcha(driver.page_source):
        input("      Still seeing CAPTCHA – press <Enter> to re-check … ")
        time.sleep(1.0)
    print("✅  CAPTCHA solved, resuming crawl …")
# ───────────────────────── browser helpers ──────────────────────────
def fetch_html(driver: uc.Chrome, url: str) -> str:
    """
    Navigate to *url* and return page-source.  If Chrome crashes or the
    window is closed unexpectedly we transparently relaunch a fresh
    driver and try once more.
    """
    attempt = 0
    while True:
        attempt += 1
        try:
            # (re-)open if the driver has gone missing
            if driver is None or driver.session_id is None:
                driver = launch_driver()

            driver.get(url)

            # wait either for results or for the (rare) captcha form
            wait = WebDriverWait(driver, 20)
            wait.until(
                EC.any_of(
                    EC.presence_of_element_located(
                        (By.CSS_SELECTOR, ".lucene_search_result_b")
                    ),
                    EC.presence_of_element_located(
                        (By.CSS_SELECTOR, "form[action='/sorry/']")
                    ),
                )
            )

            if SCROLL_BUMP:
                # the tiny scroll helps to look “human”
                try:
                    driver.execute_script(
                        "window.scrollBy(0, window.innerHeight / 2);"
                    )
                except NoSuchWindowException:
                    raise  # handled by the outer except-block below

            return driver.page_source  # ← **always** a string
        except NoSuchWindowException:
            # Chrome window died – relaunch and retry (once)
            if attempt >= 2:
                raise
            driver.quit()
            driver = launch_driver()
        except TimeoutException:
            # Hein sometimes stalls; give it one more spin
            if attempt >= 2:
                raise
            time.sleep(2)

# keep a reference so main() can relaunch if we lose the window again
CURRENT_DRIVER: Optional[uc.Chrome] = None

# ═════════════════  parsing helpers  ═════════════════════════
def safe_text(tag) -> str:
    return tag.get_text(" ", strip=True) if tag else ""

VOL_YEAR_RE = re.compile(r"\((19|20)\d{2}\)")
import html
import re
from typing import Dict, List, Optional
from urllib.parse import parse_qs, urljoin

_ARTICLE_TAG_RE = re.compile(r"\s*\[(article|chapter)\]\s*$", re.I)
_AUTHOR_PAIR_RE = re.compile(
    r"""
    ^                       # beginning of the field
    (?P<last>[^\s,()]+      #   last-name token
        (?:\s[^\s,()]+)*?)  #   allow multi-word last names
    \s*,\s*                 #   comma separator
    (?P<first>[^\s,(]+      #   first-name (stop at space/comma/ ()
        (?:\s[^\s,(]+)*?)   #   allow middle names / initials
                          # end first
    (?:\s*\([^)]*)?         #   swallow any “(Cited …)” or asterisk notes
    $                       # end of string
    """,
    re.X,
)
# ─── add near the top ──────────────────────────────────────────────────────
_AUTHOR_SPLIT_RE = re.compile(r";\s*|\s{2,}|,(?=\s[A-Z])")
VOL_YEAR_RE = re.compile(r"\b(?:19|20)\d{2}\b")

def safe_text(tag) -> str:
    """Return the text of *tag* or an empty string if tag is None."""
    return tag.get_text(" ", strip=True) if tag else ""

def _join_author_fields(raw: List[str]) -> List[str]:
    """
    Heino sometimes splits one author into two entries:
        ['Banks', 'William (']  ->  ['Banks, William']
    """
    cleaned: List[str] = []
    i = 0
    AUTHOR_PAIR_RE = re.compile(
        r"""
        ^(?P<last>[^\s,()]+(?:\s[^\s,()]+)*?)  # last-name
        \s*,\s*
        (?P<first>[^\s,(]+(?:\s[^\s,(]+)*?)    # first-name
        (?:\s*\([^)]*)?$                       # optional parenthetical
        """,
        re.X,
    )
    while i < len(raw):
        field = raw[i].strip()
        nxt   = raw[i + 1].strip() if i + 1 < len(raw) else ""
        if "," in field:
            cleaned.append(AUTHOR_PAIR_RE.sub(r"\g<last>, \g<first>", field))
            i += 1
        elif nxt and AUTHOR_PAIR_RE.match(f"{field}, {nxt}"):
            merged = AUTHOR_PAIR_RE.sub(r"\g<last>, \g<first>", f"{field}, {nxt}")
            cleaned.append(merged)
            i += 2
        else:
            cleaned.append(field.rstrip("(").strip())
            i += 1
    return cleaned
def _authors_from_links(div) -> list[str]:
    """Return all anchor-text whose href contains 'AuthorProfile'."""
    return [
        safe_text(a)
        for a in div.select('a[href*="AuthorProfile"]')
        if safe_text(a)
    ]
def _authors_from_text_blocks(div) -> list[str]:
    """
    Fallback for pages that list the authors as plain text.
    (same idea as the _extract_authors() you already tried)
    """
    lines = []
    for dt in div.select("dt.search_result_line"):
        # stop once we hit the DOI or journal line (heuristic)
        if "DOI:" in dt.text or dt.find("i"):
            break
        txt = safe_text(dt)
        txt = re.sub(r"\(Cited.*?\)", "", txt)
        if txt:
            lines.append(txt)
    if not lines:
        return []
    # split on ‘;’, long whitespace, or “, Capital…”
    parts = re.split(r";\s*|\s{2,}|,(?=\s[A-Z])", " ".join(lines))
    return _join_author_fields([p.strip() for p in parts if p.strip()])

def _extract_authors(div) -> list[str]:
    """
    Return a list of author strings (‘Lastname, First M.’).

    Scan all <dt class="search_result_line"> *before* the first line that
    contains an <i> (that one is the journal / Bluebook citation).
    """
    bits: list[str] = []

    for dt in div.select("dt.search_result_line"):
        if dt.find("i"):           # reached the citation line → stop
            break
        txt = safe_text(dt)
        txt = re.sub(r"\(Cited.*?\)", "", txt)   # drop any trailing “(Cited…)”
        if txt:
            bits.append(txt)

    if not bits:
        return []

    # join, split on ‘;’, 2+ spaces, or “, Capital…”
    raw_parts = _AUTHOR_SPLIT_RE.split(" ".join(bits))
    return _join_author_fields([p.strip() for p in raw_parts if p.strip()])
# ─── end helper ────────────────────────────────────────────────────────────


def clean_record(r: Dict[str, object]) -> Dict[str, object]:
    """Return a new dict with cleaned TI, AU, JF."""
    out = r.copy()

    # -------- title: strip trailing  [article] / [chapter]
    out["TI"] = _ARTICLE_TAG_RE.sub("", str(r["TI"])).strip()

    # -------- authors: heal split fields & prune stray “(”
    out["AU"] = _join_author_fields(r.get("AU", []))

    # -------- journal (JF):  if it still equals the title, try CI fallback
    jf = str(r.get("JF", ""))
    if jf.lower().startswith(out["TI"].lower()):
        # pull journal from Bluebook citation (CI)
        ci = str(r.get("CI", ""))
        # Bluebook form: "97 Int'l L. Stud. Ser. **US Naval War Col.** 1039 (2021)"
        parts = ci.split()
        # heuristic: take everything from token 2 until the volume-page number
        if len(parts) > 2:
            # drop vol. number (parts[0]) and stop before last token "(YEAR)"
            maybe_journal = " ".join(parts[2:-2]).strip(".")
            if maybe_journal:
                jf = maybe_journal
    # remove any residual [article] suffix
    out["JF"] = _ARTICLE_TAG_RE.sub("", jf).strip()

    return out
# pre‑compiled year regex reused elsewhere in the project
VOL_YEAR_RE = re.compile(r"\b(?:19|20)\d{2}\b")

BASE_URL = "https://heinonline.org/HOL/"

def safe_text(tag) -> str:
    """Return the text of *tag* or an empty string if tag is None."""
    return tag.get_text(" ", strip=True) if tag else ""
from urllib.parse import urljoin, parse_qs



def parse_result_div(div) -> dict:
    """
    Parse one HeinOnline search-result block (<div class="lucene_search_result_b">)
    into a dict ready for RIS conversion.
    """
    rec = {}

    # ----- numeric index -----
    idx = None
    num_div = div.find_previous("div", class_="lucene_search_result_number_b")
    if num_div:
        lab = num_div.find("label")
        if lab:
            text = lab.get_text(strip=True).rstrip(".")
            try:
                idx = int(text)
            except ValueError:
                idx = text  # fallback as string
    rec["IDX"] = idx

    # ----- title, URL, doc-type -----
    url_a = div.select_one(".lucene_search_result_url_b a.primary-link")
    if not url_a:
        return None
    raw_title = html.unescape(url_a.get_text(" ", strip=True))
    m_tag = _ARTICLE_TAG_RE.search(raw_title)
    if m_tag:
        doc_type = m_tag.group(1).lower()
        title = raw_title[: m_tag.start()].strip()
    else:
        doc_type = "article"
        title = raw_title
    ty_code = "JOUR" if doc_type.lower() == "article" else "CHAP"
    rec["TY"] = ty_code
    rec["TI"] = title

    rec["UR"] = urljoin(BASE_URL, url_a["href"])

    # ----- authors -----
    authors = _authors_from_links(div)
    rec["AU"] = authors  # list of strings

    # ----- publication / Bluebook line / year / volume/issue/pages -----
    journal = ""
    bluebook = ""
    year = ""
    volume = ""
    issue = ""
    start_page = ""
    end_page = ""
    # First look for the <dt> line containing <i> (journal title)
    for dt in div.find_all("dt", class_="search_result_line"):
        i_tag = dt.find("i")
        if i_tag:
            bluebook = safe_text(dt)      # full line, e.g. "100 Calif. L. Rev. 817 (2012)"
            journal = safe_text(i_tag)    # e.g. "California Law Review"
            txt = safe_text(dt)
            # try extract year
            if m := YEAR_RE.search(txt):
                year = m.group("year")
            # volume/issue
            if m := _VOL_ISSUE_RE.search(txt):
                volume = m.group("vol")
                issue  = m.group("issue")
            # pages
            if m := _PP_RE.search(txt):
                start_page = m.group("sp")
                end_page   = m.group("ep")
            break
    # fallback: find a Bluebook-style line afterwards if missing some pieces
    if not year or not volume or not start_page:
        for dt in div.find_all("dt", class_="search_result_line"):
            txt = safe_text(dt)
            if not bluebook and (i_tag := dt.find("i")):
                # if journal wasn't found earlier, set here
                bluebook = safe_text(dt)
                journal  = safe_text(i_tag)
            # match Bluebook pattern like "95 Tex. L. Rev. 1579 (2016)"
            if m := _BLUEBOOK_RE.match(txt):
                volume     = m.group("vol")
                start_page = m.group("page")
                year       = m.group("year")
                break
            # fallback year if still none
            if not year:
                if m2 := YEAR_RE.search(txt):
                    year = m2.group("year")
    rec["JF"] = journal                 # RIS: Journal/Journal of
    rec["CI"] = bluebook                # full Bluebook citation line
    rec["PY"] = year                    # Year
    rec["Y1"] = year                    # Primary date as well
    rec["VL"] = volume
    rec["IS"] = issue
    rec["SP"] = start_page
    rec["EP"] = end_page

    # ----- DOI -----
    doi = ""
    # sometimes in dt containing "DOI:"
    for dt in div.find_all("dt", class_="search_result_line"):
        text = dt.get_text()
        if "DOI:" in text:
            a_doi = dt.find_next("a", href=True)
            if a_doi:
                doi = safe_text(a_doi)
            break
    # fallback: parse Z3988 span
    if not doi:
        coins = div.find("span", class_="Z3988")
        if coins and coins.has_attr("title"):
            title_attr = coins["title"]
            # parse rft_id=... if it's a DOI URL
            # simple parse for "https://doi.org/..."
            parts = re.findall(r"rft_id=(https?://doi\.org/[^\&]+)", title_attr)
            if parts:
                doi_url = parts[0]
                doi = doi_url.split("doi.org/")[-1]
    rec["DO"] = doi

    # ----- PDF link -----
    pdf_url = None
    pdf_a = div.find_next("a", href=re.compile(r"format=PDFsearchable"))
    if pdf_a and pdf_a.has_attr("href"):
        pdf_url = urljoin(BASE_URL, pdf_a["href"])
    rec["L2"] = pdf_url

    # ----- cited-by count & link -----
    cited_by_n = 0
    cited_by_link = ""
    a_cited = div.find_next("a", string=lambda t: t and "Cited by" in t)
    if a_cited and a_cited.has_attr("href"):
        cited_by_link = urljoin(BASE_URL, a_cited["href"])
        m_ct = re.search(r"Cited by\s+(\d+)", a_cited.get_text())
        if m_ct:
            try:
                cited_by_n = int(m_ct.group(1))
            except ValueError:
                cited_by_n = 0
    rec["CT"] = cited_by_n
    rec["L1"] = cited_by_link

    # ----- PathFinder subjects (keywords) -----
    keywords = []
    topics_div = div.find_next("div", class_="topics")
    if topics_div:
        for a in topics_div.select("a.secondary-link"):
            kw = safe_text(a)
            if kw:
                keywords.append(kw)
    rec["KW"] = keywords

    # ----- URL of record page -----
    rec["UR"] = urljoin(BASE_URL, url_a["href"])

    return rec
# ─── helper ───────────────────────────────────────────────────────
def _ris_type(doc_type: str) -> str:
    return "JOUR" if doc_type == "article" else "CHAP"
def record_to_ris(rec: dict) -> str:
    """
    Convert parsed record dict into a RIS-format string.
    Expects keys like:
     - TY, TI, AU (list), PY, Y1, JF, CI, DO, UR, L1, L2, KW (list), CT, VL, IS, SP, EP, IDX...
    Adjust tags as you need (e.g. “AB” for abstract if available, etc.).
    """
    lines = []
    # Type
    ty = rec.get("TY", "JOUR")
    lines.append(f"TY  - {ty}")
    # Authors
    for au in rec.get("AU", []):
        lines.append(f"AU  - {au}")
    # Title
    if rec.get("TI"):
        lines.append(f"TI  - {rec['TI']}")
    # Journal/Book title
    if rec.get("JF"):
        lines.append(f"JF  - {rec['JF']}")
    # Year
    if rec.get("PY"):
        lines.append(f"PY  - {rec['PY']}")
    # Primary date
    if rec.get("Y1"):
        lines.append(f"Y1  - {rec['Y1']}")
    # Volume
    if rec.get("VL"):
        lines.append(f"VL  - {rec['VL']}")
    # Issue
    if rec.get("IS"):
        lines.append(f"IS  - {rec['IS']}")
    # Start page
    if rec.get("SP"):
        lines.append(f"SP  - {rec['SP']}")
    # End page
    if rec.get("EP"):
        lines.append(f"EP  - {rec['EP']}")
    # Keywords
    for kw in rec.get("KW", []):
        lines.append(f"KW  - {kw}")
    # DOI
    if rec.get("DO"):
        lines.append(f"DO  - {rec['DO']}")
    # Cited-by count (as a note)
    if rec.get("CT") is not None:
        lines.append(f"N1  - Cited by {rec['CT']} articles")
    # Cited-by link
    if rec.get("L1"):
        lines.append(f"L1  - {rec['L1']}")
    # Record URL
    if rec.get("UR"):
        lines.append(f"UR  - {rec['UR']}")
    # PDF link
    if rec.get("L2"):
        lines.append(f"L2  - {rec['L2']}")
    # Bluebook full citation line, if you want:
    if rec.get("CI"):
        lines.append(f"N2  - {rec['CI']}")
    # End record
    lines.append("ER  -")
    return "\n".join(lines)

# ═════════════════  pagination helpers  ══════════════════════
# Regex to strip document type from title
_ARTICLE_TAG_RE = re.compile(r"\s*\[(article|chapter)\]\s*$", re.I)
# Regex to find years
YEAR_RE = re.compile(r"\((?:19|20)\d{2}\)")

# Utility to safely extract text
def safe_text(tag) -> str:
    return tag.get_text(" ", strip=True) if tag else ""

# --- regex helpers --------------------------------------------------
_ARTICLE_TAG_RE = re.compile(r"\s*\[(article|chapter)\]\s*$", re.I)
YEAR_RE         = re.compile(r"\((?P<year>(?:19|20)\d{2})\)")
CITED_RE        = re.compile(r"\(Cited\s+(?P<count>\d+)\s+times?\)", re.I)
# Bluebook-style: 104 Int'l L. Stud. Ser. US Naval War Col. 173 (2025)
_BLUEBOOK_RE    = re.compile(r"^(?P<vol>\d+)\s+[^\d]*?\s+(?P<page>\d+)\s*\((?P<year>\d{4})\)")
# Swiss-style (journal line with Vol. / Issue / pp.)
_VOL_ISSUE_RE   = re.compile(r"Vol\.\s*(?P<vol>\d+),?\s*Issue\s*(?P<issue>\d+)")
_PP_RE          = re.compile(r"pp?\.\s*(?P<sp>\d+)(?:-(?P<ep>\d+))?")

# Utility to safely extract text
def safe_text(tag) -> str:
    return tag.get_text(" ", strip=True) if tag else ""

# ─── regex helpers ───────────────────────────────────────────────────────────
# strip “[article]” / “[chapter]”
_ARTICLE_TAG_RE = re.compile(r"\s*\[(article|chapter)\]\s*$", re.I)
# match “Vol. 33, Issue 4”
_VOL_ISSUE_RE   = re.compile(r"Vol\.\s*(?P<vol>\d+),?\s*Issue\s*(?P<issue>\d+)")
# match “pp. 577-596”
_PP_RE          = re.compile(r"pp?\.\s*(?P<sp>\d+)(?:-(?P<ep>\d+))?")
# match “100 Calif. L. Rev. 817 (2012)”
_BLUEBOOK_RE    = re.compile(r"^(?P<vol>\d+)[^\d]+(?P<page>\d+)\s*\((?P<year>\d{4})\)")
# extract year anywhere like “(2023)”
YEAR_RE         = re.compile(r"\((?P<year>(?:19|20)\d{2})\)")

def safe_text(tag):
    return tag.get_text(" ", strip=True) if tag else ""

def extract_heinonline_data(soup, base_url=BASE_URL):
    records = []

    for div in soup.select(".lucene_search_result_b"):
        rec = {}

        # index
        num_div = div.find_previous("div", class_="lucene_search_result_number_b")
        rec["index"] = (
            safe_text(num_div.label).rstrip(".")
            if num_div and num_div.label
            else None
        )

        # title / doc_type / URL
        t_a = div.select_one(".lucene_search_result_url_b a.primary-link")
        raw_title = safe_text(t_a)
        m_tag = _ARTICLE_TAG_RE.search(raw_title) if raw_title else None
        rec["doc_type"] = m_tag.group(1).lower() if m_tag else "article"
        rec["title"] = _ARTICLE_TAG_RE.sub("", raw_title).strip() if raw_title else None
        rec["url"]   = urljoin(base_url, t_a["href"]) if t_a else None

        # authors
        rec["authors"] = [
            safe_text(a)
            for a in div.select('a[href*="AuthorProfile"]')
            if safe_text(a)
        ]

        # init publication metadata
        rec.update({
            "publication": None,
            "volume":      None,
            "issue":       None,
            "start_page":  None,
            "end_page":    None,
            "year":        None,
        })
        dt_lines = div.select("dt.search_result_line")

        # first <i> line: journal, vol/issue, pp., year
        pub_idx = None
        for idx, dt in enumerate(dt_lines):
            i_tag = dt.find("i")
            if i_tag:
                rec["publication"] = safe_text(i_tag)
                txt = safe_text(dt)
                if m := YEAR_RE.search(txt):
                    rec["year"] = m.group("year")
                if m := _VOL_ISSUE_RE.search(txt):
                    rec["volume"], rec["issue"] = m.group("vol"), m.group("issue")
                if m := _PP_RE.search(txt):
                    rec["start_page"], rec["end_page"] = m.group("sp"), m.group("ep")
                pub_idx = idx
                break

        # fallback bluebook line
        for dt in (dt_lines[pub_idx+1:] if pub_idx is not None else dt_lines):
            txt = safe_text(dt)
            if m := _BLUEBOOK_RE.match(txt):
                rec["volume"], rec["start_page"], rec["year"] = (
                    m.group("vol"),
                    m.group("page"),
                    m.group("year"),
                )
                break
            if not rec["year"] and (m := YEAR_RE.search(txt)):
                rec["year"] = m.group("year")

        # DOI
        doi_a = div.find("a", href=re.compile(r"doi\.org"))
        rec["doi"] = safe_text(doi_a) if doi_a else None

        # PDF link
        pdf_a = div.find_next("a", href=re.compile(r"format=PDFsearchable"))
        rec["pdf_url"] = urljoin(base_url, pdf_a["href"]) if pdf_a else None

        # cited-by count & link
        # ─── citation count & link ─────────────────────────
        cited_anchor = div.find_next(
            "a", href=re.compile(r"cited_by=true"), string=re.compile(r"Cited by")
        )
        if cited_anchor and cited_anchor.has_attr("href"):
            rec["citation_url"] = urljoin(base_url, cited_anchor["href"])
            if m := re.search(r"Cited by\s+(\d+)", cited_anchor.get_text()):
                rec["citation"] = int(m.group(1))
            else:
                rec["citation"] = 0
        else:
            rec["citation"] = 0
            rec["citation_url"] = None

        # keywords from PathFinder
        rec["keywords"] = []
        topics_div = div.find_next("div", class_="topics")
        if topics_div:
            for kw_a in topics_div.select("a.secondary-link"):
                kw = safe_text(kw_a)
                if kw:
                    rec["keywords"].append(kw)

        records.append(rec)


    return records


def next_page_url(soup: BeautifulSoup, current_url: str) -> Optional[str]:
    """
    HeinOnline pagers are <a class='page-link' aria-label='Next'>.
    Use urljoin so we never drop the “/HOL/” segment or a leading slash.
    """
    nxt = soup.find("a", attrs={"aria-label": "Next"})
    if nxt and nxt.get("href"):
        return urljoin(current_url, nxt["href"])
    return None
# ════════════════════  main crawl  ═══════════════════════════
def main_hein_online() -> None:
    global CURRENT_DRIVER

    print("[stage] Launching Chrome …")
    CURRENT_DRIVER = launch_driver()

    ris_blocks: list[str] = []
    seen_idx: set[int | str] = set()

    try:
        page_url = URL
        page_no  = 1
        pages_bar = tqdm(desc="Pages", unit="page", colour="green", initial=0)

        while page_url and page_no <= MAX_PAGES:
            pages_bar.set_description(f"Page {page_no}")

            try:
                html_txt = fetch_html(CURRENT_DRIVER, page_url)
            except NoSuchWindowException:
                # final fallback – start over with a fresh browser
                print("[warn] window vanished again – giving it one more go …")
                CURRENT_DRIVER = launch_driver()
                html_txt = fetch_html(CURRENT_DRIVER, page_url)

            if looks_like_captcha(html_txt):
                pause_for_captcha(CURRENT_DRIVER)
                html_txt = CURRENT_DRIVER.page_source

            soup = BeautifulSoup(html_txt, "html.parser")

            # ── parse current page ───────────────────────────────
            records = [
                r for d in soup.select(".lucene_search_result_b")
                if (r := parse_result_div(d))
            ]
            if not records:
                print("[info] no hits – stopping.")
                break

            for rec in tqdm(records,
                            total=len(records),
                            desc=f"Hits p{page_no}",
                            unit="hit",
                            leave=False,
                            colour="cyan"):
                idx = rec.get("IDX")
                if idx is not None and idx in seen_idx:
                    continue
                seen_idx.add(idx)
                ris_blocks.append(record_to_ris(rec))

            # ── next page ────────────────────────────────────────
            page_url = next_page_url(soup, page_url)
            page_no += 1
            pages_bar.update(1)
            time.sleep(random.uniform(1.5, 3.0))

        pages_bar.close()
        OUTFILE.write_text("\n\n".join(ris_blocks), encoding="utf-8")
        print(f"[✓] {len(ris_blocks)} records saved → {OUTFILE.resolve()}")

    finally:
        if CURRENT_DRIVER:
            CURRENT_DRIVER.quit()


# ══════════════════════  CLI entry  ══════════════════════════
HEIN_ONLINE_END=""

DIGITAL_COMMONS_START = ""



def _cookie_dict(raw: str) -> dict[str, str]:
    return (
        dict(p.strip().split("=", 1) for p in raw.split(";") if "=" in p)
        if raw else {}
    )
def cookie_dict(raw: str) -> dict:
    return {
        k.strip(): v.strip()
        for k, v in (part.split("=", 1) for part in raw.split(";") if "=" in part)
    }
USE_SELENIUM = True

RAW_COOKIE_HEADER= "bp_visitor_id=wF1B0rSQ3CLxTpCPSYR8JT; _ga=GA1.1.1755000812.1752073716; OptanonAlertBoxClosed=2025-07-09T15:08:43.771Z; AMCVS_4D6368F454EC41940A4C98A6%40AdobeOrg=1; AMCV_4D6368F454EC41940A4C98A6%40AdobeOrg=1075005958%7CMCIDTS%7C20279%7CMCMID%7C08914953785732819630543495198793366719%7CMCAID%7CNONE%7CMCOPTOUT-1752080924s%7CNONE%7CMCAAMLH-1752678524%7C6%7CMCAAMB-1752678524%7Cj8Odv6LonN4r3an7LhD3WZrU1bUpAkFkkiY1ncBR96t2PTI%7CvVersion%7C4.4.1; bp_plack_session=98072a93de420dd295e8e7ee23290273bb186d8c; _ga_Z0LMJGHBJ7=GS2.1.s1752073715$o1$g1$t1752074048$j27$l0$h0; OptanonConsent=isGpcEnabled=0&datestamp=Wed+Jul+09+2025+16%3A14%3A08+GMT%2B0100+(British+Summer+Time)&version=202402.1.0&browserGpcFlag=0&isIABGlobal=false&hosts=&consentId=12042a4a-17de-4106-a260-e7469727949f&interactionCount=1&isAnonUser=1&landingPath=NotLandingPage&groups=1%3A1%2C3%3A1%2C2%3A1%2C4%3A1&geolocation=GB%3BENG&AwaitingReconsent=false; s_pers=%20v8%3D1752074051346%7C1846682051346%3B%20v8_s%3DFirst%2520Visit%7C1752075851346%3B%20c19%3Dbpdg%253Asearch%253Aquery_screen%7C1752075851346%3B%20v68%3D1752074048809%7C1752075851347%3B; s_sess=%20s_cpc%3D0%3B%20s_ppvl%3Dbpdg%25253Asearch%25253Aquery_screen%252C100%252C101%252C3859.333251953125%252C1733%252C1314%252C2560%252C1440%252C1.5%252CP%3B%20s_sq%3D%3B%20s_cc%3Dtrue%3B%20e41%3D1%3B%20s_ppv%3Dbpdg%25253Asearch%25253Aquery_screen%252C100%252C100%252C1714%252C1733%252C1314%252C2560%252C1440%252C1.5%252CP%3B"
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
# ─── CONSTANTS ──────────────────────────────────────────────────────────────

RAW_QUERY = (
    '(cyber operation* OR cyber-attack* OR cyber attack* OR cyberattack* OR '
    'cyber defense OR cyber-defence OR cyberspace* OR "computer network attack*" '
    'OR "information operation*" OR "information warfare" OR "cyber conflict*" '
    'OR "cyber deterrence" OR attribut* OR "state responsibility" OR '
    '"due diligence" OR deterrence OR "use of force" OR "armed attack*" OR '
    '"jus ad bellum" OR sovereignty OR proxy* OR "non-state actor*")'
)
START_URL = (
    "https://digital-commons.usnwc.edu/do/search/?"
    f"q={RAW_QUERY}&start=0&context=6962227&facet="
)

ASCII = re.compile(r"^[\x00-\x7F]+$")


def is_english(txt: str) -> bool:
    return bool(ASCII.match(txt))


def close_banner(driver):
    """Dismiss OneTrust cookie banner if present."""
    try:
        btn = driver.find_element(By.ID, "onetrust-accept-btn-handler")
        btn.click()
        WebDriverWait(driver, 5).until(
            EC.invisibility_of_element_located((By.ID, "onetrust-banner-sdk"))
        )
    except Exception:
        pass


def extract(html: str) -> List[Dict]:
    soup = BeautifulSoup(html, "html.parser")
    out = []
    for blk in soup.select("#results-list .result.query"):
        a = blk.select_one("span.title a")
        if not a:
            continue
        title = a.text.strip()
        if not is_english(title):
            continue

        au = blk.select_one("span.author strong")
        authors = [n.strip() for n in au.text.split(",")] if au else []

        year = ""
        y = blk.select_one("span.year strong")
        if y:
            year = y.text.strip()[-4:]

        pdf = ""
        p = blk.select_one("span.download.pdf a.pdf")
        if p:
            pdf = p["href"]

        out.append(
            dict(
                title=title,
                url=a["href"],
                authors=authors,
                year=year,
                pdf=pdf,
            )
        )
    return out


def to_ris(r: Dict) -> str:
    lines = ["TY  - JOUR"]
    for au in r["authors"]:
        lines.append(f"AU  - {au}")
    lines.append(f"TI  - {r['title']}")
    lines.append("JF  - International Law Studies")
    if r["year"]:
        lines += [f"PY  - {r['year']}", f"Y1  - {r['year']}"]
    if r["pdf"]:
        lines.append(f"UR  - {r['pdf']}")
    else:
        lines.append(f"UR  - {r['url']}")
    lines.append("ER  -")
    return "\n".join(lines)


def wait_new_results(driver, previous_first: str, timeout: int = 20):
    """Wait until the href of the first result differs from previous_first."""
    WebDriverWait(driver, timeout).until(
        lambda d: d.find_element(
            By.CSS_SELECTOR, "#results-list .result.query span.title a"
        ).get_attribute("href")
        != previous_first
    )


def crawl_nwc_il_studies(driver, out_file="ils_results.ris"):
    """Run the crawl using an already-created Selenium driver."""
    driver.get(START_URL)
    close_banner(driver)

    WebDriverWait(driver, 20).until(
        EC.presence_of_element_located((By.CSS_SELECTOR, "#results-list .result.query"))
    )

    seen, recs, page = set(), [], 1
    while True:
        html = driver.page_source
        new = 0
        for r in extract(html):
            full = urljoin(START_URL, r["url"])
            if full in seen:
                continue
            seen.add(full)
            r["url"] = full
            recs.append(r)
            new += 1
        print(f"• Page {page}: {new} new records")

        # try to locate active Next link
        try:
            nxt = driver.find_element(By.CSS_SELECTOR, "#next-page:not(.hidden)")
        except Exception:
            break  # last page reached

        # capture current first-result URL, then click Next
        first_url = driver.find_element(
            By.CSS_SELECTOR, "#results-list .result.query span.title a"
        ).get_attribute("href")

        # scroll + JS click to avoid overlays
        driver.execute_script("arguments[0].scrollIntoView(true);", nxt)
        driver.execute_script("arguments[0].click();", nxt)

        try:
            wait_new_results(driver, first_url)
        except Exception:
            break  # results did not change → done
        page += 1
        time.sleep(0.6)  # polite pause

    Path(out_file).write_text("\n\n".join(to_ris(r) for r in recs), encoding="utf-8")
    print(f"\n✅ Saved {len(recs)} unique records → {out_file}")

def main_digital_commons():
    """Main entry point for the Digital Commons crawl."""

    from scrapping.HTML_articles.articles_web import initiate_browser

    drv = initiate_browser()
    try:
        crawl_nwc_il_studies(drv)
    finally:
        drv.quit()

DIGITAL_COMMONS_END = ""

RAND_START =("")

"""
RAND.org search crawler  →  rand_results.json
author:  you
date:    2025-07-09
"""

import json, re, sys, time
from pathlib import Path
from urllib.parse import urljoin, urlparse, parse_qs

import requests
from bs4 import BeautifulSoup



# ─── CONFIG ────────────────────────────────────────────────────────────────
START_URL = (
    "https://www.rand.org/search.html?"
    "q=ti%3A%28attribution+OR+%22state+responsibility%22+OR+%22due+diligence%22+"
    "OR+deterrence+OR+%22use+of+force%22+OR+%22armed+attack%22+OR+sovereignty+OR+"
    "proxy+OR+%22cyber+operation*%22+OR+%22cyber+attack*%22+OR+%22cyber+deterrence%22%29+"
    "AND+%28cyber+AND+attribution%29"
    "&content_type_ss=Research"
    "&content_type_ss=Article"
    "&filter_division_ss=RAND+National+Security+Research+Division"
    "&filter_division_ss=RAND+Project+AIR+FORCE"
    "&filter_division_ss=RAND+Army+Research+Division"
    "&filter_division_ss=RAND+Europe"
    "&sortby=relevance"
    "&rows=48"
)

HEADERS = {
    "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/122.0.0.0 Safari/537.36"
}

OUTFILE = Path("rand_results.json")
PAUSE_BETWEEN_PAGES = 1.0        # polite crawl delay (seconds)

# ─── helpers ───────────────────────────────────────────────────────────────
def clean(txt: str | None) -> str:
    return re.sub(r"\s+", " ", txt or "").strip()

def full_url(href: str) -> str:
    return urljoin("https://www.rand.org", href)
def is_english_url(url: str) -> bool:
    # skip any PDF whose URL ends with “.arabic.pdf”
    return not re.search(r'\.arabic\.pdf$', url, re.IGNORECASE)
# ─── per-item extraction ──────────────────────────────────────────────────
def extract_item_page(item_url: str, session: requests.Session) -> dict | None:
    """Download a RAND item page and return a dict with details."""
    r = session.get(item_url, headers=HEADERS, timeout=30)
    if r.status_code != 200:
        print(f"  ! HTTP {r.status_code} on {item_url}")
        return None

    soup = BeautifulSoup(r.text, "html.parser")
    rec: dict[str, str | list[str]] = {}

    rec["url"] = item_url
    rec["id"]  = Path(urlparse(item_url).path).stem.upper()   # e.g. RR2081

    # header block ----------------------------------------------------------
    h1 = soup.select_one("#RANDTitleHeadingId")
    rec["title"] = clean(h1.text) if h1 else ""

    # authors
    rec["authors"] = [
        clean(a.text)
        for a in soup.select("p.authors a")
        if clean(a.text)
    ]

    # type & date
    tp = soup.select_one("p.type-published .type")
    dt = soup.select_one("p.type-published .published")
    rec["type"]  = clean(tp.text) if tp else ""
    rec["posted"] = clean(dt.text.replace("Posted on rand.org", "")) if dt else ""

    # citation (journal name, DOI, report number, ...)
    cit = soup.select_one("p.type-published .citation")
    rec["citation"] = clean(cit.text) if cit else ""

    # first paragraph of abstract
    abs_p = soup.select_one("div.abstract-first-letter p")
    rec["abstract"] = clean(abs_p.text) if abs_p else ""

    return rec

# ─── search-results page parsing ───────────────────────────────────────────
def parse_results_page(html: str) -> list[tuple[str,str]]:
    """
    Return a list of (detail_url, title_snippet) tuples from one search page.
    """
    soup = BeautifulSoup(html, "html.parser")
    items = []
    for li in soup.select("ul.teasers.list.filterable > li"):
        a = li.select_one("a[href]")
        if not a:
            continue
        url = full_url(a["href"])
        ttl = clean(a.select_one("h3.title").text if a.select_one("h3.title") else "")
        items.append((url, ttl))
    return items

def next_page_url(current_url: str, page_no: int) -> str | None:
    """
    RAND search uses `start=` parameter for pagination.
    This helper increments 'start' by the rows per page.
    """
    parsed = urlparse(current_url)
    qs = parse_qs(parsed.query)
    rows = int(qs.get("rows", ["48"])[0])
    start = int(qs.get("start", ["0"])[0]) + rows
    qs["start"] = [str(start)]
    query = "&".join(f"{k}={v[0]}" for k, v in qs.items())
    return f"{parsed.scheme}://{parsed.netloc}{parsed.path}?{query}"

# ─── main crawl driver ────────────────────────────────────────────────────
def crawl_rand_search(start_url: str, max_pages: int = 20) -> list[dict]:
    session = requests.Session()
    url = start_url
    page = 1
    all_recs: list[dict] = []

    while url and page <= max_pages:
        print(f"Page {page}: {url}")
        resp = session.get(url, headers=HEADERS, timeout=30)
        if resp.status_code != 200:
            print("  ! HTTP", resp.status_code)
            break

        hits = parse_results_page(resp.text)
        print(f"  → {len(hits)} hits")

        for detail_url, ttl in hits:
            print("    ·", ttl)
            rec = extract_item_page(detail_url, session)
            if rec:
                all_recs.append(rec)

        # step to next page
        url = next_page_url(url, page)
        page += 1
        time.sleep(PAUSE_BETWEEN_PAGES)

    return all_recs
# _______________________________________________________
# ─── read the json and download the metadata returing a ris ───────────────────────────────────────
#   ────────────────────


ASCII_RE = re.compile(r'^[\x00-\x7F]+$')     # quick non-English filter
DOI_RE   = re.compile(r'(10\.\d{4,9}/[-._;()/:A-Z0-9]+)', re.I)

def _clean(txt: str | None) -> str:
    """Normalize whitespace and trim."""
    return re.sub(r'\s+', ' ', txt or '').strip()

def _all_authors(soup: BeautifulSoup) -> list[str]:
    """Gather every person mentioned in the authors/ contributors blocks."""
    names: list[str] = []
    for p in soup.select('p.authors'):
        # strip “Edited by”, “Contributors:”, etc.
        raw = _clean(p.get_text())
        raw = re.sub(r'^(Edited by|Contributors:)\s*', '', raw, flags=re.I)
        for n in raw.split(','):
            n = _clean(n)
            if n and n not in names:
                names.append(n)
    return names

def _pdf_link(soup: BeautifulSoup) -> str:
    """Return the first direct-PDF link inside the buybox, if any."""
    a = soup.select_one('.buybox a[href$=".pdf"]')
    return urljoin('https://www.rand.org', a['href']) if a else ''

def _doi(soup: BeautifulSoup) -> str:
    """Extract a DOI from the ‘citation’ span (if present)."""
    cit = soup.select_one('p.type-published .citation')
    if cit:
        m = DOI_RE.search(cit.get_text())
        if m:
            return m.group(1)
    return ''
def rand_item_to_ris(driver, item_url: str) -> str:
    """
    Visit the RAND item page at `item_url` with the given Selenium `driver`
    and return a complete RIS record (one string, no trailing blank line).
    """
    driver.get(item_url)
    soup = BeautifulSoup(driver.page_source, "html.parser")

    # ── core metadata ─────────────────────────────────────────
    title_tag = soup.select_one("#RANDTitleHeadingId")
    title     = _clean(title_tag.text) if title_tag else ""

    sub_tag   = soup.select_one("p.subtitle")
    subtitle  = _clean(sub_tag.text) if sub_tag else ""

    authors   = _all_authors(soup)

    year = ""
    pub_tag = soup.select_one("p.type-published .published")
    if pub_tag:
        m = re.search(r"(\d{4})", pub_tag.text)
        if m:
            year = m.group(1)

    abstract_tag = soup.select_one("div.abstract-first-letter p")
    abstract = _clean(abstract_tag.text) if abstract_tag else ""

    pdf_link = _pdf_link(soup)
    doi      = _doi(soup)

    # ------- build RIS -------
    ris = []
    ris.append("TY - RIS")  # treat as generic report
    for au in authors:
        ris.append(f"AU - {au}")
    ris.append(f"TI - {title}")
    if subtitle:
        ris.append(f"T2 - {subtitle}")
    if year:
        ris.extend([f"PY - {year}", f"Y1 - {year}"])
    if abstract:
        ris.append(f"AB - {abstract}")
    if doi:
        ris.append(f"DO - {doi}")
    ris.append(f"UR - {pdf_link or item_url}")
    ris.append("ER -")

    return "\n".join(ris)

ASCII_RE = re.compile(r"^[\x00-\x7F]+$").match   # quick English test

def generate_ris_from_json(json_path: str,
                           output_ris: str = "Rand_research.ris") -> None:
    """Read the crawl JSON, harvest every *.html item once, write one RIS file."""
    with open(json_path, encoding="utf-8") as fp:
        items = json.load(fp)

    browser = initiate_browser()        # one browser for the whole run
    ris_blocks, seen = [], set()

    try:
        for item in items:
            url   = item.get("url", "").strip()
            title = item.get("title", "").strip()
            rec_id = item.get("id", "").upper()

            # skip non-HTML targets (PDFs etc.), duplicates, non-English titles
            if not url.endswith(".html"):
                continue
            if rec_id in seen:
                continue
            if title and not ASCII_RE(title):
                continue

            try:
                block = rand_item_to_ris(browser, url)
                if block:
                    ris_blocks.append(block)
                    seen.add(rec_id)
                    time.sleep(0.3)     # polite delay
            except Exception as exc:
                print(f"⚠  skipping {url}: {exc}")

    finally:
        browser.quit()

    Path(output_ris).write_text("\n\n".join(ris_blocks), encoding="utf-8")
    print(f"✅  saved {len(ris_blocks)} records → {output_ris}")
def rand_main():
    """Main entry point for the RAND.org crawl."""

    driver = initiate_browser()

    try:
        records = crawl_rand_search(START_URL, max_pages=20)
    except KeyboardInterrupt:
        sys.exit("\nInterrupted by user.")

    print(f"\nSaving {len(records)} records → {OUTFILE.resolve()}")
    OUTFILE.write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")
    print("✓ Done.")
    generate_ris_from_json("rand_results.json", "Rand_research.ris")

RAND_END = ""




