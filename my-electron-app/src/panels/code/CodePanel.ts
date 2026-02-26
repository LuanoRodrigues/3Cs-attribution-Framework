import {
  addResearchQuestion,
  getCodeState,
  subscribe,
  updateAdditionalPrompt,
  updateLens,
  updateModel,
  updateResearchQuestion
} from "../../state/codeState";

const MODEL_OPTIONS = ["gpt-5-thinking", "gpt-4o", "mistral-large", "custom-offline-eval"];
const LENS_OPTIONS = [
  "constructivist (social meaning / norms)",
  "positivist (causal inference / measurement)",
  "interpretivist / hermeneutic (thick meaning)",
  "critical / political economy (power / interest)",
  "socio-technical / STS (infrastructure shaping practice)",
  "practice-centric (who does what, in context)"
];

export class CodePanel {
  readonly element: HTMLElement;
  private list: HTMLElement;
  private modelSelect: HTMLSelectElement;
  private lensSelect: HTMLSelectElement;
  private additionalPromptInput: HTMLTextAreaElement;
  private unsubscribe?: () => void;

  constructor() {
    this.element = document.createElement("div");
    this.element.className = "tool-surface code-welcome";

    const grid = document.createElement("div");
    grid.className = "code-welcome-grid";

    const optionsSection = document.createElement("section");
    optionsSection.className = "code-welcome-section code-options-section";
    const optionsHeading = document.createElement("div");
    optionsHeading.className = "code-options-heading";
    const optionsTitle = document.createElement("h5");
    optionsTitle.textContent = "Optional context";
    const optionsMeta = document.createElement("p");
    optionsMeta.className = "code-options-meta";
    optionsMeta.textContent = "Model, analytical lens, and additional prompt are optional. Research questions are required.";
    optionsHeading.append(optionsTitle, optionsMeta);
    optionsSection.append(optionsHeading);

    const optionsGrid = document.createElement("div");
    optionsGrid.className = "code-options-grid";

    const modelRow = document.createElement("div");
    modelRow.className = "code-options-row";
    const modelLabel = document.createElement("span");
    modelLabel.className = "code-options-label";
    modelLabel.textContent = "Model";
    this.modelSelect = document.createElement("select");
    MODEL_OPTIONS.forEach((value) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      this.modelSelect.appendChild(option);
    });
    this.modelSelect.addEventListener("change", () => updateModel(this.modelSelect.value));
    modelRow.append(modelLabel, this.modelSelect);

    const lensRow = document.createElement("div");
    lensRow.className = "code-options-row";
    const lensLabel = document.createElement("span");
    lensLabel.className = "code-options-label";
    lensLabel.textContent = "Analytical lens";
    this.lensSelect = document.createElement("select");
    LENS_OPTIONS.forEach((value) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      this.lensSelect.appendChild(option);
    });
    this.lensSelect.addEventListener("change", () => updateLens(this.lensSelect.value));
    lensRow.append(lensLabel, this.lensSelect);

    const promptRow = document.createElement("div");
    promptRow.className = "code-options-row code-options-row--prompt";
    const promptLabel = document.createElement("span");
    promptLabel.className = "code-options-label";
    promptLabel.textContent = "Additional prompt";
    this.additionalPromptInput = document.createElement("textarea");
    this.additionalPromptInput.placeholder = "Give extra guidance (tone, focus, constraints)...";
    this.additionalPromptInput.className = "code-additional-prompt";
    this.additionalPromptInput.addEventListener("input", () => updateAdditionalPrompt(this.additionalPromptInput.value));
    promptRow.append(promptLabel, this.additionalPromptInput);

    optionsGrid.append(modelRow, lensRow, promptRow);
    optionsSection.append(optionsGrid);

    const rqSection = document.createElement("section");
    rqSection.className = "code-welcome-section code-rq-section";
    const rqHeader = document.createElement("div");
    rqHeader.className = "code-welcome-row code-welcome-row--split";
    const rqTitle = document.createElement("h5");
    rqTitle.textContent = "Research question(s)";
    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "ribbon-button";
    addBtn.textContent = "+";
    addBtn.title = "Add another research question";
    addBtn.ariaLabel = "Add research question";
    addBtn.dataset.voiceAliases = "add question,add research question,research question add";
    addBtn.addEventListener("click", () => addResearchQuestion());
    rqHeader.append(rqTitle, addBtn);

    const rqHint = document.createElement("p");
    rqHint.className = "code-rq-hint";
    rqHint.textContent = "Insert your top 3-5 research questions; this section is required to steer the coder.";

    this.list = document.createElement("div");
    this.list.className = "code-rq-list";

    rqSection.append(rqHeader, rqHint, this.list);

    grid.append(optionsSection, rqSection);

    const workflowSection = document.createElement("section");
    workflowSection.className = "code-welcome-section code-workflow-section";
    const workflowTitle = document.createElement("h5");
    workflowTitle.textContent = "Workflow";
    const workflowText = document.createElement("p");
    workflowText.className = "code-welcome-workflow";
    workflowText.textContent =
      "Pick a model, analytical lens, and optional additional prompt, then insert your top research questions (3-5) and click Code Corpus →.";
    const workflowRow = document.createElement("div");
    workflowRow.className = "code-welcome-row";
    const ctaBtn = document.createElement("button");
    ctaBtn.type = "button";
    ctaBtn.className = "ribbon-button";
    ctaBtn.textContent = "Code Corpus →";
    ctaBtn.title = "Jump to the coded corpus";
    ctaBtn.ariaLabel = "Jump to coded corpus";
    ctaBtn.dataset.voiceAliases = "jump to code corpus,open corpus,code corpus,coder corpus";
    ctaBtn.addEventListener("click", () => {
      window.dispatchEvent(new CustomEvent("code:open-corpus"));
    });
    workflowRow.append(ctaBtn);

    workflowSection.append(workflowTitle, workflowText, workflowRow);

    this.element.append(grid, workflowSection);
    this.unsubscribe = subscribe((state) => this.renderState(state));
  }

  destroy(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
    }
  }

  private renderState(state: ReturnType<typeof getCodeState>): void {
    this.modelSelect.value = state.model;
    this.lensSelect.value = state.lens;
    this.additionalPromptInput.value = state.additionalPrompt;
    this.list.innerHTML = "";
    const rqs = state.rqs.length > 0 ? state.rqs : [""];
    rqs.forEach((rq, index) => {
      const row = document.createElement("div");
      row.className = "code-rq-row";
      const input = document.createElement("input");
      input.type = "text";
      input.className = "code-rq-input";
      input.value = rq;
      input.placeholder = "Research question…";
      input.addEventListener("input", () => updateResearchQuestion(index, input.value));
      row.append(input);
      this.list.appendChild(row);
    });
  }
}
