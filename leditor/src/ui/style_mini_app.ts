import type { EditorHandle } from "../api/leditor.ts";
import { getTemplates } from "../templates/index.ts";
import { createFluentSvgIcon } from "./fluent_svg.ts";
import { createRibbonIcon } from "./ribbon_icons.ts";

export type StyleTemplate = {
  templateId: string;
  label: string;
  description: string;
};

type StyleMiniAppState = {
  editorHandle: EditorHandle;
};

type StyleMiniAppOptions = {
  mode?: "create" | "modify";
  templateId?: string;
};

export const getStyleTemplates = (): StyleTemplate[] =>
  getTemplates().map((t) => ({
    templateId: t.id,
    // Contract: the UI title mirrors the filename/id (underscores -> spaces).
    label: t.id
      .replace(/[_-]+/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase())
      .trim(),
    description: ""
  }));

type StyleDialogValues = {
  name: string;
  styleType: string;
  basedOn: string;
  following: string;
  fontFamily: string;
  fontSizePx: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  textColor: string;
  textAlign: "left" | "center" | "right" | "justify";
  lineHeight: string;
  spaceBeforePx: number;
  spaceAfterPx: number;
  addToGallery: boolean;
  autoUpdate: boolean;
  scope: "this" | "template";
};

let activeStyleOverlay: HTMLElement | null = null;

const coerceNumber = (raw: unknown, fallback: number): number => {
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : fallback;
};

const lineHeightToCss = (value: string): string => {
  const v = value.trim().toLowerCase();
  if (v === "single") return "1.15";
  if (v === "1.5") return "1.5";
  if (v === "double") return "2";
  const n = Number(v);
  if (Number.isFinite(n) && n > 0) return String(n);
  return "1.15";
};

const buildToolbarToggle = (label: string, initial: boolean) => {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "leditor-style-toolbar-btn";
  btn.textContent = label;
  btn.setAttribute("aria-pressed", initial ? "true" : "false");
  const get = () => btn.getAttribute("aria-pressed") === "true";
  const set = (next: boolean) => btn.setAttribute("aria-pressed", next ? "true" : "false");
  btn.addEventListener("click", () => set(!get()));
  return { btn, get, set };
};

const setPreview = (preview: HTMLElement, values: StyleDialogValues): void => {
  preview.style.fontFamily = values.fontFamily || "";
  preview.style.fontSize = `${values.fontSizePx}px`;
  preview.style.fontWeight = values.bold ? "700" : "400";
  preview.style.fontStyle = values.italic ? "italic" : "normal";
  preview.style.textDecoration = values.underline ? "underline" : "none";
  preview.style.color = values.textColor;
  preview.style.textAlign = values.textAlign;
  preview.style.lineHeight = lineHeightToCss(values.lineHeight);
};

const summarize = (values: StyleDialogValues): string => {
  const traits = [
    values.bold ? "Bold" : null,
    values.italic ? "Italic" : null,
    values.underline ? "Underline" : null
  ].filter(Boolean) as string[];
  const traitText = traits.length ? `, ${traits.join(", ")}` : "";
  return `Font: ${values.fontFamily || "(Default)"}, ${values.fontSizePx} pt, Font colour: ${values.textColor}${traitText}
Before: ${values.spaceBeforePx} pt, After: ${values.spaceAfterPx} pt, Line spacing: ${values.lineHeight}, Alignment: ${values.textAlign}`;
};

export const openStyleMiniApp = (
  _anchor: HTMLElement,
  state: StyleMiniAppState,
  options: StyleMiniAppOptions = {}
): void => {
  if (activeStyleOverlay) {
    try {
      activeStyleOverlay.remove();
    } catch {
      // ignore
    }
    activeStyleOverlay = null;
  }

  const editor = state.editorHandle.getEditor();
  const title =
    options.mode === "create" ? "New Style" : options.mode === "modify" ? "Modify Style" : "Style";

  const attrsFont = editor.getAttributes("fontFamily") as { fontFamily?: unknown } | null;
  const attrsSize = editor.getAttributes("fontSize") as { fontSize?: unknown } | null;
  const attrsColor = editor.getAttributes("textColor") as { color?: unknown } | null;
  const attrsPara = editor.getAttributes("paragraph") as {
    textAlign?: unknown;
    lineHeight?: unknown;
    spaceBefore?: unknown;
    spaceAfter?: unknown;
  } | null;
  const attrsHead = editor.getAttributes("heading") as { textAlign?: unknown } | null;

  const initial: StyleDialogValues = {
    name: options.mode === "modify" ? "Normal" : "",
    styleType: "Linked (paragraph and character)",
    basedOn: "Normal",
    following: "Normal",
    fontFamily: typeof attrsFont?.fontFamily === "string" ? attrsFont.fontFamily : "",
    fontSizePx: coerceNumber(attrsSize?.fontSize, 12),
    bold: editor.isActive("bold"),
    italic: editor.isActive("italic"),
    underline: editor.isActive("underline"),
    textColor: typeof attrsColor?.color === "string" ? attrsColor.color : "#1e1e1e",
    textAlign: ((): StyleDialogValues["textAlign"] => {
      const raw = (typeof attrsPara?.textAlign === "string" ? attrsPara.textAlign : undefined) ??
        (typeof attrsHead?.textAlign === "string" ? attrsHead.textAlign : undefined) ??
        "left";
      if (raw === "center" || raw === "right" || raw === "justify") return raw;
      return "left";
    })(),
    lineHeight: typeof attrsPara?.lineHeight === "string" ? attrsPara.lineHeight : "single",
    spaceBeforePx: coerceNumber(attrsPara?.spaceBefore, 0),
    spaceAfterPx: coerceNumber(attrsPara?.spaceAfter, 8),
    addToGallery: true,
    autoUpdate: false,
    scope: "this"
  };

  const overlay = document.createElement("div");
  overlay.className = "leditor-style-dialog-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", title);
  overlay.tabIndex = -1;

  const dialog = document.createElement("div");
  dialog.className = "leditor-style-dialog";

  const titlebar = document.createElement("div");
  titlebar.className = "leditor-style-titlebar";
  const titleEl = document.createElement("div");
  titleEl.className = "leditor-style-title";
  titleEl.textContent = title;
  const titlebarActions = document.createElement("div");
  titlebarActions.className = "leditor-style-titlebar-actions";

  const minimizeBtn = document.createElement("button");
  minimizeBtn.type = "button";
  minimizeBtn.className = "leditor-style-titlebar-btn";
  minimizeBtn.dataset.variant = "minimize";
  minimizeBtn.setAttribute("aria-label", "Minimize");
  minimizeBtn.appendChild(createFluentSvgIcon("Subtract20Filled"));

  const maximizeBtn = document.createElement("button");
  maximizeBtn.type = "button";
  maximizeBtn.className = "leditor-style-titlebar-btn";
  maximizeBtn.dataset.variant = "maximize";
  maximizeBtn.setAttribute("aria-label", "Maximize");
  maximizeBtn.appendChild(createFluentSvgIcon("FullScreenMaximize20Filled"));

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "leditor-style-titlebar-btn";
  closeBtn.dataset.variant = "close";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.appendChild(createFluentSvgIcon("Dismiss20Filled"));

  titlebarActions.append(minimizeBtn, maximizeBtn, closeBtn);
  titlebar.append(titleEl, titlebarActions);

  const body = document.createElement("div");
  body.className = "leditor-style-body";

  const properties = document.createElement("div");
  properties.className = "leditor-style-section";
  const propertiesTitle = document.createElement("div");
  propertiesTitle.className = "leditor-style-section-title";
  propertiesTitle.textContent = "Properties";
  const grid = document.createElement("div");
  grid.className = "leditor-style-grid";

  const makeRow = (labelText: string, control: HTMLElement) => {
    const label = document.createElement("label");
    label.textContent = labelText;
    grid.append(label, control);
  };

  const nameInput = document.createElement("input");
  nameInput.className = "leditor-style-field";
  nameInput.value = initial.name;
  makeRow("Name:", nameInput);

  const typeSelect = document.createElement("select");
  typeSelect.className = "leditor-style-field";
  ["Linked (paragraph and character)", "Paragraph", "Character"].forEach((opt) => {
    const o = document.createElement("option");
    o.value = opt;
    o.textContent = opt;
    typeSelect.appendChild(o);
  });
  typeSelect.value = initial.styleType;
  makeRow("Style type:", typeSelect);

  const basedOnSelect = document.createElement("select");
  basedOnSelect.className = "leditor-style-field";
  ["Normal", "Heading 1", "Heading 2", "Heading 3"].forEach((opt) => {
    const o = document.createElement("option");
    o.value = opt;
    o.textContent = opt;
    basedOnSelect.appendChild(o);
  });
  basedOnSelect.value = initial.basedOn;
  makeRow("Style based on:", basedOnSelect);

  const followingSelect = document.createElement("select");
  followingSelect.className = "leditor-style-field";
  ["Normal", "Heading 1", "Heading 2", "Heading 3"].forEach((opt) => {
    const o = document.createElement("option");
    o.value = opt;
    o.textContent = opt;
    followingSelect.appendChild(o);
  });
  followingSelect.value = initial.following;
  makeRow("Style for following paragraph:", followingSelect);

  properties.append(propertiesTitle, grid);

  const formatting = document.createElement("div");
  formatting.className = "leditor-style-section";
  const formattingTitle = document.createElement("div");
  formattingTitle.className = "leditor-style-section-title";
  formattingTitle.textContent = "Formatting";

  const formatbar = document.createElement("div");
  formatbar.className = "leditor-style-formatbar";

  const fontSelect = document.createElement("select");
  fontSelect.className = "leditor-style-field";
  const fonts = [
    "",
    "Times New Roman",
    "Georgia",
    "Cambria",
    "Garamond",
    "Arial",
    "Calibri",
    "Aptos",
    "Aptos Display"
  ];
  fonts.forEach((f) => {
    const o = document.createElement("option");
    o.value = f;
    o.textContent = f || "(Default)";
    fontSelect.appendChild(o);
  });
  fontSelect.value = initial.fontFamily;

  const sizeSelect = document.createElement("select");
  sizeSelect.className = "leditor-style-field";
  [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48].forEach((n) => {
    const o = document.createElement("option");
    o.value = String(n);
    o.textContent = String(n);
    sizeSelect.appendChild(o);
  });
  sizeSelect.value = String(initial.fontSizePx);

  const right = document.createElement("div");
  right.className = "leditor-style-formatbar-right";
  const b = buildToolbarToggle("B", initial.bold);
  const i = buildToolbarToggle("I", initial.italic);
  const u = buildToolbarToggle("U", initial.underline);

  const colorBtn = document.createElement("button");
  colorBtn.type = "button";
  colorBtn.className = "leditor-style-toolbar-btn leditor-style-color-btn";
  colorBtn.setAttribute("aria-label", "Font color");
  colorBtn.title = "Font color";
  colorBtn.innerHTML = `<span>A</span><span class="leditor-style-color-swatch"></span>`;
  const colorInput = document.createElement("input");
  colorInput.type = "color";
  colorInput.value = initial.textColor;
  colorBtn.appendChild(colorInput);

  right.append(b.btn, i.btn, u.btn, colorBtn);
  formatbar.append(fontSelect, sizeSelect, right);

  const alignbar = document.createElement("div");
  alignbar.className = "leditor-style-alignbar";
  const alignLeft = buildToolbarToggle("L", initial.textAlign === "left");
  const alignCenter = buildToolbarToggle("C", initial.textAlign === "center");
  const alignRight = buildToolbarToggle("R", initial.textAlign === "right");
  const alignJustify = buildToolbarToggle("J", initial.textAlign === "justify");
  [alignLeft, alignCenter, alignRight, alignJustify].forEach((t) => {
    t.btn.title = "Alignment";
  });
  alignbar.append(alignLeft.btn, alignCenter.btn, alignRight.btn, alignJustify.btn);

  const spacingRow = document.createElement("div");
  spacingRow.className = "leditor-style-formatbar";
  spacingRow.style.gridTemplateColumns = "240px 120px 1fr";

  const lineSpacing = document.createElement("select");
  lineSpacing.className = "leditor-style-field";
  ["single", "1.5", "double"].forEach((v) => {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = v;
    lineSpacing.appendChild(o);
  });
  lineSpacing.value = initial.lineHeight;

  const beforeInput = document.createElement("input");
  beforeInput.className = "leditor-style-field";
  beforeInput.type = "number";
  beforeInput.min = "0";
  beforeInput.step = "1";
  beforeInput.value = String(initial.spaceBeforePx);

  const afterInput = document.createElement("input");
  afterInput.className = "leditor-style-field";
  afterInput.type = "number";
  afterInput.min = "0";
  afterInput.step = "1";
  afterInput.value = String(initial.spaceAfterPx);

  spacingRow.append(lineSpacing, beforeInput, afterInput);

  const previewBox = document.createElement("div");
  previewBox.className = "leditor-style-preview";
  const prev = document.createElement("div");
  prev.className = "leditor-style-preview-prev";
  prev.textContent =
    "Previous Paragraph Previous Paragraph Previous Paragraph Previous Paragraph Previous Paragraph\nPrevious Paragraph Previous Paragraph Previous Paragraph Previous Paragraph Previous Paragraph";
  const sample = document.createElement("div");
  sample.className = "leditor-style-preview-sample";
  sample.textContent =
    "Sample Text Sample Text Sample Text Sample Text Sample Text\nSample Text Sample Text Sample Text Sample Text Sample Text\nSample Text Sample Text Sample Text Sample Text Sample Text\nSample Text Sample Text Sample Text Sample Text Sample Text";
  previewBox.append(prev, sample);

  const summary = document.createElement("div");
  summary.className = "leditor-style-summary";

  const footer = document.createElement("div");
  footer.className = "leditor-style-footer";

  const footerLeft = document.createElement("div");
  footerLeft.className = "leditor-style-footer-left";
  const addToGallery = document.createElement("label");
  addToGallery.className = "leditor-style-checkline";
  const addToGalleryCb = document.createElement("input");
  addToGalleryCb.type = "checkbox";
  addToGalleryCb.checked = initial.addToGallery;
  addToGallery.append(addToGalleryCb, document.createTextNode("Add to the Styles gallery"));

  const autoUpdate = document.createElement("label");
  autoUpdate.className = "leditor-style-checkline";
  const autoUpdateCb = document.createElement("input");
  autoUpdateCb.type = "checkbox";
  autoUpdateCb.checked = initial.autoUpdate;
  autoUpdate.append(autoUpdateCb, document.createTextNode("Automatically update"));

  const scopeRow = document.createElement("div");
  scopeRow.className = "leditor-style-radio-row";
  const scopeThis = document.createElement("label");
  const scopeThisRb = document.createElement("input");
  scopeThisRb.type = "radio";
  scopeThisRb.name = "style-scope";
  scopeThisRb.checked = true;
  scopeThis.append(scopeThisRb, document.createTextNode("Only in this document"));
  const scopeTemplate = document.createElement("label");
  const scopeTemplateRb = document.createElement("input");
  scopeTemplateRb.type = "radio";
  scopeTemplateRb.name = "style-scope";
  scopeTemplateRb.checked = false;
  scopeTemplate.append(scopeTemplateRb, document.createTextNode("New documents based on this template"));
  scopeRow.append(scopeThis, scopeTemplate);

  const formatMenuBtn = document.createElement("button");
  formatMenuBtn.type = "button";
  formatMenuBtn.className = "leditor-style-format-menu-btn";
  formatMenuBtn.textContent = "Format";
  const formatChevron = createRibbonIcon("chevronDown");
  formatChevron.style.width = "14px";
  formatChevron.style.height = "14px";
  formatChevron.style.marginLeft = "6px";
  formatMenuBtn.appendChild(formatChevron);
  formatMenuBtn.addEventListener("click", () => {
    window.alert("Format menu: coming soon (font, paragraph, tabs, borders, etc).");
  });

  footerLeft.append(addToGallery, autoUpdate, scopeRow, formatMenuBtn);

  const actions = document.createElement("div");
  actions.className = "leditor-style-footer-actions";
  const okBtn = document.createElement("button");
  okBtn.type = "button";
  okBtn.className = "leditor-style-action-btn";
  okBtn.dataset.variant = "primary";
  okBtn.textContent = "OK";
  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "leditor-style-action-btn";
  cancelBtn.textContent = "Cancel";
  actions.append(okBtn, cancelBtn);

  footer.append(footerLeft, actions);

  formatting.append(formattingTitle, formatbar, alignbar, previewBox, summary, footer);
  body.append(properties, formatting);

  const readValues = (): StyleDialogValues => {
    const align: StyleDialogValues["textAlign"] = alignCenter.get()
      ? "center"
      : alignRight.get()
        ? "right"
        : alignJustify.get()
          ? "justify"
          : "left";
    return {
      name: nameInput.value.trim(),
      styleType: typeSelect.value,
      basedOn: basedOnSelect.value,
      following: followingSelect.value,
      fontFamily: fontSelect.value,
      fontSizePx: coerceNumber(sizeSelect.value, 12),
      bold: b.get(),
      italic: i.get(),
      underline: u.get(),
      textColor: colorInput.value,
      textAlign: align,
      lineHeight: lineSpacing.value,
      spaceBeforePx: coerceNumber(beforeInput.value, 0),
      spaceAfterPx: coerceNumber(afterInput.value, 8),
      addToGallery: addToGalleryCb.checked,
      autoUpdate: autoUpdateCb.checked,
      scope: scopeTemplateRb.checked ? "template" : "this"
    };
  };

  const syncUi = (): void => {
    const values = readValues();
    // Single-select alignment: one pressed at a time.
    alignLeft.set(values.textAlign === "left");
    alignCenter.set(values.textAlign === "center");
    alignRight.set(values.textAlign === "right");
    alignJustify.set(values.textAlign === "justify");

    const swatch = colorBtn.querySelector<HTMLElement>(".leditor-style-color-swatch");
    if (swatch) swatch.style.setProperty("--swatch", values.textColor);
    setPreview(sample, values);
    summary.textContent = summarize(values);
  };

  const onAnyChange = () => syncUi();
  [
    nameInput,
    typeSelect,
    basedOnSelect,
    followingSelect,
    fontSelect,
    sizeSelect,
    colorInput,
    lineSpacing,
    beforeInput,
    afterInput,
    addToGalleryCb,
    autoUpdateCb,
    scopeThisRb,
    scopeTemplateRb
  ].forEach((el) => el.addEventListener("input", onAnyChange));
  // Toolbar buttons update via their own click listeners; resync after click.
  [b.btn, i.btn, u.btn, alignLeft.btn, alignCenter.btn, alignRight.btn, alignJustify.btn].forEach((el) =>
    el.addEventListener("click", () => syncUi())
  );

  const cleanup = () => {
    try {
      overlay.remove();
    } catch {
      // ignore
    }
    if (activeStyleOverlay === overlay) activeStyleOverlay = null;
  };
  const close = () => {
    window.removeEventListener("keydown", onKeydown, true);
    cleanup();
  };

  const apply = () => {
    const values = readValues();
    const chain = editor.chain().focus();

    if (values.fontFamily) {
      chain.setMark("fontFamily", { fontFamily: values.fontFamily });
    } else {
      chain.unsetMark("fontFamily");
    }
    if (Number.isFinite(values.fontSizePx) && values.fontSizePx > 0) {
      chain.setMark("fontSize", { fontSize: values.fontSizePx });
    } else {
      chain.unsetMark("fontSize");
    }
    if (values.textColor) {
      chain.setMark("textColor", { color: values.textColor });
    } else {
      chain.unsetMark("textColor");
    }
    values.bold ? chain.setMark("bold") : chain.unsetMark("bold");
    values.italic ? chain.setMark("italic") : chain.unsetMark("italic");
    values.underline ? chain.setMark("underline") : chain.unsetMark("underline");

    chain.run();

    editor.commands.updateAttributes("paragraph", { textAlign: values.textAlign });
    editor.commands.updateAttributes("heading", { textAlign: values.textAlign });
    editor.commands.updateAttributes("paragraph", { lineHeight: values.lineHeight });
    editor.commands.updateAttributes("heading", { lineHeight: values.lineHeight });
    editor.commands.updateAttributes("paragraph", { spaceBefore: values.spaceBeforePx, spaceAfter: values.spaceAfterPx });
    editor.commands.updateAttributes("heading", { spaceBefore: values.spaceBeforePx, spaceAfter: values.spaceAfterPx });
  };

  const onKeydown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      try {
        apply();
      } finally {
        close();
      }
    }
  };

  let minimized = false;
  const setMinimized = (next: boolean) => {
    minimized = next;
    overlay.classList.toggle("is-minimized", minimized);
    // When minimized, keep the dialog interactive but let clicks pass through the overlay.
    overlay.style.pointerEvents = minimized ? "none" : "auto";
    dialog.style.pointerEvents = "auto";
  };

  let maximized = false;
  const setMaximized = (next: boolean) => {
    maximized = next;
    dialog.classList.toggle("is-maximized", maximized);
    if (maximized) {
      setMinimized(false);
    }
  };

  minimizeBtn.addEventListener("click", () => {
    setMinimized(!minimized);
  });
  maximizeBtn.addEventListener("click", () => {
    setMaximized(!maximized);
  });

  titlebar.addEventListener("dblclick", () => {
    setMaximized(!maximized);
  });

  closeBtn.addEventListener("click", close);
  cancelBtn.addEventListener("click", close);
  okBtn.addEventListener("click", () => {
    try {
      apply();
    } finally {
      close();
    }
  });

  overlay.addEventListener("mousedown", (event) => {
    if (event.target === overlay) close();
  });
  window.addEventListener("keydown", onKeydown, true);

  dialog.append(titlebar, body);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  activeStyleOverlay = overlay;

  // Initialize preview and summary.
  syncUi();
  // Focus the dialog for keyboard handling.
  overlay.focus();
};
