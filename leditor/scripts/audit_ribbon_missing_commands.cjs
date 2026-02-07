#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const ts = require(path.resolve(__dirname, "../node_modules/typescript"));

const ribbonModelPath = path.resolve(__dirname, "../src/ui/ribbon_model.ts");
const commandMapPath = path.resolve(__dirname, "../src/api/command_map.ts");
const commandAliasesPath = path.resolve(__dirname, "../src/ui/ribbon_command_aliases.ts");
const reportDir = path.resolve(__dirname, "../Reports");
const reportJsonPath = path.resolve(reportDir, "ribbon_missing_inventory.json");
const reportMdPath = path.resolve(reportDir, "ribbon_missing_inventory.md");

const POLISH_OVERRIDES = [];

const polishOverrides = new Map();
POLISH_OVERRIDES.forEach((entry) => {
  if (!entry.controlId) return;
  polishOverrides.set(entry.controlId, entry);
});

const parseTS = (filePath) =>
  ts.createSourceFile(
    filePath,
    fs.readFileSync(filePath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );

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

const isShowPlaceholderCall = (node) => {
  if (!node || !ts.isCallExpression(node)) return false;
  if (!ts.isIdentifier(node.expression)) return false;
  return node.expression.text === "showPlaceholderDialog";
};

const isPlaceholderStatement = (stmt) => {
  if (ts.isExpressionStatement(stmt)) {
    return isShowPlaceholderCall(stmt.expression);
  }
  if (ts.isReturnStatement(stmt)) {
    return isShowPlaceholderCall(stmt.expression);
  }
  if (ts.isVariableStatement(stmt)) {
    return true;
  }
  if (ts.isEmptyStatement(stmt)) {
    return true;
  }
  return false;
};

const isPlaceholderFunction = (node) => {
  if (!node || !node.body) return false;
  if (!ts.isBlock(node.body)) {
    return isShowPlaceholderCall(node.body);
  }
  let sawPlaceholder = false;
  for (const stmt of node.body.statements) {
    if (isPlaceholderStatement(stmt)) {
      if (
        (ts.isExpressionStatement(stmt) && isShowPlaceholderCall(stmt.expression)) ||
        (ts.isReturnStatement(stmt) && isShowPlaceholderCall(stmt.expression))
      ) {
        sawPlaceholder = true;
      }
      continue;
    }
    return false;
  }
  return sawPlaceholder;
};

const collectDialogSignals = (node, signals) => {
  if (ts.isCallExpression(node)) {
    const callee = node.expression;
    if (ts.isIdentifier(callee)) {
      if (callee.text === "showPlaceholderDialog") {
        signals.placeholder = true;
      }
      if (callee.text === "prompt") signals.prompt = true;
      if (callee.text === "alert") signals.alert = true;
      if (callee.text === "confirm") signals.confirm = true;
    }
    if (ts.isPropertyAccessExpression(callee)) {
      const target = callee.expression;
      const name = callee.name.text;
      if (
        (ts.isIdentifier(target) && (target.text === "window" || target.text === "globalThis")) ||
        (ts.isPropertyAccessExpression(target) && target.getText() === "window")
      ) {
        if (name === "prompt") signals.prompt = true;
        if (name === "alert") signals.alert = true;
        if (name === "confirm") signals.confirm = true;
      }
    }
  }
  ts.forEachChild(node, (child) => collectDialogSignals(child, signals));
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
        clusterId: ctx.clusterId,
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

const commandMapSource = parseTS(commandMapPath);
const implementedBase = new Set();
const aliasCalls = [];
const placeholderCommands = new Set();
const basicDialogCommands = new Set();

const addKey = (key) => {
  if (key) implementedBase.add(key);
};

const collectCommandMapKeys = (node) => {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "commandMap") {
    if (node.initializer && ts.isObjectLiteralExpression(node.initializer)) {
      for (const prop of node.initializer.properties) {
        if (ts.isPropertyAssignment(prop) || ts.isMethodDeclaration(prop)) {
          const key = getPropName(prop.name);
          addKey(key);
          const fn = ts.isMethodDeclaration(prop)
            ? prop
            : ts.isPropertyAssignment(prop) &&
                (ts.isFunctionExpression(prop.initializer) || ts.isArrowFunction(prop.initializer))
              ? prop.initializer
              : null;
          if (key && fn) {
            if (isPlaceholderFunction(fn)) {
              placeholderCommands.add(key);
            }
            const signals = { prompt: false, alert: false, confirm: false, placeholder: false };
            collectDialogSignals(fn, signals);
            if (signals.prompt || signals.alert || signals.confirm) {
              basicDialogCommands.add(key);
            }
          }
        }
      }
    }
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
    const left = node.left;
    if (ts.isPropertyAccessExpression(left) && left.expression.getText() === "commandMap") {
      addKey(left.name.text);
    }
    if (ts.isElementAccessExpression(left) && left.expression.getText() === "commandMap") {
      const arg = left.argumentExpression;
      if (arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg))) {
        addKey(arg.text);
      }
    }
  }
  if (ts.isCallExpression(node)) {
    const callee = node.expression;
    if (ts.isIdentifier(callee) && (callee.text === "aliasCommand" || callee.text === "aliasCommandWithArgs")) {
      const [aliasArg, targetArg] = node.arguments;
      if (
        aliasArg &&
        targetArg &&
        (ts.isStringLiteral(aliasArg) || ts.isNoSubstitutionTemplateLiteral(aliasArg)) &&
        (ts.isStringLiteral(targetArg) || ts.isNoSubstitutionTemplateLiteral(targetArg))
      ) {
        aliasCalls.push({ aliasId: aliasArg.text, targetId: targetArg.text });
      }
    }
  }
  ts.forEachChild(node, collectCommandMapKeys);
};

collectCommandMapKeys(commandMapSource);

const implemented = new Set(implementedBase);
const aliasMissingTargets = [];
for (const alias of aliasCalls) {
  if (implemented.has(alias.targetId)) {
    implemented.add(alias.aliasId);
  } else {
    aliasMissingTargets.push(alias);
  }
}

const inventoryByTab = new Map();

for (const tabInfo of tabs) {
  const controls = collectControlsFromTab(tabInfo);
  for (const control of controls) {
    const resolved = resolveRibbonCommandId(control.command);
    const missing = resolved ? !implemented.has(resolved) : true;
    const placeholder = resolved ? placeholderCommands.has(resolved) : false;
    const basicDialog = resolved ? basicDialogCommands.has(resolved) : false;
    const polishOverride = control.controlId ? polishOverrides.get(control.controlId) : null;
    if (!missing && !placeholder && !basicDialog && !polishOverride) continue;
    const tabKey = control.tabLabel || control.tabId;
    if (!inventoryByTab.has(tabKey)) inventoryByTab.set(tabKey, []);
    inventoryByTab.get(tabKey).push({
      group: control.groupLabel || control.groupId,
      control: control.label || control.controlId,
      controlId: control.controlId,
      type: control.type,
      commandId: control.command.id,
      resolvedCommandId: resolved,
      reason: missing ? "missing" : placeholder ? "placeholder" : basicDialog ? "basic-dialog" : "polish",
      note: polishOverride?.note
    });
  }
}

const tabsOrdered = tabNames
  .map((n) => tabs.find((t) => t.name === n))
  .filter(Boolean)
  .map((t) => t.tab.label || t.tab.tabId || t.name);

const missingByTab = {};
let totalMissing = 0;
for (const tabLabel of tabsOrdered) {
  const list = inventoryByTab.get(tabLabel) || [];
  missingByTab[tabLabel] = list;
  totalMissing += list.length;
}

const payload = {
  generatedAt: new Date().toISOString(),
  totalMissing,
  missingByTab,
  aliasMissingTargets
};

fs.mkdirSync(reportDir, { recursive: true });
fs.writeFileSync(reportJsonPath, JSON.stringify(payload, null, 2));

const mdLines = [];
mdLines.push("# Ribbon Missing Inventory");
mdLines.push("");
mdLines.push(`Generated: ${payload.generatedAt}`);
mdLines.push("");
mdLines.push(`Total missing: ${payload.totalMissing}`);
mdLines.push("");
for (const tabLabel of tabsOrdered) {
  mdLines.push(`## ${tabLabel}`);
  const list = missingByTab[tabLabel] || [];
  if (!list.length) {
    mdLines.push("None");
    mdLines.push("");
    continue;
  }
  list.forEach((item) => {
    const target = item.resolvedCommandId || "n/a";
    const reason = item.reason ? ` [${item.reason}]` : "";
    const note = item.note ? ` — ${item.note}` : "";
    mdLines.push(`- ${item.control} (${item.controlId || "n/a"}) -> ${target}${reason}${note}`);
  });
  mdLines.push("");
}
if (aliasMissingTargets.length) {
  mdLines.push("## Alias Missing Targets");
  aliasMissingTargets.forEach((entry) => {
    mdLines.push(`- ${entry.aliasId} -> ${entry.targetId}`);
  });
  mdLines.push("");
}

fs.writeFileSync(reportMdPath, mdLines.join("\n"));

console.log(`Missing ribbon commands: ${payload.totalMissing}`);
console.log(`Report: ${path.relative(process.cwd(), reportJsonPath)}`);
console.log(`Report: ${path.relative(process.cwd(), reportMdPath)}`);
