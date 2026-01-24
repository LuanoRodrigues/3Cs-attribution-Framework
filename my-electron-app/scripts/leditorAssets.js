const fs = require("fs");
const path = require("path");
const esbuild = require("esbuild");

function resolvePaths() {
  const projectRoot = path.resolve(__dirname, "..");
  const repoRoot = path.resolve(projectRoot, "..");
  const leditorDist = path.join(repoRoot, "leditor", "dist");
  const targetRoot = path.join(projectRoot, "dist", "leditor");
  return { projectRoot, leditorDist, targetRoot };
}

function ensurePathExists(targetPath) {
  if (!fs.existsSync(targetPath)) {
    throw new Error(
      `Write editor asset missing at ${targetPath}. Run the leditor build workflow (see leditor/README) or rerun ` +
        `"npm run validate:leditor-assets" and ensure ${path.relative(resolvePaths().projectRoot, targetPath)} exists.`
    );
  }
}

function ensureLeditorAssets() {
  const { leditorDist, projectRoot } = resolvePaths();
  if (!fs.existsSync(leditorDist)) {
    throw new Error(
      `The leditor/dist directory (${leditorDist}) is missing. Build the leditor project and rerun "npm run validate:leditor-assets".`
    );
  }
  const required = [path.join(leditorDist, "public", "index.html"), path.join(leditorDist, "renderer", "bootstrap.bundle.js")];
  required.forEach((file) => ensurePathExists(file));
  return { leditorDist, projectRoot };
}

function ensureDirectory(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function copyDirectory(source, target) {
  ensureDirectory(target);
  const entries = fs.readdirSync(source, { withFileTypes: true });
  entries.forEach((entry) => {
    const srcPath = path.join(source, entry.name);
    const destPath = path.join(target, entry.name);
    if (entry.isDirectory()) {
      copyDirectory(srcPath, destPath);
      return;
    }
    fs.copyFileSync(srcPath, destPath);
  });
}

function copyLeditorAssets() {
  const { leditorDist, projectRoot } = ensureLeditorAssets();
  const targetRoot = path.join(projectRoot, "dist", "leditor");
  if (fs.existsSync(targetRoot)) {
    fs.rmSync(targetRoot, { recursive: true, force: true });
  }
  copyDirectory(path.join(leditorDist, "public"), path.join(targetRoot, "public"));
  copyDirectory(path.join(leditorDist, "renderer"), path.join(targetRoot, "renderer"));
  ensureVendorShim(targetRoot);
  buildLeditorPrelude(targetRoot);
  return targetRoot;
}

function ensureVendorShim(targetRoot) {
  const rendererDir = path.join(targetRoot, "renderer");
  ensureDirectory(rendererDir);
  const entryPath = path.join(rendererDir, "vendor-leditor-entry.js");
  const bundlePath = path.join(rendererDir, "vendor-leditor.js");
  const entrySource = `
(function(){
  const deps = {
    "@tiptap/core": window.tiptapCore,
    "@tiptap/starter-kit": window.tiptapStarter,
    "@tiptap/extension-link": window.tiptapExtensionLink,
    "@tiptap/extension-table": {},
    "@tiptap/extension-table-cell": {},
    "@tiptap/extension-table-header": {},
    "@tiptap/extension-table-row": {},
    "@tiptap/pm/state": window.tiptapPmState,
    "@tiptap/pm/tables": window.tiptapPmTables,
    "prosemirror-state": window.prosemirrorState,
    "prosemirror-view": window.prosemirrorView,
    "prosemirror-markdown": window.prosemirrorMarkdown
  };
  if (typeof window !== "undefined") {
    window.__LEDITOR_DEPS = deps;
    window.require = (name) => {
      const mod = deps[name];
      if (!mod) {
        throw new Error(\`Missing leditor dependency: \${name}\`);
      }
      return mod;
    };
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = deps;
  }
})();
`;
  fs.writeFileSync(entryPath, entrySource, "utf-8");
  try {
    esbuild.buildSync({
      entryPoints: [entryPath],
      bundle: true,
      platform: "browser",
      format: "iife",
      target: "es2020",
      globalName: "LEDITOR_DEPS",
      outfile: bundlePath,
      logLevel: "silent",
      allowOverwrite: true
    });
  } catch (error) {
    throw new Error(`Failed to build leditor vendor shim: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function buildLeditorPrelude(targetRoot) {
  const { projectRoot } = resolvePaths();
  const entryPath = path.join(projectRoot, "src", "leditorPrelude.ts");
  ensurePathExists(entryPath);
  const rendererDir = path.join(targetRoot, "renderer");
  ensureDirectory(rendererDir);
  const outputPath = path.join(rendererDir, "prelude.js");
  try {
    esbuild.buildSync({
      entryPoints: [entryPath],
      bundle: true,
      platform: "browser",
      format: "iife",
      target: "es2020",
      outfile: outputPath,
      allowOverwrite: true,
      logLevel: "silent"
    });
  } catch (error) {
    throw new Error(`Failed to build leditor prelude: ${error instanceof Error ? error.message : String(error)}`);
  }
}

module.exports = {
  ensureLeditorAssets,
  copyLeditorAssets
};
