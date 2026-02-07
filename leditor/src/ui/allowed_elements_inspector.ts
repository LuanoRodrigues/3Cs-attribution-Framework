import type { PasteCleanerOptions } from "../plugins/pasteCleaner.ts";

const OVERLAY_ID = "allowed-elements-inspector";
const STYLE_ID = "allowed-elements-inspector-styles";

const ensureStyles = (): void => {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
.allowed-elements-overlay {
  position: fixed;
  inset: 0;
  background: var(--ui-backdrop);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2140;
}
.allowed-elements-panel {
  width: min(760px, 90vw);
  max-height: 90vh;
  background: var(--ui-surface);
  border-radius: 14px;
  padding: 24px;
  box-shadow: var(--ui-shadow-2);
  display: flex;
  flex-direction: column;
  gap: 16px;
  overflow: hidden;
  color: var(--ui-text);
}
.allowed-elements-panel header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 1rem;
  font-weight: 600;
}
.allowed-elements-panel button {
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 0.9rem;
  color: var(--ui-text);
}
.allowed-elements-content {
  overflow: auto;
  display: grid;
  gap: 12px;
}
.allowed-elements-section {
  border: var(--ui-border);
  border-radius: 10px;
  padding: 12px 16px;
  background: var(--ui-surface);
}
.allowed-elements-section h3 {
  margin: 0 0 6px;
  font-size: 0.85rem;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: var(--ui-muted);
}
.allowed-elements-section ul {
  margin: 0;
  padding-left: 16px;
  font-size: 0.95rem;
  line-height: 1.4;
}
.allowed-elements-section li {
  margin-bottom: 4px;
}
.allowed-elements-section code {
  background: color-mix(in srgb, var(--ui-text) 8%, transparent);
  border-radius: 4px;
  padding: 0 6px;
  font-size: 0.85rem;
}
`;
  document.head.appendChild(style);
};

const buildList = (items: string[]): HTMLElement => {
  const list = document.createElement("ul");
  items.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    list.appendChild(li);
  });
  return list;
};

const buildAttributesList = (attributes: Record<string, readonly string[]>): HTMLElement => {
  const wrapper = document.createElement("div");
  Object.entries(attributes).forEach(([tag, attrs]) => {
    const row = document.createElement("p");
    row.innerHTML = `<strong>${tag}</strong>: ${attrs.join(", ")}`;
    wrapper.appendChild(row);
  });
  return wrapper;
};

type StyleRules = Record<string, readonly RegExp[]>;
type StyleSpec = Record<string, StyleRules | readonly RegExp[]>;

const buildStylesList = (styles: StyleSpec): HTMLElement => {
  const wrapper = document.createElement("div");
  Object.entries(styles).forEach(([name, patterns]) => {
    const row = document.createElement("p");
    if (Array.isArray(patterns)) {
      const regexes = patterns.map((pattern) => pattern.toString()).join(", ");
      row.innerHTML = `<strong>${name}</strong>: ${regexes}`;
      wrapper.appendChild(row);
      return;
    }
    const ruleEntries = Object.entries(patterns);
    if (ruleEntries.length === 0) {
      row.innerHTML = `<strong>${name}</strong>: none`;
      wrapper.appendChild(row);
      return;
    }
    const list = document.createElement("ul");
      for (const [prop, regexes] of ruleEntries) {
        const li = document.createElement("li");
        li.innerHTML = `<strong>${prop}</strong>: ${regexes.map((pattern: RegExp) => pattern.toString()).join(", ")}`;
        list.appendChild(li);
      }
    row.innerHTML = `<strong>${name}</strong>:`;
    wrapper.appendChild(row);
    wrapper.appendChild(list);
  });
  return wrapper;
};

const createPanel = (spec: PasteCleanerOptions): HTMLElement => {
  const panel = document.createElement("div");
  panel.className = "allowed-elements-panel";

  const header = document.createElement("header");
  const title = document.createElement("span");
  title.textContent = "Allowed elements";
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.textContent = "Close";
  header.append(title, closeBtn);
  panel.appendChild(header);

  const content = document.createElement("div");
  content.className = "allowed-elements-content";

  const tagsSection = document.createElement("section");
  tagsSection.className = "allowed-elements-section";
  const tagsTitle = document.createElement("h3");
  tagsTitle.textContent = "Tags";
  tagsSection.append(tagsTitle, buildList(Array.from(spec.allowedTags)));

  const attrsSection = document.createElement("section");
  attrsSection.className = "allowed-elements-section";
  const attrsTitle = document.createElement("h3");
  attrsTitle.textContent = "Attributes";
  attrsSection.append(attrsTitle, buildAttributesList(spec.allowedAttributes));

  const stylesSection = document.createElement("section");
  stylesSection.className = "allowed-elements-section";
  const stylesTitle = document.createElement("h3");
  stylesTitle.textContent = "Styles";
  stylesSection.append(stylesTitle, buildStylesList(spec.allowedStyles));

  content.append(tagsSection, attrsSection, stylesSection);
  panel.appendChild(content);

  closeBtn.addEventListener("click", () => {
    hideAllowedElementsInspector();
  });

  return panel;
};

const hideAllowedElementsInspector = (): void => {
  const overlay = document.getElementById(OVERLAY_ID);
  if (!overlay) return;
  overlay.style.display = "none";
};

export const showAllowedElementsInspector = (spec: PasteCleanerOptions): void => {
  ensureStyles();
  let overlay = document.getElementById(OVERLAY_ID);
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    overlay.className = "allowed-elements-overlay";
    const panel = createPanel(spec);
    overlay.appendChild(panel);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) {
        hideAllowedElementsInspector();
      }
    });
    document.body.appendChild(overlay);
    document.addEventListener("keydown", (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        hideAllowedElementsInspector();
      }
    });
  } else {
    const panel = overlay.querySelector(".allowed-elements-panel");
    if (panel) {
      panel.remove();
      overlay.appendChild(createPanel(spec));
    }
    overlay.style.display = "flex";
  }
};
