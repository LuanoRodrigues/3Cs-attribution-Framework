import { Extension } from "@tiptap/core";
import { keymap } from "@tiptap/pm/keymap";

const ALIGN_SHORTCUTS: Record<string, "left" | "center" | "right" | "justify"> = {
  "Mod-Shift-L": "left",
  "Mod-Shift-E": "center",
  "Mod-Shift-R": "right",
  "Mod-Shift-J": "justify"
};

const HEADING_SHORTCUTS: Record<string, number> = {
  "Mod-Alt-1": 1,
  "Mod-Alt-2": 2,
  "Mod-Alt-3": 3
};

const WordShortcutsExtension = Extension.create({
  name: "wordShortcuts",
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      keymap({
        ...Object.fromEntries(
          Object.entries(ALIGN_SHORTCUTS).map(([key, align]) => [
            key,
            () => {
              editor.commands.focus();
              editor.commands.setTextAlign(align);
              return true;
            }
          ])
        ),
        ...Object.fromEntries(
          Object.entries(HEADING_SHORTCUTS).map(([key, level]) => [
            key,
            () => {
              editor.commands.focus();
              editor.commands.toggleHeading({ level });
              return true;
            }
          ])
        ),
        "Mod-Alt-T": () => {
          editor.commands.focus();
          editor.commands.insertTable({ rows: 2, cols: 2 });
          return true;
        },
        "Mod-Alt+F": () => {
          editor.commands.focus();
          editor.commands.insertFootnote?.();
          return true;
        }
      })
    ];
  }
});

export default WordShortcutsExtension;
