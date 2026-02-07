const path = require("path");
const fs = require("fs");
const { app, BrowserWindow, ipcMain } = require("electron");
const ts = require(path.resolve(__dirname, "../node_modules/typescript"));

const repoRoot = path.resolve(__dirname, "..");
const indexHtml = path.join(repoRoot, "dist", "public", "index.html");
const ribbonModelPath = path.resolve(repoRoot, "src", "ui", "ribbon_model.ts");
const commandAliasesPath = path.resolve(repoRoot, "src", "ui", "ribbon_command_aliases.ts");

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const waitFor = async (webContents, script, timeout = 15_000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const result = await webContents.executeJavaScript(script);
      if (result) return;
    } catch {
      // ignore while loading
    }
    await delay(250);
  }
  throw new Error("Timed out waiting for condition");
};

const parseTS = (filePath) =>
  ts.createSourceFile(filePath, fs.readFileSync(filePath, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

const getPropName = (name) => {
  if (!name) return null;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return null;
};

const evalLiteral = (node) => {
  if (!node) return undefined;
  switch (node.kind) {
    case ts.SyntaxKind.StringLiteral:
    case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
      return node.text;
    case ts.SyntaxKind.NumericLiteral:
      return Number(node.text);
    case ts.SyntaxKind.TrueKeyword:
      return true;
    case ts.SyntaxKind.FalseKeyword:
      return false;
    case ts.SyntaxKind.NullKeyword:
      return null;
    case ts.SyntaxKind.ObjectLiteralExpression: {
      const obj = {};
      for (const prop of node.properties) {
        if (ts.isPropertyAssignment(prop)) {
          const key = getPropName(prop.name);
          if (!key) continue;
          obj[key] = evalLiteral(prop.initializer);
        } else if (ts.isShorthandPropertyAssignment(prop)) {
          const key = prop.name.text;
          obj[key] = key;
        }
      }
      return obj;
    }
    case ts.SyntaxKind.ArrayLiteralExpression:
      return node.elements.map((el) => evalLiteral(el));
    case ts.SyntaxKind.AsExpression:
    case ts.SyntaxKind.TypeAssertionExpression:
      return evalLiteral(node.expression);
    case ts.SyntaxKind.ParenthesizedExpression:
      return evalLiteral(node.expression);
    case ts.SyntaxKind.PrefixUnaryExpression: {
      const val = evalLiteral(node.operand);
      if (node.operator === ts.SyntaxKind.MinusToken) return typeof val === "number" ? -val : undefined;
      if (node.operator === ts.SyntaxKind.PlusToken) return typeof val === "number" ? val : undefined;
      return undefined;
    }
    case ts.SyntaxKind.Identifier:
      if (node.text === "undefined") return undefined;
      return undefined;
    default:
      return undefined;
  }
};

const findVariableInitializer = (sourceFile, name) => {
  for (const stmt of sourceFile.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (ts.isIdentifier(decl.name) && decl.name.text === name) {
        return decl.initializer;
      }
    }
  }
  return null;
};

const ribbonSource = parseTS(ribbonModelPath);
const tabNames = ["fileTab", "homeTab", "insertTab", "layoutTab", "referencesTab", "reviewTab", "aiTab", "viewTab"];
const tabs = [];
for (const name of tabNames) {
  const init = findVariableInitializer(ribbonSource, name);
  if (!init) continue;
  const value = evalLiteral(init);
  if (value && typeof value === "object") {
    tabs.push({ name, tab: value });
  }
}

const aliasesSource = parseTS(commandAliasesPath);
const aliasesInit = findVariableInitializer(aliasesSource, "COMMAND_ALIASES");
const COMMAND_ALIASES = evalLiteral(aliasesInit) || {};

const resolveRibbonCommandId = (command) => {
  const id = command?.id;
  if (!id) return undefined;
  const args = command?.args || {};
  if (id === "paragraph.align.set") {
    const mode = String(args.mode ?? "left").toLowerCase();
    if (mode === "center") return "AlignCenter";
    if (mode === "right") return "AlignRight";
    if (mode === "justify") return "JustifyFull";
    return "AlignLeft";
  }
  if (id === "font.case.set") return "ChangeCase";
  if (id === "paragraph.lineSpacing.set") return "LineSpacing";
  return COMMAND_ALIASES[id] || id;
};

const collectControlsFromTab = (tabInfo) => {
  const { tab } = tabInfo;
  const results = [];
  const tabId = tab.tabId || tabInfo.name;
  const tabLabel = tab.label || tabId;
  const groups = Array.isArray(tab.groups) ? tab.groups : [];

  const walkControl = (control, ctx) => {
    if (!control || typeof control !== "object") return;
    const command = control.command && typeof control.command === "object" ? control.command : null;
    const commandId = command?.id;
    if (commandId) {
      results.push({
        tabId,
        tabLabel,
        groupId: ctx.groupId,
        groupLabel: ctx.groupLabel,
        controlId: control.controlId,
        label: control.label,
        type: control.type,
        command: { id: commandId, args: command.args }
      });
    }
    const nestedKeys = ["controls", "menu", "items"];
    for (const key of nestedKeys) {
      const items = Array.isArray(control[key]) ? control[key] : [];
      for (const item of items) walkControl(item, ctx);
    }
    if (control.gallery && Array.isArray(control.gallery.controls)) {
      for (const item of control.gallery.controls) walkControl(item, ctx);
    }
  };

  for (const group of groups) {
    const clusters = Array.isArray(group.clusters) ? group.clusters : [];
    for (const cluster of clusters) {
      const controls = Array.isArray(cluster.controls) ? cluster.controls : [];
      const ctx = {
        groupId: group.groupId,
        groupLabel: group.label,
        clusterId: cluster.clusterId
      };
      for (const control of controls) walkControl(control, ctx);
    }
  }
  return results;
};

const controls = [];
for (const tabInfo of tabs) {
  const tabControls = collectControlsFromTab(tabInfo);
  tabControls.forEach((control) => {
    const resolved = resolveRibbonCommandId(control.command);
    controls.push({
      tabId: control.tabId,
      tabLabel: control.tabLabel,
      groupLabel: control.groupLabel,
      controlId: control.controlId,
      label: control.label,
      type: control.type,
      commandId: control.command.id,
      commandArgs: control.command.args ?? null,
      resolvedCommandId: resolved
    });
  });
}

const registerIpcFallbacks = () => {
  const register = (channel, handler) => {
    try {
      ipcMain.removeHandler(channel);
    } catch {
      // ignore
    }
    ipcMain.handle(channel, handler);
  };
  register("leditor:ai-status", async () => ({
    success: true,
    hasApiKey: false,
    model: "codex-mini-latest",
    modelFromEnv: false
  }));
  register("leditor:file-exists", async () => ({ success: true, exists: false }));
  register("leditor:agent-request", async () => ({ success: false, error: "disabled", meta: { ms: 0 } }));
  register("leditor:agent-cancel", async () => ({ success: true }));
  register("leditor:read-file", async () => ({ success: false, error: "disabled" }));
  register("leditor:write-file", async () => ({ success: true }));
  register("leditor:export-ledoc", async () => ({ success: false, error: "disabled" }));
  register("leditor:import-ledoc", async () => ({ success: false, error: "disabled" }));
  register("leditor:get-default-ledoc-path", async () => ({ success: true, path: "" }));
  register("leditor:open-pdf-viewer", async () => ({ success: false, error: "disabled" }));
  register("leditor:pdf-viewer-payload", async () => null);
  register("leditor:resolve-pdf-path", async () => null);
  register("leditor:get-direct-quote-entry", async () => null);
  register("leditor:prefetch-direct-quotes", async () => ({ success: true, found: 0 }));
  register("leditor:llm-status", async () => ({ success: false }));
  register("leditor:llm-catalog", async () => ({ success: false }));
  register("leditor:check-sources", async () => ({ success: false }));
  register("leditor:substantiate-anchors", async () => ({ success: false }));
  register("leditor:lexicon", async () => ({ success: false }));
  register("leditor:export-docx", async () => ({ success: false, error: "disabled" }));
  register("leditor:export-pdf", async () => ({ success: false, error: "disabled" }));
  register("leditor:import-docx", async () => ({ success: false, error: "disabled" }));
  register("leditor:list-ledoc-versions", async () => ({ success: true, versions: [] }));
  register("leditor:create-ledoc-version", async () => ({ success: true }));
  register("leditor:restore-ledoc-version", async () => ({ success: true }));
  register("leditor:delete-ledoc-version", async () => ({ success: true }));
  register("leditor:pin-ledoc-version", async () => ({ success: true }));
};

const run = async () => {
  const tmpRoot = path.join(repoRoot, ".tmp_headless");
  try {
    fs.mkdirSync(tmpRoot, { recursive: true });
  } catch {
    // ignore
  }
  process.env.TMPDIR = tmpRoot;
  process.env.TMP = tmpRoot;
  process.env.TEMP = tmpRoot;
  app.setPath("userData", path.join(tmpRoot, "userData"));
  app.setPath("temp", path.join(tmpRoot, "temp"));

  app.commandLine.appendSwitch("headless");
  app.commandLine.appendSwitch("disable-gpu");
  app.commandLine.appendSwitch("no-sandbox");
  app.commandLine.appendSwitch("disable-dev-shm-usage");
  app.commandLine.appendSwitch("disable-features", "UsePortal");
  app.commandLine.appendSwitch("gtk-use-portal", "0");

  registerIpcFallbacks();

  const killTimer = setTimeout(() => {
    console.error("[FAIL] ribbon smoke timed out");
    app.exit(1);
  }, 120_000);

  await app.whenReady();
  const win = new BrowserWindow({
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#ffffff",
    webPreferences: {
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(repoRoot, "dist", "electron", "preload.js")
    }
  });

  try {
    await win.loadFile(indexHtml);
    await waitFor(win.webContents, "Boolean(window.leditor && window.leditor.getEditor)");
    await waitFor(win.webContents, "Boolean(document.querySelector('.leditor-ribbon-shell'))");

    const payload = JSON.stringify(controls);
    const result = await win.webContents.executeJavaScript(
      `
      (async () => {
        const entries = ${payload};
        const missingWarnings = [];
        const execErrors = [];
        const missingElements = Array.from(document.querySelectorAll('[data-missing-command="true"]'))
          .map((el) => el.getAttribute('data-control-id') || el.getAttribute('title') || 'unknown');

        const originalWarn = console.warn.bind(console);
        console.warn = (...args) => {
          const msg = args.map((a) => (typeof a === 'string' ? a : '')).join(' ');
          if (msg.includes('missing command')) {
            missingWarnings.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
          }
          originalWarn(...args);
        };

        window.alert = () => undefined;
        window.confirm = () => false;
        window.prompt = (_msg, _def) => '';
        window.open = () => null;

        const editor = window.leditor?.getEditor?.();
        if (editor) {
          const doc = {
            type: 'doc',
            content: [
              { type: 'page', content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'Ribbon smoke test content. https://example.com' }] },
                { type: 'paragraph', content: [{ type: 'text', text: 'Second paragraph for selection.' }] }
              ] }
            ]
          };
          window.leditor.setContent(doc, { format: 'json' });
          editor.commands.setTextSelection({ from: 2, to: Math.min(30, editor.state.doc.content.size) });
          editor.view.focus();
        }

        const defaultsFor = (resolvedId, args) => {
          if (args && typeof args === 'object') return args;
          switch (resolvedId) {
            case 'TextColor':
              return { value: '#000000' };
            case 'HighlightColor':
              return { value: '#fff59d' };
            case 'FontFamily':
              return { value: 'Times New Roman' };
            case 'FontSize':
              return { valuePx: 12 };
            case 'LineSpacing':
              return { value: '1.0' };
            case 'SpaceBefore':
            case 'SpaceAfter':
              return { valuePx: 0 };
            case 'view.zoom.step':
              return { delta: 0.1 };
            case 'view.zoom.set':
              return { value: 1 };
            case 'view.zoom.fit':
              return { mode: 'pageWidth' };
            case 'view.page.goto':
              return { dir: 'next' };
            case 'view.paginationMode.set':
              return { mode: 'paged' };
            default:
              return args || undefined;
          }
        };

        for (const entry of entries) {
          const resolved = entry.resolvedCommandId || entry.commandId;
          if (!resolved) continue;
          try {
            const args = defaultsFor(resolved, entry.commandArgs);
            if (args !== undefined) {
              window.leditor.execCommand(resolved, args);
            } else {
              window.leditor.execCommand(resolved);
            }
          } catch (error) {
            execErrors.push({ id: resolved, error: String(error) });
          }
        }

        return {
          missingWarnings,
          missingElements,
          execErrors,
          totalCommands: entries.length
        };
      })();
      `,
      true
    );

    if (result.missingElements.length) {
      console.error("[FAIL] Missing command markers on ribbon controls:", result.missingElements);
      app.exit(1);
      return;
    }
    if (result.missingWarnings.length) {
      console.error("[FAIL] Missing command warnings:", result.missingWarnings);
      app.exit(1);
      return;
    }

    console.log(`[OK] Ribbon smoke: ${result.totalCommands} commands executed.`);
    if (result.execErrors.length) {
      console.log(`[WARN] ${result.execErrors.length} command errors (non-missing).`);
    }
  } catch (error) {
    console.error("[FAIL] ribbon smoke error", error);
    app.exit(1);
    return;
  } finally {
    clearTimeout(killTimer);
    app.exit(0);
  }
};

void run();
