"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notifyDirectionUndo = exports.applyBlockDirection = exports.directionExtension = void 0;
const core_1 = require("@tiptap/core");
const priorityTypes = ["tableHeader", "tableCell", "listItem", "heading", "paragraph"];
const phaseFlags = {
    directionApplied: false,
    undoObserved: false,
    logged: false
};
const maybeLogPhase = () => {
    if (phaseFlags.logged)
        return;
    if (phaseFlags.directionApplied && phaseFlags.undoObserved) {
        window.codexLog?.write("[PHASE19_OK]");
        phaseFlags.logged = true;
    }
};
exports.directionExtension = core_1.Extension.create({
    name: "direction",
    addGlobalAttributes() {
        return [
            {
                types: ["paragraph", "heading", "listItem", "tableCell", "tableHeader"],
                attributes: {
                    dir: {
                        default: null,
                        parseHTML: (element) => {
                            const value = element.getAttribute("dir");
                            return value === "rtl" || value === "ltr" ? value : null;
                        },
                        renderHTML: (attrs) => {
                            if (!attrs.dir)
                                return {};
                            return { dir: attrs.dir };
                        }
                    }
                }
            }
        ];
    }
});
const findAncestor = (editor, typeName) => {
    const { state } = editor;
    const { $from } = state.selection;
    for (let depth = $from.depth; depth > 0; depth -= 1) {
        const node = $from.node(depth);
        if (node.type.name === typeName) {
            const pos = $from.before(depth);
            return { node, pos };
        }
    }
    return null;
};
const applyBlockDirection = (editor, dir) => {
    const { state, view } = editor;
    const { tr } = state;
    for (const typeName of priorityTypes) {
        const ancestor = findAncestor(editor, typeName);
        if (!ancestor)
            continue;
        const attrs = { ...ancestor.node.attrs, dir };
        const updatedTr = tr.setNodeMarkup(ancestor.pos, ancestor.node.type, attrs);
        view.dispatch(updatedTr.scrollIntoView());
        phaseFlags.directionApplied = true;
        maybeLogPhase();
        return true;
    }
    return false;
};
exports.applyBlockDirection = applyBlockDirection;
const notifyDirectionUndo = () => {
    if (!phaseFlags.directionApplied)
        return;
    phaseFlags.undoObserved = true;
    maybeLogPhase();
};
exports.notifyDirectionUndo = notifyDirectionUndo;
