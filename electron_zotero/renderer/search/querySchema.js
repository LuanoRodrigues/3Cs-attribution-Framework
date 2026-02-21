(function initSearchSchema() {
  function normalizeQuery(input) {
    return String(input || "").trim();
  }

  function validateQuery(input) {
    const query = normalizeQuery(input);
    if (!query) return { ok: false, message: "Search query is required." };
    if (query.length < 2) return { ok: false, message: "Use at least 2 characters." };
    return { ok: true, query };
  }

  window.ZoteroSearchSchema = {
    normalizeQuery,
    validateQuery
  };
})();
