import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { getHostContract } from "../host_contract.ts";

export const CITED_WORKS_FILENAME = "references.used.json";
export const CITED_WORKS_STORAGE_KEY = "leditor.references.usedKeys";

const KEY_REGEX = /^[A-Z0-9]{8}$/;
// references.used.json is keyed by our citation "itemKey" (8-char dataKey), not by dqids.
export const acceptKey = (value: string): boolean => KEY_REGEX.test(value);

const joinLike = (dir: string, name: string): string => {
  const base = String(dir || "").replace(/[\\/]+$/, "");
  if (!base) return name;
  const sep = base.includes("\\") && !base.includes("/") ? "\\" : "/";
  return `${base}${sep}${name}`;
};

const parseCiteGrpHref = (href: string): string[] => {
  const raw = href.trim();
  if (!raw.toLowerCase().startsWith("citegrp://")) return [];
  const payload = raw.slice("citegrp://".length);
  return payload
    .split(/;|,|\s+/)
    .map((k) => k.trim())
    .filter((k) => KEY_REGEX.test(k));
};

const parseCiteHref = (href: string): string[] => {
  const raw = href.trim();
  if (!raw.toLowerCase().startsWith("cite://")) return [];
  const payload = raw.slice("cite://".length).trim();
  return KEY_REGEX.test(payload) ? [payload] : [];
};

export const extractKeyFromLinkAttrs = (attrs: any): string => {
  const candidates = [
    attrs?.dataKey,
    attrs?.dataOrigHref,
    attrs?.itemKey,
    attrs?.dataItemKey,
    attrs?.["data-key"],
    attrs?.["data-item-key"],
    attrs?.["data-orig-href"]
  ]
    .map((v: any) => (typeof v === "string" ? v.trim() : ""))
    .filter(Boolean);
  for (const value of candidates) {
    if (acceptKey(value)) return value;
  }
  const href = typeof attrs?.href === "string" ? attrs.href.trim() : "";
  const fromCite = parseCiteHref(href)[0] || "";
  if (fromCite) return fromCite;
  const fromGrp = parseCiteGrpHref(href);
  if (fromGrp.length) return fromGrp[0];
  return "";
};

export const extractCitedKeysFromDoc = (doc: ProseMirrorNode): string[] => {
  const keys = new Set<string>();
  doc.descendants((node) => {
    if (node.type.name === "citation") {
      const items = node.attrs?.items;
      if (Array.isArray(items)) {
        items.forEach((item: any) => {
          const key = typeof item?.itemKey === "string" ? item.itemKey.trim() : "";
          if (acceptKey(key)) keys.add(key);
        });
      }
      return true;
    }
    const attrs = node.attrs ?? {};
    if (node.type.name === "anchor") {
      const key = extractKeyFromLinkAttrs(attrs);
      if (acceptKey(key)) keys.add(key);
      const href = typeof attrs.href === "string" ? attrs.href : "";
      parseCiteHref(href).forEach((k) => keys.add(k));
      parseCiteGrpHref(href).forEach((k) => keys.add(k));
      const itemKey = typeof attrs.itemKey === "string" ? attrs.itemKey.trim() : "";
      if (acceptKey(itemKey)) keys.add(itemKey);
      return true;
    }
    const marks: any[] = (node as any).marks || [];
    marks.forEach((mark) => {
      const name = mark?.type?.name;
      if (name !== "link" && name !== "anchor") return;
      const attrs = mark.attrs ?? {};
      const href = typeof attrs.href === "string" ? attrs.href : "";
      parseCiteHref(href).forEach((k) => keys.add(k));
      parseCiteGrpHref(href).forEach((k) => keys.add(k));
      const key = extractKeyFromLinkAttrs(attrs);
      if (acceptKey(key)) keys.add(key);
      const itemKey = typeof attrs.itemKey === "string" ? attrs.itemKey.trim() : "";
      if (acceptKey(itemKey)) keys.add(itemKey);
    });
    return true;
  });
  return Array.from(keys).sort();
};

export const getCitedWorksPath = (): string => {
  const contract = getHostContract();
  const dir = String(contract?.paths?.bibliographyDir || "").trim();
  return joinLike(dir, CITED_WORKS_FILENAME);
};

const safeParseKeys = (raw: string): string[] => {
  try {
    const parsed = JSON.parse(raw) as any;
    const keys = Array.isArray(parsed?.keys) ? parsed.keys : Array.isArray(parsed) ? parsed : [];
    return keys
      .map((k: any) => String(k || "").trim())
      .filter((k: string) => KEY_REGEX.test(k));
  } catch {
    return [];
  }
};

export const readCitedWorksKeys = async (): Promise<string[]> => {
  try {
    const host = (window as any).leditorHost;
    const contract = getHostContract();
    if (host?.readFile) {
      const path = getCitedWorksPath();
      const res = await host.readFile({ sourcePath: path });
      if (res?.success && typeof res.data === "string") {
        return safeParseKeys(res.data);
      }
    }
  } catch {
    // ignore
  }
  try {
    const raw = window.localStorage?.getItem(CITED_WORKS_STORAGE_KEY);
    if (!raw) return [];
    return safeParseKeys(raw);
  } catch {
    return [];
  }
};

export const writeCitedWorksKeys = async (keys: string[]): Promise<void> => {
  const normalized = Array.from(new Set(keys.map((k) => String(k || "").trim()).filter((k) => acceptKey(k)))).sort();
  const payload = JSON.stringify({ updatedAt: new Date().toISOString(), keys: normalized }, null, 2);
  try {
    window.localStorage?.setItem(CITED_WORKS_STORAGE_KEY, payload);
  } catch {
    // ignore
  }
  try {
    const host = (window as any).leditorHost;
    const contract = getHostContract();
    if (!host?.writeFile || !contract?.policy?.allowDiskWrites) return;
    await host.writeFile({ targetPath: getCitedWorksPath(), data: payload });
  } catch {
    // ignore
  }
};
