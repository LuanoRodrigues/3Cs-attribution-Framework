import type { AnalysePageContext, AnalyseState, AnalyseRun } from "../../analyse/types";
import { buildDatasetHandles, discoverRuns, getDefaultBaseDir, warmAnalyseRun } from "../../analyse/data";

const BASE_DIR_KEY = "analyse.baseDir";

function readStoredBaseDir(): string | undefined {
  try {
    return window.localStorage.getItem(BASE_DIR_KEY) || undefined;
  } catch (err) {
    console.warn("Unable to read stored base dir", err);
    return undefined;
  }
}

function persistBaseDir(path: string): void {
  try {
    window.localStorage.setItem(BASE_DIR_KEY, path);
  } catch (err) {
    console.warn("Unable to persist base dir", err);
  }
}

export function renderCorpusPage(container: HTMLElement, state: AnalyseState, ctx: AnalysePageContext): void {
  container.innerHTML = "";
  let viewState: AnalyseState = { ...state };
  let defaultBaseDir = "";

  const setState = (patch: Partial<AnalyseState>): void => {
    viewState = { ...viewState, ...patch };
    ctx.updateState(patch);
  };

  const header = document.createElement("h2");
  header.textContent = "Corpus overview";
  container.appendChild(header);

  const intro = document.createElement("p");
  intro.textContent = "Select a themes directory, discover runs, and set the active run for analysis.";
  container.appendChild(intro);

  const controlRow = document.createElement("div");
  controlRow.className = "control-row";

  const baseDirInput = document.createElement("input");
  baseDirInput.type = "text";
  baseDirInput.placeholder = "Base directory containing thematic runs";
  baseDirInput.value = viewState.baseDir || readStoredBaseDir() || "";
  baseDirInput.style.minWidth = "320px";

  const scanBtn = document.createElement("button");
  scanBtn.type = "button";
  scanBtn.className = "ribbon-button";
  scanBtn.textContent = "Scan for runs";

  controlRow.appendChild(baseDirInput);
  controlRow.appendChild(scanBtn);
  container.appendChild(controlRow);

  const runSelectRow = document.createElement("div");
  runSelectRow.className = "control-row";
  const runSelect = document.createElement("select");
  runSelect.style.minWidth = "240px";
  const setActiveBtn = document.createElement("button");
  setActiveBtn.type = "button";
  setActiveBtn.className = "ribbon-button";
  setActiveBtn.textContent = "Set active run";
  runSelectRow.appendChild(runSelect);
  runSelectRow.appendChild(setActiveBtn);
  container.appendChild(runSelectRow);

  const metadata = document.createElement("div");
  metadata.className = "viz-grid";
  container.appendChild(metadata);

  const statusBar = document.createElement("div");
  statusBar.className = "status-bar";
  container.appendChild(statusBar);

  const renderMetadataCards = () => {
    metadata.innerHTML = "";
    const cards: { label: string; value: string }[] = [
      { label: "Runs detected", value: String(viewState.runs?.length ?? 0) },
      { label: "Sections root", value: viewState.sectionsRoot || "n/a" },
      { label: "Active run", value: viewState.activeRunId || "None" },
      { label: "Run path", value: viewState.activeRunPath || "n/a" }
    ];

    if (viewState.datasets) {
      cards.push({ label: "Batches", value: viewState.datasets.batches ? "Yes" : "No" });
      cards.push({ label: "Sections R1", value: viewState.datasets.sectionsR1 ? "Yes" : "No" });
      cards.push({ label: "Sections R2", value: viewState.datasets.sectionsR2 ? "Yes" : "No" });
      cards.push({ label: "Sections R3", value: viewState.datasets.sectionsR3 ? "Yes" : "No" });
    }

    cards.forEach(({ label, value }) => {
      const card = document.createElement("div");
      card.className = "viz-card";
      const title = document.createElement("h5");
      title.textContent = label;
      const body = document.createElement("div");
      body.textContent = value;
      body.style.fontSize = "20px";
      body.style.fontWeight = "600";
      card.appendChild(title);
      card.appendChild(body);
      metadata.appendChild(card);
    });
  };

  const updateRunOptions = () => {
    runSelect.innerHTML = "";
    if (!viewState.runs || viewState.runs.length === 0) {
      const opt = document.createElement("option");
      opt.textContent = "No runs discovered";
      opt.disabled = true;
      opt.selected = true;
      runSelect.appendChild(opt);
      return;
    }
    viewState.runs.forEach((run) => {
      const opt = document.createElement("option");
      opt.value = run.id;
      opt.textContent = `${run.label} ${run.hasSections ? "(Sections)" : ""}`.trim();
      opt.selected = run.id === viewState.activeRunId;
      runSelect.appendChild(opt);
    });
  };

  const updateStatus = (message: string) => {
    statusBar.textContent = message;
  };

  const scanRuns = async () => {
    const candidate = baseDirInput.value.trim() || defaultBaseDir;
    if (!candidate) {
      updateStatus("Provide a base directory to scan for runs.");
      return;
    }
    console.info("[analyse][corpus][scan]", { baseDir: candidate });
    updateStatus("Scanning runs...");
    try {
      const { runs, sectionsRoot } = await discoverRuns(candidate);
      console.info("[analyse][corpus][scan][result]", { baseDir: candidate, sectionsRoot, runCount: runs.length });
      persistBaseDir(candidate);
      setState({ baseDir: candidate, runs, sectionsRoot: sectionsRoot || undefined });
      updateRunOptions();
      renderMetadataCards();
      updateStatus(runs.length ? `Found ${runs.length} run(s) under ${sectionsRoot || candidate}` : `No runs found under ${candidate}`);
    } catch (err) {
      console.error(err);
      updateStatus("Unable to scan runs. Check the base directory and permissions.");
    }
  };

  const setActiveRun = async () => {
    const runId = runSelect.value;
    const run: AnalyseRun | undefined = (viewState.runs || []).find((r) => r.id === runId);
    if (!run) {
      updateStatus("Select a run to activate.");
      return;
    }
    const datasets = await buildDatasetHandles(run.path);
    console.info("[analyse][corpus][set-active]", { runId: run.id, runPath: run.path, datasets });
    setState({
      activeRunId: run.id,
      activeRunPath: run.path,
      themesDir: run.path,
      datasets
    });
    warmAnalyseRun(run.path);
    renderMetadataCards();
    updateStatus(`Active run set to ${run.label}`);
  };

  scanBtn.addEventListener("click", () => {
    void scanRuns();
  });
  setActiveBtn.addEventListener("click", () => {
    void setActiveRun();
  });

  const loadDefaults = async () => {
    defaultBaseDir = await getDefaultBaseDir();
    baseDirInput.placeholder = defaultBaseDir || "Base directory containing thematic runs";
    if (!viewState.baseDir && !baseDirInput.value) {
      baseDirInput.value = defaultBaseDir;
    }
    if ((viewState.runs?.length || 0) === 0 && (viewState.baseDir || baseDirInput.value)) {
      await scanRuns();
    } else {
      updateRunOptions();
      renderMetadataCards();
    }
  };

  void loadDefaults();
}
