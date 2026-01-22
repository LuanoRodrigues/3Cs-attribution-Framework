export const PRINT_EXPORT_CSS = `

@page {
  size: calc(var(--page-width-mm, 210) * 1mm) calc(var(--page-height-mm, 297) * 1mm);
  margin: var(--page-margin-top, 1in) var(--page-margin-right, 1in) var(--page-margin-bottom, 1in) var(--page-margin-left, 1in);
}
* {
  box-sizing: border-box;
}
body {
  margin: 0;
  padding: 0;
  font-family: var(--page-font-family, "Georgia", "Times New Roman", serif);
  background: #ffffff;
  color: #1b1b1b;
}
.print-container {
  width: calc(var(--page-width-mm, 210) * 1mm);
  min-height: calc(var(--page-height-mm, 297) * 1mm);
  margin: 0 auto;
  padding: 0;
}
.leditor-break {
  display: block;
  margin: 12px 0;
  padding: 4px 0;
  text-align: center;
  font-size: 12px;
  color: #444;
  border-top: 1px dashed rgba(0, 0, 0, 0.4);
}
img,
figure,
table {
  max-width: 100%;
  height: auto;
  page-break-inside: avoid;
  break-inside: avoid;
}
table tr,
table thead,
table tbody {
  break-inside: avoid;
}
p, h1, h2, h3, h4, h5, h6, li {
  page-break-inside: avoid;
  widows: var(--widow-lines, 2);
  orphans: var(--orphan-lines, 2);
}
.leditor-footnotes {
  border-top: var(--footnote-separator-height, 1px) solid var(--footnote-separator-color, rgba(0, 0, 0, 0.25));
  margin-top: var(--footnote-spacing, 6px);
  padding-top: var(--footnote-spacing, 6px);
  font-size: var(--footnote-font-size, 11px);
}
@media print {
  #toolbar,
  .leditor-ruler,
  .leditor-zoom,
  .leditor-zoom-panel,
  .leditor-statusbar,
  .leditor-sidebar {
    display: none !important;
  }
}
`;
