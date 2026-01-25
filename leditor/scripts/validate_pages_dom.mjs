import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const read = (relativePath) =>
  readFileSync(path.resolve(__dirname, "..", relativePath), "utf8");

const assertContains = (source, needle, label) => {
  if (!source.includes(needle)) {
    console.error(`[FAIL] Missing ${label}: ${needle}`);
    process.exit(1);
  }
};

const a4Source = read("src/ui/a4_layout.ts").replace(/\r\n/g, "\n");
assertContains(a4Source, "#editor .ProseMirror {\n  width: 100%;\n  max-width: 100%;", "ProseMirror max-width");
assertContains(a4Source, "#editor .ProseMirror table {\n  width: 100%;\n  max-width: 100%;\n  table-layout: fixed;", "Table containment");
assertContains(a4Source, "#editor .ProseMirror td,\n#editor .ProseMirror th {\n  max-width: 0;\n  overflow: hidden;", "Table cell overflow clip");
assertContains(a4Source, "#editor .ProseMirror figure,\n#editor .ProseMirror img {\n  max-width: 100%;", "Media containment");
assertContains(
  a4Source,
  ".leditor-page-content {\n  position: absolute;\n  top: var(--local-page-margin-top, var(--page-margin-top));\n  left: var(--local-page-margin-left, var(--page-margin-left));\n  width: calc(\n    var(--local-page-width, var(--page-width)) -\n      (var(--local-page-margin-left, var(--page-margin-left)) +\n        var(--local-page-margin-right, var(--page-margin-right)))\n  );\n  height: calc(\n    var(--local-page-height, var(--page-height)) -\n      (var(--local-page-margin-top, var(--page-margin-top)) +\n        var(--local-page-margin-bottom, var(--page-margin-bottom)) +\n        var(--page-footnote-height, var(--footnote-area-height)))\n  );",
  "Page content box uses local page size and margins"
);
assertContains(a4Source, "column-count: var(--page-columns, 1);", "Column count token");
assertContains(a4Source, "--local-page-width", "Local page width token usage");
assertContains(
  a4Source,
  "  caret-color: currentColor;\n  overflow: hidden;",
  "ProseMirror overflow clamp"
);

const layoutSettings = read("src/ui/layout_settings.ts").replace(/\r\n/g, "\n");
assertContains(layoutSettings, "--page-margin-inside", "Inside margin variable");
assertContains(layoutSettings, "--page-margin-outside", "Outside margin variable");
assertContains(layoutSettings, "docSetMarginsCustom", "Ribbon margins propagate to document layout spec");

const a4SourceJs = read("src/ui/a4_layout.js").replace(/\r\n/g, "\n");
assertContains(
  a4SourceJs,
  ".leditor-page-content {\n  position: absolute;\n  top: var(--local-page-margin-top, var(--page-margin-top));\n  left: var(--local-page-margin-left, var(--page-margin-left));\n  width: calc(\n    var(--local-page-width, var(--page-width)) -\n      (var(--local-page-margin-left, var(--page-margin-left)) +\n        var(--local-page-margin-right, var(--page-margin-right)))\n  );\n  height: calc(\n    var(--local-page-height, var(--page-height)) -\n      (var(--local-page-margin-top, var(--page-margin-top)) +\n        var(--local-page-margin-bottom, var(--page-margin-bottom)) +\n        var(--page-footnote-height, 0px))\n  );",
  "JS page content box matches local page size/margins"
);

console.log("[PASS] Layout containment and margin variable checks passed.");
