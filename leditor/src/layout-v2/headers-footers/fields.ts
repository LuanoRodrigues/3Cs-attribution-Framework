export const resolvePageNumberField = (pageNumber: number, totalPages?: number): string => {
  if (totalPages && Number.isFinite(totalPages)) {
    return `${pageNumber} / ${totalPages}`;
  }
  return `${pageNumber}`;
};
