// Check ribbon icon integrity: referenced iconKeys in ribbon_model vs creators vs Fluent glyphs.
// Usage: node scripts/check-icons.js
// Exits non-zero on mismatch.

const fs = require("fs");
const path = require("path");

const read = (p) => fs.readFileSync(p, "utf8");

const root = path.join(__dirname, "..");
const ribbonModelPath = path.join(root, "src/ui/ribbon_model.ts");
const ribbonIconsPath = path.join(root, "src/ui/ribbon_icons.ts");
const fluentPathsPath = path.join(root, "src/ui/fluent_icon_paths.ts");

const model = read(ribbonModelPath);
const iconsFile = read(ribbonIconsPath);
const fluentFile = read(fluentPathsPath);

// 1) Collect icon keys referenced in ribbon model ("icon.<name>")
const referenced = new Set();
const iconKeyRegex = /"icon\.([A-Za-z0-9_]+)"/g;
let m;
while ((m = iconKeyRegex.exec(model))) {
  referenced.add(m[1]);
}

// 2) Collect creator keys and their fluent glyph names where applicable.
const creatorRegex = /\n\s*([a-zA-Z0-9_]+):\s*\(\)\s*=>\s*fluentSvg\("([A-Za-z0-9]+20Filled)"\)/g;
const creators = new Set();
const creatorToGlyph = new Map();
while ((m = creatorRegex.exec(iconsFile))) {
  creators.add(m[1]);
  creatorToGlyph.set(m[1], m[2]);
}
// include non-fluent helpers (e.g., spacing icons) by property name only
const genericCreatorRegex = /\n\s*([a-zA-Z0-9_]+):\s*\(\)\s*=>\s*[^\n]+/g;
let mg;
while ((mg = genericCreatorRegex.exec(iconsFile))) {
  creators.add(mg[1]);
}

// 3) Collect available Fluent glyph names.
const fluentRegex = /"([A-Za-z0-9]+20Filled)"\s*:/g;
const fluent = new Set();
let f;
while ((f = fluentRegex.exec(fluentFile))) {
  fluent.add(f[1]);
}

const missingCreators = [...referenced].filter((k) => !creators.has(k));
const unusedCreators = [...creators].filter((k) => !referenced.has(k));
const missingGlyphs = [...creatorToGlyph.entries()] // [key, glyph]
  .filter(([, glyph]) => !fluent.has(glyph))
  .map(([key, glyph]) => ({ key, glyph }));

const errors = [];
if (missingCreators.length) {
  errors.push(`Missing creators for iconKeys: ${missingCreators.join(", ")}`);
}
if (missingGlyphs.length) {
  errors.push(
    `Creators reference missing Fluent glyphs: ${missingGlyphs
      .map((x) => `${x.key}->${x.glyph}`)
      .join(", ")}`
  );
}

if (errors.length) {
  console.error("[IconLint] FAIL\n" + errors.join("\n"));
  process.exit(1);
}

console.info("[IconLint] PASS");
if (unusedCreators.length) {
  console.info(`[IconLint] Unused creators: ${unusedCreators.join(", ")}`);
}
