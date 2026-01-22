// Browser stub for node:fs/promises used by dictionary-en in the renderer bundle.
export const readFile = async () => {
  // Return an empty string so the renderer gracefully warns about missing aff/dic data.
  return "";
};

export const writeFile = async () => {
  // No-op write is sufficient for this shim.
  return;
};

export default { readFile, writeFile };
