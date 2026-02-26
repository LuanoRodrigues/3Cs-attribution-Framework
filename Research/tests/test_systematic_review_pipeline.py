import json
import tempfile
import unittest
from pathlib import Path

from Research import systematic_review_pipeline as sr


class SystematicReviewPipelineTests(unittest.TestCase):
    def test_tuple_cleanup_in_section_html(self) -> None:
        raw = "('<p>Alpha\\nBeta</p>', {'input tokens': 10, 'output tokens': 5, 'total tokens': 15, 'cost usd': 0.1, 'model': 'gpt-5-mini', 'is batch': True})"
        cleaned = sr._clean_and_humanize_section_html(raw)
        self.assertEqual(cleaned, "<p>Alpha\nBeta</p>")

    def test_reference_hydration_uses_normalized_metadata(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            norm_path = Path(td) / "norm.json"
            payload = {
                "ITEM001": {
                    "metadata": {
                        "title": "Test Paper",
                        "year": "2020",
                        "first_author_last": "Smith",
                        "zotero_metadata": {"creators": [{"lastName": "Smith"}]},
                    },
                    "code_intro_conclusion_extract_core_claims": [
                        {"dqid": "ITEM001#DQ001", "quote": "Quoted text."}
                    ],
                }
            }
            norm_path.write_text(json.dumps(payload), encoding="utf-8")
            summary = {"output": {"normalized_results_path": str(norm_path)}}
            refs = sr._build_reference_items(summary)
            merged = "\n".join(refs)
            self.assertIn("Smith. (2020). Test Paper.", merged)
            self.assertNotIn("Unresolved source metadata", merged)

    def test_integrity_validator_fails_on_unknown_citation(self) -> None:
        bad_html = "<html><body><p>Example <a data-dqid='x'>(Unknown, n.d.)</a></p></body></html>"
        with self.assertRaises(RuntimeError):
            sr._assert_reference_and_postprocess_integrity(bad_html)

    def test_citation_style_formatter_numeric_and_endnote(self) -> None:
        text_n, allow_n = sr._format_intext_citation("numeric", "(Smith, 2020)", 7)
        self.assertEqual(text_n, "[7]")
        self.assertFalse(allow_n)
        text_e, allow_e = sr._format_intext_citation("endnote", "(Smith, 2020)", 7)
        self.assertEqual(text_e, "<sup>7</sup>")
        self.assertTrue(allow_e)

    def test_append_page_to_apa_citation(self) -> None:
        self.assertEqual(sr._append_page_to_apa_citation("(Smith, 2020)", 4), "(Smith, 2020, p. 4)")
        self.assertEqual(sr._append_page_to_apa_citation("(Smith, 2020, p. 4)", 4), "(Smith, 2020, p. 4)")

    def test_numeric_notes_block_emits_note_ids(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            norm_path = Path(td) / "norm.json"
            payload = {
                "ITEM001": {
                    "metadata": {"title": "T1", "year": "2020", "first_author_last": "Smith"},
                    "code_intro_conclusion_extract_core_claims": [{"dqid": "ITEM001#DQ001", "quote": "Quoted text 1"}],
                },
                "ITEM002": {
                    "metadata": {"title": "T2", "year": "2021", "first_author_last": "Jones"},
                    "code_intro_conclusion_extract_core_claims": [{"dqid": "ITEM002#DQ001", "quote": "Quoted text 2"}],
                },
            }
            norm_path.write_text(json.dumps(payload), encoding="utf-8")
            summary = {"output": {"normalized_results_path": str(norm_path)}}
            notes_html = sr._build_notes_block_html(summary, citation_style="numeric")
            self.assertIn("id=\"note-1\"", notes_html)
            self.assertIn("id=\"note-2\"", notes_html)

    def test_cache_legacy_migration_to_v2_schema(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            cache_path = Path(td) / "section_generation_cache.json"
            legacy = {
                "abstract": "('<p>Legacy abstract</p>', {'input tokens': 1, 'output tokens': 1, 'total tokens': 2, 'cost usd': 0.0, 'model': 'gpt-5-mini', 'is batch': True})",
                "discussion": "<p>Discussion body</p>",
            }
            cache_path.write_text(json.dumps(legacy), encoding="utf-8")
            entries, html_map, dirty = sr._load_section_cache(cache_path)
            self.assertTrue(dirty)
            self.assertIn("abstract", entries)
            self.assertIn("discussion", entries)
            self.assertEqual(html_map["abstract"], "<p>Legacy abstract</p>")
            sr._write_section_cache(cache_path, entries)
            persisted = json.loads(cache_path.read_text(encoding="utf-8"))
            self.assertEqual(persisted.get("schema"), sr.CACHE_SCHEMA)
            self.assertIn("sections", persisted)
            self.assertIn("abstract", persisted["sections"])


if __name__ == "__main__":
    unittest.main()
