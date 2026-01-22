import { Mark, mergeAttributes } from "@tiptap/core";

const CommentMark = Mark.create({
  name: "comment",
  inclusive: false,
  addOptions() {
    return {
      HTMLAttributes: {}
    };
  },
  addAttributes() {
    return {
      id: {
        default: null
      },
      text: {
        default: ""
      }
    };
  },
  parseHTML() {
    return [{ tag: "span[data-comment-id]" }];
  },
  renderHTML({ HTMLAttributes }) {
    const { id, text } = {
      id: HTMLAttributes.id,
      text: HTMLAttributes.text ?? ""
    };
    return [
      "span",
      mergeAttributes(
        {
          class: "leditor-comment",
          "data-comment-id": id,
          "data-comment-text": text,
          title: text
        },
        HTMLAttributes
      ),
      0
    ];
  },
  addCommands() {
    return {
      setComment:
        (attributes: Record<string, any>) =>
        ({ commands }) => {
          return commands.setMark(this.name, attributes);
        },
      unsetComment:
        () =>
        ({ commands }) => {
          return commands.unsetMark(this.name);
        }
    };
  }
});

export default CommentMark;
