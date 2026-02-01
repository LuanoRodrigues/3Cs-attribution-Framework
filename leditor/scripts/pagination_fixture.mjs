import path from "path";
import { fileURLToPath } from "url";
import { promises as fs } from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const outPath = path.join(repoRoot, "docs", "test_documents", "footnote_regression.json");

const sentence =
  "This paragraph is intentionally long to push text near the bottom of the page for footnote layout testing. ";
const longBody = `${sentence.repeat(24)}Near the end of the page we insert a footnote marker`;

const doc = {
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { level: 1 },
      content: [{ type: "text", text: "Footnote Regression Fixture" }]
    },
    {
      type: "paragraph",
      content: [
        { type: "text", text: longBody + " " },
        {
          type: "footnote",
          attrs: {
            footnoteId: "footnote-1",
            kind: "footnote",
            text: "Initial footnote text. Add lines here to force body pagination."
          }
        },
        { type: "text", text: ". Continue with the paragraph to fill the page." }
      ]
    },
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text:
            "Second paragraph exists to catch overflow after the footnote expands. " +
            "Keep typing in the footnote area and confirm this line jumps to the next page."
        }
      ]
    }
  ]
};

const run = async () => {
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(doc, null, 2), "utf8");
  console.log("[fixture] footnote regression fixture written:", outPath);
};

run().catch((error) => {
  console.error("[fixture] failed to write footnote regression fixture", error);
  process.exit(1);
});
