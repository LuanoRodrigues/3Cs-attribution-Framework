const { contextBridge, ipcRenderer } = require("electron");
const VOICE_IPC_CHANNELS = {
  getSession: "zotero:voice-session",
  setVoiceMode: "zotero:voice-mode:set",
  setDictation: "zotero:dictation:set",
  runCommand: "zotero:voice-command",
  eventModeDelta: "zotero:voice-mode-delta"
};

contextBridge.exposeInMainWorld("zoteroBridge", {
  getProfile: () => ipcRenderer.invoke("zotero:get-profile"),
  getTree: (payload) => ipcRenderer.invoke("zotero:get-tree", payload || {}),
  getItems: (payload) => ipcRenderer.invoke("zotero:get-items", payload || {}),
  getItemChildren: (payload) => ipcRenderer.invoke("zotero:get-item-children", payload || {}),
  runAgentCommand: (payload) => ipcRenderer.invoke("zotero:agent-run", payload || {}),
  resolveIntent: (payload) => ipcRenderer.invoke("zotero:intent-resolve", payload || {}),
  executeIntent: (payload) => ipcRenderer.invoke("zotero:intent-execute", payload || {}),
  refineCodingQuestions: (payload) => ipcRenderer.invoke("zotero:refine-coding-questions", payload || {}),
  generateEligibilityCriteria: (payload) => ipcRenderer.invoke("zotero:generate-eligibility-criteria", payload || {}),
  getVoiceSession: () => ipcRenderer.invoke(VOICE_IPC_CHANNELS.getSession),
  setVoiceMode: (payload) => ipcRenderer.invoke(VOICE_IPC_CHANNELS.setVoiceMode, payload || {}),
  setDictation: (payload) => ipcRenderer.invoke(VOICE_IPC_CHANNELS.setDictation, payload || {}),
  runVoiceCommand: (payload) => ipcRenderer.invoke(VOICE_IPC_CHANNELS.runCommand, payload || {}),
  advancedSearch: (payload) => ipcRenderer.invoke("zotero:advanced-search", payload || {}),
  getTagFacets: (payload) => ipcRenderer.invoke("zotero:get-tag-facets", payload || {}),
  getItemsByTags: (payload) => ipcRenderer.invoke("zotero:get-items-by-tags", payload || {}),
  getFeatureInventory: () => ipcRenderer.invoke("zotero:get-feature-inventory"),
  runFeature: (payload) => ipcRenderer.invoke("zotero:run-feature", payload || {}),
  enqueueFeatureJob: (payload) => ipcRenderer.invoke("zotero:enqueue-feature-job", payload || {}),
  cancelFeatureJob: (payload) => ipcRenderer.invoke("zotero:cancel-feature-job", payload || {}),
  getFeatureJobs: (payload) => ipcRenderer.invoke("zotero:get-feature-jobs", payload || {}),
  getBatchExplorer: (payload) => ipcRenderer.invoke("zotero:get-batch-explorer", payload || {}),
  getBatchDetail: (payload) => ipcRenderer.invoke("zotero:get-batch-detail", payload || {}),
  deleteBatch: (payload) => ipcRenderer.invoke("zotero:delete-batch", payload || {}),
  clearWorkflowBatchJobs: (payload) => ipcRenderer.invoke("zotero:clear-workflow-batch-jobs", payload || {}),
  getFeatureHealthCheck: () => ipcRenderer.invoke("zotero:feature-health-check"),
  getIntentStats: () => ipcRenderer.invoke("zotero:get-intent-stats"),
  getSavedSearches: () => ipcRenderer.invoke("zotero:get-saved-searches"),
  saveSavedSearch: (payload) => ipcRenderer.invoke("zotero:save-saved-search", payload || {}),
  deleteSavedSearch: (payload) => ipcRenderer.invoke("zotero:delete-saved-search", payload || {}),
  syncNow: () => ipcRenderer.invoke("zotero:sync-now"),
  getSyncStatus: () => ipcRenderer.invoke("zotero:get-sync-status"),
  openReader: (payload) => ipcRenderer.invoke("zotero:open-reader", payload || {}),
  emitMenuCommand: (payload) => ipcRenderer.invoke("zotero:emit-menu-command", payload || {}),
  openExternal: (payload) => ipcRenderer.invoke("zotero:open-external", payload || {}),
  updateItemMetadata: (payload) => ipcRenderer.invoke("zotero:update-item-metadata", payload || {}),
  clearCache: () => ipcRenderer.invoke("zotero:clear-cache"),
  onMenuCommand: (cb) => {
    const handler = (_ev, payload) => cb(payload || {});
    ipcRenderer.on("app:menu-command", handler);
    return () => ipcRenderer.removeListener("app:menu-command", handler);
  },
  onSyncStatus: (cb) => {
    const handler = (_ev, payload) => cb(payload || {});
    ipcRenderer.on("zotero:sync-status", handler);
    return () => ipcRenderer.removeListener("zotero:sync-status", handler);
  },
  onVoiceModeDelta: (cb) => {
    const handler = (_ev, payload) => cb(payload || {});
    ipcRenderer.on(VOICE_IPC_CHANNELS.eventModeDelta, handler);
    return () => ipcRenderer.removeListener(VOICE_IPC_CHANNELS.eventModeDelta, handler);
  },
  onFeatureJobStatus: (cb) => {
    const handler = (_ev, payload) => cb(payload || {});
    ipcRenderer.on("zotero:feature-job-status", handler);
    return () => ipcRenderer.removeListener("zotero:feature-job-status", handler);
  }
});
