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
      command: { phase: "retrieve", action: "retrieve_open_query_builder" }
    },
    {
      id: "retrieve-set-provider",
      label: "Provider",
      hint: "Choose which academic database provider to use.",
      iconId: "retrieve-fetch",
      group: "Academic Databases",
      command: { phase: "retrieve", action: "retrieve_set_provider" }
    },
    {
      id: "retrieve-set-sort",
      label: "Sort",
      hint: "Set the default sort for academic searches.",
      iconId: "retrieve-fetch",
      group: "Academic Databases",
      command: { phase: "retrieve", action: "retrieve_set_sort" }
    },
    {
      id: "retrieve-set-years",
      label: "Years",
      hint: "Set the default year range filter.",
      iconId: "retrieve-fetch",
      group: "Academic Databases",
      command: { phase: "retrieve", action: "retrieve_set_year_range" }
    },
    {
      id: "retrieve-set-limit",
      label: "Limit",
      hint: "Set the default result limit.",
      iconId: "retrieve-fetch",
      group: "Academic Databases",
      command: { phase: "retrieve", action: "retrieve_set_limit" }
    },
    {
      id: "retrieve-load-zotero",
      label: "Zotero",
      hint: "Open the Zotero workspace.",
      iconId: "retrieve-import",
      group: "Zotero Loader",
      command: { phase: "retrieve", action: "datahub_load_zotero" }
    },
    {
      id: "retrieve-open-batches",
      label: "Batches",
      hint: "Open corpus batches.",
      iconId: "retrieve-import",
      group: "Zotero Loader",
      command: { phase: "retrieve", action: "datahub_open_batches" }
    },
    {
      id: "retrieve-open-code",
      label: "Code",
      hint: "Open the Code workspace.",
      iconId: "retrieve-import",
      group: "Zotero Loader",
      command: { phase: "retrieve", action: "datahub_open_code" }
    },
    {
      id: "retrieve-open-screen",
      label: "Screen",
      hint: "Open the Screen workspace.",
      iconId: "retrieve-import",
      group: "Zotero Loader",
      command: { phase: "retrieve", action: "datahub_open_screen" }
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
      id: "retrieve-export-csv",
      label: "Export CSV",
      hint: "Export the current DataHub table to CSV.",
      iconId: "retrieve-import",
      group: "Export",
      command: { phase: "retrieve", action: "datahub_export_csv" }
    },
    {
      id: "retrieve-export-excel",
      label: "Export Excel",
      hint: "Export the current DataHub table to Excel.",
      iconId: "retrieve-import",
      group: "Export",
      command: { phase: "retrieve", action: "datahub_export_excel" }
    },
    {
      id: "retrieve-resolve-na",
      label: "Resolve NA",
      hint: "Fill missing values in the DataHub table.",
      iconId: "retrieve-import",
      group: "Tidying Data",
      command: { phase: "retrieve", action: "datahub_resolve_na" }
    },
    {
      id: "retrieve-flag-na",
      label: "Flag NA",
      hint: "Highlight missing values in the DataHub table.",
      iconId: "retrieve-import",
      group: "Tidying Data",
      command: { phase: "retrieve", action: "datahub_flag_na" }
    },
    {
      id: "retrieve-apply-codebook",
      label: "Apply Codebook",
      hint: "Filter the DataHub table down to a codebook column set.",
      iconId: "retrieve-import",
      group: "Tidying Data",
      command: { phase: "retrieve", action: "datahub_codebook" }
    },
    {
      id: "retrieve-apply-coding-columns",
      label: "Apply Coding",
      hint: "Filter the DataHub table down to coding columns.",
      iconId: "retrieve-import",
      group: "Tidying Data",
      command: { phase: "retrieve", action: "datahub_codes" }
    }
  ]
};
