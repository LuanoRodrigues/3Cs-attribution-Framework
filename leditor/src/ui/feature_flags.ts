export type FeatureFlags = {
  ribbonEnabled: boolean;
  aiTabEnabled: boolean;
  mailMergeEnabled: boolean;
  trackChangesEnabled: boolean;
  paginationEnabled: boolean;
  paginationIncrementalEnabled: boolean;
  paginationDebugOverlayEnabled: boolean;
  paginationDebugEnabled: boolean;
};

export const featureFlags: FeatureFlags = {
  ribbonEnabled: true,
  aiTabEnabled: false,
  mailMergeEnabled: false,
  trackChangesEnabled: false,
  paginationEnabled: true,
  paginationIncrementalEnabled: true,
  paginationDebugOverlayEnabled: false,
  paginationDebugEnabled: false
};
