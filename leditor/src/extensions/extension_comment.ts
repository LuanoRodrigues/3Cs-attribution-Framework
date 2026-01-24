import { Mark, mergeAttributes } from "@tiptap/core";
import type { CommandProps } from "@tiptap/core";

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
        (attributes: Record<string, unknown>) =>
        ({ commands }: CommandProps) => {
          this.editor.commands.focus();
          commands.setMark(this.name, attributes);
          return true;
        },
      unsetComment:
        () =>
        ({ commands }: CommandProps) => {
          this.editor.commands.focus();
          commands.unsetMark(this.name);
          return true;
        }
    };
  }
});

export default CommentMark;

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    comment: {
      setComment: (attributes: Record<string, unknown>) => ReturnType;
      unsetComment: () => ReturnType;
    };
  }
}
