const path = require('path');
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { createPipelineBackend } = require('./backend/pipeline_backend');
const { updateElectronApp } = require('update-electron-app');

let mainWindow = null;

const backend = createPipelineBackend({
  appDir: __dirname,
  repoRoot: path.resolve(__dirname, '..', '..'),
  onProgress: (payload) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('app:pipeline-progress', payload);
  },
});

async function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1680,
    height: 1040,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  await mainWindow.loadFile(path.join(__dirname, 'renderer.html'));
}

ipcMain.handle('app:get-defaults', async () => {
  await backend.ensurePipelineFileList();
  if (!backend.getActiveReportPath()) backend.setActiveReportPath(backend.defaultInputPath());
  return {
    inputPath: backend.getActiveReportPath(),
    outHtmlPath: backend.defaultOutPath(),
  };
});

ipcMain.handle('app:get-report-data', async (_event, reportPath = '') => backend.readReportJson(reportPath));

ipcMain.handle('app:save-report-data', async (_event, nextData, reportPath = '') => {
  if (!nextData || typeof nextData !== 'object' || Array.isArray(nextData)) {
    throw new Error('Invalid report payload: expected JSON object');
  }
  return backend.writeReportJson(nextData, reportPath);
});

ipcMain.handle('app:build-viewer', async (_event, inputPath = '', outPathArg = '') => {
  const selectedInput = path.resolve(inputPath || backend.getActiveReportPath() || backend.defaultInputPath());
  const outPath = path.resolve(outPathArg || backend.defaultOutPath());
  const result = await backend.runViewerBuild(selectedInput, outPath);
  backend.setActiveReportPath(selectedInput);
  return {
    inputPath: selectedInput,
    outHtmlPath: result.outPath,
    stderr: result.stderr,
    stdout: result.stdout,
  };
});

ipcMain.handle('app:build-aggregate-viewer', async (_event, reportPaths = [], outPathArg = '') => {
  const outPath = path.resolve(outPathArg || backend.defaultAggregateOutPath());
  const result = await backend.runAggregateViewerBuild(Array.isArray(reportPaths) ? reportPaths : [], outPath);
  return {
    outHtmlPath: result.outPath,
    inputs: result.inputs || [],
    skipped: result.skipped || [],
    stderr: result.stderr,
    stdout: result.stdout,
  };
});

ipcMain.handle('app:build-portfolio-summary', async () => {
  return backend.buildPortfolioSummary();
});

ipcMain.handle('app:get-file-list', async () => backend.getFileList());

ipcMain.handle('app:add-pdf-files', async () => {
  const res = await dialog.showOpenDialog({
    title: 'Select PDF files',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'PDF Documents', extensions: ['pdf'] }],
  });
  if (res.canceled || !Array.isArray(res.filePaths) || res.filePaths.length === 0) {
    return backend.getFileList().then((x) => ({ added: 0, files: x.files }));
  }
  return backend.addPdfPaths(res.filePaths);
});

ipcMain.handle('app:bootstrap-reports', async (_event, options = {}) => {
  return backend.bootstrapReports(options && typeof options === 'object' ? options : {});
});

ipcMain.handle('app:run-pipeline-for-pdf', async (_event, pdfPath, runId = '') => {
  if (!pdfPath || typeof pdfPath !== 'string') {
    throw new Error('Missing PDF path');
  }
  try {
    return await backend.runPipelineForPdf(pdfPath, runId);
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    if (runId) {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      mainWindow.webContents.send('app:pipeline-progress', {
        runId,
        ts: backend.isoNow(),
        event: 'pipeline_failed',
        stageId: 'runtime',
        pdfPath,
        message,
      });
    }
    await backend.updatePipelineFileEntry(pdfPath, {
      lastRunAt: backend.isoNow(),
      lastStatus: 'FAIL',
    });
    throw err;
  }
});

ipcMain.handle('app:rescore-report', async (_event, reportPath = '') => {
  return backend.rescoreReport(reportPath);
});

app.whenReady().then(createMainWindow);
updateElectronApp();

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
