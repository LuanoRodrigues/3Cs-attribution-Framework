import builtins
import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pandas as pd

APP_ROOT = Path(__file__).resolve().parents[2]
WORKSPACE_ROOT = Path(__file__).resolve().parents[3]
BACKEND_ROOT = WORKSPACE_ROOT / "my-electron-app" / "shared" / "python_backend"
for path in (APP_ROOT, BACKEND_ROOT):
    path_str = str(path)
    if path_str not in sys.path:
        sys.path.insert(0, path_str)


def _install_round23_import_stubs() -> None:
    import types

    def ensure_module(name: str):
        mod = sys.modules.get(name)
        if mod is None:
            mod = types.ModuleType(name)
            sys.modules[name] = mod
        return mod

    # Legacy Qt/UI dependency tree that is not available in electron_zotero tests.
    z_pkg = ensure_module("Z_Corpus_analysis")
    z_pdf = ensure_module("Z_Corpus_analysis.PDF_widget")

    class _PdfViewer:  # pragma: no cover - import shim
        pass

    z_pdf.PdfViewer = _PdfViewer
    setattr(z_pkg, "PDF_widget", z_pdf)

    # Corpus helper import used by thematic_functions during module import.
    b_pkg = ensure_module("bibliometric_analysis_tool")
    b_utils_pkg = ensure_module("bibliometric_analysis_tool.utils")
    b_loader = ensure_module("bibliometric_analysis_tool.utils.Zotero_loader_to_df")
    b_loader.find_text_page_and_section = lambda *args, **kwargs: None
    setattr(b_utils_pkg, "Zotero_loader_to_df", b_loader)
    setattr(b_pkg, "utils", b_utils_pkg)

    # Batch/model adapters (overridden in-test, but must import cleanly first).
    gpt_api = ensure_module("gpt_api")
    gpt_api._process_batch_for = lambda **kwargs: {"status": "stubbed", "kwargs": kwargs}
    src_pkg = ensure_module("src")
    src_core_pkg = ensure_module("src.core")
    src_core_utils_pkg = ensure_module("src.core.utils")
    src_calling_models = ensure_module("src.core.utils.calling_models")
    src_calling_models.call_models_old_backin = lambda **kwargs: {"status": "stubbed", "kwargs": kwargs}
    setattr(src_core_utils_pkg, "calling_models", src_calling_models)
    setattr(src_core_pkg, "utils", src_core_utils_pkg)
    setattr(src_pkg, "core", src_core_pkg)

    # Heavy ML deps are not needed for this deterministic harness path.
    if "torch" not in sys.modules:
        torch = types.ModuleType("torch")
        torch.cuda = types.SimpleNamespace(is_available=lambda: False)
        torch.backends = types.SimpleNamespace(
            cuda=types.SimpleNamespace(matmul=types.SimpleNamespace(allow_tf32=False)),
            cudnn=types.SimpleNamespace(allow_tf32=False),
        )
        torch.set_float32_matmul_precision = lambda *_args, **_kwargs: None
        sys.modules["torch"] = torch

    if "tqdm" not in sys.modules:
        tqdm_mod = types.ModuleType("tqdm")

        class _Tqdm:  # pragma: no cover - import shim
            def __init__(self, iterable=None, total=None, **_kwargs):
                self.iterable = iterable
                self.total = total

            def __iter__(self):
                return iter(self.iterable or [])

            def update(self, _n=1):
                return None

            def close(self):
                return None

        tqdm_mod.tqdm = _Tqdm
        sys.modules["tqdm"] = tqdm_mod

    if "sentence_transformers" not in sys.modules:
        st_mod = types.ModuleType("sentence_transformers")

        class _SentenceTransformer:  # pragma: no cover - import shim
            def __init__(self, *_args, **_kwargs):
                pass

            def encode(self, texts, normalize_embeddings=True):
                _ = normalize_embeddings
                return [[0.0, 0.0, 0.0] for _ in texts]

        st_mod.SentenceTransformer = _SentenceTransformer
        sys.modules["sentence_transformers"] = st_mod

    sk_mod = ensure_module("sklearn")
    sk_fe = ensure_module("sklearn.feature_extraction")
    sk_fe_text = ensure_module("sklearn.feature_extraction.text")
    sk_pre = ensure_module("sklearn.preprocessing")
    sk_nei = ensure_module("sklearn.neighbors")

    class _TfidfVectorizer:  # pragma: no cover - import shim
        def __init__(self, *args, **kwargs):
            _ = (args, kwargs)

        def fit_transform(self, texts):
            return [[0.0] for _ in texts]

    class _NearestNeighbors:  # pragma: no cover - import shim
        def __init__(self, *args, **kwargs):
            _ = (args, kwargs)

        def fit(self, *_args, **_kwargs):
            return self

        def kneighbors(self, x, n_neighbors=1):
            _ = n_neighbors
            size = len(x) if hasattr(x, "__len__") else 1
            return [[0.0] * size, [[0] * size]]

    sk_fe_text.TfidfVectorizer = _TfidfVectorizer
    sk_pre.normalize = lambda x, **_kwargs: x
    sk_nei.NearestNeighbors = _NearestNeighbors
    setattr(sk_fe, "text", sk_fe_text)
    setattr(sk_mod, "feature_extraction", sk_fe)
    setattr(sk_mod, "preprocessing", sk_pre)
    setattr(sk_mod, "neighbors", sk_nei)


_install_round23_import_stubs()

import PDF_parsing.thematic_functions as tf


class _RoundResultsShim:
    def __init__(self, **kwargs):
        for key, value in kwargs.items():
            setattr(self, key, value)


def run_round23_test() -> dict:
    builtins.input = lambda prompt='': ''

    def fake_call_models_old_backin(
        text: str,
        function: str,
        custom_id: str = None,
        collection_name: str = None,
        read: bool = False,
        store_only: bool = False,
        by_index: int = 0,
        **kwargs,
    ):
        if store_only:
            return {"status": "queued", "custom_id": custom_id}
        if read:
            return (
                '<h3 id="section-title">Synthetic Section</h3>'
                '<p id="p1" data-tags="models;frameworks">Synthetic analysis paragraph from payload.</p>'
                '<p id="p2" data-tags="models">Second synthetic paragraph across evidence.</p>'
                '<p id="conclusion">Synthetic conclusion.</p>'
                '<!-- coverage used=[] unused=[] -->'
            )
        return {"status": "ok"}

    def fake_process_batch_for(**kwargs):
        return {"status": "completed", "kwargs": kwargs}

    # isolate test from live OpenAI/batch dependencies
    tf.call_models_old_backin = fake_call_models_old_backin
    tf._process_batch_for = fake_process_batch_for
    tf.RoundResults = _RoundResultsShim

    collection = "rounds_synth_4items"
    out_dir = Path("state") / "test_outputs" / "debug_round23"
    out_dir.mkdir(parents=True, exist_ok=True)

    payloads = [
        {
            "item_key": f"ITM{i}",
            "direct_quote": f"Quote text {i} about cyber attribution frameworks and models.",
            "paraphrase": f"Paraphrase {i}",
            "researcher_comment": f"Comment {i}",
            "theme": "Framework Typology",
            "potential_theme": "Model category",
            "evidence_type": "framework",
            "direct_quote_id": f"DQ{i:02d}",
            "rq_question": "How are cyber attribution frameworks and models used?",
            "overarching_theme": "Cyber Attribution",
            "relevance_score": 5,
        }
        for i in range(1, 5)
    ]

    job = {
        "metadata": {
            "layer1_key": "all",
            "layer2_key": "0: How are cyber attribution frameworks and models used?",
            "theme_label": "Cyber Attribution",
            "layer_structure": "theme",
            "route_value": "all",
        },
        "payloads": payloads,
        "prompt": "Synthesize framework/model evidence.",
    }

    planned_files = [("all_theme", [(job, job["prompt"])])]
    quote_hits = {p["item_key"]: 1 for p in payloads}
    direct_quote_lookup = {
        p["direct_quote_id"]: {
            "item_key": p["item_key"],
            "direct_quote": p["direct_quote"],
            "author_summary": "Doe",
            "year": "2024",
            "title": f"Title {p['item_key']}",
            "source": "Journal",
            "url": "",
            "page": "1",
            "section_title": "Methods",
            "section_text": "text",
            "theme": p["potential_theme"],
        }
        for p in payloads
    }

    batch = SimpleNamespace(
        planned_files=planned_files,
        direct_quote_lookup=direct_quote_lookup,
        quote_hits=quote_hits,
        out_dir=str(out_dir),
        all_jobs_flat=[job],
        manifest_path=None,
    )

    df = pd.DataFrame(
        [
            {
                "item_key": p["item_key"],
                "year": 2024,
                "authors": "Doe",
                "title": f"Title {p['item_key']}",
                "publication_outlet": "Journal",
            }
            for p in payloads
        ]
    )

    res = tf.running_rounds(
        collection_name=collection,
        df=df,
        quote_hits=quote_hits,
        direct_quote_lookup=direct_quote_lookup,
        batch=batch,
        user_prompt="Focus on models and frameworks",
        round2="paragraphs",
        framework_analysis=True,
    )

    summary = {
        "outputs_round1": len(res.outputs_round1),
        "round1_sections_merged": len(res.round1_sections_merged),
        "num_batches_round2": res.num_batches_round2,
        "outputs_round2": len(res.outputs_round2),
        "custom_ids_round2": len(res.custom_ids_round2),
        "num_batches_round3": res.num_batches_round3,
        "outputs_round3": len(res.outputs_round3),
        "custom_ids_round3": len(res.custom_ids_round3),
        "round3_sections_merged": len(res.round3_sections_merged),
        "export_paths": res.export_paths,
    }

    report_path = out_dir / "round23_test_report.json"
    report_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    return {"summary": summary, "report_path": str(report_path)}


if __name__ == "__main__":
    out = run_round23_test()
    print(json.dumps(out["summary"], indent=2))
    print("report_path", out["report_path"])
