"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initFullscreenController = exports.toggleFullscreen = void 0;
const toolbar_styles_js_1 = require("./toolbar_styles.js");
const phaseFlags = {
    entered: false,
    exited: false,
    logged: false
};
let rootElement = null;
let keyHandler = null;
let previousOverflow = null;
const maybeLogPhase = () => {
    if (phaseFlags.logged)
        return;
    if (phaseFlags.entered && phaseFlags.exited) {
        window.codexLog?.write("[PHASE15_OK]");
        phaseFlags.logged = true;
    }
};
const isFullscreen = () => rootElement?.classList.contains("leditor-app--fullscreen") ?? false;
const enterFullscreen = () => {
    if (!rootElement || isFullscreen())
        return;
    rootElement.classList.add("leditor-app--fullscreen");
    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    phaseFlags.entered = true;
};
const exitFullscreen = () => {
    if (!rootElement || !isFullscreen())
        return;
    rootElement.classList.remove("leditor-app--fullscreen");
    document.body.style.overflow = previousOverflow ?? "";
    previousOverflow = null;
    phaseFlags.exited = true;
    maybeLogPhase();
};
const toggleFullscreen = () => {
    if (!rootElement)
        return;
    if (isFullscreen()) {
        exitFullscreen();
        return;
    }
    enterFullscreen();
};
exports.toggleFullscreen = toggleFullscreen;
const initFullscreenController = (root) => {
    (0, toolbar_styles_js_1.ensureToolbarStyles)();
    rootElement = root;
    rootElement.classList.add("leditor-app");
    if (!keyHandler) {
        keyHandler = (event) => {
            if (event.key === "Escape" && isFullscreen()) {
                exitFullscreen();
            }
        };
        document.addEventListener("keydown", keyHandler);
    }
};
exports.initFullscreenController = initFullscreenController;
