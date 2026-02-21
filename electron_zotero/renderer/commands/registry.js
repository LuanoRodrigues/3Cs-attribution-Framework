(function initCommandRegistry() {
  function buildRegistry() {
    const map = new Map();
    return {
      register(cmd) {
        map.set(String(cmd.id), cmd);
      },
      get(id) {
        return map.get(String(id)) || null;
      },
      list() {
        return Array.from(map.values());
      },
      run(id, context) {
        const cmd = map.get(String(id));
        if (!cmd || typeof cmd.run !== "function") return false;
        cmd.run(context || {});
        return true;
      }
    };
  }

  window.ZoteroCommandRegistry = {
    create: buildRegistry
  };
})();
