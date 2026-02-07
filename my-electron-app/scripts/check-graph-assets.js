/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const htmlPath = path.join(ROOT, "resources", "retrieve", "graph_view.html");
const vendorDir = path.join(ROOT, "resources", "retrieve", "vendor");

const required = [
  "cytoscape.min.js",
  "cola.min.js",
  "cytoscape-cola.min.js",
  "layout-base.js",
  "cose-base.js",
  "cytoscape-fcose.js"
];

function exists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function main() {
  if (!exists(htmlPath)) {
    console.error("graph_view.html missing at", htmlPath);
    process.exit(1);
  }
  const missing = required.filter((f) => !exists(path.join(vendorDir, f)));
  if (missing.length) {
    console.error("Missing graph vendor files:", missing.join(", "));
    process.exit(1);
  }
  console.log("Graph assets OK:", htmlPath, "and", required.length, "vendor files present.");
}

main();
