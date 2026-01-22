import { Node } from "@tiptap/core";
import type { CitationSource } from "../editor/citation_state.js";

const normalizeSources = (value: unknown): CitationSource[] => {
  if (!Array.isArray(value)) return [];
  const sources: CitationSource[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const id = typeof (item as CitationSource).id === "string" ? (item as CitationSource).id : "";
    if (!id) continue;
    sources.push({
      id,
      title: typeof (item as CitationSource).title === "string" ? (item as CitationSource).title : undefined,
      author: typeof (item as CitationSource).author === "string" ? (item as CitationSource).author : undefined,
      year: typeof (item as CitationSource).year === "string" ? (item as CitationSource).year : undefined,
      url: typeof (item as CitationSource).url === "string" ? (item as CitationSource).url : undefined,
      note: typeof (item as CitationSource).note === "string" ? (item as CitationSource).note : undefined
    });
  }
  return sources;
};

const CitationSourcesExtension = Node.create({
  name: "citation_sources",
  group: "block",
  atom: true,
  selectable: false,
  draggable: false,
  addAttributes() {
    return {
      sources: {
        default: []
      }
    };
  },
  parseHTML() {
    return [
      {
        tag: "div[data-citation-sources]",
        getAttrs: (node) => {
          if (!(node instanceof HTMLElement)) return {};
          const raw = node.getAttribute("data-sources");
          if (!raw) return {};
          try {
            const parsed = JSON.parse(raw);
            return { sources: normalizeSources(parsed) };
          } catch {
            return {};
          }
        }
      }
    ];
  },
  renderHTML({ HTMLAttributes }) {
    const sources = normalizeSources(HTMLAttributes.sources);
    return [
      "div",
      {
        "data-citation-sources": "true",
        "data-sources": JSON.stringify(sources),
        class: "leditor-citation-sources"
      },
      0
    ];
  }
});

export default CitationSourcesExtension;
