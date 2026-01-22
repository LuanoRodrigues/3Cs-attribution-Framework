const fs = require("fs");
const path = require("path");
const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell } = require("docx");

const fixtureDir = path.join(__dirname, "../docs/test_documents/fixtures");
fs.mkdirSync(fixtureDir, { recursive: true });
const outputPath = path.join(fixtureDir, "round_trip_sample.docx");

const doc = new Document({
  sections: [
    {
      properties: {},
      children: [
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          children: [new TextRun({ text: "Round Trip Sample" })]
        }),
        new Paragraph({
          children: [
            new TextRun("This paragraph mixes "),
            new TextRun({ text: "bold", bold: true }),
            new TextRun(" and "),
            new TextRun({ text: "italic", italics: true }),
            new TextRun(" text.")
          ]
        }),
        new Paragraph({
          children: [
            new TextRun("First numbered item"),
            new TextRun("\nSecond numbered item")
          ]
        }),
        new Table({
          rows: [
            new TableRow({
              children: [
                new TableCell({
                  children: [new Paragraph({ text: "Header A" })]
                }),
                new TableCell({
                  children: [new Paragraph({ text: "Header B" })]
                })
              ]
            }),
            new TableRow({
              children: [
                new TableCell({
                  children: [new Paragraph({ text: "Cell A1" })]
                }),
                new TableCell({
                  children: [new Paragraph({ text: "Cell B1" })]
                })
              ]
            }),
            new TableRow({
              children: [
                new TableCell({
                  children: [new Paragraph({ text: "Cell A2" })]
                }),
                new TableCell({
                  children: [new Paragraph({ text: "Cell B2" })]
                })
              ]
            })
          ]
        }),
        new Paragraph({
          children: [new TextRun("End of fixture document.")]
        })
      ]
    }
  ]
});

Packer.toBuffer(doc)
  .then((buffer) => {
    fs.writeFileSync(outputPath, buffer);
    console.log("Generated fixture:", outputPath);
  })
  .catch((error) => {
    console.error("Failed to generate fixture:", error);
    process.exit(1);
  });
