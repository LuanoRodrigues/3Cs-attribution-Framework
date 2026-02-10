import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { PageSetup } from "../src/layout-v2/types.ts";
import { layoutDocumentV2 } from "../src/layout-v2/index.ts";

type LayoutFixture = {
  name?: string;
  paragraphs: string[];
  setup?: PageSetup;
};

type LayoutDocStub = {
  descendants: (fn: (node: any, pos: number) => boolean | void) => void;
};

const repoRoot = path.resolve(process.cwd());
const fixturePath = path.join(repoRoot, "docs", "test_documents", "layout_v2_fixture.json");
const defaultOutPath = path.join(repoRoot, "docs", "test_documents", "layout_v2_snapshot.json");

const makeDocFromParagraphs = (paragraphs: string[]): LayoutDocStub => {
  return {
    descendants: (fn) => {
      let pos = 0;
      for (const text of paragraphs) {
        const node = {
          type: { name: "paragraph" },
          isTextblock: true,
          textContent: text,
          attrs: {},
          descendants: (childFn: (node: any, pos: number) => boolean | void) => {
            if (!text) return;
            const textNode = {
              type: { name: "text" },
              isText: true,
              text,
              marks: []
            };
            childFn(textNode, 0);
          }
        };
        fn(node, pos);
        pos += text.length + 2;
      }
    }
  };
};

export const buildSnapshot = (): {
  name: string;
  pageCount: number;
  blocks: number;
  layout: ReturnType<typeof layoutDocumentV2>;
} => {
  const raw = readFileSync(fixturePath, "utf8");
  const fixture = JSON.parse(raw) as LayoutFixture;
  const paragraphs = Array.isArray(fixture.paragraphs) ? fixture.paragraphs : [];
  const doc = makeDocFromParagraphs(paragraphs);
  const layout = layoutDocumentV2({ doc: doc as any, setup: fixture.setup });
  const snapshot = {
    name: fixture.name ?? "layout_v2_fixture",
    pageCount: layout.pages.length,
    blocks: layout.pages.reduce((sum, page) => sum + page.items.length, 0),
    layout
  };
  return snapshot;
};

export const run = (): void => {
  const snapshot = buildSnapshot();
  const outPath = process.env.LAYOUT_V2_SNAPSHOT_OUT || defaultOutPath;
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(snapshot, null, 2), "utf8");
  console.log("[layout-v2] snapshot written:", outPath);
};
