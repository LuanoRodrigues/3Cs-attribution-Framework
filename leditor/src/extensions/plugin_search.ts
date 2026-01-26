import { registerPlugin } from "../legacy/api/plugin_registry.js";
import { searchExtension } from "../legacy/editor/search.js";
import { createSearchPanel } from "../legacy/ui/search_panel.js";
import {
  nextMatch,
  prevMatch,
  replaceAll,
  replaceCurrent,
  setQuery
} from "../editor/search.js";

let panelController: ReturnType<typeof createSearchPanel> | null = null;

const ensurePanel = (editorHandle: Parameters<typeof createSearchPanel>[0]) => {
  if (!panelController) {
    panelController = createSearchPanel(editorHandle);
  }
  return panelController;
};

registerPlugin({
  id: "search",
  tiptapExtensions: [searchExtension],
  commands: {
    SearchReplace(editorHandle) {
      const panel = ensurePanel(editorHandle);
      panel.toggle();
    },
    SearchNext() {
      nextMatch();
    },
    SearchPrev() {
      prevMatch();
    },
    ReplaceCurrent(_editorHandle, args) {
      const replacement = typeof args?.replacement === "string" ? args.replacement : "";
      replaceCurrent(replacement);
    },
    ReplaceAll(_editorHandle, args) {
      const query = typeof args?.query === "string" ? args.query : "";
      const replacement = typeof args?.replacement === "string" ? args.replacement : "";
      replaceAll(query, replacement);
    },
    SetSearchQuery(_editorHandle, args) {
      const query = typeof args?.query === "string" ? args.query : "";
      setQuery(query);
    }
  },
  onInit(editorHandle) {
    ensurePanel(editorHandle);
  }
});
