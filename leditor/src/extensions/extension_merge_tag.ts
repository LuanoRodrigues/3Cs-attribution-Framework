import { Node } from "@tiptap/core";

const MergeTagExtension = Node.create({
  name: "merge_tag",
  inline: true,
  group: "inline",
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      key: {
        default: ""
      }
    };
  },
  parseHTML() {
    return [
      {
        tag: "span[data-merge-tag]"
      }
    ];
  },
  renderHTML({ HTMLAttributes }) {
    const key = (HTMLAttributes.key as string) ?? "";
    const text = `{{${key || "TAG"}}}`;
    return [
      "span",
      {
        "data-merge-tag": "true",
        "data-key": key,
        class: "leditor-merge-tag",
        contenteditable: "false"
      },
      text
    ];
  }
});

export default MergeTagExtension;
