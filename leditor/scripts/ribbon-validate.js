const fs = require("fs");
const path = require("path");

const readJson = (relativePath) => {
  const absolute = path.resolve(relativePath);
  if (!fs.existsSync(absolute)) {
    throw new Error(`Missing file: ${relativePath}`);
  }
  try {
    const raw = fs.readFileSync(absolute, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Failed to parse JSON at ${relativePath}: ${error.message}`);
  }
};

const registry = readJson("src/ui/ribbon.json");
const allowedControlTypes = new Set([
  "button",
  "toggleButton",
  "splitButton",
  "splitToggleButton",
  "colorSplitButton",
  "dropdown",
  "combobox",
  "spinnerDropdown",
  "gallery",
  "dialogLauncher",
  "colorPicker",
  "menuItem",
  "menuToggle",
  "separator",
  "custom",
  "dynamic",
  "colorPalette"
]);

const errors = [];
const seenGroupIds = new Set();
const seenClusterIds = new Set();
const seenControlIds = new Set();

const resolveControlList = (control) => [
  ...(Array.isArray(control.controls) ? control.controls : []),
  ...(Array.isArray(control.menu) ? control.menu : []),
  ...(Array.isArray(control.items) ? control.items : []),
  ...((control.gallery?.controls) ?? [])
];

const visitControl = (control, context) => {
  if (!control || typeof control !== "object") return;
  if (!control.type) {
    errors.push(`Control ${control.controlId ?? "<unknown>"} in ${context} is missing type`);
    return;
  }
  if (!allowedControlTypes.has(control.type)) {
    errors.push(`Unsupported control type "${control.type}" in ${context}`);
  }
  if (control.controlId) {
    if (seenControlIds.has(control.controlId)) {
      errors.push(`Duplicate controlId: ${control.controlId}`);
    } else {
      seenControlIds.add(control.controlId);
    }
  }
  resolveControlList(control).forEach((nested) => visitControl(nested, context));
};

const tabs = registry.tabs ?? [];
if (!Array.isArray(tabs) || tabs.length === 0) {
  errors.push("Ribbon registry must contain at least one tab definition");
}

const tabsById = new Map();
for (const descriptor of tabs) {
  if (!descriptor.tabId) {
    errors.push("Ribbon tab descriptor missing tabId");
    continue;
  }
  if (!descriptor.source) {
    errors.push(`Tab ${descriptor.tabId} missing source`);
    continue;
  }
  const sourcePath = path.join("src/ui", descriptor.source);
  if (!fs.existsSync(sourcePath)) {
    errors.push(`Tab source not found: ${sourcePath}`);
    continue;
  }
  const config = readJson(sourcePath);
  if (config.tabId !== descriptor.tabId) {
    errors.push(`Tab id mismatch for ${descriptor.source}: expected ${descriptor.tabId}, got ${config.tabId}`);
  }
  if (!Array.isArray(config.groups)) {
    errors.push(`Tab ${descriptor.tabId} missing groups array`);
    continue;
  }
  if (tabsById.has(config.tabId)) {
    errors.push(`Duplicate tabId: ${config.tabId}`);
  }
  tabsById.set(config.tabId, config);
  config.groups.forEach((group) => {
    if (!group.groupId) {
      errors.push(`Group missing groupId in tab ${config.tabId}`);
      return;
    }
    if (seenGroupIds.has(group.groupId)) {
      errors.push(`Duplicate groupId across tabs: ${group.groupId}`);
    } else {
      seenGroupIds.add(group.groupId);
    }
    if (!Array.isArray(group.clusters)) {
      errors.push(`Group ${group.groupId} missing clusters`);
      return;
    }
    group.clusters.forEach((cluster) => {
      if (!cluster.clusterId) {
        errors.push(`Cluster missing clusterId in group ${group.groupId}`);
        return;
      }
      if (seenClusterIds.has(cluster.clusterId)) {
        errors.push(`Duplicate clusterId: ${cluster.clusterId}`);
      } else {
        seenClusterIds.add(cluster.clusterId);
      }
      if (!Array.isArray(cluster.controls)) {
        errors.push(`Cluster ${cluster.clusterId} missing controls`);
        return;
      }
      cluster.controls.forEach((control) => visitControl(control, `${config.tabId}/${group.groupId}/${cluster.clusterId}`));
    });
    if (group.dialogLauncher) {
      visitControl(group.dialogLauncher, `${config.tabId}/${group.groupId}/dialogLauncher`);
    }
  });
}

const initialTabId = registry.defaults?.initialTabId;
if (initialTabId && !tabsById.has(initialTabId)) {
  errors.push(`Initial tabId ${initialTabId} not found in ribbon tabs`);
}

const cssFiles = [
  "src/ui/ribbon.css",
  "src/ui/home.css",
  "src/ui/insert.css",
  "src/ui/layout.css",
  "src/ui/review.css",
  "src/ui/view.css"
];
cssFiles.forEach((cssPath) => {
  if (!fs.existsSync(cssPath)) {
    errors.push(`Missing CSS file: ${cssPath}`);
  }
});

if (errors.length) {
  console.error("Ribbon validation failed:");
  errors.forEach((message) => console.error(`  - ${message}`));
  process.exitCode = 1;
} else {
  console.log("Ribbon validation PASSED");
}
