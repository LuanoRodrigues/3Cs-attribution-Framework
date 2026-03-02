import json
import tempfile
import unittest
from unittest import mock
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

    def test_reference_and_dqid_hydration_use_zotero_metadata_paths(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            norm_path = Path(td) / "norm.json"
            payload = {
                "ITEM0001": {
                    "metadata": {
                        "zotero_metadata": {
                            "title": "Zotero Path Title",
                            "creators": [{"lastName": "Garcia"}, {"lastName": "Lopez"}],
                            "date": "2018-03-14",
                        }
                    },
                    "evidence_list": [{"dqid": "ITEM0001#DQ001", "quote": "Quoted text."}],
                }
            }
            norm_path.write_text(json.dumps(payload), encoding="utf-8")
            summary = {"output": {"normalized_results_path": str(norm_path)}}

            payload_rows, dq_lookup = sr._build_dqid_evidence_payload(summary, max_rows=10)
            self.assertEqual(payload_rows[0]["citation"], "(Garcia & Lopez, 2018)")
            self.assertEqual(dq_lookup["ITEM0001"]["citation"], "(Garcia & Lopez, 2018)")
            self.assertEqual(dq_lookup["ITEM0001#DQ001"]["citation"], "(Garcia & Lopez, 2018)")

            refs = sr._build_reference_items(summary)
            merged = "\n".join(refs)
            self.assertIn("Garcia &amp; Lopez. (2018). Zotero Path Title.", merged)
            self.assertNotIn("(Source ITEM0001, 1900)", merged)

    def test_reference_hydration_uses_all_items_df_when_normalized_metadata_sparse(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            norm_path = Path(td) / "norm.json"
            all_items_path = Path(td) / "all_items_df.json"
            payload = {
                "239TNJ3D": {
                    "metadata": {
                        "item_key": "239TNJ3D",
                    },
                    "evidence_list": [{"dqid": "239TNJ3D#DQ001", "quote": "Quoted text."}],
                }
            }
            all_items = [
                {
                    "key": "239TNJ3D",
                    "title": "Do Proxies Provide Plausible Deniability? Evidence from Experiments on Three Surveys",
                    "year": 2024,
                    "author_summary": "Williamson",
                    "authors": "",
                    "url": "https://example.org/doc",
                    "pdf_path": "/tmp/doc.pdf",
                }
            ]
            norm_path.write_text(json.dumps(payload), encoding="utf-8")
            all_items_path.write_text(json.dumps(all_items), encoding="utf-8")
            summary = {
                "collection_name": "0.13_cyber_attribution_corpus_records_total_included",
                "output": {"normalized_results_path": str(norm_path)},
            }
            with mock.patch.dict("os.environ", {"SYSTEMATIC_ALL_ITEMS_DF_PATH": str(all_items_path)}):
                refs = sr._build_reference_items(summary)
                merged = "\n".join(refs)
                self.assertIn("Williamson. (2024). Do Proxies Provide Plausible Deniability?", merged)
                payload_rows, dq_lookup = sr._build_dqid_evidence_payload(summary, max_rows=10)
                self.assertEqual(payload_rows[0]["citation"], "(Williamson, 2024)")
                self.assertEqual(dq_lookup["239TNJ3D"]["citation"], "(Williamson, 2024)")

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

    def test_anchor_driven_reference_filtering_uses_text_order_and_ignores_reference_block(self) -> None:
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
            _, dq_lookup = sr._build_dqid_evidence_payload(summary, max_rows=20)

            html_text = (
                "<p>Body cites <a data-dqid=\"ITEM002#DQ001\">(Jones, 2021)</a> then "
                "<a data-dqid=\"ITEM001#DQ001\">(Smith, 2020)</a>.</p>"
                "<h2>7. References</h2><div id=\"references\" class=\"section-content\">"
                "<ol><li><a data-dqid=\"ITEM999#DQ001\">(Ignore, 1900)</a></li></ol></div>"
            )
            item_keys = sr._derive_anchor_item_keys_from_html(html_text, dq_lookup)
            self.assertEqual(item_keys, ["ITEM002", "ITEM001"])

            refs = sr._build_reference_items(summary, citation_style="apa", anchor_item_keys=item_keys)
            self.assertEqual(len(refs), 2)
            self.assertIn("Jones. (2021). T2.", refs[0])
            self.assertIn("Smith. (2020). T1.", refs[1])

    def test_anchor_driven_reference_filtering_empty_anchor_set_returns_empty_refs(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            norm_path = Path(td) / "norm.json"
            payload = {
                "ITEM001": {
                    "metadata": {"title": "T1", "year": "2020", "first_author_last": "Smith"},
                    "code_intro_conclusion_extract_core_claims": [{"dqid": "ITEM001#DQ001", "quote": "Quoted text 1"}],
                },
            }
            norm_path.write_text(json.dumps(payload), encoding="utf-8")
            summary = {"output": {"normalized_results_path": str(norm_path)}}
            refs = sr._build_reference_items(summary, citation_style="apa", anchor_item_keys=[])
            self.assertEqual(refs, [])

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

    def test_enrich_dqid_anchors_uses_file_fallback_href(self) -> None:
        dq_lookup = {
            "IT1#DQ001": {
                "citation": "(Smith, 2020)",
                "quote": "Quoted evidence.",
            }
        }
        html_text = "<p>Claim <a data-dqid=\"IT1#DQ001\">(Smith, 2020)</a>.</p>"
        out = sr._enrich_dqid_anchors(html_text, dq_lookup, citation_style="apa")
        self.assertIn("class=\"dqid-cite\"", out)
        self.assertIn("href=\"file://dqid/IT1%23DQ001\"", out)

    def test_enrich_dqid_anchors_recovers_placeholder_citation_from_item_key_metadata(self) -> None:
        dq_lookup = {
            "ITEM0001": {
                "citation": "(Source ITEM0001, 1900)",
                "author": "Garcia",
                "year": "2018",
                "title": "Recovered Title",
            }
        }
        html_text = "<p>Claim <a data-dqid=\"ITEM0001#DQ111\">(Source ITEM0001, 1900)</a>.</p>"
        out = sr._enrich_dqid_anchors(html_text, dq_lookup, citation_style="apa")
        self.assertIn("(Garcia, 2018)", out)
        self.assertNotIn("(Source ITEM0001, 1900)", out)
        self.assertIn("title=\"Recovered Title\"", out)

    def test_inject_dqid_anchors_if_missing_uses_file_fallback_href(self) -> None:
        dq_lookup = {
            "IT9#DQ010": {
                "citation": "(Jones, 2021)",
                "quote": "Another quote.",
            }
        }
        out = sr._inject_dqid_anchors_if_missing("<p>Claim text.</p>", dq_lookup, citation_style="apa")
        self.assertIn("class=\"dqid-cite\"", out)
        self.assertIn("href=\"file://dqid/IT9%23DQ010\"", out)

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

    def test_assign_rows_to_questions_keeps_unmapped_out_of_buckets(self) -> None:
        rows = [
            {"dqid": "A#1", "quote": "legal threshold issue", "theme": "state_responsibility_thresholds", "rq_indices": [0]},
            {"dqid": "B#1", "quote": "proxy obfuscation and false flags", "theme": "attribution_challenges", "rq_indices": [1]},
            {"dqid": "C#1", "quote": "general statement with no clear mapping", "theme": "miscellaneous"},
        ]
        research_questions = [
            "What legal and policy problems does cyber attribution create?",
            "Which technical factors distort attribution assessments?",
        ]
        buckets, unmapped = sr._assign_rows_to_questions(rows, research_questions)
        self.assertEqual(len(buckets[0]), 1)
        self.assertEqual(len(buckets[1]), 1)
        self.assertEqual(len(unmapped), 1)
        self.assertEqual(unmapped[0]["dqid"], "C#1")

    def test_explicit_rq_narrative_uses_rq1_to_rqn_and_reports_unmapped(self) -> None:
        rows = [
            {"dqid": "IT1#DQ001", "quote": "legal thresholds remain contested", "theme": "state_responsibility_thresholds", "item_key": "IT1", "rq_indices": [0]},
            {"dqid": "IT2#DQ001", "quote": "proxy use and obfuscation reduce confidence", "theme": "attribution_challenges", "item_key": "IT2", "rq_indices": [1]},
            {"dqid": "IT3#DQ001", "quote": "out-of-scope observation", "theme": "other", "item_key": "IT3"},
        ]
        dqid_lookup = {
            "IT1#DQ001": {"citation": "(Smith, 2020)", "quote": "legal thresholds remain contested"},
            "IT2#DQ001": {"citation": "(Jones, 2021)", "quote": "proxy use and obfuscation reduce confidence"},
        }
        html_text = sr._build_explicit_rq_narrative_html(
            research_questions=[
                "What legal/policy problems does attribution create?",
                "Which technical factors distort attribution?",
            ],
            rows=rows,
            dqid_lookup=dqid_lookup,
            citation_style="apa",
        )
        self.assertIn("RQ1:", html_text)
        self.assertIn("RQ2:", html_text)
        self.assertNotIn("RQ0:", html_text)
        self.assertIn("excluded from per-question tallies", html_text)
        self.assertIn("data-dqid=\"IT1#DQ001\"", html_text)
        self.assertIn("data-dqid=\"IT2#DQ001\"", html_text)

    def test_evidence_round_split_respects_row_cap_and_covers_all_rows(self) -> None:
        rows = [
            {
                "dqid": f"IT{i:02d}#DQ001",
                "quote": f"Evidence quote {i}",
                "theme": "theme_a" if i % 2 == 0 else "theme_b",
                "citation": "(Author, 2020)",
                "item_key": f"IT{i:02d}",
                "pdf_path": f"/tmp/{i}.pdf",
                "year": 2020 + (i % 3),
            }
            for i in range(10)
        ]
        rounds = sr._split_evidence_rows_into_capped_rounds(
            rows,
            row_cap=3,
            byte_cap=1_000_000,
            quote_chars=220,
        )
        self.assertEqual(sum(int(r.get("rows_count") or 0) for r in rounds), len(rows))
        self.assertTrue(all(int(r.get("rows_count") or 0) <= 3 for r in rounds))
        self.assertEqual(len(rounds), 4)

    def test_evidence_round_split_respects_byte_cap_and_manifest_reports_rq_coverage(self) -> None:
        long_quote = "A" * 500
        rows = [
            {
                "dqid": f"IT{i:02d}#DQ001",
                "quote": long_quote,
                "theme": "state_responsibility_thresholds",
                "citation": "(Author, 2020)",
                "item_key": f"IT{i:02d}",
                "pdf_path": f"/tmp/{i}.pdf",
                "rq_indices": [0] if i % 2 == 0 else [1],
                "year": 2019 + i,
            }
            for i in range(6)
        ]
        rounds = sr._split_evidence_rows_into_capped_rounds(
            rows,
            row_cap=50,
            byte_cap=1200,
            quote_chars=220,
        )
        self.assertGreater(len(rounds), 1)
        self.assertEqual(sum(int(r.get("rows_count") or 0) for r in rounds), len(rows))
        manifest = sr._evidence_round_manifest_lines(
            rounds,
            [
                "What legal and policy problems does attribution create?",
                "Which technical factors distort attribution?",
            ],
        )
        self.assertEqual(len(manifest), len(rounds))
        self.assertTrue(any("rq_coverage" in line for line in manifest))


if __name__ == "__main__":
    unittest.main()
