import sanitizeHtml from "sanitize-html";
import { registerPlugin } from "../api/plugin_registry.ts";
import type { EditorHandle } from "../api/leditor.ts";

export const SANITIZE_OPTIONS = {
  allowedTags: [
    "p",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "blockquote",
    "b",
    "strong",
    "i",
    "em",
    "u",
    "s",
    "ul",
    "ol",
    "li",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
    "div",
    "br",
    "span",
    "img",
    "sup",
    "sub"
  ],
  allowedAttributes: {
    td: ["colspan", "rowspan"],
    th: ["colspan", "rowspan"],
    table: ["border"],
    img: ["src", "alt", "width", "height"],
    span: ["style"],
    p: ["style"],
    div: ["style"]
  },
  allowedStyles: {
    "*": {
      color: [/^#?[\da-f]+$/i],
      "text-align": [/^(left|right|center|justify)$/],
      "font-weight": [/^[\w\s]+$/],
      "font-style": [/^[\w\s]+$/],
      "text-decoration": [/^[\w\s]+$/],
      "background-color": [/^#?[\da-f]+$/i],
      "font-size": [/^\d+(?:px|pt|em|rem|%)$/]
    }
  }
} as const;

const readClipboardHTML = async (): Promise<string | null> => {
  if (typeof navigator === "undefined" || !navigator.clipboard?.read) {
    return null;
  }
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      if (!item.types.includes("text/html")) continue;
      const blob = await item.getType("text/html");
      return await blob.text();
    }
  } catch (error) {
    window.codexLog?.write(`[PASTE_CLEAN] clipboard read failed: ${error}`);
    return null;
  }
  return null;
};

const readClipboardText = async (): Promise<string | null> => {
  if (typeof navigator === "undefined" || !navigator.clipboard?.readText) {
    return null;
  }
  try {
    const text = await navigator.clipboard.readText();
    return text;
  } catch (error) {
    window.codexLog?.write(`[PASTE_CLEAN] clipboard text failed: ${error}`);
    return null;
  }
};

const insertContent = (editorHandle: EditorHandle, html: string): void => {
  const editor = editorHandle.getEditor();
  editor.chain().focus().insertContent(html).run();
  editorHandle.focus();
};

const sanitizeInput = (html: string): string => {
  const sanitized = sanitizeHtml(html, SANITIZE_OPTIONS).trim();
  if (!sanitized) return "";
  return sanitized;
};

registerPlugin({
  id: "paste_cleaner",
  commands: {
    PasteClean(editorHandle: EditorHandle, args?: { html?: string }) {
      const run = async () => {
        const htmlSource =
          typeof args?.html === "string" && args.html.trim() ? args.html : await readClipboardHTML();
        if (htmlSource) {
          const sanitized = sanitizeInput(htmlSource);
          if (sanitized) {
            insertContent(editorHandle, sanitized);
            window.codexLog?.write(`[PASTE_CLEAN] inserted html ${sanitized.length} chars`);
            return;
          }
        }
        const fallbackText = await readClipboardText();
        if (fallbackText) {
          insertContent(editorHandle, fallbackText);
          window.codexLog?.write("[PASTE_CLEAN] inserted plain text fallback");
        }
      };
      void run().catch((error) => window.codexLog?.write(`[PASTE_CLEAN] error ${error}`));
    }
  }
});

export type PasteCleanerOptions = typeof SANITIZE_OPTIONS;
