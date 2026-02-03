import { Node } from "@tiptap/core";

// A single bibliography entry rendered as a styled paragraph. Keeping each entry as its
// own top-level block allows the paginator to split references across multiple pages.
const BibliographyEntryExtension = Node.create({
  name: "bibliography_entry",
  group: "block",
  content: "inline*",
  defining: false,
  isolating: false,
  selectable: false,
  draggable: false,
  parseHTML() {
    return [{ tag: "p[data-bibliography-entry]" }];
  },
  renderHTML() {
    return [
      "p",
      {
        "data-bibliography-entry": "true",
        class: "leditor-bibliography-entry"
      },
      0
    ];
  }
});

export default BibliographyEntryExtension;

