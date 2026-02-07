import Heading from "@tiptap/extension-heading";

export const HeadingWithToc = Heading.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      tocId: {
        default: null,
        parseHTML: (element) =>
          element instanceof HTMLElement ? element.getAttribute("data-toc-id") : null,
        renderHTML: (attrs) => (attrs?.tocId ? { "data-toc-id": attrs.tocId } : {})
      },
      tocExclude: {
        default: false,
        parseHTML: (element) =>
          element instanceof HTMLElement && element.getAttribute("data-toc-exclude") === "true",
        renderHTML: (attrs) => (attrs?.tocExclude ? { "data-toc-exclude": "true" } : {})
      }
    };
  }
});
