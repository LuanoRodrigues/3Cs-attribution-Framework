type LegacyMenuInstance = {
  open(anchor: HTMLElement): void;
};

type SplitButtonOptions = {
  label: string;
  iconElement?: HTMLElement | null;
  onPrimary: () => void;
  menu: LegacyMenuInstance;
  logLabel?: string;
};

const getLog = () =>
  (window as typeof window & { codexLog?: { write: (line: string) => void } }).codexLog;

export class SplitButton {
  readonly element: HTMLDivElement;
  private primaryButton: HTMLButtonElement;
  private caretButton: HTMLButtonElement;

  constructor(options: SplitButtonOptions) {
    this.element = document.createElement("div");
    this.element.className = "leditor-split-button";
    this.element.classList.add("leditor-ribbon-control");

    this.primaryButton = document.createElement("button");
    this.primaryButton.type = "button";
    this.primaryButton.className = "leditor-split-primary";
    this.primaryButton.setAttribute("aria-label", options.label);
    this.primaryButton.dataset.tooltip = options.label;
    if (options.iconElement) {
      this.primaryButton.appendChild(options.iconElement);
    } else {
      const labelSpan = document.createElement("span");
      labelSpan.className = "ribbon-button-label";
      labelSpan.textContent = options.label;
      this.primaryButton.appendChild(labelSpan);
    }
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
    this.caretButton.textContent = "▾";
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
