import { ensureReferencesLibrary, getReferencesLibrarySync, refreshReferencesLibrary, type ReferenceItem } from "./library.ts";
import refPickerHtml from "./ref_picker.html";

export type CitationPickerResult = {
  itemKeys: string[];
  items?: Array<{
    itemKey: string;
    locator?: string | null;
    label?: string | null;
    prefix?: string | null;
    suffix?: string | null;
    suppressAuthor?: boolean;
    authorOnly?: boolean;
  }>;
  options: {
    prefix?: string | null;
    locator?: string | null;
    label?: string | null;
    suffix?: string | null;
    suppressAuthor?: boolean;
    authorOnly?: boolean;
  };
  templateId?: string;
};

type CitationPickerArgs = {
  mode: "insert" | "edit";
  preselectItemKeys?: string[];
  activeCitationId?: string | null;
  styleId?: string | null;
};

type PickerBridge = {
  getRefIndexJson?: (cb: (payload: string) => void) => void;
  getPreselectItemKeysJson?: (cb: (payload: string) => void) => void;
  insertCitationJson?: (payload: string) => void;
  insertBibliography?: () => void;
  updateFromEditor?: (cb?: (msg: string) => void) => void;
  closeDialog?: () => void;
  saveBibliographyStoreJson?: (payload: string) => void;
  setBibliographyStyle?: (style: string) => void;
  getBibliographyStyle?: (cb: (style: string) => void) => void;
};

type PickerPayloadItem = {
  item_key?: string;
  locator?: string;
  label?: string;
  prefix?: string;
  suffix?: string;
  omit_author?: boolean;
};

const ALLOWED_STYLES = new Set(["apa", "numeric", "footnote"]);

const normalizeStyle = (value: string | null | undefined): string => {
  const trimmed = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (ALLOWED_STYLES.has(trimmed)) return trimmed;
  return "apa";
};

const buildPickerRows = (items: Record<string, ReferenceItem>): Array<Record<string, string>> => {
  return Object.values(items).map((item) => ({
    item_key: item.itemKey,
    author_summary: item.author ?? "",
    first_author_last: item.author ?? "",
    title: item.title ?? "",
    year: item.year ?? "",
    source: item.url ?? "",
    dqid: item.dqid ?? ""
  }));
};

const injectBridgeScript = (html: string): string => {
  const injection = `
<script>
  (function(){
    var bridge = window.parent && window.parent.__refPickerBridge;
    if (bridge) {
      window.__pickerBridge = bridge;
      window.qt = window.qt || { webChannelTransport: {} };
      if (typeof window.QWebChannel !== "function") {
        window.QWebChannel = function(_, cb) {
          cb({ objects: { pyBridge: bridge } });
        };
      }
    }
  })();
</script>
`;
  if (html.includes("</head>")) {
    return html.replace("</head>", `${injection}</head>`);
  }
  return `${injection}${html}`;
};

const parsePickerPayload = (payload: string): CitationPickerResult | null => {
  try {
    const parsed = JSON.parse(payload || "{}") as { items?: PickerPayloadItem[] };
    const items = Array.isArray(parsed.items) ? parsed.items : [];
    const normalizedItems = items
      .map((item) => {
        const itemKey = typeof item.item_key === "string" ? item.item_key.trim() : "";
        if (!itemKey) return null;
        return {
          itemKey,
          locator: typeof item.locator === "string" && item.locator.trim() ? item.locator.trim() : null,
          label: typeof item.label === "string" && item.label.trim() ? item.label.trim() : null,
          prefix: typeof item.prefix === "string" ? item.prefix : null,
          suffix: typeof item.suffix === "string" ? item.suffix : null,
          suppressAuthor: Boolean(item.omit_author)
        };
      })
      .filter(Boolean) as Array<{
      itemKey: string;
      locator?: string | null;
      label?: string | null;
      prefix?: string | null;
      suffix?: string | null;
      suppressAuthor?: boolean;
      authorOnly?: boolean;
    }>;
    const itemKeys = normalizedItems.map((item) => item.itemKey);
    if (!itemKeys.length) return null;
    return {
      itemKeys,
      items: normalizedItems,
      options: {}
    };
  } catch (error) {
    console.error("[References] picker payload parse failed", error);
    return null;
  }
};

export const openCitationPicker = async (args: CitationPickerArgs): Promise<CitationPickerResult | null> => {
  await ensureReferencesLibrary();
  await refreshReferencesLibrary();
  const library = getReferencesLibrarySync();
  const rows = buildPickerRows(library.itemsByKey);
  const preselect = Array.isArray(args.preselectItemKeys) ? args.preselectItemKeys : [];
  let currentStyle = normalizeStyle(args.styleId);

  return new Promise((resolve) => {
    let resolved = false;

    const overlay = document.createElement("div");
    overlay.className = "leditor-references-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Citation picker");
    overlay.setAttribute("aria-hidden", "true");
    overlay.tabIndex = -1;

    const modal = document.createElement("div");
    modal.className = "leditor-references-modal";
    const frame = document.createElement("iframe");
    frame.className = "leditor-references-frame";
    frame.setAttribute("title", "Citation picker");
    modal.appendChild(frame);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const cleanup = () => {
      overlay.removeEventListener("click", onOverlayClick);
      window.removeEventListener("keydown", onKeydown, true);
      overlay.remove();
      if ((window as any).__refPickerBridge === bridge) {
        delete (window as any).__refPickerBridge;
      }
    };

    const finalize = (result: CitationPickerResult | null) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(result);
    };

    const bridge: PickerBridge = {
      getRefIndexJson: (cb) => cb(JSON.stringify(rows)),
      getPreselectItemKeysJson: (cb) => cb(JSON.stringify(preselect)),
      insertCitationJson: (payload) => {
        finalize(parsePickerPayload(payload));
      },
      insertBibliography: () => {
        finalize({ itemKeys: [], options: {}, templateId: "bibliography" });
      },
      updateFromEditor: (cb) => {
        if (cb) cb("Updated");
        finalize({ itemKeys: [], options: {}, templateId: "update" });
      },
      closeDialog: () => finalize(null),
      saveBibliographyStoreJson: () => undefined,
      setBibliographyStyle: (style) => {
        currentStyle = normalizeStyle(style);
        window.leditor?.execCommand("SetCitationStyle", { style: currentStyle });
      },
      getBibliographyStyle: (cb) => cb(currentStyle)
    };

    (window as any).__refPickerBridge = bridge;
    frame.srcdoc = injectBridgeScript(refPickerHtml);

    const onOverlayClick = (event: MouseEvent) => {
      if (event.target === overlay) {
        finalize(null);
      }
    };

    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        finalize(null);
      }
    };

    overlay.addEventListener("click", onOverlayClick);
    window.addEventListener("keydown", onKeydown, true);

    overlay.classList.add("is-open");
    overlay.setAttribute("aria-hidden", "false");
  });
};
