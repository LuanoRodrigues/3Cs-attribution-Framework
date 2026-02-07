import { createRibbonIcon } from "./ribbon_icons.ts";
import {
  getRecentReferenceItems,
  getReferencesLibrarySync,
  type ReferenceItem,
  refreshReferencesLibrary
} from "./references/library.ts";

const OVERLAY_ID = "leditor-ribbon-dialog-overlay";
const TOAST_ID = "leditor-ribbon-toast";

const THEME_COLORS = [
  ["#000000", "#1e1e1e", "#595959", "#7f7f7f", "#a5a5a5"],
  ["#ffffff", "#f2f2f2", "#d9d9d9", "#bfbfbf", "#a5a5a5"],
  ["#1f4e79", "#2b579a", "#3f6fb5", "#8eaadb", "#d9e2f3"],
  ["#2e7d32", "#548235", "#70ad47", "#a8d08d", "#c6e0b4"],
  ["#7f6000", "#bf9000", "#ffc000", "#ffd966", "#fff2cc"],
  ["#7030a0", "#8e44ad", "#b576d2", "#d9b8f1", "#f2e5fb"]
];

const STANDARD_COLORS = [
  "#c00000",
  "#ff0000",
  "#ffc000",
  "#ffff00",
  "#92d050",
  "#00b050",
  "#00b0f0",
  "#0070c0",
  "#002060",
  "#7030a0"
];

const RECENT_LIMIT = 10;

const getStorageKey = (key: string) => `leditor.recentColors.${key}`;

export const getRecentColors = (key: string): string[] => {
  try {
    const raw = window.localStorage?.getItem(getStorageKey(key));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value) => typeof value === "string" && value.trim());
  } catch {
    return [];
  }
};

export const pushRecentColor = (key: string, color: string): void => {
  if (!color) return;
  const normalized = color.trim();
  if (!normalized) return;
  const list = getRecentColors(key).filter((value) => value.toLowerCase() !== normalized.toLowerCase());
  list.unshift(normalized);
  const next = list.slice(0, RECENT_LIMIT);
  try {
    window.localStorage?.setItem(getStorageKey(key), JSON.stringify(next));
  } catch {
    // ignore storage errors
  }
};

const createOverlay = (): HTMLDivElement => {
  const existing = document.getElementById(OVERLAY_ID) as HTMLDivElement | null;
  if (existing) return existing;
  const overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  overlay.className = "leditor-ribbon-dialog-overlay";
  overlay.setAttribute("role", "presentation");
  document.body.appendChild(overlay);
  return overlay;
};

const openDialogShell = (title: string) => {
  const overlay = createOverlay();
  overlay.textContent = "";
  const dialog = document.createElement("div");
  dialog.className = "leditor-ribbon-dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.tabIndex = -1;

  const header = document.createElement("div");
  header.className = "leditor-ribbon-dialog__header";
  const heading = document.createElement("div");
  heading.className = "leditor-ribbon-dialog__title";
  heading.textContent = title;
  const headingId = `leditor-dialog-${Math.random().toString(36).slice(2, 9)}`;
  heading.id = headingId;
  dialog.setAttribute("aria-labelledby", headingId);
  const close = document.createElement("button");
  close.type = "button";
  close.className = "leditor-ribbon-dialog__close";
  close.setAttribute("aria-label", "Close dialog");
  close.appendChild(createRibbonIcon("close"));
  header.append(heading, close);

  const body = document.createElement("div");
  body.className = "leditor-ribbon-dialog__body";

  const footer = document.createElement("div");
  footer.className = "leditor-ribbon-dialog__footer";

  dialog.append(header, body, footer);
  overlay.appendChild(dialog);

  const focusFirst = () => {
    const focusable = dialog.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length > 0) {
      focusable[0].focus();
      return;
    }
    dialog.focus();
  };

  const handleKeydown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeDialog();
      return;
    }
    if (event.key === "Tab") {
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => !el.hasAttribute("disabled") && el.getAttribute("aria-hidden") !== "true");
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
        return;
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  };

  const closeDialog = () => {
    dialog.removeEventListener("keydown", handleKeydown);
    overlay.textContent = "";
  };
  close.addEventListener("click", closeDialog);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) closeDialog();
  });
  dialog.addEventListener("keydown", handleKeydown);
  window.requestAnimationFrame(focusFirst);

  return { overlay, dialog, body, footer, closeDialog };
};

const createSwatchGrid = (
  colors: string[],
  onPick: (color: string) => void
): HTMLDivElement => {
  const grid = document.createElement("div");
  grid.className = "leditor-ribbon-dialog__swatches";
  colors.forEach((color) => {
    const swatch = document.createElement("button");
    swatch.type = "button";
    swatch.className = "leditor-ribbon-dialog__swatch";
    swatch.style.background = color;
    swatch.setAttribute("aria-label", color);
    swatch.addEventListener("click", () => onPick(color));
    grid.appendChild(swatch);
  });
  return grid;
};

const appendSection = (parent: HTMLElement, title: string): HTMLDivElement => {
  const section = document.createElement("div");
  section.className = "leditor-ribbon-dialog__section";
  const label = document.createElement("div");
  label.className = "leditor-ribbon-dialog__sectionTitle";
  label.textContent = title;
  section.appendChild(label);
  parent.appendChild(section);
  return section;
};

const createFooterButton = (label: string, kind: "primary" | "ghost", onClick: () => void): HTMLButtonElement => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = kind === "primary" ? "leditor-ribbon-dialog__primary" : "leditor-ribbon-dialog__ghost";
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
};

export const openRibbonColorDialog = (options: {
  title: string;
  current?: string | null;
  allowClear?: boolean;
  recentKey: string;
  onSelect: (color: string | null) => void;
}): void => {
  const { title, current, allowClear, recentKey, onSelect } = options;
  const { body, footer, closeDialog } = openDialogShell(title);

  const handlePick = (color: string | null) => {
    if (color) {
      pushRecentColor(recentKey, color);
    }
    onSelect(color);
    closeDialog();
  };

  if (allowClear) {
    const autoBtn = document.createElement("button");
    autoBtn.type = "button";
    autoBtn.className = "leditor-ribbon-dialog__ghost";
    autoBtn.textContent = "Automatic";
    autoBtn.addEventListener("click", () => handlePick(null));
    body.appendChild(autoBtn);
  }

  const themeSection = appendSection(body, "Theme Colors");
  THEME_COLORS.forEach((row) => {
    themeSection.appendChild(createSwatchGrid(row, (color) => handlePick(color)));
  });

  const standardSection = appendSection(body, "Standard Colors");
  standardSection.appendChild(createSwatchGrid(STANDARD_COLORS, (color) => handlePick(color)));

  const recent = getRecentColors(recentKey);
  const recentSection = appendSection(body, "Recent Colors");
  if (recent.length) {
    recentSection.appendChild(createSwatchGrid(recent, (color) => handlePick(color)));
  } else {
    const empty = document.createElement("div");
    empty.className = "leditor-ribbon-dialog__empty";
    empty.textContent = "No recent colors.";
    recentSection.appendChild(empty);
  }

  const customSection = appendSection(body, "Custom");
  const customRow = document.createElement("div");
  customRow.className = "leditor-ribbon-dialog__row";
  const colorInput = document.createElement("input");
  colorInput.type = "color";
  colorInput.value = current ?? "#1e1e1e";
  const textInput = document.createElement("input");
  textInput.type = "text";
  textInput.value = current ?? "";
  textInput.placeholder = "#rrggbb or rgb()";
  customRow.append(colorInput, textInput);
  customSection.appendChild(customRow);

  const applyCustom = document.createElement("button");
  applyCustom.type = "button";
  applyCustom.className = "leditor-ribbon-dialog__primary";
  applyCustom.textContent = "Apply";
  applyCustom.addEventListener("click", () => {
    const value = (textInput.value || colorInput.value).trim();
    if (!value) return;
    handlePick(value);
  });
  footer.appendChild(applyCustom);

  colorInput.addEventListener("input", () => {
    textInput.value = colorInput.value;
  });
};

export const openParagraphSpacingDialog = (options: {
  currentLineHeight?: string | null;
  spaceBefore?: number;
  spaceAfter?: number;
  onApply: (payload: { lineHeight?: string; spaceBefore?: number; spaceAfter?: number }) => void;
}): void => {
  const { body, footer, closeDialog } = openDialogShell("Paragraph Spacing");

  const row = document.createElement("div");
  row.className = "leditor-ribbon-dialog__grid";

  const lineLabel = document.createElement("label");
  lineLabel.textContent = "Line spacing";
  const lineInput = document.createElement("input");
  lineInput.type = "text";
  lineInput.placeholder = "1, 1.15, 1.5, 2";
  lineInput.value = options.currentLineHeight ?? "";
  lineLabel.appendChild(lineInput);

  const beforeLabel = document.createElement("label");
  beforeLabel.textContent = "Space before (px)";
  const beforeInput = document.createElement("input");
  beforeInput.type = "number";
  beforeInput.step = "1";
  if (typeof options.spaceBefore === "number") {
    beforeInput.value = String(options.spaceBefore);
  }
  beforeLabel.appendChild(beforeInput);

  const afterLabel = document.createElement("label");
  afterLabel.textContent = "Space after (px)";
  const afterInput = document.createElement("input");
  afterInput.type = "number";
  afterInput.step = "1";
  if (typeof options.spaceAfter === "number") {
    afterInput.value = String(options.spaceAfter);
  }
  afterLabel.appendChild(afterInput);

  row.append(lineLabel, beforeLabel, afterLabel);
  body.appendChild(row);

  const applyBtn = document.createElement("button");
  applyBtn.type = "button";
  applyBtn.className = "leditor-ribbon-dialog__primary";
  applyBtn.textContent = "Apply";
  applyBtn.addEventListener("click", () => {
    const payload: { lineHeight?: string; spaceBefore?: number; spaceAfter?: number } = {};
    if (lineInput.value.trim()) payload.lineHeight = lineInput.value.trim();
    if (beforeInput.value.trim()) payload.spaceBefore = Number(beforeInput.value);
    if (afterInput.value.trim()) payload.spaceAfter = Number(afterInput.value);
    options.onApply(payload);
    closeDialog();
  });
  footer.appendChild(applyBtn);
};

export const openBordersDialog = (options: {
  preset?: string | null;
  color?: string | null;
  width?: number | null;
  onApply: (payload: { preset: string; color?: string | null; width?: number | null }) => void;
}): void => {
  const { body, footer, closeDialog } = openDialogShell("Borders and Shading");

  const presets = [
    { id: "none", label: "None" },
    { id: "all", label: "All" },
    { id: "outside", label: "Outside" },
    { id: "inside", label: "Inside" },
    { id: "top", label: "Top" },
    { id: "bottom", label: "Bottom" },
    { id: "left", label: "Left" },
    { id: "right", label: "Right" }
  ];

  const grid = document.createElement("div");
  grid.className = "leditor-ribbon-dialog__presetGrid";
  let selected = options.preset ?? "none";
  presets.forEach((preset) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "leditor-ribbon-dialog__preset";
    btn.dataset.borderPreset = preset.id;
    btn.textContent = preset.label;
    if (preset.id === selected) btn.classList.add("is-selected");
    btn.addEventListener("click", () => {
      selected = preset.id;
      grid.querySelectorAll(".leditor-ribbon-dialog__preset").forEach((el) => el.classList.remove("is-selected"));
      btn.classList.add("is-selected");
    });
    grid.appendChild(btn);
  });
  body.appendChild(grid);

  const controls = document.createElement("div");
  controls.className = "leditor-ribbon-dialog__grid";
  const colorLabel = document.createElement("label");
  colorLabel.textContent = "Color";
  const colorInput = document.createElement("input");
  colorInput.type = "color";
  colorInput.value = options.color ?? "#1e1e1e";
  colorLabel.appendChild(colorInput);

  const widthLabel = document.createElement("label");
  widthLabel.textContent = "Width (px)";
  const widthInput = document.createElement("input");
  widthInput.type = "number";
  widthInput.min = "1";
  widthInput.max = "8";
  widthInput.step = "1";
  if (typeof options.width === "number") {
    widthInput.value = String(options.width);
  } else {
    widthInput.value = "1";
  }
  widthLabel.appendChild(widthInput);

  controls.append(colorLabel, widthLabel);
  body.appendChild(controls);

  const applyBtn = document.createElement("button");
  applyBtn.type = "button";
  applyBtn.className = "leditor-ribbon-dialog__primary";
  applyBtn.textContent = "Apply";
  applyBtn.addEventListener("click", () => {
    const widthValue = Number(widthInput.value);
    options.onApply({
      preset: selected,
      color: colorInput.value,
      width: Number.isFinite(widthValue) ? widthValue : null
    });
    closeDialog();
  });
  footer.appendChild(applyBtn);
};

export const openLinkDialog = (options: {
  title: string;
  current?: string | null;
  allowClear?: boolean;
  onApply: (href: string | null) => void;
}): void => {
  const { body, footer, closeDialog } = openDialogShell(options.title);

  const urlLabel = document.createElement("label");
  urlLabel.textContent = "URL";
  const urlInput = document.createElement("input");
  urlInput.type = "text";
  urlInput.placeholder = "https://example.com";
  urlInput.value = options.current ?? "";
  urlLabel.appendChild(urlInput);
  body.appendChild(urlLabel);

  const hint = document.createElement("div");
  hint.className = "leditor-ribbon-dialog__hint";
  hint.textContent = "Paste or type a full URL.";
  body.appendChild(hint);

  const applyBtn = createFooterButton("Apply", "primary", () => {
    const value = urlInput.value.trim();
    options.onApply(value ? value : null);
    closeDialog();
  });

  footer.appendChild(applyBtn);
  if (options.allowClear) {
    footer.prepend(
      createFooterButton("Remove Link", "ghost", () => {
        options.onApply(null);
        closeDialog();
      })
    );
  }
};

export const openCopyLinkDialog = (options: { href: string }): void => {
  const { body, footer, closeDialog } = openDialogShell("Copy Link");

  const row = document.createElement("div");
  row.className = "leditor-ribbon-dialog__row";
  const input = document.createElement("input");
  input.type = "text";
  input.value = options.href;
  input.readOnly = true;
  input.className = "leditor-ribbon-dialog__mono";
  row.appendChild(input);
  body.appendChild(row);

  const hint = document.createElement("div");
  hint.className = "leditor-ribbon-dialog__hint";
  hint.textContent = "Copy the link from the field above.";
  body.appendChild(hint);

  const copyBtn = createFooterButton("Copy", "primary", () => {
    const attempt = navigator.clipboard?.writeText ? navigator.clipboard.writeText(options.href) : Promise.reject();
    void attempt
      .then(() => showRibbonToast("Link copied."))
      .catch(() => {
        showRibbonToast("Press Ctrl+C to copy.");
        input.focus();
        input.select();
      });
  });
  footer.appendChild(copyBtn);
  footer.appendChild(createFooterButton("Close", "ghost", closeDialog));

  input.focus();
  input.select();
};

export const openBookmarkManagerDialog = (options: {
  bookmarks: Array<{ id: string; label?: string | null }>;
  onDelete: (id: string) => void;
}): void => {
  const { body, footer, closeDialog } = openDialogShell("Manage Bookmarks");

  if (!options.bookmarks.length) {
    const empty = document.createElement("div");
    empty.className = "leditor-ribbon-dialog__empty";
    empty.textContent = "No bookmarks found.";
    body.appendChild(empty);
  } else {
    const list = document.createElement("div");
    list.className = "leditor-ribbon-dialog__list";
    options.bookmarks.forEach((bookmark) => {
      const row = document.createElement("div");
      row.className = "leditor-ribbon-dialog__listRow";

      const meta = document.createElement("div");
      meta.className = "leditor-ribbon-dialog__listMeta";
      const title = document.createElement("div");
      title.className = "leditor-ribbon-dialog__listTitle";
      title.textContent = bookmark.label?.trim() || "Untitled";
      const subtitle = document.createElement("div");
      subtitle.className = "leditor-ribbon-dialog__listSubtitle";
      subtitle.textContent = bookmark.id;
      meta.append(title, subtitle);

      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "leditor-ribbon-dialog__danger";
      deleteBtn.textContent = "Delete";
      deleteBtn.addEventListener("click", () => {
        options.onDelete(bookmark.id);
        row.remove();
        if (!list.querySelector(".leditor-ribbon-dialog__listRow")) {
          const empty = document.createElement("div");
          empty.className = "leditor-ribbon-dialog__empty";
          empty.textContent = "No bookmarks found.";
          body.appendChild(empty);
        }
      });

      row.append(meta, deleteBtn);
      list.appendChild(row);
    });
    body.appendChild(list);
  }

  footer.appendChild(createFooterButton("Close", "ghost", closeDialog));
};

export const openEquationDialog = (options: {
  mode: "inline" | "display";
  onApply: (value: string) => void;
}): void => {
  const title = options.mode === "display" ? "Insert Display Equation" : "Insert Inline Equation";
  const { body, footer, closeDialog } = openDialogShell(title);

  const label = document.createElement("label");
  label.textContent = "LaTeX";
  const textarea = document.createElement("textarea");
  textarea.rows = options.mode === "display" ? 5 : 3;
  textarea.placeholder = "e.g. E = mc^2";
  label.appendChild(textarea);
  body.appendChild(label);

  const applyBtn = createFooterButton("Insert", "primary", () => {
    const value = textarea.value.trim();
    if (!value) return;
    options.onApply(value);
    closeDialog();
  });
  footer.appendChild(applyBtn);
};

export const openSymbolDialog = (options: { onApply: (codepoint: number) => void }): void => {
  const { body, footer, closeDialog } = openDialogShell("Insert Symbol");

  const label = document.createElement("label");
  label.textContent = "Hex codepoint";
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "e.g. 00A9";
  label.appendChild(input);
  body.appendChild(label);

  const preview = document.createElement("div");
  preview.className = "leditor-ribbon-dialog__preview";
  preview.textContent = "—";
  body.appendChild(preview);

  const error = document.createElement("div");
  error.className = "leditor-ribbon-dialog__error";
  body.appendChild(error);

  const updatePreview = (): void => {
    const value = input.value.trim();
    if (!value) {
      preview.textContent = "—";
      error.textContent = "";
      return;
    }
    const parsed = Number.parseInt(value, 16);
    if (!Number.isFinite(parsed)) {
      preview.textContent = "—";
      error.textContent = "Invalid hex code.";
      return;
    }
    error.textContent = "";
    preview.textContent = String.fromCodePoint(parsed);
  };

  input.addEventListener("input", updatePreview);

  const applyBtn = createFooterButton("Insert", "primary", () => {
    const value = input.value.trim();
    const parsed = Number.parseInt(value, 16);
    if (!Number.isFinite(parsed)) {
      error.textContent = "Invalid hex code.";
      return;
    }
    options.onApply(parsed);
    closeDialog();
  });
  footer.appendChild(applyBtn);
};

export const openColumnsDialog = (options: {
  currentCount: number;
  currentGapIn?: number | null;
  currentWidthIn?: number | null;
  contentWidthIn?: number | null;
  scope?: "document" | "section";
  onApply: (payload: { count: number; gapIn?: number | null; widthIn?: number | null; scope: "document" | "section" }) => void;
}): void => {
  const { body, footer, closeDialog } = openDialogShell("Columns");
  const contentWidthIn = typeof options.contentWidthIn === "number" && Number.isFinite(options.contentWidthIn)
    ? options.contentWidthIn
    : null;

  const countLabel = document.createElement("label");
  countLabel.textContent = "Number of columns";
  const countInput = document.createElement("input");
  countInput.type = "number";
  countInput.min = "1";
  countInput.max = "4";
  countInput.step = "1";
  countInput.value = String(Math.max(1, Math.min(4, Math.floor(options.currentCount || 1))));
  countLabel.appendChild(countInput);

  const gapLabel = document.createElement("label");
  gapLabel.textContent = "Spacing (in)";
  const gapInput = document.createElement("input");
  gapInput.type = "number";
  gapInput.min = "0";
  gapInput.step = "0.05";
  gapLabel.appendChild(gapInput);

  const widthLabel = document.createElement("label");
  widthLabel.textContent = "Column width (in)";
  const widthInput = document.createElement("input");
  widthInput.type = "number";
  widthInput.min = "0.1";
  widthInput.step = "0.05";
  widthLabel.appendChild(widthInput);

  const grid = document.createElement("div");
  grid.className = "leditor-ribbon-dialog__grid";
  grid.append(countLabel, gapLabel, widthLabel);
  body.appendChild(grid);

  const preview = document.createElement("div");
  preview.className = "leditor-columns-preview";
  preview.setAttribute("aria-label", "Column layout preview");
  body.appendChild(preview);

  const hint = document.createElement("div");
  hint.className = "leditor-ribbon-dialog__hint";
  hint.textContent = contentWidthIn
    ? `Content width: ${contentWidthIn.toFixed(2)} in`
    : "Content width unavailable; values will be used as provided.";
  body.appendChild(hint);

  const applyTo = document.createElement("div");
  applyTo.className = "leditor-ribbon-dialog__row";
  const scopeLabel = document.createElement("div");
  scopeLabel.className = "leditor-ribbon-dialog__sectionTitle";
  scopeLabel.textContent = "Apply to";
  const scopeGroup = document.createElement("div");
  scopeGroup.className = "leditor-ribbon-dialog__row";

  const scopeDocument = document.createElement("label");
  scopeDocument.className = "leditor-ribbon-dialog__radio";
  const scopeDocumentInput = document.createElement("input");
  scopeDocumentInput.type = "radio";
  scopeDocumentInput.name = "columnsScope";
  scopeDocumentInput.value = "document";
  const scopeSection = document.createElement("label");
  scopeSection.className = "leditor-ribbon-dialog__radio";
  const scopeSectionInput = document.createElement("input");
  scopeSectionInput.type = "radio";
  scopeSectionInput.name = "columnsScope";
  scopeSectionInput.value = "section";
  scopeDocument.append(scopeDocumentInput, document.createTextNode("Whole document"));
  scopeSection.append(scopeSectionInput, document.createTextNode("This section"));
  scopeGroup.append(scopeDocument, scopeSection);
  applyTo.append(scopeLabel, scopeGroup);
  body.appendChild(applyTo);

  const error = document.createElement("div");
  error.className = "leditor-ribbon-dialog__error";
  body.appendChild(error);

  const applyBtn = createFooterButton("Apply", "primary", () => {
    const count = Math.max(1, Math.min(4, Math.floor(Number(countInput.value) || 1)));
    const gapRaw = gapInput.value.trim();
    const widthRaw = widthInput.value.trim();
    const gapParsed = gapRaw ? Number(gapRaw) : null;
    const widthParsed = widthRaw ? Number(widthRaw) : null;
    const gapIn = gapParsed != null && Number.isFinite(gapParsed) ? gapParsed : null;
    const widthIn = widthParsed != null && Number.isFinite(widthParsed) ? widthParsed : null;
    const scope = scopeSectionInput.checked ? "section" : "document";
    options.onApply({
      count,
      gapIn: gapIn != null ? gapIn : null,
      widthIn: widthIn != null ? widthIn : null,
      scope
    });
    closeDialog();
  });
  footer.appendChild(applyBtn);

  const recomputeFromGap = (count: number, gapIn: number | null): number | null => {
    if (!contentWidthIn || count <= 0) return null;
    if (count === 1) return contentWidthIn;
    if (gapIn == null) return null;
    const available = contentWidthIn - gapIn * (count - 1);
    return available > 0 ? available / count : null;
  };

  const recomputeFromWidth = (count: number, widthIn: number | null): number | null => {
    if (!contentWidthIn || count <= 1) return count <= 1 ? 0 : null;
    if (widthIn == null) return null;
    const available = contentWidthIn - widthIn * count;
    return available > 0 ? available / (count - 1) : null;
  };

  let lastEdited: "gap" | "width" | "count" | null = null;
  const updatePreview = (count: number, gapIn: number | null) => {
    const previewGap = gapIn != null && Number.isFinite(gapIn) ? Math.max(0, gapIn) : 0.25;
    preview.style.setProperty("--columns", String(count));
    preview.style.setProperty("--gap", `${Math.max(4, Math.round(previewGap * 18))}px`);
    preview.textContent = "";
    for (let i = 0; i < count; i += 1) {
      const col = document.createElement("span");
      col.className = "leditor-columns-preview__col";
      preview.appendChild(col);
    }
  };
  const syncValues = (): void => {
    const count = Math.max(1, Math.min(4, Math.floor(Number(countInput.value) || 1)));
    const gapRaw = Number(gapInput.value);
    const widthRaw = Number(widthInput.value);
    const gapIn = Number.isFinite(gapRaw) ? gapRaw : null;
    const widthIn = Number.isFinite(widthRaw) ? widthRaw : null;
    error.textContent = "";
    applyBtn.disabled = false;
    updatePreview(count, gapIn);

    if (!contentWidthIn) {
      return;
    }

    if (count <= 1) {
      gapInput.value = "0.00";
      widthInput.value = contentWidthIn.toFixed(2);
      return;
    }

    if (lastEdited === "width") {
      const nextGap = recomputeFromWidth(count, widthIn);
      if (nextGap == null) {
        error.textContent = "Column width is too large for the available space.";
        applyBtn.disabled = true;
        return;
      }
      gapInput.value = nextGap.toFixed(2);
      return;
    }

    const nextWidth = recomputeFromGap(count, gapIn ?? 0);
    if (nextWidth == null) {
      error.textContent = "Column spacing is too large for the available space.";
      applyBtn.disabled = true;
      return;
    }
    widthInput.value = nextWidth.toFixed(2);
  };

  const initialGap =
    typeof options.currentGapIn === "number" && Number.isFinite(options.currentGapIn)
      ? options.currentGapIn
      : 0.25;
  gapInput.value = initialGap.toFixed(2);
  const initialWidth =
    typeof options.currentWidthIn === "number" && Number.isFinite(options.currentWidthIn)
      ? options.currentWidthIn
      : recomputeFromGap(Number(countInput.value), initialGap);
  if (initialWidth != null) {
    widthInput.value = initialWidth.toFixed(2);
  }
  scopeDocumentInput.checked = options.scope !== "section";
  scopeSectionInput.checked = options.scope === "section";

  countInput.addEventListener("input", () => {
    lastEdited = "count";
    syncValues();
  });
  gapInput.addEventListener("input", () => {
    lastEdited = "gap";
    syncValues();
  });
  widthInput.addEventListener("input", () => {
    lastEdited = "width";
    syncValues();
  });
  syncValues();
};

export const openSingleInputDialog = (options: {
  title: string;
  label: string;
  value?: string | null;
  placeholder?: string;
  hint?: string;
  multiline?: boolean;
  primaryLabel?: string;
  onApply: (value: string) => void;
}): void => {
  const { body, footer, closeDialog } = openDialogShell(options.title);

  const label = document.createElement("label");
  label.textContent = options.label;
  const input = options.multiline ? document.createElement("textarea") : document.createElement("input");
  if (input instanceof HTMLTextAreaElement) {
    input.rows = 5;
    input.placeholder = options.placeholder ?? "";
    input.value = options.value ?? "";
  } else {
    input.type = "text";
    input.placeholder = options.placeholder ?? "";
    input.value = options.value ?? "";
  }
  label.appendChild(input);
  body.appendChild(label);

  if (options.hint) {
    const hint = document.createElement("div");
    hint.className = "leditor-ribbon-dialog__hint";
    hint.textContent = options.hint;
    body.appendChild(hint);
  }

  const applyBtn = createFooterButton(options.primaryLabel ?? "Apply", "primary", () => {
    const value = input.value.trim();
    if (!value) return;
    options.onApply(value);
    closeDialog();
  });
  footer.appendChild(applyBtn);
};

export const openAddSourceDialog = (options: {
  onApply: (payload: { itemKey: string; title?: string; author?: string; year?: string; url?: string; note?: string }) => void;
}): void => {
  const { body, footer, closeDialog } = openDialogShell("Add New Source");

  const grid = document.createElement("div");
  grid.className = "leditor-ribbon-dialog__grid";

  const createField = (labelText: string, placeholder = "", value = "") => {
    const label = document.createElement("label");
    label.textContent = labelText;
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = placeholder;
    input.value = value;
    label.appendChild(input);
    return { label, input };
  };

  const itemKeyField = createField("Item key", "8-char key (e.g. ABCD1234)");
  const titleField = createField("Title");
  const authorField = createField("Author");
  const yearField = createField("Year");
  const urlField = createField("URL", "https://example.com");
  const noteField = createField("Note");

  grid.append(
    itemKeyField.label,
    titleField.label,
    authorField.label,
    yearField.label,
    urlField.label,
    noteField.label
  );
  body.appendChild(grid);

  const hint = document.createElement("div");
  hint.className = "leditor-ribbon-dialog__hint";
  hint.textContent = "Item key is required; it will be normalized automatically.";
  body.appendChild(hint);

  const applyBtn = createFooterButton("Add Source", "primary", () => {
    const itemKey = itemKeyField.input.value.trim();
    if (!itemKey) return;
    options.onApply({
      itemKey,
      title: titleField.input.value.trim() || undefined,
      author: authorField.input.value.trim() || undefined,
      year: yearField.input.value.trim() || undefined,
      url: urlField.input.value.trim() || undefined,
      note: noteField.input.value.trim() || undefined
    });
    closeDialog();
  });
  footer.appendChild(applyBtn);
};

export const openFileImportDialog = (options: {
  title: string;
  accept: string;
  hint?: string;
  maxSizeMb?: number;
  onLoad: (file: File, text: string) => void;
}): void => {
  const { body, footer, closeDialog } = openDialogShell(options.title);

  const inputRow = document.createElement("div");
  inputRow.className = "leditor-ribbon-dialog__row";
  const input = document.createElement("input");
  input.type = "file";
  input.accept = options.accept;
  input.className = "leditor-ribbon-dialog__file";
  inputRow.appendChild(input);
  body.appendChild(inputRow);

  if (options.hint) {
    const hint = document.createElement("div");
    hint.className = "leditor-ribbon-dialog__hint";
    hint.textContent = options.hint;
    body.appendChild(hint);
  }

  const error = document.createElement("div");
  error.className = "leditor-ribbon-dialog__error";
  body.appendChild(error);

  const applyBtn = createFooterButton("Import", "primary", () => {
    const file = input.files?.[0];
    if (!file) return;
    const maxSizeMb = typeof options.maxSizeMb === "number" ? options.maxSizeMb : 8;
    const maxBytes = maxSizeMb * 1024 * 1024;
    if (file.size > maxBytes) {
      error.textContent = `File is too large. Limit is ${maxSizeMb} MB.`;
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      options.onLoad(file, String(reader.result ?? ""));
      closeDialog();
    };
    reader.readAsText(file);
  });
  footer.appendChild(applyBtn);
};

export const openCslManageDialog = (options: {
  styles: string[];
  onDelete: (name: string) => void;
}): void => {
  const { body, footer, closeDialog } = openDialogShell("Manage CSL Styles");

  if (options.styles.length === 0) {
    const empty = document.createElement("div");
    empty.className = "leditor-ribbon-dialog__empty";
    empty.textContent = "No imported CSL styles.";
    body.appendChild(empty);
  } else {
    const list = document.createElement("div");
    list.className = "leditor-ribbon-dialog__list";
    options.styles.forEach((name) => {
      const row = document.createElement("div");
      row.className = "leditor-ribbon-dialog__listRow";
      const title = document.createElement("div");
      title.className = "leditor-ribbon-dialog__listTitle";
      title.textContent = name;
      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "leditor-ribbon-dialog__danger";
      deleteBtn.textContent = "Delete";
      deleteBtn.addEventListener("click", () => {
        options.onDelete(name);
        row.remove();
      });
      row.append(title, deleteBtn);
      list.appendChild(row);
    });
    body.appendChild(list);
  }

  footer.appendChild(createFooterButton("Close", "ghost", closeDialog));
};

export const openTocAddTextDialog = (options: {
  currentLevel?: number;
  onApply: (level: number) => void;
}): void => {
  const { body, footer, closeDialog } = openDialogShell("Add Text to Table of Contents");

  const row = document.createElement("div");
  row.className = "leditor-ribbon-dialog__row";
  const levels = [
    { value: 0, label: "Do not show in TOC" },
    { value: 1, label: "Level 1" },
    { value: 2, label: "Level 2" },
    { value: 3, label: "Level 3" },
    { value: 4, label: "Level 4" },
    { value: 5, label: "Level 5" },
    { value: 6, label: "Level 6" }
  ];
  const group = document.createElement("div");
  group.className = "leditor-ribbon-dialog__row";
  let selected = Number.isFinite(options.currentLevel) ? (options.currentLevel as number) : 1;
  levels.forEach((entry) => {
    const label = document.createElement("label");
    label.className = "leditor-ribbon-dialog__radio";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "tocAddTextLevel";
    input.value = String(entry.value);
    input.checked = entry.value === selected;
    input.addEventListener("change", () => {
      if (input.checked) selected = entry.value;
    });
    label.append(input, document.createTextNode(entry.label));
    group.appendChild(label);
  });
  row.appendChild(group);
  body.appendChild(row);

  const hint = document.createElement("div");
  hint.className = "leditor-ribbon-dialog__hint";
  hint.textContent = "Applies to the paragraph where your cursor is placed.";
  body.appendChild(hint);

  const applyBtn = createFooterButton("Apply", "primary", () => {
    options.onApply(selected);
    closeDialog();
  });
  footer.appendChild(applyBtn);
};

export const openTocUpdateDialog = (options: {
  onApply: (mode: "pageNumbers" | "all") => void;
}): void => {
  const { body, footer, closeDialog } = openDialogShell("Update Table of Contents");
  const hint = document.createElement("div");
  hint.className = "leditor-ribbon-dialog__hint";
  hint.textContent = "Choose what to update in the table of contents.";
  body.appendChild(hint);

  const pageBtn = createFooterButton("Page numbers only", "primary", () => {
    options.onApply("pageNumbers");
    closeDialog();
  });
  const allBtn = createFooterButton("Entire table", "ghost", () => {
    options.onApply("all");
    closeDialog();
  });
  footer.append(pageBtn, allBtn);
};

export const openToaExportDialog = (options: { onApply: (mode: "json" | "csv") => void }): void => {
  const { body, footer, closeDialog } = openDialogShell("Export Table of Authorities");
  const hint = document.createElement("div");
  hint.className = "leditor-ribbon-dialog__hint";
  hint.textContent = "Choose a file format to export.";
  body.appendChild(hint);

  const jsonBtn = createFooterButton("Export JSON", "primary", () => {
    options.onApply("json");
    closeDialog();
  });
  const csvBtn = createFooterButton("Export CSV", "ghost", () => {
    options.onApply("csv");
    closeDialog();
  });
  footer.append(jsonBtn, csvBtn);
};

export const openTextEffectsDialog = (options: {
  shadow?: string | null;
  outline?: string | null;
  onApply: (payload: { shadow?: string | null; outline?: string | null }) => void;
}): void => {
  const { body, footer, closeDialog } = openDialogShell("Text Effects");
  const shadowRow = document.createElement("label");
  shadowRow.textContent = "Text shadow";
  const shadowInput = document.createElement("input");
  shadowInput.type = "text";
  shadowInput.placeholder = "e.g. 0 1px 2px rgba(0,0,0,0.35)";
  shadowInput.value = options.shadow ?? "";
  shadowRow.appendChild(shadowInput);

  const outlineRow = document.createElement("label");
  outlineRow.textContent = "Text outline";
  const outlineInput = document.createElement("input");
  outlineInput.type = "text";
  outlineInput.placeholder = "e.g. 1px rgba(0,0,0,0.7)";
  outlineInput.value = options.outline ?? "";
  outlineRow.appendChild(outlineInput);

  body.append(shadowRow, outlineRow);

  const applyBtn = document.createElement("button");
  applyBtn.type = "button";
  applyBtn.className = "leditor-ribbon-dialog__primary";
  applyBtn.textContent = "Apply";
  applyBtn.addEventListener("click", () => {
    options.onApply({
      shadow: shadowInput.value.trim() || null,
      outline: outlineInput.value.trim() || null
    });
    closeDialog();
  });
  footer.appendChild(applyBtn);
};

export const openReferenceManagerDialog = (options: {
  onInsert: (itemKey: string) => void;
  onOpenPicker?: () => void;
  onAddSource?: () => void;
}): void => {
  const { body, footer, closeDialog } = openDialogShell("Reference Manager");

  const toolbar = document.createElement("div");
  toolbar.className = "leditor-ribbon-dialog__row";
  const searchInput = document.createElement("input");
  searchInput.type = "text";
  searchInput.placeholder = "Search sources…";
  searchInput.className = "leditor-ribbon-dialog__mono";
  toolbar.appendChild(searchInput);

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "leditor-ribbon-dialog__ghost";
  addBtn.textContent = "Add Source";
  addBtn.addEventListener("click", () => options.onAddSource?.());

  const pickerBtn = document.createElement("button");
  pickerBtn.type = "button";
  pickerBtn.className = "leditor-ribbon-dialog__ghost";
  pickerBtn.textContent = "Open Picker";
  pickerBtn.addEventListener("click", () => options.onOpenPicker?.());

  toolbar.append(addBtn, pickerBtn);
  body.appendChild(toolbar);

  const recentSection = document.createElement("div");
  recentSection.className = "leditor-ribbon-dialog__section";
  const recentTitle = document.createElement("div");
  recentTitle.className = "leditor-ribbon-dialog__sectionTitle";
  recentTitle.textContent = "Recent";
  const recentList = document.createElement("div");
  recentList.className = "leditor-ribbon-dialog__list";
  recentSection.append(recentTitle, recentList);
  body.appendChild(recentSection);

  const allSection = document.createElement("div");
  allSection.className = "leditor-ribbon-dialog__section";
  const allTitle = document.createElement("div");
  allTitle.className = "leditor-ribbon-dialog__sectionTitle";
  allTitle.textContent = "All Sources";
  const list = document.createElement("div");
  list.className = "leditor-ribbon-dialog__list";
  allSection.append(allTitle, list);
  body.appendChild(allSection);

  const renderRow = (item: ReferenceItem, container: HTMLElement) => {
    const row = document.createElement("div");
    row.className = "leditor-ribbon-dialog__listRow";
    const meta = document.createElement("div");
    meta.className = "leditor-ribbon-dialog__listMeta";
    const title = document.createElement("div");
    title.className = "leditor-ribbon-dialog__listTitle";
    title.textContent = item.itemKey;
    const subtitle = document.createElement("div");
    subtitle.className = "leditor-ribbon-dialog__listSubtitle";
    subtitle.textContent = [
      item.title ?? "",
      item.author ?? "",
      item.year ?? ""
    ]
      .filter(Boolean)
      .join(" • ") || "Untitled";
    meta.append(title, subtitle);

    const actions = document.createElement("div");
    actions.className = "leditor-ribbon-dialog__listActions";
    const insertBtn = document.createElement("button");
    insertBtn.type = "button";
    insertBtn.className = "leditor-ribbon-dialog__primary";
    insertBtn.textContent = "Insert";
    insertBtn.addEventListener("click", () => {
      options.onInsert(item.itemKey);
      closeDialog();
    });
    actions.appendChild(insertBtn);
    row.append(meta, actions);
    container.appendChild(row);
  };

  const renderLists = () => {
    const query = searchInput.value.trim().toLowerCase();
    const library = getReferencesLibrarySync();
    const items = Object.values(library.itemsByKey);
    const filtered = query
      ? items.filter((item) => {
          const hay = `${item.itemKey} ${item.title ?? ""} ${item.author ?? ""} ${item.year ?? ""}`.toLowerCase();
          return hay.includes(query);
        })
      : items;
    const recentItems = getRecentReferenceItems();

    recentList.textContent = "";
    if (!recentItems.length) {
      const empty = document.createElement("div");
      empty.className = "leditor-ribbon-dialog__empty";
      empty.textContent = "No recent sources yet.";
      recentList.appendChild(empty);
    } else {
      recentItems.forEach((item) => renderRow(item, recentList));
    }

    list.textContent = "";
    if (!filtered.length) {
      const empty = document.createElement("div");
      empty.className = "leditor-ribbon-dialog__empty";
      empty.textContent = "No sources found.";
      list.appendChild(empty);
      return;
    }
    filtered
      .sort((a, b) => a.itemKey.localeCompare(b.itemKey))
      .forEach((item) => renderRow(item, list));
  };

  searchInput.addEventListener("input", renderLists);
  void refreshReferencesLibrary().then(renderLists).catch(() => {
    // ignore refresh errors
  });
  renderLists();

  footer.appendChild(createFooterButton("Close", "ghost", closeDialog));
};

type ReferenceConflict = {
  itemKey: string;
  existing: ReferenceItem;
  incoming: ReferenceItem;
};

export const openReferenceConflictDialog = (options: {
  duplicates: ReferenceConflict[];
  usedKeys: Set<string>;
  onApply: (payload: { resolved: ReferenceItem[]; skipped: string[] }) => void;
}): void => {
  const { body, footer, closeDialog } = openDialogShell("Resolve Duplicate Sources");
  const error = document.createElement("div");
  error.className = "leditor-ribbon-dialog__error";

  const rows: Array<{
    key: string;
    mode: () => string;
    renameInput: HTMLInputElement | null;
  }> = [];

  options.duplicates.forEach((dup) => {
    const wrap = document.createElement("div");
    wrap.className = "leditor-reference-conflict";

    const heading = document.createElement("div");
    heading.className = "leditor-reference-conflict__title";
    heading.textContent = dup.itemKey;

    const summary = document.createElement("div");
    summary.className = "leditor-reference-conflict__summary";
    summary.textContent = `Existing: ${dup.existing.title ?? dup.existing.author ?? "Untitled"} • Incoming: ${
      dup.incoming.title ?? dup.incoming.author ?? "Untitled"
    }`;

    const optionsRow = document.createElement("div");
    optionsRow.className = "leditor-reference-conflict__options";

    const makeRadio = (value: string, label: string) => {
      const wrapLabel = document.createElement("label");
      wrapLabel.className = "leditor-ribbon-dialog__radio";
      const input = document.createElement("input");
      input.type = "radio";
      input.name = `conflict-${dup.itemKey}`;
      input.value = value;
      if (value === "merge") input.checked = true;
      wrapLabel.append(input, document.createTextNode(label));
      return { wrapLabel, input };
    };

    const keep = makeRadio("keep", "Keep existing");
    const replace = makeRadio("replace", "Replace with import");
    const merge = makeRadio("merge", "Merge (fill blanks)");
    const rename = makeRadio("rename", "Rename import");

    const renameInput = document.createElement("input");
    renameInput.type = "text";
    renameInput.className = "leditor-reference-conflict__rename";
    renameInput.placeholder = "New item key";
    renameInput.value = `${dup.itemKey}_2`;
    renameInput.disabled = true;

    rename.input.addEventListener("change", () => {
      renameInput.disabled = !rename.input.checked;
      if (rename.input.checked) renameInput.focus();
    });
    [keep.input, replace.input, merge.input].forEach((input) => {
      input.addEventListener("change", () => {
        renameInput.disabled = true;
      });
    });

    optionsRow.append(keep.wrapLabel, replace.wrapLabel, merge.wrapLabel, rename.wrapLabel);
    wrap.append(heading, summary, optionsRow, renameInput);
    body.appendChild(wrap);

    rows.push({
      key: dup.itemKey,
      mode: () => {
        if (keep.input.checked) return "keep";
        if (replace.input.checked) return "replace";
        if (rename.input.checked) return "rename";
        return "merge";
      },
      renameInput
    });
  });

  body.appendChild(error);

  const applyBtn = createFooterButton("Apply", "primary", () => {
    const resolved: ReferenceItem[] = [];
    const skipped: string[] = [];
    const used = new Set(options.usedKeys);
    error.textContent = "";

    options.duplicates.forEach((dup, index) => {
      const row = rows[index];
      const mode = row.mode();
      if (mode === "keep") {
        skipped.push(dup.itemKey);
        return;
      }
      if (mode === "replace") {
        resolved.push({ ...dup.incoming });
        return;
      }
      if (mode === "merge") {
        resolved.push({
          ...dup.existing,
          title: dup.existing.title ?? dup.incoming.title,
          author: dup.existing.author ?? dup.incoming.author,
          year: dup.existing.year ?? dup.incoming.year,
          url: dup.existing.url ?? dup.incoming.url,
          note: dup.existing.note ?? dup.incoming.note,
          source: dup.existing.source ?? dup.incoming.source,
          dqid: dup.existing.dqid ?? dup.incoming.dqid,
          csl: dup.existing.csl ?? dup.incoming.csl
        });
        return;
      }
      const renameValue = row.renameInput?.value.trim().toUpperCase() ?? "";
      if (!renameValue) {
        error.textContent = `Provide a new key for ${dup.itemKey}.`;
        return;
      }
      if (used.has(renameValue)) {
        error.textContent = `Key ${renameValue} already exists. Choose another.`;
        return;
      }
      used.add(renameValue);
      resolved.push({ ...dup.incoming, itemKey: renameValue });
    });

    if (error.textContent) return;
    options.onApply({ resolved, skipped });
    closeDialog();
  });
  footer.appendChild(applyBtn);
};

export const openSortDialog = (options: {
  hasSelection: boolean;
  onApply: (payload: { order: "asc" | "desc" }) => void;
}): void => {
  const { body, footer, closeDialog } = openDialogShell("Sort");
  if (!options.hasSelection) {
    const msg = document.createElement("div");
    msg.className = "leditor-ribbon-dialog__empty";
    msg.textContent = "Select text to sort.";
    body.appendChild(msg);
  }
  const row = document.createElement("div");
  row.className = "leditor-ribbon-dialog__row";
  const asc = document.createElement("label");
  asc.className = "leditor-ribbon-dialog__radio";
  const ascInput = document.createElement("input");
  ascInput.type = "radio";
  ascInput.name = "sortOrder";
  ascInput.value = "asc";
  ascInput.checked = true;
  asc.append(ascInput, document.createTextNode("Ascending"));

  const desc = document.createElement("label");
  desc.className = "leditor-ribbon-dialog__radio";
  const descInput = document.createElement("input");
  descInput.type = "radio";
  descInput.name = "sortOrder";
  descInput.value = "desc";
  desc.append(descInput, document.createTextNode("Descending"));

  row.append(asc, desc);
  body.appendChild(row);

  const applyBtn = document.createElement("button");
  applyBtn.type = "button";
  applyBtn.className = "leditor-ribbon-dialog__primary";
  applyBtn.textContent = "Apply";
  applyBtn.disabled = !options.hasSelection;
  applyBtn.addEventListener("click", () => {
    const order = ascInput.checked ? "asc" : "desc";
    options.onApply({ order });
    closeDialog();
  });
  footer.appendChild(applyBtn);
};

export const showRibbonToast = (message: string): void => {
  let toast = document.getElementById(TOAST_ID);
  if (!toast) {
    toast = document.createElement("div");
    toast.id = TOAST_ID;
    toast.className = "leditor-ribbon-toast";
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.setTimeout(() => {
    toast?.classList.remove("is-visible");
  }, 1800);
};
