import type { AnalyseState } from "../../analyse/types";

export function renderWelcomePage(container: HTMLElement, state: AnalyseState): void {
  container.innerHTML = "";
  const title = document.createElement("h2");
  title.textContent = "Analyse Workspace";
  container.appendChild(title);

  const intro = document.createElement("p");
  intro.textContent = "Prepare your corpus, configure the pipeline, and watch progress updates without blocking the UI.";
  container.appendChild(intro);

  const form = document.createElement("form");
  form.className = "analyse-form analyse-form--welcome";

  const baseDirInput = document.createElement("input");
  baseDirInput.name = "baseDir";
  baseDirInput.placeholder = "Base directory";
  baseDirInput.value = state.baseDir || "";
  const baseDirRow = document.createElement("div");
  baseDirRow.className = "control-row";
  const baseDirLabel = document.createElement("label");
  baseDirLabel.textContent = "Base directory:";
  baseDirLabel.appendChild(baseDirInput);
  baseDirRow.appendChild(baseDirLabel);
  form.appendChild(baseDirRow);

  const collectionInput = document.createElement("input");
  collectionInput.name = "collection";
  collectionInput.placeholder = "Collection name";
  collectionInput.value = state.collection || "";
  const collectionRow = document.createElement("div");
  collectionRow.className = "control-row";
  const collectionLabel = document.createElement("label");
  collectionLabel.textContent = "Collection:";
  collectionLabel.appendChild(collectionInput);
  collectionRow.appendChild(collectionLabel);
  form.appendChild(collectionRow);

  const batchSizeInput = document.createElement("input");
  batchSizeInput.type = "number";
  batchSizeInput.name = "batchSize";
  batchSizeInput.placeholder = "Batch size";
  batchSizeInput.value = "25";
  const batchRow = document.createElement("div");
  batchRow.className = "control-row";
  const batchLabel = document.createElement("label");
  batchLabel.textContent = "Batch size:";
  batchLabel.appendChild(batchSizeInput);
  batchRow.appendChild(batchLabel);
  form.appendChild(batchRow);

  const modelInput = document.createElement("input");
  modelInput.name = "modelName";
  modelInput.placeholder = "Model name";
  modelInput.value = "default-llm";
  const modelRow = document.createElement("div");
  modelRow.className = "control-row";
  const modelLabel = document.createElement("label");
  modelLabel.textContent = "Model:";
  modelLabel.appendChild(modelInput);
  modelRow.appendChild(modelLabel);
  form.appendChild(modelRow);

  const lensInput = document.createElement("input");
  lensInput.name = "analyticalLens";
  lensInput.placeholder = "Analytical lens";
  lensInput.value = "overview";
  const lensRow = document.createElement("div");
  lensRow.className = "control-row";
  const lensLabel = document.createElement("label");
  lensLabel.textContent = "Analytical lens:";
  lensLabel.appendChild(lensInput);
  lensRow.appendChild(lensLabel);
  form.appendChild(lensRow);

  const questionInput = document.createElement("textarea");
  questionInput.name = "researchQuestions";
  questionInput.placeholder = "Research questions";
  questionInput.rows = 3;
  questionInput.value = "";
  const questionRow = document.createElement("div");
  questionRow.className = "control-row";
  const questionLabel = document.createElement("label");
  questionLabel.textContent = "Research questions:";
  questionLabel.appendChild(questionInput);
  questionRow.appendChild(questionLabel);
  form.appendChild(questionRow);

  const runRow = document.createElement("div");
  runRow.className = "control-row";
  const runBtn = document.createElement("button");
  runBtn.type = "button";
  runBtn.className = "ribbon-button";
  runBtn.textContent = "Run pipeline";
  runBtn.addEventListener("click", () => {
    const payload = {
      baseDir: baseDirInput.value,
      collection: collectionInput.value,
      batchSize: Number(batchSizeInput.value) || 25,
      modelName: modelInput.value,
      analyticalLens: lensInput.value,
      researchQuestions: questionInput.value
    };
    container.dispatchEvent(new CustomEvent("analyse-run-pipeline", { detail: payload, bubbles: true }));
  });
  runRow.appendChild(runBtn);
  form.appendChild(runRow);

  const progress = document.createElement("div");
  progress.className = "status-bar";
  progress.textContent = state.stats?.pipeline ? String(state.stats.pipeline) : "Pipeline idle";

  container.appendChild(form);
  container.appendChild(progress);
}
