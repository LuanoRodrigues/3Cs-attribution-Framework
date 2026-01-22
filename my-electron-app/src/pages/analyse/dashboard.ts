import type { AnalysePageContext, AnalyseRun, AnalyseState } from "../../analyse/types";
import { buildDatasetHandles, discoverRuns, summariseRun, getDefaultBaseDir } from "../../analyse/data";

export function renderDashboardPage(container: HTMLElement, state: AnalyseState, ctx?: AnalysePageContext): void {
  container.innerHTML = "";
  let viewState: AnalyseState = { ...state };

  const setState = (patch: Partial<AnalyseState>) => {
    viewState = { ...viewState, ...patch };
    ctx?.updateState(patch);
  };

  const header = document.createElement("div");
  header.style.display = "flex";
  header.style.alignItems = "center";
  header.style.gap = "12px";
  const title = document.createElement("h2");
  title.textContent = "Dashboard";
  header.appendChild(title);
  const baseBadge = document.createElement("span");
  baseBadge.className = "status-bar";
  baseBadge.style.fontSize = "12px";
  baseBadge.style.padding = "4px 8px";
  baseBadge.style.borderRadius = "8px";
  baseBadge.textContent = viewState.baseDir ? `Base: ${viewState.baseDir}` : "Base not set";
  header.appendChild(baseBadge);
  container.appendChild(header);

  const description = document.createElement("p");
  description.textContent = "Discover thematic runs and set the active run for Analyse (Corpus/Rounds).";
  container.appendChild(description);

  const actions = document.createElement("div");
  actions.className = "control-row";
  const runSelect = document.createElement("select");
  runSelect.style.minWidth = "280px";
  const rescanBtn = document.createElement("button");
  rescanBtn.className = "ribbon-button";
  rescanBtn.textContent = "Rescan runs";
  rescanBtn.disabled = !ctx;
  actions.appendChild(runSelect);
  actions.appendChild(rescanBtn);
  container.appendChild(actions);

  const grid = document.createElement("div");
  grid.style.display = "grid";
  grid.style.gridTemplateColumns = "repeat(auto-fit, minmax(200px, 1fr))";
  grid.style.gap = "12px";
  container.appendChild(grid);

  const status = document.createElement("div");
  status.className = "status-bar";
  container.appendChild(status);

  const renderMetrics = async () => {
    grid.innerHTML = "";
    const activeRun = viewState.runs.find((r) => r.id === viewState.activeRunId);
    const metrics = viewState.activeRunPath
      ? await summariseRun(viewState.activeRunPath)
      : { batches: 0, sectionsR1: 0, sectionsR2: 0, sectionsR3: 0 };

    const metricCards: { label: string; value: string }[] = [
      { label: "Active run", value: activeRun?.label || "None" },
      { label: "Batches", value: String(metrics.batches) },
      { label: "Sections R1", value: String(metrics.sectionsR1) },
      { label: "Sections R2", value: String(metrics.sectionsR2) },
      { label: "Sections R3", value: String(metrics.sectionsR3) }
    ];

    metricCards.forEach(({ label, value }) => {
      const card = document.createElement("div");
      card.className = "viz-card";
      const t = document.createElement("h5");
      t.textContent = label;
      const v = document.createElement("div");
      v.textContent = value;
      v.style.fontSize = "20px";
      v.style.fontWeight = "600";
      card.appendChild(t);
      card.appendChild(v);
      grid.appendChild(card);
    });
  };

  const renderRuns = (runs: AnalyseRun[]) => {
    runSelect.innerHTML = "";
    if (!runs.length) {
      const opt = document.createElement("option");
      opt.textContent = "No runs discovered";
      opt.disabled = true;
      opt.selected = true;
      runSelect.appendChild(opt);
      status.textContent = "0 runs";
      return;
    }
    runs.forEach((run) => {
      const bits: string[] = [];
      if (run.hasBatches) bits.push("batches");
      if (run.hasSections) bits.push("r1");
      if (run.hasL2) bits.push("r2");
      if (run.hasL3) bits.push("r3");
      const opt = document.createElement("option");
      opt.value = run.id;
      opt.textContent = `${run.label} (${bits.join(" · ") || "no data"})`;
      opt.selected = run.id === viewState.activeRunId;
      runSelect.appendChild(opt);
    });
    status.textContent = `${runs.length} run(s) available`;
  };

  const refreshRuns = async () => {
    status.textContent = "Scanning runs...";
    try {
      const base = viewState.baseDir && viewState.baseDir.trim() ? viewState.baseDir : await getDefaultBaseDir();
      if (base && base !== viewState.baseDir) {
        setState({ baseDir: base });
        baseBadge.textContent = `Base: ${base}`;
      }
      const { runs, sectionsRoot } = await discoverRuns(base);
      console.info("[analyse][dashboard][rescan]", { baseDir: base, sectionsRoot, runCount: runs.length });
      setState({ runs, sectionsRoot: sectionsRoot || undefined });
      renderRuns(runs);
      if (!viewState.activeRunId && runs[0]) {
        const first = runs[0];
        const datasets = await buildDatasetHandles(first.path);
        console.info("[analyse][dashboard][set-active]", { runId: first.id, runPath: first.path, datasets });
        setState({
          activeRunId: first.id,
          activeRunPath: first.path,
          themesDir: first.path,
          datasets
        });
        status.textContent = `Active run set to ${first.label}`;
      } else {
        status.textContent = `${runs.length} run(s) available`;
      }
      void renderMetrics();
    } catch (err) {
      console.error(err);
      status.textContent = "Unable to scan runs.";
    }
  };

  runSelect.addEventListener("change", async () => {
    const run = viewState.runs.find((r) => r.id === runSelect.value);
    if (!run) return;
    const datasets = await buildDatasetHandles(run.path);
    console.info("[analyse][dashboard][run-change]", { runId: run.id, runPath: run.path, datasets });
    setState({
      activeRunId: run.id,
      activeRunPath: run.path,
      themesDir: run.path,
      datasets
    });
    void renderMetrics();
    status.textContent = `Active run set to ${run.label}`;
  });

  rescanBtn.addEventListener("click", () => {
    void refreshRuns();
  });

  if (viewState.runs?.length) {
    renderRuns(viewState.runs);
    void renderMetrics();
  } else {
    void refreshRuns();
  }
}
