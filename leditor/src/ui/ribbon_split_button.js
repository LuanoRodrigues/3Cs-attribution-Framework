"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SplitButton = void 0;
const getLog = () => window.codexLog;
class SplitButton {
    element;
    primaryButton;
    caretButton;
    constructor(options) {
        this.element = document.createElement("div");
        this.element.className = "leditor-split-button";
        this.primaryButton = document.createElement("button");
        this.primaryButton.type = "button";
        this.primaryButton.className = "leditor-split-primary";
        this.primaryButton.textContent = options.label;
        this.primaryButton.addEventListener("click", () => {
            options.onPrimary();
            if (options.logLabel) {
                getLog()?.write(`[SPLIT_PRIMARY] ${options.logLabel}`);
            }
        });
        this.caretButton = document.createElement("button");
        this.caretButton.type = "button";
        this.caretButton.className = "leditor-split-caret";
        this.caretButton.setAttribute("aria-label", `${options.label} menu`);
        this.caretButton.textContent = "?";
        this.caretButton.addEventListener("click", (event) => {
            event.stopPropagation();
            options.menu.open(this.caretButton);
            if (options.logLabel) {
                getLog()?.write(`[SPLIT_CARET] ${options.logLabel}`);
            }
        });
        this.element.append(this.primaryButton, this.caretButton);
    }
}
exports.SplitButton = SplitButton;
