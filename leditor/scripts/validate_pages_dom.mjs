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
assertContains(
  a4Source,
  ".leditor-content-layer {\n  position: absolute;\n  top: 0;\n  left: 50%;\n  transform: translateX(-50%);\n  width: var(--local-page-width, var(--page-width));\n  height: var(--local-page-height, var(--page-height));\n  z-index: 3;\n  box-sizing: border-box;\n  padding: 0;\n  overflow: hidden;",
  "Content layer overflow clamp"
);
assertContains(a4Source, "#editor .ProseMirror table {\n  width: 100%;\n  max-width: 100%;\n  table-layout: fixed;", "Table containment");
assertContains(a4Source, "#editor .ProseMirror td,\n#editor .ProseMirror th {\n  max-width: 0;\n  overflow: hidden;", "Table cell overflow clip");
assertContains(a4Source, "#editor .ProseMirror figure,\n#editor .ProseMirror img {\n  max-width: 100%;", "Media containment");
assertContains(
  a4Source,
  ".leditor-content-frame {\n  width: 100%;\n  min-height: 100%;\n  padding: 0;\n  box-sizing: border-box;\n  overflow: hidden;",
  "Content frame overflow clamp"
);
assertContains(
  a4Source,
  ".leditor-content-inset {\n  position: relative;\n  width: 100%;\n  min-height: 100%;\n  box-sizing: border-box;\n  padding: 0;\n  overflow: hidden;",
  "Content inset overflow clamp"
);
assertContains(
  a4Source,
  ".leditor-margins-frame {\n  position: absolute;\n  top: calc(var(--current-margin-top, var(--page-margin-top)) + var(--header-height) + var(--header-offset));\n  left: var(--current-margin-left, var(--page-margin-left));\n  right: var(--current-margin-right, var(--page-margin-right));\n  bottom: calc(var(--current-margin-bottom, var(--page-margin-bottom)) + var(--footer-height) + var(--footer-offset) + var(--footnote-area-height));\n  box-sizing: border-box;\n  overflow: hidden;",
  "Margin frame alignment"
);
assertContains(a4Source, ".leditor-margin-guide {\n  position: absolute;\n  top: calc(var(--local-page-margin-top, var(--page-margin-top))", "Margin guide alignment");
assertContains(
  a4Source,
  "  caret-color: currentColor;\n  overflow: hidden;",
  "ProseMirror overflow clamp"
);

const layoutSettings = read("src/ui/layout_settings.ts").replace(/\r\n/g, "\n");
assertContains(layoutSettings, "--page-margin-inside", "Inside margin variable");
assertContains(layoutSettings, "--page-margin-outside", "Outside margin variable");

const a4SourceJs = read("src/ui/a4_layout.js").replace(/\r\n/g, "\n");
assertContains(
  a4SourceJs,
  ".leditor-content-inset {\n  position: relative;\n  width: 100%;\n  min-height: 100%;\n  box-sizing: border-box;\n  padding: 0;\n  overflow: hidden;",
  "JS content inset padding reset"
);
assertContains(
  a4SourceJs,
  ".leditor-margins-frame {\n  position: absolute;\n  top: calc(var(--current-margin-top, var(--page-margin-top)) + var(--header-height) + var(--header-offset));\n  left: var(--current-margin-left, var(--page-margin-left));\n  right: var(--current-margin-right, var(--page-margin-right));\n  bottom: calc(var(--current-margin-bottom, var(--page-margin-bottom)) + var(--footer-height) + var(--footer-offset) + var(--footnote-area-height));\n  box-sizing: border-box;\n  overflow: hidden;",
  "JS margin frame alignment"
);
assertContains(
  a4SourceJs,
  "marginFrame.className = \"leditor-margins-frame margins_frame_editor\";",
  "JS margin frame wrapper"
);

console.log("[PASS] Layout containment and margin variable checks passed.");
