from __future__ import annotations

import json
from pathlib import Path
import unittest

from annotarium.agents.scripts import infer_missing_footnotes as mod


class InferMissingFootnotesStyleTests(unittest.TestCase):
    def test_author_year_noise_filtered(self) -> None:
        sample = Path(__file__).resolve().parent / "corpus" / "author_year_noise.sample.json"
        obj = json.loads(sample.read_text(encoding="utf-8"))
        hits = mod._collect_intext_hits_from_citations(obj["citations"], obj["markdown"])
        ay = [h for h in hits if h.get("citation_style") == "author_year"]
        self.assertEqual(len(ay), 1)
        self.assertIn("2018", str(ay[0].get("intext_citation")))

    def test_roman_to_int(self) -> None:
        self.assertEqual(mod._roman_to_int("xiv"), 14)
        self.assertEqual(mod._roman_to_int("IV"), 4)
        self.assertIsNone(mod._roman_to_int("bad"))


if __name__ == "__main__":
    unittest.main()
