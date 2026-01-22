import type { Editor } from "@tiptap/core";

export type AlignmentVariant = "left" | "center" | "right" | "justify";

export type BlockDescriptor = {
  name: string;
  attrs: Record<string, unknown>;
} | null;

export const getSelectionAlignment = (editor: Editor): AlignmentVariant => {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    const align = node.attrs?.textAlign;
    if (typeof align === "string" && align.length > 0) {
      if (align === "center" || align === "right" || align === "justify") {
        return align;
      }
      return "left";
    }
  }
  return "left";
};

export const getSelectionBlockDescriptor = (editor: Editor): BlockDescriptor => {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    const name = node.type.name;
    if (name === "paragraph" || name === "heading") {
      return { name, attrs: node.attrs };
    }
  }
  return null;
};
