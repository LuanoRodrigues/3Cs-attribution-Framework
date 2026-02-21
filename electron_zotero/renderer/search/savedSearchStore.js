(function initSavedSearchStore() {
  async function list() {
    const res = await window.zoteroBridge.getSavedSearches();
    if (res?.status !== "ok") return [];
    return Array.isArray(res.rows) ? res.rows : [];
  }

  async function save(row) {
    const res = await window.zoteroBridge.saveSavedSearch(row || {});
    if (res?.status !== "ok") throw new Error(res?.message || "Failed to save search.");
    return res.row;
  }

  async function remove(id) {
    const res = await window.zoteroBridge.deleteSavedSearch({ id });
    if (res?.status !== "ok") throw new Error(res?.message || "Failed to delete search.");
    return Boolean(res.deleted);
  }

  window.ZoteroSavedSearchStore = {
    list,
    save,
    remove
  };
})();
