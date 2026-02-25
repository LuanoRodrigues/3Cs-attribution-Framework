import shutil
import time
from pathlib import Path
from typing import List, Optional, Set
try:
    import win32gui
    import win32con
except Exception:
    win32gui = None
    win32con = None

try:
    from pywinauto import Application
    from pywinauto.base_wrapper import ElementNotVisible
    from pywinauto.findwindows import ElementNotFoundError
except Exception:
    Application = None
    ElementNotVisible = Exception
    ElementNotFoundError = Exception

try:
    import pyautogui   # still used as a fallback
except Exception:
    pyautogui = None
import fitz

from scrapping.Data_collection_automation.helpers import parse_cookie_header, cookie_dict

RAW_COOKIE_HEADER= "bp_visitor_id=wF1B0rSQ3CLxTpCPSYR8JT; _ga=GA1.1.1755000812.1752073716; OptanonAlertBoxClosed=2025-07-09T15:08:43.771Z; AMCVS_4D6368F454EC41940A4C98A6%40AdobeOrg=1; AMCV_4D6368F454EC41940A4C98A6%40AdobeOrg=1075005958%7CMCIDTS%7C20279%7CMCMID%7C08914953785732819630543495198793366719%7CMCAID%7CNONE%7CMCOPTOUT-1752080924s%7CNONE%7CMCAAMLH-1752678524%7C6%7CMCAAMB-1752678524%7Cj8Odv6LonN4r3an7LhD3WZrU1bUpAkFkkiY1ncBR96t2PTI%7CvVersion%7C4.4.1; bp_plack_session=98072a93de420dd295e8e7ee23290273bb186d8c; _ga_Z0LMJGHBJ7=GS2.1.s1752073715$o1$g1$t1752074048$j27$l0$h0; OptanonConsent=isGpcEnabled=0&datestamp=Wed+Jul+09+2025+16%3A14%3A08+GMT%2B0100+(British+Summer+Time)&version=202402.1.0&browserGpcFlag=0&isIABGlobal=false&hosts=&consentId=12042a4a-17de-4106-a260-e7469727949f&interactionCount=1&isAnonUser=1&landingPath=NotLandingPage&groups=1%3A1%2C3%3A1%2C2%3A1%2C4%3A1&geolocation=GB%3BENG&AwaitingReconsent=false; s_pers=%20v8%3D1752074051346%7C1846682051346%3B%20v8_s%3DFirst%2520Visit%7C1752075851346%3B%20c19%3Dbpdg%253Asearch%253Aquery_screen%7C1752075851346%3B%20v68%3D1752074048809%7C1752075851347%3B; s_sess=%20s_cpc%3D0%3B%20s_ppvl%3Dbpdg%25253Asearch%25253Aquery_screen%252C100%252C101%252C3859.333251953125%252C1733%252C1314%252C2560%252C1440%252C1.5%252CP%3B%20s_sq%3D%3B%20s_cc%3Dtrue%3B%20e41%3D1%3B%20s_ppv%3Dbpdg%25253Asearch%25253Aquery_screen%252C100%252C100%252C1714%252C1733%252C1314%252C2560%252C1440%252C1.5%252CP%3B"


HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36"
    ),
    "Accept": "application/pdf,application/octet-stream;q=0.9,*/*;q=0.8",
    "Referer": "https://digital-commons.usnwc.edu/",
}

COOKIES = cookie_dict(RAW_COOKIE_HEADER)
RESULTS_PER_PAGE = 25

COOKIES = parse_cookie_header(RAW_COOKIE_HEADER)
PDF_URL = (
    "https://digital-commons.usnwc.edu/cgi/viewcontent.cgi?"
    "article=1043&context=ils"
)
OUT_FILE = "ils_1043.pdf"

RAW_COOKIE_JSTOR = "UUID=d90c8171-a16e-4638-9cd3-62499788c273; _pxvid=65bcfbd1-9212-11ef-bf79-830bc5ec5483; __zlcmid=1OOn7N9jCFhritj; _ga=GA1.1.189524156.1729779332; csrftoken=tKqjhhZkGuWNf6GZd66KaytaFuXYPLSo; _ga_JPYYW8RQW6=GS2.1.s1751879063$o2$g0$t1751879065$j58$l0$h0; _pxhd=m94KpgzhsDP-eQgT3eYrWvVOYvxWXXkG3AG/UHnpdYSwrmMu2DzBnNB4WfM3Mu2lzOCpXvpd3zGNQnyOdCdf7w==:stX-9ZOVlEQBeFddc4D1-3XVbblKqEPsiIyUMpfFBwZAusplNpLQ8nhfQW9NLpQSy7bk9/ILzuOyZUXuTI-sHR5ehNg4-hOLFLPr40xBVc0=; pxcts=febb2a8b-6261-11f0-abfe-509b11268dac; AccessSession=H4sIAAAAAAAA_4VTXY_TMBD8L36ug7-9zlspcCAkHkpPJ0An5NibXlCurdKEE1T337GbXNsTiMvTajy7Ozu7OZBhaCIpSXQsALecem6QKiOBuhAlNUI5ZwGCsJLMSLNLXK5UAaLgXBVCs4zmCow74IpzWxmwuvZVZFYLwyuG2kodE687EjmXAiRUNBqoqQp1pN47TSEmPNYWQ60SufV9IgsmNGWWcrPiphSuZKawTnzNhOFvguSlZoUzTDDHgWXa_oUyfSBl7ds9zshP3x4VXrLdU02tAcAA5Bzf992elAeyWCT62-sELVYpevCbuH_Ydv3d95tPbzL6JaFXr1O0XDxFnzPzw-r9_OOcPKZaQ383D6FP9b4dSP9rh_l5s--bfuib7Sb7tm0xP9_OyH2zae6b3_iu9WtS9t2Ak_1SK6513lE7ucxYckEanSAcIUBEUXtaQ1q0Yt5REKBprRUG65kEYXP-pKF5piF0GEeJx1pKGKWlUHlTybYBz3fhTMFecZetnYbZLf1mjWScdVT9ePuYpvGnuccZrLJCupNgEaoga2tpRJmO0npOnQyaGhs4coXorD63WeJ6lPovj9qpgQQmxcWQ3THpeo9d2sUkIzsnTyIcArMRA62lrdK5Wk19AEFZ4OC8DhXz7CziqtsOu_9quOy-zuyxeXLjx_gfvfA9t_EPYHMLPcEDAAA; AccessSessionSignature=d99af51d87f60becd5639659ac0d186542918e40c3ab90285c5b4a5fbfe4a0ac; AccessSessionTimedSignature=32fccce9c07e3166f78f43e805acd74f398a238d801bd0003ddc852752752675; OptanonConsent=isGpcEnabled=0&datestamp=Wed+Jul+16+2025+17%3A31%3A51+GMT%2B0100+(British+Summer+Time)&version=202505.1.0&browserGpcFlag=0&isIABGlobal=false&hosts=&consentId=80106167-0445-4764-a825-812c27ecaf3f&interactionCount=1&landingPath=NotLandingPage&groups=C0001%3A1%2CC0003%3A0%2CC0002%3A0%2CC0005%3A0%2CC0004%3A0&AwaitingReconsent=false&isAnonUser=1; ReferringRequestId=fastly-default:585df46a5f83b6aa0c3e9d6ff452fadd; _px2=eyJ1IjoiNjA3ODllNDAtNjI2Mi0xMWYwLTg4MjYtODEyNTc3ZTY3MDI2IiwidiI6IjY1YmNmYmQxLTkyMTItMTFlZi1iZjc5LTgzMGJjNWVjNTQ4MyIsInQiOjE3NTI2ODQwNTMxOTksImgiOiJkN2EyYzc1OTMwZmE3Njc4OTdhZGIwYTUyNDY3MzFmY2ZhNTZmNzkxN2NkMTg5NWJjZmZjMjUzOTJjZDBkOGU3In0="
HEIN_online_raw = "_ga_C1BKBM5WZK=GS1.1.1744303757.1.1.1744303824.60.0.0; PHPSESSID=1a3466e6f932a4264fb670b45280283f; _gid=GA1.2.431241751.1752505824; ProprofsTokenbGVyU0VaaWdlR1pYcCtWNWRyaDQwdz09=600200; BotStart=0; pp_bot_kb_detail=0; _ga_15XHDMF30Z=GS2.2.s1752620167$o26$g0$t1752620167$j60$l0$h0; session_id=eyJpdiI6Ik1ndlBVeldoLzAwTllqMklhTXlXM1E9PSIsInZhbHVlIjoiemZJTVhqL2hRMHp4WmtkQ3ZlMHNIbTdjaEkyQStnTncyaGJxaEEwWnJxSFh1THNRUlNobXN1ZVhJVHBvaXhITThZOUlhM1V4Skt0SDVqQURhNUVUY1NEOG5xWkpreURqMkdibHdtdGQ1WFgvL0hiMkI5OENtVDh6Z21CSVZWV0lWSUxLRG1VVzREWE15dGlHeXBaZm9nPT0iLCJtYWMiOiJkOWFhZDVmMWJlODVhOGI4Y2JiODNkNGEyODhiYzYxNDFmZDBmMDY5NmEwNGM0MTJiNTg1ZjE0ODRlMGZmMWVmIiwidGFnIjoiIn0%3D; XSRF-TOKEN=eyJpdiI6IlFJTHY4QTRldVE4bGQrMG1VS2VxOXc9PSIsInZhbHVlIjoiZW9KVTE5eitST1BBVEVSamdaTTRYcGNkYSt3MnNEbDF3aU1BbnIxbE9VdG1oVFNpQmVZL0djUjcvTEs4VFZmYWd4R2RaL0p2dGhnQjdKbVNsZDMySDlZVW8rd2hwTktRZWljMUdzMnV3WGdsampoZXFOcDl3dFhiS3puTkhVK1giLCJtYWMiOiJkMzFkNmRiZGRhYjc5NDhiNzcwNTdhOWZkZWNkYTFlNTQ3M2UwOGEwNzg2YmExYjliNGQ1MGVlYjVlODQzMmU0IiwidGFnIjoiIn0%3D; myhein_session=eyJpdiI6IkJJVkU0YUdnRzVrazZmdjNKSVR2UXc9PSIsInZhbHVlIjoiTG9aMlZFanlxeUlwYTBtT1NNcjd6MW1TN29Ba3V4M3hwc3BnbngzalZHQXM2eEpyVC9oQjVscnFGR3pGYjlqM0l4ZTBWNlBoSm9EN2NyZUVndjY2ejgrdDA3aTdHYTJDaVlUVFNNOWJXbXlNQzVEOEZKd1llZHFEcUUvY1EyaXgiLCJtYWMiOiJjYTNmN2I2ODU1OWYwOTYwZWE3ZDg0ZDRhNTFiNzk4NWVmZTk5YjcxZGVlNzkyM2UzMDk1NGFlY2M3MzcwYmY0IiwidGFnIjoiIn0%3D; ipcheck_user=144.82.114.245; HeinSessionV45=session&XOBMO-1752771608-22107; _gat_gtag_UA_2910780_1=1; _ga_DNNRRPT9DZ=GS2.1.s1752771616$o70$g0$t1752771616$j60$l0$h0; _ga=GA1.1.1285630196.1731871450; pp_cx_xtr=TkorZHBtcEw4dG5yMFNzUm5CaWc3MG42V1NGdi9pVWJ5V0VlSWFJeUZuYWZqazVVdmRFU1FnOHRrQ25ENXFicE5ubzdNMU93cldJTDYzeGJ2N1FIZEE9PQ==; ProprofsSessionbGVyU0VaaWdlR1pYcCtWNWRyaDQwdz09=49848v7ne34233r5eq11c6hlo600200"

# 2) prepare the cookie dict (exactly as captured)
HEIN_COOKIES= parse_cookie_header(HEIN_online_raw)

OXFORD_COOKIES_RAW= """OUP_SessionId=j220vidbgq1leb5vg4kd3m32; Oxford_AcademicMachineID=638882148174261055; __cf_bm=Mptf9fbFv6AcJaWhdSnoSonVmjmX5ojWsQds0gpJYjg-1752618018-1.0.1.1-j89QEAOhEa20JcrOWV5.68BFlYRaUpjQHf36Kl5_AxjS8M.TSH63RyHhQIl2vigPSgMjVT34wq.deFXtvOtwNFDi_rSzP8y9cmO42gdY8Nc; cf_clearance=SbxJvaK6lJFvwQXfDal6EImXqH758H76ADxTwBDFzyU-1752618019-1.2.1.1-oq5zQOBjADumRgyofv9qTiRyGF1DUSlriFXVFOog5m1XLMFZpY903OHd3a68GpPaFHhce1OhALY0QdaDMdBPALRdhLtgMUPM0A5765Bw4yANM_.zxICjoWV3BnrBwBrkpu9zQjUpd07gIUaWl_ELRkeU1wsp8gxqx17kPVONO0jHogJBdUF9oOiNQlNGSBOfbo8iHmmG_XDZdLldkTE7QC3Zw83b_047CO0pb32UZE0; SeamlessInstitution={"title":"University College London","entityId":"https://shib-idp.ucl.ac.uk/shibboleth"}; __gads=ID=6b3bade83f7244a2:T=1752618019:RT=1752618536:S=ALNI_MacDdwKU3zUOwsvJlcBw576aGuPAQ; __gpi=UID=00001178fe5ae153:T=1752618019:RT=1752618536:S=ALNI_MY0GvkbONK-qdnbaBMaz9sVMqYUAg; __eoi=ID=5d1099810742c04d:T=1752618019:RT=1752618536:S=AA-Afjagxi199a5k90vb-oDT10ce"""
OXFORD_COOKIES =parse_cookie_header(OXFORD_COOKIES_RAW)
# COOKIES
RAW_COOKIE_CAMBRIDGE ="aca-session=Fe26.2**e5d9aa1b7071fcc66c85ae8dd871740178c877feaf25d708b0fa7440b6a7a972*By4kXP07ovhrRcMdqXwpoQ*7z_Uo6EbggpyieNpxjyhThSFoG0hEB8XRsC27JwQXdZDw45gCkH03qQOIniknNU1c5Pznm6d-ZeZ-YMghoJ6b6fHIGIiZkKhpXfPczowEqU**2fd80ffe2ae86a7def19ed5be5a41abf21586ac26b9527fdd4775fce0530254c*rGBmn-mRXLmq0ZxO0vNFQwltXrJzIogtgy3qEqK3eYk; Secure; HttpOnly; SameSite=Lax; Path=/"




# ───────────────────────────────────────────────────────────────────────────

SIZE_FLOOR = 20_000          # 20 kB sanity check

SIZE_FLOOR = 20_000          # 20 kB sanity check for PDFs


# ────────────────────────────────────────────────────────────────────────
#  PDF helpers
# ────────────────────────────────────────────────────────────────────────

__all__ = [
    "SIZE_FLOOR",
    "_pdf_is_valid",
    "_wait_for_saved_pdf",
    "save_via_dialog",
]

SIZE_FLOOR = 20_000  # bytes – anything smaller is almost certainly not a PDF

# ---------------------------------------------------------------------------
#   PDF helpers
# ---------------------------------------------------------------------------

def _pdf_is_valid(path: Path) -> bool:
    """Return **True** iff *path* points to a readable PDF ≥ SIZE_FLOOR bytes."""
    if not path.exists() or path.stat().st_size < SIZE_FLOOR:
        return False
    try:
        doc = fitz.open(str(path))  # noqa:  S310 (file is trusted, we created it)
        doc.close()
        return True
    except Exception:
        return False


def _wait_for_saved_pdf(
    expected: Path,
    folder: Path,
    before: Set[Path],
    timeout: int = 30,
) -> Optional[Path]:
    """Wait until a **new** (or the *expected*) PDF becomes readable.

    Parameters
    ----------
    expected : Path
        The file we *want* to appear (same name we typed into the dialog).
    folder : Path
        Directory to watch for unexpected‑name PDFs (Chrome sometimes appends
        “ (1).pdf” etc.).
    before : set[Path]
        Snapshot of existing PDFs *before* the download started.
    timeout : int, optional
        Seconds to wait before giving up.
    """
    deadline = time.time() + timeout
    while time.time() < deadline:
        # ① did we get the exact filename?
        if expected.exists() and _pdf_is_valid(expected):
            return expected

        # ② any new file not present before?
        for pdf in folder.glob("*.pdf"):
            if pdf not in before and _pdf_is_valid(pdf):
                try:
                    shutil.move(str(pdf), str(expected))
                    return expected
                except Exception:
                    return pdf.resolve()
        time.sleep(0.4)
    return None

# ---------------------------------------------------------------------------
#   Windows dialog handling
# ---------------------------------------------------------------------------


def _enumerate_file_dialogs() -> List[int]:
    """Return HWNDs of top‑level Windows file‑dialogs (#32770)."""
    if win32gui is None:
        return []

    def _enum_proc(hwnd, out):
        if win32gui.GetClassName(hwnd) == "#32770":
            title = win32gui.GetWindowText(hwnd).lower()
            if any(k in title for k in ("open", "save", "select", "file")):
                out.append(hwnd)
        return True
    result: List[int] = []
    win32gui.EnumWindows(_enum_proc, result)
    return result

# ────────────────────────────────────────────────────────────────────────────
#  robust Windows “Save As…” automation
# ────────────────────────────────────────────────────────────────────────────

def _fill_dialog_filename(hwnd: int, filename: str, timeout: int = 12) -> bool:
    """
    Focus the file‑dialog given by *hwnd*, type *filename* into its Edit box
    (slowly – one keystroke at a time so we really see it appearing), then press
    the dialog’s Save button (or hit Enter).  Returns **True** once the keystrokes
    have been sent; it does **not** guarantee that the file was written.
    """
    if Application is None or win32gui is None or win32con is None:
        return False

    try:
        app   = Application(backend="win32").connect(handle=hwnd, timeout=timeout)
        dlg   = app.window(handle=hwnd)
        dlg.set_focus()
        win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
        win32gui.SetForegroundWindow(hwnd)

        # locate the first visible Edit control (often inside a ComboBox)
        end_time = time.time() + timeout
        edit = None
        while time.time() < end_time:
            try:
                edit = dlg.child_window(class_name="Edit")
                if edit.exists() and edit.is_visible():
                    break
            except Exception:
                pass
            time.sleep(0.25)

        if not (edit and edit.is_visible()):
            return False

        edit.set_focus()
        edit.type_keys("^a{DEL}", set_foreground=True)
        time.sleep(0.1)

        # type *slowly* so the control keeps up
        for ch in filename:
            edit.type_keys(ch, pause=0.04, set_foreground=True)
        time.sleep(0.3)

        # try to click a “Save”‑type button first
        try:
            save_btn = dlg.child_window(title_re=r"(?i)^\s*&?save|speicher|guardar|salvar|enregistrer", control_type="Button")
            if save_btn.exists() and save_btn.is_enabled() and save_btn.is_visible():
                save_btn.click_input()
            else:
                dlg.type_keys("{ENTER}", set_foreground=True)
        except Exception:
            dlg.type_keys("{ENTER}", set_foreground=True)

        return True
    except Exception:
        return False
def _activate_chrome_window(driver) -> None:
    """
    Bring the Selenium‑controlled Chrome window to the foreground so that the
    global *Ctrl + S* keystroke is captured by the browser (and not sent to the
    address‑bar of some other window).
    """
    if win32gui is None or win32con is None:
        return

    try:
        title = driver.title
        handles = []

        def _enum_proc(hwnd, out):
            if win32gui.IsWindowVisible(hwnd) and win32gui.IsWindowEnabled(hwnd):
                wnd_title = win32gui.GetWindowText(hwnd)
                if wnd_title and wnd_title.startswith(title[:40]):  # loose match
                    out.append(hwnd)
            return True

        win32gui.EnumWindows(_enum_proc, handles)
        if handles:
            win32gui.ShowWindow(handles[0], win32con.SW_RESTORE)
            win32gui.SetForegroundWindow(handles[0])
            time.sleep(0.2)
    except Exception:
        pass

def save_via_dialog(dest: Path, timeout: int = 15) -> Optional[Path]:
    """
    Open the browser’s Save As window, stuff the absolute *dest* pathname into
    the filename box, press Save, then wait until
      • every file‑dialog window has disappeared **and**
      • a readable PDF ≥ SIZE_FLOOR is on disk.
    Returns the absolute Path on success or **None** otherwise.
    """
    dest      = dest.expanduser().resolve()
    abs_dest  = str(dest)
    print(f"Saving PDF to: {abs_dest}")

    # short‑circuit if it’s already there
    if dest.exists() and _pdf_is_valid(dest):
        return dest

    if dest.exists():                          # nuke stale zero‑byte files
        try:
            dest.unlink()
        except Exception:
            pass

    # 1️⃣  bring up the Save‑As dialog
    pyautogui.hotkey("ctrl", "s")
    time.sleep(1.0)

    # 2️⃣  try pywinauto (precise) first
    dialog_ok = False
    hwnds     = _enumerate_file_dialogs()
    if hwnds:
        dialog_ok = _fill_dialog_filename(hwnds[0], abs_dest)

    # 3️⃣  fall back to blind typing if the control route failed
    if not dialog_ok:
        time.sleep(0.5)                        # make sure focus is on the box
        pyautogui.typewrite(abs_dest, interval=0.07)
        time.sleep(0.25)
        pyautogui.press("enter")

    # 4️⃣  wait until **all** dialogs are gone
    disappear_deadline = time.time() + timeout
    while time.time() < disappear_deadline and _enumerate_file_dialogs():
        time.sleep(0.4)

    # 5️⃣  poll disk for the freshly written file
    file_deadline = time.time() + timeout
    while time.time() < file_deadline:
        if _pdf_is_valid(dest):
            print(f"DEBUG: Saved – {dest.stat().st_size:,} bytes")
            return dest
        time.sleep(0.4)

    print(f"❌ Save‑dialog finished but no valid file at {abs_dest}")
    return None
