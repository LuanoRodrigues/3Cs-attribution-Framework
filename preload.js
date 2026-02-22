const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('threecApp', {
  getDefaults: () => ipcRenderer.invoke('app:get-defaults'),
  getReportData: (reportPath = '') => ipcRenderer.invoke('app:get-report-data', reportPath),
  saveReportData: (data, reportPath = '') => ipcRenderer.invoke('app:save-report-data', data, reportPath),
  buildViewer: (inputPath = '', outPath = '') => ipcRenderer.invoke('app:build-viewer', inputPath, outPath),
  buildAggregateViewer: (reportPaths = [], outPath = '') => ipcRenderer.invoke('app:build-aggregate-viewer', reportPaths, outPath),
  buildPortfolioSummary: () => ipcRenderer.invoke('app:build-portfolio-summary'),
  getFileList: () => ipcRenderer.invoke('app:get-file-list'),
  addPdfFiles: () => ipcRenderer.invoke('app:add-pdf-files'),
  bootstrapReports: (options = {}) => ipcRenderer.invoke('app:bootstrap-reports', options),
  runPipelineForPdf: (pdfPath, runId = '') => ipcRenderer.invoke('app:run-pipeline-for-pdf', pdfPath, runId),
  rescoreReport: (reportPath = '') => ipcRenderer.invoke('app:rescore-report', reportPath),
  onPipelineProgress: (cb) => {
    if (typeof cb !== 'function') {
      throw new Error('onPipelineProgress requires a callback');
    }
    const handler = (_event, payload) => cb(payload);
    ipcRenderer.on('app:pipeline-progress', handler);
    return () => ipcRenderer.removeListener('app:pipeline-progress', handler);
  },
});
