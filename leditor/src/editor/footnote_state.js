"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getFootnoteIds = exports.allocateFootnoteId = exports.resetFootnoteState = void 0;
const state = {
    counter: 0,
    ids: []
};
const resetFootnoteState = () => {
    state.counter = 0;
    state.ids.length = 0;
};
exports.resetFootnoteState = resetFootnoteState;
const allocateFootnoteId = () => {
    state.counter += 1;
    const id = `footnote-${state.counter}`;
    state.ids.push(id);
    return id;
};
exports.allocateFootnoteId = allocateFootnoteId;
const getFootnoteIds = () => state.ids.slice();
exports.getFootnoteIds = getFootnoteIds;
