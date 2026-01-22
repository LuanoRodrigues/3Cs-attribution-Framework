const STYLE_ID = "leditor-toolbar-styles";

// Minimal stub: inject an empty style tag to satisfy callers.
export const ensureToolbarStyles = () => {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = "";
  document.head.appendChild(style);
};

export const applyTokens = () => {
  // no-op stub; tokens previously set via TOOLBAR_STYLES.
};
