import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const templatesDir = path.join(root, "journal_templates");
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

const readTemplatesFromDir = async (dirPath, precedence) => {
  const stat = await fs.stat(dirPath).catch(() => null);
  if (!stat?.isDirectory()) return [];
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json") && entry.name !== EXAMPLE_FILE)
    .map((entry) => ({ name: entry.name, path: path.join(dirPath, entry.name), precedence }));
  return files;
};

const loadTemplates = async () => {
  const templates = [];
  const candidates = await readTemplatesFromDir(templatesDir, 1);

  for (const entry of candidates) {
    // Never ingest the generated output back as input.
    if (entry.name === "generated_templates.ts") continue;
    const raw = await fs.readFile(entry.path, "utf8");
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error(`Failed to parse ${entry.name}: ${error}`);
    }

    const slug = path.basename(entry.name, ".json");
    const doc = parsed.document && typeof parsed.document === "object" ? parsed.document : parsed;
    if (!doc || typeof doc !== "object" || doc.type !== "doc") {
      throw new Error(`Template ${entry.name} must provide a "document" object.`);
    }

    // Contract: template id/label are derived from the filename so the ribbon always mirrors the folder contents.
    // e.g. international_affairs.json -> id=international_affairs, label="International Affairs"
    const id = slug.trim().toLowerCase();
    const label = HUMANIZE(slug);
    const description =
      typeof parsed.description === "string"
        ? parsed.description
        : typeof parsed.metadata?.description === "string"
          ? parsed.metadata.description
          : "";
    const metadata = parsed.metadata && typeof parsed.metadata === "object" ? parsed.metadata : undefined;

    templates.push({
      id,
      label,
      description,
      document: doc,
      ...(metadata ? { metadata } : {}),
      __precedence: entry.precedence
    });
  }

  // De-duplicate by id, preferring higher-precedence sources.
  const byId = new Map();
  for (const item of templates) {
    const existing = byId.get(item.id);
    if (!existing || item.__precedence > existing.__precedence) {
      byId.set(item.id, item);
    }
  }

  return Array.from(byId.values())
    .map(({ __precedence, ...rest }) => rest)
    .sort((a, b) => a.label.localeCompare(b.label, "en", { sensitivity: "base" }));
};

const writeOutput = async (templates) => {
  const header = `// Auto-generated. Run \"npm run generate:templates\" after editing journal_templates/.\nimport type { TemplateDefinition } from "./types.ts";\n\n`;
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
