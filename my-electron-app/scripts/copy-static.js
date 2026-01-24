const fs = require("fs");
const path = require("path");
const { copyLeditorAssets } = require("./leditorAssets");

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function copyFile(src, dest) {
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

function copyDir(src, dest) {
  if (!fs.existsSync(src)) {
    return;
  }
  ensureDir(path.dirname(dest));
  fs.cpSync(src, dest, { recursive: true, force: true });
}

const projectRoot = path.resolve(__dirname, "..");
const sharedResourcesDir = path.join(projectRoot, "..", "resources");
const srcRenderer = path.join(projectRoot, "src", "renderer");
const distRenderer = path.join(projectRoot, "dist", "renderer");

const files = ["index.html", "styles.css", "ribbon-panels.v2.css"];
files.forEach((file) => {
  const src = path.join(srcRenderer, file);
  const dest = path.join(distRenderer, file);
  if (fs.existsSync(src)) {
    copyFile(src, dest);
  }
});

const backendSrc = path.join(projectRoot, "backend");
const backendDest = path.join(projectRoot, "dist", "backend");
const backendFiles = ["screen_host.py"];
backendFiles.forEach((file) => {
  const src = path.join(backendSrc, file);
  if (fs.existsSync(src)) {
    copyFile(src, path.join(backendDest, file));
  }
});

const settingsTemplate = path.join(sharedResourcesDir, "app_settings_view.html");
if (fs.existsSync(settingsTemplate)) {
  const settingsDest = path.join(projectRoot, "dist", "resources", "app_settings_view.html");
  copyFile(settingsTemplate, settingsDest);
}
const settingsHtmlSrc = path.join(projectRoot, "src", "windows", "settings.html");
if (fs.existsSync(settingsHtmlSrc)) {
  copyFile(settingsHtmlSrc, path.join(projectRoot, "dist", "windows", "settings.html"));
}
const settingsScript = path.join(sharedResourcesDir, "settings_ui.js");
if (fs.existsSync(settingsScript)) {
  const settingsScriptDest = path.join(projectRoot, "dist", "resources", "settings_ui.js");
  copyFile(settingsScript, settingsScriptDest);
}

const retrieveResources = [
  "resources/retrieve/citations.html",
  "resources/retrieve/citations.js",
  "resources/retrieve/citations.css",
  "resources/retrieve/graph_view.html"
];
retrieveResources.forEach((resource) => {
  const src = path.join(projectRoot, resource);
  if (!fs.existsSync(src)) {
    return;
  }
  const dest = path.join(projectRoot, "dist", resource);
  copyFile(src, dest);
});

const localViewerHtmlSrc = path.join(projectRoot, "resources", "viewer.html");
const fallbackViewerHtmlSrc = path.join(sharedResourcesDir, "viewer.html");
const viewerHtmlSrc = fs.existsSync(localViewerHtmlSrc) ? localViewerHtmlSrc : fallbackViewerHtmlSrc;
if (fs.existsSync(viewerHtmlSrc)) {
  copyFile(viewerHtmlSrc, path.join(projectRoot, "dist", "resources", "viewer.html"));
}
const viewerBuildSrc = path.join(sharedResourcesDir, "build");
const viewerBuildDest = path.join(projectRoot, "dist", "resources", "build");
if (fs.existsSync(viewerBuildSrc)) {
  copyDir(viewerBuildSrc, viewerBuildDest);
}

const pdfAssetsSrc = path.join(sharedResourcesDir, "pdfs");
const pdfAssetsDest = path.join(projectRoot, "dist", "resources", "pdfs");
if (fs.existsSync(pdfAssetsSrc)) {
  copyDir(pdfAssetsSrc, pdfAssetsDest);
}

const leditorResourcesSrc = path.join(projectRoot, "resources", "leditor");
const leditorResourcesDest = path.join(projectRoot, "dist", "resources", "leditor");
copyDir(leditorResourcesSrc, leditorResourcesDest);

copyLeditorAssets(projectRoot);
