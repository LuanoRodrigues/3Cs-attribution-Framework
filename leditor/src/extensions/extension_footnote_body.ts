import { Extension, Node, mergeAttributes } from "@tiptap/core";
import { Fragment, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { FootnoteKind } from "../uipagination/footnotes/model.ts";

const FOOTNOTES_CONTAINER_CLASS = "leditor-footnotes-container";
const FOOTNOTE_BODY_CLASS = "leditor-footnote-body";
const footnoteBodyManagementKey = new PluginKey("leditor-footnote-body-management");

export const buildFootnoteBodyContent = (schema: any, rawText: string): Fragment => {
  const paragraphType = schema?.nodes?.paragraph;
  if (!paragraphType) return Fragment.empty;
  const safeText = typeof rawText === "string" ? rawText : "";
  const lines = safeText.replace(/\r/g, "").split("\n");
  const blocks = lines.map((line) => {
    if (!line) return paragraphType.create();
    return paragraphType.create(null, schema.text(line));
  });
  return Fragment.fromArray(blocks.length ? blocks : [paragraphType.create()]);
};

export const getFootnoteBodyPlainText = (node: ProseMirrorNode | null | undefined): string => {
  if (!node) return "";
  const parts: string[] = [];
  node.forEach((child) => {
    if (child.isTextblock) {
      parts.push(child.textContent);
      return;
    }
    if (child.textContent) parts.push(child.textContent);
  });
  return parts.join("\n");
};

export const FootnotesContainerExtension = Node.create({
  name: "footnotesContainer",
  group: "block",
  content: "footnoteBody*",
  defining: true,
  isolating: true,
  selectable: false,
  draggable: false,
  parseHTML() {
    return [{ tag: "div[data-footnotes-container]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-footnotes-container": "true",
        class: FOOTNOTES_CONTAINER_CLASS
      }),
      0
    ];
  }
});

export const FootnoteBodyExtension = Node.create({
  name: "footnoteBody",
  group: "block",
  content: "block+",
  defining: true,
  isolating: true,
  selectable: false,
  draggable: false,
  addAttributes() {
    return {
      footnoteId: { default: null },
      kind: { default: "footnote" }
    };
  },
  parseHTML() {
    return [{ tag: "div[data-footnote-body]" }];
  },
  renderHTML({ HTMLAttributes }) {
    const attrs: Record<string, any> = {
      "data-footnote-body": "true",
      class: FOOTNOTE_BODY_CLASS
    };
    if (HTMLAttributes.footnoteId) {
      attrs["data-footnote-id"] = HTMLAttributes.footnoteId;
    }
    if (HTMLAttributes.kind) {
      attrs["data-footnote-kind"] = HTMLAttributes.kind;
    }
    return ["div", mergeAttributes(HTMLAttributes, attrs), 0];
  }
});

type FootnoteAnchor = { id: string; kind: FootnoteKind; text: string };
type FootnoteBodyInfo = { id: string; node: ProseMirrorNode; pos: number; inContainer: boolean };

const collectFootnoteAnchors = (doc: ProseMirrorNode, footnoteType: any): FootnoteAnchor[] => {
  const anchors: FootnoteAnchor[] = [];
  doc.descendants((node) => {
    if (node.type !== footnoteType) return true;
    const id = typeof (node.attrs as any)?.footnoteId === "string" ? String((node.attrs as any).footnoteId).trim() : "";
    if (!id) return true;
    const rawKind = typeof (node.attrs as any)?.kind === "string" ? String((node.attrs as any).kind) : "footnote";
    const kind: FootnoteKind = rawKind === "endnote" ? "endnote" : "footnote";
    const text = typeof (node.attrs as any)?.text === "string" ? String((node.attrs as any).text) : "";
    anchors.push({ id, kind, text });
    return true;
  });
  return anchors;
};

const collectFootnoteBodies = (
  doc: ProseMirrorNode,
  bodyType: any,
  containerType: any
): FootnoteBodyInfo[] => {
  const bodies: FootnoteBodyInfo[] = [];
  doc.descendants((node, pos) => {
    if (node.type !== bodyType) return true;
    const id = typeof (node.attrs as any)?.footnoteId === "string" ? String((node.attrs as any).footnoteId).trim() : "";
    const resolved = doc.resolve(pos);
    let inContainer = false;
    for (let depth = resolved.depth; depth > 0; depth -= 1) {
      if (resolved.node(depth).type === containerType) {
        inContainer = true;
        break;
      }
    }
    bodies.push({ id, node, pos, inContainer });
    return true;
  });
  return bodies;
};

const findContainer = (
  doc: ProseMirrorNode,
  containerType: any
): { pos: number; node: ProseMirrorNode } | null => {
  let found: { pos: number; node: ProseMirrorNode } | null = null;
  doc.descendants((node, pos) => {
    if (node.type !== containerType) return true;
    found = { pos, node };
    return false;
  });
  return found;
};

const getFirstPageInsertPos = (doc: ProseMirrorNode, pageType: any): number | null => {
  if (!pageType || doc.childCount === 0) return null;
  const first = doc.child(0);
  if (!first || first.type !== pageType) return null;
  const pagePos = 0;
  return pagePos + first.nodeSize - 1;
};

export const FootnoteBodyManagementExtension = Extension.create({
  name: "footnoteBodyManagement",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: footnoteBodyManagementKey,
        appendTransaction(transactions, _oldState, newState) {
          if (!transactions.some((tr) => tr.docChanged)) return null;
          const schema = newState.schema;
          const footnoteType = schema.nodes.footnote;
          const bodyType = schema.nodes.footnoteBody;
          const containerType = schema.nodes.footnotesContainer;
          if (!footnoteType || !bodyType || !containerType) return null;
          const pageType = schema.nodes.page;

          let tr = newState.tr;
          let doc = tr.doc;

          let containerInfo = findContainer(doc, containerType);
          if (!containerInfo) {
            const insertPos = getFirstPageInsertPos(doc, pageType);
            if (insertPos == null) return null;
            tr = tr.insert(insertPos, containerType.create());
            doc = tr.doc;
            containerInfo = findContainer(doc, containerType);
          }
          if (!containerInfo) return null;

          const bodies = collectFootnoteBodies(doc, bodyType, containerType);
          const externalBodies = bodies.filter((body) => !body.inContainer);
          if (externalBodies.length > 0) {
            externalBodies
              .sort((a, b) => b.pos - a.pos)
              .forEach((body) => {
                tr = tr.delete(body.pos, body.pos + body.node.nodeSize);
              });
            doc = tr.doc;
            containerInfo = findContainer(doc, containerType);
          }
          if (!containerInfo) return tr.docChanged ? tr : null;

          const anchors = collectFootnoteAnchors(doc, footnoteType);
          const anchorIds = anchors.map((anchor) => anchor.id);

          const containerNode = containerInfo.node;
          const containerIds: string[] = [];
          const existingBodyById = new Map<string, ProseMirrorNode>();
          containerNode.forEach((child) => {
            if (child.type !== bodyType) return;
            const id = typeof (child.attrs as any)?.footnoteId === "string" ? String((child.attrs as any).footnoteId).trim() : "";
            containerIds.push(id);
            if (id && !existingBodyById.has(id)) {
              existingBodyById.set(id, child);
            }
          });

          const needsRebuild =
            anchorIds.length !== containerIds.length ||
            anchorIds.some((id, idx) => id !== containerIds[idx]) ||
            containerIds.some((id) => id && !anchorIds.includes(id));

          const hasBodies = anchors.length > 0 || containerIds.length > 0;
          if (!hasBodies && !needsRebuild) {
            return tr.docChanged ? tr : null;
          }

          if (needsRebuild) {
            const bodyById = new Map<string, ProseMirrorNode>();
            for (const body of bodies) {
              if (body.id && !bodyById.has(body.id)) {
                bodyById.set(body.id, body.node);
              }
            }
            const nextBodies = anchors.map((anchor) => {
              const existing = bodyById.get(anchor.id);
              const baseAttrs = existing?.attrs ?? {};
              const attrs = { ...baseAttrs, footnoteId: anchor.id, kind: anchor.kind };
              const text = anchor.text;
              const content =
                existing && existing.content?.size
                  ? existing.content
                  : buildFootnoteBodyContent(schema, text);
              return bodyType.create(attrs, content);
            });
            const start = containerInfo.pos + 1;
            const end = containerInfo.pos + containerInfo.node.nodeSize - 1;
            tr = tr.replaceWith(start, end, Fragment.fromArray(nextBodies));
          } else {
            const updates: Array<{ pos: number; node: ProseMirrorNode; text: string }> = [];
            containerNode.forEach((child, offset) => {
              if (child.type !== bodyType) return;
              const id = typeof (child.attrs as any)?.footnoteId === "string" ? String((child.attrs as any).footnoteId).trim() : "";
              if (!id) return;
              const anchor = anchors.find((entry) => entry.id === id);
              if (!anchor) return;
              const bodyText = getFootnoteBodyPlainText(child).trim();
              if (!bodyText && anchor.text.trim()) {
                updates.push({ pos: containerInfo.pos + 1 + offset, node: child, text: anchor.text });
              }
            });
            if (updates.length > 0) {
              updates
                .sort((a, b) => b.pos - a.pos)
                .forEach((update) => {
                  const nextNode = bodyType.create(
                    { ...(update.node.attrs as any), footnoteId: update.node.attrs.footnoteId, kind: update.node.attrs.kind },
                    buildFootnoteBodyContent(schema, update.text)
                  );
                  tr = tr.replaceWith(update.pos, update.pos + update.node.nodeSize, nextNode);
                });
            }
          }

          if (!tr.docChanged) return null;
          tr.setMeta("addToHistory", false);
          return tr;
        }
      })
    ];
  }
});
