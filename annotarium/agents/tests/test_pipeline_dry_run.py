from __future__ import annotations

import unittest

from annotarium.agents import build_default_pipeline, dry_run_graph, validate_layout


class PipelineDryRunTests(unittest.TestCase):
    def test_default_pipeline_stage_order(self) -> None:
        stages = build_default_pipeline()
        self.assertEqual(
            [s.stage_id for s in stages],
            [
                "stage0_document_metadata",
                "stage1_markdown_parse",
                "stage2_claim_extraction",
            ],
        )

    def test_dry_run_graph_shape(self) -> None:
        graph = dry_run_graph()
        self.assertEqual(len(graph["nodes"]), 3)
        self.assertEqual(len(graph["edges"]), 2)
        self.assertEqual(
            graph["edges"],
            [
                {
                    "from": "stage0_document_metadata",
                    "to": "stage1_markdown_parse",
                },
                {
                    "from": "stage1_markdown_parse",
                    "to": "stage2_claim_extraction",
                },
            ],
        )

    def test_pipeline_assets_present(self) -> None:
        errors = validate_layout()
        self.assertEqual(errors, [])


if __name__ == "__main__":
    unittest.main()
