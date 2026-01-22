const fs = require("fs");
const path = require("path");

const viewPath = path.resolve(__dirname, "../Plans/view.json");

const viewSource = JSON.parse(fs.readFileSync(viewPath, "utf-8"));
const requiredControlIds = [
  "view.source.selector",
  "view.cleanHtml",
  "view.allowedElements",
  "view.formattingMarks"
];

const collectControlIds = (groups) => {
  const ids = new Set();
  const traverseControl = (control) => {
    if (control.controlId) {
      ids.add(control.controlId);
    }
    if (Array.isArray(control.menu)) {
      control.menu.forEach((nested) => traverseControl(nested));
    }
  };
  (groups ?? []).forEach((group) => {
    (group.clusters ?? []).forEach((cluster) => {
      (cluster.controls ?? []).forEach((control) => {
        traverseControl(control);
      });
    });
  });
  return ids;
};

const controlIds = collectControlIds(viewSource.groups);
const missing = requiredControlIds.filter((id) => !controlIds.has(id));

if (missing.length) {
  console.error("View JSON missing expected control IDs:", missing.join(", "));
  process.exitCode = 1;
} else {
  console.log("View JSON validation succeeded — all required controls present.");
}
