import { Extension, type CommandProps, type Editor } from "@tiptap/core";
import { CellSelection } from "@tiptap/pm/tables";

const MIN_INDENT_LEVEL = 0;
const MAX_INDENT_LEVEL = 8;
const clampIndentLevel = (value: number) => Math.max(MIN_INDENT_LEVEL, Math.min(MAX_INDENT_LEVEL, value));

const findListItemDepth = (editor: Editor) => {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type.name === "listItem") return depth;
  }
  return null;
};

const getBlockAtSelection = (editor: Editor) => {
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

const resolveBlockIndent = (editor: Editor) => {
  const block = getBlockAtSelection(editor);
  if (!block) return null;
  const current = Number(block.attrs.indentLevel ?? 0);
  return { name: block.name, current };
};

const setIndentLevel = (editor: Editor, level: number) => {
  const blockInfo = resolveBlockIndent(editor);
  if (!blockInfo) return false;
  const next = clampIndentLevel(level);
  editor.commands.updateAttributes(blockInfo.name, { indentLevel: next });
  return true;
};

const adjustIndent = (editor: Editor, delta: number) => {
  const blockInfo = resolveBlockIndent(editor);
  if (!blockInfo) return false;
  return setIndentLevel(editor, blockInfo.current + delta);
};

const IndentExtension = Extension.create({
  name: "indent",
  addGlobalAttributes() {
    return [
      {
        types: ["paragraph", "heading"],
        attributes: {
          indentLevel: {
            default: 0,
            parseHTML: (element) => {
              const value = (element as HTMLElement).style.marginLeft;
              if (!value) return 0;
              const match = value.match(/^([0-9.]+)em$/);
              if (!match) return 0;
              const level = Number(match[1]);
              return Number.isFinite(level) ? level : 0;
            },
            renderHTML: (attrs) => {
              const styles: string[] = [];
              const level = attrs.indentLevel;
              if (level && level > 0) {
                styles.push(`margin-left: ${level}em`);
              }
              const right = Number(attrs.indentRight ?? 0);
              if (right && right > 0) {
                styles.push(`margin-right: ${right}px`);
              }
              if (styles.length === 0) return {};
              return { style: styles.join("; ") };
            }
          },
          indentRight: {
            default: 0,
            parseHTML: (element) => {
              const value = (element as HTMLElement).style.marginRight;
              if (!value) return 0;
              const match = value.match(/^([0-9.]+)px$/);
              if (!match) return 0;
              const amount = Number(match[1]);
              return Number.isFinite(amount) ? amount : 0;
            }
          }
        }
      }
    ];
  },
  addKeyboardShortcuts() {
    return {
      Tab: () => {
      const selection = this.editor.state.selection;
      if (selection instanceof CellSelection) return false;
      this.editor.commands.focus();
      if (findListItemDepth(this.editor) !== null) {
        return this.editor.commands.sinkListItem("listItem");
      }
      return adjustIndent(this.editor, 1);
      },
      "Shift-Tab": () => {
        const selection = this.editor.state.selection;
        if (selection instanceof CellSelection) return false;
        this.editor.commands.focus();
        if (findListItemDepth(this.editor) !== null) {
          return this.editor.commands.liftListItem("listItem");
        }
        return adjustIndent(this.editor, -1);
      }
  };
},
  addCommands() {
    return {
      indentIncrease:
        () =>
        ({ commands }: CommandProps) => {
          this.editor.commands.focus();
          return adjustIndent(this.editor, 1);
        },
      indentDecrease:
        () =>
        ({ commands }: CommandProps) => {
          this.editor.commands.focus();
          return adjustIndent(this.editor, -1);
        },
      setIndent:
        (attrs?: { level?: number | string }) =>
        ({ commands }: CommandProps) => {
          const raw = attrs?.level;
          const level =
            typeof raw === "number"
              ? raw
              : typeof raw === "string"
                ? Number.parseFloat(raw)
                : undefined;
          if (!Number.isFinite(level ?? NaN)) {
            return false;
          }
          this.editor.commands.focus();
          return setIndentLevel(this.editor, level ?? 0);
        }
    };
  }
});

export default IndentExtension;

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    indent: {
      indentIncrease: () => ReturnType;
      indentDecrease: () => ReturnType;
      setIndent: (attrs?: { level?: number | string }) => ReturnType;
    };
  }
}
