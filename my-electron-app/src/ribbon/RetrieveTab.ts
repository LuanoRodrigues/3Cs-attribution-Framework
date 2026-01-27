import type { RibbonTab } from "../types";

export const RetrieveTab: RibbonTab = {
  phase: "retrieve",
  label: "Retrieve",
  description: "Shape search queries, collect records, and import new files.",
  actions: [
    {
      id: "retrieve-search",
      label: "Search",
      hint: "Open the query builder to search academic databases.",
      iconId: "retrieve-fetch",
      group: "Academic Databases",
      command: { phase: "retrieve", action: "open_query_builder" },
      opensPanel: true,
      panel: {
        title: "Academic Search",
        description: "Search academic databases and collect records."
      }
    },
    {
      id: "retrieve-load-zotero",
      label: "Zotero",
      hint: "Load records from Zotero.",
      iconId: "retrieve-import",
      group: "Data Loader",
      command: { phase: "retrieve", action: "datahub_load_zotero" }
    },
    {
      id: "retrieve-load-local",
      label: "Local",
      hint: "Load a local CSV or Excel file.",
      iconId: "retrieve-import",
      group: "Data Loader",
      command: { phase: "retrieve", action: "datahub_load_file" }
    },
    {
      id: "retrieve-load-excel",
      label: "Excel",
      hint: "Load an Excel file from disk.",
      iconId: "retrieve-import",
      group: "Data Loader",
      command: { phase: "retrieve", action: "datahub_load_excel" }
    }
  ]
};
