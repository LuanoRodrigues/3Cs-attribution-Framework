
import os, sys, json, time
from pathlib import Path
import importlib.util
repo = Path('/home/pantera/projects/TEIA')
# parse .env safely
for envp in [repo/'.env', repo/'my-electron-app'/'.env']:
    if envp.exists():
        for line in envp.read_text(encoding='utf-8', errors='ignore').splitlines():
            s=line.strip().strip('\r')
            if not s or s.startswith('#') or '=' not in s:
                continue
            k,v=s.split('=',1)
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
rq = [
    'What types of evidence are used?',
    'What methods are used?',
    'How are frameworks and models operationalized for cyber attribution?'
]
res = client.open_coding(
    research_question=rq,
    collection_name='frameworks',
    collection_key='44Q6VN9A',
    store_only=True,
    read=True,
    cache=False,
    prompt_key='code_pdf_page',
)
out = repo/'electron_zotero'/'logs'/'long_runs'/'run_open_coding_store_only_frameworks.result.json'
out.write_text(json.dumps({'status':'ok','type':str(type(res)),'keys':(list(res.keys()) if isinstance(res, dict) else None),'size':(len(res) if isinstance(res, dict) else None)}, ensure_ascii=False, indent=2), encoding='utf-8')
print('DONE')
