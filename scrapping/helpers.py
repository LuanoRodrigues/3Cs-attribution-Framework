from typing import Dict
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
try:
    import pyautogui
except Exception:
    pyautogui = None
import undetected_chromedriver as uc
import os
import json
from typing import Optional, Dict, Any
import requests
from zeep import Client
from zeep.transports import Transport
from requests import Session
from thefuzz import fuzz
# Monkey-patch the buggy __del__ so it’s a no-op (suppresses WinError)
uc.Chrome.__del__ = lambda self: None

from PyPDF2 import PdfReader
from bs4 import BeautifulSoup

from rapidfuzz import fuzz

import xml.etree.ElementTree as ET

from requests import HTTPError
from requests.adapters import HTTPAdapter
from selenium.webdriver.common.by import By
from selenium.webdriver.support.wait import WebDriverWait
from urllib3.util import Retry


def initiate_browser():
    # Configure Chrome options
    options = uc.ChromeOptions()
    # Uncomment the next line only if you need headless mode:
    # options.headless = True

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
def cookie_dict(raw: str) -> dict:
    return {
        k.strip(): v.strip()
        for k, v in (part.split("=", 1) for part in raw.split(";") if "=" in part)
    }
def parse_cookie_header(header: str) -> Dict[str, str]:
    return {
        k.strip(): v.strip()
        for part in header.split(";") if "=" in part
        for k, v in [part.split("=",1)]
    }



def _get_driver():
    global _shared_driver
    if _shared_driver is None:
        _shared_driver = heinonline_download.initiate_browser()
    return _shared_driver


def _close_driver():
    global _shared_driver
    if _shared_driver is not None:
        try:
            _shared_driver.quit()
        finally:
            _shared_driver = None
