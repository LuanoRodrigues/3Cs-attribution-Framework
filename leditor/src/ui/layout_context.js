"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getLayoutController = exports.setLayoutController = void 0;
let layoutController = null;
const setLayoutController = (controller) => {
    layoutController = controller;
};
exports.setLayoutController = setLayoutController;
const getLayoutController = () => layoutController;
exports.getLayoutController = getLayoutController;
