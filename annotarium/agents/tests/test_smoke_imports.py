import importlib
import unittest


class SmokeImportTests(unittest.TestCase):
    def test_module_imports(self) -> None:
        module = importlib.import_module("annotarium.agents")
        self.assertTrue(hasattr(module, "build_default_pipeline"))
        self.assertTrue(hasattr(module, "dry_run_graph"))


if __name__ == "__main__":
    unittest.main()
