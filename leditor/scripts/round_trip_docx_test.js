const fs = require("fs");
const path = require("path");
const os = require("os");
const mammoth = require("mammoth");
const { buildDocxBuffer } = require("../lib/docx_exporter.js");

const fixturePath = path.join(__dirname, "../docs/test_documents/round_trip_sample.json");
const fixtureJson = JSON.parse(fs.readFileSync(fixturePath, "utf8"));

const run = async () => {
const buffer = await buildDocxBuffer(fixtureJson, {
  pageSize: { widthMm: 210, heightMm: 297 },
  pageMargins: { top: "1in", right: "1in", bottom: "1in", left: "1in" },
  section: { headerHtml: "Header A", footerHtml: "Footer X", pageNumberStart: 1 }
});
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "round-trip-"));
  const exportPath = path.join(tempDir, "round_trip_export.docx");
  fs.writeFileSync(exportPath, buffer);
  const { value: html } = await mammoth.convertToHtml({ path: exportPath });
  const tokens = [
    "Round Trip Sample",
    "This paragraph mixes",
    "First numbered item",
    "Second numbered item",
    "Header A",
    "Cell B2",
    "End of fixture document"
  ];
  for (const token of tokens) {
    if (!html.includes(token)) {
      throw new Error(`Round-trip output missing "${token}"`);
    }
  }
  console.log("Round-trip docx test passed:", exportPath);
};

run().catch((error) => {
  console.error("Round-trip docx test failed:", error);
  process.exit(1);
});
