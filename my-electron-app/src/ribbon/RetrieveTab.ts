import type { RibbonTab } from "../types";

export const RetrieveTab: RibbonTab = {
  phase: "retrieve",
  label: "Retrieve",
  description: "Shape search queries, collect records, and import new files.",
  actions: [
    {
      id: "retrieve-query-builder",
      label: "Query Builder",
      hint: "Launch a shell to compose keywords, filters, and sources.",
      iconId: "retrieve-query",
      group: "Search",
      command: { phase: "retrieve", action: "open_query_builder" },
      opensPanel: true,
      panel: {
        title: "Query Builder",
        description: "Build or edit queries before sending them to a source."
      }
    },
    {
      id: "retrieve-fetch-source",
      label: "Fetch from Source",
      hint: "Pull the latest results for the active query.",
      iconId: "retrieve-fetch",
      group: "Search",
      command: { phase: "retrieve", action: "fetch_from_source" }
    },
    {
      id: "retrieve-import-file",
      label: "Import File",
      hint: "Bring in a PDF or dataset for screening.",
      iconId: "retrieve-import",
      group: "Import",
      command: { phase: "retrieve", action: "import_file" }
    }
  ]
};
