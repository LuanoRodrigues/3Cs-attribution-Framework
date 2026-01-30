import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const templatesDir = path.join(root, "templates");
const outputDir = path.join(root, "src/templates");
const outputFile = path.join(outputDir, "generated_templates.ts");
const EXAMPLE_FILE = "template_example.json";
const HUMANIZE = (text) =>
  text
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim();

const ensurePaths = async () => {
  const stat = await fs.stat(templatesDir).catch(() => null);
  if (!stat?.isDirectory()) {
    throw new Error(`Templates directory not found at ${templatesDir}`);
  }
  await fs.mkdir(outputDir, { recursive: true });
};

const loadTemplates = async () => {
  const entries = await fs.readdir(templatesDir, { withFileTypes: true });
  const templates = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json") || entry.name === EXAMPLE_FILE) {
      continue;
    }
    const filePath = path.join(templatesDir, entry.name);
    const raw = await fs.readFile(filePath, "utf8");
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error(`Failed to parse ${entry.name}: ${error}`);
    }

    const slug = path.basename(entry.name, ".json");
    const doc = parsed.document;
    if (!doc || typeof doc !== "object") {
      throw new Error(`Template ${entry.name} must provide a "document" object.`);
    }

    const id = typeof parsed.id === "string" && parsed.id.trim() ? parsed.id.trim() : slug;
    const label = typeof parsed.label === "string" && parsed.label.trim()
      ? parsed.label.trim()
      : HUMANIZE(slug);
    const description =
      typeof parsed.description === "string"
        ? parsed.description
        : typeof parsed.metadata?.description === "string"
          ? parsed.metadata.description
          : "";

    templates.push({
      id,
      label,
      description,
      document: doc
    });
  }
  return templates.sort((a, b) => a.label.localeCompare(b.label, "en", { sensitivity: "base" }));
};

const writeOutput = async (templates) => {
  const header = `// Auto-generated. Run \"npm run generate:templates\" after editing templates/.\nimport type { TemplateDefinition } from "./types.ts";\n\n`;
  const body = `export const templateDefinitions: TemplateDefinition[] = ${JSON.stringify(templates, null, 2)};\n`;
  await fs.writeFile(outputFile, `${header}${body}`, "utf8");
};

const main = async () => {
  await ensurePaths();
  const templates = await loadTemplates();
  console.info(`Generating ${templates.length} template${templates.length === 1 ? "" : "s"}...`);
  await writeOutput(templates);
  console.info(`Wrote template index to ${outputFile}`);
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
