export interface DataHubTable {
  columns: string[];
  rows: Array<Array<unknown>>;
}

export interface DataHubLoadResult {
  table?: DataHubTable;
  message?: string;
  cached?: boolean;
  source?: {
    type: "zotero" | "file";
    name?: string;
    path?: string;
    collectionName?: string;
  };
}

export interface DataHubCollection {
  key: string;
  name: string;
  parentKey?: string | null;
}
