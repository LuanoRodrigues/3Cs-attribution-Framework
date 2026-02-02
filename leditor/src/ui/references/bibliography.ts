import type { Editor } from "@tiptap/core";
import { getHostContract } from "../host_contract.ts";
import {
  ensureReferencesLibrary,
  getReferencesLibraryPath,
  getReferencesLibrarySync,
  type ReferenceItem
} from "./library.ts";
import { writeCitedWorksKeys, readCitedWorksKeys } from "./cited_works.ts";

const buildBibtexEntry = (item: ReferenceItem): string => {
  const sanitize = (value?: string) => (value ? value.replace(/[{}]/g, "").trim() : "");
  const fields: string[] = [];
  const title = sanitize(item.title);
  const author = sanitize(item.author);
  const year = sanitize(item.year);
  const url = sanitize(item.url);
  if (title) fields.push(`  title = {${title}}`);
  if (author) fields.push(`  author = {${author}}`);
  if (year) fields.push(`  year = {${year}}`);
  if (url) fields.push(`  url = {${url}}`);
  const body = fields.join(",\n");
  return `@misc{${item.itemKey},\n${body}\n}`;
};

const buildBibliographyListHtml = (items: ReferenceItem[]): string => {
  if (!items.length) return "";
  const escape = (value: string) =>
    value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const rows = items.map((item) => {
    const label = item.title || item.author || item.itemKey;
    return `<li data-item-key="${escape(item.itemKey)}">${escape(label)}</li>`;
  });
  return `<ol class="leditor-bibliography-list">${rows.join("")}</ol>`;
};

export const getLibraryPath = (contract = getHostContract()): string =>
  getReferencesLibraryPath(contract);

export const insertBibliographyField = (editor: Editor): void => {
  const bibliographyNode = editor.schema.nodes.bibliography;
  if (!bibliographyNode) {
    throw new Error("Bibliography node is not registered in schema");
  }
  const bibId = `bib-${Date.now().toString(36)}`;
  editor.chain().focus().insertContent({ type: "bibliography", attrs: { bibId } }).run();
};

export const ensureBibliographyNode = (
  editor: Editor,
  opts?: { headingText?: string }
): void => {
  const bibliographyNode = editor.schema.nodes.bibliography;
  if (!bibliographyNode) {
    throw new Error("Bibliography node is not registered in schema");
  }
  let found = false;
  editor.state.doc.descendants((node) => {
    if (node.type === bibliographyNode) {
      found = true;
      return false;
    }
    return true;
  });
  if (found) return;
  const bibId = `bib-${Date.now().toString(36)}`;
  const headingText = typeof opts?.headingText === "string" ? opts.headingText.trim() : "References";

  const content: any[] = [];
  // Force the bibliography to start on a fresh page so the heading isn't stranded.
  // Use a normal page_break node (which the layout engine respects), but hide it via CSS
  // when it's our internal bibliography break.
  if (editor.schema.nodes.page_break) {
    content.push({ type: "page_break", attrs: { kind: "page", sectionId: "bibliography" } });
  }
  if (headingText && editor.schema.nodes.heading) {
    content.push({ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: headingText }] });
  }
  // Bibliography is a container node (block+). Seed it with a paragraph so it's always valid.
  content.push({ type: "bibliography", attrs: { bibId }, content: [{ type: "paragraph" }] });
  const doc = editor.state.doc;
  const nodeType = bibliographyNode;
  const findInsertPos = (): number => {
    // Prefer inserting at the end of the last page so we never violate the
    // doc → page → block hierarchy. The page node's content ends at
    // pos + node.nodeSize - 1.
    if (doc.childCount > 0) {
      const lastPageNode = doc.child(doc.childCount - 1);
      if (lastPageNode?.type?.name === "page") {
        let lastPagePos = 0;
        for (let i = 0; i < doc.childCount - 1; i += 1) {
          lastPagePos += doc.child(i).nodeSize;
        }
        const endOfPageContent = lastPagePos + lastPageNode.nodeSize - 1;
        return endOfPageContent;
      }
    }
    // Fallback: scan backwards for any parent that accepts the bibliography.
    for (let pos = doc.content.size - 2; pos >= 0; pos -= 1) {
      const $pos = doc.resolve(pos);
      if ($pos.parent?.canReplaceWith?.($pos.index(), $pos.index(), nodeType)) {
        return pos;
      }
    }
    return doc.content.size - 2;
  };
  const insertPos = findInsertPos();
  editor.chain().focus().insertContentAt(insertPos, content, { updateSelection: false }).run();
};

export const writeUsedBibliography = async (keys: string[]): Promise<void> => {
  await writeCitedWorksKeys(keys);
};

export const readUsedBibliography = async (): Promise<string[]> => {
  return readCitedWorksKeys();
};

export const exportBibliographyJson = async (): Promise<void> => {
  const library = await ensureReferencesLibrary();
  const payload = JSON.stringify(
    { updatedAt: library.updatedAt, items: Object.values(library.itemsByKey) },
    null,
    2
  );
  const host = window.leditorHost;
  const contract = getHostContract();
  if (host?.writeFile && contract?.policy?.allowDiskWrites) {
    await host.writeFile({ targetPath: getLibraryPath(contract), data: payload });
    return;
  }
  const blob = new Blob([payload], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "bibliography.json";
  link.click();
  URL.revokeObjectURL(link.href);
};

export const exportBibliographyBibtex = async (): Promise<void> => {
  const library = getReferencesLibrarySync();
  const items = Object.values(library.itemsByKey);
  const payload = items.map(buildBibtexEntry).join("\n\n");
  const host = window.leditorHost;
  const contract = getHostContract();
  if (host?.writeFile && contract?.policy?.allowDiskWrites) {
    const path = getLibraryPath(contract).replace(/\.json$/i, ".bib");
    await host.writeFile({ targetPath: path, data: payload });
    return;
  }
  const blob = new Blob([payload], { type: "text/plain" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "bibliography.bib";
  link.click();
  URL.revokeObjectURL(link.href);
};

export const buildBibliographyHtmlFromKeys = async (keys: string[]): Promise<string> => {
  const library = await ensureReferencesLibrary();
  const items = keys
    .map((key) => library.itemsByKey[key])
    .filter(Boolean) as ReferenceItem[];
  return buildBibliographyListHtml(items);
};
