export type SectionMeta = {
  orientation: 'portrait' | 'landscape';
  columns: 1 | 2 | 3 | 4;
  mirrored: boolean;
  columnGapIn?: number;
  columnWidthIn?: number | null;
};

export const defaultSectionMeta: SectionMeta = {
  orientation: 'portrait',
  columns: 1,
  mirrored: false,
  columnGapIn: undefined,
  columnWidthIn: null
};

let nextSectionId = 0;
export const allocateSectionId = () => {
  nextSectionId += 1;
  return `section-${Date.now()}-${nextSectionId}`;
};

export const serializeSectionMeta = (meta: Partial<SectionMeta>) => JSON.stringify(meta);

const shouldForceSingleColumn = (): boolean =>
  typeof window !== 'undefined' && (window as any).__leditorDisableColumns !== false;

const normalizeColumns = (value: unknown): SectionMeta['columns'] => {
  if (shouldForceSingleColumn()) return 1;
  if (typeof value !== 'number') return defaultSectionMeta.columns;
  const clamped = Math.max(1, Math.min(4, Math.floor(value)));
  return clamped as SectionMeta['columns'];
};

const normalizeGap = (value: unknown): number | undefined => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined;
  return value;
};

const normalizeWidth = (value: unknown): number | null => {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return value;
};

export const parseSectionMeta = (raw?: string): SectionMeta => {
  if (!raw) return { ...defaultSectionMeta };
  try {
    const parsed = JSON.parse(raw);
    return {
      ...defaultSectionMeta,
      ...parsed,
      columns: normalizeColumns((parsed as { columns?: unknown }).columns),
      columnGapIn: normalizeGap((parsed as { columnGapIn?: unknown }).columnGapIn),
      columnWidthIn: normalizeWidth((parsed as { columnWidthIn?: unknown }).columnWidthIn)
    };
  } catch (error) {
    console.warn('LEditor: unable to parse section metadata', error);
    return { ...defaultSectionMeta };
  }
};

