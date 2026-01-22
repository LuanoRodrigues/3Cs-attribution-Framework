import {
  addResearchQuestion,
  getCodeState,
  subscribe,
  updateModel,
  updateResearchQuestion
} from "../../state/codeState";

const MODEL_OPTIONS = ["gpt-4.1", "gpt-4o", "claude-3.5", "local-llm"];

export class CodePanel {
  readonly element: HTMLElement;
  private list: HTMLElement;
  private modelSelect: HTMLSelectElement;
  private unsubscribe?: () => void;

  constructor() {
    this.element = document.createElement("div");
    this.element.className = "tool-surface";
    const header = document.createElement("div");
    header.className = "tool-header";

    const title = document.createElement("h4");
    title.textContent = "Code — Research questions";
    header.appendChild(title);

    const controls = document.createElement("div");
    controls.className = "control-row";

    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "ribbon-button";
    addBtn.textContent = "+";
    addBtn.title = "Add research question";
    addBtn.addEventListener("click", () => addResearchQuestion());

    this.modelSelect = document.createElement("select");
    this.modelSelect.ariaLabel = "Model";
    MODEL_OPTIONS.forEach((value) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      this.modelSelect.appendChild(option);
    });
    this.modelSelect.addEventListener("change", () => updateModel(this.modelSelect.value));

    controls.appendChild(addBtn);
    controls.appendChild(this.modelSelect);

    this.list = document.createElement("div");
    this.list.className = "code-rq-list";

    this.element.append(header, controls, this.list);
    this.unsubscribe = subscribe((state) => this.renderState(state));
  }

  destroy(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
    }
  }

  private renderState(state: ReturnType<typeof getCodeState>): void {
    this.modelSelect.value = state.model;
    this.list.innerHTML = "";
    state.rqs.forEach((rq, index) => {
      const row = document.createElement("div");
      row.className = "code-rq-row";

      const label = document.createElement("span");
      label.className = "code-rq-label";
      label.textContent = `RQ ${index + 1}`;

      const input = document.createElement("input");
      input.type = "text";
      input.value = rq;
      input.placeholder = "Enter research question";
      input.addEventListener("input", () => updateResearchQuestion(index, input.value));

      row.append(label, input);
      this.list.appendChild(row);
    });
    if (state.rqs.length === 0) {
      const empty = document.createElement("div");
      empty.className = "code-rq-empty";
      empty.textContent = "Add your first research question.";
      this.list.appendChild(empty);
    }
  }
}
