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

    def test_sanitize_href_url_decodes_amp_and_normalizes_query_keys(self) -> None:
        raw = (
            "https://heinonline.org/HOL/Page?public=true&amp;amp;handle=hein.journals/isjlpsoc8"
            "&amp;amp;start page=321&amp;amp;set as cursor=558&amp;amp;men tab=srchresults"
        )
        out = sr._sanitize_href_url(raw)
        self.assertIn("public=true", out)
        self.assertIn("handle=hein.journals%2Fisjlpsoc8", out)
        self.assertIn("start_page=321", out)
        self.assertIn("set_as_cursor=558", out)
        self.assertIn("men_tab=srchresults", out)
        self.assertNotIn("&amp;", out)

    def test_decode_html_entities_repairs_broken_apostrophe(self) -> None:
        self.assertEqual(sr._decode_html_entities("O&amp;amp;#x27;Connell"), "O'Connell")

    def test_dedupe_citation_anchors_in_parenthetical_group(self) -> None:
        html_text = (
            "<p>Text ((<a class=\"dqid-cite\" data-dqid=\"D1\" href=\"https://x\" title=\"(A, 2020)\">(A, 2020)</a>); "
            "(<a class=\"dqid-cite\" data-dqid=\"D1\" href=\"https://x\" title=\"(A, 2020)\">(A, 2020)</a>); "
            "(<a class=\"dqid-cite\" data-dqid=\"D2\" href=\"https://y\" title=\"(B, 2021)\">(B, 2021)</a>)).</p>"
        )
        out = sr._normalize_parenthetical_citations_html(html_text)
        out = sr._dedupe_citation_anchors_html(out)
        self.assertIn("(A, 2020)", out)
        self.assertIn("(B, 2021)", out)
        self.assertEqual(out.count("data-dqid=\"D1\""), 1)
        self.assertEqual(out.count("data-dqid=\"D2\""), 1)
        self.assertNotIn("((", out)

    def test_integrity_validator_fails_on_double_escaped_href(self) -> None:
        bad_html = "<html><body><a class=\"dqid-cite\" href=\"https://x?a=1&amp;amp;b=2\" title=\"(A, 2020)\">(A, 2020)</a></body></html>"
        with self.assertRaises(RuntimeError):
            sr._assert_reference_and_postprocess_integrity(bad_html)

    def test_anchor_plain_author_year_citations_maps_to_dqid(self) -> None:
        dq_lookup = {
            "IT1#DQ001": {
                "citation": "(Smith, 2020, p. 4)",
                "quote": "Quoted evidence.",
                "source_url": "https://example.org/a",
                "page_no": "4",
            }
        }
        html_text = "<p>Claim sentence (Smith, 2020, p. 4).</p>"
        out = sr._anchor_plain_author_year_citations(html_text, dq_lookup, citation_style="apa")
        self.assertIn("class=\"dqid-cite\"", out)
        self.assertIn("data-dqid=\"IT1#DQ001\"", out)
        self.assertIn("(Smith, 2020, p. 4)", out)

    def test_anchor_plain_author_year_citations_handles_malformed_apostrophe_entity(self) -> None:
        dq_lookup = {
            "IT2#DQ003": {
                "citation": "(O'Connell, 2012, p. 3)",
                "quote": "Quoted evidence.",
                "source_url": "https://example.org/b",
                "page_no": "3",
            }
        }
        html_text = "<p>Related argument (O& #x27;Connell, 2012, p. 3).</p>"
        out = sr._anchor_plain_author_year_citations(html_text, dq_lookup, citation_style="apa")
        self.assertIn("class=\"dqid-cite\"", out)
        self.assertIn("data-dqid=\"IT2#DQ003\"", out)

    def test_find_unanchored_author_year_ignores_numeric_year_ranges(self) -> None:
        html_text = "<p>Coverage was broad (55 items, 2010-2012) and methodologically mixed.</p>"
        leftovers = sr._find_unanchored_author_year_citations(html_text)
        self.assertEqual(leftovers, [])

    def test_validate_section_citation_integrity_fails_on_unmapped_author_year(self) -> None:
        with self.assertRaises(RuntimeError):
            sr._validate_section_citation_integrity(
                "discussion",
                "<p>Unsupported claim (Scholars, 2011).</p>",
                {"IT1#DQ001": {"citation": "(Smith, 2020)", "source_url": "https://example.org/a"}},
                citation_style="apa",
            )


if __name__ == "__main__":
    unittest.main()
