(() => {
  const repoBase = '/3Cs-attribution-Framework/';
  const resolveUrl = (p) => {
    const clean = String(p || '').replace(/^\.\//, '');
    return `${repoBase}${clean}`;
  };

  const state = {
    pipeline: null,
    reports: new Map(),
    portfolio: null,
  };

  async function loadPipeline() {
    if (state.pipeline) return state.pipeline;
    const res = await fetch(resolveUrl('data/pipeline_files.json'), { cache: 'no-store' });
    if (!res.ok) throw new Error('Failed to load pipeline files');
    state.pipeline = await res.json();
    return state.pipeline;
  }

  async function loadPortfolio() {
    if (state.portfolio) return state.portfolio;
    const res = await fetch(resolveUrl('data/portfolio_summary.json'), { cache: 'no-store' });
    if (!res.ok) return null;
    state.portfolio = await res.json();
    return state.portfolio;
  }

  async function loadReport(reportPath) {
    const key = String(reportPath || '').trim();
    if (!key) throw new Error('Missing reportPath');
    if (state.reports.has(key)) return state.reports.get(key);
    const res = await fetch(resolveUrl(key), { cache: 'no-store' });
    if (!res.ok) throw new Error('Failed to load report: ' + key);
    const data = await res.json();
    state.reports.set(key, data);
    return data;
  }

  function findFileByReportPath(reportPath) {
    const files = (state.pipeline && state.pipeline.files) || [];
    return files.find((f) => String(f.reportPath) === String(reportPath)) || null;
  }

  window.threecApp = {
    async getDefaults() {
      const p = await loadPipeline();
      const first = (p.files || [])[0] || {};
      return {
        inputPath: first.reportPath || '',
        outHtmlPath: 'reports_results/aggregate_threec_viewer.html',
      };
    },

    async getReportData(reportPath = '') {
      const p = await loadPipeline();
      const first = (p.files || [])[0] || {};
      const selected = String(reportPath || first.reportPath || '');
      const data = await loadReport(selected);
      return { path: selected, data };
    },

    async saveReportData(data, reportPath = '') {
      const key = String(reportPath || '').trim();
      if (!key) throw new Error('Missing reportPath');
      state.reports.set(key, data);
      return { path: key, persisted: false, message: 'Web mode: save is in-memory only.' };
    },

    async buildViewer(inputPath = '', _outPath = '') {
      await loadPipeline();
      const file = findFileByReportPath(inputPath);
      return {
        inputPath,
        outHtmlPath: file ? file.webOutHtmlPath : 'reports_results/aggregate_threec_viewer.html',
        stderr: '',
        stdout: 'web-static',
      };
    },

    async buildAggregateViewer(_reportPaths = [], _outPath = '') {
      await loadPipeline();
      return {
        outHtmlPath: 'reports_results/aggregate_threec_viewer.html',
        inputs: _reportPaths,
        skipped: [],
        stderr: '',
        stdout: 'web-static',
      };
    },

    async buildPortfolioSummary() {
      const data = await loadPortfolio();
      return { data };
    },

    async buildMethodology(_options = {}) {
      return {
        outputPath: 'web-mode',
        data: {
          html: '<div class="primitive">Methodology generation is desktop-only in web mode.</div>',
          sections: [],
        },
      };
    },

    async getFileList() {
      const p = await loadPipeline();
      return p;
    },

    async addPdfFiles() {
      return { added: 0, files: ((state.pipeline && state.pipeline.files) || []) };
    },

    async bootstrapReports(_options = {}) {
      const p = await loadPipeline();
      return {
        discoveredPdfCount: (p.files || []).length,
        missingBeforeRun: 0,
        ran: 0,
        runs: [],
        batchMode: false,
      };
    },

    async runPipelineForPdf() {
      throw new Error('Pipeline run is desktop-only. Use the Electron app for this action.');
    },

    async rescoreReport() {
      throw new Error('Rescore is desktop-only. Use the Electron app for this action.');
    },

    onPipelineProgress() {
      return () => {};
    },
  };
})();
