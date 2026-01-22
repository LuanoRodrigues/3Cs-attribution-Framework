import type { AnalysePageContext, AnalyseState, AnalyseRun } from "../../analyse/types";
import { buildDatasetHandles, discoverRuns, getDefaultBaseDir } from "../../analyse/data";

const BASE_DIR_KEY = "analyse.baseDir";
const LEGACY_BASE_PREFIX = "/home/pantera/.annotarium/analyse";
const LEGACY_EVIDENCE_PREFIX = "/home/pantera/annotarium/evidence_coding_outputs";
const NEW_BASE_PREFIX = "/home/pantera/annotarium/analyse";

function normalizeBaseDir(pathValue?: string | null): string | undefined {
  if (!pathValue) return undefined;
  const trimmed = pathValue.trim();
  if (!trimmed) return undefined;
  if (trimmed === LEGACY_BASE_PREFIX) {
    return NEW_BASE_PREFIX;
  }
  if (trimmed === LEGACY_EVIDENCE_PREFIX) {
    return NEW_BASE_PREFIX;
  }
  if (trimmed.startsWith(`${LEGACY_BASE_PREFIX}/`)) {
    const suffix = trimmed.slice(LEGACY_BASE_PREFIX.length);
    return `${NEW_BASE_PREFIX}${suffix}`;
  }
  if (trimmed.startsWith(`${LEGACY_EVIDENCE_PREFIX}/`)) {
    const suffix = trimmed.slice(LEGACY_EVIDENCE_PREFIX.length);
    return `${NEW_BASE_PREFIX}${suffix}`;
  }
  return trimmed;
}

function readStoredBaseDir(): string | undefined {
  try {
    const stored = window.localStorage.getItem(BASE_DIR_KEY);
    const normalized = normalizeBaseDir(stored);
    if (normalized && normalized !== stored) {
      window.localStorage.setItem(BASE_DIR_KEY, normalized);
      console.info("[Analyse][Corpus] Migrated legacy baseDir to new location", {
        from: stored,
        to: normalized
      });
    }
    return normalized || undefined;
  } catch (err) {
    console.warn("Unable to read stored base dir", err);
    return undefined;
  }
}

function persistBaseDir(path: string): void {
  try {
    const normalized = normalizeBaseDir(path) || path;
    window.localStorage.setItem(BASE_DIR_KEY, normalized);
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
