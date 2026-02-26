require("./load-dotenv");

const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const sourcePath = path.join(projectRoot, "src/renderer/index.ts");
const inventoryPath = path.join(projectRoot, "voice-agent-button-mapping-inventory.md");
const source = fs.readFileSync(sourcePath, "utf8");
const inventory = fs.readFileSync(inventoryPath, "utf8");

const failures = [];
const requiredActionIds = [
  "retrieve-search",
  "retrieve-set-provider",
  "retrieve-set-sort",
  "retrieve-set-years",
  "retrieve-set-limit",
  "retrieve-load-zotero",
  "retrieve-open-batches",
  "retrieve-open-code",
  "retrieve-open-screen",
  "retrieve-load-local",
  "retrieve-export-csv",
  "retrieve-export-excel",
  "retrieve-resolve-na",
  "retrieve-flag-na",
  "retrieve-apply-codebook",
  "retrieve-apply-coding-columns"
];

const requiredRetrieveAliases = ["search prover", "academic databases", "zotero", "open zotero", "sort year", "load zotero", "year range"];

const ensure = (label, ok) => {
  if (!ok) {
    failures.push(label);
  }
};

ensure("voice action seed constant present", /const VOICE_ACTION_SEEDS/.test(source));
ensure("manual voice aliases constant present", /const VOICE_ACTION_MANUAL_ALIASES/.test(source));
ensure("button inventory function present", /(const|function)\s+buildVoiceButtonInventory/.test(source));
ensure("button candidate collector present", /(const|function)\s+collectVoiceButtonCandidates/.test(source));
ensure("voice button selector present", /const VOICE_BUTTON_SELECTOR/.test(source));
ensure("route alias map present", /const VOICE_ROUTE_ALIAS_MAP/.test(source));
ensure("retrieve search defaults parser present", /function parseVoiceRetrieveDefaults/.test(source));

for (const actionId of requiredActionIds) {
  ensure(`manual alias map includes ${actionId}`, new RegExp(`"${actionId}"\\s*:`).test(source));
}

for (const alias of requiredRetrieveAliases) {
  const needle = alias.toLowerCase();
  const inSource = source.toLowerCase().includes(needle);
  const inInventory = inventory.toLowerCase().includes(needle);
  ensure(`inventory documentation includes alias "${alias}"`, inSource || inInventory);
}

const selectorMatch = source.match(/const VOICE_BUTTON_SELECTOR\s*=\s*"([\s\S]*?)";/);
if (selectorMatch) {
  const selectorText = selectorMatch[1];
  const entries = selectorText
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  console.info(`[voice-button-inventory] selector tokens: ${entries.length}`);
} else {
  failures.push("could not parse VOICE_BUTTON_SELECTOR");
}

const routeAliasCount = (source.match(/aliases:\s*\[/g) || []).length;
const buttonAliasCount = (source.match(/aliases:/g) || []).length;
console.info(`[voice-button-inventory] route aliases: ${routeAliasCount}`);
console.info(`[voice-button-inventory] button alias blocks: ${buttonAliasCount}`);

if (failures.length) {
  console.error("[voice-button-inventory] checks failed:");
  failures.forEach((failure) => console.error(` - ${failure}`));
  process.exit(1);
}

console.info("[voice-button-inventory] checks passed");
