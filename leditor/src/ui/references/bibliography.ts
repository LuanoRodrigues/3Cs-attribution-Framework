import type { Editor } from "@tiptap/core";
import { getHostContract } from "../host_contract.ts";
import {
  ensureReferencesLibrary,
  getReferencesLibraryPath,
  getReferencesLibrarySync,
  type ReferenceItem
} from "./library.ts";

const USED_KEYS_STORAGE_KEY = "leditor.references.usedKeys";

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

export const ensureBibliographyNode = (editor: Editor): void => {
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
  editor
    .chain()
    .focus()
    .insertContentAt(editor.state.doc.content.size, { type: "bibliography", attrs: { bibId } })
    .run();
};

export const writeUsedBibliography = async (keys: string[]): Promise<void> => {
  try {
    window.localStorage?.setItem(USED_KEYS_STORAGE_KEY, JSON.stringify(keys));
  } catch {
    // Ignore storage errors.
  }
  const host = window.leditorHost;
  const contract = getHostContract();
  if (!host?.writeFile || !contract?.policy?.allowDiskWrites) return;
  const path = getLibraryPath(contract).replace(/\.json$/i, ".used.json");
  await host.writeFile({ targetPath: path, data: JSON.stringify(keys, null, 2) });
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
