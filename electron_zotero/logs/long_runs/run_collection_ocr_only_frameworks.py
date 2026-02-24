import os, sys, json, traceback
from pathlib import Path
import importlib.util

repo = Path('/home/pantera/projects/TEIA')
for envp in [repo/'.env', repo/'my-electron-app'/'.env']:
    if envp.exists():
        for line in envp.read_text(encoding='utf-8', errors='ignore').splitlines():
            s = line.strip().strip('\r')
            if not s or s.startswith('#') or '=' not in s:
                continue
            k, v = s.split('=', 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

for p in [repo, repo/'my-electron-app', repo/'my-electron-app'/'shared', repo/'my-electron-app'/'shared'/'python_backend', repo/'my-electron-app'/'shared'/'python_backend'/'retrieve']:
    sp = str(p)
    if p.exists() and sp not in sys.path:
        sys.path.insert(0, sp)

os.environ.setdefault('CUDA_VISIBLE_DEVICES', '')
os.environ.setdefault('PYTORCH_ENABLE_MPS_FALLBACK', '1')

zpath = repo/'my-electron-app'/'shared'/'python_backend'/'retrieve'/'zotero_class.py'
spec = importlib.util.spec_from_file_location('zc', str(zpath))
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

if not hasattr(mod, 'default_storage'):
    mod.default_storage = os.getenv('ZOTERO_STORAGE_PATH', str(Path.home()/'Zotero'/'storage'))

lib_id = os.getenv('ZOTERO_LIBRARY_ID') or os.getenv('LIBRARY_ID')
api_key = os.getenv('ZOTERO_API_KEY') or os.getenv('API_KEY') or os.getenv('ZOTERO_KEY')
lib_type = os.getenv('ZOTERO_LIBRARY_TYPE') or os.getenv('LIBRARY_TYPE') or 'user'
if not lib_id or not api_key:
    raise RuntimeError('Missing Zotero credentials')

client = mod.Zotero(library_id=lib_id, library_type=lib_type, api_key=api_key)
items = client.get_all_items(collection_name=None, collection_key='44Q6VN9A', cache=True) or []

out_dir = repo/'logs'/'ocr_collection_runs'
out_dir.mkdir(parents=True, exist_ok=True)
progress_path = out_dir/'frameworks_44Q6VN9A.progress.json'
result_path = out_dir/'frameworks_44Q6VN9A.result.json'

status = {
    'status': 'running',
    'collection_key': '44Q6VN9A',
    'total_items': len(items),
    'processed_items': 0,
    'current_item_key': '',
    'done': False,
    'results': []
}
progress_path.write_text(json.dumps(status, ensure_ascii=False, indent=2), encoding='utf-8')

for idx, item in enumerate(items, start=1):
    key = str(item.get('key') or '').strip()
    status['current_item_key'] = key
    progress_path.write_text(json.dumps(status, ensure_ascii=False, indent=2), encoding='utf-8')
    row = {'item_key': key, 'pdf_path': '', 'ok': False, 'sections': 0, 'error': ''}
    try:
        pdf_path = str(client.get_pdf_path_for_item(key) or '').strip()
        row['pdf_path'] = pdf_path
        if not pdf_path:
            row['error'] = 'no_pdf_path'
        else:
            parsed = mod.process_pdf(
                pdf_path=pdf_path,
                cache=True,
                cache_full=True,
                mistral_model='mistral-ocr-latest',
                ocr_retry=5,
                core_sections=True,
            ) or {}
            sections = parsed.get('sections') if isinstance(parsed, dict) else {}
            row['sections'] = len(sections) if isinstance(sections, dict) else 0
            row['ok'] = row['sections'] > 0
            if not row['ok']:
                row['error'] = 'empty_sections'
    except Exception as exc:
        row['error'] = f"{type(exc).__name__}: {exc}"
        row['traceback'] = traceback.format_exc(limit=5)

    status['results'].append(row)
    status['processed_items'] = idx
    progress_path.write_text(json.dumps(status, ensure_ascii=False, indent=2), encoding='utf-8')

status['status'] = 'completed'
status['done'] = True
status['current_item_key'] = ''
progress_path.write_text(json.dumps(status, ensure_ascii=False, indent=2), encoding='utf-8')
result_path.write_text(json.dumps(status, ensure_ascii=False, indent=2), encoding='utf-8')
print('DONE')
